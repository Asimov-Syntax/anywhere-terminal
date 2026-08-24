# Review Round 2: show-cursor-subagent-continuations

- Date: 2026-08-24
- Scope: working tree re-review — round-1 fixes and rebutted files
- Reviewable lines: 51
- Agents spawned: asm-review-contracts, asm-review-logic, asm-review-frontend, asm-review-reuse
- Agents skipped: asm-review-data-security (no persistence, auth, secrets, external API, or validation surface); asm-review-performance (growth axes and caps were bounded and covered by chair/logic re-review)
- Verdict: WARN
- Counts: BLOCK 0 | WARN 1 | SUGGEST 0
- Verification: `pnpm run check-types` passed; focused changed suites passed (5 files, 284 tests); full `pnpm run test:unit` passed (154 files, 2854 tests)

## W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-logic
- File: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorTranscript.ts:497
- Title: Recent-activity cap runs before continuation removal
- Evidence: Fixed. `readCursorTranscript()` now filters with the shared `isCursorContinuationStep` predicate before its local 12-item cap; the store path returns uncapped merged activity and the common reader also filters before its final cap. `stats.subagentCount` still counts from the full merged activity.
- Impact: The prior empty/underfilled project-transcript recent-activity strip is no longer reproducible.
- SuggestedFix: None.
- Status: fixed
- Triage: accepted in round 1

## W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-contracts, asm-review-frontend
- File: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:577
- Title: Linked undeclared children lose chip suppression in nested fallback
- Evidence: Direct activity, recent activity, unresolved inline children, and collapsed linked sessions now omit the chip correctly. However, the linked conversion communicates undeclared state only by omitting `agent`. If lazy child loading fails, `previewTimeline.ts:153` reconstructs the fallback activity as `name: fallback.agent ?? "Agent"` without `undeclared`, and `activityStep` renders an invented `@Agent` chip.
- Impact: An undeclared Cursor child initially renders correctly, but a failed nested-detail request changes it into a card with a fabricated agent type, still violating approved D2's unqualified no-chip floor.
- SuggestedFix: Carry explicit undeclared state through the `subagentSession` and `NestedInvocationFallback` contract for Cursor, then set it on the reconstructed activity step. Do not infer solely from missing `agent`, because agentless non-Cursor group sessions share that shape. Add a failed nested-detail component test asserting no badge or agent chip.
- Status: accepted
- Triage: accepted in round 1; round-1 fix covered the direct and inline paths but not the reconstruct-after-failure path. Confirmed by reading it: `renderSubagentSession` builds the fallback from `item.agent` (already omitted for an undeclared child), then `renderNestedInvocationFallback` synthesizes `name: fallback.agent ?? "Agent"`, so `activityStep` prints `@Agent` — the label is correct until the nested request fails and then becomes wrong. Same unqualified D2 floor. Taking the chair's guidance not to infer from an absent `agent`: adding explicit `undeclared` to the `subagentSession` item and to `NestedInvocationFallback` and threading it through, so agentless non-Cursor group nodes keep their current behaviour. Regression added for the failed nested-detail path.

## S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: asm-review-frontend
- File: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.test.ts:2717
- Title: Cover the agent-absent continuation rendering branch
- Evidence: Fixed. A component test now renders a continuation without `agent` and asserts the resumed glyph/title remain while agent badge and chip are absent.
- Impact: The collapsed D2 floor branch now has regression coverage.
- SuggestedFix: None.
- Status: fixed
- Triage: accepted in round 1
