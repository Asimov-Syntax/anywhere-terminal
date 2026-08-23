# Review round 2

- Date: 2026-08-23
- Scope: working tree (`git diff HEAD`)
- Reviewable lines: 2066
- Accuracy note: Large change — accuracy may decrease
- Agents spawned: 6 (`asm-review-data-security`, `asm-review-logic`, `asm-review-contracts`, `asm-review-frontend`, `asm-review-performance`, `asm-review-reuse`)
- Agents skipped: none
- Verdict: REJECT
- Counts: 4 BLOCK, 7 WARN, 2 SUGGEST
- Verification: `pnpm run check-types` passed; focused changed-feature run passed 17 files / 462 tests; full `pnpm run test:unit` passed 142 files / 2455 tests; no changed test contains `.only` or `.skip`
- Cross-round: round 1 was partial; all eight accepted findings (F1, F2, L1-L6) are fixed and are not carried forward.

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic, asm-review-contracts
- file:line: `src/providers/TerminalViewProvider.ts:490`
- title: Continuation anchor is never resolved or verified host-side
- evidence: `handleVaultContinue` passes the webview's `anchorRef` directly into `buildContinuationPrompt`; it never calls the record reader, checks that the locator belongs to the selected entry, or requires the resolved record to be an assistant turn. `anchorLine` then interpolates the original string into the host-authored prompt.
- impact: A stale, user-record, fabricated, or newline-bearing locator still launches a continuation while claiming a different assistant fork point; Claude/OpenCode locator text can also inject prose into the handoff frame. This violates the explicit host-resolution boundary in D9-D10 and the launch spec.
- suggestedFix: Resolve `anchorRef` through the source entry's reader before composing the prompt, parse the resolved agent-specific record, require an assistant role, and reject missing, oversized, malformed, or mismatched anchors. Format the prompt from the validated canonical locator only.
- status: accepted
- triage: Accept — the launch spec and D9-D10 require the host to resolve locators from the source store. A webview-supplied anchor cannot be trusted as an assistant fork point or interpolated before canonical validation.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-performance
- file:line: `src/vault/readers/recordLine.ts:29`
- title: JSONL Raw cap is enforced after an unbounded line is materialized and parsed
- evidence: `readline` constructs each complete physical line and `JSON.parse(trimmed)` runs before the 256 KB byte check at lines 47-51. Physical record bytes are an unbounded per-record growth axis.
- impact: Claude and Codex Raw lookups can allocate and parse arbitrarily large stored records despite the advertised cap, blocking or exhausting the extension host before the request is refused.
- suggestedFix: Use a chunk/byte-bounded physical-line reader that aborts an oversized candidate before constructing and parsing it. Where the locator permits it, skip non-target lines without parsing; preserve the distinction between not-found and too-large for the target.
- status: accepted
- triage: Accept — D5's 256 KB cap is a resource bound, not only a response-size check. Materializing and parsing an unbounded physical line before checking it violates that contract.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-performance
- file:line: `src/vault/readers/opencodeReader.ts:606`
- title: OpenCode Raw lookup materializes every message part before enforcing 256 KB
- evidence: The parts query has no `LIMIT` or byte guard, returns every row for the message, and `JSON.stringify` materializes the complete `{message, parts}` object before the byte comparison. Parts per message are an uncapped growth axis.
- impact: A large OpenCode message can allocate/query/serialize far beyond 256 KB and stall or exhaust the extension host even though the final response is rejected.
- suggestedFix: Enforce the budget in the store read: preflight an exact encoded-size bound or page ordered parts while accumulating serialized bytes and stop as soon as the cap is crossed. Do not fetch and serialize the unbounded row set first.
- status: accepted
- triage: Accept — OpenCode's multi-row record has the same D5 bound. Fetching and serializing every part before measuring allows unbounded work despite the advertised cap.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: `src/webview/vault/forkPoint.ts:60`
- title: The first user message is offered as an instruction despite having no assistant fork point
- evidence: The user branch always calls `parts(nearest(..., "assistant"), chosen)`. When no assistant precedes the chosen user turn, `parts` still emits that user's `seedRef` and `seedText`; `forkPoint.test.ts:47-51` codifies this behavior. D9 and the launch spec require no anchor and an empty instruction in this case.
- impact: Continuing from the opening user turn re-asks that prompt instead of continuing from an assistant-produced state, contradicting the redesigned semantics at a core entry point.
- suggestedFix: If a chosen user message has no preceding assistant message in the same contiguous transcript segment, return an empty fork point and open the dialog with an empty editor.
- status: accepted
- triage: Accept — the launch spec line 9 and D9 explicitly require no anchor and an empty instruction when no assistant precedes the chosen user turn. The current test preserves the superseded behavior.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- file:line: `src/vault/ContinuationPrompt.ts:68`
- title: Transcript-derived title and cwd are embedded as trusted prompt prose
- evidence: `entry.customName || entry.title` and `entry.cwd` are interpolated directly into unfenced lines before the historical-data warning. Titles can derive from transcript content, and cwd is read from third-party stores; neither is normalized to one line or delimited as inert data.
- impact: Newlines or instruction-like content can alter the host-authored handoff frame, including when the reader selected a bypassing permission posture.
- suggestedFix: Treat every store-derived metadata value as untrusted: normalize controls/newlines, serialize it in a clearly delimited data block, and state that metadata fields are data rather than instructions. Prefer canonical host-resolved paths.
- status: accepted
- triage: Accept — the session title is transcript-derived and both values enter the host-authored prompt frame. The handoff safety requirement applies to all store-derived content, not only transcript bodies.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-contracts
- file:line: `src/vault/LaunchBuilder.ts:125`
- title: Unknown permission-choice IDs silently fall back to CLI configuration
- evidence: `permissionArgs` resolves a submitted or captured ID with `find(... )?.args ?? []`. An explicit stale/invalid ID therefore launches without registry permission arguments instead of failing.
- impact: The posture shown or requested need not be the posture actually launched; agent defaults/configuration may be more permissive, undermining the explicit visible-choice mitigation.
- suggestedFix: When an explicit choice ID is supplied, require it to exist for the target definition and throw a typed launch error otherwise. Handle an unsupported captured posture in the dialog with a visible safe default, not an empty-argv fallback.
- status: accepted
- triage: Accept — the launch spec requires the started posture to match the posture shown. An explicit unknown choice must fail closed instead of delegating silently to agent configuration.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `src/webview/vault/PreviewController.ts:338`
- title: Missing or failed seed resolution can launch the capped preview text
- evidence: A host fetch is attempted only when `fork.seedRef` exists; otherwise `ContinueDialog` initializes from `seedText`. If the record request rejects, its rejection handler deliberately leaves that timeline text in place, and Start remains enabled. Timeline user text is capped by `MAX_MESSAGE_TEXT`.
- impact: A locator-less, removed, oversized, or unreadable user turn can seed the new session with a shortened instruction, the exact silent truncation D9 introduced host resolution to prevent.
- suggestedFix: Without a resolvable seed locator, initialize empty or require the reader to explicitly acknowledge/rewrite the preview text. On resolution failure, show an error and prevent Start until the instruction is reader-authored.
- status: accepted
- triage: Accept — D9 forbids using bounded timeline text as the instruction. A missing or failed host resolution must leave an empty/reader-authored editor or visibly block Start, never silently launch the preview approximation.

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `src/webview/vault/forkPoint.ts:31`
- title: Fork pairing crosses the omitted middle of head-tail timelines
- evidence: Reader bounds concatenate retained head and tail records and expose only a `truncated` flag; `nearest` scans the resulting array as one contiguous sequence. Once older windows expose both sides, a tail user turn can pair with a head assistant turn despite omitted intervening turns.
- impact: The dialog can present an anchor and instruction that were never adjacent in the source transcript and continue from the wrong state.
- suggestedFix: Carry an explicit discontinuity marker/segment identity into the timeline and prohibit pairing across it; when continuity is unknown, return no anchor and an empty instruction.
- status: accepted
- triage: Accept — D9's nearest-turn pairing assumes transcript continuity. The head-tail omission breaks that premise, so pairing across an unknown middle can produce a false anchor/seed relationship.

