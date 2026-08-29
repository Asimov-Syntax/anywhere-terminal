# Tasks: open-an-inspector-drawer-on-selection

## 1. Shared seams

- [x] 1_1 Extract the worktree action item set so one gating rule serves the menu and the drawer — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeContextMenu.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{the-inspector-offers-only-actions-it-can-perform-on-this-worktree, an-inspector-action-performs-what-its-menu-equivalent-performs} <!-- design.md D4 -->
  - **Acceptance**:
    - Outcome: the menu's items come from a shared builder and are unchanged
    - Verify: unit src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/worktreeActionItems.ts` exporting `worktreeActionItems(info, actions, opts)` with the signature in design.md § Interfaces, moving the body of `WorktreeContextMenu.worktreeItems` and its `item` helper into it verbatim.
    2. Gate the two repo-targeted items — `createWorktree` and `pruneRepo` — on `opts.repoScoped`, so both are absent when it is `false`.
    3. In `src/webview/worktree/WorktreeContextMenu.ts` delete `worktreeItems` and `item`, and have `openForWorktree` call `worktreeActionItems(info, this.actions, { prunableCount: this.prunableCount(info), repoScoped: true })`.
    4. Add cases to `src/webview/worktree/WorktreeContextMenu.test.ts` asserting `repoScoped: false` withholds New Worktree and Prune while leaving every worktree-targeted item present, and that `repoScoped: true` produces the item list the shipped tests already assert.

- [x] 1_2 Let the agent renderers draw outside a tree, be focusable, and name the model — verified: pnpm exec vitest run 'src/webview/worktree/worktreeTreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{the-inspector-names-the-model-that-no-row-names, the-inspector-carries-the-delegation-history-of-each-agent-it-presents, the-inspector-does-not-take-focus-and-gives-it-back} <!-- design.md D5, D11 -->
  - **Acceptance**:
    - Outcome: an agent row can render as a focusable list item carrying its model
    - Verify: unit src/webview/worktree/worktreeTreeView.test.ts
  - **Plan**:
    1. In `src/webview/worktree/worktreeTreeView.ts` add `role`, `focusable`, `disclosure` and `showModel` to `AgentRowOptions`, all defaulting to today's behaviour: role `treeitem`, `tabIndex = -1`, disclosure on, no model.
    2. With `disclosure: false`, `renderAgentRow` sets no `aria-expanded` and draws the gutter with no chevron and no click handler, so nothing inert is offered beside history that is already shown; with `focusable: true` it sets `tabIndex = 0`.
    3. With `showModel: true` and `row.model` set, append a `span.wt-amodel` carrying `row.model` **inside the title element**, never as a root child of `.wt-arow` — the row declares exactly seven grid tracks and a root child would add an eighth. Append nothing when `row.model` is undefined.
    4. Add `opts` to `renderSubagentSection` per design.md § Interfaces: `role`, `rowRole`, `focusable`, and `noSession` — the last drawing the explicit "no session to read" state for a row that can never have a roster, instead of the indefinite "Reading…".
    5. Add tests to `src/webview/worktree/worktreeTreeView.test.ts` covering: every default is unchanged; `role: "listitem"` applied; `focusable` raises the tab stop on agent and subagent rows; `disclosure: false` leaves no `aria-expanded` and no clickable chevron; `showModel` prints the model inside the title cell and adds no root child; `showModel` with no model prints no element and no placeholder; `noSession` draws its own state.

- [x] 1_3 Key the model into the render signature and expose a scoped one — verified: pnpm exec vitest run 'src/webview/worktree/worktreeRenderSignature.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-push-that-changes-nothing-changes-no-pixel-of-the-inspector <!-- design.md D7, D8 -->
  - **Acceptance**:
    - Outcome: a signature over one worktree ignores every field outside it
    - Verify: unit src/webview/worktree/worktreeRenderSignature.test.ts
  - **Plan**:
    1. In `src/webview/worktree/worktreeRenderSignature.ts` add `r.model ?? ""` to the per-row field list, with a comment naming the inspector as what draws it.
    2. Lift the per-worktree and per-row field encoders into `worktreeScopeSignature(info, rows, degraded, now)` with the signature in design.md § Interfaces, and have `worktreeSignature` keep composing those same encoders so both answers stay derived from one definition.
    3. Add tests asserting: the full signature moves when only `model` changes; an absent model and an empty one are distinguished from a real id; and the scoped signature does **not** move for a change to `gitAvailable`, to `unreadable`, to a repo label, main path or degradation, or to another worktree's rows — while it does move for the selected worktree's own fields and its agents'.

- [x] 1_4 Give the two surfaces one reconciled roster-request set — verified: pnpm exec vitest run 'src/webview/worktree/worktreeRosterRequests.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-history-is-requested-once-per-session-and-again-if-that-session-returns <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: one request per row and session across every surface that presents it
    - Verify: unit src/webview/worktree/worktreeRosterRequests.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/worktreeRosterRequests.ts` exporting `rosterKey` and the `RosterRequests` class in design.md § Interfaces, moving `rosterKey` out of `src/webview/worktree/WorktreeView.ts` unchanged.
    2. `want(row)` records the row against its key and is a no-op for a row with no key; `flush(send)` sends each newly wanted row once and clears the queue; `reconcile(liveKeys)` drops asked keys absent from `liveKeys`, matching the eviction `WorktreeView.pruneStaleState` performs today.
    3. In `src/webview/worktree/WorktreeView.ts` replace the private `requestedRosters` set and its inline eviction with one `RosterRequests` instance, calling `want` where the view asks today and `flush` **after** `renderListing` has committed the DOM — not from inside the repo loop, which `renderListing`'s own docstring warns re-enters the render.
    4. Write `src/webview/worktree/worktreeRosterRequests.test.ts` covering: one send for two `want` calls on one key; no send for a row with no session; a key dropped by `reconcile` can be wanted again; and nothing is sent before `flush`.

