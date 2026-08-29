# Review round 2 — surface-what-the-scope-hides

- Date: 2026-08-29
- Cycle: 1
- Mode: verification
- Scope: `3ae8513f..ca0ebeaf` (round-1 Head → HEAD), plus the round-1 rebutted/accepted files
- Head: `ca0ebeaf65ce7289577d79a8ecc1f1c6379ccdc2` (tree clean)
- Reviewable lines: ~190 (src, non-test)
- Verdict: **WARN** — 0 blocking, 3 warnings, 3 suggestions
- Verify gate cited, not re-run: `.build/verified.ndjson` task `2_1` records `pnpm run check-types && pnpm run test:unit` exit 0; the coordinator reports biome diffed against a detached 7128f51c worktree with zero new diagnostics and `gate:fs-deletion` green.

## Scope lock

Passed. The diff since round 1 is one commit. `src/` changes are confined to the files named in the accepted findings; `tasks.md` gains only remediation task `2_1`, whose Plan restates the accepted findings; `asimov/changes/active` and the analytics files are task-completion metadata. No new capability, no new or semantically changed contract, no new invariant owner. Reviewed as a verification round.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | count union, render guard, predicate | logic, edge cases | gpt-5.6-terra[1M] |
| asm-review-contracts | dep migration, spec delta, I19 | contracts | sonnet[1M] |
| asm-review-frontend | region lifecycle under the new funnel | rendering, a11y | opus[1M] |
| chair | full fix diff + impact cone trace | all | opus[1M] |

## Prior findings — carried forward

| # | Round-1 severity | Round-2 status |
|---|---|---|
| B1 | BLOCK | **fixed** |
| B2 | BLOCK | **fixed** |
| W1 | WARN | **fixed** |
| W2 | WARN | **fixed** |
| W3 | WARN | **partially fixed — persists**, see W3 below |
| W4 | WARN | **fixed** |
| W5 | WARN | **partially fixed — folded into W3** |
| S1 focus | SUGGEST | audit-backlog (user triage) — not gating, re-listed |
| S2 detached container | SUGGEST | **partially fixed — persists**, see S2 below |
| S3 double draw | SUGGEST | **still present — persists**, see S3 below |
| S4 traversal duplication | SUGGEST | **fixed** |
| S5 `infoOf` | SUGGEST | **fixed** |
| S6 separator | SUGGEST | rejected by user triage — not re-reported |
| S7 stale dialog title | SUGGEST | **fixed** |

### B1 — fixed
`syncEmptyScope()` (`tabBarScopeWiring.ts`, `settleScope(false)`) is called at the tail of `main.ts:390`'s `updateTabBar`. Every pane-arrival and pane-departure route reaches it, verified individually: `onTabCreated` → `switchTab` → `updateTabBar`; `onSplitPaneCreated` and `closeSplitPaneById` → `SplitTreeRenderer.onTabBarUpdate` (`SplitTreeRenderer.ts:126,341,394`) → `updateTabBar`; `onExit` (`main.ts:614`); `removeTerminal` (`main.ts:555`); `onTabRenamed` (`main.ts:639`); init restore (`main.ts:1182`, after `wireTabBarScope` at `:1092`); tree push via `applyTree`'s `finally`. The one path that bypasses it — `updateTabBar`'s `if (!tabBarEl) return;` — is unreachable in the shipped HTML, which always emits `<div id="tab-bar">` (`webviewHtml.ts:761`). Test `tabBarScopeWiring.test.ts:670` discriminates: with `syncEmptyScope` a no-op, `emptyScope` stays non-null.

### B2 — fixed
`hiddenWaitingFromPresence` is deleted; `shouldRender(tabLayouts, hiddenWaiting)` is handed the count `buildTabBarData` itself derived, from the seam's `renderIfMoved` (`tabBarScopeWiring.ts:161-166`) — the sole production call site, confirmed by repo-wide grep. The exited-vs-live construction from round 1 now moves the signature. Chair-verified independently that no divergence remains between the recorded signature and what the bar displays: every ungated `updateTabBar` draws current state, and every gated call recomputes from the same live maps with no interleaving mutation, so a suppression can only occur when the drawn state already equals the current state. `tabBarScope.test.ts` now routes every `shouldRender` through an `ask()` helper that calls the real `buildTabBarData`, so the tests exercise the shipped derivation rather than a parallel one.

### W1 — fixed
`setWorkbench` calls `settleScope(false)` before `renderIfMoved()`. With the flag off, `scopedWorktreeId()` is `null`, so the region comes down and `#terminal-container` is restored.

### W2 — fixed
`applyTree`'s `finally` and the chip's `onClear` now call `settleScope(false)` instead of `takeDownIfUnscoped()`, and the render-path funnel covers pane close and init. All three round-1 paths verified.

