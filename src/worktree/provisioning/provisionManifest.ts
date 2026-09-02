// src/worktree/provisioning/provisionManifest.ts — the ONE atomic record of
// what a create actually did, for `ignoredMaterial.ts` to read back
// (design.md D5).
//
// Descriptive, never authoritative: nothing here decides what runs, and a
// failure to write it changes no create, setup, port, launch or retry outcome
// — the caller folds every result into a non-fatal `warning` string.

import * as path from "node:path";
import type { ProvisionPortResult, ProvisionSetupResult, ProvisionStepResult } from "../../types/messages";
import {
  type AuthorizedDirectory,
  authorizeDirectory,
  type DirectoryStatLike,
  directoryStillAuthorized,
} from "../../utils/authorizedDirectory";
import { LockedFile } from "../../utils/lockedFile";
import { type GitDirRun, readWorktreeGitDir } from "../worktreeGitDir";

/** The manifest's own filename, beside the worktree's own git dir (worktree-apply.md § 2.6). */
export const PROVISION_MANIFEST_FILE = "anywhere-terminal-provision.json";

/** The manifest shape this writer emits. `ignoredMaterial.ts` reads `materialized` off exactly this version. */
const PROVISION_MANIFEST_VERSION = 1;

/** What was actually written to disk — never a destination that was already there or refused. */
export interface ProvisionManifestMaterial {
  readonly path: string;
  readonly mode: "copy" | "link";
}

/** One named port's authoritative value, kept only where allocation or reuse succeeded. */
export interface ProvisionManifestPort {
  readonly name: string;
  readonly port: number;
}

/** Every selected setup source, whatever it did. */
export interface ProvisionManifestSetup {
  readonly source: string;
  readonly outcome: "ok" | "failed" | "skipped";
}

export interface ProvisionManifestV1 {
  readonly version: 1;
  readonly createdAt: string;
  readonly materialized: readonly ProvisionManifestMaterial[];
  readonly ports: readonly ProvisionManifestPort[];
  readonly setup: readonly ProvisionManifestSetup[];
}

/**
 * `steps`, `ports` and `setup` in, one version-1 record out.
 *
 * Pure and disk-free, so the filtering rules — successful material only,
 * authoritative ports only, every selected setup source — have exactly one
 * place to be wrong and no filesystem needed to prove it.
 */
export function deriveProvisionManifest(
  steps: readonly ProvisionStepResult[],
  ports: readonly ProvisionPortResult[],
  setup: readonly ProvisionSetupResult[],
  createdAtMs: number,
): ProvisionManifestV1 {
  const materialized: ProvisionManifestMaterial[] = [];
  for (const step of steps) {
    // `skipped` and `refused` and `failed` wrote nothing; naming them here
    // would claim this extension put material at a path it never touched.
    if (step.outcome.kind === "copied" || step.outcome.kind === "degradedToCopy") {
      materialized.push({ path: step.path, mode: "copy" });
    } else if (step.outcome.kind === "linked") {
      materialized.push({ path: step.path, mode: "link" });
    }
  }
  const authoritativePorts: ProvisionManifestPort[] = [];
  for (const port of ports) {
    // Only a value this process actually claimed — never a preview, and never
    // a failed allocation, which has no port to name.
    if (port.outcome.kind === "allocated" || port.outcome.kind === "reused") {
      authoritativePorts.push({ name: port.name, port: port.outcome.port });
    }
  }
  return {
    version: PROVISION_MANIFEST_VERSION,
    createdAt: new Date(createdAtMs).toISOString(),
    materialized,
    ports: authoritativePorts,
    // Every selected setup source, ok or failed or skipped alike — the
    // manifest names what was attempted, not only what succeeded.
    setup: setup.map((entry) => ({ source: entry.source, outcome: entry.outcome.kind })),
  };
}

export interface ProvisionManifestLockedFile {
  atomicReplace(contents: string, mode: number | undefined): Promise<boolean>;
}

export interface ProvisionManifestDeps {
  /** Same runner `readWorktreeGitDir` and the entry/port writers already use. */
  run: GitDirRun;
  lstat(target: string): Promise<DirectoryStatLike>;
  /** Defaults to a real `LockedFile`. Injectable so a test can fail the replace alone. */
  lockedFile?(target: string): ProvisionManifestLockedFile;
  now?(): number;
}

export interface ProvisionManifestOutcome {
  /** Absent on a committed write. Present and non-fatal on every other path. */
  readonly warning?: string;
}

/**
 * Write the version-1 manifest for one worktree, or report why it could not
 * be written.
 *
 * The destination is resolved through `readWorktreeGitDir` and nowhere else,
 * so this and `ignoredMaterial.ts`'s reader can never come to disagree about
 * which directory the manifest lives in. The administrative directory is
 * authorized once and rechecked immediately before the replace, closing the
 * window a substituted `.git/worktrees/<id>` would open between the two
 * (design.md D5, worktree-apply.md § 2.6).
 */
export async function writeProvisionManifest(
  worktreePath: string,
  steps: readonly ProvisionStepResult[],
  ports: readonly ProvisionPortResult[],
  setup: readonly ProvisionSetupResult[],
  deps: ProvisionManifestDeps,
): Promise<ProvisionManifestOutcome> {
  let gitDir: string;
  try {
    gitDir = await readWorktreeGitDir(worktreePath, deps.run);
  } catch {
    return { warning: "the provisioning manifest could not resolve the worktree's administrative directory" };
  }

  let authorization: AuthorizedDirectory | undefined;
  try {
    authorization = await authorizeDirectory(gitDir, { lstat: deps.lstat });
  } catch {
    authorization = undefined;
  }
  if (authorization === undefined) {
    return { warning: "the worktree's administrative directory could not be authorized" };
  }

  const contents = JSON.stringify(deriveProvisionManifest(steps, ports, setup, deps.now?.() ?? Date.now()), null, 2);
  const target = path.join(gitDir, PROVISION_MANIFEST_FILE);

  // Rechecked immediately before the write, not only at authorization: the
  // directory can be swapped in between, and a write that trusted the earlier
  // observation would land wherever the substitute points (design.md D5,
  // .reviews pattern shared with `writeNativeConfig.ts`).
  let stillAuthorized: boolean;
  try {
    stillAuthorized = await directoryStillAuthorized(authorization, { lstat: deps.lstat });
  } catch {
    stillAuthorized = false;
  }
  if (!stillAuthorized) {
    return { warning: "the worktree's administrative directory changed before the manifest could be written" };
  }

  const lockedFile = deps.lockedFile ?? ((filePath: string) => new LockedFile(filePath));
  let written: boolean;
  try {
    written = await lockedFile(target).atomicReplace(contents, 0o600);
  } catch {
    written = false;
  }
  return written ? {} : { warning: "the provisioning manifest could not be written" };
}
