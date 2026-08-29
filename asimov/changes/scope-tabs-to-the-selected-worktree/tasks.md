## 1. A surface that can be scoped

- [x] 1_1 Register the rollout setting and carry it to the view — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/tab-bar-component/spec.md#scoping-is-offered-only-where-it-has-been-turned-on, design.md#d6-the-rollout-setting-follows-the-rowactivation-path-exactly
  - **Acceptance**:
    - Outcome: the view is told whether the workbench is on, and it is off unless configured
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    0. Files: `package.json`, `src/settings/SettingsReader.ts`, `src/settings/SettingsReader.test.ts`, `src/types/messages.ts`, `src/webview/messaging/MessageRouter.ts`, `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalViewProvider.worktree.test.ts`, `src/webview/main.ts`, `src/webview/worktree/WorktreeController.ts`.
    1. Declare `anywhereTerminal.worktree.workbench` in `package.json` under `contributes.configuration.properties`: type boolean, default `false`, with a description saying the composition is in rollout.
    2. Add `readWorktreeWorkbench()` and `affectsWorktreeWorkbench()` to `src/settings/SettingsReader.ts`. Accept only `value === true`; a string, a number, an object, or an absent value all yield `false`.
    3. Carry the value on the init message in `src/types/messages.ts` beside `worktreeRowActivation`, and send it from every init branch in `src/providers/TerminalViewProvider.ts` that already sends `worktreeRowActivation` — the row-activation wiring tested at `src/providers/TerminalViewProvider.worktree.test.ts:489-564` is the shape to match.
    4. Register the `affectsConfiguration` listener beside the existing `affectsWorktreeRowActivation` one so a live change reaches an open view.
    5. Route the live message in `src/webview/messaging/MessageRouter.ts` beside `onWorktreeRowActivation`, then in `src/webview/main.ts` pass the init value into `WorktreeController`'s `init` and the live one to its setter; in `WorktreeController.ts` store it and add the setter the listener drives, mirroring `setRowActivation`.
    6. Cover: every init branch carrying the flag; absent, `true`, `false`, and three malformed values; the exact `affectsConfiguration` key; a live change reaching the controller.

- [x] 1_2 Let a worktree be selected, and mark only that one — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-worktree-can-be-selected-and-selection-is-an-explicit-act, the-selected-worktree-is-the-only-one-marked-as-selected}, ../../../specs/worktree-panel/spec.md#{an-open-worktree-is-marked-without-claiming-exclusivity, keyboard-traversal-follows-the-declared-hierarchy}, design.md#d5-the-card-treatment-marks-selection-and-stops-marking-expansion
  - **Acceptance**:
    - Outcome: selecting a worktree marks it, and nothing is marked until the user selects
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/worktreePanel.css`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeController.test.ts`.
    1. Hold `selectedWorktreeId: string | null` in `WorktreeView`, defaulting to `null`, and expose a dep `onSelectWorktree?: (worktreeId: string | null) => void` the controller supplies — `null` reports the drop in step 5, without which the holder outside goes on naming a worktree that has left the tree.
    2. Gate selection on the workbench flag: with it off, activating a row selects nothing and `.wt-card` keeps its current expansion-keyed behaviour. With it on, `.wt-card` is keyed off selection and the grouping that expansion needs takes its own class in `worktreePanel.css` carrying no selection weight.
    3. Add `aria-selected` on the selected row, and the selection treatment on it alone.
    4. Bind selection on the worktree row's existing activation path in `worktreeTreeView.ts` so it works from the pointer and from both activation keys, without disturbing the row's disclosure toggle.
    5. Keep the selection across a push when its worktree is still in the tree; select nothing on a first render.
    6. In `WorktreeController.ts` supply `onSelectWorktree` and hold the selected id.
    7. Cover: nothing selected on first render or after a push; selecting one then another leaving only the second; an expanded-but-unselected worktree carrying no selection treatment; the open-folder mark still on the worktrees that earn it; selection by each activation key; with the flag off, activation selecting nothing and the card unchanged.

