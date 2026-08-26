# Tasks: wire-worktree-navigation-actions

## 1. The seam

- [x] 1_1 Route worktree messages by membership, not by a list each provider keeps — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#the-panel-s-read-only-actions-perform-what-they-offer; design.md D1, D7
  - **Acceptance**:
    - Outcome: every worktree inbound message type reaches the host from both providers
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — derive the worktree inbound subunion from the message union, declare the routing list and the guard, and add the assertion that FAILS THE BUILD for a subunion member the list omits — a bare `Exclude` alias proves nothing
    2. `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalEditorProvider.ts` — one membership test in place of the enumerated cases
    3. `src/providers/TerminalViewProvider.worktree.test.ts` — drive every member through both providers; the list alone cannot prove completeness, so this test covers routing and the build assertion covers membership
    4. the type this seam already dropped is `requestWorktreeSubagents`; it is routed by this task, not left for its own change to re-add

## 2. The host

- [x] 2_1 Resolve an action's target from the host's own tree and presence — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0 — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#an-action-acts-on-the-target-the-user-saw-or-on-nothing; design.md D2, D3, D4
  - **Acceptance**:
    - Outcome: an action whose id no longer names anything performs nothing, and no other target is acted on
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the seven read-only request shapes named in the RPC table
    2. `src/providers/WorktreeHost.ts` — the injected capability seam, resolution of a worktree id against the cached tree and a row id against the published presence, the carried-value comparison, and a miss that performs nothing; opening a terminal is asked of the requesting surface rather than of the injected capabilities, because only a surface can create a pane
    3. `src/providers/WorktreeHost.actions.test.ts` — each action's happy path, an unknown worktree id, an unknown row id, a row whose carried pane or entry id no longer matches, a missing worktree offered only its path, an external row asked to focus, and disposal
    4. `src/providers/TerminalViewProvider.worktree.test.ts` — 1_1's routing suite is keyed on `WORKTREE_MESSAGE_TYPES`, so declaring these nine types makes covering them a compile error there; its sample table gains one message per new type

- [x] 2_2 Wire the real capabilities behind the host's seam — verified: pnpm exec vitest run 'src/extension.worktreeActions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D2, D4
  - **Acceptance**:
    - Outcome: a pane is focused in the view that holds it, not the view that asked
    - Verify: unit src/extension.worktreeActions.test.ts
  - **Plan**:
    1. `src/extension.ts` — the capability implementations: open folder, reveal, clipboard, resume-command, the agent-cwd pair, and a focus that reveals the pane's own view before activating it
    2. `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalEditorProvider.ts` — each surface opens a terminal in its own view, at the path the host resolved
    3. `src/extension.worktreeActions.test.ts` — the focus wiring resolves an `editor-` view differently from a sidebar or panel view, and reveals the view the pane belongs to
    4. `src/providers/TerminalViewProvider.worktree.test.ts` — a terminal request creates a pane in the surface that asked, with that worktree as its cwd

## 3. The view

- [x] 3_1 Declare the row-activation setting and keep every open view current with it — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#row-activation-is-configurable-and-external-rows-are-never-focused; design.md D5
  - **Acceptance**:
    - Outcome: a setting change reaches a panel that is already open
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. `package.json` — declare the setting with its values and default
    2. `src/settings/SettingsReader.ts` — read it, defaulting when unset or when the stored value is neither
    3. `src/types/messages.ts` — the initial value on the init payload, and the update the providers push
    4. `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalEditorProvider.ts` — listen for the configuration change and push it, as the neighbouring UI settings already do
    5. `src/providers/TerminalViewProvider.worktree.test.ts` — the initial value arrives in init, and a change reaches an attached surface
    6. `src/webview/messaging/MessageRouter.test.ts` — its hand-built `init` fixture must carry the new required field; the payload is required rather than optional so no init path can omit the value the view needs before it paints

