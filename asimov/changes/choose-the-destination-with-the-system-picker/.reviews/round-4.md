# Review round 4 — choose-the-destination-with-the-system-picker

- Date: 2026-09-04
- Cycle: 2
- Mode: verification
- Lane: fastlane
- Escalation flags: new-api-contract, security-privacy, cross-boundary
- Head reviewed: `3eb2c64cec1c6928e5fe159f6e60dfb5d6007cc1`
- Diff scope: exact commits `26a7540beaa67ec0bd31205e7fda215b66ee3c31`, `44b4944b37e7723a9e8404d1eb8bcf021a50cf3b`, `3eb2c64cec1c6928e5fe159f6e60dfb5d6007cc1`; no range was used and interleaved plan commit `a3a0295f` was excluded from the patch while its approved design context was read
- Tree: the checkout advanced beyond the reviewed head and gained concurrent uncommitted changes after specialist dispatch; all were excluded from this explicit committed scope
- Reviewable lines: 196 added/modified across reviewable files, including 168 production-source lines and 28 analytics lines; 289 changed test lines were reviewed inline
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 open BLOCK · 2 WARN · 0 SUGGEST; F001 fixed, F005 persists

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | probe anchoring and picker outcome races | async interleavings and state ownership | `opus[1M]` |
| asm-review-frontend | picker form transaction | UI state, submit gating, stale answers | `gpt-5.6-terra[1M]` |
| asm-review-contracts | picker ask and terminal-answer wire | contracts, validation, routing | `sonnet[1M]` |
| chair | F001/F005 impact cone | cross-file verification and adjudication | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-data-security` — the remediation adds no new authority source and the relevant exact-object/host-record checks are covered by the logic and contracts assignments. `asm-review-performance` and `asm-review-reuse` — no growth axis, hot recomputation, duplication, or extraction changed. Changed tests were reviewed inline; no `.only` or `.skip` was added.

Verify-gate evidence is the recorded `bun run asm change verify-status choose-the-destination-with-the-system-picker`: all ten tasks are `[x]` with exit 0; the caller records 7,704/7,704 tests, clean type checking, and green bundle/I10 gates. The chair ran no project verify command or test suite.

---

## Findings

### [F001] Same-token replay can still transfer probe publication into a replacement Opening

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic + asm-review-data-security
- Class: feature
- File: `src/providers/WorktreeHost.ts:2196-2228,2935`
- Status: fixed
- Triage: `answerCreateProbe` now receives the exact `Opening` the dispatch admitted and seeds `anchored` from it before `vettedOverride` can await. `stillOurs()` keeps the live map lookup, sequence test, and object equality, so the change only rejects the replacement previously anchored after the first await.
- Evidence: the typed-candidate witness suspends inside vetting, lands a same-token refs replay, then resumes and receives no publication. Every later boundary — chosen-root derivation, refs read, corroboration, base resolution, debris/repair writes, and post — remains behind the same exact-object check.
- Impact: closed.
- SuggestedFix: none — the round-3 witness closes at every inventoried boundary.

---

### [F005] The single picker slot loses an earlier confirmed pick when a newer picker ends without a folder

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1465-1471,3014-3028`; `src/providers/WorktreeHost.ts:2166-2193`
- Status: accepted
- Triage: persists from round 3 through a narrower overlapping-pick boundary. The new ask and gate close the original single-pick submit/overwrite witnesses, but the form holds only one outstanding ask while the host keeps an older confirmed pick live when a newer picker cancels.

**Invariant.** A terminal answer may release only the picker transaction it answers, and ending a newer picker without a folder must leave the destination and create ability as they were immediately before that picker opened.

**Boundary inventory.** Still affected: pick A confirmed and suspended in root resolution → pick B opened → B cancelled/threw → A completes. Fixed/safe: a single click immediately gates Create; unrelated probe answers cannot clear the gate; typing, clearing, and repository switching withdraw the current ask; a newer successful confirmation wins; stale opening and stale ask answers are dropped.

