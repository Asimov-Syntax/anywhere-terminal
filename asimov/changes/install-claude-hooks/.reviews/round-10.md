# Review Round 10: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 4
**Mode**: superseded
**Scope**: range `9f2b2e086c240356f8fa3311ea57bc3f88483b31..3ff5a147f827855022e7a7664d0e3287928f6b08`
**Head**: `3ff5a147f827855022e7a7664d0e3287928f6b08`
**Tree state**: analytics metadata dirty at review start; explicit commit range unaffected
**Reviewable lines**: 606 implementation lines in the requested range; not reviewed after the scope lock fired
**Agents spawned**: none — scope lock stopped verification before specialist review
**Agents skipped**: all — cycle superseded
**Verdict**: **SUPERSEDED**
**Counts**: not adjudicated

## Scope-lock decision

Cycle 4's gate set was frozen by round 9 discovery against D1–D16 and the then-current ledger model. The requested verification range is not remediation-only: commit `86126b7` adds D17–D19 and semantically replaces the storage and lifecycle premises behind three accepted blockers before their implementation fixes.

The amendments are material architecture, not task-completion metadata:

- **D17** replaces `destination` + `commands` + `pending` with durable `(canonical path, exact command)` write reservations, moves the structural ceiling from collections to reservation admission, and constrains session-only fallback to state updates on an existing reservation.
- **D18** introduces per-installation claims, a new installation identity persisted in `globalState`, last-claim cleanup semantics, and an uninstall-all exception that clears every claim.
- **D19** changes ownership from command-only to path-plus-command, introduces one-time bootstrap materialization, and defines migration into legacy unresolved obligations with candidate commands and distinct clearing rules.

These decisions change accepted storage schema, identity, ownership, bounding, migration, activation ordering, cleanup eligibility, and failure behavior. Round 9 did not review those premises, so round 10 cannot verify their implementation or the supplied impact manifest without turning a verification round into a new architecture discovery. The fact that the amendment landed before the fix commits and was motivated by accepted blockers makes the planning handback appropriate, but it does not make the new contract part of round 9's frozen gate set.

No implementation finding was verified, closed, reopened, or added in this round. No project verify command or targeted probe was run.

## Prior state carried forward

The seven round-9 blockers remain accepted and unadjudicated against D17–D19 and their claimed fixes:

- **B10** — session/store folding bypasses the pending ceiling
- **B12** — probe can settle before termination outcome
- **B14** — singular destination loses prior or parallel configurations
- **B15** — location-only edits submit without force
- **B16** — ledger-read failures escape typed outcomes and wedge transitions
- **B17** — command eviction makes pending configurations unrecognizable
- **B18** — wrapper replacement bypasses the shared-file lock

There are no rebuttals and no user-granted risk acceptances. The reported gate on `3ff5a14`, RED evidence, impact manifest, capacity reservation behavior, prepared obligations, unresolved-record policy, and `globalState` scope assumption remain claims for the next discovery round to verify, not evidence adjudicated here.

The next user-initiated review starts **cycle 5, round 11, discovery mode** over the whole change and D17–D19's full impact cone. It must carry the seven findings above forward and close or persist each on fresh evidence.