- [x] 3_1b Apply the setting, to window rows only — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#row-activation-is-configurable-and-external-rows-are-never-focused; design.md D5
  - **Acceptance**:
    - Outcome: with the setting on focus, an external row still opens its preview
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/main.ts`, `src/webview/messaging/MessageRouter.ts`, `src/webview/worktree/WorktreeController.ts` — route the update message and forward the value and its updates into the controller, which today receives only the workspace root
    2. `src/webview/worktree/worktreeViewTypes.ts` — re-export the host's `WorktreeRowActivation`, as this file already does for every other host-owned type
    3. `src/webview/worktree/WorktreeView.ts` — resolve an activation from it for window-scope rows, never consulting it for an external row
    4. `src/webview/worktree/WorktreeView.test.ts` — each value on a window row, an external row under both, the default when the host supplied nothing, and a change arriving while the view is open
    5. `src/webview/worktree/WorktreeController.ts` — post the resolved activation as its own request, ids only; without this the setting resolves to a value nothing performs and the Outcome is unobservable
    6. `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeController.state.test.ts` — the init fixtures gain the now-required field, and the controller carries an update through to what it posts

- [x] 3_2 Wire every context-menu item to its action — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeContextMenu.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1b
  - **Refs**: specs/worktree-panel/spec.md#the-panel-s-read-only-actions-perform-what-they-offer; docs/design/worktree-actions.md#2-action-inventory
  - **Acceptance**:
    - Outcome: each read-only menu item posts the request its action names, carrying ids only
    - Verify: unit src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` — supply the menu's action callbacks, each posting its request
    2. `src/webview/worktree/WorktreeContextMenu.test.ts` — every read-only item posts its own request with the ids it should carry and no path; the items this change does not own stay unwired and are named as such
    3. `src/webview/worktree/WorktreeController.test.ts` — the case asserting the controller offers NO menu encoded the pre-action state this task reverses; it becomes the menu opening over a real worktree

## 4. The shell

- [x] 4_1 Extract the context-menu shell the two panels have been duplicating — verified: pnpm exec vitest run 'src/webview/shared/contextMenuShell.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: specs/vault-panel/spec.md#a-context-menu-is-keyboard-navigable-and-gives-focus-back; specs/vault-panel/spec.md#a-menu-item-s-action-runs-after-the-menu-is-gone; design.md D6
  - **Acceptance**:
    - Outcome: the vault menu gains first-item focus, arrow navigation, focus restore on Escape, and dismissal before the item acts
    - Verify: unit src/webview/shared/contextMenuShell.test.ts
  - **Plan**:
    1. `src/webview/shared/contextMenuShell.ts` — lifecycle, cursor-anchored clamped placement, dismissal, keyboard behaviour, and anchor-row focus restore; item sets stay with each menu
    2. `src/webview/vault/VaultContextMenu.ts`, `src/webview/worktree/WorktreeContextMenu.ts` — both become callers, each keeping its own items and its own absent-not-disabled rules
    3. `src/webview/shared/contextMenuShell.test.ts` — the four behaviours the extraction settles, driven through the shell directly
    4. `src/webview/vault/VaultContextMenu.test.ts` — the vault menu's own items and file-backed omissions still hold, now over the shared shell
  - **Boundary**: no change to either menu's item set, ordering, or the conditions under which an item is offered

## 5. The halves the extension cannot perform

