# Review round 1 — choose-the-destination-with-the-system-picker

- Date: 2026-09-04
- Cycle: 1
- Mode: discovery
- Lane: fastlane
- Escalation flags: new-api-contract, security-privacy, cross-boundary
- Head reviewed: `dc96853c57ab350e905730b9c1d047ef39019e6f` (the explicit committed range was captured from a clean checkout at Phase 0; unrelated uncommitted changes appeared concurrently after specialist work and were excluded)
- Diff scope: `git diff 7abcebf7..dc96853c57ab350e905730b9c1d047ef39019e6f`
- Reviewable lines: 1,334 added/modified across reviewable files, including Asimov analytics/build metadata and 689 production-source lines; 1,280 changed test lines reviewed inline
- Note: Large change — accuracy may decrease
- Verdict: **REJECT**
- Counts: 3 BLOCK · 1 WARN · 0 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | picker host, prepared-root consent, probe I/O | filesystem authority and fail-closed behavior | `gpt-5.6-sol[1M]` |
| asm-review-logic | picker continuations and Opening lifetime | async interleavings, replay, state | `gpt-5.6-terra[1M]` |
| asm-review-contracts | messages, ingress validation, router/controller handoff | wire and API contracts | `sonnet[1M]` |
| asm-review-frontend | dialog/controller destination transitions | UI state, events, stale answers | `gpt-5.6-terra[1M]` |
| asm-review-performance | workspace declaration scans in the requested range | growth axes and bounded I/O | `gpt-5.6-luna[1M]` |
| asm-review-data-security | workspace manifest code in the requested range | containment and manifest trust | `gpt-5.6-luna[1M]` |
| chair | full committed range | all lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-reuse` — the picker reuses `PreparedRoot`, the existing destination resolver, and the existing message/router patterns; no new helper mirrored a visible repository capability. The changed support tests were reviewed inline.

Verify-gate evidence is the recorded `bun run asm change verify-status choose-the-destination-with-the-system-picker`: tasks `1_1` through `2_3` are `[x]` with exit 0, and workflow.md records 7,690/7,690, clean type checking, and green bundle/I10 gates. The chair ran no project verify command or test suite.

---

## Findings

### [F001] Same-token replay can transfer or republish retired chosen-root authority

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/providers/WorktreeHost.ts:2101-2132,2145-2182,2251-2296,3463-3475`
- Status: accepted
- Triage: `requestWorktreeRefs` replaces the `Opening` object even when the token is unchanged. Both new picker continuations rely on token lookup rather than exact object identity across awaits, so the sequential replay witness at `WorktreeHost.actions.test.ts:7620-7635` does not exercise the defeating overlap.
- Author status: accepted
- Author triage: Accepted, with the reachability recorded rather than used as a rebuttal. The shipped producer never re-issues a held token — `openCreateForRepo` does `refsToken += 1` (`WorktreeController.ts:984`) before the only `requestWorktreeRefs` post (`:1007`), `onCreateClosed` only advances the counter, and openings are keyed per surface, so a same-token replacement cannot arise from the panel. That makes the finding unreachable today but leaves the host's own predicate wrong, and this change carries the `security-privacy` flag on a consent record. Fixed at every boundary the inventory lists: `pickDestination` captures the `Opening` before opening the dialog and requires `openingFor(...) === captured` after both awaits, and `answerCreateProbe`'s `stillOurs()` captures on its first call and requires object identity on every later one, which covers chosen-root derivation, publication, and the `debrisCandidate`/`publishedRepair` writes in one predicate.

**Invariant.** Any asynchronous continuation that reads or writes one `Opening`'s authority must prove that the exact `Opening` object survived; `(surface, repoId, token)` is insufficient because a same-token refs replay replaces that object by design.

**Boundary inventory.** Affected: picker admission/recording; chosen-root probe derivation; response publication; `debrisCandidate` and `publishedRepair` written at publication. Verified safe: close, new-token supersession, detach, and host disposal remove or mismatch the lookup; a replay completed before a probe starts falls back to the configured root; typed-override field-presence precedence remains correct.

**Evidence.** `pickDestination` opens the dialog without first capturing a live `Opening`, then after `pick()` and `prepareResolvedRoot()` calls `openingFor(...)` and writes whichever same-token object is present. An unowned request can therefore gain an opening while suspended, or a request from Opening A can write into replay-created Opening B. Separately, `answerCreateProbe` computes `freePath` and `occupiedCandidate` from captured Opening A, awaits `opening.read` and potentially corroboration/base resolution, then `stillOurs()` accepts replay-created B because B has the same token and its reset `latestSeq` passes. Publication then writes A's candidate/repair state into B and posts A's outside-root result.

