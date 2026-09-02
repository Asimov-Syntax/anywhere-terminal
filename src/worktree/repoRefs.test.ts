import { describe, expect, it } from "vitest";
import type { GitCommandResult, GitCommandRunner, GitRunOptions } from "./gitCommandRunner";
import { MAX_REFS, type RepoRefsWorktree, readRepoRefs } from "./repoRefs";

interface RunCall {
  args: readonly string[];
  cwd: string;
  options?: GitRunOptions;
}

function ok(stdout: string): GitCommandResult {
  return { code: 0, stdout: Buffer.from(stdout, "utf8"), stderr: "", timedOut: false, failedToSpawn: false };
}

/**
 * git's `%(objectname) %(refname:short)` output, from names alone.
 *
 * The fixtures name branches; the tip is what the format now also carries, and
 * writing it out at every call site would bury the case each test is making.
 */
function listing(...names: readonly string[]): GitCommandResult {
  return ok(names.map((name) => (name.length === 0 ? "" : `oid-${name} ${name}`)).join("\n") + "\n");
}

function failed(overrides: Partial<GitCommandResult> = {}): GitCommandResult {
  return {
    code: 128,
    stdout: Buffer.alloc(0),
    stderr: "fatal: not a git repository",
    timedOut: false,
    failedToSpawn: false,
    ...overrides,
  };
}

function runnerOf(result: GitCommandResult): { runner: GitCommandRunner; calls: RunCall[] } {
  const calls: RunCall[] = [];
  return {
    calls,
    runner: {
      run(args, cwd, options) {
        calls.push({ args, cwd, options });
        return Promise.resolve(result);
      },
    },
  };
}

function linked(displayPath: string, branch?: string): RepoRefsWorktree {
  return { displayPath, bare: false, detached: branch === undefined, ...(branch === undefined ? {} : { branch }) };
}

