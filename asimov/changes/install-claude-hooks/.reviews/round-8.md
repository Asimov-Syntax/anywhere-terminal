# Review Round 8: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 3
**Mode**: superseded
**Scope**: range `4d60df0..6d923451560074a8abc5f89c3daca8f33d090a84`
**Head**: `6d923451560074a8abc5f89c3daca8f33d090a84`
**Tree state**: analytics files dirty at review start; explicit commit range unaffected
**Reviewable lines**: 332
**Agents spawned**: none — scope lock stopped verification before specialist review
**Agents skipped**: all — cycle superseded
**Verdict**: **SUPERSEDED**
**Counts**: not adjudicated

## Scope-lock decision

Cycle 3's gate set was frozen by round 7 discovery against D1–D15. The requested verification range is not remediation-only: commit `435d911` adds D16 and semantically amends D15 by moving the ownership ledger from `globalStorageUri` to the fixed per-user path `~/.anywhere-terminal/agent-hooks-ledger.json`, tightening reads to per-operation snapshots, distinguishing durable pre-write records from session-only post-write fallback, and redefining the session/store ceiling merge. Tasks 7_1–7_5 formalize that replanned architecture before the implementation commits.

That planning handback is appropriate for B9, but D16 changes accepted storage, ownership, concurrency, failure, and lifecycle obligations that round 7 never reviewed. Under the verification scope lock, round 8 cannot adjudicate the implementation or the impact manifest. The cycle is superseded rather than failed, and no specialist or chair implementation review was performed.

## Prior state carried forward

- Open gating findings awaiting fresh discovery against D16 and the full fix impact cone: B5, B6, B9, B10, B11, B12, and B13.
- Open warning awaiting fresh discovery: W6.
- Previously verified fixed: B8, W5, and audit-backlog A1.
- No rebuttals and no user-granted risk acceptances were recorded.
- The claimed fixes and the two additional defects found by fix tests remain unadjudicated by this round.

The next user-initiated review starts **cycle 4, round 9, discovery mode** over the whole change. It must build a fresh risk map around D16's fixed per-user ledger location, first-run directory creation, per-operation refresh and lock ordering, durable pre-write failure, bounded session/store merge, transition coalescing, Windows executable qualification and termination outcome, and no-op replacement behavior.
