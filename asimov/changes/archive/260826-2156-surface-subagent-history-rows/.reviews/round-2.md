# Review Round 2

- Date: 2026-08-27
- Cycle: 1
- Round: 2
- Mode: verification
- Scope: working tree — accepted round-1 fixes plus behavioral impact cone
- Reviewable lines: 139
- Scope lock: passed — target changes are remediation for accepted round-1 findings; tasks 1_1–3_1 are unchanged
- Agents spawned:
  - asm-review-contracts — OpenCode detail correlation and shared contract consumers — gpt-5.6-sol[1M]
  - asm-review-logic — correlation, error outcomes, state lifecycle, and routing — gpt-5.6-terra[1M]
  - asm-review-frontend — worktree states, preview impact, and entry modes — sonnet[1M]
- Agents skipped:
  - asm-review-data-security — no changed security or identity boundary in the remediation cone
  - asm-review-performance — the bounded-growth issue is a detail-contract invariant covered by contracts and logic; no new hot-path or uncapped collection was introduced
  - asm-review-reuse — no new duplication or split-cohesion risk in the remediation cone
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 1 | SUGGEST 0
- Verification: `pnpm run check-types` passed; 138 focused tests passed across the four remediation suites. Two targeted invariant repros failed as described in B6 and B8; scratch files were deleted in the same commands.

## Prior finding verification

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:79
- title: The expansion request never reaches WorktreeHost
- evidence: Both production provider switches now forward `requestWorktreeSubagents` beside the existing worktree messages. Sidebar, bottom-panel, and created-editor routing tests reach the host. `TerminalPanelSerializer` revival constructs the same `TerminalEditorProvider`, so current revival behavior shares the corrected switch.
- impact: The original end-to-end inertness is removed.
- suggestedFix: None for the original defect. W2 records the remaining revival regression-test gap.
- status: fixed
- triage: Accepted in round 1; verified fixed at both provider boundaries and through the shared revival construction path.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/delegations.ts:25
- title: Actual reader output can produce two rows for one delegation
- evidence: OpenCode now holds subtask parts until child stubs are known and emits a plain subtask only when no stub was consumed. The direct matched, unmatched, child-only, and repeated-identical cases now produce one item per accounted delegation.
- impact: The original unconditional double-emission mechanism is removed from both the shared vault timeline and the worktree roster.
- suggestedFix: None for the original mechanism. B6 records a distinct greedy-correlation mechanism found inside the fix.
- status: fixed
- triage: Accepted in round 1; verified fixed for the original uncorrelated-emission mechanism. A different matching mechanism is tracked separately as B6.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeTreeView.ts:462
- title: An incomplete empty roster is rendered as definitive emptiness
- evidence: The empty branch now consults `roster.incomplete`; incomplete-empty renders `Delegations could not be read` and never `No delegations found`. A focused test covers the intersection.
- impact: The view no longer claims a session delegated nothing when the reader reported omission.
- suggestedFix: None.
- status: fixed
- triage: Accepted in round 1; verified fixed at the renderer and test boundary.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:147
- title: Webview roster state outlives the host's row/session cache lifetime
- evidence: `requestedRosters` is reconciled against current `(rowId, entryId)` keys, while expansion is retained only for current rows that still carry a session. Tests cover row disappearance/reappearance, entry-id loss, and session replacement. Boundary inventory: host eviction and view re-request now agree; session replacement re-requests; entry-id loss removes the unreachable section; persisted expansion is deliberately updated to the reconciled current identities.
- impact: Returning rows can request again, stale expanded sections disappear, and the asked-set no longer grows along row/session churn.
- suggestedFix: None.
- status: fixed
- triage: Accepted in round 1; verified fixed across the listed lifecycle boundaries.

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/opencodeReader.ts:745
- title: A successful capped child read is published as complete
- evidence: The reader now probes one row past `CHILD_LIMIT` in the same SQLite snapshot and publishes `partial` with a reason when overflow exists. The roster therefore becomes incomplete even when no surviving subtask part exposes the omitted child.
- impact: The original false-complete outcome is removed.
- suggestedFix: None for completeness signaling. B8 records the separate declared-count obligation that remains unmet.
- status: fixed
- triage: Accepted in round 1; verified fixed for the original completeness claim. Count accuracy is tracked separately as B8 because it has a different remaining mechanism and impact.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/delegations.ts:34
- title: Plain delegation task descriptions are discarded
- evidence: Plain `subagent` items now map `title ?? prompt`, preserving the producer-shaped unmatched task label before the renderer falls back to the role name. Tests cover prompt-only and no-label items.
- impact: Thin-evidence delegations now display the recorded task rather than only the agent role.
- suggestedFix: None.
- status: fixed
- triage: Accepted in round 1; verified fixed at mapper and producer-shaped test boundaries.

