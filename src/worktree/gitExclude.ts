// src/worktree/gitExclude.ts — Keep repository-local layout and provisioning
// files out of git status without changing tracked ignore rules.

import { stat } from "node:fs/promises";
import * as path from "node:path";
import { type LockDeadline, LockedFile, type LockedOutcome, type WriteGate } from "../utils/lockedFile";
import { afterDelay, type Deadline } from "./deadline";

export interface GitExcludeLockedFile {
  withLock<T>(
    work: () => Promise<T>,
    lockUnavailable: T,
    failed: T,
    onLockReleaseFailed?: (lockPath: string) => void,
  ): Promise<T>;
  withLock<T>(
    deadline: LockDeadline,
    work: (gate: WriteGate) => Promise<T>,
    failed: T,
    onLockReleaseFailed?: (lockPath: string) => void,
  ): Promise<LockedOutcome<T>>;
  readText(): Promise<string | undefined>;
  atomicReplace(contents: string, mode: number | undefined, gate?: WriteGate): Promise<boolean>;
}

export interface GitExcludeDeps {
  lockedFile(path: string): GitExcludeLockedFile;
  mode(path: string): Promise<number | undefined>;
  warn?(message: string): void;
  deadlineMs?: number;
}

const realDeps: GitExcludeDeps = {
  lockedFile: (target) => new LockedFile(target),
  mode: async (target) => (await stat(target)).mode,
  warn: (message) => console.warn(message),
};

export type ExcludeResult =
  | { added: boolean }
  | { failed: string }
  | { failed: string; timedOut: true; retainedLockPath?: string };

/** Turn a repo-relative directory into an anchored `info/exclude` pattern. */
export function excludePatternFor(relativeDir: string): string {
  const clean = relativeDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return `/${clean.replace(/[[\]*?]/g, (c) => `\\${c}`)}/`;
}

/** Add one exact line to the repository-local exclude file, once. */
export async function addToGitExclude(
  gitDir: string,
  entry: string,
  deps: GitExcludeDeps = realDeps,
  deadline?: Deadline,
): Promise<ExcludeResult> {
  if (/[\r\n]/.test(entry)) {
    return { failed: "an exclude entry must be a single line" };
  }

  const excludePath = path.join(gitDir, "info", "exclude");
  const locked = deps.lockedFile(excludePath);
  const ownedDeadline = deadline ?? afterDelay(deps.deadlineMs ?? 5_000);
  const cancel = deadline === undefined;
  try {
    const outcome = await locked.withLock<ExcludeResult>(
      ownedDeadline,
      async (gate) => {
        try {
          const current = (await locked.readText()) ?? "";
          const lines = current.split("\n").map((line) => line.trim());
          if (lines.includes(entry)) {
            return { added: false };
          }
          const needsNewline = current.length > 0 && !current.endsWith("\n");
          const mode = current.length === 0 ? undefined : await deps.mode(excludePath);
          const written = await locked.atomicReplace(`${current}${needsNewline ? "\n" : ""}${entry}\n`, mode, gate);
          return written ? { added: true } : { failed: "the repository-local exclude file could not be updated" };
        } catch (error) {
          return { failed: error instanceof Error ? error.message : String(error) };
        }
      },
      { failed: "the repository-local exclude file could not be updated" },
      (lockPath) => deps.warn?.(`[AnyWhere Terminal] could not release repository-local exclude lock: ${lockPath}`),
    );
    if (outcome.kind === "done") {
      return outcome.value;
    }
    if (outcome.kind === "unavailable") {
      return { failed: "the repository-local exclude file is locked" };
    }
    if (outcome.retainedLockPath !== undefined) {
      deps.warn?.(
        `[AnyWhere Terminal] repository-local exclude lock retained after timeout: ${outcome.retainedLockPath}`,
      );
      return {
        failed: "the repository-local exclude update timed out while a write was still pending",
        timedOut: true,
        retainedLockPath: outcome.retainedLockPath,
      };
    }
    return { failed: "the repository-local exclude update timed out before publication", timedOut: true };
  } finally {
    if (cancel) {
      ownedDeadline.cancel();
    }
  }
}
