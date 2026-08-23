# Review Round 1

- Date: 2026-08-23
- Change: `extract-vault-watch-coordinator`
- Scope: working tree
- Reviewable lines: 266
- Verdict: WARN
- Counts: 0 BLOCK, 2 WARN, 1 SUGGEST
- Agents spawned: `asm-review-logic`, `asm-review-frontend`, `asm-review-contracts`, `asm-review-performance`, `asm-review-reuse`
- Agents skipped: `asm-review-data-security` — no persistence, auth, input-validation, or external API boundary changed
- Context note: `proposal.md` is absent; intent was reconstructed from the caller brief and `design.md`
- Verification: `pnpm run check-types` passed; focused watcher/provider tests passed (35); full unit suite passed (143 files, 2489 tests); `git diff --check HEAD` passed

## Findings

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; `asm-review-logic`; `asm-review-frontend`
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.ts:1028`
- Title: Stale webview messages control the replacement watcher client
- Evidence: Each resolved webview registers its own message listener, but the changed `vaultWatchSession` branch dispatches through mutable provider-wide `_vaultWatchClient`. A later `resolveWebviewView` call disposes the old client and replaces this field. Until the old webview listener is removed, a queued or late message from that webview can therefore switch or stop the replacement view's follow generation; resulting details use the replacement client's callback and are posted to the replacement webview. The dispose path correctly captures `vaultWatchClient`, so message dispatch and disposal no longer use the same ownership rule. The added provider test exercises only one resolve and cannot detect this cross-resolution routing.
- Impact: Per-webview follow ownership can be violated during re-resolution, allowing stale view traffic to cancel or redirect the current view's live-follow stream.
- SuggestedFix: Capture the client created for the resolution in message routing, for example by passing `vaultWatchClient` into `handleMessage`, and invoke that client rather than `_vaultWatchClient`. Add a re-resolution test that sends a watch message through the first view's handler after the second client attaches and verifies the second client is untouched; also fire the first dispose handler to retain coverage of the identity guard.
- Status: accepted
- Triage: Accepted — message routing must use the same per-resolution client ownership as disposal to satisfy design D1.

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; `asm-review-logic`
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/VaultWatchCoordinator.test.ts:40`
- Title: Preservation tests do not prove independent follow lifecycles across clients
- Evidence: The only two-client test attaches two clients and inspects their store subscription disposal without calling `watchSession`. The follow success and stale-generation tests use one client. This leaves the explicit change acceptance — two clients retain independent follow watchers and generations — untested, despite the extraction moving that state behind a new ownership seam.
- Impact: A future or accidental shared `FollowWatchLifecycle`, generation counter, timer, or watcher collection could pass the current suite while one webview disrupts another's followed session.
- SuggestedFix: Add a test with two attached clients following different entry IDs. Trigger both follow watchers, switch or dispose one client, and assert the other client's watcher, timer, generation, and callback remain active and isolated.
- Status: accepted
- Triage: Accepted — design D2 explicitly requires independent per-client follow state, and the current suite proves only store isolation.

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: `asm-review-reuse` (downgraded by chair from WARN)
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/VaultWatchCoordinator.ts:41`
- Title: Factor the repeated target-subscription assembly
- Evidence: `StoreWatchLifecycle` at lines 41-53 and `FollowWatchLifecycle` at lines 112-124 both iterate targets, call `subscribePattern` with identical create/change/delete handlers, collect disposables, and catch subscription failures; only the log context differs.
- Impact: Future subscription setup or error-handling changes must be kept aligned in two places inside the extracted lifecycle owner.
- SuggestedFix: Use a small module-local helper that accepts targets, the event callback, and an error-label function, and returns the collected disposables.
- Status: accepted
- Triage: Accepted — the helper is local, behavior-preserving, and removes duplicated subscription assembly before it can drift.