- [x] 1_3 Publish pane attribution from the controller — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/tab-bar-component/spec.md#a-scoped-tab-bar-hides-only-what-it-can-prove-belongs-elsewhere, design.md#d2-the-controller-publishes-attribution-the-tab-bar-consumes-it
  - **Acceptance**:
    - Outcome: the controller reports which worktree each of this window's panes is in
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeController.test.ts`.
    1. Add a dep `onAttribution?: (paneToWorktree: ReadonlyMap<string, string>) => void`, built from the presence envelope's `rowsByWorktreeId` over rows whose `scope` is `window` and whose `paneId` is set. External rows contribute nothing.
    2. A `paneId` appearing under more than one worktree is omitted from the map entirely rather than resolved by last-write-wins.
    3. Emit it where the envelope is stored (`WorktreeController.ts:769-777`), and only when the map differs from the last one emitted.
    4. Cover: a map built from a multi-worktree envelope; external rows excluded; a row with no `paneId` excluded; a pane under two worktrees omitted; an identical envelope emitting nothing a second time; a degraded envelope still producing the attribution its rows carry.

- [x] 1_4 Filter the tab bar, and keep it visible while it is filtered — verified: pnpm exec vitest run 'src/webview/TabBar.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/tab-bar-component/spec.md#{a-scoped-tab-bar-hides-only-what-it-can-prove-belongs-elsewhere, absence-of-attribution-fails-open, the-tab-bar-is-presented-whenever-it-is-filtered, scope-changes-what-is-drawn-and-nothing-else, tab-bar-rendering}, design.md#d3-a-scoped-tab-bar-is-visible-whatever-the-tab-count
  - **Acceptance**:
    - Outcome: a scope hides only tabs proven to belong to another worktree
    - Verify: unit src/webview/TabBar.test.ts
  - **Plan**:
    0. Files: `src/webview/TabBarUtils.ts`, `src/webview/TabBar.test.ts`.
    1. Extend `buildTabBarData` with the scope and the attribution map. A single-pane tab is kept when its pane is attributed to the scope or is absent from the map; a split tab is kept when any leaf over `getAllSessionIds(layout)` is, and dropped only when every leaf is attributed elsewhere.
    2. Preserve the existing split label and activity aggregation exactly.
    3. Add an `isScoped` input to `RenderTabBarDeps` and make visibility `terminals.size >= 2 || isScoped` — a second independent predicate, not a reinterpretation of the count.
    4. Cover: the three attribution outcomes; a split with one in-scope leaf and one elsewhere; a split with one unplaced leaf and the rest elsewhere; a split with every leaf elsewhere; an empty map hiding nothing; unscoped visibility unchanged at zero, one and two tabs; a scoped one-tab bar still presented.

- [x] 1_5 Own the scope in a coordinator, and persist it — verified: pnpm exec vitest run 'src/webview/tabBarScope.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4
  - **Refs**: specs/tab-bar-component/spec.md#{a-surface-s-scope-survives-a-reload-and-never-outlives-its-worktree, a-scope-that-loses-its-worktree-is-dropped-and-said}, design.md#{d1-scope-is-webview-local-state-on-the-surface-persisted-through-the-existing-store, d7-scope-is-re-resolved-on-every-tree-push-from-the-tree-alone, d8-the-tab-bar-gets-its-own-signature-in-its-own-coordinator, d9-failure-surface-the-persisted-surface-state}
  - **Acceptance**:
    - Outcome: scope survives a reload and never names a worktree the tree has lost
    - Verify: unit src/webview/tabBarScope.test.ts
  - **Plan**:
    0. Files: `src/webview/tabBarScope.ts`, `src/webview/tabBarScope.test.ts`, `src/webview/state/WebviewState.ts`, `src/webview/main.ts`, `src/webview/worktree/worktreeViewTypes.ts`, `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeController.test.ts`. The last five are step 4's "said": D7 sends it through the panel's existing action-result surface, which is a `WorktreeActionResult` — so the kind, its notice copy, and the controller entry point the coordinator's callback reaches all have to exist.
    1. Add `worktreeScope?: string` to `WebviewState` in `src/webview/state/WebviewState.ts`, documented as absent-means-unscoped, beside `worktreeCollapsed`.
    2. Create `src/webview/tabBarScope.ts` holding the effective scope, the attribution map, and a signature over exactly the scope, the map entries sorted by pane id, and tab-layout membership. Expose `shouldRender()` comparing that signature, and a `seed`/`set`/`clear` surface taking injected persistence so nothing imports `main.ts`.
    3. Seed the scope from the store on construction, rejecting a value that is not a string; write every change back with `store.updateState`, preserving unrelated keys.
    4. Re-resolve on each tree push: a scoped id absent from the tree clears it, a `missing` one keeps it. Report a clear through the panel's existing action-result surface, naming the worktree the scope had — a `scope` action kind with its own notice branch, since a dropped scope did nothing TO a worktree and must not read as a failed mutation. The coordinator must see the tree BEFORE the controller does: the panel's own pruning clears the selection when a worktree leaves, and a scope already cleared has nothing left to say.
    5. Reduce `src/webview/main.ts` to wiring: construct the coordinator, feed it the controller's attribution and selection, and call `renderTabBar` only when `shouldRender()` says so.
    6. Cover: reload restoring a present scope; absent, non-string, and unknown-id values all landing unscoped; removal and prune clearing with a stated reason; `missing` keeping it; unrelated state keys preserved across a write; a thrown `setState` propagating rather than being swallowed.

- [x] 1_6 Charge nothing for a push that moved no attribution — verified: pnpm exec vitest run 'src/webview/tabBarScope.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_5
  - **Refs**: specs/tab-bar-component/spec.md#a-push-that-moves-no-attribution-redraws-no-tab-bar, ../../../specs/worktree-panel/spec.md#a-push-that-changed-nothing-changes-no-pixels, design.md#d8-the-tab-bar-gets-its-own-signature-in-its-own-coordinator
  - **Acceptance**:
    - Outcome: an unchanged scope and attribution produce no tab-bar render
    - Verify: unit src/webview/tabBarScope.test.ts
  - **Plan**:
    0. Files: `src/webview/tabBarScope.ts`, `src/webview/tabBarScope.test.ts`.
    1. Assert the signature ignores everything the presence envelope carries beyond attribution — `scannedAt`, activity, titles and delegations must not move it.
    2. Cover both directions: an envelope with identical attribution yields zero renders; a changed scope, a pane moving between worktrees, and a split gaining or losing a leaf each yield exactly one.

- [x] 1_7 Enter the invariant with the test that proves it — verified: pnpm run test:unit && pnpm run check-types exit 0
  - **Deps**: 1_6
  - **Refs**: specs/tab-bar-component/spec.md#{a-scoped-tab-bar-hides-only-what-it-can-prove-belongs-elsewhere, absence-of-attribution-fails-open}, ../../../docs/design/worktree-scope.md
  - **Acceptance**:
    - Outcome: hiding an unattributed pane turns the suite red
    - Verify: command pnpm run test:unit
  - **Plan**:
    0. Files: `docs/DESIGN.md`, `src/test/invariants/registry.ts`, `src/webview/TabBar.test.ts`.
    1. Add the row to the § 8.4 table in `docs/DESIGN.md` as `I18`, with the statement already reserved for it in the Planned table below the section, and delete its Planned line — leaving WT-010.2's.
    2. Add the matching `I18` entry to `INVARIANTS` in `src/test/invariants/registry.ts` with `status: "covered"`, owner `WT-010.1`, and a `stimulus` naming the change that must turn the test red: hiding a tab whose pane the attribution map does not hold.
    3. Put the literal `[I18]` tag in the Vitest test NAME in `src/webview/TabBar.test.ts`. The reporter discovers tags from test names and treats ANY filtered run as partial — naming two paths does not un-filter it (`coverageReporter.ts:69-73`), so a run that names files at all prints "coverage not checked" and the missing tag goes unnoticed. Verified: stripping the tag and running the two named paths is green; the same strip under the unfiltered script exits 1. The Verify is therefore the unfiltered `pnpm run test:unit`.
    4. The case: a scope set, a pane absent from the attribution map, its tab asserted present.

- [x] 1_8 Keep every part of this inert while the setting is off — verified: pnpm exec vitest run 'src/webview/tabBarScope.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_5, 1_6, 1_7
  - **Refs**: specs/tab-bar-component/spec.md#scoping-is-offered-only-where-it-has-been-turned-on, specs/worktree-panel/spec.md#a-worktree-can-be-selected-and-selection-is-an-explicit-act, design.md#d6-the-rollout-setting-follows-the-rowactivation-path-exactly
  - **Acceptance**:
    - Outcome: with the setting off no tab is hidden, no chip renders
    - Verify: unit src/webview/tabBarScope.test.ts
  - **Plan**:
    0. Files: `src/webview/tabBarScope.ts`, `src/webview/tabBarScope.test.ts`, `src/webview/main.ts`.
    1. Hold the flag in the coordinator, and make the effective scope `null` whenever it is off — one gate, so the filter, the chip and the visibility rule cannot disagree about whether scoping is on.
    2. Keep the persisted value untouched while off: turning the flag on re-applies it without a reload.
    3. Cover with the flag off: a persisted scope hiding no tab and rendering no chip; the unscoped visibility rule intact. Then the live flip in both directions, asserting the persisted scope survives being off and takes effect on.

- [x] 1_9 Name the scope on the bar and give it an escape — verified: pnpm exec vitest run 'src/webview/TabBar.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_8
  - **Refs**: specs/tab-bar-component/spec.md#a-scope-is-named-wherever-it-is-in-force, design.md#d4-the-chip-is-a-child-of-tab-bar-rendered-by-rendertabbar
  - **Acceptance**:
    - Outcome: a scoped bar names its worktree and offers a control that clears it
    - Verify: unit src/webview/TabBar.test.ts
  - **Plan**:
    0. Files: `src/webview/TabBarUtils.ts`, `src/webview/TabBar.test.ts`, `src/providers/webviewHtml.ts`, `src/webview/main.ts`, `src/webview/tabBarScope.ts`, `src/webview/tabBarScope.test.ts`. The last two supply the chip's LABEL: the panel forbids a path on a row (worktree-panel-ui.md § 3.2), the coordinator already remembers what the tree last called the scoped worktree, and `main.ts` holds no tree of its own to ask.
    1. In `TabBarUtils.ts`, render the chip as the first child of `tabBarEl`, reconciled in place like the tabs are, carrying the scoped worktree's label and a clearing control with an accessible name.
    2. Extend the tail-trimming loop after the "+" button so it does not delete the chip, and remove the chip when no scope is set.
    3. Style the chip in `src/providers/webviewHtml.ts` beside the existing `#tab-bar` rules, using VS Code CSS variables only.
    4. Wire the clearing control in `src/webview/main.ts` to the coordinator's `clear`.
    5. Cover: chip present exactly while scoped and naming that worktree; clearing presenting every tab that was hidden; the chip surviving a re-render that changes no tab; the clearing control carrying its accessible name and reachable independently of the vault panel's collapsed state; no chip when unscoped.

