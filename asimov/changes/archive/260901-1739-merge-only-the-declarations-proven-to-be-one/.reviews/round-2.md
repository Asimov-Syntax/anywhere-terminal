# Review Round 2

- Date: 2026-09-01
- Cycle: 1
- Mode: superseded
- Requested lane: fastlane
- Escalation: `new-api-contract`
- Requested scope: range `55628840..061116d1`
- Head: `061116d16311cb3bb05916b083a8eb0d3826a673` (working tree dirty from generated analytics files, outside the explicit range)
- Reviewable lines: 244 production/state lines in the range
- Agents spawned: none — the verification scope lock stopped the round before specialist review
- Agents skipped: all — no witness adjudication, remediation-cone review, cumulative review, or new-issue hunt ran
- Verdict: APPROVE (administrative only; the round is superseded, not an approval of the change)
- Counts: no findings adjudicated; round-1 F001-F005 remain open and unverified
- Verify evidence: the coordinator reports check-types passing, Biome at the 3/14/1 baseline, the fs-deletion gate passing, and 6,639 tests green. Review ran no project verify command.

## Scope-lock disposition

Round 2 cannot be a verification round. The requested delta contains the accepted fixes, but it also
changes the cycle-1 approved design and task contracts:

- `design.md` adds D7, moving row-id sequence ownership from each adapter to the shared
  `ProviderBudget`, and adds a new ledger invariant that no group names one id twice.
- `design.md` adds D8, replacing the accepted contender folding construction with per-segment NFKC,
  explicit multi-character folding, and a shared Win32-name primitive.
- `tasks.md` adds section 4 with three new task contracts, including the new required `ProviderBudget`
  identity owner and a TypeScript-AST structural gate.
- `workflow.md` records the plan handback, changes `Planned at`, and records that Gate 2 was re-earned.

These are justified remediation for F001, F003, and F005, and re-earning Gate 2 correctly approves
them for implementation. It does not make the amended design, new tasks, or new invariant owner part
of cycle 1's frozen discovery gate set. Under the verification scope lock, the cycle is superseded
before any fix witness or implementation hunk is adjudicated.

## Prior gate set carried forward without adjudication

- F001 — the contender detector misses common-filesystem folds — accepted; not verified.
- F002 — standalone and switched framework offers omit contenders — accepted; not verified.
- F003 — adapter-local id collisions corrupt group membership — accepted; not verified because its remediation introduced D7 and the shared identity owner.
- F004 — the summary calls every component a pair — accepted; not verified.
- F005 — the filesystem reachability gate misses ordinary callable shapes — accepted; not verified because its remediation introduced a new AST-based gate contract.

No audit-backlog, external-blocker, or accepted-risk entries exist to carry forward.

## Route

The design delta has already re-entered planning and Gate 2 was re-earned at `417a9ce6`. The next
user-initiated review starts cycle 2 in discovery mode at global round 3 and reviews D7/D8, tasks
4_1-4_3, the cumulative implementation, and every round-1 witness as one new risk map. This
superseded round cannot be converted into verification by the current request.
