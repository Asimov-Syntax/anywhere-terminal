## 1. What the scope hides, said out loud

- [x] 1_1 Report what presence says is waiting alongside where it says the pane is — verified: pnpm exec vitest run 'src/webview/tabBarScope.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/tab-bar-component/spec.md#a-push-that-moves-no-attribution-redraws-no-tab-bar · design.md#d1-placement-and-waiting-travel-in-one-report-the-render-guard-keys-the-badge-not-the-set
  - **Acceptance**:
    - Outcome: one presence scan reports placement and waiting together, and either moving redraws
    - Verify: unit src/webview/tabBarScope.test.ts
  - **Plan**:
    0. Files: `src/webview/paneAttribution.ts`, `src/webview/worktree/WorktreeController.ts`, `src/webview/tabBarScope.ts`, `src/webview/tabBarScopeWiring.ts`, `src/webview/paneAttribution.test.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/tabBarScope.test.ts`, `src/webview/tabBarScopeWiring.test.ts`.
    1. Add the `PaneReport` shape from the Ref to `paneAttribution.ts`, beside `PaneAttribution`, and canonicalise it the way `attributionKey` already canonicalises the map — the waiting set is order-independent and must encode as such, or an unordered `Set` makes every scan look like a change.
    2. `WorktreeController.buildAttribution` walks `rowsByWorktreeId` once; have that same walk collect the panes whose row activity is `waiting`, under the same `scope === "window"` and `paneId !== undefined` filters the placement already applies. An external row carries no pane of ours and must not raise a count.
    3. `emitAttribution` suppresses a duplicate by comparing one key — extend that key to cover both halves so either moving reports and neither moving stays silent.
    4. `TabBarScopeCoordinator.setAttribution` takes the report. `effectiveScope()` still hands the bar only `{worktreeId, attribution}`; the waiting set is exposed separately for the badge. Expose the coordinator's in-scope predicate too — 1_3 shares it rather than restating it.
    5. `signatureOf` keys the placement and the DERIVED badge count, not the raw waiting set. That is what keeps the narrowed no-DOM-work requirement true: a waiting change on a presented pane, or any waiting change while unscoped, must leave the signature still.
    6. Cover: waiting reported for a placed pane; an external row's waiting pane raising nothing; a scan where only the waiting half moved still reporting; the same set in a different insertion order reporting once; and — the load-bearing pair — a waiting change on a presented pane and a waiting change while unscoped each leaving the signature unmoved.

- [ ] 1_2 Count the hidden tabs that need a human, and mark the escape control
  - **Deps**: 1_1
  - **Refs**: specs/tab-bar-component/spec.md#{a-hidden-tab-that-needs-a-human-is-counted, the-count-reads-every-source-that-can-say-a-pane-is-waiting} · design.md#d2-the-count-is-a-union-over-hidden-tabs-computed-where-both-sources-are-already-in-hand
  - **Acceptance**:
    - Outcome: the clearing control carries a count of hidden waiting tabs, and no mark at zero
    - Verify: unit src/webview/TabBar.test.ts
  - **Plan**:
    0. Files: `src/webview/TabBarUtils.ts`, `src/webview/tabBarScope.ts`, `src/webview/tabBarScopeWiring.ts`, `src/webview/main.ts`, `src/providers/webviewHtml.ts`, `src/webview/TabBar.test.ts`, `src/webview/tabBarScopeWiring.test.ts`.
    1. `buildTabBarData` returns the `TabBarData` shape from the Ref instead of a bare map, counting at the two points it already decides to drop a tab so nothing recomputes what "hidden" means.
    2. A tab counts when any pane it holds is waiting by EITHER source. Exclude an exited pane, as the existing split aggregation already does.
    3. The chip's clearing control renders the count; zero renders no mark, and the mark does not animate. Style it from the same custom property the waiting tab status already uses in `webviewHtml.ts`, not a new error colour — one shape for one meaning.
    4. `main.ts` calls `buildTabBarData` twice (the render, and the rename lookup in `startInlineRename`); the second wants only the map. Keep both honest rather than leaving the second reading a field it does not use.
    5. Cover: a count over hidden waiting tabs; zero rendering nothing; each source alone raising the count; an unattributed waiting pane raising nothing and staying visible; a hidden split holding two waiting panes counted once; clearing from the marked control presenting every counted tab; the mark carrying no animation.

