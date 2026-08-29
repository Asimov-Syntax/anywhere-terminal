# Review round 2 — scope-tabs-to-the-selected-worktree

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: verification (fastlane)
- **Head**: `77ebd25e79fe61821820d375fffa72a5ea5183f5` (clean tree apart from two asimov analytics files; fix diff reviewed `7bcac8cc..HEAD`, two commits `fa3d2b14` + `77ebd25e`)
- **Reviewable lines**: ~300 added/modified across reviewable files (tests, docs and asimov artifacts excluded)
- **Verdict**: BLOCK
- **Counts**: 1 BLOCK · 5 WARN · 4 SUGGEST · 4 audit-backlog
- **Scope lock**: PASSED. The diff since round-1's Head is remediation only — task `2_1` under a new "Round-1 review fixes" heading, plus a `design.md` D8 paragraph recording where the wiring now lives. `tabBarScopeWiring.ts` is new production code but was the round-1 P2 suggestion, accepted; it holds no durable state, no lock discipline, no process lifecycle and no external contract, so it mints no new invariant owner. No handback.
- **Verify-gate evidence** (not re-run by review, per chair rules): `.build/verified.ndjson` records task `2_1` at `cmd: pnpm run check-types && pnpm run test:unit`, `exit: 0`, tree `dfaa452b`. `workflow.md` records `test:unit` 4977 pass and `gate:fs-deletion` green; `biome check src` exits 1 on 17 findings, none in the 28 touched files.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | `tabBarScope.ts` + `tabBarScopeWiring.ts` + the view/controller selection edge | state machine, ordering, re-entrancy | opus[1M] |
| asm-review-frontend | `WorktreeView`/`WorktreeController` selection ownership, chip render, CSS | rendering, a11y | gpt-5.6-terra[1M] |
| asm-review-contracts | providers' init payloads, `ExtensionToWebViewMessage` narrowing, router | contract surface | sonnet[1M] |
| chair | full fix diff, impact cone, spec deltas, 0 scratch probes (all findings read from source) | all | opus[1M] |

---

## Verification of round-1's findings

| ID | Round-1 severity | Verdict this round |
|---|---|---|
| B1 | BLOCK | **CONFIRMED FIXED** |
| B2 | BLOCK | **PARTIALLY FIXED** — the named half stands; the ordering half did not land (V1) |
| B3 | BLOCK | **PARTIALLY FIXED** — runtime closed; the type guard was applied to the wrong function (V0) |
| W1 | WARN | **CONFIRMED FIXED** |
| W2 | WARN | **PARTIALLY FIXED** — ordering closed; the doubled repaint stands (V5) |
| W3 | WARN | **CONFIRMED FIXED** |
| 8 suggestions | SUGGEST | 7 confirmed applied; 1 (`role="group"`) applied and verified; residuals in V6–V9 |

**B1 — confirmed fixed, at the invariant level.** `labels` is rebuilt whole on every `applyTree`; `setScope` resolves `scopeLabel` from it, so the label moves with the scope. The three boundaries the finding's inventory named are each closed: first selection before any tree (unreachable — a row can only be clicked from a tree the coordinator already saw, and if `labels` lacked the id `resolved` is `false`, so `scopedLabel()` returns `null` and no chip is drawn rather than a path being shown); a second selection (label rewritten in `setScope`); a rename (label joined the render signature, `tabBarScope.test.ts` "draws for a tree that renamed the SCOPED worktree"). The absolute-path fallback at `tabBarScope.ts:244` is now structurally unreachable as an on-screen value.

**W1 — confirmed fixed.** No state exists where `resolved === true` while the last tree lacked the scope: the only writers are `applyTree` (true only on a `labels.get` hit; false on every miss, flag off included) and `setScope` (`labels.has`). The hole the author asked about — a surface whose panel is never made visible, so no tree ever arrives — is real and is the *intended* resolution: the bar stays unfiltered, which is what the accepted spec clause requires ("a persisted scope naming a worktree absent from the tree the surface now holds SHALL resolve to unscoped"). `applyTree(null)` returning before touching `labels`/`resolved` is correct — the message type declares `tree: WorktreeTree` non-nullable, so that branch is defensive only, and no tree is no new information.

