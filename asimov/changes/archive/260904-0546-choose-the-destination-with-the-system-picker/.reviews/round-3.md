# Review round 3 — choose-the-destination-with-the-system-picker

- Date: 2026-09-04
- Cycle: 2
- Mode: discovery
- Arbiter: yes
- Lane: fastlane
- Escalation flags: new-api-contract, security-privacy, cross-boundary
- Head reviewed: `59cef008cf9064fd314ff30ba0e628e1a6273a92`
- Diff scope: exact commits `71b53ca1 9657d6e9 e4e6033e 2d547f39 fa0a215d a151d3c6 a5acbecd 67d48740 b70c5108 9bb3eca0 1b2301be b8f9eede 59cef008`; unrelated interleaved commits were excluded
- Tree: dirty only in this change's `analytics.json` after `round-start`; the explicit committed scope was reviewed
- Reviewable lines: 1,308 added/modified across reviewable files, including 595 analytics lines and 713 production-source lines; 970 changed test lines were reviewed inline
- Note: Large change — accuracy may decrease
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 2 open BLOCK · 0 open WARN · 0 SUGGEST; F002, F003, and F004 fixed
- Split over gating blockers: 2 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | picker host, prepared-root consent, probe publication | filesystem authority and fail-closed behavior | `opus[1M]` |
| asm-review-logic | picker/probe continuations and form transitions | async interleavings, replay, state | `gpt-5.6-terra[1M]` |
| asm-review-frontend | controller/dialog picker binding | UI state, stale answers, accessibility | `sonnet[1M]` |
| asm-review-contracts | messages, ingress, router/controller handoff | wire and identity contracts | `gpt-5.6-terra[1M]` |
| chair | full exact-commit scope | all lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-performance` — the change adds no growing collection, scan, recomputation loop, or hot-path accumulation. `asm-review-reuse` — it reuses `PreparedRoot`, the existing destination resolver, and the existing message/router seams; no duplicate repository capability was introduced. Changed tests were reviewed inline; no `.only` or `.skip` was added.

Verify-gate evidence is the recorded `bun run asm change verify-status choose-the-destination-with-the-system-picker`: all seven tasks are `[x]` with exit 0; workflow.md records 7,696/7,696, clean type checking, and green bundle/I10 gates. The chair ran no project verify command or test suite.

---

## Findings

### [F001] Same-token replay can still transfer probe publication into a replacement Opening

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic + asm-review-data-security
- Class: feature
- File: `src/providers/WorktreeHost.ts:2173-2189,2878-2891`
- Status: accepted
- Triage: persists from round 1. Commit `9bb3eca0` closes the picker-write window and every probe window after the first `stillOurs()` call, but the exact Opening is not anchored until after `vettedOverride()` has already awaited.
- Author status: accepted
- Author triage: Accepted and reproduced. `answerCreateProbe` awaits `vettedOverride(msg.candidatePath, repo)` before its first `stillOurs()` call, so `anchored` binds to whatever the map holds AFTER that await, not to the opening the dispatch admitted at `WorktreeHost.ts:2878`. The dispatch already looks the opening up — it must, to set `latestSeq` before the await — and simply does not hand it on. The remedy is to anchor the admitted object at entry rather than on first use; no `D#` moves and no new invariant owner appears, so this is remediation.

**Invariant.** Any asynchronous continuation admitted by one `Opening` and later reading or writing opening-scoped authority must prove that the exact admitting object survived. `(surface, repoId, token)` is insufficient because a same-token refs replay replaces the object.

**Boundary inventory.** Still affected: probe admission → typed-override vetting; post-vetting root selection; response publication; `debrisCandidate` and `publishedRepair` writes. Fixed/safe: picker admission and recording now capture the exact object before either await; a replay after the probe's first anchor is rejected; close, new-token supersession, detach, and disposal reject; a replay completed before a new probe starts yields a fresh opening and configured-root fallback.

**Evidence.** `handleAction` admits against Opening A, writes A's `latestSeq`, and starts `answerCreateProbe`. That function first executes `await vettedOverride(...)` and only then calls `stillOurs()`, whose `anchored ??= held` can therefore anchor replacement Opening B. With a typed candidate, vetting performs real `realpath`/`lstat` I/O, so a same-token `requestWorktreeRefs` replay can replace A during the await. B has the same token and reset `latestSeq`, passes the check, and receives the old continuation's resolution plus any debris/repair publication. The added mid-read test replays only after `settle()`, when the first anchor has already occurred, so it does not exercise this window.

**Impact.** The replay that is specified to replace and narrow the opening can still have replacement B repopulated by a probe admitted under retired A, including deletion-clearance and repair state. This is the same exact-object mechanism and invariant as round-1 F001; the chosen-root transfer leg is fixed, but the publication leg remains open.

