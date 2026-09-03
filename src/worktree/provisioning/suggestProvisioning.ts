// src/worktree/provisioning/suggestProvisioning.ts — What a repository with no
// provisioning source probably wants: its root environment files copied, and
// its package manager's install run. Offered, never done — every row is opt-in
// and current-create-only (suggest-worktree-initialization design.md D1, D2).
//
// Bounded on purpose: a fixed list of names, one metadata call each, and
// nothing else. `SuggestDeps` withholds `readFile` and `readdir`, so deciding
// whether `.env` is worth suggesting cannot involve reading a secret, and no
// wildcard can enumerate names this list does not carry.

import * as path from "node:path";
import type { ParseError } from "jsonc-parser";
import { parse as parseYaml } from "yaml";
import type { ProvisionModel } from "../../types/messages";
import { prepareResolvedRoot } from "../../utils/resolvedPathBoundary";
import {
  addEntry,
  addSetup,
  contained,
  MAX_SCAN,
  modelFromDraft,
  newDraft,
  type ProviderBudget,
  readJsonc,
  scanNames,
  splitGlob,
} from "./providerKit";

/** The one answer detection needs from a stat. `node:fs/promises`' `lstat` satisfies it. */
export interface SuggestStats {
  isFile(): boolean;
}

/**
 * The one capability suggestion detection holds. Required and typed — a caller
 * that cannot stat cannot compile a fallback, which is the dependency contract
 * the plan attack found missing in `ProviderDeps`' optional untyped `lstat`.
 */
export interface SuggestDeps {
  lstat(p: string): Promise<SuggestStats>;
  /**
   * Manifests only. The detector opens `package.json` and `pnpm-workspace.yaml`
   * and nothing else — an environment file is decided by `lstat` at every
   * depth, so no candidate secret is ever read to justify suggesting it.
   */
  readFile(p: string): Promise<string>;
  readdir(p: string): Promise<readonly string[]> | AsyncIterable<string>;
  realpath(p: string): Promise<string>;
}

/** The manifests that may declare workspaces, in the order they are consulted. */
const PACKAGE_MANIFEST = "package.json";
const PNPM_MANIFEST = "pnpm-workspace.yaml";

/** Every declared pattern this reader accepted, repo-relative and POSIX. */
type Declared = readonly string[];

function patternsOf(value: unknown): Declared {
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && Array.isArray((value as { packages?: unknown }).packages)
      ? ((value as { packages: unknown[] }).packages as unknown[])
      : [];
  // A non-string member is dropped rather than coerced: `String(null)` is a
  // path this reader would then try to resolve.
  return list.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/**
 * What the repository says about itself, or nothing.
 *
 * A manifest that cannot be read is absence — the repository may simply not
 * have one. A manifest that parses with ANY reported error is a refusal:
 * `readJsonc` recovers a partial tree and reports syntax errors out of band, so
 * accepting the keys that survived would act on half a file (design.md D1).
 */
async function declaredWorkspaces(deps: SuggestDeps, repoRoot: string): Promise<Declared> {
  try {
    const errors: ParseError[] = [];
    const parsed = readJsonc(await deps.readFile(path.join(repoRoot, PACKAGE_MANIFEST)), errors);
    if (errors.length === 0 && parsed !== undefined) {
      const declared = patternsOf((parsed as { workspaces?: unknown }).workspaces);
      if (declared.length > 0) {
        return declared;
      }
    }
  } catch {
    // No manifest, or an unreadable one. Either way it declares nothing.
  }
  try {
    const parsed: unknown = parseYaml(await deps.readFile(path.join(repoRoot, PNPM_MANIFEST)));
    return patternsOf((parsed as { packages?: unknown } | null)?.packages);
  } catch {
    return [];
  }
}

export const SUGGESTED_ENV_FILES: readonly string[] = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".envrc",
];

/**
 * One row per manager, never one per lockfile: `bun.lock` and `bun.lockb` are
 * one tool twice. Distinct managers each keep their row — choosing between
 * contradictory lockfiles is the user's call, not this module's (D1).
 */
export const SUGGESTED_MANAGERS: readonly { readonly lockfiles: readonly string[]; readonly command: string }[] = [
  { lockfiles: ["pnpm-lock.yaml"], command: "pnpm install" },
  { lockfiles: ["package-lock.json"], command: "npm install" },
  { lockfiles: ["bun.lock", "bun.lockb"], command: "bun install" },
  { lockfiles: ["yarn.lock"], command: "yarn install" },
];

