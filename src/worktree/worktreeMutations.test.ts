import { describe, expect, it, vi } from "vitest";
import type { GitCommandResult, GitRunOptions } from "./gitCommandRunner";
import {
  branchNameIsValid,
  classifyRemoval,
  createWorktree,
  lockWorktree,
  prunablePaths,
  pruneRepo,
  REMOVE_TIMEOUT_MS,
  type RemovalJournal,
  removeWorktree,
  repairWorktree,
  unlockWorktree,
  worktreeHeadOid,
} from "./worktreeMutations";

function ok(stdout = ""): GitCommandResult {
  return { code: 0, stdout: Buffer.from(stdout), stderr: "", timedOut: false, failedToSpawn: false };
}

/** A zero-exit result whose report lands on stderr, as git's prune does. */
function onStderr(stderr: string): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr, timedOut: false, failedToSpawn: false };
}

function fail(stderr: string): GitCommandResult {
  return { code: 1, stdout: Buffer.alloc(0), stderr, timedOut: false, failedToSpawn: false };
}

function runner(result: GitCommandResult = ok()) {
  // Typed parameters, so `run.mock.calls[n][i]` is a real tuple rather than `[]`.
  const run = vi.fn(async (_args: readonly string[], _cwd: string, _opts?: GitRunOptions) => result);
  return { run, runner: { run } };
}

