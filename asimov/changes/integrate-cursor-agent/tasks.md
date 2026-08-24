## 1. Cursor Vault Provider

- [x] 1_1 Add Cursor provider identity and executable resolution — verified: pnpm vitest run src/cursor/CursorExecutableResolver.test.ts src/vault/registry.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/agent-vault-registry/spec.md#{data-driven-agent-definitions, built-in-agent-records, registry-driven-launch-extension}; specs/vault-session-launch/spec.md#resolve-cursor-executable; design.md D2
  - **Acceptance**:
    - Outcome: Cursor provider metadata and executable candidates are available to generic launch code.
    - Verify: command pnpm vitest run src/cursor/CursorExecutableResolver.test.ts src/vault/registry.test.ts
  - **Plan**:
    1. Extend `src/vault/types.ts`, `src/vault/registry.ts`, and `src/webview/vault/agentIcons.ts` with Cursor identity, executable candidates, interactive capability metadata, presentation identity, and continuation permission choices.
    2. Add collision-safe candidate probing in `src/cursor/CursorExecutableResolver.ts` with positional-prompt, resume, plan-mode, force, alias, and fallback coverage in `src/cursor/CursorExecutableResolver.test.ts` and `src/vault/registry.test.ts`.
    3. Add compile-safe placeholder Cursor readers in `src/vault/readers/cursorReader.ts`, register them in `src/vault/VaultService.ts`, and extend `src/vault/VaultService.test.ts` and `src/vault/VaultService.detail.test.ts`; task 1_3 replaces the placeholders with bounded metadata behavior.

- [x] 1_2 Add Cursor continuation and selected-resume gate — verified: pnpm vitest run src/vault/LaunchBuilder.test.ts src/vault/VaultLauncher.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/agent-vault-registry/spec.md#{resume-and-fork-command-templates, claude-launch-templates, codex-launch-templates, opencode-launch-templates, cursor-launch-template}; specs/vault-session-launch/spec.md#{cursor-selected-resume-compatibility, continue-into-cursor-session, cursor-continuation-permission-posture}; design.md D4
  - **Acceptance**:
    - Outcome: Cursor continuation launches from the Vault.
    - Verify: command pnpm vitest run src/vault/LaunchBuilder.test.ts src/vault/VaultLauncher.test.ts
  - **Plan**:
    1. Add `canResume` to `src/vault/types.ts`; adapt `src/vault/LaunchBuilder.ts` and `src/vault/VaultLauncher.ts` to enforce it before selected Resume.
    2. Preserve direct argv continuation with the resolved executable and the chosen permission posture in `src/vault/LaunchBuilder.ts`.
    3. Extend `src/vault/LaunchBuilder.test.ts` and `src/vault/VaultLauncher.test.ts` for capability-gated Resume, positional continuation, dangerous posture visibility, missing executable, and unsupported fork.

- [x] 1_3 Implement bounded Cursor metadata readers — verified: bun test 'src/vault/readers/cursorReader.test.ts' && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/agent-session-index/spec.md#{discover-cursor-agent-cli-chats, cursor-metadata-compatibility-profile, cursor-cli-chat-eligibility, safe-cursor-session-lookup, cursor-indexing-is-metadata-only}; specs/vault-session-preview/spec.md#cursor-transcript-capability-fallback; design.md D3; design.md D10
  - **Acceptance**:
    - Outcome: Eligible schema-1 Cursor chats appear once in the Vault metadata index.
    - Verify: unit src/vault/readers/cursorReader.test.ts
  - **Plan**:
    1. Add the Cursor-specific serializable cache variant to `src/vault/cacheTypes.ts`.
    2. Add contained root resolution and duplicate-id grouping in `src/vault/readers/cursorPaths.ts`.
    3. Add bounded list, point lookup, partial detail, unavailable raw-record behavior, and explicit `canResume` capability in `src/vault/readers/cursorReader.ts`.
    4. Cover exact bounds, absolute cwd, timestamps, metadata stamp, database presence, ambiguity, traversal, and forbidden blob access in `src/vault/readers/cursorReader.test.ts`.

- [x] 1_4 Register Cursor readers and filtered watch events — verified: pnpm vitest run src/vault/VaultService.test.ts src/vault/VaultService.watchTargets.test.ts src/providers/VaultWatchCoordinator.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/agent-session-index/spec.md#{discover-cursor-agent-cli-chats, safe-cursor-session-lookup}; specs/vault-session-preview/spec.md#cursor-transcript-capability-fallback; design.md D3
  - **Acceptance**:
    - Outcome: Cursor cache refresh ignores active database content writes.
    - Verify: command pnpm vitest run src/vault/VaultService.test.ts src/vault/VaultService.watchTargets.test.ts src/providers/VaultWatchCoordinator.test.ts
  - **Plan**:
    1. Register Cursor list, detail, entry, and record readers in `src/vault/VaultService.ts` without restructuring the facade.
    2. Extend `src/vault/VaultService.ts` and `src/providers/VaultWatchCoordinator.ts` with per-target event filters: all metadata events and database create or delete only.
    3. Extend `src/vault/VaultService.test.ts`, `src/vault/VaultService.watchTargets.test.ts`, and `src/providers/VaultWatchCoordinator.test.ts` for provider isolation, cached fallback, partial detail, and filtered file lifecycle refresh.

