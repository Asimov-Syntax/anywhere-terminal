// src/worktree/gitExclude.ts — Keep repository-local layout and provisioning
// files out of git status without changing tracked ignore rules.

import { stat } from "node:fs/promises";
import * as path from "node:path";
import { LockedFile } from "../utils/lockedFile";

export interface GitExcludeLockedFile {
  withLock<T>(
    work: () => Promise<T>,
    lockUnavailable: T,
    failed: T,
    onLockReleaseFailed?: (lockPath: string) => void,
  ): Promise<T>;
  readText(): Promise<string | undefined>;
  atomicReplace(contents: string, mode: number | undefined): Promise<boolean>;
}

export interface GitExcludeDeps {
  lockedFile(path: string): GitExcludeLockedFile;
  mode(path: string): Promise<number | undefined>;
  warn?(message: string): void;
}

const realDeps: GitExcludeDeps = {
  lockedFile: (target) => new LockedFile(target),
  mode: async (target) => (await stat(target)).mode,
  warn: (message) => console.warn(message),
};

export type ExcludeResult = { added: boolean } | { failed: string };

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
): Promise<ExcludeResult> {
  if (/[\r\n]/.test(entry)) {
    return { failed: "an exclude entry must be a single line" };
  }

  const excludePath = path.join(gitDir, "info", "exclude");
  const locked = deps.lockedFile(excludePath);
  return locked.withLock<ExcludeResult>(
    async () => {
      try {
        const current = (await locked.readText()) ?? "";
        const lines = current.split("\n").map((line) => line.trim());
        if (lines.includes(entry)) {
          return { added: false };
        }
        const needsNewline = current.length > 0 && !current.endsWith("\n");
        const mode = current.length === 0 ? undefined : await deps.mode(excludePath);
        const written = await locked.atomicReplace(`${current}${needsNewline ? "\n" : ""}${entry}\n`, mode);
        return written ? { added: true } : { failed: "the repository-local exclude file could not be updated" };
      } catch (error) {
        return { failed: error instanceof Error ? error.message : String(error) };
      }
    },
    { failed: "the repository-local exclude file is locked" },
    { failed: "the repository-local exclude file could not be updated" },
    (lockPath) => deps.warn?.(`[AnyWhere Terminal] could not release repository-local exclude lock: ${lockPath}`),
  );
}
