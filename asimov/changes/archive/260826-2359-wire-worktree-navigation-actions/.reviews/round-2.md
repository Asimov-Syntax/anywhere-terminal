# Review Round 2

- Date: 2026-08-27
- Cycle: 1
- Round: 2
- Mode: verification
- Scope: working tree — accepted round-1 fixes plus behavioral impact cone
- Review base: tree `ddb272868b3a5ad37adadc35b75aa1ab2f1363af`
- Review head: tree `2940321dc8332df4b0cf95344a242e331308bd1a`
- Reviewable lines: 330
- Scope lock: passed — tasks 6_1, 6_2, and 6_3 are remediation for accepted B1/B2/B3/W1/W2; the newly reachable editor vault controls are reviewed as B1's impact cone, not separate feature scope
- Agents spawned:
  - asm-review-logic — accepted action invariants, preview async flow, pane activation, and init races — gpt-5.6-sol[1M]
  - asm-review-frontend — preview/list state, row capability truthfulness, pane visibility, and menu lifecycle — gpt-5.6-terra[1M]
  - asm-review-contracts — provider/serializer interfaces, response correlation, and accepted design contracts — sonnet[1M]
- Agents skipped:
  - asm-review-data-security — W1's exact host-boundary validation was in the logic/contracts cone and is verified fixed; no other identity, authorization, secret, or storage boundary changed
  - asm-review-performance — pending preview state is a single bounded slot, retries are bounded, and no collection/growth-axis issue was introduced
  - asm-review-reuse — the verification cone is three targeted provider/webview fixes; contracts reviewed the mirrored list/detail response contract and no additional shared owner is required to adjudicate the accepted findings
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 1 | SUGGEST 0
- Verification: chair-observed `pnpm run check-types`, 170 focused tests across 8 remediation suites, and the complete 203-file / 3908-test unit suite passed. `pnpm exec biome check src/` completed with the same 13 warnings in untouched baseline files and no fixes applied.

