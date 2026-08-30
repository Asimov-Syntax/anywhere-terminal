# Proposal: bound-the-looks-one-projection-starts

## Why

WT-011.3 bounded how long one transcript look may take and how many may be outstanding at once. It
could not bound how many a single projection starts: the projector enriches one worktree's rows and
awaits them before beginning the next, so the service's concurrency limit is never reached and every
row on screen still costs a look. A window with many agent rows therefore does bounded-size
bookkeeping over an unbounded amount of I/O — the half of the § 2.3 debt WT-011.3 deliberately left
to this task.

## Appetite

S (≤1d)

## Scope

### In scope

- A ceiling on how many sessions one projection permits to look at their transcripts
- That ceiling holding regardless of how the rows are distributed across worktrees
- Rows above the ceiling keeping the line they last read, and getting their turn on a later
  projection

### Out of scope

- How long one look may take, and how many may be outstanding at once — both shipped in WT-011.3 and
  owned by the preview service
- The re-confirmation interval and the conclusive-absence rule shipped in WT-011.5
- The title enrichment pass beside this one, which reads the vault rather than the filesystem and
  has its own per-window memo
- Any change to what a row draws when it does have a line

### Must not

- Reuse the entry cache's `cap` as the work bound — § 2.3 names that conflation as the debt
- Drop a row's `preview` key to stay under the bound
- Let a row be excluded on every projection
- Start a vault lookup, a resolve, a `stat` or a read for a row the bound excluded

## Risk Level

LOW — one enrichment pass, one new argument on an internal service method, and a strictly smaller
amount of I/O than today. The failure it guards against is a slow window, not a wrong row.