**Suggested fix.** Pass the exact object already admitted at `WorktreeHost.ts:2878` into `answerCreateProbe`, or anchor `stillOurs()` synchronously before `vettedOverride()`. Require that object at every later checkpoint. Add a witness with a typed `candidatePath`, a suspended realpath during vetting, and a same-token refs replay before release.

---

### [F002] A predecessor dialog sends the successor opening's token

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:519-634,1427-1436`
- Status: fixed
- Triage: `createDialogDeps()` now snapshots `opening` at composition; both the picker request and answer binding carry it, and `handleDestinationPicked` requires both the live token and the bound opening. The pending-successor witness rejects a successor answer while the predecessor binding remains on screen.
- Evidence: a predecessor click now posts its captured token, and a successor-token answer cannot enter the predecessor callback. The rewritten `[2_2]` test retains the stale-token first half; its successor half binds the successor's own deps, while the two new `[3_2]` witnesses cover the actual pending window.
- Impact: closed.
- SuggestedFix: none — the round-1 witness closes.

---

### [F003] Concurrent picks can let an older confirmation overwrite the newer folder

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic
- Class: feature
- File: `src/providers/WorktreeHost.ts:2128-2160`
- Status: fixed
- Triage: `pickGeneration` advances when a dialog confirms and is checked beside exact object identity after root preparation.
- Evidence: an older confirmation whose `prepareResolvedRoot` finishes last no longer writes or posts; the new test suspends the older resolution and verifies the newer chosen root remains.
- Impact: closed.
- SuggestedFix: none — the round-1 witness closes.

---

### [F004] Entering a mode that withdraws the destination leaves the chosen-folder flag live

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:2659-2683`
- Status: fixed
- Triage: `syncDerived` now clears `usingChosen` beside `pathIsDerived` whenever `destRefused` withdraws the destination.
- Evidence: the new witness reads the emitted selection after adopt and after returning to a destination-bearing mode; the flag stays absent.
- Impact: closed. F005 is a different mechanism: an unversioned async picker completion, not this mode-withdrawal branch.
- SuggestedFix: none — the round-1 witness closes.

---

### [F005] The picker has no form-local transaction, so an old destination can be submitted or a late answer can overwrite newer intent

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic; repository instance corroborated by asm-review-frontend and asm-review-contracts
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1427-1438,2279-2307,2975-2981`; `src/webview/worktree/WorktreeController.ts:1427-1436`
- Status: accepted
- Triage: new in round 3. Opening identity and host picker ordering are now sound, but the form records neither an outstanding picker request nor the destination/repository state that request belongs to.
- Author status: accepted
- Author triage: Accepted, and it splits — which is why this round ends in a handback rather than a fix commit. The LATE-ANSWER half is remediation and the file already contains its pattern: six lines below the picker binding, `bindDefaults` discards an answer whose `repoId\0branch` no longer matches `defaultsAskedFor`. The picker binding takes no such key, and `handleDestinationPicked` checks the token and the bound opening but never `msg.repoId`, so a pick made in repository A and answered after a switch to B marks B chosen while the host's record sits on A's opening — B's probe then finds `chosenRoot: null` and falls back to its configured root in silence, which is the exact failure `stateDestination`'s `repoChanged` branch exists to prevent.
  The ARMED-CREATE half cannot be fixed as suggested. "Mark pending at click" needs a terminal outcome, and D3 states that cancel, failure and a dismissed form all produce no post at all — so a cancelled dialog would leave the form pending forever, which is precisely the trap D3 exists to prevent ("a form locked behind an OS dialog that never returns is a form the user cannot escape"). Implementing the suggestion as written would violate an accepted decision. The window is also not negligible: `prepareResolvedRoot` is one `realpath`, which on a network mount or a spun-down external drive takes seconds, and the user is free to press Create the moment the OS dialog closes.
  So the fix D3 forbids is the fix this needs: the host must answer a cancelled or failed pick too, and only a form that is GONE may be answered with nothing. That is a changed `D#` and a changed wire contract, which the design lifecycle's remediation boundary puts outside a fix loop. Parked and handed back to plan; F001's mechanical fix goes with it rather than landing alone and burning a round to supersede the cycle.

**Invariant.** A picker transaction must be pending from the Choose gesture until a terminal outcome, and a successful outcome may apply only if the same form-opening, repository, and destination-state generation still own it.

**Boundary inventory.** Affected: submit gating between picker confirmation and host root preparation; typing or clearing after confirmation; repository switches before the reply; the final answer callback. Verified safe: answers for another opening are rejected; concurrent successful picker confirmations are ordered host-side; adopt/reattach re-clear the flag when `syncDerived` runs; cancel/failure currently mutate nothing.

