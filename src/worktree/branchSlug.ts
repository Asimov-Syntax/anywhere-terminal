// src/worktree/branchSlug.ts — The branch→path-segment rule, and nothing else.
//
// Its own module because both sides need it and only one can load Node: the
// host derives the destination and the form must show that same destination,
// so a second copy would let them drift (round-3 B12). It cannot live in
// createPath.ts — that imports `node:path`, which the webview's
// `platform: "browser"` bundle cannot resolve.

/** `feat/worktree ui` → `feat-worktree-ui`, the segment a default path appends. */
export function sanitizeBranchForPath(branch: string): string {
  return branch
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
