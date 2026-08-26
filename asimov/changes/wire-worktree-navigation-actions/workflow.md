# Workflow State: wire-worktree-navigation-actions

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no real fork — see Notes)_
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

Blueprint: none
Lane: full

Blueprint: docs/PLAN.md task WT-005.1
Lane: full (standard) — spans the webview, both providers, the window host and the manifest | flags: new-api-contract, cross-boundary
Fastlane: no Gate 1 fork — worktree-actions.md § 2 and worktree-rpc.md § 2.1 settle the inventory and the message shapes; the routing seam and the resolution owner were calls made against current code and recorded as D1-D3.
Scope call: `Copy resume command` is built here though the blueprint Goal omits it — § 2 classes it read-only and the blueprint Notes name its existing host implementation. `Resume Session Here` and launch stay with WT-005.3.
Oracle pass: 5 BLOCK + 1 SUGGEST + 1 WARN, all accepted. D2 was wrong that the extension can open a preview or focus a pane — both are webview-owned, so the change now adds the outbound half the panel never had (5_1). D1's exhaustiveness proof was an inert type alias; it is now an AssertNever the build fails on. D5's `init`-only delivery would have left open views stale, against the behaviour of every neighbouring UI setting. D10 and D8 came from the oracle noticing that wiring only the read-only half would leave lock, remove, resume and two agent-row items present and inert, which the accepted absent-not-disabled requirement forbids. D9 picks up the subagent activation `surface-subagent-history-rows` deferred here. Task 5_1 (worktree grouping) was DELETED: repoRoots.ts:186-193 already dedupes on the git common dir for exactly that case, with a test at repoRoots.test.ts:90-103 — the spec requirement went with it.
Deferred: `worktreeCopyResumeCommand`'s optional `worktreeId` cwd override (WT-005.3 owns resume); the vault rename editor's own focus restoration, which the shell extraction cannot supply (D6).
Stale blueprint: worktree-panel-ui.md:248 names a "companion" open-folder-mode setting that DESIGN.md:459 does not register; double-click keeps the new-window behaviour the view already names, and no unregistered setting is invented.
