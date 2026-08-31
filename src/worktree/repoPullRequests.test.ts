import { describe, expect, it } from "vitest";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import { MAX_PULL_REQUESTS, readPullRequests } from "./repoPullRequests";

interface RunCall {
  args: readonly string[];
  cwd: string;
}

function ok(stdout: string): GitCommandResult {
  return { code: 0, stdout: Buffer.from(stdout, "utf8"), stderr: "", timedOut: false, failedToSpawn: false };
}

function runnerOf(result: GitCommandResult): { runner: GitCommandRunner; calls: RunCall[] } {
  const calls: RunCall[] = [];
  return {
    calls,
    runner: {
      run(args, cwd) {
        calls.push({ args, cwd });
        return Promise.resolve(result);
      },
    },
  };
}

/** One row in the shape `gh pr list --json` answers. */
function row(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    title: `pull request ${number}`,
    headRefName: `feature-${number}`,
    baseRefName: "main",
    isCrossRepository: false,
    headRepositoryOwner: { login: "acme" },
    ...over,
  };
}

describe("readPullRequests", () => {
  it("names each open pull request the forge reported", async () => {
    const { runner } = runnerOf(ok(JSON.stringify([row(12), row(7)])));

    const read = await readPullRequests(runner, { cwd: "/repo" });

    expect(read.ok).toBe(true);
    expect(read.ok === true && read.pullRequests.map((p) => p.number)).toEqual([12, 7]);
    expect(read.ok === true && read.pullRequests[0]?.baseRefName).toBe("main");
    expect(read.ok === true && read.truncated).toBe(false);
  });

  it("asks the forge to do the bounding, one over the cap so a full page is distinguishable", async () => {
    // Same rule as `readRepoRefs`: a list of exactly MAX is ambiguous unless one
    // more was asked for, and an unbounded ask is what turns a busy repository
    // into a payload nothing downstream is sized for.
    const { runner, calls } = runnerOf(ok("[]"));

    await readPullRequests(runner, { cwd: "/repo" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "pr",
      "list",
      "--state=open",
      "--json=number,title,headRefName,baseRefName,isCrossRepository,headRepositoryOwner",
      `--limit=${MAX_PULL_REQUESTS + 1}`,
    ]);
    // Resolved from the checkout rather than from a repository name we assemble.
    expect(calls[0]?.cwd).toBe("/repo");
  });

  it("caps the list and says it is partial", async () => {
    const rows = Array.from({ length: MAX_PULL_REQUESTS + 1 }, (_, i) => row(i + 1));
    const { runner } = runnerOf(ok(JSON.stringify(rows)));

    const read = await readPullRequests(runner, { cwd: "/repo" });

    expect(read.ok === true && read.pullRequests).toHaveLength(MAX_PULL_REQUESTS);
    expect(read.ok === true && read.truncated).toBe(true);
  });

  it("reports a fork head with the owner that will be configured", async () => {
    const { runner } = runnerOf(
      ok(JSON.stringify([row(3, { isCrossRepository: true, headRepositoryOwner: { login: "contributor" } })])),
    );

    const read = await readPullRequests(runner, { cwd: "/repo" });

    expect(read.ok === true && read.pullRequests[0]?.fromFork).toBe(true);
    expect(read.ok === true && read.pullRequests[0]?.headOwner).toBe("contributor");
  });

  it("does not call a same-repository head a fork", async () => {
    const { runner } = runnerOf(ok(JSON.stringify([row(4)])));

    const read = await readPullRequests(runner, { cwd: "/repo" });

    expect(read.ok === true && read.pullRequests[0]?.fromFork).toBe(false);
  });

  // ── Every failure is ONE state (design.md D1, D3) ──
  //
  // The distinctions below are real and are kept for the log, but the caller
  // gets one answer: the form renders one quiet row and the create is never
  // gated on any of it. A test per mode is what stops a later refactor
  // "improving" one of them into a thrown error or an empty list.

  it("answers unavailable where the client is not installed", async () => {
    const { runner } = runnerOf({
      code: -1,
      stdout: Buffer.alloc(0),
      stderr: "spawn gh ENOENT",
      timedOut: false,
      failedToSpawn: true,
    });

    expect((await readPullRequests(runner, { cwd: "/repo" })).ok).toBe(false);
  });

  it("answers unavailable where the forge refused the call", async () => {
    const { runner } = runnerOf({
      code: 1,
      stdout: Buffer.alloc(0),
      stderr: "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable",
      timedOut: false,
      failedToSpawn: false,
    });

    expect((await readPullRequests(runner, { cwd: "/repo" })).ok).toBe(false);
  });

  it("answers unavailable where the call timed out", async () => {
    const { runner } = runnerOf({
      code: -1,
      stdout: Buffer.alloc(0),
      stderr: "",
      timedOut: true,
      failedToSpawn: false,
    });

    expect((await readPullRequests(runner, { cwd: "/repo" })).ok).toBe(false);
  });

  it("answers unavailable where the output is not JSON", async () => {
    // A zero exit is not a promise of parseable output — an updated client can
    // print a notice on stdout. Throwing here would take the refs answer down
    // with it, since both reads are started from one handler.
    const { runner } = runnerOf(ok("A new release of gh is available!"));

    expect((await readPullRequests(runner, { cwd: "/repo" })).ok).toBe(false);
  });

  it("answers unavailable where the JSON is not a list of pull requests", async () => {
    const { runner } = runnerOf(ok(JSON.stringify({ message: "Not Found" })));

    expect((await readPullRequests(runner, { cwd: "/repo" })).ok).toBe(false);
  });

  it("drops a row missing the fields a selection needs, and keeps the rest", async () => {
    // A row with no number cannot mint `pr/<number>`, and one with no base
    // cannot answer what the create would branch from. Dropping the row keeps
    // the rest of the list usable; rendering it would offer a create that
    // cannot resolve.
    const { runner } = runnerOf(ok(JSON.stringify([row(5), { title: "no number" }, row(6, { baseRefName: "" })])));

    const read = await readPullRequests(runner, { cwd: "/repo" });

    expect(read.ok === true && read.pullRequests.map((p) => p.number)).toEqual([5]);
  });
});
