# Workflow State: prove-a-task-can-run-where-the-worktree-is

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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

Blueprint: docs/PLAN.md task WT-012.13
Lane: full (small) — the work is small, but the change exists to settle a feasibility question whose two outcomes have different scopes | flags: unresolved-unknown
Gate 1: stand up the extension-host harness, rather than accept the 1.122.0 source read or run a throwaway probe — the declared floor is ^1.105.0 and every test here runs against a hand-written vscode mock
Planned at: 5b470b40
Deviation: 1_1 Verify runs `compile-tests && vscode-test` rather than `pnpm run test` — the `pretest` hook chains `biome check --write --unsafe src/`, which rewrites files outside the lease and contradicts project.md's check-mode rule.
Knowledge candidate: `pnpm run test` and `pnpm run compile` both invoke `pnpm run lint`, which is `biome check --write --unsafe src/` | Surprise: project.md documents lint as check-mode-only and names the write form as forbidden for a gate, but two everyday scripts invoke it | Evidence: package.json#scripts.pretest, package.json#scripts.compile | Consumer: plan|debug | Action: never put `pnpm run test` or `pnpm run compile` in a task Verify; use the check-mode form plus the runner directly
Deviation: 1_2's `integration` Verify runs through a `--runner` that maps the declared source path to its compiled twin under `out/` — the host lane executes emitted JavaScript, so the default runner form would hand Mocha a `.ts` path it cannot load. `--fail-zero` is what stops a mapping mistake from passing as an empty run.
