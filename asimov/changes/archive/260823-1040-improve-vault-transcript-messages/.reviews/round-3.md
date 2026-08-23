# Review round 3

- Date: 2026-08-23
- Scope: re-review of round-2 accepted fixes, S2 rebuttal, and task 11_1 on the current working tree
- Reviewable lines: 2386
- Accuracy note: Large change — accuracy may decrease
- Agents spawned: 6 (`asm-review-data-security`, `asm-review-logic`, `asm-review-contracts`, `asm-review-frontend`, `asm-review-performance`, `asm-review-reuse`)
- Agents skipped: none
- Verdict: BLOCK
- Counts: 1 BLOCK, 4 WARN, 1 SUGGEST
- Verification: `pnpm run check-types` passed; focused round-3 run passed 14 files / 403 tests; full `pnpm run test:unit` passed 142 files / 2476 tests; `npx biome check src/` completed with the documented 13 pre-existing warnings and no errors; no changed test contains `.only` or `.skip`
- Cross-round fixed: B1, B2, B4, W1, W2, W3, W5, W7, S1
- Cross-round persists: B3, W4, W6
- Cross-round rejected: S2 remains rejected; the fresh multi-agent PATH presence probe has different semantics from the memoized OpenCode semver capability probe, and the re-review found no concrete reason to reverse that triage
- Additional feedback: task 11_1 (`interruptedMessageId` → interruption notice) is implemented consistently across classification, timeline/title behavior, and Raw locator propagation; no finding survives on it

## Findings

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-performance
- file:line: `src/vault/readers/opencodeReader.ts:610`
- title: OpenCode Raw cap still races across independent snapshots
- evidence: The size preflight and payload fetch are four separate `readSqliteFn` calls. Production `readSqlite` creates a fresh copied database snapshot per call, so parts appended after the preflight are returned by the unrestricted payload query at lines 630-633; only after every newer row is materialized and serialized does line 639 reject the record.
- impact: Parts per message plus concurrent live append remain unbounded growth axes. A running OpenCode session can make the host fetch, retain, and serialize arbitrarily more than 256 KB despite the advertised pre-materialization cap.
- suggestedFix: Execute size classification and conditional payload retrieval in one SQL statement/transaction against one copied snapshot, or add a reader primitive that shares one stable snapshot while enforcing the accumulated byte budget before rows cross into the host. Add a growth-between-preflight-and-fetch regression test.
- status: accepted
- triage: Accept — production `readSqlite` creates a new copied snapshot per call, so the payload query can observe unbounded rows that did not exist during preflight. The size decision and payload return must share one snapshot.

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- file:line: `src/vault/readers/codexReader.ts:839`
- title: Gap-aware continuation is still missing for Codex and OpenCode
- evidence: `createBoundedRecordBuffer` inserts `__vault_gap__`, but `classifyCodexRolloutEvents` checks for `payload` first and skips the sentinel without emitting `{ kind: "gap" }`. OpenCode concatenates/deduplicates head and tail windows and only sets `detail.truncated` at `src/vault/readers/opencodeReader.ts:695-705`; it never inserts a timeline gap.
- impact: At larger load-more limits, a retained tail user turn can still pair with an unrelated retained head assistant turn across omitted Codex or OpenCode history.
- suggestedFix: Translate the Codex sentinel into a timeline gap before payload processing. Preserve OpenCode head/tail provenance and insert an equivalent gap at every proven omitted boundary. Add reader-to-`resolveForkPoint` tests for both agents.
- status: accepted
- triage: Accept — D15 requires every head-tail reader to preserve discontinuity. Codex drops the shared sentinel before classification and OpenCode emits no equivalent provenance, so both can still mis-pair turns.

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: `src/webview/vault/ContinueDialog.ts:84`
- title: The readonly anchor textarea can escape the modal focus trap
- evidence: The anchor textarea remains a native tab stop, but `focusable()` explicitly excludes `textarea[readonly]`. If the reader focuses that visible textarea and presses Shift+Tab, the boundary logic sees neither the first nor last tracked control and allows native focus to move behind the `aria-modal` dialog.
- impact: The exact keyboard escape accepted as round-2 W6 remains reachable; the current test covers only instruction/start boundaries.
- suggestedFix: Either set the readonly anchor preview to `tabIndex = -1`, or include it in the focusable boundary list and test forward/backward Tab from it.
- status: accepted
- triage: Accept — the readonly textarea remains browser-focusable but is absent from the trap's focus list. Setting it to `tabIndex = -1` preserves resizing/selection while closing the escape path.

### W8

- ID: W8
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts, asm-review-frontend
- file:line: `src/webview/vault/ContinueDialog.ts:96`
- title: The confirmed instruction cap is silent and not enforced at the IPC boundary
- evidence: The textarea has no `maxLength`, counter, or cap warning and posts any non-empty string. The host receives the entire value and `buildContinuationPrompt` later silently slices it to 4000 characters at `src/vault/ContinuationPrompt.ts:54-60`.
- impact: The instruction the reader confirms can differ from what reaches the agent, and an arbitrarily large pasted value crosses WebView IPC before the cap is applied.
- suggestedFix: Define one shared maximum, expose/enforce it in the dialog, and reject over-cap IPC values host-side rather than silently truncating confirmed text. Keep prompt-side bounding only as matching defense in depth.
- status: accepted
- triage: Accept — the launch spec requires the confirmed instruction to be explicitly bounded and to reach the agent unchanged. The dialog must enforce the shared cap and the host must reject forged over-cap IPC instead of silently slicing it.

### W9

- ID: W9
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: `src/vault/readers/claudeReader.ts:294`
- title: Claude's oversized-line hint can mistake transcript content for the target uuid
- evidence: The bounded scanner receives only `JSON.stringify(msgRef)` as its needle. Any earlier oversized record containing that quoted uuid anywhere in its message content is treated as the target and returns `too-large` immediately, even when the actual record with `uuid === msgRef` appears later.
- impact: Raw copy and assistant-anchor resolution can falsely refuse valid later Claude records in transcripts that quote or discuss a record uuid.
- suggestedFix: Use a streaming hint that recognizes the `uuid` field/value structure rather than an arbitrary quoted-value occurrence, or continue scanning after ambiguous oversized matches while preserving bounded memory.
- status: accepted
- triage: Accept — searching for the quoted value alone is not a field match and can fail a valid later locator. The bounded scanner needs a structural `uuid` field hint or must treat an oversized content occurrence as ambiguous and continue.

### S3

- ID: S3
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-frontend
- file:line: `src/webview/vault/ContinueDialog.ts:149`
- title: Async dialog status changes are not announced to assistive technology
- evidence: The status container is a plain hidden `div`; target-load and complete-instruction failures update it without `role="status"`, `role="alert"`, or `aria-live`.
- impact: Screen-reader users may not learn why Start remains disabled or that they must type the instruction manually.
- suggestedFix: Give the status region an appropriate polite live-region role and retain the visible text behavior.
- status: accepted
- triage: Accept — this is a trivial semantic addition to an existing dynamic status region and makes the already-visible async failure state available to screen readers.