**W3 — confirmed fixed.** One exported `attributionKey()` in `paneAttribution.ts`, called by both the controller's dedup key and the coordinator's signature. The second half of the suggested fix (reuse the already-computed key rather than recomputing it in `signatureOf`) was not taken, but the drift risk the finding was actually about is gone. Not re-reported.

---

## Findings

### V0 — BLOCK · HIGH · P1 · agent: asm-review-contracts + chair · class: feature

**B3 persists: the type guard was applied to `safePostMessage`, but every `init` goes through `safeSendWithRetry`, which is still `unknown` — on both providers**
`src/providers/TerminalEditorProvider.ts:1141` and `src/providers/TerminalViewProvider.ts:1679-1684`, with the six init sends at `TerminalEditorProvider.ts:988`, `:1032`, `:1084` and `TerminalViewProvider.ts:1502`, `:1557`, `:1619`
Status: open · Triage: pending

**Evidence.** Round-1 B3 named the mechanism precisely: "`check-types` passes only because `safeSendWithRetry(message: unknown, ...)` (`:1109`) and `safePostMessage(message: unknown)` type the payload as `unknown`". The fix narrowed `safePostMessage` in both providers to `ExtensionToWebViewMessage`. **No `init` payload passes through `safePostMessage`.** All six `init` literals — three per provider — are arguments to `safeSendWithRetry`, whose signature is untouched by this diff:

```ts
// TerminalEditorProvider.ts:1141
private async safeSendWithRetry(message: unknown, maxRetries = 2, shouldAbort?: () => boolean): Promise<boolean>
// TerminalViewProvider.ts:1679-1684
private async safeSendWithRetry(webview: vscode.Webview, message: unknown, maxRetries = 2, ...): Promise<boolean>
```

Deleting `worktreeWorkbench` from any of the six `init` object literals today still type-checks clean, exactly as it did before this round. Verified independently by the chair (`grep -n "safeSendWithRetry(" ` on both files) after the specialist raised it.

Two further surfaces now assert the opposite:
- The new doc comments on both `safePostMessage` methods (`TerminalEditorProvider.ts:1118-1123`, `TerminalViewProvider.ts:1657-1662`) state "The union is what makes an omission a compile error rather than a surface that is silently inert." False for `init`.
- Task `2_1`'s Plan step 5 and the author's impact manifest item 4 both state the narrowing "is the type change that makes a missing required init field a compile error." Also false.

**Impact.** The runtime half of B3 *is* fixed and tested — `worktreeWorkbench` reaches all three editor init branches, the `affectsWorktreeWorkbench` listener exists, `postRowActivation` re-sends, and four new tests cover the value table, the re-send and the live flip. What is not fixed is the recurrence guard the finding was accepted for: a required `InitMessage` field can still be silently omitted from any of six branches with no compiler signal, at the exact site that shipped an inert feature this cycle. Because both the code comments and the change artifacts now record the guard as present, a future reader has no reason to re-check it — which is how this class of defect gets a second cycle.

Severity held at BLOCK rather than downgraded: severity is stable across persistence, the unfixed boundary is one named in B3's own inventory, and the fix is one line per file with no call-site churn.

**Fix.** Narrow `message` to `ExtensionToWebViewMessage` on `safeSendWithRetry` in both providers — every existing call site already passes a union member — or add `satisfies InitMessage` to each of the six `init` literals. Correct the two doc comments and the manifest claim at the same time.

**Status:** accepted
**Triage:** Confirmed by reading the source, not the report: all six `init` literals are arguments to `safeSendWithRetry`, whose `message` is still `unknown`, so deleting `worktreeWorkbench` from any of them type-checks clean today. Round-1 B3 named that function and the narrowing went to `safePostMessage` instead — the wrapper that carries follow-up messages, not `init`. The doc comments and my own re-review impact manifest both asserted the guard was in place, which is the part that would have kept a later reader from re-checking; both are corrected. Fixed at both providers and mutation-tested by deleting the field from each of the six literals.

### V1 — WARN · HIGH · P1 · agent: asm-review-logic + chair · class: feature

