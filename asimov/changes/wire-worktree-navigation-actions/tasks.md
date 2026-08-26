# Tasks: wire-worktree-navigation-actions

## 1. The seam

- [ ] 1_1 Route worktree messages by membership, not by a list each provider keeps
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

- [ ] 2_1 Resolve an action's target from the host's own tree and presence
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#an-action-acts-on-the-target-the-user-saw-or-on-nothing; design.md D2, D3, D4
  - **Acceptance**:
    - Outcome: an action whose id no longer names anything performs nothing, and no other target is acted on
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the seven read-only request shapes named in the RPC table
    2. `src/providers/WorktreeHost.ts` — the injected capability seam, resolution of a worktree id against the cached tree and a row id against the published presence, the carried-value comparison, and a miss that performs nothing
    3. `src/providers/WorktreeHost.actions.test.ts` — each action's happy path, an unknown worktree id, an unknown row id, a row whose carried pane or entry id no longer matches, a missing worktree offered only its path, an external row asked to focus, and disposal

- [ ] 2_2 Wire the real capabilities behind the host's seam
  - **Deps**: 2_1
  - **Refs**: design.md D2, D4
  - **Acceptance**:
    - Outcome: a pane is focused in the view that holds it, not the view that asked
    - Verify: unit src/extension.worktreeActions.test.ts
  - **Plan**:
    1. `src/extension.ts` — the capability implementations: open folder, reveal, clipboard, terminal, preview, resume-command, and a focus that reveals the pane's own view before activating it
    2. `src/extension.worktreeActions.test.ts` — the focus wiring resolves an `editor-` view differently from a sidebar or panel view, and reveals the view the pane belongs to

## 3. The view

- [ ] 3_1 Declare the row-activation setting and keep every open view current with it
  - **Deps**: 2_1
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

- [ ] 3_1b Apply the setting, to window rows only
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#row-activation-is-configurable-and-external-rows-are-never-focused; design.md D5
  - **Acceptance**:
    - Outcome: with the setting on focus, an external row still opens its preview
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/main.ts`, `src/webview/worktree/WorktreeController.ts` — forward the value and its updates into the controller, which today receives only the workspace root
    2. `src/webview/worktree/WorktreeView.ts` — resolve an activation from it for window-scope rows, never consulting it for an external row
    3. `src/webview/worktree/WorktreeView.test.ts` — each value on a window row, an external row under both, the default when the host supplied nothing, and a change arriving while the view is open

- [ ] 3_2 Wire every context-menu item to its action
  - **Deps**: 3_1b
  - **Refs**: specs/worktree-panel/spec.md#the-panel-s-read-only-actions-perform-what-they-offer; docs/design/worktree-actions.md#2-action-inventory
  - **Acceptance**:
    - Outcome: each read-only menu item posts the request its action names, carrying ids only
    - Verify: unit src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` — supply the menu's action callbacks, each posting its request
    2. `src/webview/worktree/WorktreeContextMenu.test.ts` — every read-only item posts its own request with the ids it should carry and no path; the items this change does not own stay unwired and are named as such

## 4. The shell

- [ ] 4_1 Extract the context-menu shell the two panels have been duplicating
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

- [ ] 5_1 Answer preview and focus back to the surface that can perform them
  - **Deps**: 3_2
  - **Refs**: specs/worktree-panel/spec.md#a-focused-pane-is-revealed-where-it-actually-lives; design.md D2, D4
  - **Acceptance**:
    - Outcome: a pane is activated inside the surface holding it, not the surface that asked
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the two outbound messages the panel has never had: show a preview for a host-supplied entry id, and activate a host-supplied pane
    2. `src/providers/WorktreeHost.ts` — send each to the surface that must perform it, after the same resolution every other action passes
    3. `src/webview/main.ts`, `src/webview/worktree/WorktreeController.ts` — route them to the existing preview controller and to pane activation, rather than building either again
    4. `src/webview/worktree/WorktreeController.test.ts` — each message reaches the thing that performs it, and one naming an entry or pane the surface does not hold does nothing

- [ ] 5_2 Offer a menu item only when something can perform it
  - **Deps**: 4_1
  - **Refs**: design.md D10, D8, D9
  - **Acceptance**:
    - Outcome: an item whose capability was not supplied is absent, never present and inert
    - Verify: unit src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeContextMenu.ts` — the capabilities become optional and an item is built only when its own capability exists
    2. `src/webview/worktree/WorktreeController.ts` — supply the read-only capabilities only, and the agent-row working-directory items from the row's session; wire a subagent row's activation to its parent's
    3. `src/webview/worktree/WorktreeContextMenu.test.ts` — the mutating and launch items are absent while unsupplied, the working-directory items are absent on a row with no session, and no item is ever rendered disabled
  - **Boundary**: no change to either menu's item ordering or labels — only to whether an item is built at all
