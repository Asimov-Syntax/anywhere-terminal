// src/utils/pathBoundary.ts — Path containment that survives filesystem roots,
// separator drift, and Windows drive-letter casing.
//
// Extracted from src/providers/gitDecorationProvider.ts so the worktree module
// does not grow a third copy of the same comparison.

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