**B2 persists in part: the view commits its selection before the callback, so a thrown persist splits the two copies and the row goes dead**
`src/webview/worktree/WorktreeView.ts:413` (`select`) and `:398` (`clearSelection`)
Status: open · Triage: pending

**Evidence.** Round-1 B2's accepted Fix had two clauses. The first landed: `clearSelection()` exists, the chip's clear reaches it, `WorktreeController`'s mirror is gone and `selectedWorktree()` delegates to the view. The second — "Set the view's field *after* the callback returns so a throw leaves both copies unmoved" — did not. Both writers still order the field first:

```ts
this.selectedWorktreeId = worktreeId;      // :413
this.deps.onSelectWorktree?.(worktreeId);  // reaches store.updateState, which D9 says may throw
```

The specialist reproduced it against the real view, controller and seam with `store.updateState` throwing once: the panel marks `worktree-panel` (`aria-selected="true"`) while the chip names `main` and the bar filters to `main`. `renderWorktree`'s `onActivate` (`:1178`) never reaches its repaint on the throw, so the mark appears at the next unrelated push. It does not self-heal: re-clicking the row the panel marks hits `select`'s `this.selectedWorktreeId === worktreeId` guard, returns `false`, and the coordinator is never told — the same dead click B2 named. Recovery needs a third row or the chip.

`clearSelection()` has the same ordering but reconverges on the next click, so it is the milder half.

**Impact.** This is the exact two-surface disagreement B2 was raised for, surviving on the select path. Reachability is low — `WebviewStateStore.updateState` → `vscodeApi.setState` over plain string data rarely throws — which is why this is WARN rather than a re-raised BLOCK. But design.md D9 models the throw deliberately, and `tabBarScope.test.ts` already has a coordinator-side test for it ("expect(() => scope.select(ELSEWHERE)).toThrow"); the view side of the same event is untested.

**Fix.** In both `select()` and `clearSelection()`, invoke `this.deps.onSelectWorktree?.(next)` first and assign `this.selectedWorktreeId` only after it returns. Add the view-side case beside the coordinator's existing throw test.


**Status:** accepted
**Triage:** Reproduced. `select()` commits the field before the callback, so a throwing persist leaves the view marking a row the coordinator never took — and `select`'s own equality guard then makes the row that would fix it a no-op. D9 models a thrown write and the coordinator has a test for it; the view side had none, which is the actual gap. Fixed by announcing first and committing only on return, in both `select` and `clearSelection`.

### V2 — WARN · HIGH · P2 · agent: chair (corroborated by asm-review-logic Q4) · class: feature

**The flag-flip join is the one of round-1's four named joins the seam did not take, and the wiring test that names it asserts nothing**
`src/webview/main.ts:817-822` with `src/webview/tabBarScopeWiring.test.ts:284-290`
Status: open · Triage: pending

**Evidence.** Round-1's accepted P2 suggestion named four joins in `main.ts` as load-bearing: `applyTree`-before-`handleTreeResponse`, the label→chip mapping, the `shouldRender` gate, and **the flag-flip path**. The seam took the first three. The fourth is still two independent statements in `main.ts`:

```ts
onWorktreeWorkbench(msg) {
  worktreeController?.setWorkbench(msg.enabled);
  tabBarScope?.setWorkbench(msg.enabled);
},
```

The panel's repaint and the bar's redraw are sequenced by nothing but statement order, and either call can be dropped independently, leaving the panel and the bar disagreeing about whether the feature is on.

Worse, the one test that names this path exercises the wrong object and cannot fail:

```ts
it("cannot arm a scope the tree lost while it was off", () => {
  const s = surface({ workbench: false, persisted: MAIN });
  s.push({ tree: treeWithout(MAIN), rows: {} });
  s.controller.setWorkbench(true);   // the CONTROLLER, never the seam
  expect(s.chip()).toBeNull();
});
```