- [x] 1_5 Render Cursor Vault identity and capability-gated actions — verified: pnpm vitest run src/webview/vault/VaultPanel.test.ts src/webview/vault/grouping.test.ts && pnpm vitest run src/webview/vault/vaultRenderSignature.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 1_2, 1_4
  - **Refs**: specs/agent-session-index/spec.md#cursor-cli-chat-eligibility; specs/vault-session-launch/spec.md#cursor-selected-resume-compatibility; specs/vault-session-preview/spec.md#cursor-transcript-capability-fallback; design.md D1; design.md D3; design.md D4
  - **Acceptance**:
    - Outcome: Cursor rows render limited detail and hide unsupported actions.
    - Verify: command pnpm vitest run src/webview/vault/VaultPanel.test.ts src/webview/vault/grouping.test.ts
  - **Plan**:
    1. Add Cursor badge, row, and preview styles in `src/webview/vault/vaultPanel.css`.
    2. Update `src/webview/vault/VaultPanel.ts`, `src/webview/vault/vaultListView.ts`, `src/webview/vault/PreviewController.ts`, and `src/webview/vault/VaultContextMenu.ts` to honor `canResume`, include Cursor provider copy, and render the limited-detail presentation across list, preview, and context-menu actions.
    3. Include `canResume` in `src/webview/vault/vaultRenderSignature.ts`; extend `src/webview/vault/VaultPanel.test.ts`, `src/webview/vault/grouping.test.ts`, and `src/webview/vault/vaultRenderSignature.test.ts` for grouping, hidden Resume and copied-resume-command actions, capability-flip rerendering, Continue, local rename overlay, and absent transcript controls.

## 2. Cursor Hook Observation

- [x] 2_1 Implement coordinated Cursor hook configuration — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-hook-opt-in-setting, cursor-hook-configuration-ownership, cursor-hook-writer-coordination, cursor-observers-fail-open}; design.md D5
  - **Acceptance**:
    - Outcome: Hook setup coordinates AT writers and preserves user configuration.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Add machine-global wrapper ownership, bounded advisory locking, compare-retry, exact removal, and atomic replacement in `src/cursor/CursorHookInstaller.ts`.
    2. Add POSIX and Windows no-op wrapper generation; gate Windows installation on successful empty-JSON execution.
    3. Cover unrelated entries, future and malformed schemas, concurrent changes, stale locks, permissions, cleanup failure, and fail-open timeouts in `src/cursor/CursorHookInstaller.test.ts`.
    4. Add the default-false machine-scoped `anywhereTerminal.cursorAgent.hooks.enabled` setting to `package.json`.

- [x] 2_2 Implement the exact authenticated hook state machine — verified: bun test 'src/cursor/CursorHookRuntime.test.ts' && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-observers-fail-open, hook-session-isolation, cursor-hook-payload-privacy}; design.md D6; design.md D7; design.md D10
  - **Acceptance**:
    - Outcome: Authenticated Cursor events follow the specified state table and bounds.
    - Verify: unit src/cursor/CursorHookRuntime.test.ts
  - **Plan**:
    1. Add loopback POST-only binding, renewable per-session registration, 1 MiB body cap, request deadline, and immediate disable clearing in `src/cursor/CursorHookRuntime.ts`.
    2. Implement the D7 event table, digest LRU, quiet completion, freshness expiry, unknown-event ignore, and reason-code-only diagnostics.
    3. Cover every installed event, malformed bodies, stale tokens, cross-pane attempts, duplicate events, late activity, expiry, disable, and forbidden payload fields in `src/cursor/CursorHookRuntime.test.ts`.

- [x] 2_3 Wire renewable hook authority through terminal lifecycle — verified: pnpm vitest run src/session/SessionManager.cursorHooks.test.ts src/webview/messaging/MessageRouter.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-semantic-terminal-status, cursor-status-pane-isolation, hook-session-isolation}; design.md D6; design.md D7
  - **Acceptance**:
    - Outcome: Every live PTY incarnation owns fresh hook authority.
    - Verify: command pnpm vitest run src/session/SessionManager.cursorHooks.test.ts src/webview/messaging/MessageRouter.test.ts
  - **Plan**:
    1. Add the session environment contributor to `src/session/SessionManager.ts`, renewing it for fallback shells and releasing it on failed spawn, exit, destroy, and disposal.
    2. Compose runtime enablement, installer reconciliation, immediate clearing, and disposal in `src/extension.ts` while posting status only through the matching live session.
    3. Add `agentActivityStatus` to `src/types/messages.ts` and `src/webview/messaging/MessageRouter.ts` with routing coverage in `src/webview/messaging/MessageRouter.test.ts`.
    4. Cover initial spawn, fallback renewal, failed spawn, restore, toggle, destroy, and manager disposal in `src/session/SessionManager.cursorHooks.test.ts`.

- [x] 2_4 Merge semantic and PTY-output activity — verified: bun test 'src/webview/terminal/TerminalActivityTracker.test.ts' && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-semantic-terminal-status, cursor-status-evidence-precedence, cursor-status-pane-isolation}; design.md D7
  - **Acceptance**:
    - Outcome: Cursor tab status follows the highest-priority current evidence.
    - Verify: unit src/webview/terminal/TerminalActivityTracker.test.ts
  - **Plan**:
    1. Extend `src/webview/terminal/TerminalActivityTracker.ts` with semantic working and waiting inputs while retaining output fallback.
    2. Update `src/webview/state/WebviewStateStore.ts`, `src/webview/TabBarUtils.ts`, and `src/webview/main.ts` to consume semantic updates, carry the waiting-capable status type, and clear state on exit, identity loss, and disable.
    3. Extend `src/webview/terminal/TerminalActivityTracker.test.ts` for precedence, expiry, immediate clear, output fallback, pane identity, and disposal.

