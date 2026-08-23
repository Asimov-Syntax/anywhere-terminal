# Review Round 2

- Date: 2026-08-23
- Change: `extract-vault-watch-coordinator`
- Scope: changes since round 1 plus rebutted files
- Reviewable lines: 15 round-2 implementation lines; 281 implementation lines in the full current working-tree diff
- Verdict: APPROVE
- Current counts: 0 BLOCK, 0 WARN, 0 SUGGEST
- Prior findings: 3 fixed
- Agents spawned: `asm-review-logic`, `asm-review-frontend`, `asm-review-contracts`, `asm-review-reuse`
- Agents skipped: `asm-review-data-security` — no data/security boundary changed; `asm-review-performance` — watcher growth axes and debounce behavior were unchanged by the round-2 fixes
- Context note: `proposal.md` remains absent; intent was reconstructed from the caller brief, `design.md`, and round-1 triage
- Verification: `pnpm run check-types` passed; focused watcher/provider tests passed (37); full unit suite passed (143 files, 2491 tests); targeted Biome check passed with no fixes; `git diff --check HEAD` passed

## Cross-round findings

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; `asm-review-logic`; `asm-review-frontend`
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.ts:1026`
- Title: Stale webview messages control the replacement watcher client
- Evidence: Fixed. `resolveWebviewView` now captures a resolution-local `vaultWatchClient`, passes it into that webview's message handler, and the `vaultWatchSession` branch invokes the captured client. The two-resolution regression sends a late first-view message and delayed first-view disposal, verifies the second client is untouched, and then verifies second-view routing.
- Impact: The prior cross-resolution ownership violation is removed.
- SuggestedFix: Completed as accepted in round 1.
- Status: fixed
- Triage: accepted in round 1

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; `asm-review-logic`
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/VaultWatchCoordinator.test.ts:92`
- Title: Preservation tests do not prove independent follow lifecycles across clients
- Evidence: Fixed. The new two-client test follows different entry IDs, triggers both timers, disposes the first client, and proves the first callback stays silent while the second watch, timer, generation, disposable, and callback remain active.
- Impact: Independent per-client follow ownership is now directly regression-tested.
- SuggestedFix: Completed as accepted in round 1.
- Status: fixed
- Triage: accepted in round 1

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: `asm-review-reuse`
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/VaultWatchCoordinator.ts:31`
- Title: Factor the repeated target-subscription assembly
- Evidence: Fixed. `subscribeTargets` now owns target iteration, create/change/delete registration, disposable collection, and per-target error dispatch. Store and follow lifecycles retain their domain-specific callbacks, logging context, timers, generations, and disposal state.
- Impact: Subscription setup now has one implementation without weakening lifecycle cohesion.
- SuggestedFix: Completed as accepted in round 1.
- Status: fixed
- Triage: accepted in round 1

## New findings

None.
