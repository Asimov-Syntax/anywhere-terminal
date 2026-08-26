import { describe, expect, it, vi } from "vitest";
import { hasGitRepo } from "./hasGitRepo";

/** `exists` over a fixed set of paths that are present. */
function fs(...present: string[]) {
  const set = new Set(present);
  return vi.fn((p: string) => set.has(p));
}

describe("hasGitRepo", () => {
  it("is false when the workspace has no folders", () => {
    expect(hasGitRepo([], fs())).toBe(false);
  });

  it("finds a repository in the folder itself", () => {
    expect(hasGitRepo(["/work/repo"], fs("/work/repo/.git"))).toBe(true);
  });

  it("finds a repository an ancestor of the folder owns", () => {
    expect(hasGitRepo(["/work/repo/packages/api"], fs("/work/repo/.git"))).toBe(true);
  });

  it("finds a linked worktree, whose .git is a file rather than a directory", () => {
    // The probe asks only whether the entry is there — a linked worktree's `.git`
    // file is as much a repository as a main worktree's directory.
    expect(hasGitRepo(["/work/wt/feat"], fs("/work/wt/feat/.git"))).toBe(true);
  });

  it("is false when no folder and no ancestor holds one", () => {
    expect(hasGitRepo(["/work/plain", "/elsewhere/notes"], fs("/other/.git"))).toBe(false);
  });

  it("is true when any folder holds one", () => {
    expect(hasGitRepo(["/work/plain", "/work/repo"], fs("/work/repo/.git"))).toBe(true);
  });

  it("stops at the filesystem root rather than looping on it", () => {
    const exists = fs();
    expect(hasGitRepo(["/"], exists)).toBe(false);
    expect(exists).toHaveBeenCalledTimes(1);
  });

  it("stops asking as soon as one folder answers", () => {
    const exists = fs("/work/repo/.git");
    hasGitRepo(["/work/repo", "/work/other"], exists);
    expect(exists).toHaveBeenCalledTimes(1);
  });
});