- [x] 2_5 Add live identity-gated approval status — verified: pnpm vitest run src/webview/terminal/CursorApprovalDetector.test.ts src/webview/TabBar.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 2_4
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-status-evidence-precedence, current-screen-approval-evidence}; design.md D8
  - **Acceptance**:
    - Outcome: Live Cursor approval dialogs show action-required status.
    - Verify: command pnpm vitest run src/webview/terminal/CursorApprovalDetector.test.ts src/webview/TabBar.test.ts
  - **Plan**:
    1. Add current-bottom structural classification in `src/webview/terminal/CursorApprovalDetector.ts` with identity, resize, and scrollback fixtures in `src/webview/terminal/CursorApprovalDetector.test.ts`.
    2. Invoke classification only from completed live writes in `src/webview/main.ts`; never invoke it from restored serialized content. Update `src/session/SessionManager.ts` to emit explicit pane identity-clear status whenever Cursor hook authority is released.
    3. Add waiting aggregation and visual status in `src/webview/TabBarUtils.ts` and `src/providers/webviewHtml.ts`, with split, queued-write, exit, identity-loss, hook-release, and false-positive coverage in `src/webview/TabBar.test.ts` and `src/session/SessionManager.cursorHooks.test.ts`.

- [x] 2_6 Smoke real Cursor hook and fallback behavior — verified: manual — Launched the installed authenticated agent CLI in an isolated Cursor Extension Development Host running AnyWhere Terminal; observed idle → running → waiting with the live wrapped git-status approval menu and pane-specific validated identity, approved once, then observed running → idle. Disabled hooks, verified all managed entries were removed while existing Orca hooks remained unchanged, verified webview Cursor identity cleared, and observed PTY-output fallback idle → running → idle.
  - **Deps**: 2_5, 2_7
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-hook-opt-in-setting, cursor-semantic-terminal-status, current-screen-approval-evidence, hook-session-isolation}; design.md D5; design.md D6; design.md D7; design.md D8
  - **Acceptance**:
    - Outcome: A real Cursor session reports isolated working, waiting, and idle states.
    - Verify: manual enable hooks, run interactive Cursor in AT, exercise prompt and approval, disable hooks, and confirm output fallback

- [x] 2_7 Preserve approval detection across narrow terminal wrapping — verified: pnpm vitest run src/webview/terminal/CursorApprovalDetector.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 2_5
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-status-evidence-precedence, current-screen-approval-evidence}; design.md D8
  - **Acceptance**:
    - Outcome: A live Cursor approval menu remains action-required when its choice rows wrap in a narrow pane.
    - Verify: command pnpm vitest run src/webview/terminal/CursorApprovalDetector.test.ts
  - **Plan**:
    1. Update `src/webview/terminal/CursorApprovalDetector.ts` to select the last eight content rows after trailing blank screen rows and reassemble xterm-wrapped choice rows.
    2. Add the observed narrow Cursor approval fixture to `src/webview/terminal/CursorApprovalDetector.test.ts`, retaining scrollback, prose, and bottom-row guards.

## 3. User Guidance

- [x] 3_1 Document Cursor setup and supported capabilities — verified: manual — README documents Cursor official installation, ordered agent/cursor-agent resolution, metadata-only Vault indexing, Continue versus selected-Resume/fork/ACP limitations, machine-scoped hook opt-in, privacy, fail-open fallback, and troubleshooting. CHANGELOG adds the user-visible Cursor Vault and status integration with explicit deferred transcript, Resume, fork, IDE-bridge, and ACP capabilities.
  - **Deps**: 1_5, 2_6
  - **Refs**: specs/vault-session-launch/spec.md#{resolve-cursor-executable, cursor-selected-resume-compatibility, continue-into-cursor-session}; specs/vault-session-preview/spec.md#cursor-transcript-capability-fallback; specs/cursor-agent-status/spec.md#{cursor-hook-opt-in-setting, cursor-observers-fail-open}; design.md D1; design.md D5
  - **Acceptance**:
    - Outcome: Cursor integration limits and setup are documented.
    - Verify: manual README and changelog cover aliases, metadata Vault, Resume gating, hook opt-in, privacy, fallbacks, and deferred capabilities
  - **Plan**:
    1. Update `./README.md` with official CLI installation links, executable resolution, metadata Vault behavior, selected-Resume gating, hook opt-in, privacy, and troubleshooting.
    2. Update `./CHANGELOG.md` with the user-visible integration and explicit transcript, fork, and ACP limitations.

## 4. Verification Cleanup

- [x] 4_1 Conform Cursor integration changes to Biome check mode — verified: pnpm exec biome check src/ && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D2; design.md D5; design.md D6; design.md D8
  - **Acceptance**:
    - Outcome: Cursor integration files pass the repository's non-writing Biome check.
    - Verify: command pnpm exec biome check src/
  - **Plan**:
    1. Manually apply the reported formatting, import ordering, unused-type, callback-return, and optional-chain corrections in `src/cursor/CursorHookInstaller.ts`, `src/cursor/CursorHookInstaller.test.ts`, `src/cursor/CursorHookRuntime.ts`, `src/cursor/CursorHookRuntime.test.ts`, and `src/extension.ts` without running an auto-fix command.
    2. Manually format the changed assertions and launch/session wiring in `src/providers/VaultWatchCoordinator.test.ts`, `src/session/SessionManager.ts`, `src/session/SessionManager.cursorHooks.test.ts`, `src/vault/LaunchBuilder.ts`, `src/vault/LaunchBuilder.test.ts`, `src/vault/VaultLauncher.ts`, `src/vault/VaultLauncher.test.ts`, and `src/vault/registry.ts`.
    3. Manually format the changed webview files in `src/webview/TabBar.test.ts`, `src/webview/main.ts`, `src/webview/terminal/CursorApprovalDetector.ts`, `src/webview/terminal/CursorApprovalDetector.test.ts`, and `src/webview/vault/VaultPanel.test.ts`.

