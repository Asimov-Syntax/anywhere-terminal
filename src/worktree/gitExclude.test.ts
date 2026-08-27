import { describe, expect, it, vi } from "vitest";
import { addToGitExclude, excludePatternFor, type GitExcludeDeps } from "./gitExclude";

function fakeFs(initial: Record<string, string> = {}) {
  const files = { ...initial };
  const deps: GitExcludeDeps = {
    readFile: async (p) => {
      if (!(p in files)) {
        throw new Error("ENOENT");
      }
      return files[p] as string;
    },
    writeFile: vi.fn(async (p: string, data: string) => {
      files[p] = data;
    }),
    mkdir: vi.fn(async () => {}),
  };
  return { deps, files };
}

const EXCLUDE = "/repo/.git/info/exclude";

describe("addToGitExclude", () => {
  it("writes the entry when the file does not exist yet", async () => {
    const { deps, files } = fakeFs();
    expect(await addToGitExclude("/repo/.git", ".claude/worktrees/", deps)).toEqual({ added: true });
    expect(files[EXCLUDE]).toBe(".claude/worktrees/\n");
    expect(deps.mkdir).toHaveBeenCalled();
  });

  it("appends without disturbing what is already there", async () => {
    const { deps, files } = fakeFs({ [EXCLUDE]: "# user entries\n*.log\n" });
    await addToGitExclude("/repo/.git", ".claude/worktrees/", deps);
    expect(files[EXCLUDE]).toBe("# user entries\n*.log\n.claude/worktrees/\n");
  });

  it("adds a separating newline when the file does not end with one", async () => {
    const { deps, files } = fakeFs({ [EXCLUDE]: "*.log" });
    await addToGitExclude("/repo/.git", ".claude/worktrees/", deps);
    expect(files[EXCLUDE]).toBe("*.log\n.claude/worktrees/\n");
  });

  it("does not write a second time for the same root", async () => {
    // The entry is per ROOT, not per worktree: repeated creates under one root
    // must not grow the file.
    const { deps } = fakeFs({ [EXCLUDE]: ".claude/worktrees/\n" });
    expect(await addToGitExclude("/repo/.git", ".claude/worktrees/", deps)).toEqual({ added: false });
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("matches an existing entry that carries surrounding whitespace", async () => {
    const { deps } = fakeFs({ [EXCLUDE]: "  .claude/worktrees/  \n" });
    expect(await addToGitExclude("/repo/.git", ".claude/worktrees/", deps)).toEqual({ added: false });
  });

  it("reports a write failure instead of throwing, so the create still stands", async () => {
    const { deps } = fakeFs();
    deps.writeFile = async () => {
      throw new Error("EACCES: permission denied");
    };
    const result = await addToGitExclude("/repo/.git", ".claude/worktrees/", deps);
    expect(result).toMatchObject({ failed: expect.stringContaining("EACCES") });
  });
});

describe("the entry is a pattern git can actually match", () => {
  // Round-3 B10. Two defects shared one line: the entry was an ABSOLUTE path,
  // which `info/exclude` never matches, so D8 had silently never worked; and it
  // was written verbatim, so a path carrying a newline appended extra rules.

  it("anchors to the repository root rather than matching a name at any depth", () => {
    // Unanchored, `wt` would also hide `src/wt` and every other `wt` in the repo.
    expect(excludePatternFor("wt/feat")).toBe("/wt/feat/");
  });

  it("closes with a slash, so it cannot match a FILE of the same name", () => {
    expect(excludePatternFor("trees")).toBe("/trees/");
  });

  it("escapes git's own pattern characters, because the path is user input", () => {
    expect(excludePatternFor("wt/a*b?c[d]")).toBe("/wt/a\\*b\\?c\\[d\\]/");
  });

  it("tolerates a relative path that already carries slashes at either end", () => {
    expect(excludePatternFor("/wt/feat/")).toBe("/wt/feat/");
  });

  it("refuses an entry spanning more than one line instead of writing part of it", async () => {
    // The injection itself: a create path of `…/x\n*` would otherwise write `*`
    // as its own rule and hide every untracked file in the repository.
    const { deps, files } = fakeFs({ "/repo/.git/info/exclude": "node_modules\n" });
    const outcome = await addToGitExclude("/repo/.git", "/wt/x\n*", deps);

    expect(outcome).toEqual({ failed: "an exclude entry must be a single line" });
    expect(files["/repo/.git/info/exclude"]).toBe("node_modules\n");
  });

  it("still writes an ordinary single-line entry", async () => {
    const { deps, files } = fakeFs({ "/repo/.git/info/exclude": "node_modules\n" });
    const outcome = await addToGitExclude("/repo/.git", excludePatternFor("wt/feat"), deps);

    expect(outcome).toEqual({ added: true });
    expect(files["/repo/.git/info/exclude"]).toBe("node_modules\n/wt/feat/\n");
  });
});

describe("excludePatternFor — separators are separators (round-4 B10)", () => {
  it("uses git's separator for a path that arrived with Windows ones", () => {
    // Git reads `info/exclude` patterns as `/`-delimited on every platform, so
    // an escaped backslash produced a pattern matching nothing at all.
    expect(excludePatternFor("trees\\feature")).toBe("/trees/feature/");
  });

  it("still escapes what git would read as a wildcard", () => {
    expect(excludePatternFor("trees/re[l]ease*")).toBe("/trees/re\\[l\\]ease\\*/");
  });

  it("leaves an ordinary posix path alone", () => {
    expect(excludePatternFor("trees/feature")).toBe("/trees/feature/");
  });
});
