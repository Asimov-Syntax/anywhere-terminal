# Proposal: own-the-enrichment-an-envelope-actually-got

## Why

WT-011.7 gave the projector a fence: a projection that loses its last row-drawing surface before it
reaches preview enrichment skips that half, because no surface is left to draw what it would fetch.

The host did not learn about it. `projectedEnriched` records what the projection was ASKED for
(`WorktreeHost.ts:1239`), not what it delivered, so a pass whose preview half was skipped still marks
the envelope enriched. `enrichmentOwed()` is `anyDrawingRows() && !projectedEnriched`, so the surface
that reopens is told nothing is owed, and it draws stale or absent second lines until the next
five-second external scan.

Raised as W1 in `bound-the-looks-one-projection-starts` rounds 6 and 7 and adjudicated non-blocking
both times, with the fix deferred to its own change because both routes add information across the
projector/host seam.

## Appetite

S (≤1d)

## Scope

### In scope

- A projection whose preview enrichment was skipped not leaving the envelope recorded as enriched
- A surface reopening after such a pass being served a replacement pass rather than waiting for the
  next external scan

### Out of scope

- The fence itself, and when the projector decides to skip — shipped in WT-011.7 and owned there
- The turn queue, the look budget, and what an excluded row draws
- The five-second external scan cadence

### Must not

- Fire on a mutation that changed nothing — the host's row-drawing reconcile is deliberately a state
  settle rather than an edge check, and the naive version of this fix fired on every call while
  nothing was drawing, which moved 19 existing cases
- Request a projection from inside the falling edge; the edge records an obligation, the rise spends it

## Risk Level

LOW — one boolean the host already owns, read at one predicate. The failure it guards against is a
row drawing nothing for five seconds, not a wrong row.