- [ ] 1_3 Build the region a scope with nothing in it shows
  - **Deps**: 1_1
  - **Refs**: specs/tab-bar-component/spec.md#a-scope-holding-no-pane-says-so-and-offers-what-is-worth-doing · design.md#d4-the-empty-scope-region-hides-the-terminal-container-without-unmounting-it
  - **Acceptance**:
    - Outcome: the region renders both offers and a clearing control, with no error treatment
    - Verify: unit src/webview/emptyScopeRegion.test.ts
  - **Plan**:
    0. Files: `src/webview/emptyScopeRegion.ts`, `src/webview/emptyScopeRegion.test.ts`, `src/webview/vault/renderAtoms.ts`, `src/webview/vault/renderAtoms.test.ts`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeController.test.ts`.
    0b. The region's own styling goes in `src/webview/vault/vaultPanel.css` beside the `emptyState` rules it reuses, NOT in `webviewHtml.ts` — that file is 1_2's, and the badge is the only thing this change adds to it.
    1. This task builds WHAT the region looks like and what its offers do. WHEN it shows is 1_4's — the two are separated on that seam and nowhere else, because the decision to show it and the decision to activate a pane are one calculation that must not be split.
    2. Widen `emptyState`'s action parameter to accept a list as well as a single action; the nine existing call sites pass one and must keep working unchanged.
    3. The offers are the two host actions the Ref names, not `createTab` — which carries no worktree identity and would open in the wrong directory.
    4. Launching needs the controller's offer-gated dialog, not a bare message: add the method that opens it for a given worktree. Omit the offer entirely when no launch target is available, matching the controller's existing rule — never an inert one.
    5. Cover: both offers posting for the scoped worktree; the launch offer absent with no target; the clearing control present and calling back; no error class; nothing in the region clearing the scope by itself; `renderAtoms` still rendering a single action for an existing caller.

- [ ] 1_4 Send a selection to a pane of the worktree it selected, or to that region
  - **Deps**: 1_2, 1_3
  - **Refs**: specs/tab-bar-component/spec.md#selecting-a-worktree-goes-to-a-pane-of-that-worktree · design.md#d3-selection-activates-a-pane-through-the-primitive-that-already-resolves-one
  - **Acceptance**:
    - Outcome: a selection lands on a pane of the worktree it named
    - Verify: unit src/webview/tabBarScopeWiring.test.ts
  - **Plan**:
    0. Files: `src/webview/tabBarScopeWiring.ts`, `src/webview/main.ts`, `src/webview/tabBarScopeWiring.test.ts`.
    1. Activation and the region are the two exhaustive outcomes of ONE calculation — find the first presented pane of the new scope, else there is none — so one task decides both. Splitting the decision is what lets two definitions of "the scope holds a pane" appear.
    2. Add the four deps from the Ref. `main.ts` satisfies `activatePane` with its existing `activatePaneById`, NOT `switchTab`: a mixed split is presented for one leaf while another leaf is active inside it, and only the pane-level primitive moves the right one.
    3. Decide inside `onSelectWorktree`, after `coordinator.select` and before `renderIfMoved`, so the test runs against the scope being adopted and the selection costs one draw. Never call `activatePane` with the pane already active.
    4. Use the coordinator's in-scope predicate rather than restating it — a second definition is how the bar and the activation come to disagree about which panes a scope holds.
    5. Showing the region hides `#terminal-container` without unmounting it; nothing else hides it on this path, so a hidden worktree's terminal would otherwise stay on screen beside the region.
    6. Cover: an out-of-scope active pane moving to the first presented in-scope pane; an in-scope active pane not moving; the mixed split whose visible tab holds an out-of-scope active leaf; an empty scope showing the region AND hiding the container while leaving it connected; the previously active pane still in the store and presented again once the scope clears.

- [ ] 1_5 Put the no-invisible-filter invariant in the table with tests that can fail
  - **Deps**: 1_2, 1_4
  - **Refs**: design.md#d5-i19-is-conjunctive-so-both-clauses-are-tagged
  - **Acceptance**:
    - Outcome: I19 is in § 8.4 and the registry, and both its clauses have a tagged covering test
    - Verify: command pnpm run test:unit
  - **Plan**:
    0. Files: `docs/DESIGN.md`, `src/test/invariants/registry.ts`, `src/webview/TabBar.test.ts`.
    1. Add the row to § 8.4 and remove its entry from the planned-invariants table below that section — a row in both places claims it is owed and delivered at once.
    2. Add the registry row with `status: "covered"` and both owners. The `statement` is compared verbatim against the doc, so the two must be byte-identical.
    3. Tag BOTH clauses: the existing chip-presence test, and the source-union test 1_2 added. The stimulus names both failures, so a tag on only one leaves half the invariant asserting itself.
    4. Verify is the unfiltered script on purpose: the coverage reporter is attached from `test:unit` and skips a filtered run, so `vitest run <file>` would prove nothing here.
