# Workflow State: state-a-collision-as-a-segment

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; `worktree-rpc.md` § 2 and `worktree-create.md` § 4.2 already settle which side shortens
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [-] Review done — skipped: two changed source lines plus doc comments, no escalation flag, and the contract was written before the code. 5,631 unit tests pass and the added assertions are the ones that would have caught the defect
- [x] Gate: implementation approved
- [x] Blueprint sync complete

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-009.3
Lane: light (small) — LOW risk, one domain, zero ambiguity: the contract is already written and the code contradicts it | flags: none
Scope: WT-009.3 is REOPENED for one acceptance clause only. Everything else in its acceptance list shipped and stands, and is not re-planned here.
Direction (fastlane, no fork): the HOST shortens. `worktree-rpc.md` § 2 already specifies `collidedWith` as "the **last segment** of the unsuffixed candidate ... never a full path", so this is not a choice the plan gets to make.
Must not: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are read-only — an external design pass owns them, and `main` carries an unmerged second pass.
Reuse: no `basename` call is needed. `bare` is `suggestFreePath(root, base, () => false)` and that predicate never reports a collision, so `bare` is exactly `join(root, base)` and the host already holds `base`.
Knowledge candidate: the shipped dialog tests passed `collidedWith` values that were already segment-shaped (`-feat-x`), so the full-path case the host actually sends was never rendered in a test | Surprise: three separate suites assert on this field and none of them used a real host value | Evidence: src/webview/worktree/WorktreeCreateDialog.test.ts#264 vs src/providers/WorktreeHost.actions.test.ts#1004 | Consumer: plan | Action: when a wire field has both host-side and webview-side suites, check they agree on the value shape before trusting either
Blueprint defect found while planning: WT-009.3's reopened note cites `docs/audit/2026-08-30-worktree-lifecycle-gaps.md § I`, and that file has no § I — it runs A–H plus a Summary. The finding it describes is real and is documented instead in `docs/design/worktree-create.md` § 4.2. Correct the citation at blueprint sync.
Verify gate: biome reports the same 3 pre-existing format errors (`src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, `src/cursor/CursorHookInstaller.test.ts`) and 14 warnings that a clean detached worktree at the change base reports under the same biome 2.4.5. None is touched by this diff.