describe("lockWorktree", () => {
  it("passes the worktree path and the reason as separate argv tokens", async () => {
    const { run, runner: r } = runner();
    await lockWorktree(r, { repoPath: "/repo", worktreePath: "/repo/wt-a", reason: "release build" });
    expect(run).toHaveBeenCalledWith(["worktree", "lock", "--reason", "release build", "/repo/wt-a"], "/repo");
  });

  it("omits --reason entirely when none was given", async () => {
    const { run, runner: r } = runner();
    await lockWorktree(r, { repoPath: "/repo", worktreePath: "/repo/wt-a", reason: undefined });
    expect(run).toHaveBeenCalledWith(["worktree", "lock", "/repo/wt-a"], "/repo");
  });

  it("refuses a reason that would read as a flag", async () => {
    // One bounded argv token is not enough on its own: git still parses a
    // leading dash as an option, so `--reason` with a `-`-prefixed value would
    // become a different command than the user asked for.
    const { run, runner: r } = runner();
    const result = await lockWorktree(r, { repoPath: "/repo", worktreePath: "/repo/wt-a", reason: "--force" });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a worktree path that would read as a flag", async () => {
    const { run, runner: r } = runner();
    const result = await lockWorktree(r, { repoPath: "/repo", worktreePath: "-oops", reason: undefined });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("surfaces git's own stderr rather than replacing it", async () => {
    // worktree-rpc.md § 5: git's messages are the most useful thing we can show.
    const { runner: r } = runner(fail("fatal: '/repo/wt-a' is already locked"));
    const result = await lockWorktree(r, { repoPath: "/repo", worktreePath: "/repo/wt-a", reason: undefined });
    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain("already locked");
  });
});

describe("unlockWorktree", () => {
  it("builds the unlock argv", async () => {
    const { run, runner: r } = runner();
    await unlockWorktree(r, { repoPath: "/repo", worktreePath: "/repo/wt-a" });
    expect(run).toHaveBeenCalledWith(["worktree", "unlock", "/repo/wt-a"], "/repo");
  });
});

describe("pruneRepo", () => {
  it("counts what would be dropped without dropping it", async () => {
    // The confirmation has to name the count BEFORE the user agrees, so the
    // count comes from a dry run, not from the prune itself.
    //
    // On STDERR: this originally asserted stdout, and the integration test
    // against real git proved that wrong — every count came back 0.
    const { run, runner: r } = runner(
      onStderr(
        "Removing worktrees/a: gitdir file points to non-existent location\nRemoving worktrees/b: gitdir file points to non-existent location\n",
      ),
    );
    const count = await pruneRepo.countPrunable(r, "/repo");
    expect(run).toHaveBeenCalledWith(["worktree", "prune", "--dry-run", "--verbose"], "/repo");
    expect(count).toEqual({ ok: true, count: 2 });
  });

  it("counts nothing when there is nothing prunable", async () => {
    const { runner: r } = runner(ok(""));
    expect(await pruneRepo.countPrunable(r, "/repo")).toEqual({ ok: true, count: 0 });
  });

  it("does not report a dry run it could not complete as a count of zero", async () => {
    const { runner: r } = runner(fail("fatal: not a git repository\n"));
    expect(await pruneRepo.countPrunable(r, "/repo")).toEqual({ ok: false });
  });

  it("does not report a timed-out dry run as a count of zero", async () => {
    const { runner: r } = runner({
      code: 0,
      stdout: Buffer.alloc(0),
      stderr: "Removing worktrees/a: gitdir file points to non-existent location\n",
      timedOut: true,
      failedToSpawn: false,
    });
    expect(await pruneRepo.countPrunable(r, "/repo")).toEqual({ ok: false });
  });

  it("runs the real prune with no --dry-run", async () => {
    const { run, runner: r } = runner();
    await pruneRepo.run(r, "/repo");
    expect(run).toHaveBeenCalledWith(["worktree", "prune"], "/repo");
  });

  it("reports a prune that git refused", async () => {
    const { runner: r } = runner(fail("fatal: not a git repository"));
    expect(await pruneRepo.run(r, "/repo")).toMatchObject({ ok: false });
  });
});

// ── Host routing ─────────────────────────────────────────────────────────
// The verbs above are pure; these prove the host actually reaches them, which
// is the failure mode WORKTREE_MESSAGE_TYPES exists to catch: declared, posted,
// handled, and reaching neither provider.

// ── Removal (design.md D5, D11) ──────────────────────────────────────────

const JOURNAL: RemovalJournal = { worktreePath: "/repo/wt-a", wasRegistered: true, existedOnDisk: true };

function req(over: Partial<Parameters<typeof removeWorktree>[1]> = {}) {
  return { repoPath: "/repo", worktreePath: "/repo/wt-a", force: false, locked: false, ...over };
}

describe("removeWorktree", () => {
  it("is unforced by default", async () => {
    const { run, runner: r } = runner();
    await removeWorktree(r, req());
    expect(run).toHaveBeenCalledWith(["worktree", "remove", "/repo/wt-a"], "/repo", expect.anything());
  });

  it("carries its own longer budget, not the listing's", async () => {
    const { run, runner: r } = runner();
    await removeWorktree(r, req());
    expect(run.mock.calls[0]?.[2]).toMatchObject({ timeoutMs: REMOVE_TIMEOUT_MS });
  });

  it("forces once for an unlocked target", async () => {
    const { run, runner: r } = runner();
    await removeWorktree(r, req({ force: true }));
    expect(run.mock.calls[0]?.[0]).toEqual(["worktree", "remove", "--force", "/repo/wt-a"]);
  });

  it("needs the doubled flag for a locked target", async () => {
    // A single --force does not override a lock, so the documented
    // "confirm past a lock" path fails outright without the second.
    const { run, runner: r } = runner();
    await removeWorktree(r, req({ force: true, locked: true }));
    expect(run.mock.calls[0]?.[0]).toEqual(["worktree", "remove", "--force", "--force", "/repo/wt-a"]);
  });

  it("does not double the flag when the removal is unforced", async () => {
    const { run, runner: r } = runner();
    await removeWorktree(r, req({ force: false, locked: true }));
    expect(run.mock.calls[0]?.[0]).toEqual(["worktree", "remove", "/repo/wt-a"]);
  });
});

describe("classifyRemoval", () => {
  const gone = { isRegistered: false, existsOnDisk: false };
  const intact = { isRegistered: true, existsOnDisk: true };

  it("reports ok when the worktree is actually gone", () => {
    expect(
      classifyRemoval({ journal: JOURNAL, timedOut: false, result: { ok: true, stdout: "" }, after: gone }),
    ).toMatchObject({ outcome: "ok" });
  });

  it("reports indeterminate for a timeout even though nothing appears to have changed", () => {
    // THE false negative: a forced removal killed after deleting half the tree
    // leaves the directory AND the registration in place, so the coarse
    // comparison agrees and would report a clean error over real data loss.
    const result = classifyRemoval({
      journal: JOURNAL,
      timedOut: true,
      result: { ok: false, message: "killed" },
      after: intact,
    });
    expect(result.outcome).toBe("indeterminate");
  });

  it("reports indeterminate when the repository could not be listed afterwards", () => {
    const result = classifyRemoval({
      journal: JOURNAL,
      timedOut: false,
      result: { ok: true, stdout: "" },
      after: null,
    });
    expect(result.outcome).toBe("indeterminate");
  });

  it("reports indeterminate when git claimed success but the worktree is still there", () => {
    const result = classifyRemoval({
      journal: JOURNAL,
      timedOut: false,
      result: { ok: true, stdout: "" },
      after: intact,
    });
    expect(result.outcome).toBe("indeterminate");
  });

  it("reports indeterminate when git errored but the directory went anyway", () => {
    const result = classifyRemoval({
      journal: JOURNAL,
      timedOut: false,
      result: { ok: false, message: "fatal: something" },
      after: { isRegistered: true, existsOnDisk: false },
    });
    expect(result.outcome).toBe("indeterminate");
  });

  it("reports a clean error only when nothing moved", () => {
    const result = classifyRemoval({
      journal: JOURNAL,
      timedOut: false,
      result: { ok: false, message: "fatal: contains modified or untracked files" },
      after: intact,
    });
    expect(result).toMatchObject({ outcome: "error" });
  });
});

describe("createWorktree", () => {
  const base = { repoPath: "/repo", worktreePath: "/trees/feat" };

  it("creates a new branch at the path", async () => {
    const { run, runner: r } = runner();
    await createWorktree(r, { ...base, source: { kind: "newBranch", branch: "feat" } });
    expect(run.mock.calls[0]?.[0]).toEqual(["worktree", "add", "-b", "feat", "/trees/feat"]);
  });

  it("passes a base ref as its own trailing token", async () => {
    const { run, runner: r } = runner();
    await createWorktree(r, { ...base, source: { kind: "newBranch", branch: "feat", baseRef: "origin/main" } });
    expect(run.mock.calls[0]?.[0]).toEqual(["worktree", "add", "-b", "feat", "/trees/feat", "origin/main"]);
  });

  it("checks out an existing branch without -b", async () => {
    const { run, runner: r } = runner();
    await createWorktree(r, { ...base, source: { kind: "existingBranch", branch: "feat" } });
    expect(run.mock.calls[0]?.[0]).toEqual(["worktree", "add", "/trees/feat", "feat"]);
  });

  it("detaches at a ref", async () => {
    const { run, runner: r } = runner();
    await createWorktree(r, { ...base, source: { kind: "detached", ref: "abc123" } });
    expect(run.mock.calls[0]?.[0]).toEqual(["worktree", "add", "--detach", "/trees/feat", "abc123"]);
  });

  it("never passes --force, so git's own refusal reaches the user", async () => {
    const { run, runner: r } = runner(fail("fatal: 'feat' is already checked out at '/trees/other'"));
    const result = await createWorktree(r, { ...base, source: { kind: "existingBranch", branch: "feat" } });
    expect(run.mock.calls[0]?.[0]).not.toContain("--force");
    expect((result as { message: string }).message).toContain("already checked out");
  });

  it("refuses a ref that would read as a flag", async () => {
    const { run, runner: r } = runner();
    const result = await createWorktree(r, { ...base, source: { kind: "detached", ref: "--upload-pack=evil" } });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a branch name that would read as a flag", async () => {
    const { run, runner: r } = runner();
    const result = await createWorktree(r, { ...base, source: { kind: "newBranch", branch: "-b" } });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("branchNameIsValid — git judges the name (round-4 W9)", () => {
  it("asks git rather than reimplementing check-ref-format", async () => {
    const { run, runner: r } = runner(ok());
    expect(await branchNameIsValid(r, "/repo", "feat/ok")).toBe(true);
    expect(run).toHaveBeenCalledWith(["check-ref-format", "--branch", "feat/ok"], "/repo");
  });

  it("takes git's refusal as a refusal", async () => {
    const { runner: r } = runner(fail("fatal: 'feat..bad' is not a valid branch name"));
    expect(await branchNameIsValid(r, "/repo", "feat..bad")).toBe(false);
  });

  it("refuses a name argv would read as a flag without asking", async () => {
    const { run, runner: r } = runner(ok());
    expect(await branchNameIsValid(r, "/repo", "--force")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not turn an unanswerable question into a refusal", async () => {
    // A git we could not run says nothing about the name. The create proceeds
    // and git refuses it directly, which is the behaviour that already shipped.
    const { runner: r } = runner({
      code: 1,
      stdout: Buffer.alloc(0),
      stderr: "",
      timedOut: true,
      failedToSpawn: false,
    });
    expect(await branchNameIsValid(r, "/repo", "feat/ok")).toBeNull();
  });
});

describe("repairWorktree", () => {
  it("issues `worktree repair` against the path, and never `worktree add`", async () => {
    const { run, runner: r } = runner();
    await repairWorktree(r, { repoPath: "/repo", worktreePath: "/repo/wt-a" });
    expect(run).toHaveBeenCalledWith(["worktree", "repair", "/repo/wt-a"], "/repo");
    expect(run.mock.calls.map((c) => c[0][1])).not.toContain("add");
  });

  it("never adds --force, because a repair git refuses is a refusal to surface", async () => {
    const { run, runner: r } = runner();
    await repairWorktree(r, { repoPath: "/repo", worktreePath: "/repo/wt-a" });
    expect(run.mock.calls[0][0]).not.toContain("--force");
  });

  it("refuses a path that reads as an option, without running anything", async () => {
    const { run, runner: r } = runner();
    const result = await repairWorktree(r, { repoPath: "/repo", worktreePath: "--git-dir=/evil" });
    expect(result).toMatchObject({ ok: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("surfaces git's own fatal line when the repair fails", async () => {
    const { runner: r } = runner(fail("Preparing…\nfatal: not a valid path"));
    expect(await repairWorktree(r, { repoPath: "/repo", worktreePath: "/repo/wt-a" })).toMatchObject({
      ok: false,
      message: "fatal: not a valid path",
    });
  });
});

describe("worktreeHeadOid", () => {
  it("asks the DIRECTORY, not the repository, and trims what git prints", async () => {
    const { run, runner: r } = runner(ok("abc123\n"));
    expect(await worktreeHeadOid(r, "/repo/wt-a")).toBe("abc123");
    expect(run).toHaveBeenCalledWith(["rev-parse", "HEAD"], "/repo/wt-a");
  });

  it("answers undefined when git refused, rather than an empty oid", async () => {
    const { runner: r } = runner(fail("fatal: not a git repository"));
    expect(await worktreeHeadOid(r, "/repo/wt-a")).toBeUndefined();
  });

  it("answers undefined when git exited 0 but printed nothing", async () => {
    // An empty string is not an oid, and returning one would let a comparison
    // against an equally empty expectation pass.
    const { runner: r } = runner(ok("  \n"));
    expect(await worktreeHeadOid(r, "/repo/wt-a")).toBeUndefined();
  });
});

describe("prunablePaths", () => {
  it("names only the registrations git still reports as prunable", async () => {
    const { run, runner: r } = runner(
      ok(
        [
          "worktree /repo",
          "HEAD aaa",
          "branch refs/heads/main",
          "",
          "worktree /repo/wt-stale",
          "HEAD bbb",
          "branch refs/heads/feat",
          "prunable gitdir file points to non-existent location",
          "",
        ].join("\n"),
      ),
    );
    expect(await prunablePaths(r, "/repo")).toEqual({ ok: true, paths: ["/repo/wt-stale"] });
    expect(run).toHaveBeenCalledWith(["worktree", "list", "--porcelain"], "/repo");
  });

  it("answers not-ok when the listing failed, which is not the same as none", async () => {
    const { runner: r } = runner(fail("fatal: no repo"));
    expect(await prunablePaths(r, "/repo")).toEqual({ ok: false });
  });
});
