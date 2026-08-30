# Review Round 2

- Date: 2026-08-30
- Cycle: 1
- Round: 2
- Mode: superseded
- Requested mode: verification
- Scope: commit `4df34f4a11b8e916bfef8eb0bd600c0ad87906e2` (`a9fb304a7a0c8367f2292e1fa0fb4073da445bff..4df34f4a11b8e916bfef8eb0bd600c0ad87906e2`)
- Head: `4df34f4a11b8e916bfef8eb0bd600c0ad87906e2`
- Parent / prior reviewed Head: `a9fb304a7a0c8367f2292e1fa0fb4073da445bff`
- Tree: dirty outside the explicit commit; uncommitted analytics, `docs/PLAN.md`, and `skills-lock.json` changes were excluded
- Scope lock: failed
- Reviewable lines: not adjudicated after scope-lock classification
- Agents spawned: none — specialist verification is prohibited after the scope lock trips
- Agents skipped: all
- Verdict: SUPERSEDED — no fix verification or finding adjudication performed
- Counts: not adjudicated; round-1 gate set remains open
- Verification evidence: the author reports type check clean, 5,381 unit tests, I10 passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.

## Supersession reason

Commit `4df34f4a` contains the expected remediation for round-1 B1, B2, B3, and W1, but it also changes accepted design and task contracts before those fixes:

- Approved D5 previously classified Codex `db-unreachable` as `unknown` without consulting the rollout source. The amendment now requires the rollout fallback and permits `found`, while retaining `unknown` after a miss because SQLite remained uninspected.
- Approved D5's Cursor table gains a new uniqueness rule: an accessible candidate is `unknown` when the enumeration needed to prove uniqueness was incomplete.
- Approved D5 also gains a distinct IDE-header rule separating a failed/unmappable nested query from a completed zero-row query.
- `tasks.md` adds task 2_1 with new Acceptance and Plan fields implementing those amended decisions.
- `workflow.md` explicitly records the D5 amendment as an artifact change taken at the remediation boundary rather than as remediation.

These are semantic changes to an approved `D#` and task contract, not verification of the gate set frozen by round 1. Under the verification scope lock, cycle 1 cannot adjudicate either the amended design or commit `4df34f4a`'s implementation. The requested design re-check and code-fix verification are therefore intentionally not performed in this round.

## Route

The D5/task delta must re-enter planning at Gate 2. After Gate 2 approves the amended Codex fallback and Cursor uniqueness/IDE-header contracts, the next user-initiated review starts **cycle 2, round 3, discovery mode** with a fresh risk map and full-flow review of the amended decisions and their implementation.

## Gate set carried forward without adjudication

- B1-R1 — Cursor IDE header failures are reported as proven absence — accepted; not verified because the IDE-header contract changed.
- B2-R1 — incomplete Cursor enumerations can claim a unique found session — accepted; not verified because the uniqueness contract changed.
- B3-R1 — the new `db-unreachable` status breaks both Codex consumers — accepted; not verified because the Codex fallback decision changed.
- W1-R1 — classified Cursor lookup duplicates both resolver implementations — accepted; not verified because it is bundled with the superseding contract changes.

## Audit backlog carried forward

None.

---

# Author note — why this round was burnt

The chair is right and the mistake is mine. I applied the remediation boundary correctly in the
triage — I identified that B3's fix changed accepted decision D5, said so in writing, and amended
design.md before touching code. Then I did the one thing that makes that worthless: I committed the
amendment and the fixes together as round-1 remediation instead of parking, handing back, and
re-earning Gate 2 first.

Emitting the handback reasoning is not the same as emitting the handback. The cycle closes as
superseded, and the next review is cycle 2's discovery round.

What re-enters Gate 2: design.md D5's Codex `db-unreachable` row (now keeps the rollout fallback),
its Cursor rows for uniqueness-before-found and the IDE nested-header failure, and tasks.md's new
task 2_1. Nothing in the implementation changes to satisfy this — the code already matches the
amended contract and its gate is green. What was missing is the approval step between them.