## Prior finding verification

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.ts:992
- title: Host-approved previews are dropped when the receiving surface lacks the vault entry
- evidence: Sidebar/panel misses now hold one host-resolved pending id, request the vault list, and open the preview when cache or fresh render contains it. Editor providers now receive the shared `VaultService` through cold create and serializer revive, answer `requestVaultSessions` with cache-then-fresh supersession, and answer correlated `requestVaultSessionDetail` reads. Focused tests cover immediate, pending, replacement, cold editor, revived editor, stale refresh, retry supersession, and detail response paths.
- impact: The worktree preview action itself no longer depends on a list that was already present and now completes on all three surface kinds.
- suggestedFix: None for B1. B4 records a separate impact-cone regression caused by using the full vault list as editor preview transport.
- status: fixed
- triage: Accepted in round 1; verified fixed at sidebar/panel cache hot/cold and editor cold/revived list/detail boundaries.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/activatePane.ts:43
- title: Valid panes in rootless split tabs still cannot be activated
- evidence: The accepted B2 state is unchanged behaviorally: closing the original root leaf deletes `terminals[tabId]` while valid remaining leaves stay in `tabLayouts[tabId]`. The extracted `activatePane` finds the requested remaining pane, then returns `false` exactly when `hasTerminal(tabId)` is false. The new regression test asserts this failure and no side effects. `main.ts` still cannot show the owning tab because `switchTab(tabId)` requires the missing root terminal. Boundary inventory: ordinary root/split tabs verified safe; unknown pane safe; rootless hidden tab still affected.
- impact: A current host presence row can name a live pane, the extension can reveal its correct VS Code surface, and the webview still leaves another tab visible. The remediation reports failure differently but does not satisfy the accepted invariant that the actual pane becomes visible and active.
- suggestedFix: Make tab display independent of `terminals[tabId]`: resolve a live leaf from the retained layout as the display/focus fallback, show the owning split container, update active tab/pane state, and assert successful activation in the rootless-tab regression test.
- status: persists from round 1
- triage: Accepted in round 1; task 6_1 did not remediate the invariant. The separate tab-bar defect may predate this change, but worktree focus reaching the same valid tab is B2's accepted scope.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeContextMenu.ts:94
- title: Sessionless agent rows expose preview actions that cannot dispatch
- evidence: Agent menu preview/resume/copy/cwd items are now all inside the `row.entryId` guard. A sessionless window row offers only its structurally present pane action, and `WorktreeView.activationFor` falls back to focus before consulting a preview setting it cannot perform. External production rows remain generated from registry sessions with an entry id and continue to preview regardless of setting.
- impact: Sessionless window rows no longer present or dispatch impossible preview/session actions.
- suggestedFix: None.
- status: fixed
- triage: Accepted in round 1; verified fixed at menu construction and click/keyboard activation boundaries.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:449
- title: Open-folder mode is not validated at the webview boundary
- evidence: `WorktreeHost.handleAction` now accepts only exact `newWindow` and `addToWorkspace` values before resolving the worktree path or invoking any capability. Missing, non-string, and unknown modes return without action; tests cover malformed values and prove no workspace mutation occurs.
- impact: Malformed webview payloads now fail closed.
- suggestedFix: None.
- status: fixed
- triage: Accepted in round 1; verified fixed at the host boundary before path resolution and capability dispatch.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.ts:1550
- title: Cold-created surfaces can still lose a row-activation update during init
- evidence: Reload and snapshot-restore branches now await init and then re-send the current activation. The cold-create branch in both providers still starts `safeSendWithRetry(init)` without awaiting it and immediately calls `postRowActivation` (`TerminalEditorProvider.ts:1053-1065` has the same ordering). If init attempt zero fails, the resend and a configuration update can be delivered during the retry sleep before `main.ts` constructs the controller; the later retried init installs its earlier captured value. Existing tests exercise only the branch with existing sessions, not a failed cold-init attempt.
- impact: A setting change during first initialization can still leave a newly opened sidebar, panel, or editor using a stale activation mode until another change or reload.
- suggestedFix: Await cold init delivery in both providers and re-send only after successful delivery, with a regression that fails attempt zero, changes configuration during the retry delay, and proves the final activation lands after init.
- status: persists from round 1
- triage: Accepted in round 1; task 6_1 closes four of six init branches but leaves both cold-create branches with the original race.

## Current findings

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalEditorProvider.ts:739
- title: Editor preview support exposes a vault list whose other controls are all inert
- evidence: B1's editor fix now answers `requestVaultSessions` with the full vault list, making VaultPanel rows reachable on editor surfaces for the first time. Those rows always install the existing resume button and context menu. They post `vaultResume`, `vaultRenameSession`, `vaultOpenSessionFile`, `vaultRevealInOS`, `vaultCopyFilePath`, `vaultCopyResumeCommand`, and `vaultOpenWorkingDir`; the editor provider's switch handles only the two new read messages and drops every one of those operations. Before 6_3 the editor never populated the list, so these controls were not reachable. Boundary inventory: worktree-triggered preview list load affected; manually expanded editor vault affected; row click preview safe; every listed row action above affected.
- impact: Fixing one offered editor action introduces a full session list with multiple controls that look live and silently do nothing, repeating the exact absent-not-inert failure this change is designed to prevent.
- suggestedFix: Do not use an unrestricted full-list surface as preview transport unless its unsupported row capabilities are hidden. Either add an editor capability mask so VaultPanel/VaultContextMenu omit unsupported controls, return only preview-specific entry data without populating the general list, or wire the exposed operations deliberately in their owning change.
- status: open
- triage: pending

## Adjudication notes