`WorktreeController.setWorkbench` reaches only `this.view.refresh()`; it never touches the coordinator, and no tab-bar render follows it. `s.chip()` therefore reads a DOM last drawn while the coordinator's `workbench` was `false` — `null` regardless of `resolved`. The test is vacuous twice over: it does one push, so `resolved` never becomes `true` in the first place, and it triggers no redraw after the flip. Reverting `applyTree`'s `this.resolved = false` leaves it green. `grep -rn "setWorkbench" src/webview/tabBarScopeWiring.test.ts` confirms `TabBarScopeWiring.setWorkbench` is called by no test at all.

**Impact.** The invariant itself *is* covered — `tabBarScope.test.ts`'s "stops filtering on a scope a later tree no longer holds, flag off included" does two pushes and calls the coordinator's own `setWorkbench`, so the author's 10/10 mutation claim survives on that route. What is not covered is the composition the seam exists to prove, in the file created to prove it, on the one join the seam does not own. A vacuous test carrying a cross-object name is worse than no test: it is the reason the missing join reads as covered.

**Fix.** Give the seam `setWorkbench` ownership of both halves — have it call the panel as well, the way `applyTree` calls `deliver` — or, if the split is deliberate, drive `seam.setWorkbench` in the wiring test with two pushes (one holding the worktree, one without) and assert both the chip and the panel's mark. Either way the current test's name and its assertion have to be reconciled.


**Status:** accepted
**Triage:** Correct on both halves, and the test criticism is the sharper one: `s.controller.setWorkbench(true)` exercises the controller's own path, so the assertion reads a DOM drawn while the coordinator was still off and would stay green with the fix reverted. The invariant is covered on the coordinator route (that is where the 10/10 mutation run caught it), but the composition on this join is not. Fixed by routing the flip through the seam — `setWorkbench` becomes a `TabBarScopePanel` method — and by driving the seam, not the controller, from the test.

### V3 — WARN · HIGH · P3 · agent: asm-review-logic · class: feature

**The drop queue is not drained when `deliver()` throws, so the notice is re-announced against a later, unrelated tree**
`src/webview/tabBarScopeWiring.ts:95-105`
Status: open · Triage: pending

**Evidence.** `coordinator.applyTree(tree)` pushes onto `dropped`; `deliver()` then runs unguarded, and both `dropped.splice(0)` and `renderIfMoved()` are skipped on a throw. The specialist's probe: after a throwing `deliver`, zero notices are shown and the bar still draws a chip for a scope the coordinator has already dropped; on the *next* full push the queued notice fires — "Scope cleared. main is no longer in this tree" — while the panel is drawing a live `main` row.

**Impact.** That is precisely the failure W2 was raised about — a notice contradicting what is on screen beside it — reintroduced through the error path, in the code written to fix it. The stale bar recovers at the next signature move (the signature was never recorded, so the next `shouldRender` over-reports); the false notice is durable. Separately, when `deps.panel()` is `null` at drain time the entry is spliced out and the notice is lost silently, which is the one case the getter exists for.

**Fix.** `try { deliver(); } finally { for (const [id, label] of dropped.splice(0)) deps.panel()?.reportScopeCleared(id, label); renderIfMoved(); }` — the `finally` also restores the missed redraw. Consider leaving the entry queued rather than splicing when no panel is present.


**Status:** accepted
**Triage:** Real, and it is W2's own failure reached through the error path: a queued notice surviving into the next push fires against a panel drawing a live row. `try/finally` around `deliver()`.

### V4 — WARN · MEDIUM · P3 · agent: asm-review-logic + chair · class: feature

**`chip().onClear` bypasses the render gate: two full tab-bar renders with a panel, an unrecorded signature without one**
`src/webview/tabBarScopeWiring.ts:126-128`
Status: open · Triage: pending