- [x] 5_1 Answer preview and focus back to the surface that can perform them — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: specs/worktree-panel/spec.md#a-focused-pane-is-revealed-where-it-actually-lives; design.md D2, D4
  - **Acceptance**:
    - Outcome: a pane is activated inside the surface holding it, not the surface that asked
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the two outbound messages the panel has never had: show a preview for a host-supplied entry id, and activate a host-supplied pane
    2. `src/providers/WorktreeHost.ts` — send each to the surface that must perform it, after the same resolution every other action passes
    3. `src/webview/messaging/MessageRouter.ts` — route the two inbound messages, which the router has no case for yet
    4. `src/webview/main.ts`, `src/webview/vault/VaultPanel.ts`, `src/webview/worktree/WorktreeController.ts` — hand each to the existing preview controller and to pane activation, rather than building either again; the vault panel is where the entry the overlay needs already lives
    5. `src/webview/worktree/WorktreeController.test.ts` — each message reaches the thing that performs it, and one naming an entry or pane the surface does not hold does nothing
    6. `src/webview/messaging/MessageRouter.test.ts` — the three worktree messages this change added to the union each reach their handler; an unrouted case is exactly the seam D7 names

- [x] 5_2 Offer a menu item only when something can perform it — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeContextMenu.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md D10, D8, D9
  - **Acceptance**:
    - Outcome: an item whose capability was not supplied is absent, never present and inert
    - Verify: unit src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeContextMenu.ts` — the capabilities become optional and an item is built only when its own capability exists
    1b. `src/webview/worktree/WorktreeView.ts` — the worktree card's open-folder affordance is offered on the same condition, since it calls the same now-optional capability
    2. `src/webview/worktree/WorktreeController.ts` — supply the read-only capabilities only, and the agent-row working-directory items from the row's session; wire a subagent row's activation to its parent's
    3. `src/webview/worktree/WorktreeContextMenu.test.ts` — the mutating and launch items are absent while unsupplied, the working-directory items are absent on a row with no session, and no item is ever rendered disabled
    4. `src/webview/worktree/WorktreeController.test.ts` — a subagent row's activation reaches its PARENT's pane, which is a controller behaviour and not a menu one
  - **Boundary**: no change to either menu's item ordering or labels — only to whether an item is built at all

## 6. Review round 1

- [x] 6_1 Close the four round-1 findings that the accepted design already covers — verified: pnpm exec vitest run 'src/webview/worktree/activatePane.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_2
  - **Refs**: .reviews/round-1.md#B2; .reviews/round-1.md#B3; .reviews/round-1.md#W1; .reviews/round-1.md#W2; design.md D3, D5, D10
  - **Acceptance**:
    - Outcome: no offered navigation control resolves to nothing — a pane whose tab lost its root still comes forward, a row with no session is not offered a preview, a malformed open-folder mode fails closed, and a setting change during init still reaches the view
    - Verify: unit src/webview/worktree/activatePane.test.ts
  - **Plan**:
    1. `src/webview/worktree/activatePane.ts` (new), `src/webview/main.ts` — pane resolution moves out of the bundle entry so it can be tested at all, and reports success only when the owning tab can actually be shown (B2)
    2. `src/webview/worktree/WorktreeContextMenu.ts` — the preview item needs a session, like the three items beside it (B3)
    3. `src/webview/worktree/WorktreeView.ts` — a window row with no session falls back to focusing its pane, so activation is never a dead click (B3)
    4. `src/providers/WorktreeHost.ts` — the open-folder mode is validated at the boundary, not trusted (W1)
    5. `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalEditorProvider.ts` — re-send the current activation after init is delivered, closing the window in which an update is dropped (W2)
    6. `src/webview/worktree/activatePane.test.ts` (new), `src/webview/worktree/WorktreeContextMenu.test.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/providers/WorktreeHost.actions.test.ts`, `src/providers/TerminalViewProvider.worktree.test.ts` — one case per finding
  - **Boundary**: B1's editor half is NOT in scope — it is handed back to asimov-plan

- [x] 6_2 Stop dropping a preview that arrived before the vault list did — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.preview.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_1
  - **Refs**: .reviews/round-1.md#B1; design.md D2
  - **Acceptance**:
    - Outcome: a preview raised before this surface's vault list has loaded opens once the list arrives, instead of being discarded
    - Verify: unit src/webview/vault/VaultPanel.preview.test.ts
  - **Plan**:
    1. `src/webview/vault/VaultPanel.ts` — a miss holds the host-resolved id in a single slot and opens it on the first render that contains it; a later miss replaces the slot rather than queueing
    2. `src/webview/vault/VaultPanel.preview.test.ts` (new) — opens immediately when the entry is present, opens on the arriving list when it was not, keeps only the newest pending id, and clears the slot once opened
  - **Boundary**: does NOT address B1's editor half — that surface never receives a vault list at all and is handed back to asimov-plan

- [x] 6_3 Let an editor surface answer the two vault reads a preview needs — verified: pnpm exec vitest run 'src/providers/TerminalEditorProvider.vault.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_2
  - **Refs**: .reviews/round-1.md#B1; specs/worktree-panel/spec.md#the-panel-s-read-only-actions-perform-what-they-offer; design.md D2
  - **Acceptance**:
    - Outcome: a session preview raised from an editor surface opens there, as it already does from the sidebar and the panel
    - Verify: unit src/providers/TerminalEditorProvider.vault.test.ts
  - **Plan**:
    1. `src/providers/TerminalEditorProvider.ts`, `src/providers/TerminalPanelSerializer.ts`, `src/extension.ts` — the editor surface receives the same `VaultService` the view provider has and answers `requestVaultSessions` and `requestVaultSessionDetail`, which is everything the preview overlay reads
    2. `src/providers/TerminalEditorProvider.vault.test.ts` (new) — both replies reach this panel's webview, a superseded list refresh is dropped, and a surface with no vault service answers nothing rather than throwing
  - **Boundary**: only the two READS the preview needs. The vault panel's own mutating and launch items (rename, resume, watch, launch targets) stay unwired on editor surfaces — they were unwired before this change and belong to the vault capability, not to WT-005.1


- [x] 7_1 Bring a pane forward even when its tab lost the pane it was named after — verified: pnpm exec vitest run 'src/webview/split/tabDisplay.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_3
  - **Refs**: .reviews/round-2.md#B2; design.md D4
  - **Acceptance**:
    - Outcome: a pane in a tab whose root pane was closed is brought forward on activation
    - Verify: unit src/webview/split/tabDisplay.test.ts
  - **Plan**:
    1. `src/webview/split/tabDisplay.ts` (new) — resolves the pane a tab can be displayed through: its root when live, otherwise the first live leaf in its layout. Importable, because `main.ts` is the bundle entry and cannot be loaded under vitest
    2. `src/webview/main.ts` — the tab display path stops requiring `store.terminals.get(tabId)` and asks that resolver instead, so a tab whose root pane was closed is still reachable (from the tab bar as well as from a row activation)
    3. `src/webview/worktree/activatePane.ts` — the `hasTerminal(tabId)` precondition becomes a check that the tab can be displayed, so success is reported when the pane is actually brought forward
    4. `src/webview/split/tabDisplay.test.ts` (new), `src/webview/worktree/activatePane.test.ts` — the round-1 case that codified failure is replaced by the activation it should have asserted, and the rootless-tab resolution is covered directly
  - **Boundary**: display/activation only — no change to how panes are created, closed, or persisted

- [x] 7_2 Stop offering vault actions on a surface that cannot perform them — verified: pnpm exec vitest run 'src/webview/vault/VaultContextMenu.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_1
  - **Refs**: .reviews/round-2.md#B4; specs/worktree-panel/spec.md#the-panel-s-read-only-actions-perform-what-they-offer; design.md D10
  - **Acceptance**:
    - Outcome: an editor surface's vault rows offer only actions it can perform; the rest are absent
    - Verify: unit src/webview/vault/VaultContextMenu.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the init payload carries whether this surface can perform vault ACTIONS. One flag, not a capability enum: the split is all-or-nothing per surface today (the editor answers 0 of the 13 action messages), and the finer `fileBacked`/`canResume` gates already inside the menu compose with it
    2. `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalEditorProvider.ts` — each provider declares its own value; the editor declares false, because it answers only the two reads
    3. `src/webview/main.ts`, `src/webview/vault/VaultPanel.ts` — the flag reaches every affordance owner
    4. `src/webview/vault/VaultContextMenu.ts` — every item is absent when actions are unavailable
    5. `src/webview/vault/vaultListView.ts` — the row's Resume button is absent for the same reason
    6. `src/webview/vault/PreviewController.ts` — the overlay opens (that is what 6_3 delivered) but its own Continue / Watch / Resume / rename / launch controls are absent; B4's invariant is every reachable inert control, not only the list menu
    7. `src/webview/messaging/MessageRouter.test.ts` — the init fixture carries the new field
    8. `src/webview/vault/VaultContextMenu.test.ts`, `src/webview/vault/VaultPanel.preview.test.ts`, `src/providers/TerminalEditorProvider.vault.test.ts` — an action-capable surface is unchanged, and a read-only surface previews without offering anything it cannot perform
  - **Boundary**: hides what this surface cannot do; does NOT wire resume, rename, watch, or launch — those belong to the vault capability and to WT-005.3

- [x] 7_3 Close the init/activation ordering window on cold-created surfaces — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_2
  - **Refs**: .reviews/round-2.md#W2; design.md D5
  - **Acceptance**:
    - Outcome: a cold-created surface receives its row activation after init, even when init's first attempt fails
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalEditorProvider.ts` — the cold-create branches await init delivery before posting the current activation, matching the four branches that already do
    2. `src/providers/TerminalViewProvider.worktree.test.ts` — a cold create whose first init attempt fails still delivers activation after init, not before
    3. `src/providers/TerminalViewProvider.test.ts` — the retry-count test lets the ready path settle before resetting its spy, so it counts `createTab`'s attempts rather than the ready path's activation post
  - **Boundary**: ordering only — no change to what init carries or to the retry policy itself

