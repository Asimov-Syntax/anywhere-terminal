# Discovery: freeze-the-first-observed-worktree-before-writing

## Evidence

- Round-3 F001 replaced a worktree ancestor with a symlink to another regular tree; allocation returned success and wrote beneath the redirected ancestor.
- `git worktree add` returns an exit status, not a directory descriptor. `.git` and `gitdir` links remain path strings and cannot prove the inode Git created.
- `ClaudeHookInstaller` already freezes component identities, but its traversal is POSIX-only because that caller is disabled on Windows.
- Existing direct `dev`/`ino` comparisons accept unrelated entries when `ino === 0`; `createPath.identityOf()` already treats that state as unavailable proof.
- Sibling worktrees have no pre-existing trusted identity. The strongest feasible boundary is first observation at the fresh listing, followed by rechecks within the transaction.

## Options

| Option | Safety | Cost | Disposition |
|---|---|---|---|
| Freeze first post-create/listing observation and fail closed on unavailable identity | Detects regular replacement, symlinked ancestors, and recreated components; names residual syscall window honestly | Shared authorizer plus seam widening | Selected by user |
| Require proof of the exact inode Git created | No implementation exists with current Git/Node APIs | Feature cannot allocate | Rejected |
| Keep minting authority inside each writer | Preserves current redirect vulnerability | Smallest patch | Rejected |

## Accepted direction

The user selected **Freeze first observation** on 2026-09-02. The contract claims first-observation identity only; it never claims proof of the inode Git created.