## 5. Review Round 1 Fixes

- [x] 5_1 Make Cursor watcher refresh path-targeted and count rejected ids — verified: pnpm vitest run src/providers/fsWatcherPool.test.ts src/providers/VaultWatchCoordinator.test.ts src/vault/VaultService.test.ts src/vault/readers/cursorReader.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-1.md B1; .reviews/round-1.md W3; specs/agent-session-index/spec.md#{safe-cursor-session-lookup, cursor-indexing-is-metadata-only}; design.md D3
  - **Acceptance**:
    - Outcome: Watcher-driven Cursor metadata updates touch only affected chat ids while full/manual refresh remains complete, and unsafe ids contribute to unreadable counts without path access.
    - Verify: command pnpm vitest run src/providers/fsWatcherPool.test.ts src/providers/VaultWatchCoordinator.test.ts src/vault/VaultService.test.ts src/vault/readers/cursorReader.test.ts
  - **Plan**:
    1. Propagate event URIs and agent identity through `src/providers/fsWatcherPool.ts`, `src/providers/VaultWatchCoordinator.ts`, and `src/providers/TerminalViewProvider.ts`, with focused coverage in `src/providers/fsWatcherPool.test.ts` and `src/providers/VaultWatchCoordinator.test.ts`.
    2. Add optional refresh hints to `src/vault/cacheTypes.ts` and `src/vault/VaultService.ts`, retaining full reads when no hint is supplied and covering targeted reader dispatch and target identity in `src/vault/VaultService.test.ts` and `src/vault/VaultService.watchTargets.test.ts`.
    3. Add containment-checked changed-path resolution and rejected-id accounting in `src/vault/readers/cursorPaths.ts` and `src/vault/readers/cursorReader.ts`; extend `src/vault/readers/cursorReader.test.ts` for create/change/delete, duplicate transitions, no unrelated stat/open calls, and unsafe unreadable counts.

- [x] 5_2 Fix Windows hook replacement and bound the no-op probe — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-1.md B2; .reviews/round-1.md S4; specs/cursor-agent-status/spec.md#{cursor-hook-writer-coordination, cursor-observers-fail-open}; design.md D5
  - **Acceptance**:
    - Outcome: Windows-shaped hook paths use a valid sibling temp file and a hung native probe fails within a fixed deadline without wedging reconciliation.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Use path-flavor-aware sibling temp construction and bounded child termination in `src/cursor/CursorHookInstaller.ts`.
    2. Add Windows drive-path and hung-probe fixtures in `src/cursor/CursorHookInstaller.test.ts` while retaining user-config preservation and wrapper no-op coverage.

- [x] 5_3 Gate hook authority on successful serialized reconciliation — verified: pnpm vitest run src/cursor/CursorHookController.test.ts src/session/SessionManager.cursorHooks.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-1.md B3; .reviews/round-1.md W1; specs/cursor-agent-status/spec.md#{cursor-hook-opt-in-setting, cursor-hook-configuration-ownership, cursor-observers-fail-open, hook-session-isolation}; design.md D5; design.md D6
  - **Acceptance**:
    - Outcome: Runtime/contributor authority matches the latest setting only after successful supported-schema reconciliation, including toggles during async activation.
    - Verify: command pnpm vitest run src/cursor/CursorHookController.test.ts src/session/SessionManager.cursorHooks.test.ts
  - **Plan**:
    1. Add a small serialized lifecycle owner in `src/cursor/CursorHookController.ts` and `src/cursor/CursorHookController.test.ts` that installs before enable/attach, disables/detaches on every failed or unsupported result, re-reads the latest desired state, and ignores stale transitions.
    2. Replace the independent installer/runtime wiring in `src/extension.ts` with the controller while preserving fail-open activation and detach-before-dispose ordering.

- [x] 5_4 Harden Cursor executable identity and positional-prompt probing — verified: pnpm vitest run src/cursor/CursorExecutableResolver.test.ts src/vault/registry.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-1.md W2; specs/vault-session-launch/spec.md#resolve-cursor-executable; design.md D2
  - **Acceptance**:
    - Outcome: Only Cursor-identifying help with a positional prompt operand and required flags resolves as the Cursor Agent executable.
    - Verify: command pnpm vitest run src/cursor/CursorExecutableResolver.test.ts src/vault/registry.test.ts
  - **Plan**:
    1. Add structural Cursor usage validation in `src/cursor/CursorExecutableResolver.ts` without version ordering assumptions.
    2. Add official-shape positives and unrelated/`--prompt`-only collision negatives in `src/cursor/CursorExecutableResolver.test.ts` and `src/vault/registry.test.ts`.

## 6. Review Round 2 Fixes

- [x] 6_1 Persist and reload Cursor reader caches — verified: pnpm vitest run src/vault/VaultCacheStore.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: .reviews/round-2.md B4; design.md D3
  - **Acceptance**:
    - Outcome: Valid Cursor reader caches survive reload; malformed Cursor cache state is rejected.
    - Verify: command pnpm vitest run src/vault/VaultCacheStore.test.ts
  - **Plan**:
    1. Extend strict reader-cache validation in `src/vault/VaultCacheStore.ts` for Cursor chat stamps, entries, unreadable-by-id counts, and rejected count.
    2. Add valid round-trip and malformed-shape fixtures in `src/vault/VaultCacheStore.test.ts`.

