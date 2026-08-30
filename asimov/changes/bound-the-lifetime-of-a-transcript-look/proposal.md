# Proposal: bound-the-lifetime-of-a-transcript-look

## Why

The worktree panel's session preview issues `stat` and `read` against the user's disk with no time
bound. A stalled network mount or a sleeping external volume holds a look's slot indefinitely, and
because concurrent askers share the in-flight promise, that row is wedged for the life of the window
rather than for one cadence tick. The cache cap makes this worse rather than better: it bounds how
many sessions are held, not how much filesystem work they provoke, so a window with more rows than
the cap starts a fresh operation against the same hung path every tick.

## Appetite

M (≤3d)

## Scope

### In scope

- A time bound on a transcript look, covering resolution as well as the read
- Deciding what a timed-out look *means*: no progress, back off, keep the last known line
- A bound on outstanding filesystem work that survives cache eviction

### Out of scope

- Cancelling the abandoned operation — neither `fs.stat` nor the tail reader takes an `AbortSignal`
  on this path; the look is abandoned, not stopped (design.md D3)
- Retiring a preview whose vault entry was deleted — WT-011.5, which depends on this task precisely
  because both change how a failed look is classified
- The recheck cadence itself, the LRU cap's value, and every other reader that touches these stores

### Must not

- Surface a timeout to the user as an error state on the row
- Blank a row because its transcript was slow rather than unreadable
- Add a fourth `Target` kind — DESIGN.md § 12 fixes a timeout as `unresolved`
- Retry into a hang: a session with an outstanding look starts no second one

## Risk Level

MEDIUM — the change is confined to one service, but it rewrites the settlement bookkeeping every row's
preview depends on, and the failure mode it guards against (an abandoned operation writing to state
the row has moved past) is one tests reach only through injected stalls.