describe("readRepoRefs", () => {
  it("names each local branch git reported", async () => {
    const { runner } = runnerOf(listing("main", "feat/search", "fix/lock"));

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(read.ok).toBe(true);
    expect(read.ok === true && read.refs.map((r) => r.name)).toEqual(["main", "feat/search", "fix/lock"]);
    expect(read.ok === true && read.truncated).toBe(false);
  });

  it("asks git to do the bounding, one over the cap so a full page is distinguishable", async () => {
    const { runner, calls } = runnerOf(ok(""));

    await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "for-each-ref",
      "--format=%(objectname) %(refname:short)",
      `--count=${MAX_REFS + 1}`,
      "refs/heads/",
    ]);
    expect(calls[0]?.cwd).toBe("/repo");
  });

  it("caps the list and says it is partial", async () => {
    const names = Array.from({ length: MAX_REFS + 1 }, (_, i) => `branch-${i}`);
    const { runner } = runnerOf(listing(...names));

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(read.ok === true && read.refs).toHaveLength(MAX_REFS);
    expect(read.ok === true && read.truncated).toBe(true);
  });

  it("a list exactly at the cap is complete, not partial", async () => {
    const names = Array.from({ length: MAX_REFS }, (_, i) => `branch-${i}`);
    const { runner } = runnerOf(listing(...names));

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(read.ok === true && read.refs).toHaveLength(MAX_REFS);
    expect(read.ok === true && read.truncated).toBe(false);
  });

  it("a repository with no branches answers an empty list, not a failure", async () => {
    const { runner } = runnerOf(ok(""));

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(read).toEqual({ ok: true, refs: [], truncated: false });
  });

  const failures: readonly [string, GitCommandResult][] = [
    ["a non-zero exit", failed()],
    ["a timeout", failed({ code: -1, timedOut: true })],
    ["a git that would not spawn", failed({ code: -1, failedToSpawn: true })],
    ["a buffer overflow that killed the child", failed({ code: -1, stderr: "stdout maxBuffer length exceeded" })],
  ];

  it.each(failures)("%s is a failed read, never an empty repository", async (_label, result) => {
    const { runner } = runnerOf(result);

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(read).toEqual({ ok: false });
  });

  it("marks a branch another worktree holds with that directory's name", async () => {
    const { runner } = runnerOf(listing("main", "feat/search"));

    const read = await readRepoRefs(runner, {
      cwd: "/repo",
      worktrees: [linked("/repo", "main"), linked("/wt/search-spike", "feat/search")],
    });

    expect(read.ok === true && read.refs).toEqual([
      { name: "main", oid: "oid-main", heldBy: "repo" },
      { name: "feat/search", oid: "oid-feat/search", heldBy: "search-spike" },
    ]);
  });

  it("names the directory only, never the path that holds it", async () => {
    const { runner } = runnerOf(listing("feat/search"));

    const read = await readRepoRefs(runner, {
      cwd: "/repo",
      worktrees: [linked("/Users/someone/deep/nested/search-spike", "feat/search")],
    });

    const held = read.ok === true ? read.refs[0]?.heldBy : undefined;
    expect(held).toBe("search-spike");
    expect(held).not.toContain("/");
  });

  it("a branch no worktree holds carries no holder", async () => {
    const { runner } = runnerOf(listing("main", "idle"));

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [linked("/repo", "main")] });

    expect(read.ok === true && read.refs[1]).toEqual({ name: "idle", oid: "oid-idle" });
  });

  it("a detached or bare worktree holds nothing", async () => {
    const { runner } = runnerOf(listing("main"));

    const read = await readRepoRefs(runner, {
      cwd: "/repo",
      worktrees: [linked("/wt/detached"), { displayPath: "/repo/bare", bare: true, detached: false, branch: "main" }],
    });

    expect(read.ok === true && read.refs).toEqual([{ name: "main", oid: "oid-main" }]);
  });

  // `detached` is the authority, not the presence of `branch`: a listing that
  // carries both is detached, and marking `main` held there would block the one
  // branch nothing is holding.
  it("a detached worktree still naming a branch holds nothing", async () => {
    const { runner } = runnerOf(listing("main"));

    const read = await readRepoRefs(runner, {
      cwd: "/repo",
      worktrees: [{ displayPath: "/wt/spike", bare: false, detached: true, branch: "main" }],
    });

    expect(read.ok === true && read.refs).toEqual([{ name: "main", oid: "oid-main" }]);
  });

  // git permits one worktree per branch, so a second is a listing that raced.
  it("two worktrees claiming one branch resolve to the first, not the last", async () => {
    const { runner } = runnerOf(listing("main"));

    const read = await readRepoRefs(runner, {
      cwd: "/repo",
      worktrees: [linked("/repo", "main"), linked("/wt/stale-copy", "main")],
    });

    expect(read.ok === true && read.refs[0]?.heldBy).toBe("repo");
  });

  // The format is two columns now, so a line with no separator is not a short
  // line missing its tip — it is a line this reader cannot attribute. Dropping
  // it is what stops an empty name or an empty tip reaching a caller that
  // compares against one and passes.
  it("a line carrying no tip is not a branch", async () => {
    const { runner } = runnerOf(ok("oid-main main\nfeat/no-tip\n"));

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(read.ok === true && read.refs).toEqual([{ name: "main", oid: "oid-main" }]);
  });

  it("carries the tip git reported beside the name", async () => {
    const { runner } = runnerOf(ok("deadbeef main\n"));

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(read.ok === true && read.refs[0]?.oid).toBe("deadbeef");
  });

  it("blank lines in git's output are not branches", async () => {
    const { runner } = runnerOf(listing("main", "", "feat/search"));

    const read = await readRepoRefs(runner, { cwd: "/repo", worktrees: [] });

    expect(read.ok === true && read.refs.map((r) => r.name)).toEqual(["main", "feat/search"]);
  });
});