### W5

- ID: W5
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts
- file:line: `src/vault/readers/detail.ts:662`
- title: Expanded injected records are truncated with no Raw escape hatch
- evidence: Notice bodies and compaction text are capped at `MAX_MESSAGE_TEXT`, but the computed `ref` is not carried onto those item variants. The shared action bar binds only `kind: "message"`, so neither injected kind can retrieve its complete stored record.
- impact: Observed 25 KB compactions and multi-page task reports cannot reveal the full body on expansion, contradicting the preview requirement and the design's stated Raw fallback for bounded bodies.
- suggestedFix: Carry reader-owned locators on notice/compaction items and expose Raw retrieval for them, or revise the contract and UI to state that expansion is intentionally partial.
- status: accepted
- triage: Accept — the preview spec says expansion reveals the full body, while D3 explicitly names Raw as the fallback for bounded bodies. The current capped body with no locator satisfies neither path.

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-frontend
- file:line: `src/webview/vault/ContinueDialog.ts:199`
- title: The confirmation dialog declares modality without trapping or restoring focus
- evidence: The document key handler handles Escape only. Background content is not inert, Tab/Shift+Tab are not cycled inside the dialog, and `dispose` removes the focused overlay without restoring the element that opened it.
- impact: Keyboard and screen-reader users can reach interactive content behind the confirm gate and are stranded after cancellation/dismissal, contradicting `aria-modal="true"`.
- suggestedFix: Trap focus within the dialog (or make background siblings inert), capture the opener before mounting, and restore focus on every non-launch dismissal path.
- status: accepted
- triage: Accept — declaring `aria-modal` while allowing focus behind the confirmation gate is an accessibility defect. Focus must remain in the dialog and return to the invoking message when dismissed.