**Impact.** The accepted claim that replay only narrows is false. An untrusted same-token replay can move a host-chosen folder into a replacement opening, or can receive a destination and deletion/repair publication derived from authority that replacement no longer holds. That falsifies the consent-lifetime and record-loss ledger rows.

**Suggested fix.** Capture the exact current `Opening` before starting a picker and reject the request if none exists; after every await, require `openingFor(...) === captured`. Apply the same object-identity rule to probe publication, or defer destination derivation until after the awaited read and then derive/publish from one freshly proven exact object without another await. Add overlap witnesses for replay during picker resolution and replay after probe derivation but before publication, including the debris-candidate state.

---

### [F002] A predecessor dialog sends the successor opening's token

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:507-543,608-610,943-1007`
- Status: accepted
- Triage: The plan attack explicitly required the opening to be snapshotted when the dialog dependencies are constructed. The added controller test invokes the callback only while `refsToken` is unchanged, so it cannot fail when the callback reads a successor token.
- Author status: accepted
- Author triage: Accepted. Reproduced: `createDialogDeps()` is a per-dialog factory, but every callback in it reads the mutable `this.refsToken` at event time, and `openCreateForRepo` advances that counter before the successor dialog renders while the predecessor stays interactive. The codebase already fixed this exact class once — `onCreateClosed` takes the opening from the view because reading `refsToken` there 'named the SUCCESSOR' (round-1 B3, `WorktreeController.ts:670-676`) — so the picker reintroduced a hazard the panel had already retired. Fixed by snapshotting the opening at factory time for the picker request and binding the answer to that same snapshot, so a superseded form's answer cannot reach the successor's `applyDestinationPicked` either. The pre-existing callbacks that read `this.refsToken` are left alone: they are outside this change's diff and its lease.

**Invariant.** A form-originated authority request must carry the immutable opening that composed that form, never the controller's mutable current opening at event time.

**Boundary inventory.** Affected: the new picker request. Verified safe: host keying still includes surface and repository; host-to-webview answers with an older token are dropped; normal-path picker requests carry the expected token while no successor is pending. The answer's repository is not checked by `handleDestinationPicked`, but host-side repository keying prevents that alone from deriving under another repository's chosen root.

**Evidence.** `openCreateForRepo` increments `this.refsToken` and sends the successor defaults/refs requests before the successor dialog opens. The predecessor remains interactive until those defaults complete and `WorktreeView.beginDialog()` closes it. Its new `onPickDestination` callback reads `this.refsToken` when clicked, so during that window it posts the successor token. The host already has a successor `Opening` under that token and records the predecessor's dialog result on it.

**Impact.** A folder chosen from one form can become chosen-root authority for a later form that did not open the picker, directly violating the per-form consent boundary and the approved D2/opening-snapshot decision.

**Suggested fix.** Snapshot `refsToken` inside `createDialogDeps()` and close every callback belonging to that dialog over the snapshot; use that immutable value for `worktreePickDestination`. Add a witness that starts a successor opening while the predecessor is still visible, clicks Choose on the predecessor, and proves no request or answer can acquire the successor token.

---

### [F003] Concurrent picks can let an older confirmation overwrite the newer folder

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic
- Class: feature
- File: `src/providers/WorktreeHost.ts:2101-2132,2815-2823`
- Status: accepted
- Triage: Every picker request starts an independent detached continuation, while `Opening.chosenRoot` has no picker generation. No witness overlaps two confirmed picks whose root resolutions complete out of order.
- Author status: accepted
- Author triage: Accepted. Reachable: D3 deliberately leaves the form live while the OS dialog is up, so the Choose control is not disabled during a pick and two `worktreePickDestination` messages can each start an independent continuation. Fixed with the per-opening confirmation generation the finding names, advanced the moment a pick returns a non-empty answer and re-checked beside the captured `Opening` identity after `prepareResolvedRoot`.

**Evidence.** Pick A can return first and suspend in `prepareResolvedRoot(A)`. The form is no longer behind the OS dialog and the Choose control remains enabled, so pick B can return and resolve first, writing/posting B. When A's slower root resolution finishes, it unconditionally writes/posts A. The final record and final UI answer are therefore the older confirmed choice even though B was confirmed later.

**Impact.** A create can be displayed and submitted inside the wrong folder after the user makes a newer choice. This breaks the singular “last folder this host handed this form” decision and the end-to-end destination obligation.

**Suggested fix.** Track a per-Opening picker confirmation generation. Advance it immediately when each picker returns a non-empty confirmed answer, carry that generation across root preparation, and write/post only if both the exact Opening identity and generation remain current. Add an out-of-order-resolution witness.

---

### [F004] Entering a mode that withdraws the destination leaves the chosen-folder flag live

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1357-1389,2241-2250,2659-2677,3119-3140`
- Status: accepted
- Triage: The changed test checks only that the input and Choose button become disabled; it never inspects the selection after an adopt/reattach answer.
- Author status: accepted
- Author triage: Accepted. Confirmed asymmetric: the `destRefused` block sets `pathIsDerived = true`, which withdraws a typed override from `selection()` for good, but never clears `usingChosen`, so the flag survives the round trip out of adopt/reattach. Fixed by clearing it in the same withdrawal, and the witness now reads the emitted selection rather than only the disabled controls.

