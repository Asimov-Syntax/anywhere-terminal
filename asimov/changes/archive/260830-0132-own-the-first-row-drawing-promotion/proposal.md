# Proposal: own-the-first-row-drawing-promotion

## Why

"This window has gained its first row-drawing surface" decides whether presence is rebuilt with
enrichment — the session-derived names and previews rows draw. The concept is real and
load-bearing, and it is **spelled inline at the one site that happens to check it**. Three
consecutive fix rounds on the subscription seam each closed the case in front of them, and the
third stopped and said so: what is missing is an owner, not another branch.

Two boundaries reach the state and do not reach the promotion:

- `setDisplayed` mutates `displayed` — an input to the predicate — and reconciles showing and the
  scan, but never asks whether the window just started drawing rows. A retained rail becoming
  displayed is served the bare envelope.
- A promotion arriving *during* a rebuild joins the run in flight, which already decided not to
  enrich, and nothing schedules a follow-up. During the very first such pass the ad-hoc guard is
  suppressed outright, because the "is what we published enriched" flag starts life saying yes.

The user-visible cost is small and real: a reopened or newly displayed rail draws fallback titles
and no previews for up to one five-second scan. Nothing is wrong on screen — it is late.

## Scope

- One predicate for "the window is drawing rows against an envelope that was not enriched", owned
  in one place and used by every site that needs the answer.
- Every rising edge of `visible`, `level` and `displayed` routed through it.
- A rebuild run that cannot finish while that predicate is true, so a promotion mid-flight is
  followed by exactly one enriching pass.

## Non-goals and must-nots

- **Must not change when a window subscribes to presence.** `anyShowing`, `reconcileScan` and the
  scan cadence are untouched; this is about which boundaries are recognised as reaching the
  row-drawing state, not about arming the scan.
- **Must not make the poll pay for it.** A polled scan joins a run in flight deliberately, so that
  one projection answers it rather than two. The promotion requirement must be carried as state the
  run reconciles, not by making every joining caller dirty the run.
- **Must not admit an unbounded re-run.** One promotion owes exactly one enriching pass, and the
  loop that delivers it must be provably unable to spin.
- Not in scope: the enrichment work itself, what a row draws, or the presence-only level.

## Appetite

Small. One predicate, three call sites, one loop invariant, and the tests that reach the two
boundaries three previous rounds could not.

## Risk

The mechanism is a re-run condition inside the single-flight projection loop, which is the part of
this host the previous cycle found hardest to reason about — a wrong condition there is a
projection storm, not a late row. The mitigation is that the condition is the *same predicate* the
promotion uses and it is false as soon as one enriching pass publishes, so the second iteration
cannot re-arm it. That is asserted directly with a deferred projector rather than inferred from a
row's contents.

The opposite failure is quieter and more likely: a condition that is never true in practice, making
the fix inert and the tests green for the wrong reason. Both boundaries are therefore driven from
the outside — a surface becoming displayed, and a promotion timed to land mid-pass — and each test
fails against the current code.
