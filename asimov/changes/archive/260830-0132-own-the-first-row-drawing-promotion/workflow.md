# Workflow State: own-the-first-row-drawing-promotion

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

Blueprint: docs/PLAN.md task WT-011.2
Lane: full — flags: re-review. New invariant owner (the promotion rule), so the debt is closed by an owner rather than a fourth branch
Planned at: 6ed105a9
Gate 1 `[-]`: no fork — the deferred finding carried its own designed shape.
Oracle round 1: not ready as written; 6 findings, 4 accepted (2 BLOCK, 2 WARN), 2 were confirmations. The blockers were both mine overloading `projectionDirty`/`nextExternalOnly`, whose existing meanings gate the pane-evidence acknowledgement and the rerun's mode.
Review cycle 1 round 1: APPROVE, 0/0/0. Chair id af24474eef75ef88b; head c43e5ac7.