**Evidence.** `usingChosen` is cleared only by the `typed` and `repoChanged` branches of `stateDestination`. When a host resolution changes `draft.branchMode` to `adopt` or `reattach`, `syncDerived` marks only `pathIsDerived = true`; `selection()` still emits `useChosenFolder: true`. The old chosen state can therefore remain in the ask key and silently reappear when the form later returns to a destination-bearing mode, unlike a typed override, which the same transition permanently withdraws.

**Impact.** The form has two different meanings of “destination withdrawn”: typed state is retired, chosen state is merely hidden. A later branch/mode transition can reuse a folder after the UI disabled and replaced its destination, contradicting D6's single transition owner and making displayed state depend on hidden history.

**Suggested fix.** Route mode-driven destination withdrawal through `stateDestination` or explicitly clear `usingChosen` beside `pathIsDerived`. Extend the disabled-mode witness to assert the emitted selection and a round trip back to a fresh mode.

## Adjudication notes

- The contracts specialist found the wire union, allowlist, runtime flag validation, router, handler map, and ordinary opening-token checks complete.
- The target data/security specialist found the sequential configured-root, typed-override, and resolved-once witnesses sound, but F001's overlapping same-token replacement defeats their shared token-only assumption.
- A performance specialist reported full-array `readdir` materialization in `suggestProvisioning.ts`; the same Promise-backed `scanNames(deps.readdir(...))` behavior exists at the base of this explicit range, so it is unchanged code and was dropped under the review rule.
- A data/security specialist reported manifest and workspace-enumeration TOCTOU patterns in the unrelated provisioning change included by the explicit range. Both underlying reopen-after-check behaviors predate this range and did not meet the unchanged-code critical-security exception, so they were not carried into this change's gate set.

## Obligation-ledger witness audit

1. **No unoffered folder derived under:** ordinary no-pick witness is non-vacuous, but F001 and F002 provide reachable ways for a replacement/successor form to acquire another opening's pick.
2. **Consent pinned to the folder seen:** the two-answer `realpath` witness is non-vacuous for one pick; F003 shows two picks have no ordering owner.
3. **Consent does not outlive its form:** sequential close/supersede/detach and cross-repository witnesses are non-vacuous; F001 and F002 defeat replacement/successor overlap.
4. **Losing the record only narrows:** the sequential replay witness is non-vacuous but incomplete; F001 falsifies the claim during suspended picker/probe continuations.
5. **Typed override boundary unchanged:** field-presence branching and the combined out-of-root candidate/flag witness are non-vacuous and pass by inspection.
6. **Create lands where shown:** the assembly witness walks the shipped path from system picker to `worktree add` and is non-vacuous for the serial path; F003 breaks the assumption that the serial answer is the latest choice.
7. **No chosen-folder persistence:** the pick path writes only in-memory `Opening` state and posts a reply; no configuration/workspace-state/storage writer is reachable.

## Full-flow trace

- **Entry and identity:** Choose calls dialog `onPickDestination`; F002 shows the callback reads mutable controller identity. The host request validates primitive fields, but F001 shows it does not require a live exact Opening before opening the dialog.
- **Consent and storage:** the host resolves the dialog answer once into `PreparedRoot` and stores only that resolution on `Opening`; stable single-pick behavior is sound. F001 breaks exact-object lifetime, and F003 breaks ordering between confirmed picks.
- **Probe hot path:** the webview sends only `useChosenFolder: true`; typed overrides retain resolved containment under the configured root. Host derivation and occupancy checks remain synchronous once the root is selected. F001 permits an old root/result to cross a same-token replacement during later awaits.
- **Fallback and errors:** cancel, picker failure, failed root preparation, close, new-token supersession, detach, and disposal post nothing. A missing chosen record falls back to the configured root. The same-token overlap is the uncovered fallback defect.
- **Output and side effect:** the resolution's `freePath` becomes the displayed input and submitted `draft.path`; the controller posts it unchanged and the existing create path passes it to `worktree add`. The serial assembly witness is sound, but F002/F003 can make the host answer belong to the wrong form or older choice before that path is submitted.
