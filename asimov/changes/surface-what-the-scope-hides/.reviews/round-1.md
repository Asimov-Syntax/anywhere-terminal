# Review round 1 — surface-what-the-scope-hides

- Date: 2026-08-29
- Cycle: 1
- Mode: discovery
- Scope: commit range `7128f51c..HEAD`
- Head: `3ae8513f6c286ea127f3f5fc1c3bec9df46656e2` (working tree dirty in `asimov/changes/**` analytics only; no `src/` drift)
- Reviewable lines: ~490 (src, non-test)
- Verdict: **BLOCK** — 2 blocking, 5 warnings, 7 suggestions
- Split (gating blockers): 2 feature / 0 machinery
- Verify gate cited, not re-run: `.build/verified.ndjson` records `pnpm run check-types && pnpm run test:unit` exit 0 for all five tasks; workflow.md records the biome diff against a detached 7128f51c worktree (19 pre-existing, 0 new) and `gate:fs-deletion` green.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-frontend | empty-scope region lifecycle + `main.ts` wiring | React/DOM, rendering, a11y | opus[1M] |
| asm-review-logic | count union + render guard | logic, edge cases, races | gpt-5.6-terra[1M] |
| asm-review-contracts | spec delta, I19 registry, interface contracts | contracts, schema, patterns | sonnet[1M] |
| asm-review-frontend | badge DOM + CSS + a11y | rendering, a11y | gpt-5.6-luna[1M] |
| asm-review-reuse | duplicate hidden-count / predicate / traversal | reuse, duplication | gpt-5.6-luna[1M] |
| asm-review-performance | presence-push recompute | growth axes, hot path | gpt-5.6-luna[1M] |
| chair | full diff + full-flow trace | all | opus[1M] |

## Findings

### B1 — BLOCK / HIGH / P1 / feature
- agent: chair + asm-review-frontend + asm-review-contracts (corroborated, three independent)
- class: feature
- file: `src/webview/emptyScopeRegion.ts:52-62`, `src/webview/tabBarScopeWiring.ts:99-129`
- title: A pane created into a standing empty-scope region never takes it down; the terminal is created invisible
- evidence: `#terminal-container.style.display` is written in exactly one place (`mountEmptyScopeRegion`, `emptyScopeRegion.ts:60`) and cleared in exactly one (`mountEmptyScopeRegion(container, null)`), reachable only via `deps.showEmptyScope(null)` — that is, from `settleScope()` (call site: `onSelectWorktree` only, `tabBarScopeWiring.ts:142`) or `takeDownIfUnscoped()` (`:125-129`, early-returns while a scope is set). `grep -rn "terminal-container" src` confirms no other writer. The region's own primary offer posts `worktreeOpenTerminal` (`main.ts:491`); the host handler (`src/providers/WorktreeHost.ts:992-999`) calls `surface.openTerminal(path)` and does not change the selection. Return path is `onTabCreated` → `factory.createTerminal` → `switchTab` (`main.ts:420-468`), which sets the *instance* container to `display:block` and never touches the hidden parent — `SplitTreeRenderer` appends every pane inside `#terminal-container` (`SplitTreeRenderer.ts:67,170,186,218,251`). The subsequent tree push runs `applyTree`'s `finally` → `takeDownIfUnscoped()`, which sees a scope still set and does nothing. `settleScope()` is unreachable on this path. Same for "Launch an agent", the `+` button, `onSplitPaneCreated`, and restore-from-snapshot.
- impact: the user takes the region's advertised action, the pane is really created and becomes active, and the surface still reads "Nothing running in <branch>" over a `display:none` container. Keystrokes go to a terminal that cannot be seen. Only escape is clearing the scope (undoing the state the user chose) or re-selecting the worktree. This is the feature's headline flow, and no test in `tabBarScopeWiring.test.ts` or `emptyScopeRegion.test.ts` covers "region is up, a presented pane appears".
- suggestedFix: re-run the one calculation whenever the scope's presented-pane set can change — a wiring entry point called from the pane-arrival path (`onTabCreated` / `onSplitPaneCreated`), or re-settle inside `applyTree`'s `finally` when the scope is set and pane membership moved. Keep activation gated to the selection so a push never steals focus; the *region's visibility* must follow the same predicate the bar filters by.
- status: open
- triage: pending

