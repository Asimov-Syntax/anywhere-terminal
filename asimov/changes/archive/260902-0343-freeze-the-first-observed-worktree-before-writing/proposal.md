# Proposal: freeze-the-first-observed-worktree-before-writing

## Why

Final review of `allocate-and-name-ports-before-they-collide` showed that post-create writes mint trust from whatever directory currently resolves at the requested path. A regular root replacement or substituted ancestor can therefore redirect provisioning and claim publication after Git succeeds.

Git returns no directory handle, so the exact inode it created cannot be proven. This prerequisite owns the strongest feasible boundary: freeze the first post-create/listing observation once, then fail closed if any component or leaf identity cannot be proven again.

## Appetite

M (≤3d)

## Scope

### In scope

- One platform-aware component-chain authorization shared by post-create file provisioning, port claims, and the existing Claude hook installer.
- Source and target authorizations minted immediately after successful `git worktree add`; selected file provisioning receives both, and port publication receives the target.
- First-observation sibling authorization at the fresh Git-listing boundary, normalized-path use, and identity-based self-exclusion.
- Fail-closed behavior when stable filesystem identity is unavailable, including `ino === 0`.
- Non-vacuous identity comparison in the shared staged writer and lock-release ownership checks used by this flow.

### Out of scope

- Proving the exact inode Git created; Git exposes no directory handle and path back-links re-resolve through the same substitutable ancestors.
- Eliminating the final recheck-to-syscall window; Node exposes no `openat`/dirfd traversal.
- Bounded staged mutation and retained-lock policy; `never-release-a-lock-a-pending-write-still-owns` owns that separate invariant.
- Port grammar, allocation choice, result filtering, and provider model changes.
- Agent/terminal processes launched after provisioning; this change authorizes extension-owned selected reads and writes, not filesystem activity performed later by another process.

### Must not

- Mint target authority inside a writer after the mutation seam already had the opportunity to freeze it.
- Treat zero or unavailable inode identity as comparable proof in any staged-write, lock-ownership, source-read, or destination-write check this flow relies on.
- Describe first observation as proof of the directory Git created.
- Turn a post-create authorization failure into a failed Git create.

## Risk Level

HIGH. This changes the authority carried across file writes and shared port claims; an incorrect acceptance can write outside the intended checkout or hide sibling claims.
