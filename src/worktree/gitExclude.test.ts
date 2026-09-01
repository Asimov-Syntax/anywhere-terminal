import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LockedFile } from "../utils/lockedFile";
import { addToGitExclude, excludePatternFor, type GitExcludeDeps } from "./gitExclude";

const tempDirectories: string[] = [];

async function fixture(initial?: string): Promise<{ gitDir: string; excludePath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "git-exclude-"));
  tempDirectories.push(directory);
  const gitDir = path.join(directory, ".git");
  const excludePath = path.join(gitDir, "info", "exclude");
  if (initial !== undefined) {
    await new LockedFile(excludePath).atomicReplace(initial, undefined);
  }
  return { gitDir, excludePath };
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("addToGitExclude", () => {
  it("writes the entry when the file does not exist yet", async () => {
    const { gitDir, excludePath } = await fixture();
    expect(await addToGitExclude(gitDir, ".claude/worktrees/")).toEqual({ added: true });
    expect(await readFile(excludePath, "utf8")).toBe(".claude/worktrees/\n");
  });

  it("appends without disturbing what is already there", async () => {
    const { gitDir, excludePath } = await fixture("# user entries\n*.log\n");
    await addToGitExclude(gitDir, ".claude/worktrees/");
    expect(await readFile(excludePath, "utf8")).toBe("# user entries\n*.log\n.claude/worktrees/\n");
  });

  it("adds a separating newline when the file does not end with one", async () => {
    const { gitDir, excludePath } = await fixture("*.log");
    await addToGitExclude(gitDir, ".claude/worktrees/");
    expect(await readFile(excludePath, "utf8")).toBe("*.log\n.claude/worktrees/\n");
  });

  it("does not write a second time for the same root", async () => {
    const { gitDir, excludePath } = await fixture(".claude/worktrees/\n");
    expect(await addToGitExclude(gitDir, ".claude/worktrees/")).toEqual({ added: false });
    expect(await readFile(excludePath, "utf8")).toBe(".claude/worktrees/\n");
  });

  it("matches an existing entry that carries surrounding whitespace", async () => {
    const { gitDir } = await fixture("  .claude/worktrees/  \n");
    expect(await addToGitExclude(gitDir, ".claude/worktrees/")).toEqual({ added: false });
  });

  it("serializes concurrent additions so neither rule is lost", async () => {
    const { gitDir, excludePath } = await fixture("*.log\n");
    class DelayedLockedFile extends LockedFile {
      public override async atomicReplace(contents: string, mode: number | undefined): Promise<boolean> {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return super.atomicReplace(contents, mode);
      }
    }
    const deps: GitExcludeDeps = {
      lockedFile: (target) => new DelayedLockedFile(target),
      mode: async () => undefined,
    };

    await Promise.all([
      addToGitExclude(gitDir, "/trees/", deps),
      addToGitExclude(gitDir, "/.env.worktree", deps),
    ]);

    expect((await readFile(excludePath, "utf8")).split("\n")).toEqual([
      "*.log",
      "/trees/",
      "/.env.worktree",
      "",
    ]);
  });

  it("reports a non-ENOENT read failure without replacing the file", async () => {
    let replaced = false;
    const deps: GitExcludeDeps = {
      mode: async () => undefined,
      lockedFile: () => ({
        withLock: async (work) => work(),
        readText: async () => {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
        atomicReplace: async () => {
          replaced = true;
          return true;
        },
      }),
    };

    const result = await addToGitExclude("/repo/.git", "/.env.worktree", deps);
    expect(result).toMatchObject({ failed: expect.stringContaining("permission denied") });
    expect(replaced).toBe(false);
  });

  it("reports a failed atomic publication instead of claiming the rule was added", async () => {
    const deps: GitExcludeDeps = {
      mode: async () => undefined,
      lockedFile: () => ({
        withLock: async (work) => work(),
        readText: async () => "*.log\n",
        atomicReplace: async () => false,
      }),
    };

    expect(await addToGitExclude("/repo/.git", "/.env.worktree", deps)).toEqual({
      failed: "the repository-local exclude file could not be updated",
    });
  });
});

describe("the entry is a pattern git can actually match", () => {
  it("anchors to the repository root rather than matching a name at any depth", () => {
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

  it("refuses an entry spanning more than one line", async () => {
    const { gitDir, excludePath } = await fixture("node_modules\n");
    expect(await addToGitExclude(gitDir, "/wt/x\n*")).toEqual({
      failed: "an exclude entry must be a single line",
    });
    expect(await readFile(excludePath, "utf8")).toBe("node_modules\n");
  });

  it("writes the literal file pattern without turning it into a directory", async () => {
    const { gitDir, excludePath } = await fixture("node_modules\n");
    expect(await addToGitExclude(gitDir, "/.env.worktree")).toEqual({ added: true });
    expect(await readFile(excludePath, "utf8")).toBe("node_modules\n/.env.worktree\n");
  });
});

describe("excludePatternFor — separators are separators", () => {
  it("uses git's separator for a path that arrived with Windows ones", () => {
    expect(excludePatternFor("trees\\feature")).toBe("/trees/feature/");
  });

  it("still escapes what git would read as a wildcard", () => {
    expect(excludePatternFor("trees/re[l]ease*")).toBe("/trees/re\\[l\\]ease\\*/");
  });

  it("leaves an ordinary posix path alone", () => {
    expect(excludePatternFor("trees/feature")).toBe("/trees/feature/");
  });
});
