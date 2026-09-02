# Proposal: anchor-a-locked-write-to-the-directory-it-checked

## Why

`LockedFile` names strings for every step while serializing an inode, so a rename-plus-symlink at
the target's directory redirects the lock, the temporary, the read and the commit together. A plan
attack showed the redirections split into two kinds: the ones a locked write can OBSERVE and refuse,
and the ones only a descriptor-relative syscall could prevent. Node exposes none of the latter, so
this change takes the first kind — and three of those are live defects today, not hypotheticals: the
read follows a link at the leaf, leaf ownership compares identities that round past 2^53, and a
refused write can strand a live lock in a directory that was moved away, wedging the file for good.

## Appetite

M

## Scope

### In scope

- `LockedFile` and the one helper its read goes through. Both callers — the native config writer and
  the Claude hook installer — inherit every fix.
- The Claude hook installer's use of two `LockedFile` instances in one operation, which is what makes
  a per-operation guarantee unplaceable for it.

### Out of scope

- Making the four operations NAME the authorized directory. `docs/PLAN.md` WT-012.21 owns that, and
  its row records why no pure-Node mechanism reaches it.
- Moving `LockedFile` to `src/utils/lockedFile.ts`. Peer branch `creat-worktree-2` does that in
  `132d20ce`, 45 commits and ~7800 lines ahead with its own work unreviewed; merging to reach the
  final path would pull that into this change's review scope.

### Must not

- Claim prevention. Every checkpoint has a window after it, and between two checkpoints an
  unguarded operation can land on a decoy and be restored before the next comparison. The spec, the
  acceptance and the ledger say refusal-on-detection, and WT-012.21 owns the rest.
- Break `stageReplacement` called outside `withLock`. It is an existing supported shape with its own
  witness; a guarantee that requires a held handle must degrade there rather than throw.

## Risk Level

MEDIUM — inside the primitive both config writers depend on, so a mistake refuses ordinary saves
rather than hostile ones.