- [x] 6_2 Reuse correct POSIX argument quoting for Cursor hooks — verified: pnpm vitest run src/cursor/CursorHookInstaller.test.ts src/pty/ShellIntegrationInjector.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 5_2
  - **Refs**: .reviews/round-2.md W4; specs/cursor-agent-status/spec.md#cursor-hook-configuration-ownership; design.md D5
  - **Acceptance**:
    - Outcome: Cursor wrapper commands remain valid when their path contains apostrophes.
    - Verify: command pnpm vitest run src/cursor/CursorHookInstaller.test.ts src/pty/ShellIntegrationInjector.test.ts
  - **Plan**:
    1. Extract the proven POSIX single-argument quoting helper into `src/utils/posixShellQuote.ts` and use it from `src/pty/ShellIntegrationInjector.ts` and `src/cursor/CursorHookInstaller.ts`.
    2. Add an exact emitted-command `/bin/sh -n` regression in `src/cursor/CursorHookInstaller.test.ts` and retain injector coverage in `src/pty/ShellIntegrationInjector.test.ts`.

- [x] 6_3 Make hinted Vault refresh targeted and coalesced — verified: pnpm vitest run src/vault/VaultService.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: .reviews/round-2.md B1; .reviews/round-2.md W7; .reviews/round-2.md W8; design.md D3
  - **Acceptance**:
    - Outcome: Hinted refreshes target one reader, coalesce paths, and cannot satisfy complete refreshes.
    - Verify: command pnpm vitest run src/vault/VaultService.test.ts
  - **Plan**:
    1. Update `src/vault/VaultService.ts` to replace only the hinted agent segment while carrying other cached entries and reader caches forward.
    2. Coalesce same-agent pending paths behind one active hinted run and serialize complete and forced refreshes after hinted work.
    3. Extend `src/vault/VaultService.test.ts` for target-only dispatch, cache segment preservation, hint coalescing, and full-after-hinted ordering.

- [x] 6_4 Bound targeted Cursor watcher work and preserve exact unreadable state — verified: pnpm vitest run src/providers/VaultWatchCoordinator.test.ts src/vault/readers/cursorReader.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: .reviews/round-2.md W3; .reviews/round-2.md W5; .reviews/round-2.md W6; specs/agent-session-index/spec.md#{safe-cursor-session-lookup, cursor-indexing-is-metadata-only}; design.md D3
  - **Acceptance**:
    - Outcome: Unsafe events recount exactly; oversized batches fall back; targeted reads avoid redundant sorting.
    - Verify: command pnpm vitest run src/providers/VaultWatchCoordinator.test.ts src/vault/readers/cursorReader.test.ts
  - **Plan**:
    1. Cap pending targeted paths in `src/providers/VaultWatchCoordinator.ts` and cover full-refresh fallback in `src/providers/VaultWatchCoordinator.test.ts`.
    2. Signal unsafe changed paths from `src/vault/readers/cursorPaths.ts` so `src/vault/readers/cursorReader.ts` performs a complete safe recount instead of approximate rejected totals.
    3. Remove redundant Cursor-reader sorting while preserving VaultService-owned final ordering; cover unsafe creation and deletion transitions plus targeted metadata-only file access in `src/vault/readers/cursorReader.test.ts`.

## 7. Final Review-Round Fixes

- [x] 7_1 Close targeted Vault refresh state-machine gaps — verified: pnpm vitest run src/vault/VaultService.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 6_3
  - **Refs**: .reviews/round-3.md B1; .reviews/round-3.md B5; .reviews/round-3.md W10; .reviews/round-3.md W11; .reviews/round-3.md W12; design.md D3
  - **Acceptance**:
    - Outcome: Cold hints promote to complete; queued work is bounded, deduplicated, ordered, and force-safe.
    - Verify: command pnpm vitest run src/vault/VaultService.test.ts
  - **Plan**:
    1. Promote hinted refreshes to complete reads when no complete in-memory or persisted baseline exists in `src/vault/VaultService.ts`.
    2. Cap service-level pending paths, suppress exact duplicate active hints, retain hints arriving during complete work, and establish a force scheduling barrier.
    3. Extend `src/vault/VaultService.test.ts` with cold-hint, overflow, duplicate-client, complete-race, and sustained-force fixtures.

- [x] 7_2 Resolve targeted chats from persisted bucket locations — verified: pnpm vitest run src/vault/readers/cursorReader.test.ts src/vault/VaultCacheStore.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 6_1, 6_4
  - **Refs**: .reviews/round-3.md B6; .reviews/round-3.md W9; specs/agent-session-index/spec.md#{safe-cursor-session-lookup, cursor-indexing-is-metadata-only}; design.md D3
  - **Acceptance**:
    - Outcome: Targeted chat refreshes use persisted locations without scanning all buckets; malformed capabilities are rejected.
    - Verify: command pnpm vitest run src/vault/readers/cursorReader.test.ts src/vault/VaultCacheStore.test.ts
  - **Plan**:
    1. Add bounded safe bucket-location state to `src/vault/cacheTypes.ts`, populate it during complete scans in `src/vault/readers/cursorPaths.ts` and `src/vault/readers/cursorReader.ts`, and resolve watcher paths directly from their validated bucket.
    2. Preserve duplicate-id omission and exact transitions without all-bucket probing; retain full-scan fallback only for unsafe, malformed, or overflow state.
    3. Extend strict validation in `src/vault/VaultCacheStore.ts` to cover location state and boolean-or-absent `canResume`; add reader and cache regression fixtures in `src/vault/readers/cursorReader.test.ts` and `src/vault/VaultCacheStore.test.ts`.

