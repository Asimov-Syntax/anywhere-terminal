// src/worktree/gitExclude.ts — Keep the parent repo's `git status` clean when a
// worktree root lives inside the main worktree (design.md D8).
//
// `.git/info/exclude` and never `.gitignore`: the former is repo-local and
// uncommitted, which is the right home for a layout THIS user chose and their
// collaborators did not. `.gitignore` is tracked, and committing an entry on the
// user's behalf is not ours to do.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface GitExcludeDeps {
  readFile(p: string): Promise<string>;
  writeFile(p: string, data: string): Promise<void>;
  mkdir(p: string): Promise<void>;
}

const realDeps: GitExcludeDeps = {
  readFile: (p) => fs.readFile(p, "utf8"),
  writeFile: (p, data) => fs.writeFile(p, data, "utf8"),
  mkdir: async (p) => {
    await fs.mkdir(p, { recursive: true });
  },
};

export type ExcludeResult = { added: boolean } | { failed: string };

/**
 * Turn a repo-relative directory into an anchored `info/exclude` pattern.
 *
 * Anchored with a leading `/` so it matches that one directory rather than
 * every path of the same name at any depth, and closed with a trailing `/` so
 * it can only ever match a directory. Git's own pattern metacharacters are
 * escaped, because the path is USER INPUT: it arrives on a webview message.
 *
 * A backslash is a SEPARATOR here, not a metacharacter to escape: git's exclude
 * patterns are `/`-delimited on every platform, so escaping the separator a
 * Windows path arrives with produced a pattern that matched nothing (round-4
 * B10). Separators are converted first; only what survives is escaped.
 */
export function excludePatternFor(relativeDir: string): string {
  const clean = relativeDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return `/${clean.replace(/[[\]*?]/g, (c) => `\\${c}`)}/`;
}

/**
 * Add `entry` to the repository's exclude file, once.
 *
 * Idempotent by re-reading and matching the exact line, so repeating a create
 * does not grow the file. A failure is REPORTED and does not fail the create:
 * the worktree is what was asked for, and a noisy `git status` is a nuisance,
 * not a failure.
 *
 * `entry` must be a single line. It used to be written verbatim, and it used to
 * be an ABSOLUTE path — two defects in one line (round-3 B10). Absolute paths
 * are not valid exclude patterns, so D8 never actually worked and failed
 * silently; and a created path containing a newline appended EXTRA rules, which
 * a webview message could use to hide unrelated files from `git status`.
 */
export async function addToGitExclude(
  gitDir: string,
  entry: string,
  deps: GitExcludeDeps = realDeps,
): Promise<ExcludeResult> {
  const excludePath = path.join(gitDir, "info", "exclude");
  // Refused, not sanitized: a caller handing this more than one line has lost
  // track of what it is writing, and silently keeping the first line would
  // write a rule nobody asked for.
  if (/[\r\n]/.test(entry)) {
    return { failed: "an exclude entry must be a single line" };
  }
  try {
    let current = "";
    try {
      current = await deps.readFile(excludePath);
    } catch {
      // Absent is normal — `info/` may not exist in a fresh clone.
      await deps.mkdir(path.join(gitDir, "info"));
    }
    const lines = current.split("\n").map((l) => l.trim());
    if (lines.includes(entry)) {
      return { added: false };
    }
    const needsNewline = current.length > 0 && !current.endsWith("\n");
    await deps.writeFile(excludePath, `${current}${needsNewline ? "\n" : ""}${entry}\n`);
    return { added: true };
  } catch (err) {
    return { failed: err instanceof Error ? err.message : String(err) };
  }
}
