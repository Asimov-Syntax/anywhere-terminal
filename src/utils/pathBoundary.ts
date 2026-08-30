// src/utils/pathBoundary.ts — Path containment that survives filesystem roots,
// separator drift, and Windows drive-letter casing.
//
// Extracted from src/providers/gitDecorationProvider.ts so the worktree module
// does not grow a third copy of the same comparison.
//
// Two predicates decide containment and the choice between them is not
// stylistic: `isPathInside` below compares SPELLING and is right for ids
// something upstream has already resolved; `isResolvedPathInside`, in
// ./resolvedPathBoundary, resolves both sides itself and is required wherever
// the answer AUTHORIZES A READ.
//
// They are separate modules because this one is the only half the webview can
// hold: the resolved predicate needs `node:fs` and `node:path`, and importing
// it from a browser bundle fails to resolve at build time. Keeping the lexical
// rule node-free is what lets `FileTreePanel` share it instead of copying it.

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
  const { same, beneath } = compareBoundary(candidate, root, normalizePathForCompare);
  return same || beneath;
}

/**
 * Where the boundary sits, for both predicates. Parameterized by its normalizer
 * because that is the ONLY thing the two disagree about: `isPathInside` folds
 * Windows case, the resolved form must not (D7). Everything else — the root
 * separator, a root that already ends in one — is one rule with one home.
 *
 * Exported for `./resolvedPathBoundary` alone, which is the other predicate.
 * Keeping it here rather than duplicating it is the point: the boundary rule
 * has one home even though the two predicates ship in separate modules.
 */
export function compareBoundary(
  candidate: string,
  root: string,
  normalize: (p: string) => string,
): { same: boolean; beneath: boolean } {
  const normalizedCandidate = normalize(candidate);
  const normalizedRoot = normalize(root);
  if (normalizedCandidate === normalizedRoot) {
    return { same: true, beneath: false };
  }
  const separator = isWindowsAbsPath(root) ? "\\" : "/";
  // A root that already ends in its separator IS the boundary; appending
  // another would produce a prefix no path can start with.
  const boundary = normalizedRoot.endsWith(separator) ? normalizedRoot : normalizedRoot + separator;
  return { same: false, beneath: normalizedCandidate.startsWith(boundary) };
}
