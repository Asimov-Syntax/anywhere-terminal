# Workflow State: carry-a-contest-membership-once

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the shape follows directly from F008
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — Blueprint: none _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: 2559e6c2
- Split out of `award-a-contested-destination-or-refuse-it` at its round-3 thrash stop: F008's fix is a changed wire contract with its own owner, which the remediation boundary keeps out of the parent's fix loop. The parent depends on this reaching APPROVE.
- No PLAN.md row: adding blueprint tasks is the user's call and they were away. The parent's workflow.md carries the same follow-up.
- Round-1 frontend specialist reached this session directly after its hand-back to the chair failed to route: `provisionKey` (src/webview/worktree/WorktreeView.ts) hashes only `id=outcome.kind`, so a second result with the same step kinds but changed contest membership or reason compares equal and `setData` skips the render, leaving a stale refusal notice. Confirmed by reading the function. The reason was already outside the key before this change; the contest membership the notice now depends on is new, so the fix belongs here. WARN, not gating on its own — to be triaged with the chair's report.
- `src/extension.worktreeAssembly.test.ts` "[3_4] removes the replacement the barrier resolved" failed once in a full `test:unit` run and passed alone and on the next full run — an order-dependent flake in a peer's change (`render-the-removal-assessment-as-a-report`), not this change's file. Recorded rather than chased.
