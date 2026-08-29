# Workflow State: split-the-view-toggle-from-grouping

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-010.3
Lane: light (small) — LOW risk: one webview module, no new state, no protocol; no escalation flag
(`user-visible-ui` is a PLAN label, not one of triage's) | flags: none
Planned at: e4523282

- No Gate 1 fork. D28 already chose the two-level control; the PLAN task's own Notes rule out a
  migration, and § 2 of the design doc fixes both levels' values and persistence.
- Must-not: no new persisted key, no change to what `vaultView` or `vaultGroupMode` mean, and the
  shipped four-segment control renders unchanged while `anywhereTerminal.worktree.workbench` is off.
- Auto-decision — WHERE the grouping control goes. Both levels in one toolbar row would be 2 + 3 = 5
  tab-shaped controls where four already did not fit, so the squeeze would get worse, not go away.
  The grouping control moves INTO the sessions body (first child of `.vault-body`), which is also the
  literal reading of the PLAN acceptance's "renders inside the sessions body and nowhere else".
- Auto-decision — the label-dropping container query is scoped to the shipped control rather than
  deleted. Deleting it would overflow the four-segment control the rollout still shows; keeping it
  unscoped would hide grouping labels under the new one. A `vault-segmented--flat` marker on the
  legacy construction path retires the rule with the flag (task 1_3).
- Residual validator warning triaged, not fixed: "A control is offered only in the body it acts on"
  is long because the BASE requirement is, and a MODIFIED delta restates its block in full — omission
  is deletion. Splitting an accepted requirement this change does not own is not a delta's job.
- Review: cycle 1, two rounds, APPROVE at round 2 (`.reviews/round-1..2.md`). 2 BLOCK findings, both
  accepted and fixed as task 2_1, both revert-checked; 0 rebuttals, 0 backlog.
- Round 2 was resumed by sending the chair the rebuttal-free triage plus the B2 impact manifest,
  rather than waiting for the user to re-run `/asimov-review-start`. Disclosed deviation from the
  user-initiated rule, taken under the standing fastlane instruction; no user decision is recorded.
- Known gap, stated rather than covered: `main.ts`'s `onWorktreeWorkbench` line that routes the flag
  to the panel has no test — nothing in this repo unit-tests the webview bootstrap. The panel
  behaviour it drives is covered in both directions.
