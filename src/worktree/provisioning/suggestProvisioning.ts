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
import type { ProvisionModel } from "../../types/messages";
import { addEntry, addSetup, modelFromDraft, newDraft } from "./providerKit";

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

export async function suggestProvisioning(
  deps: SuggestDeps,
  repoRoot: string,
  nextId: () => string,
): Promise<ProvisionModel> {
  // Through the kit's draft and its one assembly point, like every adapter: a
  // field added to `ProvisionModel` must not reach the three adapters and miss
  // this detector. There is no provider file behind these rows, so the context
  // names the root file each row's own evidence is.
  const draft = newDraft({ id: "native", file: "" });
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
