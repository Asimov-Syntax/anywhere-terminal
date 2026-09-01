import { describe, expect, it, vi } from "vitest";
import type { GitCommandResult, GitCommandRunner, GitRunOptions } from "./gitCommandRunner";
import { deleteBranch, type DeleteBranchEvidence } from "./deleteBranch";

const EVIDENCE: DeleteBranchEvidence = {
  branch: "feature",
  branchOid: "1".repeat(40),
  defaultBranch: "main",
  defaultOid: "2".repeat(40),
};

function result(stdout = "", code = 0): GitCommandResult {
  return {
    code,
    stdout: Buffer.from(stdout),
    stderr: code === 0 ? "" : "ref changed",
    timedOut: false,
    failedToSpawn: false,
  };
}

function runner(options: { listing?: GitCommandResult; defaultBranch?: string; transaction?: GitCommandResult } = {}) {
  const calls: Array<{ args: readonly string[]; cwd: string; options?: GitRunOptions }> = [];
  const run = vi.fn(async (args: readonly string[], cwd: string, runOptions?: GitRunOptions) => {
    calls.push({ args, cwd, options: runOptions });
    if (args[0] === "worktree") {
      return options.listing ?? result("worktree /repo\0HEAD abc\0branch refs/heads/main\0\0");
    }
    if (args[0] === "symbolic-ref") {
      return result(`origin/${options.defaultBranch ?? "main"}\n`);
    }
    if (args[0] === "config") {
      return result("", 1);
    }
    if (args[0] === "rev-parse") {
      return result("a\n");
    }
    if (args[0] === "update-ref") {
      return options.transaction ?? result();
    }
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  });
  return { calls, git: { run } as GitCommandRunner };
}

describe("deleteBranch", () => {
  it("deletes only through one transaction guarded by both recorded OIDs", async () => {
    const h = runner();

    await expect(deleteBranch(h.git, "/repo", EVIDENCE)).resolves.toEqual({ kind: "deleted", branch: "feature" });

    const transaction = h.calls.find((call) => call.args[0] === "update-ref");
    expect(transaction?.args).toEqual(["update-ref", "--stdin"]);
    expect(transaction?.options?.input).toBe(
      `start\nverify refs/heads/main ${EVIDENCE.defaultOid}\ndelete refs/heads/feature ${EVIDENCE.branchOid}\ncommit\n`,
    );
    expect(h.calls.some((call) => call.args.includes("-D") || call.args[0] === "branch")).toBe(false);
  });

  it("refuses when another worktree has the branch checked out", async () => {
    const h = runner({
      listing: result(
        "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /repo-feature\0HEAD def\0branch refs/heads/feature\0\0",
      ),
    });

    await expect(deleteBranch(h.git, "/repo", EVIDENCE)).resolves.toEqual({
      kind: "refused",
      reason: "branch-in-use",
    });
    expect(h.calls.some((call) => call.args[0] === "update-ref")).toBe(false);
  });

  it("refuses the branch that currently resolves as default", async () => {
    const h = runner({ defaultBranch: "feature" });

    await expect(deleteBranch(h.git, "/repo", EVIDENCE)).resolves.toEqual({
      kind: "refused",
      reason: "default-branch",
    });
    expect(h.calls.some((call) => call.args[0] === "update-ref")).toBe(false);
  });

  it("fails closed when the worktree listing cannot be read", async () => {
    const h = runner({ listing: result("", 1) });

    await expect(deleteBranch(h.git, "/repo", EVIDENCE)).resolves.toEqual({
      kind: "refused",
      reason: "holders-unavailable",
    });
    expect(h.calls.some((call) => call.args[0] === "update-ref")).toBe(false);
  });

  it("reports a moved ref when the verified transaction declines", async () => {
    const h = runner({ transaction: result("", 1) });

    await expect(deleteBranch(h.git, "/repo", EVIDENCE)).resolves.toEqual({
      kind: "refused",
      reason: "refs-moved",
    });
  });
});