- [x] 7_3 Bound watcher debounce latency — verified: pnpm vitest run src/providers/VaultWatchCoordinator.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 6_4
  - **Refs**: .reviews/round-3.md S6; design.md D3
  - **Acceptance**:
    - Outcome: Continuous watcher events flush within a fixed maximum delay.
    - Verify: command pnpm vitest run src/providers/VaultWatchCoordinator.test.ts
  - **Plan**:
    1. Add a maximum-wait timer beside the trailing debounce in `src/providers/VaultWatchCoordinator.ts`, sharing one idempotent flush path.
    2. Extend `src/providers/VaultWatchCoordinator.test.ts` for continuous targeted and full-fallback streams plus disposal cleanup.

- [x] 7_4 Reuse canonical quoting in Vault command copy — verified: pnpm vitest run src/vault/LaunchBuilder.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 6_2
  - **Refs**: .reviews/round-3.md S5
  - **Acceptance**:
    - Outcome: Complex Vault command arguments use the canonical POSIX quoting helper.
    - Verify: command pnpm vitest run src/vault/LaunchBuilder.test.ts
  - **Plan**:
    1. Keep the simple-token fast path in `src/vault/LaunchBuilder.ts` and delegate complex arguments to `src/utils/posixShellQuote.ts`.
    2. Extend `src/vault/LaunchBuilder.test.ts` with canonical apostrophe quoting coverage.

## 8. Cursor Resume Activation

- [x] 8_1 Resume compatible Cursor chats when their row is activated — verified: pnpm vitest run src/cursor/CursorExecutableResolver.test.ts src/vault/readers/cursorReader.test.ts src/webview/vault/VaultPanel.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 7_1, 7_2, 7_3, 7_4
  - **Refs**: specs/vault-session-launch/spec.md#{resolve-cursor-executable, cursor-selected-resume-compatibility}; design.md D4; user feedback 2026-08-24
  - **Acceptance**:
    - Outcome: Clicking an eligible Cursor row starts its detected CLI with `--resume <chat-id>`.
    - Verify: command pnpm vitest run src/cursor/CursorExecutableResolver.test.ts src/vault/readers/cursorReader.test.ts src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. Update `src/cursor/CursorExecutableResolver.ts` and `src/cursor/CursorExecutableResolver.test.ts` to accept the installed official help shape: `Start the Cursor Agent`, positional `[prompt...]`, `--resume [chatId]`, plan mode, and force, while retaining collision negatives.
    2. Emit `canResume: true` for compatible schema-1 entries in `src/vault/readers/cursorReader.ts`, bump the derived-entry cache version in `src/vault/cacheTypes.ts`, and update `src/vault/readers/cursorReader.test.ts`.
    3. Route activation of a resumable Cursor entry directly to `vaultResume` in `src/webview/vault/VaultPanel.ts`; preserve metadata-preview Continue as the explicit non-resumable fallback and update `src/webview/vault/VaultPanel.test.ts` and `src/vault/VaultLauncher.test.ts` for the resolved `--resume <chat-id>` argv.
    4. Update `README.md`, `CHANGELOG.md`, `asimov/changes/integrate-cursor-agent/specs/vault-session-launch/spec.md`, and `asimov/changes/integrate-cursor-agent/design.md` to describe direct Cursor Resume and the remaining metadata-only transcript boundary.

## 9. Cursor Transcript Preview Replan

- [x] 9_1 Restore preview-first Cursor activation — verified: pnpm vitest run src/webview/vault/VaultPanel.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 8_1
  - **Refs**: specs/vault-session-preview/spec.md#{cursor-row-activation-opens-preview, cursor-transcript-capability-fallback}; specs/vault-session-launch/spec.md#cursor-selected-resume-compatibility; design.md D3; design.md D4
  - **Acceptance**:
    - Outcome: Cursor row click, Enter, and Space open preview; explicit Resume remains separate.
    - Verify: command pnpm vitest run src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. Remove the Cursor direct-Resume activation override in `src/webview/vault/VaultPanel.ts` and restore the provider-neutral row callback.
    2. Add the timeline-versus-metadata detail discriminator in `src/vault/types.ts` and make `src/webview/vault/PreviewController.ts` render from detail capability rather than provider identity.
    3. Replace the regression expectation and cover click, Enter, Space, explicit Resume, and limited fallback in `src/webview/vault/VaultPanel.test.ts`.

- [x] 9_2 Decode bounded Cursor Agent CLI detail — verified: pnpm vitest run src/vault/readers/cursorStore.test.ts src/vault/readers/cursorReader.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 9_1
  - **Refs**: specs/vault-session-preview/spec.md#{cursor-agent-cli-transcript-preview, cursor-transcript-capability-fallback, cursor-transcript-privacy}; specs/agent-session-index/spec.md#{cursor-cli-chat-eligibility, cursor-indexing-is-metadata-only}; design.md D11; docs/research/20260823-cursor-agent-cli-integration.md#transcript-preview-follow-up-2026-08-24
  - **Acceptance**:
    - Outcome: Compatible CLI stores render ordered current and archived transcript records; incompatible stores remain limited.
    - Verify: command pnpm vitest run src/vault/readers/cursorStore.test.ts src/vault/readers/cursorReader.test.ts
  - **Plan**:
    1. Add a strict protobuf wire and root graph decoder in `src/vault/readers/cursorStore.ts` using the existing WAL-aware `src/vault/sqlite.ts` substrate, one consistent bounded query, identity and hash verification, 5 MiB per-blob limits, and total output bounds.
    2. Normalize recognized message, content, and tool blocks into existing timeline helpers in `src/vault/readers/cursorReader.ts`; return sanitized source records only and keep encryption keys, raw blobs, protobuf envelopes, and parser excerpts out of errors, logs, cache, and IPC.
    3. Add synthetic fixtures in `src/vault/readers/cursorStore.test.ts` and `src/vault/readers/cursorReader.test.ts` for WAL-only rows, archive ordering, missing roots, hash mismatch, unknown wire fields, oversized blobs, system and summary filtering, and privacy-safe failures.