## 2. Round-1 review fixes

- [x] 2_1 Close the three blockers and the seam they live in — verified: pnpm exec vitest run 'src/webview/tabBarScopeWiring.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_9
  - **Refs**: .reviews/round-1.md, specs/tab-bar-component/spec.md#{a-scope-is-named-wherever-it-is-in-force, a-surface-s-scope-survives-a-reload-and-never-outlives-its-worktree, scoping-is-offered-only-where-it-has-been-turned-on}, specs/worktree-panel/spec.md#the-selected-worktree-is-the-only-one-marked-as-selected, design.md#d8-the-tab-bar-gets-its-own-signature-in-its-own-coordinator
  - **Acceptance**:
    - Outcome: the chip names the worktree it filters by, clearing it unmarks the panel, and the editor surface gets the flag
    - Verify: unit src/webview/tabBarScopeWiring.test.ts
  - **Plan**:
    0. Files: `src/providers/TerminalEditorProvider.ts`, `src/providers/TerminalEditorProvider.test.ts`, `src/providers/TerminalViewProvider.ts`, `src/webview/paneAttribution.ts`, `src/webview/tabBarScope.ts`, `src/webview/tabBarScope.test.ts`, `src/webview/tabBarScopeWiring.ts`, `src/webview/tabBarScopeWiring.test.ts`, `src/webview/main.ts`, `src/webview/TabBarUtils.ts`, `src/webview/TabBar.test.ts`, `src/providers/webviewHtml.ts`, `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/worktreePanel.css`, `asimov/changes/scope-tabs-to-the-selected-worktree/design.md`.
    1. Seam first, because the three blockers are unprovable without it: extract the `main.ts` wiring into `src/webview/tabBarScopeWiring.ts`, driven in its own test by the real view, controller and coordinator together. D8 is unchanged — this is where "leaves `main.ts` as wiring" lands.
    2. B1: the label moves WITH the scope. The coordinator keeps the last tree's id→label map and `setScope` resolves the name from it, so a selection is never announced by a path and never by the previous worktree's branch.
    3. W1: a scope no tree has confirmed filters nothing. `resolved` gates the effective scope, is set when a tree holds the id, and is cleared when one does not — so a flag flip cannot arm a scope the tree has since lost.
    4. B2: clearing the chip clears the panel's selection, through the seam. The controller's mirror field goes; `selectedWorktree()` reads the view, so there is one copy.
    5. B3: `worktreeWorkbench` on every `TerminalEditorProvider` init branch, its `affectsConfiguration` listener, and its post-init re-send — the same three pieces `worktreeRowActivation` has there. Cover them the way `TerminalViewProvider.worktree.test.ts` covers its own. Then close the reason the omission compiled: both providers' `safePostMessage` took `unknown`, so a REQUIRED init field missing from three branches type-checked clean. Both now take `ExtensionToWebViewMessage`.
    6. W2: the drop notice is reported after the controller holds the tree that dropped it. W3: one exported canonicaliser in `paneAttribution.ts` that both the dedup key and the render signature call.
    7. The accepted suggestions: `scopedLabel()` joins the signature so a rename redraws; `role="group"` on the chip; `position: sticky` so the escape hatch cannot scroll away; `buildAttribution` filters to window scope once; `.wt-group` keeps a container treatment rather than spacing alone.
