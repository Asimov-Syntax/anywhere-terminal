# Workflow State: verify-cross-layer-scale

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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-007.1
Lane: full (standard) — cross-layer verification spanning model, presence, host, and webview | flags: re-review
Mode: fastlane — Gate 1 auto-selected D1 Option B (tagged titles + a declaration-parsing meta-test) over a doc table or an import-time registry.
Oracle round: 5 BLOCK, 2 WARN — all 7 accepted, 0 rebutted. Artifacts rewritten before Gate 2; two oracle sub-claims corrected against evidence (waves already serialized 4_1/4_2, and review is mandatory here via the re-review flag, not optional).
Blueprint status is deliberately NOT set to done by this change: docs/PLAN.md:358 makes WT-006.3 depend on WT-006.2, which is in_progress in another session, so WT-007.1 depends on it transitively while its acceptance says every invariant (D9). WT-007.1 stays in_progress with the frozen deferred set naming what remains.
Discovery corrected itself twice mid-pass, both recorded in discovery.md: the render cap is implemented (not dead), and the WT-006.2 dependency is transitive (missed on a direct-deps reading).
src/agentHooks/install/managedEntryLedger.ts carries the same NUL defect as the D7 files and is left alone — peer-owned.
5_1 parked, not ticked: the worktreeAssembly race is fixed (assemble() waited a fixed 40 turns; now waits on the rendered-row condition), but a SECOND, unrelated flake surfaced under repeated full-suite runs — ManagedConfigInstaller.test.ts and claudeConfigAdapter.test.ts exceed vitest's default 5000 ms testTimeout under load, and pass in 819 ms alone. Both live in src/agentHooks/install/, which 5_1's Boundary forbids leasing, and its other two remedies (retry flag, widened timeout) are forbidden too. Acceptance unachievable inside the Boundary → handback.
Audit finding, recorded against design.md D9: DEFERRED_BY_WT_006_2 is EMPTY — every § 8.4 invariant is reachable without the peer-owned tree, so D9's peer-ownership leg does not bite. Its transitive-dependency leg (docs/PLAN.md:358) still does.

