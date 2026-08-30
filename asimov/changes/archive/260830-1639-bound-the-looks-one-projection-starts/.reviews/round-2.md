# Review Round 2: bound-the-looks-one-projection-starts

**Date**: 2026-08-30
**Cycle**: 1
**Mode**: superseded
**Requested execution mode**: fastlane
**Scope**: range `317c54e7..5a6c67d5`
**Head**: `5a6c67d5bb7c5c9ac00a0a062bde5f8c97fd7ee9`
**Tree state**: `analytics.json` modified after the reviewed commit; explicit commit range unaffected
**Reviewable lines**: 319
**Agents spawned**: none — scope lock stopped the verification round before specialist review
**Agents skipped**: all — cycle superseded
**Verdict**: **SUPERSEDED**
**Counts**: not adjudicated

## Scope-lock decision

Cycle 1's gate set was frozen by round 1 discovery. The requested verification range is not remediation-only:

- `design.md` adds D5-D7, supersedes D3's `mayLook` mechanism, and replaces D4's index cursor with a persistent identity order.
- `tasks.md` adds task 2_1 with a semantically new projector/service contract: the projector declares retained membership, the service retains exactly that set, excluded rows read synchronously, and `mayLook` is removed.
- `workflow.md` records B2 as not remediation and confirms that Gate 2 was re-earned before implementation.

This is a legitimate replanning response to B2 and the other round-1 findings, but it changes accepted design and task contracts and broadens the impact cone beyond the frozen verification gate set. Under the verification scope lock, round 2 stops without reviewing or adjudicating commit `5a6c67d5`.

The design delta has already followed the required route back through Gate 2. No further routing action is needed before discovery.

## Prior state carried forward

- B1-R1, B2-R1, W1-R1, and S1-R1 remain open because their claimed fixes were not verified in this superseded round.
- Commit `5a6c67d5` and the author's impact manifest are inputs to the next discovery; none of their fix claims is accepted or rejected here.
- There are no round-1 `audit-backlog` or `risk-accepted` entries to carry forward.

The next user-initiated review starts **cycle 2, round 3, discovery mode** with a fresh risk map around D5-D7, the caller-declared retention contract, queue pruning and absent-row ordering, cache hot/cold and undeclared-caller paths, empty projection cleanup, and the full projector/service wiring seam.
