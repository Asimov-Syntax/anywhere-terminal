# Workflow State: run-the-setup-the-user-saw

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no product fork; use the host-held offer, one bounded shell runner, row-scoped retry, and the existing mutation queue
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.11
Lane: full (standard) — setup execution crosses host, shell, worktree lifecycle, and UI state | flags: security-privacy
Mode: fastlane — direction, plan, build, review, approval, blueprint sync, and archive auto-proceed within accepted scope
Oracle triage: accepted four blockers and five warnings into D2-D6/tasks; Windows now uses EncodedCommand, setup-only creates mint authority/id, retry is provisioning-only and preserves contests, PTY starts after open with a bounded transcript; rejected the asimov-provenance warning because native plus its named base are both active in the shipped model
Plan drift check: HEAD advanced only by the approved plan commit; all named source seams remain byte-identical to 628c2ec9
Planned at: 628c2ec9