### B2 — BLOCK / HIGH / P1 / feature
- agent: chair + asm-review-logic + asm-review-reuse (corroborated; reuse "Family B" is the same mechanism)
- class: feature
- file: `src/webview/tabBarScope.ts:265-289` vs `src/webview/TabBarUtils.ts:102-110`
- title: The render guard's hidden-waiting count and the badge's disagree on exited panes, so a badge change can be suppressed
- evidence: `signatureOf` keys the render decision on `hiddenWaitingFromPresence()`, which counts a hidden tab when *any* pane is in the presence `waiting` set, with no `exited` filter and no access to local `activityStatus`. `buildTabBarData`/`tabIsWaiting` (`TabBarUtils.ts:102-110`) excludes `instance.exited` before counting. Concrete divergence: scope `A`; one hidden split tab whose leaves are `X` (`exited === true`) and `Y` (`exited === false`, `activityStatus === "idle"`), both attributed to `B`. Presence first reports `waiting = {X}` → guard count `1`, badge `0`. Next push reports `waiting = {X, Y}` → guard count still `1` (byte-identical signature), badge *should* be `1`. `onAttribution` → `renderIfMoved` → `shouldRender` returns `false`, so `renderTabBar` never runs and the badge stays absent. Reachability is asserted by the change's own design.md D2: the presence set "can be overridden by a fresh hook turn report the webview never saw", which is exactly how a stale `waiting` row survives the webview's own `paneEvidenceReporter.forget` on exit (`main.ts:614`).
- impact: a hidden live pane needing a human goes unannounced — the precise under-report failure mode the change exists to prevent, and the second clause of the I19 invariant this change tags as covered. The mirror case (guard counts a pane the badge excludes) produces spurious redraws instead, which is the narrowed MODIFIED requirement failing in the other direction.
- suggestedFix: the render signature must move for every presence transition that can change `buildTabBarData().hiddenWaiting`. Either give the coordinator the same eligibility rule (`exited` + `activityStatus`) `tabIsWaiting` uses, or invert the ownership so `buildTabBarData` is the single producer of both the badge and the count fed into the signature. The design's own D2 principle — exactly one definition of "hidden waiting" — is currently stated but not implemented.
- status: open
- triage: pending

### W1 — WARN / HIGH / P2 / feature
- agent: asm-review-frontend (chair-verified)
- class: feature
- file: `src/webview/tabBarScopeWiring.ts:174-181`
- title: Turning the workbench flag off while the region stands leaves the terminal hidden
- evidence: `setWorkbench(false)` makes `scopedWorktreeId()` return `null` (`tabBarScope.ts:104-111`) but the handler calls only `panel().setWorkbench`, `coordinator.setWorkbench`, and `renderIfMoved()` — never `takeDownIfUnscoped()`. Reached at runtime from a config push in `main.ts`.
- impact: with the region up, disabling the feature leaves `#terminal-container` at `display:none` and the region mounted. Scoping reads as "off" while the surface is still fully filtered — the state D6's single-gate comment says must not exist. No selection can restore it (the panel no longer selects while off); recovery depends on a later `applyTree` arriving, which is not guaranteed once the worktree view is closed.
- suggestedFix: call `takeDownIfUnscoped()` inside `setWorkbench` before `renderIfMoved()`.
- status: open
- triage: pending

### W2 — WARN / HIGH / P2 / feature
- agent: asm-review-frontend + asm-review-contracts + chair
- class: feature
- file: `src/webview/tabBarScopeWiring.ts:99-117` (`settleScope` has one call site)
- title: A scope that loses its last pane by any route other than a selection shows no region and leaves an out-of-scope terminal on screen
- evidence: three paths. (a) Closing the scope's last pane — `removeTerminal` (`main.ts:551-561`) switches to `remaining[remaining.length - 1]`, a tab of another worktree, then `updateTabBar()`; the bar filters it out. (b) A presence push re-attributing the scope's only pane elsewhere — `onAttribution` (`:145-151`) calls `setAttribution` + `renderIfMoved` only. (c) Init with a persisted scope holding no pane — `wireTabBarScope` is constructed at `main.ts:1098` and nothing settles. In all three the user sees a visible terminal of a hidden worktree with an empty tab bar and no region.
- impact: the spec requirement is unconditional ("When a scope holds no pane, the surface SHALL present a region"; "The terminal region SHALL NOT continue to present a pane the scope hides"); the implementation satisfies it only at selection time. This is the filter failing openly on screen — the exact risk design.md D4's risk map claims to mitigate.
- suggestedFix: run the region's visibility test on every mutator (pane removal, attribution, tree push, init), not only selection. The "activation is not re-decided outside a selection" rule can stand independently.
- status: open
- triage: pending

