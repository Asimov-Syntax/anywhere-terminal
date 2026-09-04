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
import { type PreparedRoot, prepareResolvedRoot } from "../../utils/resolvedPathBoundary";
import {
  addEntry,
  addSetup,
  contained,
  modelFromDraft,
  newDraft,
  openProviderFile,
  type ProviderBudget,
  readJsonc,
  scanExhausted,
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

/** The manifests that may declare workspaces, in the order they are consulted. */
const PACKAGE_MANIFEST = "package.json";
const PNPM_MANIFEST = "pnpm-workspace.yaml";
/** POSIX (`/…`), UNC or Windows (`\…`), and drive-qualified (`X:…`) roots. */
const ABSOLUTE_SPELLING = /^(?:[/\\]|[A-Za-z]:)/;

/** Every declared pattern this reader accepted, repo-relative and POSIX. */
type Declared = readonly string[];

/**
 * What a manifest said, kept apart from what it failed to say.
 *
 * `refused` is not `none`. A manifest whose parse reported an error must stop
 * the walk rather than hand it to the next manifest — collapsing the two let a
 * `pnpm-workspace.yaml` govern probing for a repository whose `package.json`
 * this reader had just declined to trust (round-1 F002).
 */
type Declaration =
  | { kind: "declared"; patterns: Declared }
  /** A valid declaration that names no package. */
  | { kind: "empty" }
  /** No manifest, or a manifest not carrying the key at all. */
  | { kind: "absent" }
  /** Present, in a shape this reader does not implement. */
  | { kind: "unsupported" }
  /** Present, but this reader would not read it: refused, over-size, or unparsable. */
  | { kind: "refused" };

/** A parsed manifest, or nothing — `null` is not a record, and `"null"` parses to it. */
function recordOf(parsed: unknown): Record<string, unknown> | undefined {
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/**
 * How a present declaration value classifies: the patterns it holds, the fact
 * that it validly holds none, or the fact that this reader cannot use it.
 *
 * Absent, empty, and wrong-shaped are three answers, not two. Collapsing them
 * let `workspaces: 42` and `workspaces: [1, null, {}]` fall through to
 * `pnpm-workspace.yaml` and be governed by it — the fail-closed boundary
 * round 1 accepted and rounds 3 and 4 each found still open (design.md D6).
 */
function patternsOf(value: unknown): Declaration {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(recordOf(value)?.packages)
      ? (recordOf(value)?.packages as unknown[])
      : undefined;
  if (list === undefined) {
    return { kind: "unsupported" };
  }
  // A non-string member is dropped rather than coerced: `String(null)` is a
  // path this reader would then try to resolve. What distinguishes a valid
  // empty declaration from one this reader could not use is what was DISCARDED,
  // not what survived — `[1, null, {}]` filters to the same `[]` as `[]` does,
  // and only the second may govern nothing and let pnpm answer (round-4 F002).
  const patterns = list.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (patterns.length > 0) {
    return { kind: "declared", patterns };
  }
  return list.length > 0 ? { kind: "unsupported" } : { kind: "empty" };
}

/**
 * A manifest's bytes, through the same seam every provider file uses.
 *
 * `openProviderFile` prepares the resolved root and checks containment BEFORE
 * it reads, which is the whole reason to go through it: reading `package.json`
 * with a bare `deps.readFile` followed a symlink out of the checkout and let an
 * arbitrary external file declare this repository's workspaces (round-1 F001).
 */
async function manifestBytes(
  deps: SuggestDeps,
  repoRoot: string,
  root: PreparedRoot,
  file: string,
): Promise<{ kind: "text"; text: string } | { kind: "absent" } | { kind: "refused" }> {
  const opened = await openProviderFile(deps, repoRoot, { id: "native", file }, root);
  if (opened.kind === "text") {
    return { kind: "text", text: opened.text };
  }
  // A containment or size refusal is NOT absence. Collapsing both to
  // `undefined` gave a `package.json` symlinked out of the checkout the same
  // answer as one that is not there, and `pnpm-workspace.yaml` was then read
  // and obeyed (round-4 F002).
  return opened.kind === "absent" ? { kind: "absent" } : { kind: "refused" };
}

async function packageDeclaration(deps: SuggestDeps, repoRoot: string, root: PreparedRoot): Promise<Declaration> {
  const bytes = await manifestBytes(deps, repoRoot, root, PACKAGE_MANIFEST);
  if (bytes.kind !== "text") {
    return bytes;
  }
  const errors: ParseError[] = [];
  const parsed = readJsonc(bytes.text, errors);
  // `readJsonc` RECOVERS — it returns the tree it could build and reports the
  // syntax errors out of band — so any reported error is a refusal, not a
  // reason to read the keys that survived (design.md D1).
  if (errors.length > 0 || parsed === undefined) {
    return { kind: "refused" };
  }
  // A top-level `null` parses cleanly and is not a record; reading `.workspaces`
  // off it THREW, and the thrown rejection took the whole offer down — root
  // environment and setup rows included (round-3 F006).
  const manifest = recordOf(parsed);
  if (manifest === undefined) {
    return { kind: "refused" };
  }
  return manifest.workspaces === undefined ? { kind: "absent" } : patternsOf(manifest.workspaces);
}

async function pnpmDeclaration(deps: SuggestDeps, repoRoot: string, root: PreparedRoot): Promise<Declaration> {
  const bytes = await manifestBytes(deps, repoRoot, root, PNPM_MANIFEST);
  if (bytes.kind !== "text") {
    return bytes;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(bytes.text);
  } catch {
    return { kind: "refused" };
  }
  // An empty file parses to `null` and declares nothing; any other non-record —
  // a bare scalar, a top-level list — is a shape this reader does not implement.
  if (parsed === null || parsed === undefined) {
    return { kind: "absent" };
  }
  const manifest = recordOf(parsed);
  if (manifest === undefined) {
    return { kind: "unsupported" };
  }
  return manifest.packages === undefined ? { kind: "absent" } : patternsOf(manifest.packages);
}

/**
 * What the repository says about itself, or nothing.
 *
 * `package.json` answers first, and only two of the five states let
 * `pnpm-workspace.yaml` answer at all: a manifest that is not there or carries
 * no key (`absent`), and one that validly declares no package (`empty`). A
 * `declared`, `unsupported`, or `refused` higher-priority manifest terminates
 * discovery, because a manifest this reader will not act on must not hand
 * authority to a lower-priority one (design.md D6).
 *
 * The switch is exhaustive on purpose: a sixth state cannot be added without
 * the compiler naming this site as one that has to decide what it means.
 */
function endsDiscovery(d: Declaration): boolean {
  switch (d.kind) {
    case "declared":
    case "unsupported":
    case "refused":
      return true;
    case "absent":
    case "empty":
      return false;
  }
}

async function declaredWorkspaces(deps: SuggestDeps, repoRoot: string, root: PreparedRoot): Promise<Declared> {
  const first = await packageDeclaration(deps, repoRoot, root);
  if (endsDiscovery(first)) {
    return first.kind === "declared" ? first.patterns : [];
  }
  const second = await pnpmDeclaration(deps, repoRoot, root);
  return second.kind === "declared" ? second.patterns : [];
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
  const prepared = await prepareResolvedRoot(repoRoot, { realpath: deps.realpath, lstat: deps.lstat });
  if (prepared === null) {
    return [];
  }
  const declared = await declaredWorkspaces(deps, repoRoot, prepared);
  const out: string[] = [];
  /**
   * One unit of the shared budget per declaration examined, spent BEFORE the
   * containment resolution rather than after it.
   *
   * Charging only accepted directories left the refusal path free, and a
   * refusal still costs one or two `realpath` calls: three thousand escaping
   * literals bought six thousand resolutions while `scanned` stayed at zero
   * (round-1 F004). What a declaration costs is what it is charged, whether or
   * not it turns out to name somewhere we will look.
   */
  const charge = async (rel: string): Promise<boolean> => {
    if (scanExhausted(budget) || out.includes(rel)) {
      return false;
    }
    budget.scanned += 1;
    if ((await contained(rel, repoRoot, prepared, deps)) !== "inside") {
      return false;
    }
    out.push(rel);
    return true;
  };
  for (const raw of declared) {
    if (scanExhausted(budget)) {
      break;
    }
    // Judged from the RAW spelling, before normalisation and before
    // `splitGlob` — which reports an empty parent for `/*`, and an empty parent
    // is exactly what the root-glob exemption below trusts, so an absolute
    // pattern was silently reinterpreted as a repository-root one (round-3
    // F007). `path.isAbsolute` answers for the host OS only, so on POSIX it
    // called `C:/apps/*` relative and the pattern ran as `<repo>/C:/apps`
    // (round-4 F007). POSIX, UNC, and drive-qualified are all absolute here
    // whatever the host (design.md D7).
    if (ABSOLUTE_SPELLING.test(raw)) {
      continue;
    }
    const pattern = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!pattern.includes("*")) {
      await charge(pattern);
      continue;
    }
    const glob = splitGlob(pattern);
    // More than one `*`, or a `*` outside the last segment: not implemented, so
    // skipped rather than interpreted generously, exactly as `entriesFor` does.
    if (glob === null) {
      continue;
    }
    // A root-level glob is exempt from the parent check for the same reason
    // `entriesFor` exempts it: the directory it names IS the repository root,
    // and resolved containment refuses a candidate equal to the root on
    // purpose. Asking anyway reported `*` as escaping and silently dropped
    // every top-level package (round-1 F005).
    if (glob.dir !== "") {
      budget.scanned += 1;
      if ((await contained(glob.dir, repoRoot, prepared, deps)) !== "inside") {
        continue;
      }
    }
    // Re-checked AFTER the parent charge, which can itself spend the last unit.
    // `scanNames` bounds what it KEEPS, but a Promise-backed `readdir` has
    // already materialized the directory by the time it looks — so the syscall
    // is what has to be gated, exactly as `entriesFor` gates it (F008).
    if (scanExhausted(budget)) {
      continue;
    }
    let names: string[];
    try {
      names = (await scanNames(deps.readdir(path.resolve(repoRoot, glob.dir)), budget)).names;
    } catch {
      // Absent, unreadable, or denied — this pattern contributes nothing and
      // every OTHER row survives. Letting the rejection escape discarded the
      // whole fallback, so one missing workspace directory took the root
      // `.env` and the lockfile setup down with it (round-1 F003).
      continue;
    }
    for (const name of names) {
      if (
        name.length >= glob.prefix.length + glob.suffix.length &&
        name.startsWith(glob.prefix) &&
        name.endsWith(glob.suffix)
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
        suggestion: "May contain secrets.",
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
          suggestion: "May contain secrets.",
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
          suggestion: "Runs after files are copied.",
        });
        break;
      }
    }
  }
  return modelFromDraft(draft);
}