**Evidence.** The Choose click only posts `onPickDestination`; it does not set `outstanding`, invalidate `effective`, or change the ask key. `outstanding` starts only after a successful picker reply unconditionally calls `stateDestination({ kind: "chosen" })`. Once the OS dialog closes, `pickDestination` can still be suspended in `prepareResolvedRoot`, while the webview is interactive and Create remains armed for the previous path. The user can submit that old path before the reply. They can also type a newer override or switch repositories; the later reply carries no picker request id, the controller checks only opening identity, and the dialog discards `repoId` and unconditionally clears the newer state back to chosen. The test named "submits nothing while the chosen folder has no answer yet" calls `h.answer()` before submit, so it covers the later chosen-folder probe, not the click-to-picker-answer window it claims.

**Impact.** A user can confirm a folder and still create under the previous configured/typed destination, or can replace that choice and have the delayed picker completion restore it. A reply for repository A can mark repository B as using a chosen folder B never received, causing the exact silent configured-root fallback D6 says a repository switch must prevent. These schedules falsify the core chosen-destination outcome and the typed-replacement scenario.

**Suggested fix.** Give each picker request an identity tied to a form-local destination generation and return a terminal outcome that lets the form release pending state on choice, cancel, or failure. Mark the transaction pending at the gesture, block submission until it ends, invalidate it on typing/clear/repository switch/destination withdrawal, and apply success only when request id, opening, repository, and destination generation still match. This requires reconciling D3's current no-reply rule with task 2_2's pending-state acceptance; a token/repo check alone closes only one witness.

## Arbiter dispositions

- **F001 — accepted.** The deciding evidence is the real-I/O `vettedOverride` await before the first exact-object anchor. The round-1 invariant remains violated and the added witness begins after this window.
- **F005 — accepted.** The click path takes no pending state, the terminal answer has no request/state generation, and the success callback is unconditional. Both the old-path submit and newer-input overwrite directly falsify accepted picker obligations.

## Prior-claim adjudication

- F001's claimed shipped-panel reachability limit is correct: the shipped controller advances `refsToken` before its sole refs request. It is not a rebuttal because the host boundary explicitly assumes an untrusted replay, and the pre-anchor window remains.
- F002 is fixed. Leaving the sibling callbacks' pre-existing live-token behavior outside this remediation is acceptable; no new chosen-root authority transfers through them because a successor opening starts with `chosenRoot: null`.
- F003 is fixed for overlapping successful picks; cancellation, picker failure, root-resolution failure, retirement, and disposal write/post nothing.
- F004 is fixed in the mode-withdrawal branch. F005 is separately actionable because its cause is the missing async picker transaction.
- The `[2_2]` rewrite did not weaken the stale-opening claim: the stale first half remains, the successor is now bound through its own deps, and the two `[3_2]` cases carry the real predecessor/successor timing witness.

## Adjudication notes

- The data/security suggestion that picked-root collisions newly widen debris clearance was rejected: D1 and the proposal explicitly require the existing collision/occupancy behavior under the chosen root, while debris removal still requires its unchanged fingerprinted, explicit authorization.
- The suggestion that a configured-root defaults reply can enable Create before the chosen-root probe was refuted by `resolutionOutstanding`, which remains set until the matching probe resolution. A temporary pending display is non-gating and the final resolution wins.
- The wire union, inbound allowlist, literal-true validation, router case, delegated handler map, and typed-override field-presence precedence are complete.

## Full-flow trace

1. **Entry and identity:** the button posts repository plus a controller-snapshotted opening. The host validates primitive fields and captures the exact Opening before opening the OS dialog. F005 is the missing form-local request identity/pending state after that gesture.
2. **Consent and storage:** the host resolves the dialog answer once into a `PreparedRoot`, stores it only on the per-surface/per-repository Opening, and persists nothing. Exact picker object identity and confirmation ordering are sound.
3. **Probe:** the webview sends only `useChosenFolder: true`; the host selects only its own `chosenRoot`, while typed overrides retain configured-root containment. F001 remains before the first exact-object checkpoint during typed vetting.
4. **Fallback and errors:** cancel, picker throw, failed root preparation, close, new-token supersession, detach, and disposal post nothing. A missing record falls back to the configured root. Because cancel/failure are silent, the current protocol cannot both take pending state at click and release it on every terminal outcome — the design seam F005 must settle.
5. **Output and side effect:** after a settled probe, the host's `freePath` becomes the displayed and submitted path and reaches `git worktree add` unchanged. The serial assembly witness is sound. F005 permits submission before that chosen-folder settlement, and F001 permits a retired probe to publish into a replacement Opening.
