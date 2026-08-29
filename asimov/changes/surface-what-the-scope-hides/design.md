# Design: surface-what-the-scope-hides

## Decisions

### D1: Placement and waiting travel in one report; the render guard keys the badge, not the set

`WorktreeController` emits pane placement and pane-waiting in a SINGLE callback carrying both. The
coordinator's render signature keys the placement and **the count the badge would draw**, never the
raw waiting set.

Both halves come from the same `presence` scan (`WorktreeController.ts:651-691`). There is no
asynchronous interleaving to fear — nothing can deliver a second tree event inside one synchronous
callback — but `tabBarScopeWiring.ts:97-103` renders immediately inside the controller's delivery,
so two callbacks would mean two synchronous render attempts for one scan. One report has one render.
The filter's own input keeps its present shape: `PaneAttribution` stays `paneId → worktreeId`,
because [worktree-scope.md](../../../docs/design/worktree-scope.md) § 3.2's three outcomes are a
property of that map and a fourth field on it would invite a fourth outcome.

Keying the raw set would break the shipped no-DOM-work requirement, which this change narrows by a
MODIFIED delta rather than by silently widening what redraws: a waiting change on a **presented**
pane, or any waiting change at all while the surface is **unscoped**, moves nothing the bar draws.
The signature therefore takes the derived count, which is `0` in both those cases and stays put.

```ts
/** One presence scan's answer about panes, reported together (D1). */
export interface PaneReport {
  /** paneId → worktreeId. Absent key = not placed, presented in every scope. */
  placement: PaneAttribution;
  /** Panes presence says are waiting. Independent of placement (D2). */
  waiting: ReadonlySet<string>;
}
```

### D2: The count is a union over hidden TABS, computed where both sources are already in hand

The badge count is computed in `buildTabBarData`'s pass over `store.tabLayouts`, at the two points
it already decides to drop a tab, and a pane counts as waiting when EITHER
`TerminalInstance.activityStatus` or the reported waiting set says so.

The union is not redundancy. `activityStatus` is this webview's own tracking, updated locally and
only then reported host-side (`main.ts:109-114`); the presence set can be overridden by a fresh hook
turn report the webview never saw (`presenceProjector.ts:647-669`). Delivery lag produces
local-only snapshots; hook evidence produces presence-only ones. A missed `waiting` is the failure
the badge exists to prevent.

**The unit is the tab**, per [worktree-scope.md](../../../docs/design/worktree-scope.md) § 4.2
("over this surface's own tabs"). A split tab is hidden only when every one of its panes is
attributed elsewhere (`TabBarUtils.ts:88-91`), and counting only at that drop branch means a split
can never be presented and counted at once. Two waiting panes in one hidden split are one hidden
thing, and count one.

```ts
export interface TabBarData {
  tabs: Map<string, TabInfo>;
  /** Hidden tabs holding a waiting pane. 0 → no badge is rendered at all. */
  hiddenWaiting: number;
}
```

### D3: Selection activates a PANE, through the primitive that already resolves one

The rule in [worktree-scope.md](../../../docs/design/worktree-scope.md) § 3.3 is decided in
`tabBarScopeWiring.ts` and satisfied by the existing `activatePane`
(`worktree/activatePane.ts:39-52`), exposed as `activatePaneById` (`main.ts:462-476`).

Tab identity cannot answer the question. A mixed split is presented because one leaf is in scope,
while the leaf currently active inside it belongs elsewhere — `switchTab(tabId)` would bring that
tab forward still showing the wrong leaf. `activatePane` sets the owning tab's active pane, persists
it, then shows the tab, which is exactly the operation this rule needs and already exists.

`main.ts` is a side-effectful bootstrap no test imports; WT-010.1 extracted this seam precisely
because three round-1 blockers lived between its call sites. Ordering inside `onSelectWorktree` is
**new scope → activation-or-empty decision → one render**: after `coordinator.select`, before
`renderIfMoved`, so the in-scope test runs against the scope being adopted and the whole selection
costs one draw.

The seam shares the coordinator's own scope predicate rather than restating "in scope" — a second
definition is how the bar and the activation come to disagree about which panes a scope holds.

```ts
export interface TabBarScopeWiringDeps {
  // …existing…
  /** Panes in the bar's presentation order, tab by tab. */
  presentedPanes: () => readonly string[];
  /** The pane currently active, or null. */
  activePane: () => string | null;
  /** Bring this pane forward. Never called with the pane already active. */
  activatePane: (paneId: string) => void;
  /** Show or hide the empty-scope region, and with it the terminal container. */
  showEmptyScope: (worktree: { id: string; label: string } | null) => void;
}
```

