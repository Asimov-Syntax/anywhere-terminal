# Review Round 1

- Date: 2026-08-27
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: working tree
- Reviewable lines: 2298
- Size note: Large change — accuracy may decrease.
- Agents spawned:
  - asm-review-logic — cross-layer action routing, stale identity, async behavior, and full-flow completion — gpt-5.6-sol[1M]
  - asm-review-frontend — row activation, menu behavior, preview/focus handback, and accessibility — gpt-5.6-terra[1M]
  - asm-review-contracts — typed message inventory, provider/host interfaces, and approved design obligations — sonnet[1M]
  - asm-review-data-security — webview trust boundary and host-owned target resolution — gpt-5.6-terra[1M]
  - asm-review-reuse — shared menu shell and reuse of existing preview/pane/resume/terminal capabilities — gpt-5.6-luna[1M]
  - asm-finder — full-flow tracing for preview, pane focus, and terminal creation — gpt-5.6-luna[1M]
- Agents skipped:
  - asm-review-performance — no persistence/list growth axis, full-history recompute, duplicate accumulation, or materially changed hot path; pane lookup is bounded by the window's open panes and user-triggered
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 2 | SUGGEST 0
- Verification: chair-observed `pnpm run check-types` passed; 205 focused tests across 10 changed suites passed. `git diff --check` found only a blank line at EOF in skipped workflow metadata; no production whitespace error.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.ts:989
- title: Host-approved previews are dropped when the receiving surface lacks the vault entry
- evidence: `WorktreeHost` answers `worktreeOpenPreview` only to the requesting surface with a host-resolved `entryId`. The new webview path then calls `VaultPanel.openPreviewById`, which searches only `this.entries` and returns `false` when absent; `WorktreeController.showPreview` discards that result. `TerminalEditorProvider` handles no `requestVaultSessions` or other vault-list messages at all, while `TerminalViewProvider` does, so an editor surface's `entries` remains empty and every valid worktree preview handback there is rejected. Sidebar/panel surfaces can also hit the same boundary before their independent vault refresh completes or while their list is stale. Boundary inventory: editor surface affected always; sidebar/panel cold-list and refresh-race paths affected; client-side search/folder filtering verified safe because it does not remove entries from `this.entries`.
- impact: “Open Session Preview” and preview row activation silently do nothing in editor surfaces, violating the accepted requirement that offered actions work from sidebar, panel, and editor. The same silent failure remains reachable during list synchronization on the other surfaces.
- suggestedFix: Make preview resolution independent of the receiving surface's current list: perform/load a point lookup by the host-resolved `entryId`, or include the host-resolved entry summary needed to open the existing overlay. Do not treat local-list absence as successful completion.
- status: accepted (B1a fixed in 6_1; B1b handed back to asimov-plan)
- triage: |
  Verified in two parts, and they are NOT the same defect.
    B1a — the list race on sidebar/panel: confirmed. `openPreviewById` treats an absent entry as a
    final answer, and the vault list is fetched independently of the worktree tree, so a preview
    raised before the list lands is dropped. Fixed in-contract: the panel holds the pending id and
    opens it on the first render that contains it.
    B1b — the editor surface: confirmed and NOT fixable inside this change's accepted design.
    `TerminalEditorProvider` handles zero vault message types (its switch has no `vault*` /
    `requestVault*` case) and holds no `VaultService` at all, so the vault panel it renders is inert
    for every vault feature, not only this one — a condition that predates this diff. Carrying the
    entry in the handback does not fix it either: `PreviewController.open()` then posts
    `requestVaultSessionDetail`, which that surface also drops, leaving the overlay permanently
    empty. Making preview work there needs an owner for vault handling across surfaces, which D2
    never assigned; making it truthfully ABSENT there contradicts the accepted requirement that an
    external row's activation opens its preview whatever the setting says. Either way an accepted
    artifact has to move, so B1b is handed back to asimov-plan rather than patched here.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts:457
- title: Pane activation cannot reveal a tab after its original root pane was closed
- evidence: `activatePaneById` finds the target leaf in `store.tabLayouts`, calls `switchTab(tabId)`, then returns `true`. `switchTab` immediately returns when `store.terminals.get(tabId)` is absent. `closeSplitPaneById` permits closing the original root leaf while retaining the remaining layout under the original tab id, deletes that root terminal, and keeps the tab alive. When such a rootless split tab is hidden, worktree focus reveals the correct VS Code surface but `switchTab` cannot show the owning tab; the function still reports success and focuses a terminal inside the hidden container.
- impact: A valid pane focus request can leave a different tab visible, violating the accepted invariant that the pane's actual surface and pane become visible and active.
- suggestedFix: Switch tabs using the active pane or first remaining layout leaf as the fallback terminal when the root-id terminal no longer exists, and return success only after the owning tab container was actually shown.
- status: accepted
- triage: |
  Confirmed. `closeSplitPaneById` deletes `store.terminals[paneSessionId]` while leaving
    `tabLayouts[activeTabId]` in place, so after the ROOT pane of a split is closed the tab id still
    keys a layout with no terminal. `switchTab` returns early on exactly that state, and
    `activatePaneById` reports success regardless. Fixed: resolve the tab's displayable pane and
    report success only once the owning tab is actually shown.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeContextMenu.ts:95