- [x] 1_5 Let the panel say whether a preview is open over it — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.preview.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#dismissing-the-inspector-leaves-the-selection-and-the-scope-alone <!-- design.md D9 -->
  - **Acceptance**:
    - Outcome: the panel reports whether its session preview is currently open
    - Verify: unit src/webview/vault/VaultPanel.preview.test.ts
  - **Plan**:
    1. In `src/webview/vault/PreviewController.ts` add `isOpen(): boolean` returning `this.shell.isOpen()`.
    2. In `src/webview/vault/VaultPanel.ts` add `isPreviewOpen(): boolean` delegating to it, in the same shape as the shipped `isContextMenuOpen` dep.
    3. Add a case to `src/webview/vault/VaultPanel.preview.test.ts` asserting it reads false before an open, true while open, and false again after Escape closes the preview.

## 2. The drawer

- [ ] 2_1 Build the inspector drawer
  - **Deps**: 1_1, 1_2, 1_3, 1_4
  - **Refs**: specs/worktree-panel/spec.md#{selecting-a-worktree-opens-an-inspector-under-the-tree, the-inspector-is-bounded-so-the-tree-stays-scannable, the-inspector-states-the-full-path-and-rows-still-state-none, the-inspector-names-the-model-that-no-row-names, a-push-that-changes-nothing-changes-no-pixel-of-the-inspector, the-inspector-keeps-its-own-claims-current-without-a-push, the-inspector-offers-only-actions-it-can-perform-on-this-worktree, the-inspector-carries-the-delegation-history-of-each-agent-it-presents} <!-- design.md D2, D5, D6, D7, D10, D11, D12 -->
  - **Acceptance**:
    - Outcome: the drawer draws one worktree's branch, path, actions, agents and delegations
    - Verify: unit src/webview/worktree/WorktreeInspector.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/WorktreeInspector.ts` implementing the class in design.md § Interfaces: `element` is a `div.wt-inspector` with `role="region"` and an `aria-label` naming the branch, carrying `hidden` while closed and mounted whether or not the rollout is on.
    2. Draw, in order: a header with the branch label and a close button labelled `Close inspector`; the full `info.displayPath` in a `div.wt-ipath`; and an actions row from `worktreeActionItems(info, deps.actions, { prunableCount: 0, repoScoped: false })`, rendering each item as a button and dropping every separator.
    3. Draw a `div.wt-iagents` with `role="list"` holding one `renderAgentRow` per agent row of the selected worktree with `role: "listitem"`, `showModel: true`, `focusable: true`, `disclosure: false`, each followed by `renderSubagentSection` for that row with `role: "list"`, `rowRole: "listitem"`, `focusable: true`, and `noSession: true` where the row has no `entryId`; derive the drawn activity with `presentedActivity` from the presence last received, and route agent activation through `deps.rowActivation` exactly as `WorktreeController` does for the tree.
    4. Ask for rosters through the shared `RosterRequests` the controller supplies: `want` each drawn agent row during the render, then `flush` after the DOM is committed.
    5. Guard the redraw on `worktreeScopeSignature` for the selected worktree, its rows and the degradation list, returning without touching the DOM when it is unchanged; `refresh()` re-runs the same guard with a fresh `now`. Give every focusable node a `data-focus` value — close, each action, each agent row, each subagent row — and before a redraw that runs, record the `data-focus` of the active element when `element.contains(document.activeElement)` and re-focus that value afterwards.
    6. In `src/webview/worktree/worktreePanel.css` add `.wt-body` with `display: flex`, `flex-direction: column`, `flex: 1 1 auto`, `min-height: 0` and `min-width: 0`; `.wt-inspector` with `max-height: 50%`, `overflow-y: auto`, `flex: 0 0 auto` and a top border; and `.wt-ipath`, `.wt-iagents`, `.wt-iactions` with its buttons, and `.wt-amodel`.
    7. Write `src/webview/worktree/WorktreeInspector.test.ts` covering: branch and full path drawn and no path on any list row; a missing worktree withholds the openers and keeps Copy Path; the main worktree offers no remove; New Worktree and Prune are absent; an action click calls the same `WorktreeMenuActions` member with the worktree, and remove stays unforced; an external agent is offered no focus; model shown when known, nothing when not; all five delegation states including no-session; `refresh()` redraws a row that crossed the confirmation ceiling with no new data; an unchanged `setData` — and one changing another worktree, a repo label and `gitAvailable` — leaves the *same focused node object* focused; and a source read of `worktreePanel.css` asserting the `.wt-body` flex chain, `.wt-inspector`'s bounded `max-height` with `overflow-y: auto`, and `.wt-tree`'s surviving `min-height: 0`.

- [ ] 2_2 Open the drawer from a selection and dismiss it explicitly
  - **Deps**: 2_1, 1_5
  - **Refs**: specs/worktree-panel/spec.md#{selecting-a-worktree-opens-an-inspector-under-the-tree, dismissing-the-inspector-leaves-the-selection-and-the-scope-alone, the-inspector-does-not-take-focus-and-gives-it-back, the-inspector-keeps-its-own-claims-current-without-a-push} <!-- design.md D1, D2, D3, D7, D9, D12 -->
  - **Acceptance**:
    - Outcome: selecting opens the drawer, closing it leaves the selection and scope untouched
    - Verify: unit src/webview/worktree/WorktreeController.inspector.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeView.ts` add an `onInspect` dep taking a worktree id and an `onCeilingTick` dep taking nothing; raise `onInspect` inside `select` in the order design.md D3 fixes — never on the gated-off path, alone on the unchanged-selection path, and last of the three on a move — and raise `onCeilingTick` after each confidence re-derivation.
    2. In `src/webview/worktree/WorktreeController.ts` build `this.element` as a `div.wt-body` containing `this.view.element` and the inspector's element, and give the inspector the same `menuActions`, `RosterRequests`, `onActivateAgent`, `onActivateSubagent`, `rowActivation` and `now` the view holds.
    3. Wire `onInspect` to the inspector's `open`, `onCeilingTick` to its `refresh`, and the `null` case of `onSelectWorktree` to its `close`, so the scope chip's clear and a selected worktree leaving the tree both close it; call `setData` from `push()` after the view's own update; close it from `setWorkbench` on the disabling edge.
    4. Add an `overlayOpen` dep to `WorktreeControllerDeps` and bind a bubbling `keydown` on `this.element` that, only while the drawer is open and `overlayOpen()` is not true, closes the drawer on `Escape` and calls `stopPropagation`.
    5. Give the inspector an `onClosed` that focuses the worktree row for that id inside the tree when focus was within the drawer, falling back to the tree itself when that row is no longer rendered.
    6. In `src/webview/main.ts` pass `overlayOpen: () => vaultPanel?.isPreviewOpen() === true` to the controller.
    7. Write `src/webview/worktree/WorktreeController.inspector.test.ts` covering: selecting opens the drawer and leaves focus on the row; selecting another replaces the contents; closing keeps the selection and posts no scope message; re-activating the selected row reopens it; Escape closes it; Escape does nothing while `overlayOpen` is true; clearing the selection closes it; a selected worktree leaving the tree closes it; turning the rollout off closes it; the rollout off leaves it mounted but hidden; and the close control returns focus to the row, and to the tree when that row was filtered out.