### W4 — fixed
`inScope` is exported from `TabBarUtils`; `TabBarScopeCoordinator.presents` is `inScope(this.effectiveScope(), paneId)`. One encoding, as design.md D3 always said.

## Findings

### W3 — WARN / HIGH / P2 / feature — persists from round 1 (partially fixed)
- agent: asm-review-logic + chair
- class: feature
- file: `src/webview/TabBarUtils.ts:148-162`
- title: The bar's leaf branch still keys a collapsed split by the dead root tab id, so the seam and the bar disagree and the badge undercounts
- evidence: round 1's W3 named the invariant "the seam, the bar, and the guard must key panes the same way" and listed the boundaries. The seam boundary is fixed: `firstPresentedPane()` traverses with `getAllSessionIds` and gates on `source.terminals.has(paneId)`, so the collapsed state `tabLayouts["A"] = leaf{sessionId:"B"}` with `terminals` holding `B` and not `A` now yields `B`. The `buildTabBarData` boundary is not. Its leaf branch reads `store.terminals.get(tabId)`, `inScope(scope, tabId)` and `tabIsWaiting([tabId], …)` — all keyed by `A`. Because `A` carries no attribution, `inScope(scope, "A")` is `true`, so the new `else if (!inScope(scope, tabId) && …)` count branch never fires for that tab even when the live leaf `B` is attributed elsewhere and waiting. Same invariant, same causal mechanism as round 1's W3, so it appends here rather than opening a new id. The `tabs` half of that branch is unchanged pre-existing code and is not flagged; the `hiddenWaiting` half is code this change introduced.
- impact: the seam removes the region (correct — the worktree does hold a live pane) while the bar draws no tab for it, and in the opposite scope the badge undercounts that hidden waiting tab. That is the under-report the badge exists to prevent, on the one tab shape where the two halves still disagree.
- suggestedFix: derive the live pane id in the leaf branch from `getAllSessionIds(layout)` — the sole leaf after a collapse — and use that id for the instance lookup, `inScope`, and `tabIsWaiting`. Add a `buildTabBarData` case for `tabLayouts["A"] = leaf{"B"}` covering both the presented and the hidden-waiting outcome. The existing `resolveTabDisplayPane` already encodes this fallback rule.
- status: open
- triage: pending

### W6 — WARN / HIGH / P2 / feature — new, inside the fix's impact cone
- agent: chair + asm-review-frontend (corroborated independently; frontend confirmed it empirically)
- class: feature
- file: `src/webview/emptyScopeRegion.ts:52-68`, `src/webview/main.ts:390,474-490`
- title: Routing the region through the render path rebuilds it from scratch on every redraw, dropping focus from its own offers
- evidence: `mountEmptyScopeRegion` unconditionally `remove()`s the standing region and builds a fresh element every call (`renderEmptyScopeRegion` constructs new buttons through `emptyState`), and `syncEmptyScope()` now runs at the tail of *every* `updateTabBar`. `updateTabBar` is called directly by the activity tracker on every status transition (`main.ts:113`), which `TerminalActivityTracker.project` fires edge-triggered on each `idle↔running↔waiting` change (`TerminalActivityTracker.ts:186-189`) — so an active agent in any *other* worktree toggles it about once per `OUTPUT_IDLE_WINDOW_MS`. Each rebuild also re-runs `worktreeController.launchOfferFor(...)`, whose `infoOf` `flatMap`s every repo's worktrees (`WorktreeController.ts:627`). This is new: before the fix, `mountEmptyScopeRegion` was reached only from selections, tree pushes, and the clear. Contrast `renderTabBar` in the same codebase, which deliberately reuses elements and only mutates what moved — including the badge added by this very change. No test guards it: `emptyScopeRegion.test.ts:123` asserts the region *count* and text after a second mount, never element identity. Confirmed empirically in jsdom by the frontend specialist: two `mountEmptyScopeRegion` calls with byte-identical deps yield `second !== first`, and `document.activeElement` falls back to `document.body` after the first region's button had focus. `OUTPUT_IDLE_WINDOW_MS` is 1500 ms, so an out-of-scope terminal produces two rebuilds per output burst — and when the scope is empty the only running terminals are by definition out-of-scope ones, which makes this the normal case rather than an edge. A single selection into an empty scope already mounts twice (`settleScope(true)`, then `renderIfMoved` → `render` → `syncEmptyScope`).
- impact: a keyboard user who has tabbed to "Open a terminal" loses focus to `<body>` whenever any background pane changes activity state; a pointer user can have the button replaced between `mousedown` and `mouseup`; a screen reader re-announces the re-inserted `role="region"` node each time. The region's whole purpose is to be interacted with, and it is now the least stable element on the surface. It also compounds round-1's S1 (nothing ever gives the region focus), which the user moved to audit-backlog.
- suggestedFix: make the mount idempotent the way `renderTabBar` is — if a region with the same label and the same offer set is already standing, leave the element in place and update only what changed; rebuild only when the scoped worktree or the offer set actually differs.
- status: open
- triage: pending