## Current findings

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/opencodeReader.ts:583
- title: Greedy agent fallback steals a later delegation's exact child
- evidence: Correlation processes subtasks in order and immediately falls back from description to the first same-agent child. With earlier `reviewer` subtask A having no child and later `reviewer` subtask B having an exact-title child, A consumes B's child through the agent fallback. B then emits as an unmatched plain step. A targeted `mapOpencodeRows` repro produced two B records — the plain `subagent` and B's `subagentSession` — and no A record. Existing tests exercise exact and fallback matching separately, not this mixed boundary.
- impact: The shared vault timeline and worktree roster lose one real delegation, duplicate another, and attach drill-down identity to the wrong invocation, violating the approved one-invocation/one-item contract.
- suggestedFix: Reserve all exact description/title matches one-for-one before applying ordered agent-only fallback to the remaining subtasks and stubs. Add a regression with an earlier unmatched same-agent subtask followed by a later exact-title child.
- status: accepted
- triage: Accepted. Reproduced by reading: the fallback is applied per subtask before any later subtask's exact match is considered, so an earlier same-agent subtask with no child of its own consumes a child that a later subtask matches exactly. Exact matches are evidence and the agent fallback is a guess, so the guess must never outrank evidence — global exact-first reservation, then ordered fallback over what remains. Within D6's accepted description-then-agent contract; this corrects the ORDER the two passes run in, not the keys.

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/opencodeReader.ts:789
- title: A failed child probe falsely reports confirmed source omission
- evidence: `childrenTruncated` is true whenever `childProbeRes.status !== "ok"`, even when `childRes.rows.length` is below `CHILD_LIMIT` and the retained query itself proves it was unsaturated. A targeted repro with zero child rows and only the probe failing returned `partial: true`, reason `not every delegated session was read`, and count 0. That contradicts the shared contract at `src/vault/types.ts:445-457`, where `partial` means source records were actually dropped and nothing else. It also differs from the message/part probes, whose failure rejects the read rather than inventing omission.
- impact: Root previews show a false data-loss warning. More materially, `PreviewController.ts:448-465` treats every partial nested detail as unusable, so a transient failed probe can discard an otherwise complete child transcript and replace it with the invocation fallback.
- suggestedFix: Treat an unsaturated child result as complete regardless of probe failure. For a saturated list whose probe fails, either fail the read like the other probes or introduce an explicit uncertainty outcome and update consumers; do not encode uncertainty as confirmed `partial` source omission.
- status: accepted
- triage: Accepted, and the unsaturated half is unambiguous: a child list shorter than CHILD_LIMIT proves its own completeness, so the probe's outcome is irrelevant there and must not be consulted at all. Verified the consumer impact independently — PreviewController.ts:449 gates nested detail usability on `partial !== true`, so a false positive discards a complete child transcript. For the saturated-plus-failed-probe case I take the chair's first option: fail the read, exactly as msgProbe and partProbe failures already do. That needs no new outcome kind and no design change, and it keeps the probe family consistent. The 1_3 precedent (a failed child QUERY reports partial) is not the same case: there the records really are absent from the result.

### B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/opencodeReader.ts:615
- title: Child overflow still declares the retained count as the source count
- evidence: A successful child probe row proves at least `CHILD_LIMIT + 1` direct children exist, but `stats.subagentCount` remains only retained child stubs plus unmatched retained subtasks. A targeted overflow repro handed over one child, set `partial: true`, and still declared count 1; at the real bound the same logic hands over 100 and declares 100 despite proof of at least 101. This contradicts `specs/vault-session-preview/spec.md:14-17`, which requires the declared count to exceed delegations handed over in this scenario.
- impact: The shared statistics contract publishes a known underestimate, the vault summary displays a false count, and the worktree's count-based incompleteness signal remains ineffective for this overflow path even though `partial` independently catches it.
- suggestedFix: When the successful probe finds overflow, raise the declared count to the source-supported lower bound, for example `Math.max(correlatedDelegations, CHILD_LIMIT + 1)`. Do not infer an extra count from probe failure. Assert both `partial` and `subagentCount > emittedDelegationItems` in the overflow test.
- status: accepted
- triage: Accepted — it violates the spec requirement this change itself added (specs/vault-session-preview/spec.md, 'A bounded read reports what its bound dropped'), whose scenario requires the declared count to exceed the delegations handed over. A confirmed overflow row proves at least CHILD_LIMIT + 1 children, so the lower bound is knowable and declaring the retained count states less than the read proved. The adjustment belongs to the reader, which knows the bound; mapOpencodeRows stays unaware of it. Raising the count preserves the property the original comment claimed — the declared count still exceeds what the timeline bound handed over.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.worktree.test.ts:350
- title: Revived editor routing has no expansion-request regression test
- evidence: The routing cases exercise sidebar, bottom panel, and an editor created through `TerminalEditorProvider.createPanel`; none constructs `TerminalPanelSerializer` or `TerminalEditorProvider.revive`. Current behavior is correct because revival constructs the same provider and executes the same switch, but the distinct serializer dependency-injection boundary is unpinned.
- impact: A future revival wiring or constructor-argument regression could silently reintroduce the round-1 inert-feature defect only after VS Code restores an editor panel.
- suggestedFix: Add a revived-editor case using `TerminalPanelSerializer.deserializeWebviewPanel` or `TerminalEditorProvider.revive` with the same host-delivery assertion.
- status: accepted
- triage: Accepted, and fixed rather than listed: it is one test case, and the serializer path is the one construction route this change never exercised. The chair is right that current behavior is correct by shared construction — this pins it so a future serializer wiring change cannot silently re-inert the feature after a window reload.

## Adjudication notes

- B6 and B8 were independently confirmed by chair, contracts, and logic reviews; targeted repros matched their evidence.
- B7 is chair-only. The frontend review considered the partial/truncated axes structurally separate but did not address the decisive failed-probe case: an unsaturated child list proves no bound omission, yet the reader still asserts records were dropped. The explicit shared contract and nested consumer behavior control.
- The frontend review confirmed current revived-editor behavior is correct through the shared constructor and switch; W2 is therefore a regression-coverage warning, not a functional block.
- No audit-backlog or accepted-risk entries apply.