- [x] 9_3 Add project transcript parsing and CLI mirror reconciliation — verified: pnpm vitest run src/vault/readers/cursorTranscript.test.ts src/vault/readers/cursorReader.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 9_2
  - **Refs**: specs/agent-session-index/spec.md#{discover-cursor-project-transcripts, cursor-source-identity-and-deduplication}; specs/vault-session-preview/spec.md#{cursor-agent-cli-transcript-preview, cursor-preview-action-parity}; design.md D12; docs/research/20260823-cursor-agent-cli-integration.md#transcript-preview-follow-up-2026-08-24
  - **Acceptance**:
    - Outcome: Project JSONL previews incrementally.
    - Verify: command pnpm vitest run src/vault/readers/cursorTranscript.test.ts src/vault/readers/cursorReader.test.ts
  - **Plan**:
    1. Add bounded nested and flat discovery and streaming JSONL parsing in `src/vault/readers/cursorTranscript.ts`, preserving text and tool-use records, physical-line locators, incomplete tails, and unknown-record tolerance without fabricated timestamps.
    2. Extend `src/vault/readers/cursorPaths.ts` and `src/vault/readers/cursorReader.ts` to reconcile a matching validated CLI `agentId`, suppress duplicate rows, reject top-level subagents, and source-qualify independently safe unmatched transcripts.
    3. Cover nested and flat layouts, partial records and records without final newlines, oversized lines, malformed rows, tool records, unsafe cwd, subagents, and CLI-mirror deduplication in `src/vault/readers/cursorTranscript.test.ts` and `src/vault/readers/cursorReader.test.ts`.

- [x] 9_4 Add Cursor IDE Composer history reader — verified: pnpm vitest run src/vault/readers/cursorIdeReader.test.ts src/vault/readers/cursorReader.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 9_3
  - **Refs**: specs/agent-session-index/spec.md#{discover-cursor-ide-composer-sessions, cursor-source-identity-and-deduplication}; specs/vault-session-preview/spec.md#{cursor-ide-composer-transcript-preview, cursor-transcript-capability-fallback, cursor-transcript-privacy}; design.md D13; docs/research/20260823-cursor-agent-cli-integration.md#transcript-preview-follow-up-2026-08-24
  - **Acceptance**:
    - Outcome: Supported Cursor IDE Composer sessions appear as source-labeled, previewable, non-resumable Vault entries.
    - Verify: command pnpm vitest run src/vault/readers/cursorIdeReader.test.ts src/vault/readers/cursorReader.test.ts
  - **Plan**:
    1. Add `src/vault/readers/cursorIdeReader.ts` over the existing SQLite snapshot abstraction to discover and normalize the supported `state.vscdb` Composer and bubble profile with strict bounds and source-qualified ids.
    2. Integrate IDE entries and details into `src/vault/readers/cursorReader.ts` and `src/vault/types.ts` without passing IDE ids into CLI launch templates.
    3. Add `src/vault/readers/cursorIdeReader.test.ts` fixtures for supported conversations, ordering, workspace identity, missing, locked, and malformed stores, unknown fields, duplicate ids, and explicit absent Resume and Fork capability; isolate the combined-reader defaults in `src/vault/readers/cursorReader.test.ts`.

- [x] 9_5 Persist metadata-only Cursor source caches — verified: pnpm vitest run src/vault/VaultCacheStore.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 9_3, 9_4
  - **Refs**: specs/agent-session-index/spec.md#{cursor-source-identity-and-deduplication, safe-cursor-session-lookup, cursor-indexing-is-metadata-only}; design.md D3; design.md D12; design.md D13
  - **Acceptance**:
    - Outcome: Cursor metadata caches persist safely across reloads.
    - Verify: command pnpm vitest run src/vault/VaultCacheStore.test.ts
  - **Plan**:
    1. Extend metadata-only Cursor cache variants in `src/vault/cacheTypes.ts` for CLI, project transcript, and IDE stamps plus derived entries.
    2. Add strict validation and round-trip coverage in `src/vault/VaultCacheStore.ts` and `src/vault/VaultCacheStore.test.ts`; decoded detail remains in memory keyed by validated roots and stamps.

