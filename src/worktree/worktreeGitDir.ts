// src/worktree/worktreeGitDir.ts — Where git keeps a worktree's own metadata.
//
// `.git/worktrees/<name>` holds the files git writes about one linked worktree:
// the `locked` marker `worktree lock` creates (worktree-removal.md § 4.1), and
// the provisioning manifest this extension writes beside it (worktree-apply.md
// § 2.6). Both readers want the same directory, so it is resolved once.

/** The runner shape both callers already hold. */
export type GitDirRun = (
  args: readonly string[],
  cwd: string,
  runOptions?: { timeoutMs?: number; maxBufferBytes?: number },
) => Promise<{ code: number; stdout: Buffer; timedOut: boolean }>;

/**
 * The worktree's own git directory, as git reports it from inside the worktree.
 *
 * Asked of git rather than derived as `<repoGitDir>/worktrees/<basename>`: git
 * disambiguates colliding directory names, so that derivation is wrong exactly
 * where two worktrees share a basename — and silently, by naming a real
 * directory belonging to the other one.
 *
 * Throws rather than returning an empty string on failure. An empty path joined
 * onto a filename is a relative path into whatever this process's directory
 * happens to be, which is a read of the wrong file rather than a failed read.
 */
export async function readWorktreeGitDir(worktreePath: string, run: GitDirRun): Promise<string> {
  const result = await run(["rev-parse", "--absolute-git-dir"], worktreePath);
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`git rev-parse --absolute-git-dir exited ${result.code}`);
  }
  const dir = result.stdout.toString("utf8").trim();
  if (dir.length === 0) {
    throw new Error("git named no git dir for this worktree");
  }
  return dir;
}
