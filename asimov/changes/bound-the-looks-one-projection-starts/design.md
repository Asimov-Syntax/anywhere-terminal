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

> **Superseded in part by D5 and D6 (round-1 B2/W1).** The reasoning below stands — an excluded row
> must be answered rather than skipped — but the `mayLook` argument it introduced does not survive:
> the answer is a synchronous peek, and retention is by membership rather than by recency. The
> paragraph on touching the LRU is kept only to show what D5 replaces.


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

> **Mechanism corrected by D7 (round-1 B1).** The rule below is unchanged and was never the defect:
> a cursor into a list whose length changes is not a position in any stable order.


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

### D5: The drawn set is the retention set

> **Superseded by D8 (round-3 B2).** Exact retention is withdrawn: keeping the declared set exact
> across the look timeout needs the exclusion order, the `preview()` finalizer and the
> generation-mismatch return path to agree, and that lifecycle cost buys a promise the spec no longer
> makes. `cap` returns as the only retention rule. Kept to show what D8 replaces.


`held` is bounded by `cap` and evicts the least recently asked. Its own comment says why: *"The
projector holds no alive set to evict by, so the bound has to be the service's own."* That premise
died with D2 — the projector now flattens every drawn row on every projection, so an exact alive set
exists and is recomputed each time.

Past `cap` drawn rows the approximate bound is actively wrong: a permitted look inserts, evicts the
least recently asked, and the row that loses its slot is one whose line the projection was about to
read back (round-1 B2). D3 promised that row would keep its line; touching cannot save it, because no
amount of reordering lets an LRU of size `cap` hold more than `cap` lines.

So the projector declares the set — `retain(entryIds)`, once per projection, before asking — and the
service keeps exactly it: everything outside is dropped, and nothing inside is evicted. `cap` stays
as the fallback for a caller that never declares one, which is what keeps the service usable on its
own.

**Why this is not "a second store for preview text."** The alternative the review named — retaining
lines beside the look-state LRU — mints a second lifetime to keep in sync, which is the shape § 2.5
already cost us once. This instead replaces an approximate eviction rule with an exact one and adds
no store at all. The growth axis it accepts is honest and already paid: the retained set is bounded
by the rows the projector is drawing, and the projector holds a whole `WorktreeAgentRow` for each of
them — a `Held` is strictly smaller than the row that provoked it.

`outstanding` keeps its own limit. That one bounds concurrent WORK and belongs to WT-011.3; only the
retention rule moves here.

### D6: An excluded row is answered synchronously

With retention settled by membership, an excluded row needs no ask at all — only the line the service
already holds. `line(entryId)` returns it synchronously.

That removes `mayLook`, which D3 introduced: nothing else passed `false`, and the touch it performed
was bookkeeping for the LRU rule D5 replaces. It also answers round-1 W1 — `Promise.all` over every
drawn row allocated an async invocation per row whether or not it could look, so a 1000-row
projection started 1000 promises to permit 16. The projection now awaits only the permitted rows and
reads the rest straight out of the map.

### D7: Rotation is a queue over row identity, not a cursor over indices

> **Superseded by D9 (round-3 B1).** Rotation over identity is right; retaining a place across an
> absence is not implementable. Kept to show what D9 replaces.


D4's rule was right and its mechanism was not. `previewCursor % asked.length` is an index into a list
whose membership changes between projections, so the modulus silently remaps: budget 1 over `[A,B,C]`
grants A then B, and a projection drawing `[A,C]` computes `2 % 2 = 0` and grants A again — leaving
the cursor where the next `[A,B,C]` grants B, forever, while C is never reached (round-1 B1).

The order becomes an insertion-ordered set of entry ids held across projections. Each projection adds
ids that are newly drawn, removes ids no longer drawn, grants the budget to the ids at the front, and
moves exactly those to the back. A row that stays drawn rises to the front as others are served; a row
that leaves and returns re-enters as an arrival. There is no arithmetic to desynchronise, because the
position is the identity's own place in the queue.

This is the same ordered set `retain` declares, so D5 and D7 share one structure rather than keeping
two views of "what is drawn" in step.

### D8: `cap` is the retention rule, and the spec says so

