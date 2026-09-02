# Proposal: never-release-a-lock-a-pending-write-still-owns

## Why

Final review of `allocate-and-name-ports-before-they-collide` showed that `LockedFile.withLock()` can wait forever in staged creation, commit, discard, or release. Racing those mutating promises and releasing the lock is unsafe: a late link or rename could publish after serialization ended.

Node cannot cancel the relevant filesystem syscalls. This prerequisite therefore bounds the reported result while preserving serialization: a deadline that catches a mutating step in flight converts the lock into the repository's already accepted fail-closed administrative lock.

## Appetite

M (≤3d)

## Scope

### In scope

- A deadline-aware acquisition and mutation gate owned by `LockedFile`, with explicit clean-timeout and dirty-timeout states.
- Refusal to start any further target or staged-file mutation after expiry.
- Deliberate lock retention when exclusive acquisition or a protected mutation may land late, plus truthful typed reporting and host-side lock-path logging.
- Bounded result completion for lock acquisition, staged creation, commit, discard, and lock release.
- Adoption by repository-local exclude writes and port-claim publication.
- One latched deadline contract: wall-clock expiry can close early, timer expiry closes permanently, and neither can reopen the gate.

### Out of scope

- Cancelling an in-flight filesystem syscall; Node provides no safe cancellation for link, rename, open, mkdir, chmod, stat, or unlink.
- Automatic stale-lock reclamation or age-based lock stealing.
- Recovering libuv threadpool capacity consumed by an uninterruptible filesystem operation.
- Directory identity and ancestor substitution; `freeze-the-first-observed-worktree-before-writing` owns that boundary.

### Must not

- Use `Promise.race` to return and then release a lock while a mutation can still publish.
- Report an uncommitted timed-out claim as successful.
- Reuse `lockReleaseFailed` for a deliberately retained lock.
- Let a timeout between mutating steps poison the repository when no mutation was in flight.

## Risk Level

HIGH. The change owns whether a cross-process lock may be released while a filesystem mutation is still capable of landing.
