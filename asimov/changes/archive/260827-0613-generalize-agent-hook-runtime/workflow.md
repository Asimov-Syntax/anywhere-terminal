# Workflow State: generalize-agent-hook-runtime

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

Blueprint: docs/PLAN.md task WT-006.1
Lane: full (standard) — shipped security-relevant component widened in place | flags: security-privacy, re-review
Oracle review: BLOCK → 5 findings triaged, all accepted except a `check-types` Verify on 2_2 (build's Verify Gate owns type checks). Fixes landed as D2 entitlement set, D5 containment rules, D6 aggregate lifecycle, 204 per authority, and task 2_3.
Pre-existing flake (2_1 acked): `src/providers/fileTreeHost.test.ts` and `src/test/fileTreeGitDecorations.integration.test.ts` poll for 1000 ms while `src/providers/gitIgnoreChecker.ts` allows its `git check-ignore` spawn 1500 ms, so a spawn slowed by a concurrent `tsc` fails them deterministically. Untouched by this change and unreachable from its import graph; fix belongs in its own change (raise the budgets past 1500 ms, or await the handler instead of polling).
Review round 1 (cycle 1, master af0b8828357cc3bf5): REJECT — 4 BLOCK, 1 WARN, 2 SUGGEST, all 7 verified against the code and accepted, none rebutted. Fixed in task 3_1.
Review round 2 (verification): BLOCK — B2 persisted (my round-1 wrapper caught only synchronous throws; `() => void` accepts an async fn, so a post-await rejection was discarded — vitest reproduced it as a real unhandled rejection), B1 downgraded to WARN (`publish()` never read `state.active`). Both accepted, fixed in task 3_2 by widening the channel callback to `() => void | Promise<void>` and failing `publish()` plus timer scheduling closed when inactive. B3, B4, W1, S1, S2 confirmed fixed.
Verify-task contention: the known git-decoration flake fires only inside `verify-task`, which runs the declared Verify and the `--cmd` suite as two concurrent vitest processes; capping the suite at `--maxWorkers=4` removes the CPU oversubscription without narrowing it. Standalone `pnpm run test:unit` passes 2953/2953.
S2 wrapper safety: the installer now composes the POSIX wrapper from `CURSOR_HOOK_ENV_VAR`, which makes Biome's `useTemplate` propose collapsing `"$" + \`{VAR}\`` into invalid `${${VAR}}`. A `dollar` local keeps it a single template so project.md's `--write --unsafe` lint script cannot corrupt the emitted script. Both wrappers verified byte-identical to HEAD (423 and 390 bytes).
Lint gate: run in check mode (`biome check`, no `--write`) over the change's files. Two findings outside the diff are pre-existing on this branch — an unused suppression at `src/session/SnapshotPersistence.ts:504` and formatting in `src/cursor/CursorHookInstaller.test.ts`; project.md's lint script is the `--write` form, which would silently rewrite both.
