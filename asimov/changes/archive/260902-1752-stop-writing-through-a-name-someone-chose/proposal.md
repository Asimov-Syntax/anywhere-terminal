# Proposal: stop-writing-through-a-name-someone-chose

## Why

`CursorHookInstaller` stages its replacement of a user's agent configuration under a name derived
from the clock, using a call that follows a symlink — so anything able to predict that name gets a
write primitive aimed at any file the extension host's user can write. The same class keeps a second
lock implementation that deletes whatever sits at the lock's name without checking it is the lock it
took. Both are pre-existing; neither is stated anywhere.

## Appetite

S (≤1d)

## Scope

### In scope

- Staging every Cursor replacement under an unpredictable name, created exclusively, so an object
  already at that name is refused rather than written through.
- Removing Cursor's second lock implementation in favour of the shared one, so a lock this process
  cannot prove it holds is left alone.
- Recording, next to the code, the four namespace races none of the above closes — each with its
  trigger and what a user can do about it.

### Out of scope

- Post-open validation of the lock descriptor. Proposed by WT-012.21's Notes, rejected by the plan
  attack, reason recorded in design.md D4: `wx` is `O_CREAT | O_EXCL` and already refuses every
  pre-existing object, so the cmux tier that motivated it has nothing left to inspect here.
- Anchoring operations to an open directory descriptor. Node exposes no `*at` syscall (WT-012.19),
  and a native addon is closed by evidence (WT-012.21 Notes).
- Closing R2 or R3, the two pre-existing check-then-act leaf races. No pure-Node mechanism reaches
  them; they are disclosed, not fixed.
- Reclaiming a live lock by age, anywhere.
- The optimistic-concurrency retry in `CursorHookInstaller.reconcile` and its `matches` check.
- What a save REPORTS about a lock it left behind — WT-012.22 owns that and shipped it.

### Must not

- Weaken mutual exclusion to satisfy a check: a lock that cannot be validated is refused, never
  removed and retaken.
- Introduce a wall-clock or age heuristic in acquisition or release.
- Present any residual as closed, or write a requirement whose witness passes before the code exists.

## Risk Level

MEDIUM — the diff sits on the write path for user-owned configuration, and it deliberately converts
one destructive failure into a stuck one: where Cursor used to delete a replaced lock, it will now
leave it and the user's config becomes unwritable until they remove the file. That trade is R4, and
it is put to the user rather than taken by this plan.