D5 replaced an approximate eviction rule with an exact one, and the exactness did not survive contact
with the look timeout. `held` is not the only place a line lives: an abandoned look keeps its entry in
`outstanding` (WT-011.3, deliberately — see the map's comment), `preview` recovers that entry with
`held.get(id) ?? outstanding.get(id)`, and `touch` seats it back into `held`. So a session dropped from
the declared set returns through the ordinary ask path carrying the line it had before, and the
declared set is exact only for as long as nothing times out (round-3 B2).

Making it true again means ordering exclusion against the timeout, invalidating the in-flight attempt's
commit, clearing `line` and `stamp` on exclusion, and returning the retained line rather than the
outcome's on a generation mismatch. Four interacting rules, to keep a promise that matters only past
`cap` drawn rows.

So `retain` goes, and with it `drawn` and the conditional in `touch`. `cap` bounds `held` again,
unconditionally. What keeps the excluded row's line is that `line(entryId)` **touches**: every drawn
row is either asked or read on every projection, so the least recently touched entries are the ones the
window has stopped drawing, and those are the right victims. Below `cap` drawn rows — every real window
— retention is exact as a consequence rather than as a rule.

Past `cap` drawn rows a line can be lost, and the spec now says that: "the line the preview service
still holds for it". That is a narrower promise than D3 made, and it is the honest one — the row
re-looks on a later projection and recovers.

This also retires round-3 W1 and shrinks S1's cone: with nothing declared, there is no declaration to
make on the row-mode falling edge, and the service's lifetime is again its own.

### D9: The turn queue holds the current drawn set, and only it

D7's queue kept a departed id's place so that a row drawn every other projection would not re-enter
behind the row being served. That is the right instinct and it cannot be paid for. A queue that
remembers absent identities must be bounded, a bounded queue must eventually forget one, and a
forgotten id is indistinguishable from an arrival on its return — so fairness across absence is not
decidable with bounded state against unbounded identity churn. Both attempts proved it from opposite
ends: dropping absent ids starves the intermittently drawn row, and privileging never-served ids
starves the continuously drawn one (`[A,X1]`, `[A,X2]`, … grants each new `Xn` and never returns to
`A`).

The queue therefore holds exactly what is drawn now. Each projection removes ids that are not drawn,
appends ids that are newly drawn, grants the budget to the front, and moves exactly those to the back.

Fairness follows structurally: nothing is ever inserted **ahead** of an id already in the queue —
arrivals append, and grants move to the back. So for a row drawn on every projection the count of ids
ahead of it never grows, and shrinks by up to `budget` each projection; it reaches the front within
`ceil(position / budget)` projections. That is the spec's bound, and it is the one the queue can
actually keep.

A row that stops being drawn re-enters as an arrival. The spec says so rather than the code implying
it.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| Preview entry cache and `outstanding` | Owned and mutated only by the preview service, single-threaded in the extension host. This change adds no writer: `line` reads, touches the LRU, and returns. n/a for crash and concurrency — nothing is persisted and there is no second host |
| The rotation queue | An insertion-ordered set on the projector's closure, single-owner, reset with the projector, holding exactly the ids drawn now (D9). A wrong entry costs a row its turn for one projection; it authorises nothing |
| Transcript files on disk | Read-only, and the read is already bounded by WT-011.3's deadline. This change strictly reduces how many are opened; a failed or slow read keeps the outcomes that shipped there |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `previewFromVault` | The flattening loses the per-worktree write-back and rows land under the wrong worktree | The flattened list carries its worktree id; unit test asserts each row's preview lands on the row it belongs to |
| Budget | A row outside the budget loses its line — the regression this task exists to avoid | D3 asks with `mayLook: false` rather than skipping; unit test asserts an excluded row still draws its previously read line |
| Rotation | A row is excluded on every projection, including across changing membership | D7's queue; unit tests drive successive projections with rows appearing and disappearing, and with the set shrinking and growing again, asserting every persistently drawn row is permitted |
| Retention | A drawn row loses the line the bound promised to keep | D8 — `line` touches, so every drawn row is touched every projection and the LRU's victims are rows the window stopped drawing; unit test draws `cap` rows across a full rotation and asserts none loses its line. Past `cap` the spec permits the loss and the row re-looks |
| Rotation across absence | A row that leaves and returns is starved | Not promised, by D9 — it re-enters as an arrival. Unit test asserts it is granted rather than dropped, without claiming it keeps a place |
| `preview(id, false)` | The cache-only path starts work anyway, defeating the bound | Unit test counts vault lookups, stats and reads across a projection and asserts they stop at the budget |
| LRU | An excluded row is evicted and loses the line the bound promised to keep | D8 touches on the synchronous read; unit test asks past `cap` with a mix of permitted and excluded rows |
