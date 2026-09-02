# Review Round 2 — run-the-setup-the-user-saw

- Date: 2026-09-02
- Cycle: 1
- Round: 2
- Mode: superseded
- Scope: range `2e5573fb..HEAD`
- Head: `d0689ffc6ea395a16143aa91d3fb4764073cd8d2` (working tree dirty only from generated `asimov/changes/run-the-setup-the-user-saw/analytics.json`)
- Reviewable lines: 531 production lines in the remediation range
- Agents spawned: none — scope lock tripped before Phase 2
- Agents skipped: all specialists
- Verdict: **REJECT**
- Counts: 7 prior accepted BLOCK findings not adjudicated · 3 prior accepted WARN findings not adjudicated · 0 new findings
- Review session identity: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Scope-lock disposition

Round 2 cannot proceed as verification. Since round 1's recorded Head `2e5573fb6046edf01cc20d20fcfd6ae618ea3398`, the remediation range changes all three scope-lock contract classes:

1. `tasks.md` adds tasks 5_1–5_3 with new Refs, Acceptance outcomes, verification commands, and implementation plans.
2. `design.md` changes D2–D5 and the obligation ledger, including new port-name authority, run-level cancellation/deadline, terminal disposal/batching, output-directory authority, visible retry rejection, and every-fresh-create manifest obligations.
3. `specs/worktree-panel/spec.md` changes the external port contract by making only portable, non-reserved names offerable and adds a reserved-variable scenario.

These are new or semantically changed task, design, and specification contracts rather than task-completion metadata. Under the verification scope lock, the current discovery cycle is superseded even though the changes were introduced to remediate round-1 findings. The changed contracts must be reviewed together with their implementation in a new discovery cycle; treating them as verification would freeze round 1's older gate set while adjudicating against a different accepted contract.

The implementation, tests, impact manifest, rebuttals, and recorded verification evidence were not used to resolve F001–F010. Round 1 remains the source of truth: F001–F007 remain accepted gating BLOCK findings and F008–F010 remain accepted WARN findings. No new finding or audit-backlog entry was adjudicated.

## Route

The design/spec/task delta re-enters the review lifecycle at Gate 2. `workflow.md` records the replan and retains `[x] Gate 2: plan approved`; the next user-initiated review therefore starts **Cycle 2, Round 3, discovery mode** and reviews the approved remediation contracts, implementation, tests, and cumulative change together.

Global round numbering continues. Round 3 is the final ordinary round under the current review grant; if gating blockers remain after Phase 3, the same chair enters Arbiter Mode before closing it.

## Prior findings carried without adjudication

- F001 — Selected port names can overwrite setup's authoritative control environment — BLOCK
- F002 — Directory authorization runs outside the aggregate deadline and cancellation signal — BLOCK
- F003 — Every PTY data event rebuilds the entire retained transcript — BLOCK
- F004 — Starting a retry does not retire the prior output handle or transcript — BLOCK
- F005 — Output authority can cross a removed-and-recreated worktree identity — BLOCK
- F006 — A throwing PTY kill defeats timeout and close settlement — BLOCK
- F007 — A create with an empty provisioning selection writes no manifest — BLOCK
- F008 — An unexpected retry coordinator rejection silently burns the rotating capability — WARN
- F009 — Live setup output dispatches one synchronous VS Code event per PTY event — WARN
- F010 — A completed final child remains current and subscribed until terminal close — WARN

## Re-review identity

- Chair review session: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Round-1 source of truth: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/asimov/changes/run-the-setup-the-user-saw/.reviews/round-1.md`
- Round-2 scope-lock record: this file
- Next review baseline: approved cumulative change through Head `d0689ffc6ea395a16143aa91d3fb4764073cd8d2`