- B2 keeps its round-1 BLOCK severity: persistence alone does not change severity, and no evidence delta reduces its impact or reachability. The remediation's own test proves the same valid target still fails.
- W2 keeps its round-1 WARN severity. Specialist claims that all six branches established a happens-after relation were refuted by the two explicit fire-and-forget cold-init branches.
- The frontend report's empty-menu warning for a sessionless external row was dropped: production external rows are constructed from registry sessions with an `entryId`; the no-entry external fixture is not reachable through the current projector.
- The 6_3 equivalent-mutant claim is correct: after refresh resolves, the explicit token early return and `safeSendWithRetry`'s identical abort predicate checked before attempt zero have the same observable postMessage behavior; the latter remains necessary across retry sleeps.
- The 4_1 mousedown-listener mutant is not strictly equivalent over a webview lifetime: leaked listener closures and per-event work accumulate with menu-open count even though each handler's visible close behavior becomes redundant. Production removes the listener correctly, so this is not a code finding; the mutant should be classified/suppressed as a resource-lifetime survivor rather than justified as unobservable.
- No audit-backlog or accepted-risk entries apply.

---

## Triage (author, round 2)

### [B2] Valid panes in rootless split tabs still cannot be activated
- **Status**: accepted
- **Triage**: Sustained against my own round-1 reasoning. I verified the state is reachable:
  `SplitTreeRenderer.closeSplitPaneById` (src/webview/split/SplitTreeRenderer.ts:283-343) removes the
  closed leaf, keeps the tab under the same id with its remaining live leaves, and deletes
  `store.terminals[paneSessionId]` — so closing the ROOT pane leaves `tabLayouts[tabId]` populated
  while `terminals[tabId]` is gone. `switchTab` (main.ts:405-409) early-returns on exactly that.
  My round-1 fix reported the failure honestly but left the accepted D4 outcome ("activating a row
  brings its pane forward") unreachable for those tabs, and I recorded the cause as an out-of-scope
  pre-existing defect. The chair is right that the accepted invariant is the activation, not the
  honest false: a requirement cannot be satisfied by reporting that it was not. Fixing the display
  path is an implementation change inside the accepted contract — no artifact moves.

### [B4] Editor preview support exposes a Vault list whose other controls are inert
- **Status**: accepted
- **Triage**: A genuine regression introduced by task 6_3, and my 6_3 scope-boundary note was wrong
  in the way that matters. I wrote that the vault panel's mutating and launch items "were unwired
  before this change" — true, but they were also UNREACHABLE, because nothing answered
  `requestVaultSessions` on an editor surface and the list rendered empty. Verified both providers
  build the same DOM via `getTerminalHtml` (webviewHtml.ts:703 always emits `#vault-panel`), and
  `main.ts:1005-1019` constructs a full `VaultPanel` whenever that element exists. Populating the
  list therefore makes 13 inert items reachable where 0 were before. That is precisely the
  absent-not-disabled defect this change's own accepted requirement forbids, so it is in-contract
  to fix rather than a new decision.
- **Fix chosen**: the chair's option (a), a surface capability mask. It reuses the pattern tasks 5_2
  and 6_1 already established for the worktree menu (every capability optional, items built through
  the `item()` helper, absent capability => absent item) rather than inventing a second answer.
  Rejected (c) wire-the-capabilities: resume and launch belong to WT-005.3, so it would pull that
  task's scope forward. Rejected (b) preview-specific entry data: it needs a new message shape for
  the entry the overlay header renders, which is a design change and would mean a handback.

### [W2] Cold-created surfaces can still lose row-activation updates during init
- **Status**: accepted
- **Triage**: Verified at TerminalViewProvider.ts:1549-1562 and TerminalEditorProvider.ts:1053 —
  both cold-create branches `void safeSendWithRetry(init)` and then call `postRowActivation`
  immediately, while the reload and snapshot-restore branches await `initDelivered` first. The
  practical exposure is narrower than the other four branches (the cold init carries
  `worktreeRowActivation` inline, read at send time, so a dropped activation post is usually
  re-supplied by init itself) — but the inconsistency is real, the ordering guarantee is the one W2
  asked for, and awaiting delivery costs nothing here. Accepted rather than rebutted: arguing the
  race is benign is weaker than removing it.

### Mutant adjudication — noted
- 6_3 token check accepted as equivalent, as declared.
- 4_1 mousedown listener: the chair's refinement is accepted. It is not strictly equivalent —
  leaked closures accumulate per menu opening — but dismissal behaviour is unchanged and production
  teardown is correct. Recorded as accumulation, not as a behavioural equivalent mutant.
