# Design: own-the-first-row-drawing-promotion

## Decisions

### D1: One predicate answers "is enrichment owed", and every site asks it

The concept the subsystem is missing is not "is any surface drawing rows" — `anyDrawingRows()`
already answers that. It is the **conjunction**: rows are being drawn *and* what we published was
built without enrichment. That is the thing spelled inline today, at the one site that checks it:

```ts
if (!wasDrawing && anyDrawingRows() && !projectedEnriched) { … }
```

It becomes `enrichmentOwed()`, and it is the only place the two facts are joined. Both the
promotion trigger and the run-loop invariant (D3) read it, so there is one definition of the state
rather than one per site that cares.

Rejected: adding the missing `false → true` check at `setDisplayed`. It closes the boundary in front
of us and leaves the next mutation site to rediscover the rule — which is the exact shape of the
three rounds that led here.

### D2: The rising edge is reconciled after every mutation, not detected at each one

`reconcileRowDrawing()` runs after any change to `visible`, `level` or `displayed`, exactly as
`reconcileScan()` already does for the scan. It requests a projection when enrichment is owed.

There are three mutation sites and they are the whole set: `state.displayed` in `attach`'s
`setDisplayed`, and `state.visible` / `state.level` in the `worktreeViewVisibility` handler.
`attach` itself creates a surface with `displayed: false`, and `dispose` deletes one — neither can
produce a rising edge.

Crucially, `reconcileRowDrawing` does **not** compare against a remembered previous value. A
`wasDrawing` snapshot answers "did this call change it", which is not the question — the question is
whether the window is currently owed enrichment, and a call that changed nothing while enrichment is
owed should still request it. Dropping the edge comparison also removes the state that has to be
kept in sync at three sites.

The request stays `{ external: true, join: true }`: this re-runs the projection, it re-reads no git,
and a poll already in flight is the right thing to join.

### D3: A run cannot finish while enrichment is owed — without touching what dirty already means

The promotion trigger alone cannot fix the mid-flight boundary. A caller arriving during a run and
passing `join: true` gets the run's promise back **without dirtying it** — deliberately, because a
polled scan must not buy a second projection to answer what the first is already doing. So a
promotion that lands mid-pass joins a run that has already decided not to enrich, and nothing
follows it.

Rather than making `join` dirty the run (which would make every poll pay), the requirement is
carried where the run can see it. But `projectionDirty` is **already carrying two meanings** at that
point in the loop — "this pass was invalidated, so it applied nothing" (which gates the pane-evidence
acknowledgement) and "run again" — and `nextExternalOnly` carries a third: whether the rerun may skip
the panes. Overloading them is where this goes wrong:

- Setting `projectionDirty = true` for enrichment *before* the acknowledgement guard makes a clean
  full pass look invalidated, so `paneEvidenceApplied` never advances and every later scan runs full
  for no reason.
- Setting `nextExternalOnly = true` when the pass was *already* dirty overrides the stronger
  requirement a pane-evidence arrival established — the rerun would skip exactly the panes it exists
  to read.

So the pass's own invalidation state is captured first, and the enrichment obligation is only
allowed to schedule anything when the pass was otherwise **clean**:

```
await projectOnce(externalOnly)
wasInvalidated = projectionDirty          ← captured BEFORE enrichment touches it
acknowledge pane evidence on wasInvalidated, exactly as today
if (!wasInvalidated && enrichmentOwed())  → projectionDirty = true, nextExternalOnly = true
```

An already-invalidated pass needs no help: its rerun happens regardless and re-reads
`anyDrawingRows()` for itself at the top of `projectOnce`, so the obligation is discharged by that
rerun at its own — possibly full — mode.

**It cannot spin.** The enriching pass sets `projectedEnriched = true`, making `enrichmentOwed()`
false; re-arming it needs a fresh bare pass, which only happens once rows are no longer drawn. The
bound is **one promotion-caused follow-up**, not one pass in total: an unrelated rebuild invalidating
the tree adds iterations of its own, and the `treeVersion !== at` early return does not create a
spin — that pass sets nothing, and the rerun it forces re-reads the predicate and clears the
obligation on success.

This also retires the flag-initialization problem for free. `projectedEnriched` starts life `true`,
which suppressed the inline check during the very first bare pass; the loop invariant reads the flag
only *after* a pass has set it, so the initial value stops being load-bearing. It is left as-is
rather than flipped — changing it would be a second, redundant guard against a case this decision
already closes.

### D4: Subscription is untouched

`anyShowing`, `reconcileScan` and the five-second cadence are not read or changed by this work. The
debt is about which boundaries are recognised as reaching the row-drawing state; when a window
subscribes to presence is a different question with its own shipped answer.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| The single-flight projection run | Owned by `requestProjection`, which is already the only entry. This change adds a re-run condition inside the run's own loop — it starts no second run and takes no new lock. Concurrency is unchanged: callers still join |
| The published presence envelope | Written only by `projectOnce` under the existing tree-version check. A pass that raced a rebuild still publishes nothing; the new condition is evaluated after that check and cannot resurrect a stale envelope |
| The five-second scan timer | n/a — not read or written here (D4) |
| A throw inside the extra pass | The run's existing `catch` covers every iteration: it logs and publishes nothing. An enriching pass that throws leaves the bare envelope standing and the window late, which is the pre-change state — it does not clear rows |
| Two windows | Each host instance holds its own surfaces and its own run; there is no shared state between windows and nothing on disk |

## Interfaces

```ts
// src/providers/WorktreeHost.ts — file-local, not exported

/**
 * Is this window drawing rows against an envelope built without enrichment?
 * The ONE join of those two facts (D1).
 */
function enrichmentOwed(): boolean;

/** Request the enriching pass when one is owed. Called after every mutation of
 *  `visible`, `level` or `displayed` (D2). */
function reconcileRowDrawing(): void;
```

## Risk map

| Risk | Mitigation |
|---|---|
| The re-run condition spins | D3 — the enriching pass makes the predicate false, and a deferred-projector test counts one promotion-caused follow-up rather than asserting a row's contents |
| Enrichment silently breaks the pane-evidence bookkeeping | D3 — the acknowledgement runs on the pass's own captured invalidation state, and a test proves the scan after a promotion stays external-only rather than reverting to full |
| Enrichment downgrades a rerun that pane evidence requires to be full | D3 — the obligation schedules nothing when the pass was already dirty; asserted by racing a promotion against new pane evidence |
| The fix is inert because the boundaries are unreachable from outside | Each boundary is driven the way a user reaches it — a surface becoming displayed, and a promotion timed to land mid-pass — and each test is confirmed to fail against the current code before the fix |
| A polled scan starts paying for a second projection | D3 keeps `join` non-dirtying; the requirement lives in the run, not in the caller. The existing single-flight test already stands as that evidence and is left unmodified |
| The scan's arming changes as a side effect | D4 — `reconcileScan` is untouched, and the existing scan tests stand unmodified as the evidence |