### D4: The empty-scope region hides the terminal container without unmounting it

The region is a sibling element of `#terminal-container` (`webviewHtml.ts:749`). While it is shown,
the container is **hidden but left mounted**; showing a pane again restores it.

The container is only ever hidden today as a side effect of switching to another tab
(`main.ts:431-445`), and an empty scope makes no such call — so without an explicit hide, the region
would appear beside the still-visible terminal of the worktree the scope is hiding. That is the
filter failing openly, on screen. Unmounting instead would discard xterm's viewport state and make
`All` a rebuild, which is "scope changes rendering, never process state" violated one layer down.

Its two offers are existing host actions, not the messages `main.ts` posts for the tab bar's `+`:

| Offer | Action | Why not the obvious one |
|---|---|---|
| Open a terminal | `worktreeOpenTerminal` with the scoped `worktreeId` (`messages.ts:833-837`, resolved at `WorktreeHost.ts:992-999`) | `createTab` carries no worktree identity (`messages.ts:107-110`) and would open in the wrong directory |
| Launch an agent | A `WorktreeController` method opening its existing offer-gated launch dialog (`WorktreeController.ts:590-600`, submit at `:347-359`) | Launching is not a single message — it needs the captured generation and the offer gate |

The launch offer follows the controller's own rule: when no launch target is available it is
**omitted**, never rendered inert. A region showing one offer is a correct region.

It reuses `emptyState` (`vault/renderAtoms.ts:603`), whose `action` parameter is widened from one
optional action to an optional list. Nine call sites pass at most one and are unaffected. The atom
already serves worktree and subagent callers as well as vault ones, so widening it is less
distortion than a second empty-state renderer.

### D5: I19 is conjunctive, so both clauses are tagged

`I19 — No filter is invisible, and none silences an attention state` is added to `docs/DESIGN.md`
§ 8.4, to `src/test/invariants/registry.ts` with `status: "covered"` and `owners: ["WT-010.1",
"WT-010.2"]`, and its planned-row is removed from the table below § 8.4.

The statement joins two claims. The chip's presence covers the first and is already tested
(`TabBar.test.ts:779-786`, shipped by WT-010.1); the source-union covers the second and is new here.
Tagging only the new one would leave half the invariant asserting itself. The registry's `owners`
contract is "every task that introduced part of the behaviour" (`registry.ts:15-18`), which is both
tasks.

The `stimulus` must turn the covering tests red and so must name both failures: *omit the chip while
a scope is set, or silence the badge for a tab only one of the two sources reports waiting.*

Coverage is enforced by a reporter attached from the `test:unit` script and **deliberately skipped
on a filtered run** (`coverageReporter.ts:53-73`). A `vitest run <file>` therefore proves nothing
here, which is why this task's Verify is the unfiltered script.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Badge count | Under-reports because one source is consulted | D2 computes the union in one place; the spec requires a scenario per source alone, and I19's stimulus names the single-source silence |
| Badge count | Disagrees with what clearing produces | D2 derives the count from the same pass that drops the tab — no second definition of "hidden" to drift |
| Badge count | Redraws the bar on waiting changes it does not present | D1 keys the derived count, not the raw set; the MODIFIED delta states the narrowed rule and its own scenario tests it |
| Badge count | Growth axis is this surface's open tabs, bounded by what the user opened; recomputed in the pass that already runs per render — no new axis | Same pass as the existing filter |
| Selection → activation | Activates a tab but leaves the wrong leaf showing | D3 uses `activatePane`, which sets the owning tab's active pane before showing it; a mixed-split test covers exactly this |
| Selection → activation | Starts or stops a pane | `activatePane` only sets active-pane state, shows a container and focuses; asserted by a scenario |
| Selection → activation | Two definitions of "in scope" | D3 shares the coordinator's predicate |
| Empty-scope region | Leaves the hidden worktree's terminal on screen | D4 hides `#terminal-container` explicitly; a scenario asserts the pane is no longer presented |
| Empty-scope region | Discards terminal state | D4 hides without unmounting; a test asserts the container stays connected and returns intact |
| Empty-scope region | Opens a terminal in the wrong directory | D4 uses `worktreeOpenTerminal` with the scoped id |
| Empty-scope region | Offers a launch that cannot happen | D4 omits the offer when no target is available, matching the controller's existing rule |
| `emptyState` widening | Breaks nine existing call sites | Additive — the parameter accepts one action or a list |
| I19 | Tagged but half-asserted | D5 tags both clauses and names both owners |
| Failure surface | n/a — no mutable resource outlives the request. The scope's persisted key is WT-010.1's and is unchanged; everything added here is derived per render from state already in the webview |