### W3 — WARN / HIGH / P2 / feature
- agent: chair
- class: feature
- file: `src/webview/main.ts:471-477` (`panesInBarOrder`) vs `src/webview/tabBarScope.ts:276` (`getAllSessionIds`)
- title: A split collapsed onto its non-original pane is invisible to the selection calculation, so a live pane can be hidden behind the region
- evidence: `SplitTreeRenderer.closeSplitPaneById` (`:299-312`) writes `tabLayouts.set(tabId, leaf{sessionId: B})` and `terminals.delete(A)` when the pane the tab was named after is closed — the state `split/tabDisplay.ts` exists to handle ("closeSplitPaneById removes the leaf and deletes its terminal while keeping the tab, its id, and its remaining live leaves"). `panesInBarOrder` pushes `tabId` (`A`) for any non-branch layout and then filters on `store.terminals.has(A)` → the live leaf `B` is never reported. `hiddenWaitingFromPresence` reads the same layout through `getAllSessionIds` and correctly sees `B`. Three new traversals, two keying leaves by `tabId` and one by `sessionId`.
- impact: if the scoped worktree's only tab is such a collapsed tab, `settleScope` finds no presented pane, shows "Nothing running in <branch>", and sets `#terminal-container` to `display:none` while a live pane of that very worktree is running. The render guard meanwhile counts that tab, so guard and badge disagree about it too. (The bar already drops such a tab in unchanged code — `TabBarUtils.ts:147` reads `terminals.get(tabId)` — which is why this is reported as the new damage the container hide adds, not as the pre-existing bar bug.)
- suggestedFix: derive presented panes through `getAllSessionIds(layout)` for every layout type, falling back to `resolveTabDisplayPane`'s rule, so all three traversals key panes the same way.
- status: open
- triage: pending

### W4 — WARN / HIGH / P3 / machinery
- agent: asm-review-reuse (downgraded from BLOCK by chair — no concrete defect today)
- class: machinery
- file: `src/webview/tabBarScope.ts:174-181` (`presents`) vs `src/webview/TabBarUtils.ts:55-61` (`inScope`)
- title: The scope predicate the design says is shared is implemented twice
- evidence: `inScope()` and `TabBarScopeCoordinator.presents()` independently encode the same "presented unless proven elsewhere" rule. The bar filters through `inScope` (`TabBarUtils.ts:131,151`); the selection navigates through `presents` (`tabBarScopeWiring.ts:105,114`). design.md D3 states "The seam shares the coordinator's own scope predicate rather than restating 'in scope' — a second definition is how the bar and the activation come to disagree"; the code has two.
- impact: behaviourally equivalent today; a change to either makes the bar present a tab the selection calls hidden, or activate a pane the bar drops. This is the drift the design named and did not prevent.
- suggestedFix: export one predicate (TabBarUtils' `inScope` is the natural survivor — it already owns the bar's filtering) and have `presents()` call it.
- status: open
- triage: pending

### W5 — WARN / HIGH / P3 / feature
- agent: asm-review-logic
- class: feature
- file: `src/webview/TabBarUtils.ts:156-159`
- title: The leaf branch's `instance &&` guard suppresses a presence-backed count the split branch would raise
- evidence: the split branch calls `tabIsWaiting(sessionIds, store, waiting)` with no requirement that any leaf have a `TerminalInstance`, and `tabIsWaiting` accepts presence evidence for an absent instance (`instance?.exited` is falsy, `waiting.has(paneId)` is true). The leaf branch is `else if (instance && tabIsWaiting([tabId], store, waiting))`, so a hidden leaf with no store entry and a presence `waiting` row is dropped from both `tabs` and `hiddenWaiting`.
- impact: the two branches disagree about which evidence source counts, so a hidden leaf's waiting state is silently omitted across a terminal-map gap.
- suggestedFix: gate on hiddenness, not on instance presence — `else if (!inScope(scope, tabId) && tabIsWaiting([tabId], store, waiting))`.
- status: open
- triage: pending

### S1 — SUGGEST / MEDIUM / P4 / feature
- agent: asm-review-frontend
- file: `src/webview/emptyScopeRegion.ts:52-62`
- title: Focus is dropped to `<body>` when the region replaces the terminal
- evidence: hiding the ancestor removes xterm's focused textarea from the focus order; nothing moves focus into the region and the `role="region"` wrapper has no `tabindex`. No hidden-focus trap exists (`display:none` removes descendants from the tab order) — the failure is the opposite one.
- impact: a keyboard user's next keystroke goes nowhere; they must Tab from the document start to reach "Open a terminal".
- suggestedFix: `tabindex="-1"` on the region and `focus()` on mount, or focus the first action button.
- status: open
- triage: pending