- title: Sessionless agent rows expose preview actions that cannot dispatch
- evidence: The presence model intentionally publishes valid window agent rows without `entryId` when identity is proven from launch/title evidence but no Claude session is resolved. `WorktreeContextMenu.agentItems` nevertheless always builds “Open Session Preview” whenever the callback exists. The callback in `worktreeMenuActions` posts nothing when `row.entryId` is absent. The same state makes row activation under the `preview` setting silently do nothing at `WorktreeController.ts:148-150`.
- impact: The menu presents a live action that is inert, and the configured preview activation becomes a dead click for valid Codex/OpenCode/title-derived window rows. This directly violates the accepted absent-not-inert rule and row-activation contract.
- suggestedFix: Gate the preview menu item on actual preview identity, and define a truthful activation path for window rows without an entry (for example, focus the available pane, or extend host resolution so preview can be performed). Do not leave the configured activation as a no-op.
- status: accepted
- triage: |
  Confirmed, and it is this change's own rule turned against it. `entryId` is optional on
    `WorktreeAgentRow` ("once resolved"), the menu builds "Open Session Preview" unconditionally, and
    the controller's callback posts nothing without one — present and inert, which D10 forbids. Row
    activation under `preview` has the same hole. Fixed: preview is offered only on a row that has a
    session, and a window row with none falls back to focusing its pane rather than doing nothing.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:449
- title: Open-folder mode is not validated at the webview boundary
- evidence: Providers validate only that the inbound value is an object with a string `type`, then cast it to `WebViewToExtensionMessage`; `isWorktreeMessage` validates membership only. The host forwards `msg.mode` unchanged to `actions.openFolder`. `createWorktreeActions` treats only exact `"newWindow"` specially and routes every other value, including missing or malformed values from a crafted webview message, to `addWorkspaceFolder`. The approved RPC validation contract restricts this field to `"newWindow" | "addToWorkspace"` and requires host-side validation.
- impact: A malformed or compromised webview can turn an invalid open-folder request into a workspace mutation instead of a fail-closed no-op.
- suggestedFix: Runtime-validate `mode` before resolving or performing the action, rejecting anything other than the two declared values. Prefer one decoder/guard for the complete action payload rather than relying on the TypeScript cast.
- status: accepted
- triage: |
  Confirmed. `WorktreeHost` forwards `msg.mode` unchecked and `createWorktreeActions.openFolder`
    treats every value except `"newWindow"` as `addToWorkspace`, so a malformed payload mutates the
    workspace instead of failing closed. Fixed with a runtime guard at the host boundary, where every
    other id in this change is already re-resolved rather than trusted.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.ts:235
- title: A live row-activation update can overtake init and be discarded
- evidence: Both providers set `_ready = true` before awaiting the retried `init` delivery. During a failed first init post and its retry delay, the new configuration listener can successfully post `worktreeRowActivation`; the webview drops it because `worktreeController` is not created until init. The later init payload may contain the value read before the change. The editor provider has the same ordering at `TerminalEditorProvider.ts:324` and `_ready` transition at `:837`.
- impact: A setting change during initialization can leave an already-open sidebar, panel, or editor using the old activation mode until another change or reload, contradicting the live-update requirement.
- suggestedFix: Gate configuration delivery on completed init rather than `_ready`, queue/replay changes during init, or post the current setting immediately after successful init delivery to reconcile any overtaking update.
- status: accepted
- triage: |
  Confirmed. `onReady` sets `_ready = true` before awaiting init delivery, and `main.ts`
    constructs the controller only when init arrives, so a configuration change landing in that window
    is posted, dropped, and then overwritten by the value init captured earlier. Fixed by re-sending
    the current activation immediately after init is delivered; the send is idempotent.

## Adjudication notes

- The chair and frontend reviewer corroborated both preview failure mechanisms. B1 covers a host-resolved entry being absent from the receiving surface's local list; B3 covers a row that never had preview identity. They are distinct causal mechanisms and remain separate findings.
- The contracts review's warning that external rows depend on an upstream override was rejected: `WorktreeView.activationFor` explicitly returns `preview` for external scope without consulting the setting, so the hard invariant is enforced at the row-to-action translation boundary.
- The contracts review's optional-interface suggestion was not retained: optional callbacks are the approved mechanism that makes unsupplied items absent, and the changed tests enumerate the expected menu inventory.
- Data/security and reuse specialists found no additional issues. The chair's W1 is retained because the approved RPC contract explicitly requires runtime host validation and the changed `mode` branch fails open to `addToWorkspace`.
- No audit-backlog or accepted-risk entries apply.
