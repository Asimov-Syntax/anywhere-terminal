# Review Round 1: show-cursor-subagent-continuations

- Date: 2026-08-24
- Scope: working tree
- Reviewable lines: 975
- Note: Large change — accuracy may decrease
- Agents spawned: asm-review-logic, asm-review-contracts, asm-review-frontend, asm-review-performance, asm-review-reuse
- Agents skipped: asm-review-data-security (no changed persistence, auth, secrets, external API, or input-validation surface)
- Verdict: WARN
- Counts: BLOCK 0 | WARN 2 | SUGGEST 1
- Verification: `pnpm run check-types` passed; focused changed suites passed (5 files, 279 tests); full `pnpm run test:unit` passed (154 files, 2849 tests)

## W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-logic
- File: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorTranscript.ts:494
- Title: Recent-activity cap runs before continuation removal
- Evidence: `readCursorTranscript()` returns `mergedActivity.slice(-12)`, while the common reader removes `continuation` entries only afterward in `visibleRecentActivity()`. A launch followed by 12 or more resumes can leave a 12-item tail containing only continuations; the later filter then produces an empty strip and earlier eligible activity has already been discarded.
- Impact: The project-transcript and CLI-mirror fallback paths can return an empty or underfilled agent-level recent-activity strip, contrary to approved D4's filter-before-cap ordering.
- SuggestedFix: Keep merged activity uncapped until `visibleRecentActivity(...).slice(-MAX_RECENT_ACTIVITY)`, or filter continuations before the transcript-local slice. Add a regression with more than 12 resume invocations and earlier eligible activity.
- Status: accepted
- Triage: Confirmed by reading the code: cursorTranscript.ts returns `mergedActivity.slice(-12)` and cursorReader's `visibleRecentActivity` filters continuations only afterwards, so the strip is capped before it is filtered. cursorStore does NOT have this defect (it returns the merged activity uncapped), which makes the two reader paths inconsistent as well. Fixing by filtering continuations before the transcript-local slice, with the predicate extracted to cursorNormalization so both paths share one definition rather than duplicating it.

## W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-contracts
- File: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:585
- Title: Unknown Cursor agent types still reach public activity cards as `@Task`
- Evidence: `visibleRecentActivity()` and unresolved-child fallbacks pass `visibleSubagentStep()` through with `name: "Task"`. The linked `subagentSession` branch omits `agent` when `isCursorDeclaredAgentType()` is false, but the public activity renderer unconditionally renders `@${step.name}`. Thus the JSONL floor or an unavailable child can still display the invoking tool as an agent type.
- Impact: Preview output can contradict approved D2 by presenting `@Task` as a real agent type in the recent strip or inline fallback, even though linked continuation rows correctly omit the chip.
- SuggestedFix: Carry an explicit optional display-agent field (or equivalent public no-chip state) through `visibleSubagentStep()` and make the activity renderer omit the badge/chip when absent. Add an end-to-end preview test for a `Task`-named step with no decoded declared type in recent activity and unresolved-child fallback.
- Status: accepted
- Triage: Confirmed: renderAtoms.ts `activityStep` renders `@${step.name}` with an unconditional `agent` badge, so a step whose name is the invoking tool's reaches the strip and the unresolved-child inline fallback as `@Task`. This contradicts the delta's own wording in specs/vault-session-preview/spec.md#cursor-subagent-declared-type-resolution, which requires omitting the agent type unqualified — not only on the linked sub-session path. Two honest resolutions existed: widen the shared activity shape, or narrow the spec sentence. Taking the fix rather than narrowing the spec, because the floor is the point of D2 and a wrong label is worse than no label on every surface. Implementing as one additive optional boolean on the activity sub-agent arm so no other provider's behaviour changes.

## S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: asm-review-frontend
- File: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.test.ts:2672
- Title: Cover the agent-absent continuation rendering branch
- Evidence: New continuation-row tests exercise only `agent: "asm-oracle"`; the changed branch that renders a continuation with no `item.agent` has no direct component assertion.
- Impact: A future frontend regression could restore a badge/chip in the D2 floor case without this component suite detecting it.
- SuggestedFix: Add a continuation item without `agent` and assert the resumed glyph and title render while `.vault-preview-subagent-agent` and `.vault-preview-subagent-badge` remain absent.
- Status: accepted
- Triage: Cheap and correct — the agent-absent continuation branch is exactly the D2 floor path W2 is about, so it should not be the untested one. Adding the case.