- [x] 8_1 Pin the init/activation ordering on the editor provider too — verified: pnpm exec vitest run 'src/providers/TerminalEditorProvider.vault.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_3
  - **Refs**: .reviews/round-3.md#W3; .reviews/round-2.md#W2
  - **Acceptance**:
    - Outcome: an editor surface whose first init attempt fails still posts activation after init
    - Verify: unit src/providers/TerminalEditorProvider.vault.test.ts
  - **Plan**:
    1. `src/providers/TerminalEditorProvider.vault.test.ts` — the round-2 W2 ordering case, ported to this provider's own harness: fail the first `init` by message type, let the retry land, and assert the activation post follows it. The editor has its own message loop and its own retry helper, so the view provider's test constrains none of it
  - **Boundary**: test only — the production ordering was fixed in 7_3 and is not touched

- [x] 8_2 Say what the vault capability flag actually governs — verified: manual — Comment-only change to the vaultActionsAvailable contract in messages.ts — no behaviour altered. Reviewed the rendered doc against the code it describes: the eight named actions are each gated in VaultContextMenu/vaultListView/VaultPanel/PreviewController by 7_2, and vaultWatchSession is posted unconditionally at PreviewController.ts:273 and :323, which the new NOT-gated paragraph now states. Type check clean.
  - **Deps**: 8_1
  - **Refs**: .reviews/round-3.md#S1
  - **Acceptance**:
    - Outcome: the capability flag's contract names user-facing controls and exempts live-follow traffic
    - Verify: none — comment-only; the behaviour it describes is already covered by 7_2's tests
  - **Plan**:
    1. `src/types/messages.ts` — the `vaultActionsAvailable` doc no longer lists `watch` among what it gates, and states why: `vaultWatchSession` is automatic preview lifecycle traffic rather than an offered control, so it is not gated and is simply dropped on a surface that does not answer it
  - **Boundary**: documentation only — no gating change; gating watch would make the editor preview static for no user-visible gain