/**
 * `lstat` does not follow links, so a symlink answers as itself and fails this
 * test — a link out of the checkout must not become copy evidence. A failing
 * stat is absence of evidence, not a problem: nothing here was configured, so
 * there is nothing to report.
 */
async function ordinaryFile(deps: SuggestDeps, p: string): Promise<boolean> {
  try {
    return (await deps.lstat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Every declared pattern resolved to a repo-relative directory, charged to the
 * shared budget one directory at a time.
 *
 * `MAX_SCAN` alone does not bound this. It counts names examined during
 * WILDCARD expansion; a literal path never touches `scanNames` and so never
 * increments `scanned`. So each accepted directory — literal or expanded —
 * spends one unit of the same budget before it can be probed, and the walk
 * stops when the budget does (design.md D2).
 */
async function workspaceDirs(deps: SuggestDeps, repoRoot: string, budget: ProviderBudget): Promise<string[]> {
  const declared = await declaredWorkspaces(deps, repoRoot);
  if (declared.length === 0) {
    return [];
  }
  const prepared = await prepareResolvedRoot(repoRoot, { realpath: deps.realpath, lstat: deps.lstat });
  if (prepared === null) {
    return [];
  }
  const out: string[] = [];
  const charge = async (rel: string): Promise<void> => {
    if (budget.scanned >= MAX_SCAN || out.includes(rel)) {
      return;
    }
    if ((await contained(rel, repoRoot, prepared, deps)) !== "inside") {
      return;
    }
    budget.scanned += 1;
    out.push(rel);
  };
  for (const raw of declared) {
    const pattern = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!pattern.includes("*")) {
      await charge(pattern);
      continue;
    }
    const glob = splitGlob(pattern);
    // More than one `*`, or a `*` outside the last segment: not implemented, so
    // skipped rather than interpreted generously, exactly as `entriesFor` does.
    if (glob === null || (await contained(glob.dir === "" ? "." : glob.dir, repoRoot, prepared, deps)) !== "inside") {
      continue;
    }
    const { names } = await scanNames(deps.readdir(path.join(repoRoot, glob.dir)), budget);
    for (const name of names) {
      if (
        name.startsWith(glob.prefix) &&
        name.endsWith(glob.suffix) &&
        name.length >= glob.prefix.length + glob.suffix.length
      ) {
        await charge(glob.dir === "" ? name : `${glob.dir}/${name}`);
      }
    }
  }
  return out;
}

export async function suggestProvisioning(
  deps: SuggestDeps,
  repoRoot: string,
  budget: ProviderBudget,
): Promise<ProvisionModel> {
  const nextId = budget.nextId;
  // Through the kit's draft and its one assembly point, like every adapter: a
  // field added to `ProvisionModel` must not reach the three adapters and miss
  // this detector. There is no provider file behind these rows, so the context
  // names the root file each row's own evidence is.
  const draft = newDraft({ id: "native", file: "" }, budget);
  for (const name of SUGGESTED_ENV_FILES) {
    if (await ordinaryFile(deps, path.join(repoRoot, name))) {
      addEntry(draft, {
        id: nextId(),
        path: name,
        mode: "copy",
        source: name,
        suggestion: `\`${name}\` is at the repository root and may contain secrets. Copy creates an independent file in the new worktree.`,
      });
    }
  }
  // Root first and unchanged, so the common case reads exactly as before (D4).
  for (const dir of await workspaceDirs(deps, repoRoot, budget)) {
    for (const name of SUGGESTED_ENV_FILES) {
      const rel = `${dir}/${name}`;
      if (await ordinaryFile(deps, path.join(repoRoot, dir, name))) {
        addEntry(draft, {
          id: nextId(),
          path: rel,
          mode: "copy",
          source: rel,
          suggestion: `\`${rel}\` is inside a workspace package this repository declares and may contain secrets. Copy creates an independent file at the same place in the new worktree.`,
        });
      }
    }
  }
  // Setup stays a root question: a workspace install runs once at the root (D5).
  for (const manager of SUGGESTED_MANAGERS) {
    for (const lockfile of manager.lockfiles) {
      if (await ordinaryFile(deps, path.join(repoRoot, lockfile))) {
        addSetup(draft, {
          id: nextId(),
          kind: "shell",
          script: manager.command,
          source: lockfile,
          suggestion: `\`${lockfile}\` is at the repository root. Run setup executes \`${manager.command}\` in the worktree after file provisioning.`,
        });
        break;
      }
    }
  }
  return modelFromDraft(draft);
}
