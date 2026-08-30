# Review Round 5: bound-the-looks-one-projection-starts

**Date**: 2026-08-30
**Cycle**: 3
**Mode**: superseded
**Requested execution mode**: fastlane
**Scope**: range `e3ca7673..9e11a56b`
**Head**: `9e11a56b7a14e83e995140e16a64bf18ff5cd372` (working tree dirty outside the reviewed range: change analytics plus unrelated WT-011.9 source/tests and change artifacts)
**Reviewable lines**: 85
**Agents spawned**: none — scope lock stopped the round before specialist review
**Agents skipped**: all — verification scope was superseded
**Verdict**: **SUPERSEDED**
**Counts**: 0 BLOCK, 0 WARN, 0 SUGGEST adjudicated

## Scope-lock decision

Round 4 froze cycle 3's accepted obligations at D1, D2, D8 and D9. The range for this proposed verification round adds new accepted design decisions D10 and D11 plus task 4_1. D10 assigns the previously unowned row-drawing falling edge, adds a projector lifecycle seam, and introduces a generation-fencing contract between `WorktreeHost` and `PresenceProjector`. D11 changes the shared preview capability contract. These are semantically changed design/task obligations, and D10 establishes lifecycle ownership that the round-4 plan explicitly did not own.

That trips the verification scope lock. The range is not remediation under cycle 3's frozen gate set, so this round stops without reviewing either implementation or the two accepted findings.

## Prior state carried forward

- **B1-R4**: accepted in round 4. The range claims to address it under new D10, but this superseded round does not verify closure.
- **S1-R3**: accepted and still open at round 4. The range claims to address it under new D11, but this superseded round does not verify closure.
- No `audit-backlog` or `risk-accepted` entries require carry-forward.

## Routing

The design delta must re-enter planning at Gate 2. The next user-initiated review starts **cycle 4, round 6, discovery mode**, reviewing the integration of D10/D11 and task 4_1 across the full requested range. It must independently review the generation fence, every row-drawing falling edge, optional-projector behavior, detach/dispose, the grouped preview capability, and the cast-through test stubs named in the impact manifest.

## Verification evidence

The caller reports type check, 5,539 unit tests, I10, both esbuild bundles, and `biome check src` at the 0-error/14-warning baseline green, with four D10 mutations killed. Per review policy and because the scope lock stopped this round, no verify command, test, lint, or bundle was rerun and none of that evidence was adjudicated here.
