# Workflow State: wire-worktree-navigation-actions

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no real fork — see Notes)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(re-earned after the 2_2 handback)_

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(3 rounds; round 3 WARN, 0 gating blockers)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-005.1
Lane: full (standard) — spans the webview, both providers, the window host and the manifest | flags: new-api-contract, cross-boundary
Fastlane: no Gate 1 fork — worktree-actions.md § 2 and worktree-rpc.md § 2.1 settle the inventory and the message shapes; the routing seam and the resolution owner were calls made against current code and recorded as D1-D3.
Scope call: `Copy resume command` is built here though the blueprint Goal omits it — § 2 classes it read-only and the blueprint Notes name its existing host implementation. `Resume Session Here` and launch stay with WT-005.3.
Oracle pass: 5 BLOCK + 1 SUGGEST + 1 WARN, all accepted. D2 was wrong that the extension can open a preview or focus a pane — both are webview-owned, so the change now adds the outbound half the panel never had (5_1). D1's exhaustiveness proof was an inert type alias; it is now an AssertNever the build fails on. D5's `init`-only delivery would have left open views stale, against the behaviour of every neighbouring UI setting. D10 and D8 came from the oracle noticing that wiring only the read-only half would leave lock, remove, resume and two agent-row items present and inert, which the accepted absent-not-disabled requirement forbids. D9 picks up the subagent activation `surface-subagent-history-rows` deferred here. Task 5_1 (worktree grouping) was DELETED: repoRoots.ts:186-193 already dedupes on the git common dir for exactly that case, with a test at repoRoots.test.ts:90-103 — the spec requirement went with it.
Replan: D2 now puts `openTerminal(cwd)` on `WorktreeSurface` rather than in `WorktreeActions` — the surface is the provider's own handle and already carries `post`, so the capability lands where a pane can actually be created without inventing a surface->provider registry. Host-side resolution is unchanged. Task 2_1 was unticked and amended rather than patched later, because its `WorktreeActions` shape is what the decision changes.
Handback (2_2): D2 specifies `openTerminal(surface: WorktreeSurface, cwd: string)` implemented in extension.ts. It cannot be: creating an AT pane needs `sessionManager.createSession(viewId, webview, {cwd})`, and the extension reaches that only through a `TerminalViewProvider` (`doNewTerminal`, extension.ts:427). `WorktreeSurface` is constructed privately inside each provider's `resolveWebviewView` and the extension holds no map from one to the other. The other seven capabilities are unaffected — only the terminal one needs a settled mechanism.
Deferred: `worktreeCopyResumeCommand`'s optional `worktreeId` cwd override (WT-005.3 owns resume); the vault rename editor's own focus restoration, which the shell extraction cannot supply (D6).
Stale blueprint RESOLVED at sync: worktree-panel-ui.md's double-click row claimed a "companion" open-folder-mode setting that DESIGN.md:459 does not register. Rewritten to state the built behaviour — open in a new window, no governing setting, the other mode stays a context-menu item.
Lint gate: `pnpm exec biome check src/` — 13 warnings, all pre-existing on a clean HEAD worktree and in files this change does not touch (SnapshotPersistence.ts, fileTreeRpc.integration.test.ts, VaultService.customName.test.ts, fileTreePanel.css, vaultPanel.css). The auto-fix form was never used to clear it.
D5 adaptation: the row-activation value is read host-side as D5 says, but supplied by the two PROVIDERS rather than `WorktreeHost.initPayload()` — the host deliberately holds no VS Code window API, and the providers already compose the init payload and own the config listeners.
Plan extension (3_1b): the controller also POSTS the resolved activation. Without it the setting resolved to a value nothing performed, and the task's Outcome was unobservable.
Equivalent mutant (4_1): leaking the `mousedown` listener on close is unobservable — `close()` nulls `menuEl`, and the handler is guarded on it, so a leaked copy is a no-op in every reachable state. Not a test gap.
Round 1 (REJECT, 3 BLOCK + 2 WARN): all five accepted after independent verification. B2, B3, W1, W2 fixed as task 6_1 — each with a mutation-checked test. B1 split: its sidebar/panel list race is fixed as 6_2 (the panel holds one pending id and opens it on the arriving list); its editor half is handed back (below).
Handback (B1b): the accepted `worktree-panel` requirement "An offered action works from every surface that shows the panel — sidebar, panel, or an editor surface" cannot hold for `Open Session Preview` on an editor surface. `TerminalEditorProvider` handles no vault message type and holds no `VaultService`, so the vault panel it renders is inert for every vault feature — a condition that predates this change. Carrying the entry in the handback does not help: `PreviewController.open()` then posts `requestVaultSessionDetail`, which that surface also drops. The two candidate fixes both move an accepted artifact — give vault handling an owner across surfaces (a VaultHost mirroring FileTreeHost/WorktreeHost), or narrow the requirement and make preview ABSENT on a surface that cannot perform it, which in turn contradicts D5's rule that an external row always previews.
Handback WITHDRAWN (B1b): the evidence above was wrong about the cost. `handleRequestVaultSessions`/`handleRequestVaultSessionDetail` need only a `VaultService`, the webview, and a supersession counter — no VaultHost, no artifact moves. Fixed as task 6_3: the editor provider takes an optional `VaultService` and answers exactly the two READS a preview needs. Scope boundary: the vault panel's mutating and launch items (rename, resume, watch, launch targets) stay unwired on editor surfaces — they were unwired before this change and belong to the vault capability, not WT-005.1.
Equivalent mutant (6_3): dropping the post-refresh `token !== _vaultRefreshSeq` return is unobservable while `safeSendWithRetry` carries the same predicate as `shouldAbort` — it bails before attempt 0 too. Kept as defense-in-depth, mirroring the identical pair in `TerminalViewProvider`. The `shouldAbort` argument itself IS observable across the 50ms retry sleep and has a test.
Round 2 (BLOCK, 2 BLOCK + 1 WARN): all three accepted, none rebutted. Fixed as 7_1, 7_2, 7_3.
B2 correction: round 1's fix reported the failure honestly instead of removing it, and I recorded the cause as an out-of-scope pre-existing defect. Verified reachable — `closeSplitPaneById` keeps the tab and its live leaves while deleting `terminals[tabId]` — so `resolveTabDisplayPane` now finds a tab through a retained leaf and BOTH the tab bar and row activation reach it. The out-of-scope note below is therefore obsolete: that defect is fixed, not deferred.
B4 correction: my 6_3 scope note said the vault panel's mutating items "were unwired before this change". True but irrelevant — they were also UNREACHABLE, because nothing answered `requestVaultSessions` on an editor surface and the list rendered empty. Populating it made 13 inert controls reachable. Fixed with one `vaultActionsAvailable` init flag rather than a capability enum: the split is all-or-nothing per surface today, and the existing `fileBacked`/`canResume` gates compose with it. Applied at every boundary the invariant reaches, not only the list menu the chair quoted — the row Resume button, the whole context menu, and the preview overlay's own Resume / rename / Continue / Raw controls. The overlay itself still opens, which is what 6_3 delivered.
Equivalent-mutant correction (4_1): the chair's refinement accepted — leaking the `mousedown` listener is not strictly equivalent, since closures accumulate per menu opening. Dismissal behaviour is unchanged and production teardown is correct, so it stays a non-finding, but it is recorded as accumulation rather than as behavioural equivalence.
Round 3 (WARN, 0 BLOCK): cycle exits with zero gating blockers — every BLOCK across all three rounds fixed and verified by the chair. Both non-gating findings closed anyway because both were trivial: W3 ported the cold-init ordering case to the editor provider (7_3 fixed the ordering in both providers but pinned it in only one, and the editor has its own message loop, retry helper and harness — exactly the cross-surface drift this change exists to remove), and S1 narrowed the `vaultActionsAvailable` doc, which listed `watch` among what it gates while `PreviewController` posts `vaultWatchSession` unconditionally. Chair sustained that ungated watch is correct — automatic lifecycle traffic, not an offered control — so the fix was the documentation, not the gating.
Pre-existing defect found while fixing B2 and FIXED in 7_1 (it was the cause, not a neighbour): closing a split tab's ROOT pane left the tab unreachable from the tab bar too, because `switchTab` early-returned on the missing root terminal.

