# Workflow State: wait-for-the-prune-the-assertion-reads

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
- [-] Review done — test-only diff of two waits in one file, no production change, no escalation flag; an independent adversarial second opinion read both conversions line by line and found neither weakens what the test proves
- [x] Gate: implementation approved
- [-] Blueprint sync complete — `Blueprint: none` _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: e4e6033e

Blueprint: none
Lane: light
Must not: change production code, or weaken an assertion. (Superseded during build: the original "or convert other waits in the same pass" was wrong. The third verify failed at `[7_3] submits the path the host answered when the override is occupied` for the same reason — no `worktree add` recorded yet — so the defect is a class, not a site. The Boundary in tasks.md now reads "no conversion of a wait that has not actually failed the gate", and both sites that have failed are converted.)
Why now: the bare `settle()` here pumps a bounded number of event-loop turns and returns on DOM/argv quiescence, but `worktreeMutationService` awaits a dry-run recount BEFORE issuing the real prune — so quiescence can land before the call the assertion reads. `asimov/project.md` § classifies every remaining bare `settle()` in this file as an unconverted instance of exactly this defect. It failed the Verify Gate for two unrelated changes today.

Remainder, recorded rather than implied to be done: 88 bare `await settle();` calls survive in `src/extension.worktreeAssembly.test.ts`. Two are converted here because they failed the gate; the rest are not converted, because the Boundary forbids converting a wait that has not. The highest-risk survivors, each a bare wait immediately preceding an assertion over asynchronous git or launch state: `:1449-1478` (agent create — `worktree add` plus the launch), `:2706-2725` (fresh-selection create — `worktree add`), `:2787-2795` (free-override create — the same shape as the converted occupied-override test), `:2887-2896` (reattach — `worktree repair`), `:2959-2979` (direct repair — repair argv plus the mutation result). `:1281-1288`, `:1407-1418`, `:1502-1510` are the same class.

Attribution correction: the second opinion would not sustain my account that the first two verify failures were the recorded load flake. Their captured output was reduced to a generic exit failure, so which test failed is unrecoverable — the repository documents that flake pattern but does not establish it as the cause of those two. Only the third failure is evidenced, and it is the one that widened the Boundary. The `--ack` rests on the third failure being understood and fixed, not on the first two being explained.

Verify gate: check-types clean; 7639/7639 across 295 files; `biome check src` reports 13 diagnostics, byte-identical to the same command at the change's base d3e4d7cd~1 and none in `src/extension.worktreeAssembly.test.ts` — the file this change touches.