### S2 — SUGGEST / MEDIUM / P5 / feature — persists from round 1 (partially fixed)
- agent: chair + asm-review-frontend (corroborated)
- file: `src/webview/emptyScopeRegion.ts:53-61`
- title: The detached-container guard removes the standing region before it returns, so the blank-surface state moved rather than went away
- evidence: the fix correctly inserts before hiding. But line 53 removes any standing region unconditionally, ahead of the `parent === null` early return, and that return does not restore `container.style.display`. A container detached while a region stands therefore ends with no region and a still-hidden container — the exact state the fix was written to prevent.
- impact: unreachable in the shipped HTML (`#terminal-container` is a static child of the terminal area), so this is hygiene, not a live defect.
- suggestedFix: resolve `parent` and return before the `remove()`, or restore `display` on that return.
- status: open
- triage: pending

### S3 — SUGGEST / MEDIUM / P5 / machinery — persists from round 1 (still present)
- agent: chair
- file: `src/webview/tabBarScopeWiring.ts:171-176`
- title: An activating selection still draws the bar twice; the triage rationale is not borne out by the code, and the test still cannot observe it
- evidence: round-1 triage recorded S3 as "folded into B1's fix: the seam no longer renders behind `switchTab`'s own draw". `onSelectWorktree` is unchanged apart from `settleScope()` → `settleScope(true)`: it still activates before `renderIfMoved()`. When the active pane is out of scope, `settleScope(true)` → `deps.activatePane` → `activatePaneById` → `activatePane`'s `showTab` → `switchTab` (`main.ts:465`) → `updateTabBar` is draw one; `renderIfMoved` then sees a signature moved by the new scope and calls `deps.render()` for draw two. Each draw now also runs `syncEmptyScope`, so an activating selection costs three `buildTabBarData` passes, two `renderTabBar` calls and two region syncs. The guarding test (`tabBarScopeWiring.test.ts:659`) still passes because the harness's `activatePane` dep only records the id (`:137-140`) and never calls `draw()`, unlike production.
- impact: cosmetic cost; the stated one-draw invariant remains untrue and its test remains unable to fail on it.
- suggestedFix: either drop the claim and the comment, or record the signature before activation so the second call is a no-op — and make the harness's `activatePane` call `draw()` so the test can observe the real shape.
- status: open
- triage: pending

### W7 — WARN / HIGH / P3 / machinery — new
- agent: asm-review-frontend + chair
- class: machinery
- file: `src/webview/tabBarScopeWiring.test.ts:112-115`, `src/webview/main.ts:390`
- title: The production line that closes B1 has no test, and W3's regression test passed before the fix
- evidence: two gaps. (i) The harness's own `draw()` calls `seam.syncEmptyScope()` (`:115`), and all six new tests assert on `out.emptyScope` — the harness's record of the `showEmptyScope` dep. Delete `tabBarScope?.syncEmptyScope()` from `main.ts:390` and every one of them still passes: the single production line the whole B1/W2 fix hangs on carries no regression net, and no test asserts `#terminal-container.style.display` on any pane-arrival path (`emptyScopeRegion.test.ts` covers the mount in isolation only). The harness also calls `syncEmptyScope` *before* `renderTabBar` while production calls it after, under a comment claiming it does it "exactly as `main.ts` does it". (ii) The W3 test (`tabBarScopeWiring.test.ts:653-664`) does not discriminate: the pre-fix harness supplied `presentedPanes` as `[...tabLayouts.values()].flatMap(getAllSessionIds)` — already the correct traversal — while the real defect lived in `main.ts`'s deleted `panesInBarOrder`, which the harness never modelled. It was green against the pre-fix seam. The fix is real; the test does not prove it.
- impact: B1 and W2 — two findings that blocked round 1 — can silently regress with the suite green, and W3 carries no net at all. This is the coverage claim in the impact manifest ("each was checked to discriminate against the pre-fix code") not holding for two of the six.
- suggestedFix: add one test that drives the real `showEmptyScope` + `mountEmptyScopeRegion` pair and asserts `#terminal-container.style.display` is `""` after a pane arrives into a standing region. Give the W3 case the real `closeSplitPaneById` shape — `tabLayouts["A"] = leaf("B")` with `terminals` holding only `B` — so it fails against a tab-id-keyed traversal. Move the harness's `syncEmptyScope()` call after `renderTabBar`.
- status: open
- triage: pending

