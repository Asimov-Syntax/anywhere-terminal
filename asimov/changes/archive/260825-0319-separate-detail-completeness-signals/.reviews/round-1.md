# Review Round 1

- Date: 2026-08-25
- Target: separate-detail-completeness-signals
- Scope: working tree
- Reviewable lines: 831
- Note: Large change — accuracy may decrease
- Agents spawned: 5 (`asm-review-contracts` ×2, `asm-review-logic`, `asm-review-data-security`, `asm-review-frontend`)
- Agents skipped: `asm-review-performance` (all changed reads remain structurally capped), `asm-review-reuse` (the diff reuses the existing finalizer and adds no duplicate capability)
- Verdict: BLOCK
- Counts: BLOCK 1 | WARN 2 | SUGGEST 0

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-data-security, asm-review-contracts
- file: src/vault/readers/opencodeReader.ts:736
- title: Exact fixed-window boundaries are incorrectly classified as partial
- evidence: The changed call now interprets `windowTruncated` as unrecoverable source omission. Its detector is also true for a complete source with exactly 2,100 messages: the 100-row head and 2,000-row tail are both full and disjoint while their union contains every row. Likewise, the de-duplicated part union reaches 5,000 for a complete source with exactly 5,000 parts, satisfying `partRows.length >= 5,000` without any omission. A boundary simulation confirms the predicates report truncation at 2,100/5,000 while retained rows equal total rows.
- impact: Complete OpenCode sessions at reachable exact row counts receive `partial: true` and a misleading permanent-omission notice, violating the new source-omission contract at the point this change strengthens the signal's meaning.
- suggestedFix: Make omission detection require proof of an additional source row, for example by fetching one extra row as a probe before trimming to the retained window, or by using a bounded per-session count. Apply the proof to both message and part windows, and set `partial` only when total rows strictly exceed the retained union.
- status: accepted
- triage: ACCEPTED. Verified independently against the source: DETAIL_MESSAGE_HEAD=100 / DETAIL_MESSAGE_TAIL=2000 mean a 2,100-message session returns rows 1-100 from the ASC window and rows 101-2,100 from the DESC window — both full, disjoint, union covering every row — while `messageWindowTruncated` reports true. `partRows.length >= DETAIL_PART_HEAD + DETAIL_PART_TAIL` is false-positive at exactly 5,000 parts by the same argument. The heuristic predates this change, but this change is what makes it a contract violation: the ADDED requirement "Source omission and pageability are distinct signals" says `partial` SHALL be set WHEN the read omitted source records, so a false positive now breaks a requirement this change itself introduced. proposal.md's Out of scope excludes RAISING a reader's fixed window, which this fix does not do. Not rebutted on scope.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-data-security
- file: src/vault/readers/opencodeReader.detail.test.ts:487
- title: The OpenCode regression test locks in the ambiguous boundary case
- evidence: The fixture returns exactly each query's `LIMIT` rows with disjoint IDs and no independent total count or sentinel row, then asserts the derived gap and `partial`. The gap is inserted from the same `messageWindowTruncated` predicate that creates `partial`, so it is circular evidence and cannot distinguish a genuinely omitted middle from an exactly full 2,100-message/5,000-part source.
- impact: The test passes for the production false positive and will resist correcting the detector, while claiming to prove the contract's unrecoverable-omission condition.
- suggestedFix: Add one fixture whose independently known total is exactly the combined window capacity and assert `partial` is absent, plus one whose total strictly exceeds capacity and assert `partial` is present. Update the mock to expose the count or extra-row probe used by production.
- status: accepted
- triage: ACCEPTED, and it lands on my own task instruction. tasks.md task 2_3 step 4 said to establish omission by row count or by the inserted gap rather than by non-overlap alone; I applied that to the test but left the production detector non-overlap-based, which makes the gap a product of the same predicate and the test's evidence circular. Follows B1: the fixture must carry an independently known total, with an exact-capacity case asserting no `partial` and a strictly-over-capacity case asserting `partial`.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts, chair
- file: asimov/changes/separate-detail-completeness-signals/build-state.json:87
- title: Verification state overclaims proof of OpenCode source omission
- evidence: The recorded `testChange.reason` says the gap plus `partial`/`limitedReason` proves omission “never by window non-overlap alone,” but all three outputs derive from the same disjoint-window predicate and the fixture supplies no evidence of any row outside the retained windows. `bun run asm change verify-status separate-detail-completeness-signals` repeats this inaccurate rationale.
- impact: Later review and implementation gates can treat task 2_3 as having proved actual source omission when it only proved the implementation's heuristic, contradicting the task's stated evidence requirement.
- suggestedFix: After fixing the detector and boundary tests, rerun the task verification/test-change declaration so `build-state.json` describes the independent count/probe evidence. If no such evidence is added, revise the reason to avoid claiming omission was proved.
- status: accepted
- triage: ACCEPTED. The wording is mine and it overclaims: my --test-change declaration for 2_3 said omission is "proven by the inserted gap item ... never by window non-overlap alone", but the gap is inserted from `messageWindowTruncated`, which IS the non-overlap predicate. Re-declare after B1/W1 land so build-state.json records the independent evidence rather than the heuristic restated.