**Evidence.** With a panel mounted the clear runs: `panel.clearSelection()` → `onSelectWorktree(null)` → `coordinator.select(null)` → `renderIfMoved()` → `render()` (render #1, which calls `chip.remove()`); then `coordinator.clear()`, which is genuinely inert (`setScope`'s `this.scope === worktreeId` guard, scope already `null` — confirmed by both the specialist and the chair); then `deps.render()` unconditionally (render #2). Measured by the specialist: `renders on chip clear: 2`. Without a panel the only render is the ungated one, so `shouldRender` never records the post-clear signature and the next unrelated `renderIfMoved()` reports `true` for a move that already happened.

**Impact.** Contradicts the "exactly one render per move" contract `shouldRender`'s own doc states and D8 rests on. Not a spec violation — the accepted "A push that moves no attribution redraws no tab bar" clause is about pushes, and a chip clear is not one — and `renderTabBar` reconciles rather than rebuilding, so the cost is bounded. The seam's own "redraws once for a selection" test does not count the clear path, which is why the mutation score did not reach it.

**Fix.** Replace the trailing `deps.render()` with `renderIfMoved()`: a no-op when the panel path already drew, and correctly recording when it did not.


**Status:** accepted
**Triage:** Accepted as written — `renderIfMoved()` in place of the unconditional `deps.render()`. The missed signature record is the part that matters; the extra render is only the symptom.

### V5 — WARN · MEDIUM · P4 · agent: chair · class: feature

**W2 persists in part: `reportScopeCleared` still pushes on top of `handleTreeResponse`'s push, so a drop is still two panel repaints**
`src/webview/worktree/WorktreeController.ts:907-913` with `src/webview/tabBarScopeWiring.ts:100-104`
Status: open · Triage: pending

**Evidence.** Round-1 W2's title carried two claims and its triage accepted both — "the notice is deferred until the controller holds the tree that dropped the scope, which removes **both** the doubled repaint and the moment the notice is anchored to the live row". The suggested fix was "record the pending `scope` result and let `handleTreeResponse`'s existing `push()` emit it." What landed is a queue in the *seam*, drained after `deliver()` — which fixes the anchoring but leaves `reportScopeCleared` calling `this.push()` (`:912`) after `deliver()`'s own push has already run. `push()` → `view.setData(...)` and `actionResults` is part of what `setData`'s signature guard compares, so the second push does repaint. Two full `repaint()`s per drop message remain.

**Impact.** The cost `WorktreeView.select`'s own comment cites — "two repaints for one click would rebuild the tree twice and throw focus away in between" — on the drop path. Rare (only when the scoped worktree leaves the tree) and self-correcting, which is why this is P4 rather than the P3 it was; the anchoring half, which was the user-visible contradiction, is genuinely fixed and asserted by a good test that captures what the panel was drawing at the moment it was told.

**Fix.** Have `reportScopeCleared` record the pending result without pushing, and drain it from the seam *before* `deliver()` so `handleTreeResponse`'s push emits it — or accept the second repaint and correct the round-1 triage note, which currently records a fix that only half landed.


**Status:** accepted
**Triage:** Stands as described. Fixed by staging rather than by reordering: the seam drains its queue into a new `stageScopeCleared` BEFORE `deliver`, and `deliver`'s own push paints the tree and the notice in one repaint. That is strictly stronger than what round-1 asked for — the notice is now never *painted* beside the row it contradicts, rather than merely never *reported* while one was drawn — so the W2 test is re-expressed against the paint. `reportScopeCleared` stays as the public push-ing form for a standalone caller.

### V6 — SUGGEST · MEDIUM · P4 · agent: asm-review-logic (fix direction refuted by chair) · class: feature

**A scope that becomes effective without a click leaves the panel marking nothing — spec-mandated, but neither documented nor asserted**
`src/webview/tabBarScope.ts:247` with `src/webview/worktree/WorktreeView.ts:230`
Status: open · Triage: pending

**Evidence.** Two paths make the bar scoped with no click: a persisted scope confirmed by the first tree, and a flag flip after `applyTree` resolved the scope while the workbench was off. In both, the chip names a worktree and the tabs filter while the panel marks nothing and `selectedWorktree()` returns `null`. `tabBarScopeWiring.test.ts:229` asserts the chip and the tabs after that restore, but says nothing about the row.

**Chair refutation of the proposed fix.** The specialist suggested seeding the panel's mark via a `panel().markSelected(id)`. **That would violate an accepted spec.** `specs/worktree-panel/spec.md`, "A worktree can be selected, and selection is an explicit act": "no worktree SHALL be selected on the user's behalf at first render, **on a reload**, or on any push that changes the tree", with the scenario "Nothing is selected until the user selects it". `specs/tab-bar-component/spec.md` independently requires "A surface's scope survives a reload". The two clauses together *require* exactly the state observed. Round-1 B2's second evidence bullet ("Reload with a persisted scope … the panel marks nothing") was mistaken on this point; the fix correctly did not address it.

**Impact.** No defect, but nothing in the code, the design doc or the tests records that this asymmetry is deliberate, so it reads as an oversight and invites a fourth pass to "fix" it into a spec violation — the same shape as the `docs/design/worktree-scope.md` § 8 row already in the backlog. Clicking the scoped worktree's row converges (`setScope` early-returns, the view repaints), so nothing is stuck.

**Fix.** Record it in D6 or D7 — scope is restored, selection is never restored, and both specs say so — and add the negative assertion to `tabBarScopeWiring.test.ts:229` so the next reader meets the intent rather than the surprise.


**Status:** accepted
**Triage:** The chair's refutation of the specialist's fix is accepted with it: seeding the panel's mark on reload would violate `specs/worktree-panel/spec.md`, and the observed state is what the two specs together require. Recorded in design.md D7 and pinned with the negative assertion, so a later round cannot "fix" it into a violation.

### V7 — SUGGEST · MEDIUM · P5 · agent: asm-review-logic · class: feature

**`onAttribution` is the one seam mutator with no render gate, correct only by an unstated reachability argument**
`src/webview/tabBarScopeWiring.ts:91-93`
Status: open · Triage: pending

`coordinator.setAttribution` moves an input the signature covers, but the seam never calls `renderIfMoved()` after it. It is safe today only because `WorktreeController.emitAttribution()` is reachable from exactly one place — `handleTreeResponse` (`WorktreeController.ts:849`), i.e. inside `deliver()`, whose caller redraws afterwards. Nothing states or enforces that; a future presence-only attribution emit would leave the bar filtering on a stale map with no redraw. The seam exists to make these joins provable, so this one should not rest on a grep. Fix: call `renderIfMoved()` in `onAttribution` — idempotent by construction, and it collapses to nothing when `applyTree`'s gate already fired.


**Status:** accepted
**Triage:** Cheap to close and removes a dependency on `emitAttribution` having exactly one caller. `renderIfMoved()` after the set; it is a no-op whenever the tree push that follows would have caught it anyway.

### V8 — SUGGEST · MEDIUM · P4 · agent: asm-review-frontend + chair · class: feature

**Clearing the focused scope control drops keyboard focus to `<body>`**
`src/webview/tabBarScopeWiring.ts:126` with `src/webview/TabBarUtils.ts:211-213`
Status: open · Triage: pending

`clear.onclick = () => scope.onClear()` runs `panel.clearSelection()`, whose synchronous callback re-enters `renderTabBar` and executes `chip.remove()` — destroying the button whose handler is on the stack. Neither that path nor the trailing `deps.render()` restores focus. A keyboard user who activates "Clear the … scope" is left on a detached element and lands on the document body, with no predictable continuation point in the now-unscoped bar. Confirmed by the chair against the render code. Fix: in `renderTabBar`, detect that the removed chip contains `document.activeElement` and focus a retained successor (the "+" button) after reconciliation — the removal site is the right owner.


**Status:** accepted
**Triage:** Real: the clear destroys the button that had focus. Focus moves to the tab bar's own add control, which is the nearest surviving thing in the same widget.

### V9 — SUGGEST · MEDIUM · P4 · agent: asm-review-frontend · class: feature

**The sticky chip is not guaranteed to be opaque**
`src/providers/webviewHtml.ts:230-236`
Status: open · Triage: pending

The sticky positioning is otherwise correct — `#tab-bar` is the horizontal flex scroll container and `.tab-scope` has `flex-shrink: 0`, so `position: sticky; left: 0; z-index: 1` does keep the escape hatch on screen. But the background is `var(--vscode-badge-background, rgba(255,255,255,0.12))`, and the new comment beside it claims "Opaque background above, so tabs pass underneath." Where the badge variable is unset or itself translucent, tab text bleeds through the one persistent scope/clear affordance exactly while the bar is scrolled. Fix: layer an opaque backing (`var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background))`) behind the badge colour, or make the fallback opaque.


**Status:** accepted
**Triage:** The comment claimed opacity the fallback did not have. The fallback is now opaque, so a scrolled tab passing under the sticky chip cannot show through it.

## Also found

Nothing overflowed the detail budget.

## Audit backlog

Non-gating. Carried into the next discovery round.

- **Carried from round 1** — `docs/design/worktree-scope.md` § 8, row "Presence degraded for the pane source", still reads "Last attribution stands; scope is not recomputed from an empty result" — the cache D7 and § 3.4 both explicitly reject. Round-1's triage said it would be fixed at Blueprint Sync; that gate is still unchecked in `workflow.md`, so the row stands. Verify at sync.
- `WorktreeController.selectedWorktree()` (`:893`) has no production consumer after this diff — only `WorktreeController.test.ts` reads it. A delegating accessor kept alive by its own test.
- `WorktreeView.clearSelection()` calls `repaint()`, which no-ops when `this.disposed`; a clear on a disposed view still mutates state and fires the callback. Not reachable from the chip today.
- `TerminalEditorProvider.postRowActivation()` and its sidebar twin now post two messages each; the name and its "See TerminalViewProvider.postRowActivation — same race, same close" comment describe one. The two providers are symmetric, so this is naming, not a contract divergence.

## Support review (Phase 2.5)

- No `.only` / `.skip` / `xit` introduced. Async assertions awaited. No PII or secrets in fixtures.
- `tabBarScopeWiring.test.ts` is a genuine composition harness — real `WorktreeController.mount`, real coordinator through the seam, real `renderTabBar` over a jsdom `#tab-bar` — and its B1, B2, W1 and W2 cases each assert something a single-object test could not. Its one vacuous case is V2.
- The new `TerminalEditorProvider` tests are load-bearing for what they check (init field, the seven-value strictness table, the post-init re-send exactly once, the live flip) and the `.at(-1)` spy handling is correct for the looped case. They cannot substitute for V0's missing compile-time guard, and they correctly pass today — V0 is compile-time only.
- `tabBarScope.test.ts`'s three tests that "gained an applyTree so they exercise a resolved scope rather than passing vacuously" (recorded in `verified.ndjson`) are a genuine strengthening; the throw test now confirms the scope first, which is the right shape.
- Task `2_1`'s `.build/verified.ndjson` entry records `exit: 0` with a scope list covering all 18 touched files and an `assertionDelta` of +17. Its `testCmd` (`vitest run 'src/webview/tabBarScopeWiring.test.ts'`) cannot detect V0 — no test can; V0 needs a type change.

## Not findings (checked, clean)

- `.wt-card` is declared after `.wt-group` at equal specificity, so a selected-and-grouped row's `border: 1px` correctly overrides the new `border-left: 2px`. The 1px content shift between the grouped and selected states is below the reporting threshold.
- `role="group"` is set on chip creation and the chip is only ever created by this code path, so no chip can exist without it. `aria-label` is set on every render, the clear button carries its own name, and `#tab-bar` declares no conflicting role.
- `isScoped()` / `effectiveScope()` / `chip()` still cannot diverge: `scopeLabel` is written in every branch that sets `resolved = true`, so a filter without its chip remains inexpressible.
- `buildAttribution`'s single-pass `rows.filter((r) => r.scope === "window")` preserves the contested-set semantics exactly — `paneId === undefined` is still skipped, `held !== worktreeId` still excludes a duplicate under the same worktree, and the deletion pass still runs after the full walk.
- The `dropped` queue cannot grow unboundedly: at most one entry per `applyTree`, spliced in the same call on every path except the throw V3 names.
- `main.ts`'s `tabBarScope === null` early return in `onWorktreeTreeResponse` is correct — with no `#vault-panel` neither the seam nor the controller is constructed, `deliver` is inlined, and nothing else in the branch depends on the seam.
- `renderIfMoved()` on the select path misses no render: every selection that changes what the bar draws also changes `scopedWorktreeId()`, and selections that do not move the signature move no pixel either.
