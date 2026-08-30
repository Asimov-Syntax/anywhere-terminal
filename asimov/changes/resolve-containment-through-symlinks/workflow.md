# Workflow State: resolve-containment-through-symlinks

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
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.1`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.1
Lane: full
Planned at: 80d19aee
Gate 1 `[-]`: no fork — reuse-first discovery settled the module (design.md D1).
Oracle round 1 returned "not ready as written"; 7 findings, all accepted (F5 needed no edit).
The tolerant walker is NOT reused — it swallows every realpath error, which a dangling link walks through (D3). `realpathTolerant` stays private in normalizePath.ts.
Five lexical worktree-attribution sites found during triage went back to the blueprint as WT-011.6 rather than being absorbed here.
Wave 2 soloed rather than fanned out to fillers: four file-disjoint tasks, one decision thread (the same predicate, the same tolerance and equality semantics) — the skill's stated exception.
1_5 adds one `realpath` per listed file alongside the `stat` already there: same order as the existing per-file cost, and per-file is the granularity the threat lives at.
Review cycle 1 round 1: BLOCK (1 B / 1 W / 1 S), all accepted, all three routed to a handback — see .reviews/round-1.md. Chair resume id: adb030d402fd7c455; round 1 head 0f2f0858.
