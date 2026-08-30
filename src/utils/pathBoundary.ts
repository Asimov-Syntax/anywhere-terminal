// src/utils/pathBoundary.ts — Path containment that survives filesystem roots,
// separator drift, and Windows drive-letter casing.
//
// Extracted from src/providers/gitDecorationProvider.ts so the worktree module
// does not grow a third copy of the same comparison.
//
// Two predicates live here, and the choice between them is not stylistic:
// `isPathInside` compares spelling and is right for ids something upstream has
// already resolved; `isResolvedPathInside` resolves both sides itself and is
// required wherever the answer AUTHORIZES A READ.

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Heuristic: does this look like a Windows absolute path (drive letter or
 * UNC) vs a POSIX absolute path? Callers use it to pick the correct path
 * separator AND the right normalization (case-insensitive + separator-folding
 * on Windows). Inputs from VS Code (`Uri.fsPath`, `workspaceFolders[].uri.fsPath`)
 * use the host's native separators, so a Windows path always matches one of
 * these shapes on Windows hosts.
 */
export function isWindowsAbsPath(p: string): boolean {
  return /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\");
}

/**
 * Windows: fold separators to `\` and lowercase (NTFS / VS Code's URI layer
 * both treat the drive letter case-insensitively). POSIX paths pass through
 * unchanged — they're case-sensitive and use only forward slashes.
 */
export function normalizePathForCompare(p: string): string {
  if (isWindowsAbsPath(p)) {
    return p.replace(/\//g, "\\").toLowerCase();
  }
  return p;
}

/**
 * Is `candidate` the same path as `root`, or somewhere beneath it?
 *
 * Handles three cases the naive `startsWith(root + sep)` form gets wrong:
 *
 *  1. Filesystem-root roots (`/` POSIX, `C:\` Windows) — naive concat produces
 *     `//` / `C:\/`, which never matches any real path.
 *  2. Windows path-separator drift — a back-slashed root against a
 *     forward-slashed candidate, and vice versa.
 *  3. Windows drive-letter casing — `c:` vs `C:`.
 */
export function isPathInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePathForCompare(candidate);
  const normalizedRoot = normalizePathForCompare(root);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const separator = isWindowsAbsPath(root) ? "\\" : "/";
  // A root that already ends in its separator IS the boundary; appending
  // another would produce a prefix no path can start with.
  const boundary = normalizedRoot.endsWith(separator) ? normalizedRoot : normalizedRoot + separator;
  return normalizedCandidate.startsWith(boundary);
}

/**
 * Injection seam for the resolved predicate. Tests supply fakes; production
 * takes `node:fs/promises`.
 */
export interface ResolvedPathInsideDeps {
  realpath?: (p: string) => Promise<string>;
  /** Distinguishes "nothing is here" from "a link is here and it dangles". */
  lstat?: (p: string) => Promise<unknown>;
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/**
 * Is `candidate` STRICTLY inside `root` once BOTH are resolved through symlinks?
 *
 * Two rules carry the whole point of this predicate, and both are the opposite
 * of what the worktree subsystem's `realpathTolerant` does:
 *
 *  1. **Absence is tolerated; failure is not.** A tail that does not exist yet,
 *     beneath a parent that resolved inside the root, is contained — a
 *     transcript that has not been written is the normal early state of a
 *     session. Every other resolution failure refuses. Rebuilding an
 *     unresolvable path lexically is exactly the hole this closes: a dangling
 *     link inside the root would be reconstructed as its literal spelling and
 *     pass, then resolve out of the root the moment its target appears.
 *  2. **Equality is not containment.** Unlike `isPathInside`, a candidate equal
 *     to the root is refused, because every caller here is about to READ the
 *     candidate as a file.
 */
export async function isResolvedPathInside(
  candidate: string,
  root: string,
  deps: ResolvedPathInsideDeps = {},
): Promise<boolean> {
  const realpath = deps.realpath ?? ((p: string) => fs.realpath(p));
  const lstat = deps.lstat ?? ((p: string) => fs.lstat(p));
  const api = isWindowsAbsPath(candidate) || isWindowsAbsPath(root) ? path.win32 : path.posix;

  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(root);
  } catch {
    // A root that cannot be resolved holds nothing.
    return false;
  }

  const tail: string[] = [];
  let current = candidate;
  for (;;) {
    try {
      const resolved = await realpath(current);
      const full = tail.length === 0 ? resolved : api.join(resolved, ...[...tail].reverse());
      return !isSamePath(full, resolvedRoot) && isPathInside(full, resolvedRoot);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") {
        // ELOOP, EACCES, ENOTDIR — the filesystem declined to answer, so we do
        // not answer for it.
        return false;
      }
      // ENOENT from `realpath` covers two very different things: nothing is
      // here, or something IS here and its link target is not. `lstat` sees the
      // link itself, and a link we cannot follow is refused.
      try {
        await lstat(current);
        return false;
      } catch (lstatError) {
        if (errnoCode(lstatError) !== "ENOENT") {
          return false;
        }
      }
      const parent = api.dirname(current);
      if (parent === current) {
        // Not even the filesystem root resolved. No lexical fallback.
        return false;
      }
      tail.push(api.basename(current));
      current = parent;
    }
  }
}

function isSamePath(a: string, b: string): boolean {
  return normalizePathForCompare(a) === normalizePathForCompare(b);
}
