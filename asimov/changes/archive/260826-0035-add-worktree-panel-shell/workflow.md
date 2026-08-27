# Workflow State: add-worktree-panel-shell

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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-002.1
Lane: full (standard) — 17 files in one webview domain plus four edits to a shipped panel surface | flags: none
Verify gate evidence: 7 test files / 290 tests pass; check-types clean; biome at the pre-existing 13 warnings.
Review: asm-review-master, 2 blocking + 6 warnings, 7 fixed with regression tests; 2 deferred by decision (below).
Sign-off: user accepted the rendered shell in-session, closing task 5_1's manual gate.
Retroactive: implementation landed before this change was opened; tasks verify existing code rather than build it. A failing task is a defect to fix under its lease.
No design.md: the mechanism is already owned by docs/design/worktree-panel-ui.md and DESIGN.md § 12; a local copy would be a second owner of the same facts.
Accepted warning: "Grouping modes" stays long — it is a three-mode enumeration whose length is inherited (the shipped requirement is 677 chars; this delta is 520). Splitting a shipped requirement is a spec refactor this change does not earn.
Deferred out, recorded in proposal.md: the repo-derived default view (to WT-003.1) and extracting the shared popup/modal primitives (to WT-005.1 / WT-005.2).