### S2 — SUGGEST / MEDIUM / P5 / feature
- agent: asm-review-frontend
- file: `src/webview/emptyScopeRegion.ts:60-61`
- title: A detached container is hidden and no region is inserted
- evidence: `container.style.display = "none"` runs unconditionally; the insertion is optional-chained away when `container.parentElement` is null. Cannot fire in the shipped HTML (`#terminal-container` sits inside `.terminal-area`), but the ordering makes the failure mode "blank surface" rather than "no region". The fixed `empty-scope-region` id cannot collide across surfaces — each webview is its own document and the lookup is `container.ownerDocument.getElementById`.
- suggestedFix: resolve the parent before mutating `display`, and return early when it is null.
- status: open
- triage: pending

### S3 — SUGGEST / MEDIUM / P5 / machinery
- agent: asm-review-frontend (chair-verified)
- file: `src/webview/tabBarScopeWiring.ts:140-143`
- title: A selection that activates a pane draws the bar twice, contrary to the comment claiming one draw
- evidence: `settleScope()` → `deps.activatePane` → `activatePaneById` → `activatePane`'s `showTab` → `switchTab` (`main.ts:465`) calls `updateTabBar()` directly; `renderIfMoved()` then runs against a signature that just moved (the scope is in `signatureOf`) and fires `deps.render()` again. The test "costs one draw for the whole selection" (`tabBarScopeWiring.test.ts:641`) counts only the harness's `render` dep, which `switchTab` does not go through.
- impact: one extra `renderTabBar` per activating selection. Cosmetic, but the stated invariant is untrue and the wiring's other renders are carefully gated on it.
- suggestedFix: drop the claim, or record the signature before activation so the second call is a no-op.
- status: open
- triage: pending

### S4 — SUGGEST / HIGH / P4 / machinery
- agent: asm-review-reuse
- file: `src/webview/main.ts:471-477`
- title: Presented-pane order re-derives the traversal `buildTabBarData` already performs
- evidence: `panesInBarOrder()` iterates `store.tabLayouts`, expands branches with `getAllSessionIds`, and filters against `store.terminals`; `TabBarUtils.ts:117-159` performs the same walk while building the bar.
- suggestedFix: return the ordered pane ids from the bar's existing traversal, or extract one shared tab→pane expansion. Would also fix W3.
- status: open
- triage: pending

### S5 — SUGGEST / HIGH / P4 / machinery
- agent: asm-review-reuse
- file: `src/webview/worktree/WorktreeController.ts:616-626`
- title: `infoOf()` duplicates the tree lookup `generationOf()` and `repoFor()` already perform
- evidence: `infoOf` scans `this.tree.repos` calling `repo.worktrees.find(...)`; `generationOf` (`:629-631`) performs the same scan with `some()`, and `repoFor` (`:293-301`) locates the containing repo by worktree id.
- suggestedFix: one lookup returning the worktree plus its repo/generation, with `infoOf` and `generationOf` implemented from it.
- status: open
- triage: pending

### S6 — SUGGEST / MEDIUM / P5 / machinery
- agent: asm-review-logic
- file: `src/webview/paneAttribution.ts:42`, `src/webview/worktree/WorktreeController.ts:717-721`
- title: The report key's separator encoding is not injective over its declared types
- evidence: `waitingKey` joins on `U+0001` and `emitAttribution` joins the two halves on `U+0002`; pane ids are unrestricted strings at this seam and worktree ids are normalised absolute paths, which POSIX permits to contain those control characters. A pane id containing `U+0001` could make two distinct waiting sets share a key and suppress a report.
- impact: not reachable today — pane ids are host-generated (`crypto.randomUUID`) and never user-supplied. The pre-existing `attributionKey` uses the same scheme, so this is the new half inheriting an established pattern rather than introducing one.
- suggestedFix: if it is ever touched, length-prefix the fields instead of reserving separators.
- status: open
- triage: pending

### S7 — SUGGEST / MEDIUM / P5 / feature
- agent: asm-review-contracts
- file: `src/webview/worktree/WorktreeController.ts:606-614`
- title: `launchOfferFor` closes over the `WorktreeInfo` resolved at region-build time
- evidence: `openLaunchFor` re-derives `this.generationOf(info.id)` at click time, so the offer gate itself is not stale; but `info.branch` / `info.displayPath`, used for the dialog title, are whatever the tree held when the region was built.
- impact: cosmetic — a branch renamed while the region stands shows its old name in the launch dialog title.
- suggestedFix: read `infoOf` inside the closure if branch-rename-under-an-empty-scope is worth covering.
- status: open
- triage: pending

