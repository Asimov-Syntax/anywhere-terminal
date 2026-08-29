# Review round 1 — scope-tabs-to-the-selected-worktree

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: discovery
- **Head**: `7bcac8cc28d6e5e29f045382ecd55f4530ac5de9` (clean tree; range reviewed `6cd31e8c..HEAD`, ten commits `b20355f0`..`7bcac8cc`)
- **Reviewable lines**: ~760 added/modified across reviewable + behavioral files (test and docs files excluded)
- **Verdict**: REJECT
- **Counts**: 3 BLOCK · 3 WARN · 8 SUGGEST
- **Split over gating blockers**: 3 feature / 0 machinery — no premise audit triggered
- **Verify-gate evidence** (not re-run by review, per chair rules): `workflow.md` records `check-types`, `pnpm run test:unit` (4955 pass) and `gate:fs-deletion` green; `biome check src` exits 1 on 20 findings all present on the base commit.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | `tabBarScope.ts` + `WorktreeController` + `WorktreeView` selection | state machine | opus[1M] |
| asm-review-frontend | `TabBarUtils` chip/render, `webviewHtml`, `worktreePanel.css`, `worktreeTreeView` | rendering, a11y | gpt-5.6-terra[1M] |
| asm-review-contracts | settings → init → router → state key → `WorktreeActionKind` → I18 | contract surface | sonnet[1M] |
| asm-review-logic | `main.ts` wiring | ordering, lifecycle | gpt-5.6-terra[1M] |
| asm-review-performance | signatures, attribution rebuild | growth axes | gpt-5.6-luna[1M] |
| asm-review-reuse | new module + copied transport + CSS split | duplication | gpt-5.6-luna[1M] |
| chair | full diff, full-flow trace, 3 scratch probes | all | opus[1M] |

---

## Findings

### B1 — BLOCK · HIGH · P1 · agent: asm-review-logic + chair · class: feature

**The scope chip names the wrong worktree, or names an absolute path**
`src/webview/tabBarScope.ts:193-206` (`setScope`), read with `:89-92` (`scopedLabel`)
Status: open · Triage: pending

**Evidence.** `applyTree` is the only writer of `scopeLabel`, and `setScope` nulls it only on the `null` branch. `select()` carries no label. Chair probe (scratch, created and deleted in one command) confirmed both cases:

- `select(A)` with no intervening tree push → `scopedLabel()` returns `A` — and `WorktreeInfo.id` is the *normalized absolute worktree path* (`src/worktree/types.ts:8-10`). Because `applyTree` early-returns while `scope === null`, `scopeLabel` is always `null` before the first selection, so **every first selection renders a filesystem path in the chip**.
- `select(A)` → push → `select(B)` → `scopedWorktreeId()` is `B` while `scopedLabel()` is still `"feat/a"`. The chip names A while the bar filters by B.