**Evidence.** Pick A sets `pickAsked = 1`; after its native dialog confirms, the host can remain suspended in `prepareResolvedRoot`. Choose stays enabled, so pick B overwrites the only slot with `pickAsked = 2`. B's no-path terminal answer matches, clears the slot, and re-enables Create at the pre-A destination. The host does not advance `pickGeneration` for B's cancel/empty result, so A is still its latest confirmed pick, records `chosenRoot`, and posts ask 1. The form now has `pickAsked === null` and discards A's success. No changed test exercises this composition.

**Impact.** A user-confirmed folder is lost and the form offers creation at the old destination after cancelling a later picker. This contradicts the amended spec's dismissal rule that destination and ability return to what they were before B — before B, the form was still withheld on confirmed A — and keeps F005's old-path outcome reachable.

**Suggested fix.** Align host and form supersession. Either prevent another picker while `pickAsked` is live, retain/restore earlier unresolved asks when a newer one ends without a folder, or explicitly supersede A at both layers when B opens so A can neither record nor answer. Add the deterministic A-confirmed/suspended → B-cancel → A-success witness.

---

### [F006] The approved repository-switch late-answer witness is missing

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-contracts
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts:5637-5722`
- Status: accepted
- Triage: the production branch is correct by inspection, but design.md's ledger and task 4_3 name three late-answer witnesses and only typed and cleared were added.
- Evidence: the existing repository-switch test applies the picker answer before switching, so it exercises withdrawal of an already-applied `usingChosen`, not `pickAsked` being cleared before a late answer. No `[4_3]` test performs pick → switch repository → old answer.
- Impact: the exact cross-repository silent-fallback defeater recorded in D7 has no regression tripwire.
- SuggestedFix: add a late-answer-after-repository-switch witness and assert the new repository emits no `useChosenFolder` flag.

---

### [F007] Retiring an Opening can leave its still-visible form waiting on a picker that never opens

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `src/providers/WorktreeHost.ts:2124-2127,2139-2141`; `src/webview/worktree/WorktreeController.ts:1427-1436`
- Status: accepted
- Triage: new within F005's liveness cone. D3 distinguishes a gone form from a moved host record, but `pickDestination` treats missing Opening state as proof that nobody is waiting.
- Evidence: during the already-established pending-successor window, `refsToken` and host Openings have advanced while the predecessor dialog can remain visible until all successor defaults arrive. Its captured picker callback sets `pickAsked` and posts the retired token; the host returns before defining `release`, and any response carrying that token would be dropped by the controller's current-token gate. A departed repository can similarly lose its Opening while its form remains visible.
- Impact: Create remains withheld on that form until another destination transition or form replacement. Usually bounded by the successor opening, but unbounded if an expected defaults answer never arrives.
- SuggestedFix: make opening retirement explicitly withdraw the predecessor form's picker gate, or otherwise distinguish a still-rendered form from a truly gone one. Correct the stale comment that equates a missing Opening with nobody waiting.

## Adjudication notes

- F001 is fixed at the invariant level, not merely at the cited line.
- The original F005 witnesses are fixed: Create is gated synchronously on a single pick, unrelated resolution answers do not release it, and typed/cleared/repository-switched state rejects a stale ask.
- F005 remains BLOCK by severity stability and concrete impact. Multiple picker requests are reachable after a confirmed dialog closes while root resolution remains pending; round-1 F003 already established that overlap as supported behavior.
- The declared `showOpenDialog`-never-settles residual does not alter F001 or F005's repository-controlled witnesses and is not reported as a new finding.
- The exact scope is remediation-only. The unrelated analytics row in `26a7540b` is task metadata, not a new capability or invariant owner, so the verification scope lock did not trip.

## Impact-cone trace

1. **F001:** dispatch admission → typed override vetting → exact-object check → derivation/read/corroboration/base → synchronous publication. The admitted object now survives every boundary.
2. **F005 single pick:** click mints ask and gates Create → host returns success/no-path for every live-opening arm → controller enforces opening → dialog enforces ask → success starts chosen-root probe, no-path restores prior state.
3. **F005 overlapping picks:** the form replaces its sole ask at B's click, while host confirmation ordering leaves A current when B cancels. B releases the sole gate and A is then discarded, producing the remaining blocker.