## Rejected

### R1 — asm-review-performance BLOCK: "waitingKey sorts the entire waiting-session set on every presence push"
Refuted with code. The agent's growth axis is wrong: `buildAttribution` (`WorktreeController.ts:691-693`) filters `rows.filter((r) => r.scope === "window")` and skips `row.paneId === undefined`, so `waiting` can only hold pane ids of *this window's own panes* — bounded by the tabs the user has open, not by accumulated agent-session rows. That is the same axis the pre-existing `attributionKey` already sorts on every push, unchanged by this diff. No scale defect.
- status: rejected
- triage: rejected by chair

## Support review (Phase 2.5)

- Tests: every new behaviour has a corresponding test file; no `.only` or `.skip` in the changed test files; assertions are synchronous DOM checks needing no `await`. Coverage gaps that matter are recorded inside B1 (no "a pane appears while the region stands" test), W1 (no "flag off while the region stands" test), W2 (no "scope loses its last pane" test), W3 (no collapsed-leaf-tab test), and S3 (the one-draw test does not observe `switchTab`'s own `updateTabBar`).
- Fixtures/seeds: none added. No PII or secrets in the new tests.
- Behavioral sources: `docs/DESIGN.md` § 8.4 I19 row is byte-identical to `registry.ts`'s `statement`, the planned-invariant table was removed, `owners` matches the registry's contract, and both conjuncts carry `[I19]`-tagged tests in `TabBar.test.ts`. Verified by asm-review-contracts. `docs/PLAN.md` WT-010.2 status moved to `in_progress`; the WT-009.x note edit is an unrelated but harmless doc change carried in the range.
- CSS/a11y: `.tab-scope-badge` uses `--vscode-editorWarning-foreground`, matching `.tab-status-waiting` (`webviewHtml.ts:180-183`); no animation reaches it; `aria-label` on `.tab-scope-clear` is rewritten on every scoped render and stays in sync with the visible count; `:last-child` correctly targets "Show all tabs" with and without the launch offer. Verified by asm-review-frontend (luna) — no findings.

---

## Author triage — round 1

Each finding verified against the code before triage. No finding was accepted on the report alone.

| # | Status | Rationale |
|---|---|---|
| B1 | accepted | Confirmed: `showEmptyScope(null)` is reachable only from `settleScope` (selection) and `takeDownIfUnscoped` (early-returns while scoped). Creating a pane into a standing region leaves it up over a hidden container. |
| B2 | accepted | Confirmed: `hiddenWaitingFromPresence` has no `exited` filter, `tabIsWaiting` does. The guard and the badge can disagree, and the disagreement suppresses the render. |
| W1 | accepted | Confirmed at `tabBarScopeWiring.ts` `setWorkbench` — no take-down on the flag going off. |
| W2 | accepted | Same defect as B1 seen from the other side; the fix is the same one calculation, re-run wherever the presented set can move. |
| W3 | accepted | Confirmed: `panesInBarOrder` pushes `tabId` for a non-branch layout, so a split collapsed onto its non-original pane reports nothing. |
| W4 | accepted | Confirmed: `inScope` and `presents` are two encodings. D3 says the seam shares the coordinator's predicate; making `presents` delegate to the exported `inScope` is what the design already asked for. |
| W5 | accepted | Confirmed: the leaf branch's `instance &&` guard suppresses a count the split branch raises on the same evidence. |
| S1 focus | audit-backlog | Real, and not this change's: no empty state in this webview manages focus, so fixing it here mints a focus-ownership rule the design does not own. Recorded, not fixed. |
| S2 detached container | accepted | One-line ordering fix — insert before hiding, so a detached container cannot leave a blank surface. |
| S3 double draw | accepted | Folded into B1's fix: the region now syncs from the render path, and the seam no longer renders behind `switchTab`'s own draw. |
| S4 traversal | accepted | Fixed by W3's fix — the seam derives presented panes from the same `getAllSessionIds` traversal `buildTabBarData` uses. |
| S5 `infoOf` | accepted | `repoFor` already exists; `infoOf` reuses it. |
| S6 separator | rejected | Inherited from the pre-existing `attributionKey`, unreachable (ids are `randomUUID`), and narrowing the encoding moves a contract this change does not own. |
| S7 stale dialog title | accepted | The offer resolves the `WorktreeInfo` when it is taken, not when the region is built. |
