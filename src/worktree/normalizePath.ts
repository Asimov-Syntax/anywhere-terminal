// src/worktree/normalizePath.ts — The one path normalizer for the worktree subsystem.
// See: docs/design/worktree-model.md § 3.1, asimov/changes/enumerate-git-worktrees/design.md D3
//
// The result IS the comparison key: on Windows the case is folded here rather
// than deferred to a comparator that a Map or Set lookup would silently skip.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface NormalizeWorktreePathDeps {
  platform: NodeJS.Platform;
  realpath(p: string): Promise<string>;
}

const defaultDeps: NormalizeWorktreePathDeps = {
  platform: process.platform,
  realpath: (p) => fs.realpath(p),
};

/**
 * Resolve symlinks via the nearest existing ancestor when `input` is absent.
 * A missing worktree must still normalize, or the row the UI needs to render as
 * "missing" gets a null id and disappears instead.
 */
async function realpathTolerant(
  input: string,
  api: path.PlatformPath,
  realpath: (p: string) => Promise<string>,
): Promise<string> {
  const tail: string[] = [];
  let current = input;

  for (;;) {
    try {
      const resolved = await realpath(current);
      return tail.length === 0 ? resolved : api.join(resolved, ...tail.reverse());
    } catch {
      const parent = api.dirname(current);
      if (parent === current) {
        // Nothing on this path resolves — fall back to the lexical form.
        return input;
      }
      tail.push(api.basename(current));
      current = parent;
    }
  }
}

function foldSeparators(input: string, isWindows: boolean): string {
  if (!isWindows) {
    return input.replace(/\/{2,}/g, "/");
  }
  const slashed = input.replace(/\//g, "\\");
  // A UNC path's leading `\\` is part of its root, not a repeated separator.
  const isUnc = slashed.startsWith("\\\\");
  const body = (isUnc ? slashed.slice(2) : slashed).replace(/\\{2,}/g, "\\");
  return isUnc ? `\\\\${body}` : body;
}

function stripTrailingSeparators(input: string, isWindows: boolean): string {
  let out = input;
  if (isWindows) {
    // `C:\` is a root, not a trailing separator.
    while (out.length > 3 && out.endsWith("\\") && !/^[A-Za-z]:\\$/.test(out)) {
      out = out.slice(0, -1);
    }
    return out;
  }
  while (out.length > 1 && out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Canonical identity for a worktree path, or `null` when empty / not absolute.
 * Never throws — an unresolvable path degrades to its lexical form.
 */
export async function normalizeWorktreePath(
  raw: string,
  deps: NormalizeWorktreePathDeps = defaultDeps,
): Promise<string | null> {
  if (raw.trim().length === 0) {
    return null;
  }
  const isWindows = deps.platform === "win32";
  const api = isWindows ? path.win32 : path.posix;
  if (!api.isAbsolute(raw)) {
    return null;
  }

  const resolved = await realpathTolerant(raw, api, deps.realpath);
  const composed = resolved.normalize("NFC");
  let out = stripTrailingSeparators(foldSeparators(composed, isWindows), isWindows);

  if (isWindows) {
    // Case-fold the whole path so string equality *is* the case-insensitive
    // comparison, then restore the conventional uppercase drive letter.
    out = out.toLowerCase().replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);
  }
  return out;
}