### S9 — SUGGEST / HIGH / P4 / machinery — new
- agent: asm-review-frontend
- file: `src/webview/main.ts:361-390`
- title: The region's only sync point sits behind the tab bar's early return
- evidence: `updateTabBar` returns at `:363-365` when `#tab-bar` is missing, before reaching `tabBarScope?.syncEmptyScope()` at `:390`. The fix's "single funnel every pane arrival passes through" is therefore conditional on an element with nothing to do with the terminal region.
- impact: none today — both ids are static in `webviewHtml.ts:761,769`, and `showEmptyScope` independently no-ops without `#terminal-container`. It is a latent coupling: a future surface rendering the terminal without a tab bar would silently lose the region's lifecycle and re-open B1.
- suggestedFix: hoist the call above the `!tabBarEl` guard, or move both into one `updateSurface()`.
- status: open
- triage: pending

## Audit backlog

- **S1 (round 1) — the region is never given focus.** User triage: real, and not this change's — no empty state in this webview manages focus, so fixing it here mints a focus-ownership rule the design does not own. Not gating. Re-listed here because W6 makes the surface it describes materially worse: focus is now actively taken *away* from the region as well as never given to it. Worth reconsidering together with W6's owner.

## Cleared on inspection

- `switchTab`'s `requestAnimationFrame(fitAllAndFocus)` can now run after the container has been hidden. `XtermFitService.fitTerminal` returns `null` on a zero-width parent rect, so no spurious PTY resize is issued. Not a defect.
- Re-entrancy `onSelectWorktree` → `settleScope(true)` → `activatePane` → `switchTab` → `updateTabBar` → `syncEmptyScope` → `settleScope(false)` terminates at depth 2 and cannot disagree with the outer call: `showEmptyScope(null)` is written before `activatePane`, and the nested call re-reads the same coordinator state. The redundant second mount is folded into W6.
- No security, auth, data-fetching, or persistence surface in this diff.

## Support review (Phase 2.5)

- Six regression tests added, one per accepted finding. Discrimination checked individually: the pane-appears, flag-off, re-attribution, exited-vs-live and instance-less-leaf tests each fail against the pre-fix behaviour at the seam level. The collapsed-split test does not — see W7. The load-bearing production wiring is untested — also W7.
- No `.only` / `.skip` in the changed test files. Assertions are synchronous.
- Contract migration verified exhaustively: three `TabBarScopeWiringDeps` construction sites (`main.ts:1092`, two harnesses), one production `shouldRender` call site, no surviving reference to `presentedPanes` or the `tabLayouts:` dep anywhere in `src/`, including `src/providers/` and `src/test/`.
- Task `2_1`'s Plan and Acceptance match what was built. `syncEmptyScope` owns no durable state, lifecycle, or external contract — not a new invariant owner.

---

## Author triage — round 2

| # | Status | Rationale |
|---|---|---|
| W3 | accepted | Confirmed: the leaf branch keys `terminals.get`, `inScope` and `tabIsWaiting` by the dead root tab id, so a collapsed split's live leaf is invisible to the scope decision. Round 1's fix closed the seam boundary only. The scope decision moves to the leaf's own `sessionId`; the NAME lookup stays keyed by `tabId`, which is pre-existing and not this change's. |
| W6 | accepted | Confirmed: `mountEmptyScopeRegion` rebuilds unconditionally, and the render funnel fires on every activity transition of any pane in the window. The mount becomes idempotent — same label and same offer set leaves the element, and its focus, alone. This also closes S1's surface: focus is no longer actively taken away. |
| W7 | accepted | Correct on both halves, and the second is a correction to my own manifest: the round-1 W3 test did not discriminate, because the pre-fix harness already supplied `presentedPanes` from `getAllSessionIds` while the real defect lived in `main.ts`'s deleted `panesInBarOrder`. The harness now drives a REAL container through `mountEmptyScopeRegion`, so the arrival paths assert `#terminal-container.style.display` rather than a dep spy. |
| S2 | accepted | The guard removed the region before its early return. Resolve the parent first, so a detached container leaves both the region and `display` untouched. |
| S3 | rejected | The second draw is `switchTab`'s own, and it is required: it is what shows the pane just made active. Suppressing it needs render coalescing across `main.ts`'s eleven `updateTabBar` call sites — a mechanism this change does not own and would have to introduce to satisfy a non-gating finding. Round 1's triage was wrong to record it as folded into B1's fix; it was not fixed then and is not fixed now. |
| S-early-return | accepted | `syncEmptyScope()` runs before `updateTabBar`'s `!tabBarEl` early return, so the region does not depend on an element unrelated to it. |
| S1 | closed by W6 | Never given focus stays out of scope; actively LOSING focus is fixed. |

