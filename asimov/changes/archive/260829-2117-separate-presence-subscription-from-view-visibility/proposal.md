# Proposal: separate-presence-subscription-from-view-visibility

## Why

A surface can need presence for something other than the rail. When a scope is set, its chip, its
escape control and the count carried on that control are all drawn from presence, and they stay on
screen after the rail collapses — `worktree-panel-ui.md` § 7.1, and WT-010.4's acceptance, "the
escape control survives a collapsed rail".

Today one boolean answers two different questions. `worktreeViewVisibility` says whether a surface
is showing the Worktree view, and the host reads that same value for three things at once: whether
to push tree and presence to the surface, whether to arm the 5-second external scan, and — through
the projection that scan runs — whether to do per-row title and preview enrichment. So a surface
has exactly two settings, both wrong for a collapsed scoped rail:

- report invisible, and the presence half of the hidden-waiting count freezes, contradicting
  `tab-bar-component` § "The count reads every source that can say a pane is waiting";
- report visible, and the surface keeps roughly one preview lookup and stat per live external
  session per poll alive, for a body that is drawing no rows at all.

collapse-the-rail-after-a-sidebar-selection tried the second and review rejected it (that change's
`.reviews/round-1.md` B1). The first is where the tree stands now, and review rejected that too
(its `.reviews/round-2.md` B4), because the obligation is still owed.

## Scope

A subscription level travels with the visibility message, and the host reads the level rather than
a boolean. A surface can say it is drawing rows, or that it only needs presence. Enrichment
follows the first; the scan and the pushes follow either.

## Non-goals and must-nots

- MUST NOT change what a surface showing the rail receives, costs, or renders. Every existing
  caller keeps its behaviour by construction — the level defaults to the drawing one.
- MUST NOT make the count depend on the rail. That is the defect being fixed.
- Not a rewrite of the preview service's freshness or rate policy. Enrichment is skipped when
  nobody draws rows; when somebody does, it behaves exactly as it does today. Whether the
  resolution-and-rate seam should be extracted is a separate, still-open question.
- Not a change to the external scan's 5-second cadence, nor to what the registry scan reads.

## Appetite

S. One field on one message, one branch in the projector, and the controller split that
collapse-the-rail-after-a-sidebar-selection already prototyped and reverted.

## Risk

The controller split is the part that bit last time: putting body lifecycle behind the effective
subscription value silently disarmed the `pendingCreate` cleanup (that change's round-1 B2). Here
the body work keys on the DRAWING level rather than on whether a subscription exists, and the
tasks carry a test for exactly that regression.
