# Design: bound-the-looks-one-projection-starts

## Decisions

### D1: The projector carries an explicit budget; it does not lean on the service's cap

`worktree-subsystem-debts.md` § 2.3 already assigns this: "The preview service owns how many looks
may be outstanding at once… The projector owns how many looks a single projection starts." The
blueprint's alternative — fan every row out in one wave and let the service's own limit gate the
projection — is rejected on the doc's own terms, twice over.

First, that limit is `cap`, and `cap` is the entry cache's size. § 2.3 names the conflation as the
debt itself: "the cache cap bounds **memory**, not **work**." Borrowing it as the work bound writes
the confusion into the code instead of removing it.

Second, it does not meet the acceptance. `DEFAULT_PREVIEW_CACHE_CAP` is 256, so a window would have
to draw more than 256 agent rows before any look was refused — for every real window that is one
look per row, which is the thing being bounded.

So the projector holds a number, and the number is small: a projection is a UI refresh, and
`DEFAULT_PROJECTION_LOOK_BUDGET = 16` is already more concurrent transcript reads than a healthy
refresh needs. Under the bound nothing changes for an ordinary window, which is the property that
keeps this reviewable as hardening.

### D2: The budget is spent over all rows at once, not per worktree

`previewFromVault` walks `Object.entries(rowsByWorktreeId)` and awaits each worktree's rows before
starting the next. That shape is why the acceptance names both distributions: ten rows in one
worktree and ten rows in ten worktrees cost the same total I/O but arrive as one wave or ten.

The rows are flattened once, in a stable order, and the whole projection is one `Promise.all`. The
budget is then a property of the projection rather than of whichever worktree happens to hold the
rows, and the second acceptance clause holds by construction rather than by a second rule.

### D3: A row outside the budget is asked, not skipped

Skipping an excluded row is the one implementation that cannot satisfy "keeps its last known line":
the projector holds no previous rows to copy a line from, so a skipped row simply has no `preview`
key and draws no second line — the row loses its sentence for no reason the user can see.

`SessionPreviewService.preview` therefore takes a second argument, `mayLook`. False means *answer
from what you already hold*: the service returns the line it has and starts nothing — no vault
lookup, no resolve, no `stat`, no read, and no change to the retry ladder or the re-confirmation
stamp. The session is still touched in the LRU, because a row outside the budget is a row the window
is drawing and evicting it would lose the very line this exists to keep.

One asymmetry: a `mayLook: false` ask for a session the service has never held answers `undefined`
**without** inserting an entry. There is nothing to keep, and inserting would let an excluded row
evict a held one to store a blank.

### D4: The turn rotates, so exclusion is never permanent

A fixed budget over a stable order would let the first 16 rows refresh forever while the 17th never
did — the acceptance forbids exactly that ("re-checked on a later tick rather than dropped").

The projector keeps a cursor into the flattened row list and grants the budget to the rows starting
at it, wrapping; the cursor then advances by the budget. Every row is permitted to look within
`ceil(rows / budget)` projections.

The budget counts **permissions granted, not looks performed**. A permitted row still inside its
recheck interval answers from cache and spends its grant anyway, which makes the sweep slower than
the ideal but keeps the bound exact and the rule one sentence long. Erring that way is deliberate:
the requirement is a ceiling on work, and a scheme that re-counted its own grants could exceed it.

The cost this accepts, stated plainly: a session that appears for the first time in a window with
many rows shows no second line until its turn comes round, up to `ceil(rows / budget)` projections
later. Prioritising line-less rows would fix that and needs the projector to remember which rows had
lines last time — state it does not keep, for a case that only bites past 16 rows.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| Preview entry cache and `outstanding` | Owned and mutated only by the preview service, single-threaded in the extension host. This change adds no writer: `mayLook: false` reads, touches the LRU, and returns. n/a for crash and concurrency — nothing is persisted and there is no second host |
| The rotation cursor | A number on the projector's closure, single-owner, reset with the projector. A wrong value costs a row its turn for one projection and is self-correcting on the next; it authorises nothing |
| Transcript files on disk | Read-only, and the read is already bounded by WT-011.3's deadline. This change strictly reduces how many are opened; a failed or slow read keeps the outcomes that shipped there |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `previewFromVault` | The flattening loses the per-worktree write-back and rows land under the wrong worktree | The flattened list carries its worktree id; unit test asserts each row's preview lands on the row it belongs to |
| Budget | A row outside the budget loses its line — the regression this task exists to avoid | D3 asks with `mayLook: false` rather than skipping; unit test asserts an excluded row still draws its previously read line |
| Rotation | A row is excluded on every projection | D4's cursor; unit test drives more rows than the budget across successive projections and asserts every row is permitted within `ceil(rows / budget)` |
| `preview(id, false)` | The cache-only path starts work anyway, defeating the bound | Unit test counts vault lookups, stats and reads across a projection and asserts they stop at the budget |
| LRU | An excluded row is evicted and loses the line the bound promised to keep | D3 touches on the cache-only path; unit test asks past `cap` with a mix of permitted and excluded rows |
