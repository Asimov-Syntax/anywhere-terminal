import { describe, expect, it } from "vitest";
import { readWorktreeGitDir } from "./worktreeGitDir";

const OK = (stdout: string) => async () => ({ code: 0, stdout: Buffer.from(stdout), timedOut: false });

describe("readWorktreeGitDir", () => {
  it("asks git, from inside the worktree, and trims what it answers", async () => {
    // The command has to run IN the worktree: `--absolute-git-dir` reports the
    // git dir of wherever it is asked, and asking the repo root would answer
    // with the main worktree's every time.
    const calls: { args: readonly string[]; cwd: string }[] = [];
    const dir = await readWorktreeGitDir("/repo/wt-a", async (args, cwd) => {
      calls.push({ args, cwd });
      return { code: 0, stdout: Buffer.from("/repo/.git/worktrees/wt-a\n"), timedOut: false };
    });

    expect(dir).toBe("/repo/.git/worktrees/wt-a");
    expect(calls).toEqual([{ args: ["rev-parse", "--absolute-git-dir"], cwd: "/repo/wt-a" }]);
  });

  it("throws on a non-zero exit rather than answering with an empty path", async () => {
    // An empty string joined onto a filename is a relative path into whatever
    // the process's own directory happens to be — a read of the wrong file, not
    // a failed read.
    await expect(
      readWorktreeGitDir("/repo/wt-a", async () => ({ code: 128, stdout: Buffer.from(""), timedOut: false })),
    ).rejects.toThrow();
  });

  it("throws on a timeout even when the exit code says nothing went wrong", async () => {
    await expect(
      readWorktreeGitDir("/repo/wt-a", async () => ({ code: 0, stdout: Buffer.from(""), timedOut: true })),
    ).rejects.toThrow();
  });

  it("throws when git succeeds but names nothing", async () => {
    await expect(readWorktreeGitDir("/repo/wt-a", OK("  \n"))).rejects.toThrow();
  });
});