### W7

- ID: W7
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-logic
- file:line: `src/webview/vault/PreviewController.ts:254`
- title: Closing the preview retains the detached message-action body and listeners
- evidence: `closePreview` clears the shell DOM but never invokes or clears `disposeMessageActions`. The stored disposer closes over the detached preview body, delegated listeners, action bar, source items, and flash timers until another successful detail render replaces it.
- impact: Closing a large preview can retain up to the 5000-item body for the panel/controller lifetime, and error/loading paths can retain an older bar longer than intended.
- suggestedFix: Invoke and clear `disposeMessageActions` in `closePreview` and before every loading/error body replacement, not only before a later successful detail render.
- status: accepted
- triage: Accept — the controller owns the delegated listeners and detached body through the disposer. Every body teardown path must release them, especially at the 5,000-item bound.

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse
- file:line: `src/webview/vault/messageActions.ts:56`
- title: Reuse the existing latest-success copy confirmation behavior
- evidence: The new action buttons duplicate `copyableValue`'s generation counter, rejection handling, copied-state flash, and superseded-activation logic from `renderAtoms.ts:66-87`.
- impact: Future changes to clipboard confirmation semantics can diverge between meta copies and message copies.
- suggestedFix: Extract a shared async-action confirmation helper and keep the established `copyableValue` behavior as the semantic source.
- status: accepted
- triage: Accept — `messageActions` duplicates the same latest-success/rejection/flash state machine already owned by `copyableValue`. Extracting that behavior prevents the two copy affordances from drifting.

### S2

- ID: S2
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-reuse
- file:line: `src/vault/registry.ts:182`
- title: Reuse the existing executable probe instead of a second uncached implementation
- evidence: `detectContinuationTargets` adds another `execFile --version` wrapper and timeout, while `forkSupport.ts` already owns injectable, memoized version probing and semver parsing.
- impact: Every dialog repeats fixed subprocess probes, and fork/continuation capability checks can evolve different failure and caching semantics.
- suggestedFix: Generalize the existing probe primitive for executable/args and have both fork support and continuation target detection consume it.
- status: rejected
- triage: Rebut — D11 and task 8_2 deliberately place continuation availability detection beside registry data while only reusing `forkSupport`'s injectable exec shape. `forkSupport` owns an OpenCode-specific, globally memoized semver capability check; continuation needs a fresh multi-agent presence check, so sharing it would conflate distinct semantics and make PATH changes stale.