Corrected on the next tree push (chair probe 3: `shouldRender` returns `true` in both cases, because the scope field itself moved and `main.ts`'s direct `updateTabBar()` records no signature). The window is one presence scan — `EXTERNAL_SCAN_INTERVAL_MS = 5_000` (`src/providers/WorktreeHost.ts:63`) — which is exactly the interval in which the user reads the chip they just caused.

**Impact.** Violates the accepted spec `specs/tab-bar-component/spec.md`, "A scope is named wherever it is in force", scenario *The chip is present exactly while the filter is* — "the chip is present while scoped, **naming that worktree**". Also violates `docs/design/worktree-scope.md` § 4.1 ("naming the scoped worktree's branch") and the coordinator's own doc comment ("never the path — the panel forbids a path on a row"). The chip is the only on-screen statement that the tab list is a subset; a chip naming a *different* worktree inverts the user's model of what is hidden. `tabBarScope.test.ts:423` pins the id fallback for a persisted scope no tree has confirmed; nothing covers the selection path, which is the common one.

**Fix.** Make the label move with the scope: pass `(worktreeId, label)` from `WorktreeView.onSelectWorktree` through `WorktreeController` into `select(id, label)`; or null `scopeLabel` unconditionally in `setScope` and re-resolve it from the last tree the coordinator saw. (Retaining the *tree* is not the rejected D7 attribution cache — that rejection is about attribution.)

**Status:** accepted
**Triage:** Reproduced with a scratch probe before triage: `select("/a")` before any tree renders the chip as `/a` — the normalized absolute path — and `select("/b")` after a tree leaves `scopedLabel()` at `feat/a` while `scopedWorktreeId()` is `/b`. Both violate the accepted scenario "the chip is present while scoped, naming that worktree", and the first also violates worktree-panel-ui.md § 3.2's no-path rule that the chip inherits. Fixing by carrying the label WITH the selection rather than only from `applyTree`.

### B2 — BLOCK · HIGH · P1 · agent: asm-review-logic ×2 + chair · class: feature

**Clearing the scope from the chip leaves the panel marking that worktree selected, and re-clicking it is a dead click**
`src/webview/worktree/WorktreeView.ts:390-397` with `src/webview/main.ts:372-375`
Status: open · Triage: pending

**Evidence.** `WorktreeView.selectedWorktreeId` and `TabBarScopeCoordinator.scope` are two copies of one fact with exactly one synchronising edge — view → coordinator. The chip's `onClear` calls `tabBarScope?.clear(); updateTabBar();` and nothing else. Chair probe 2 (jsdom, real `WorktreeView` + real coordinator wired as `main.ts` wires them) confirmed: after a chip clear the row still carries `aria-selected="true"` and `.wt-card`, and clicking that same row hits `select()`'s guard `this.selectedWorktreeId === worktreeId` → returns `false`, no callback fires, scope stays cleared.

Two further divergences on the same pair:

- Reload with a persisted scope: the coordinator holds it (`tabBarScope.ts:61-62`) while the view is "never seeded" — tabs are filtered and the chip is drawn while the panel marks nothing.
- D9's propagating `updateState` throw: `WorktreeView.select` sets `selectedWorktreeId` **before** invoking the callback (`:394-395`), so a throw out of `setScope` leaves a permanent phantom selection that also cannot be re-selected.

**Impact.** Violates the accepted spec `specs/worktree-panel/spec.md`, "The selected worktree is the only one marked as selected" — "Where no worktree is selected, no worktree SHALL carry it." The panel asserts a selection that scopes nothing, and the user's only recovery is to select a *different* worktree and come back.

**Fix.** Give `WorktreeView` a public `clearSelection()` (clear the field + repaint, without re-firing `onSelectWorktree`), expose it through `WorktreeController`, and call it from the chip's `onClear`. Set the view's field *after* the callback returns so a throw leaves both copies unmoved.

**Status:** accepted
**Triage:** Confirmed by reading: `WorktreeView.selectedWorktreeId` is written by `select()` and cleared only by `pruneStaleState`, and the chip's `onClear` reaches only the coordinator. The spec clause is explicit — "Where no worktree is selected, no worktree SHALL carry it" — and the dead re-click is worse than the stale mark. The clearing path needs to reach the view, which design.md's architecture diagram never drew; the DECISION (D5: the card marks selection) is unchanged, so this is the missing mechanism for an accepted requirement, not a redesign. Diagram updated with the fix.

### B3 — BLOCK · HIGH · P1 · agent: asm-review-contracts + asm-review-reuse · class: feature

**The rollout flag never reaches the editor surface, and the type checker cannot see it**
`src/providers/TerminalEditorProvider.ts:929-932` (`postRowActivation`), `:965-977`, `:1008-1020`, `:1059-1071` (three `init` payloads), and the absent `affectsWorktreeWorkbench` listener at `:335-346`
Status: open · Triage: pending

**Evidence.** `InitMessage.worktreeWorkbench` is declared **required** (`src/types/messages.ts:1146-1151`). All three editor-provider `init` sends set `worktreeRowActivation` and omit `worktreeWorkbench`. `check-types` passes only because `safeSendWithRetry(message: unknown, ...)` (`:1109`) and `safePostMessage(message: unknown)` type the payload as `unknown`, so the literal is never checked against `InitMessage`. There is no `affectsWorktreeWorkbench` listener in the editor provider, and its `postRowActivation()` was not extended the way `TerminalViewProvider.postRowActivation` was (`TerminalViewProvider.ts:1453-1456`). The editor provider *does* mount the worktree host (`:181`, `:383`, `:970`), so the panel itself works there.

**Impact.** On an editor surface `msg.worktreeWorkbench` arrives `undefined` at runtime; `deps.workbench === true` is false and `WorktreeView`'s `workbench?.() !== true` gate is false, so the whole feature is silently inert — including for a user who enables the setting while an editor tab is already open, since no live message follows either. Contradicts D6 ("follows the `rowActivation` path exactly"). No test covers it: `TerminalEditorProvider.test.ts` has no occurrence of `worktreeWorkbench`.

**Fix.** Add `worktreeWorkbench: readWorktreeWorkbench()` to all three editor init payloads, add the `affectsWorktreeWorkbench` configuration listener, and extend the editor's `postRowActivation()` to post it. Separately, narrow `safeSendWithRetry`/`safePostMessage` to `ExtensionToWebViewMessage` so the next omission is a compile error.

**Status:** accepted
**Triage:** Confirmed: `TerminalEditorProvider.ts` has three init branches carrying `worktreeRowActivation` and none carrying `worktreeWorkbench`, and no `affectsWorktreeWorkbench` listener beside its `worktreeRowActivation` one. `safePostMessage(message: unknown)` is why `check-types` stayed green on a required field. 1_1's Plan named only `TerminalViewProvider.ts`, which is the plan's error and mine for not looking for a second provider.

### W1 — WARN · HIGH · P2 · agent: asm-review-logic ×2 + chair · class: feature

**A persisted scope filters tabs before any tree has confirmed it — indefinitely while the panel is hidden**
`src/webview/tabBarScope.ts:54-63` and `:140-147`, with `src/webview/main.ts:837-845`
Status: open · Triage: pending

**Evidence.** Routes by which the coordinator holds a scope naming a worktree absent from the tree the surface holds: (a) constructed from persistence and already effective at init's `updateTabBar()`, before any `applyTree`; (b) `setWorkbench(true)` re-arms a persisted scope and calls only `shouldRender`, never `applyTree` — and every tree seen during the off period was skipped by `applyTree`'s `!this.workbench` early return. Chair probe C confirmed (b): with the flag off, a tree push not containing `/wt/gone`, then `setWorkbench(true)` → `isScoped()` is `true`, label is the raw path, no drop notice. Duration is "until the next tree push", and the host "pushes nothing to a surface that has not declared the view visible" (`src/providers/WorktreeHost.ts:244`, gated at `:1412`) — with the vault on the sessions view or collapsed, no push arrives.

**Impact.** Contradicts the accepted spec line "A persisted scope naming a worktree absent from the tree the surface now holds SHALL resolve to unscoped." Bounded rather than blocking: the empty/stale attribution map usually fails open, and the chip plus its clear control remain reachable. But the surface is filtered by something nothing validated, with no "scope cleared" notice.

**Fix.** Treat a persisted scope as *unconfirmed* until the first `applyTree` — leave `effectiveScope()` `undefined` until a tree has been seen — and re-resolve against the controller's latest tree on the disabled→enabled transition.

**Status:** accepted
**Triage:** A spec clause, not a preference: "A persisted scope naming a worktree absent from the tree the surface now holds SHALL resolve to unscoped." Filtering on a value no tree has confirmed does exactly what the clause forbids, and the visibility gate means a hidden panel never resolves it. Treated as must-fix despite the WARN severity.

### W2 — WARN · MEDIUM · P3 · agent: asm-review-logic · class: feature

**`reportScopeCleared` pushes against the pre-update tree, double-repainting the panel on every drop**
`src/webview/worktree/WorktreeController.ts:903-910` with `src/webview/main.ts:828-829`
Status: open · Triage: pending

**Evidence.** `main.ts` runs `tabBarScope.applyTree(msg.tree)` before `worktreeController.handleTreeResponse(msg)` (correctly, per D7). `applyTree` → `onScopeDropped` → `reportScopeCleared` → `push()` renders with `this.tree` / `this.presence` still holding the **previous** envelope — the one that still contains the departed worktree. `handleTreeResponse` then pushes again. Two full `repaint()`s inside one message, which is the exact cost `WorktreeView.select`'s own comment cites ("two repaints for one click would rebuild the tree twice and throw focus away in between"), and the notice is momentarily anchored to the live row of the worktree it says is gone.

**Fix.** Queue the drop rather than pushing from it: record the pending `scope` result and let `handleTreeResponse`'s existing `push()` emit it.

**Status:** accepted
**Triage:** Cheap and strictly better — the notice is deferred until the controller holds the tree that dropped the scope, which removes both the doubled repaint and the moment the notice is anchored to the live row of the worktree it calls gone.

### W3 — WARN · HIGH · P3 · agent: asm-review-reuse + asm-review-performance · class: feature

**The attribution encoding is implemented twice, byte-identically, in two files**
`src/webview/tabBarScope.ts:181-184` and `src/webview/worktree/WorktreeController.ts:682-686`
Status: open · Triage: pending

**Evidence.** Both sort `Map<paneId, worktreeId>` by key and join with the same NUL/SOH separator pair; both were introduced by this change. `emitAttribution` already suppresses the no-change case before the coordinator is told, so `signatureOf` re-does an O(n log n) sort/join of an unchanged map on every push (≈12/min per open surface).

**Impact.** A change to the canonicalisation in one copy and not the other makes the controller's dedup key and the coordinator's render signature disagree about what counts as a moved attribution — producing either spurious renders or a missed invalidation.

**Fix.** Extract one shared attribution-signature helper and call it from both; or have `emitAttribution` pass its already-computed key alongside the map so `signatureOf` reuses it.

---

**Status:** accepted
**Triage:** Two byte-identical canonicalisers deciding the same question in two files is exactly the drift the finding describes. Extracted to one exported helper the dedup key and the render signature both call.

## Triage of the suggestions

All eight accepted. Three are structural and land in this round because the blockers depend on
them; five are cheap and land beside them.

- **The `main.ts` residue (P2)** — accepted, and taken first: B1, B2 and W1 all live in the four
  things D8 left in the bootstrap, and none of their fixes could be proved without a seam. Extracted
  as `src/webview/tabBarScopeWiring.ts`, driven in tests by the real view, controller and coordinator
  together. D8's decision is unchanged — this is where its "leaves `main.ts` as wiring" actually
  lands.
- **`scopedLabel()` outside the signature (P4)** — accepted the chair's reading: cheap to remove
  rather than accept, and it cannot cause a spurious render. The 1_6 test that pinned the old
  behaviour is rewritten, and the rename case now redraws.
- **`selectedWorktreeId` third copy (P4)** — accepted; B2's fix collapses it rather than adding a
  fourth writer.
- **`role="group"` on the chip (P3)**, **`position: sticky` on the chip (P4)**, **filter to
  `scope === "window"` once (P4)**, **`.wt-group` losing its container treatment (P4)**, and
  **editor-provider tests (P4)** — all accepted and fixed.

## Audit backlog triage

- `docs/design/worktree-scope.md` § 8's "last attribution stands" row: accepted, and fixed at
  Blueprint Sync rather than deferred. It is the same contradiction I corrected in § 3.4 during
  planning and missed one table below; leaving it is what would produce the fourth pass the finding
  predicts.

## Also found

- **SUGGEST · MEDIUM · P4 · chair + asm-review-logic** — `src/webview/tabBarScope.ts:180-191`: `scopedLabel()` is outside `signatureOf`, so a **branch rename** of the scoped worktree leaves the chip naming the old branch until an unrelated render. Pinned deliberately at `tabBarScope.test.ts:281-298`. Chair verdict on the reporter's question: **narrowly defensible** — the chip still names the correct worktree by a stale name, materially unlike B1's naming a *different* worktree, and the accepted "A push that moves no attribution redraws no tab bar" requirement is about attribution. But adding `this.scopedLabel() ?? ""` as a fourth signature field cannot cause a spurious render (the label moves only when the tree says so), so the tension is cheap to remove rather than accept. Status: open.
- **SUGGEST · HIGH · P3 · asm-review-frontend** — `src/webview/TabBarUtils.ts:202`: `.tab-scope` is a plain `div`; `aria-label` on an implicit generic role is not a dependable accessible name, so a screen-reader user can meet the branch text and a "Clear … scope" button without being told the list is filtered. Give it `role="group"` with the existing label. Status: open.
- **SUGGEST · MEDIUM · P4 · asm-review-frontend + chair** — `#tab-bar` is `overflow-x: auto`; with many tabs the chip — the sole *visual* escape hatch — can scroll out of view. It stays keyboard-reachable. Consider `position: sticky; left: 0`. Status: open.
- **SUGGEST · MEDIUM · P4 · asm-review-performance (chair-refuted as BLOCK)** — `src/webview/worktree/WorktreeController.ts:656`: `buildAttribution` walks every row in `rowsByWorktreeId`, including `external` ones, to discard them; the external collection is uncapped and re-scanned every 5 s. **Refuted as a growth-axis BLOCK**: `WorktreeView` already renders every row in that same collection on every push (`worktreeTreeView.ts:555`, `WorktreeView.ts:606`), so this is a constant-factor pass over data already fully traversed, not a new axis. Retained as a cheap win (filter to `scope === "window"` once). Status: open.
- **SUGGEST · MEDIUM · P4 · asm-review-logic** — `src/webview/worktree/WorktreeController.ts:222-224`, `:876-886`: `selectedWorktreeId` is a **third** copy of the selection; `setWorkbench(false)` refreshes the view but leaves the mirror set, so `selectedWorktree()` reports a selection while D6 says the feature is inert. Nothing reads it today. Status: open.
- **SUGGEST · MEDIUM · P4 · chair** — `src/webview/worktree/worktreePanel.css:184-193`: with the workbench **on**, an expanded-but-unselected worktree gets only `.wt-group` (margin + padding), losing the border and background that made grouping legible. D5 says grouping is "kept, as a quieter container". `asm-review-frontend` judged spacing-only sufficient and no applied spec mandates a visual treatment, so this is downgraded to a design-intent note rather than a defect. Status: open.
- **SUGGEST · MEDIUM · P4 · asm-review-contracts** — `src/providers/TerminalEditorProvider.test.ts` has no `worktreeWorkbench` assertion; B3's gap is untested as well as unimplemented. Port the equivalents from `TerminalViewProvider.worktree.test.ts`. Status: open.
- **SUGGEST · HIGH · P2 · chair** — **the `main.ts` residue is load-bearing, and this round is the evidence.** D8's tradeoff (move everything testable into `tabBarScope.ts`, leave `main.ts` as wiring) is sound, but the four things it left there — `applyTree`-before-`handleTreeResponse`, `scopeChip()`'s label→chip mapping, the `shouldRender` gate, and the flag-flip path — are precisely where B1, B2 and W1 live. Each is a cross-object defect that no `tabBarScope.test.ts` test could have caught, because each needs the *view*, the *controller* and the *coordinator* in one place. Recommend a thin composition seam — extract the wiring block into an exported `wireTabBarScope({ coordinator, controller, render })` that `main.ts` calls and a test can drive — rather than either testing `main.ts` or accepting the gap. Status: open.

## Support review (Phase 2.5)

- No `.only` / `.skip` / `xit` introduced. Async assertions awaited. No PII or secrets in fixtures.
- `I18` verified end to end: the statement in `src/test/invariants/registry.ts` and `docs/DESIGN.md` § 8.4 match verbatim (enforced by an exact-string check in the invariants coverage test), the Planned-table edit drops only the I18 row, and the covering tag `[I18]` is on `src/webview/TabBar.test.ts:657`. The `workflow.md` note is accurate: the coverage reporter treats any filtered run as partial, which is why the task's Verify was retargeted to the unfiltered `pnpm run test:unit`. The registry's `"covered"` claim is genuinely enforced.
- `WorktreeActionKind`'s new `"scope"` member is handled in every exhaustive site found (`titleForAction`, `WorktreeView.buildActionNotice:1330-1341`); no path forwards it to a host handler, so the proposal's "Must not — send scope to the host" holds.
- `WebviewStateStore.updateState` (`:210-214`) is a shallow merge, so `worktreeScope: undefined` correctly overwrites and unrelated keys survive. `WebviewState` has no versioning mechanism for any key, so the new key is not inconsistent with precedent.
- `readWorktreeWorkbench()`'s `=== true` strictness matches the `rowActivation` defaulting discipline and the `package.json` declaration.

## Audit backlog

- `docs/design/worktree-scope.md` § 8, row "Presence degraded for the pane source", still reads "Last attribution stands; scope is not recomputed from an empty result" — the "last good attribution" cache that § 3.4 and design.md D7 both explicitly reject, twice. The file is outside this diff (docs are not reviewed), and D7 records the rejection so a third pass does not re-propose it — but the owning blueprint's own edge-case table still states the rejected behaviour, which is where a fourth pass will read it. Non-gating; carry into the next discovery.

## Not findings (checked, clean)

- `buildAttribution`'s contested-set logic is correct for every ordering of `Object.entries(rowsByWorktreeId)`: `contested` is sticky, the deletion pass runs after the full walk, a duplicate under the same worktree is excluded by `held !== worktreeId`, and three claimants stay contested from the second onward.
- `renderTabBar`'s chip reconciliation is sound: `existingTabs` collects only `.tab-item` divs so it never captures the chip; the cursor walk inserts the chip first when scoped and removes it before tab reconciliation when unscoped; the post-`+` tail-trim cannot reach it.
- `shouldRender`'s recorded signature never causes a *missed* render for the scope/attribution/membership fields — chair probe 3 confirmed both the fresh-selection and re-select cases re-render on the next push. The direct `updateTabBar()` calls in `main.ts` can only make a later `shouldRender()` over-report.
- `onScopeDropped` cannot fire before `worktreeController` is assigned: the constructor only reads persisted state, and `applyTree` runs later from the router.
- `scopedLabel()` / `effectiveScope()` / `isScoped()` cannot diverge — all three are `null`/`undefined` under exactly the same condition, so tabs cannot be filtered without a chip.
- `aria-selected` sits on `role="treeitem"` rows under a `role="tree"` container, and the `role="none"` wrapper is semantically transparent.
- No new reimplementation of an installed dependency; no generic boolean-setting reader existed for `readWorktreeWorkbench` to reuse; no shared `WorktreeTree`-by-id lookup helper existed for `applyTree` to reuse.
