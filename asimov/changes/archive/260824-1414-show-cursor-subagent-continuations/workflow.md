# Workflow State: show-cursor-subagent-continuations

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (small) — user-visible preview change crossing reader normalization → IPC timeline type → webview renderer | flags: cross-boundary
Reopens: `260824-1200-integrate-cursor-agent` D11. The user declined a continuation marker on 2026-08-24 and has now re-raised it; this change supersedes that decline.
Note: Q2 answer substituted — the chosen source (child transcript) does not record its own agent type (census of 14 local Cursor child transcripts); design.md D2 resolves it from the full decoded record set instead, same intent, no extra I/O.
Deviation (2_1): D1's merge is non-mutating rather than in-place — in-place marking on steps shared between `timeline` and `activity` let the array merged last decide the other's owner. design.md D1 + Risk Map updated; no spec impact.
Deviation (2_1): `--cmd` scoped to type-check + the leased suite. 2_1/2_2/2_3 implement one contract, so the three inherited collapse tests stay red until 2_2/2_3; the full suite is the gate on both.
Verify gate observed on the current tree (NOT ticked — 3_2's manual UI check is unrun): check-types clean; `biome check src/` 0 errors / 13 warnings, identical to the HEAD baseline; vitest 154 files / 2849 tests pass. `pnpm run lint` is the `--write --unsafe` form, so the gate used `biome check src/` in check mode.
3_2 evidence (data half only): the real local Cursor chat `e02838b2` now yields launch `@asm-oracle "Oracle advisor ready"` plus two `continuation` rows carrying their own titles, all three on one child locator, `subagentCount` 3 agents across 5 invocations, no `@Task` label. The VS Code UI half still needs the user.
Review: 2 rounds (user-capped). Round 1 WARN — W1 strip capped before continuations were filtered, W2 the D2 no-chip floor held only on the linked path, S1 missing coverage; all three accepted and fixed. Round 2 WARN — W2 survived in the failed-nested-load fallback (`name: fallback.agent ?? "Agent"`); accepted and fixed by carrying `undeclared` explicitly through `subagentSession` and `NestedInvocationFallback` rather than inferring it from an absent `agent`, which agentless group nodes also have. 0 BLOCK across both rounds. Round-2 chair id for any resume: a7b0eb3.
Scope added mid-build at the user's explicit request ("làm được thì làm đi"): D6 turn focus — expanding an invocation reveals the child turn its prompt began. Added as spec requirement `#nested-invocation-turn-focus`, design D6, task 3_3; this widened accepted behaviour after Gate 2, recorded here rather than re-gated because the user asked for it directly.

