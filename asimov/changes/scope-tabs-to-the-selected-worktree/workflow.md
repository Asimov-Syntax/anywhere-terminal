# Workflow State: scope-tabs-to-the-selected-worktree

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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
- 1_7's planned Verify (`vitest run src/webview/TabBar.test.ts src/test/invariants`) could not prove its own Outcome: the invariant reporter treats ANY filtered run as partial, so stripping the `[I18]` tag stays green under it. Changed to the unfiltered `pnpm run test:unit`, which exits 1 on the same strip. Outcome unchanged.
- 1_5's Plan paths grew by five files (`worktreeViewTypes.ts`, `WorktreeView.ts`, `WorktreeController.ts` and their tests): D7 routes the "said" through the panel's action-result surface, so the `scope` action kind, its notice branch and the controller entry point all had to exist for step 4 to land.


<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-010.1
Lane: full (standard) — 10+ files across settings, provider, webview state, tab bar and the worktree panel; MEDIUM risk | flags: user-visible-ui
Planned at: b4259262

- Fastlane: no fork. worktree-scope.md settles the model and § 2.3 records the two rejected alternatives, so nothing was left for planning to choose.
- Two places the shipped code contradicts the design doc, both found by reading source rather than by trusting it: `renderTabBar` hides the bar at fewer than two tabs, which would hide the chip that is the only sign the list is filtered (design.md D3, and a MODIFIED delta on `tab-bar-component` rather than only ADDED ones); and `.wt-card` today marks whatever is EXPANDED, which is the emphasis the PLAN acceptance says must stop reading as selection (D5).
- The invariant machinery already exists: `src/test/invariants/registry.ts` mirrors DESIGN.md § 8.4 and its gate forbids an uncovered row, and § 8.4 already reserves this change's statement in its Planned table. 1_7 lands the row, the registry entry and the covering test together — a row added ahead of its test turns the suite red by design.
- Validator warning kept, not fixed: `Tab-Bar-Rendering` embeds `renderTabBar()`. That sentence is the applied requirement's own text, unchanged by this delta; MODIFIED replaces the whole block, so dropping it would repeal an applied clause with no REMOVED delta to say so. The delta changes only the block's scenarios.
- Left to WT-010.2 on purpose, and visible while both are behind the flag: between this change and that one, selecting a worktree filters the tab bar without moving the active pane, so the terminal can show a pane whose tab is hidden.
- Orca was not researched: this slice is a filter over a list this extension already owns, with no counterpart in Orca's model.

### Oracle + audit triage (all findings accepted; artifacts revised before Gate 2)

- BLOCK D8: extending `worktreeSignature()` would have made every presence scan re-enter `renderTabBar` — the opposite of the outcome D8 states. The tab bar now gets its own signature over scope + attribution + layout membership.
- BLOCK verifiability: **no test in the repo imports `main.ts`**, so a render-suppression claim asserted there was unverifiable by construction. Scope, the map, the signature and the render decision moved into `src/webview/tabBarScope.ts`; `main.ts` is left as wiring. That one extraction also fixed the 1_6/1_7 lease collision and gave 1_5 and 1_8 a real seam.
- BLOCK contradiction: the spec deltas disagreed about whether SELECTION is gated by the rollout flag. Resolved toward the PLAN acceptance's "everything here is inert while the rollout setting is off" — selection is gated too, and the card keeps its expansion-keyed behaviour while off.
- BLOCK blueprint bug: `docs/design/worktree-scope.md` § 3.4 said a `missing` worktree drops scope, while its own § 8 table and WT-010.1 both say it is kept. § 3.4 was the error and is corrected; validity is tree membership, not filesystem availability.
- BLOCK coverage: five tasks claimed cross-layer outcomes their Verify could not establish. Verifies retargeted — 1_1 to the provider test, 1_3 to the controller test, 1_5/1_6/1_8 to the coordinator's own test.
- WARN repeal: the MODIFIED `Tab-Bar-Rendering` was confirmed legitimate, but it had silently dropped the applied "two or more tabs are visible" outcome. Restored as an explicit scenario.
- Rejected, twice proposed: a "last good attribution" cache for degraded presence. Attribution is a pure function of pane cwd and tree ids and cannot be emptied by a degraded source; retaining it would keep hiding tabs on an attribution the current tree no longer supports — the exact violation I18 exists to catch. Recorded in D7 so a third pass does not re-propose it.
- Validator warning kept: `Tab-Bar-Rendering` embeds `renderTabBar()`. That is the applied requirement's own text; MODIFIED replaces the whole block, so dropping it would repeal an applied clause with no REMOVED delta.
- Oracle did not reach five checks (pane-id equality across all restore paths, main.ts init ordering, window-scope-only rows, tail-trim with an empty scoped set, second call sites of the visibility toggle). Silence there is not a pass; 1_3 and 1_4 carry the coverage that would catch each.
