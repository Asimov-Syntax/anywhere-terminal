# Review round 2

- Date: 2026-08-31
- Cycle: 1
- Mode: superseded
- Requested mode: verification
- Scope: `dd3f1db0219c8ad3467eef7eebf0247640a783ef..2e46d2091708b15901efdf2298844e1bdd4ff560`
- Head: `2e46d2091708b15901efdf2298844e1bdd4ff560`
- Tree: dirty only from review accounting (`analytics.json`)
- Reviewable lines: 423
- Agents spawned: none — scope lock stopped the round before specialist dispatch
- Agents skipped: all six specialist lenses — verification scope was superseded
- Verdict: REJECT
- Counts: 6 prior accepted BLOCKs not adjudicated; 0 new findings

## Supersession signal

The remediation range semantically changes accepted design and task contracts:

- D4 now defines failed-read retry semantics and changes when the one-read marker is released.
- D5 is rewritten from offer-only retirement to retirement across every channel carried by the opening token, including the existing debris-authorization boundary and panel-side liveness.
- Tasks 4_1, 4_2, and 4_3 add new accepted obligations and implementation work for those decisions.

This is exactly the verification scope-lock trigger: semantically changed design/tasks in the delta. The coordinator also records that this was a handback that reopened Gate 2. The change does not claim a new invariant owner, so extraction is not required; the design delta routes through Gate 2 and then back to review.

## Prior gate set

Round-1 findings B1-B6 were all accepted. Their fixes and the additional cross-repository late-publish fix were not reviewed in this superseded round, so none is marked fixed here. They remain the inherited risk inventory for the next discovery round.

## Next review

The next user-initiated review is global round 3, cycle 2, in discovery mode. It must review the newly accepted D4/D5/tasks contract and the complete implementation/integration seam, including the wire-contract lens that did not return in round 1. Global round numbering continues; it does not reset with the cycle.
