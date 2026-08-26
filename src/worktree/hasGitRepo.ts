// src/worktree/hasGitRepo.ts — Does this workspace hold a git repository?
// See: asimov/changes/wire-live-worktree-tree/design.md D1
//
// Synchronous on purpose: the value ships with `init`, and an awaited probe
// would hand the webview a stale `false` on a cold window. Deliberately looser
// than git's own answer — a `.git` here with git unusable opens the Worktree
// body on its "git unavailable" state rather than hiding a repository the user
// has.

import { existsSync } from "node:fs";
import * as path from "node:path";

/** Ancestors probed per folder before giving up — a bound, not a real limit. */
const MAX_DEPTH = 64;

/**
 * True when any workspace folder is inside a git repository. Stops at the first
 * answer: the caller asks whether there is one, not how many.
 */
export function hasGitRepo(folders: readonly string[], exists: (p: string) => boolean = existsSync): boolean {
  for (const folder of folders) {
    let dir = folder;
    for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
      if (exists(path.join(dir, ".git"))) {
        return true;
      }
      const parent = path.dirname(dir);
      // `dirname` of the root is the root — the only stop condition a walk up
      // from an absolute path gets.
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return false;
}