- [x] 9_6 Target Cursor source refresh and preview invalidation — verified: pnpm vitest run src/vault/VaultService.test.ts src/vault/VaultService.watchTargets.test.ts src/providers/VaultWatchCoordinator.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 9_5
  - **Refs**: specs/agent-session-index/spec.md#{cursor-source-identity-and-deduplication, safe-cursor-session-lookup, cursor-indexing-is-metadata-only}; design.md D3; design.md D12; design.md D13
  - **Acceptance**:
    - Outcome: Cursor source changes invalidate only affected list and detail state.
    - Verify: command pnpm vitest run src/vault/VaultService.test.ts src/vault/VaultService.watchTargets.test.ts src/providers/VaultWatchCoordinator.test.ts
  - **Plan**:
    1. Add source-aware changed-path routing and exact database, WAL, and JSONL preview invalidation in `src/vault/VaultService.ts`, `src/vault/readers/cursorReader.ts`, `src/vault/readers/cursorTranscript.ts`, and `src/vault/readers/cursorIdeReader.ts`, branching Cursor source paths before generic chat-id validation.
    2. Extend `src/providers/VaultWatchCoordinator.ts`, `src/vault/VaultService.test.ts`, `src/vault/VaultService.watchTargets.test.ts`, `src/providers/VaultWatchCoordinator.test.ts`, `src/vault/readers/cursorReader.test.ts`, and `src/vault/readers/cursorTranscript.test.ts` for targeted CLI WAL, project JSONL, IDE database, overflow fallback, and deletion.

- [x] 9_7 Enforce Cursor source capabilities in the extension host — verified: pnpm vitest run src/vault/LaunchBuilder.test.ts src/vault/VaultLauncher.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 9_4
  - **Refs**: specs/vault-session-launch/spec.md#{cursor-selected-resume-compatibility, cursor-source-capability-enforcement, continue-into-cursor-session}; design.md D4; design.md D13
  - **Acceptance**:
    - Outcome: Validated CLI entries exclusively own Cursor Resume commands.
    - Verify: command pnpm vitest run src/vault/LaunchBuilder.test.ts src/vault/VaultLauncher.test.ts
  - **Plan**:
    1. Enforce source and capability checks in `src/providers/TerminalViewProvider.ts`, `src/vault/LaunchBuilder.ts`, and `src/vault/VaultLauncher.ts` before command construction.
    2. Resolve the actual Cursor executable for Copy Resume Command instead of emitting `{{executable}}`.
    3. Cover CLI Resume, IDE and project rejection, stale and forged messages, and resolved command copy in `src/vault/LaunchBuilder.test.ts`, `src/vault/LaunchBuilder.command.test.ts`, and `src/vault/VaultLauncher.test.ts`.

- [x] 9_8 Render source-aware Cursor preview actions — verified: pnpm vitest run src/webview/vault/VaultPanel.test.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 9_1, 9_7
  - **Refs**: specs/vault-session-launch/spec.md#cursor-source-capability-enforcement; specs/vault-session-preview/spec.md#{cursor-row-activation-opens-preview, cursor-preview-action-parity}; design.md D4; design.md D13
  - **Acceptance**:
    - Outcome: Cursor preview actions match each entry's source capabilities.
    - Verify: command pnpm vitest run src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. Update `src/webview/vault/VaultContextMenu.ts`, `src/webview/vault/PreviewController.ts`, and `src/webview/vault/vaultListView.ts` for CLI and IDE badges plus capability-driven Resume, command-copy, and Continue actions.
    2. Cover CLI actions, IDE and project rejection, preview-first activation, source badges, and Continue in `src/webview/vault/VaultPanel.test.ts`.

- [x] 9_10 Normalize Cursor decoder formatting — verified: pnpm exec biome check src/vault/readers/cursorStore.ts src/vault/readers/cursorStore.test.ts src/vault/sqlite.ts && typecheck_output=$(pnpm run check-types 2>&1); typecheck_status=$?; if [ "$typecheck_status" -eq 0 ]; then :; elif [ "$(printf "%s\n" "$typecheck_output" | grep -c "error TS")" -eq 1 ] && printf "%s\n" "$typecheck_output" | grep -q "src/webview/vault/markdownLite.ts(80,10): error TS2339"; then printf "%s\n" "Known pre-existing markdownLite.ts type error only"; else printf "%s\n" "$typecheck_output"; exit 1; fi; pnpm run test:unit exit 0
  - **Deps**: 9_2
  - **Refs**: design.md D11
  - **Acceptance**:
    - Outcome: Cursor decoder and SQLite snapshot files pass the repository formatter check without behavior changes.
    - Verify: command pnpm exec biome check src/vault/readers/cursorStore.ts src/vault/readers/cursorStore.test.ts src/vault/sqlite.ts
  - **Plan**:
    1. Apply formatter-equivalent edits only in `src/vault/readers/cursorStore.ts`, `src/vault/readers/cursorStore.test.ts`, and `src/vault/sqlite.ts`.

- [ ] 9_9 Document and smoke Cursor CLI plus IDE preview parity
  - **Deps**: 9_6, 9_8
  - **Refs**: specs/vault-session-preview/spec.md#{cursor-row-activation-opens-preview, cursor-agent-cli-transcript-preview, cursor-ide-composer-transcript-preview, cursor-transcript-privacy}; specs/vault-session-launch/spec.md#{cursor-selected-resume-compatibility, cursor-source-capability-enforcement}; design.md D11; design.md D12; design.md D13
  - **Acceptance**:
    - Outcome: Guidance and local smoke show preview-first CLI and IDE history with CLI-only Resume.
    - Verify: manual open one compatible CLI row and one IDE row in the Extension Development Host, confirm bounded preview and actions, then explicitly Resume the CLI row without exposing transcript content in logs
  - **Plan**:
    1. Update `./README.md` and `./CHANGELOG.md` for CLI and IDE source badges, preview-first activation, explicit CLI-only Resume, local transcript privacy, schema fallback, and unsupported ACP, fork, and cross-store Resume.
    2. Update `src/webview/vault/vaultPanel.css` only if source badges need presentation changes.
    3. Run the manual smoke without copying, logging, or submitting transcript content; record only capability and state outcomes.
