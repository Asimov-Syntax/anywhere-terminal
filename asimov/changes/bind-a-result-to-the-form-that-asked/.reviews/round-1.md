# Review round 1

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Scope: range `eb792a5c~1..HEAD`
- Head: `dd3f1db0219c8ad3467eef7eebf0247640a783ef`
- Tree: dirty only from review accounting (`analytics.json`) when reviewed; production scope was the committed range
- Reviewable lines: 195
- Agents spawned:
  - `asm-review-logic` — host opening lifecycle and async guards — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — IPC opening contract and routing — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — form token, reply, and closure lifecycle — `sonnet[1M]`
  - `asm-review-performance` — per-surface state bounds and dedup — `gpt-5.6-luna[1M]`
  - `asm-review-data-security` — untrusted opening authority — `gpt-5.6-luna[1M]`
- Agents skipped: `asm-review-reuse` — no helper/parser/extraction or mirrored implementation was introduced
- Verdict: REJECT
- Counts: 6 BLOCK, 0 WARN, 0 SUGGEST
- Split: 6 feature / 0 machinery gating blockers

## Findings

### B1

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-logic, asm-review-contracts, asm-review-data-security
- Class: feature
- File: `src/providers/WorktreeHost.ts:1788`
- Title: A replayed retired or older opening is adopted as live again
- Evidence: Every branch-less defaults request unconditionally executes `liveOpening.set(key, msg.opening)`. Closing deletes the entry at line 1735 instead of preserving a retirement high-water mark. Therefore replaying the same branch-less request after close re-establishes the retired opening, and a delayed request for opening N arriving after N+1 moves the surface backward to N. The changed tests replay only a branch-bearing follow-up, which takes the guarded arm and cannot expose this path.
- Impact: A retired form can start reads and receive defaults/offers again; an older replay can silently replace the opening the user is currently viewing, causing the live form's later answers to be dropped. This violates D2 and the scenario requiring no answer for a never-live or retired opening.
- SuggestedFix: Keep per-surface monotonic opening history/tombstone separately from liveness. Accept a safe new token only when it advances the high-water mark, accept equality only as a duplicate of the currently live opening, and reject retired/older tokens. Add witnesses for branch-less replay after close and out-of-order N after N+1.
- Status: accepted
- Triage: Reproduced before accepting. Fixed: a per-surface `openingHighWater` beside `liveOpening` —
  an opening ask may REPEAT the one being served or ADVANCE past everything the surface has ever
  named, and nothing else. Two witnesses (replay after close; a delayed 4 arriving after 5), both
  mutation-verified. Remediation: the spec scenario "a request naming an opening that was never
  live or has been retired -> the extension answers nothing" already required this; the high-water
  mark is a mechanism choice inside it, not a new invariant.
- Invariant inventory: opening identity may advance or repeat while live, never move backward or revive after retirement. Affected boundaries: branch-less replay after close, delayed predecessor after supersession. Verified safe in this diff: branch-bearing requests with an unheld token and mismatched close messages.

### B2

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-logic
- Class: feature
- File: `src/providers/WorktreeHost.ts:1735`
- Title: Close retires only provisioning state, not the opening's existing refs/probe/debris authority
- Evidence: `worktreeCreateClosed` deletes `liveOpening`, matching `provisionReading`, and offers, but leaves the per-surface+repo `openings` map intact. That map remains the authority checked by `worktreeCreateProbe` and `worktreeAuthorizeDebris` at lines 1684 and 1710. A candidate published before cancel can therefore still pass `openingFor(...)` and issue a debris authorization after cancel. In-flight refs and pull-request continuations at lines 1880-1953 also post without rechecking retirement, and a replayed `requestWorktreeRefs` can recreate the per-repo opening after close.
- Impact: The advertised single opening identity is not actually retired across all requests it already owns. A cancelled form can continue publishing discovery replies and, critically, can still mint deletion authority, contradicting the accepted requirement that a retired opening publish nothing, mint no authority, and leave no state.
- SuggestedFix: Make retirement one cross-channel operation: remove every per-repo `openings` entry for the surface/opening, guard `requestWorktreeRefs` and all refs/forge continuations on the live opening, and ensure probe/debris continuations recheck the same retired state. Add cancel witnesses for refs, probe, and debris authorization, not only provisioning.
- Status: parked — artifact handback
- Triage: Accepted as a real defect, NOT fixed. This one fails the remediation boundary test. D5 as
  accepted scopes retirement to the provisioning offer and says "§ 2.4's existing rule covers the
  rest"; withdrawing the per-repository `openings` records makes retirement cross-channel and
  hands it the probe and DEBRIS AUTHORIZATION boundary — the named carve-out of this project's
  "never delete files directly" invariant. That is a changed D# and a new invariant owner, so it
  belongs to `asimov-plan`, not to a fix commit. Parked with B4 and B6's second half.
- Invariant inventory: retirement withdraws every authority carried by the one opening token. Affected boundaries: refs read/publish, pull-request read/publish, probe state, debris authorization, replay. Verified safe in this diff: provisioning read publication and offer-store eviction.

### B3

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-contracts, asm-review-data-security, chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:1788`
- Title: The untrusted IPC boundary never validates `opening` before adopting or echoing it
- Evidence: Both providers accept `unknown`, validate only an object with a string `type`, cast to `WebViewToExtensionMessage`, and route by discriminator membership. The new defaults handler then writes `msg.opening` into `Map<string, number>` and echoes it without a runtime check; close compares it before any check as well. Missing, string, `NaN`, or infinite values therefore cross the boundary despite the accepted failure-surface requirement that absent and non-number openings fail closed.
- Impact: Malformed webview traffic can create invalid live state, start provisioning reads, publish malformed replies, or interact unpredictably with close/replay guards. TypeScript's required field does not protect this runtime authority boundary.
- SuggestedFix: Before repo lookup, map writes, reads, replies, or eviction, require the opening to be the panel's valid token shape, preferably `Number.isSafeInteger(opening)` with the accepted positive range. Apply the same validation to `worktreeCreateClosed` and add direct boundary tests for absent, string, `NaN`, and infinity.
- Status: accepted
- Triage: Reproduced before accepting: `isWorktreeMessage` is `WORKTREE_MESSAGE_TYPES.includes(msg.type)`
  and nothing more. Fixed: `namedOpening` (positive safe integer) runs before the repository read
  and before the destination is resolved. Witness covers undefined, "1", NaN, Infinity, 1.5, -1
  and 0; mutation-verified. The assembly fixture that had never named an opening at all is direct
  evidence this was reachable — it passed only because absent compared equal to unheld, and the
  guard broke it. Corrected to name one, with a comment recording why.
  The same check on `worktreeCreateClosed` is DEFENSIVE and unwitnessed: a live opening is always a
  positive integer, so the equality comparison already refuses every malformed value. Recorded in
  the code rather than covered by a test that could not fail.
- Invariant inventory: only a well-formed panel token may acquire or revoke opening authority. Affected boundaries: defaults request adoption/reply, close comparison/eviction. Verified safe: none for malformed opening payloads.

### B4

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-performance, chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:1800`
- Title: A duplicate delivered after completion starts a second read for the same opening
- Evidence: Duplicate detection consults only `provisionReading`. The `finally` block deletes that slot after the first read settles. A later duplicate for the still-live opening therefore sees `joins === false` and calls `readProvisioning` again. The new test sends both copies before `settle()`, so it proves only concurrent joining, not the requirement's unqualified one-read-per-opening rule.
- Impact: Replayed messages can grow provider reads and rotate offers per message after completion, violating D4 and the accepted scenario that duplicate delivery runs exactly one read.
- SuggestedFix: Retain a completed/read-issued marker tied to the live opening (or consult an opening-bound current offer) until supersession or close. Add a test that settles the first read, then repeats the same opening request and asserts the read count remains one while the destination reply is still sent.
- Status: parked — artifact handback
- Triage: Accepted as a real defect, NOT fixed. Retaining a completed marker until close or supersession
  raises a question D4 does not answer: whether a FAILED read may be retried within the same
  opening. Keeping the marker forbids the retry; clearing it on failure reopens the duplicate path
  the marker exists to close. That is a design fork, not a mechanism choice. Parked with B2.
- Invariant inventory: provisioning work is bounded to one read per opening, not one in-flight read per opening. Affected boundary: duplicate after completion. Verified safe: duplicates arriving while the original read is still in flight.

### B5

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-performance, chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:2633`
- Title: Detached surfaces remain forever in the new `liveOpening` map
- Evidence: The diff adds `liveOpening`, keyed by the stable string returned from `surfaceKey`. `attach(...).dispose()` removes offers and per-repository `openings`, but never deletes `liveOpening`; host disposal also does not clear it. The growth axis is therefore every surface ever attached during one host lifetime, not currently attached surfaces.
- Impact: Recreating sidebar, panel, or editor webviews monotonically retains one host entry per historical surface. There is no structural cap, and the map contradicts the claimed per-live-surface ownership lifecycle.
- SuggestedFix: Centralize per-surface retirement and call it from both `worktreeCreateClosed` and attachment disposal, deleting `liveOpening` and any matching `provisionReading` entries; clear the maps on host disposal as well. Add an attachment-dispose witness.
- Status: accepted
- Triage: Reproduced before accepting. Fixed by centralizing: one `retireOpening(key)` serving close,
  supersede and detach, plus `forgetSurfaceOpenings` which additionally drops the high-water
  history — only detach may do that. Witness required exposing the surface's `attachment` from the
  test harness: detach and HOST dispose are different lifecycles and only the host's had a handle,
  which is how this path came to have no coverage at all. Mutation-verified.
- Invariant inventory: per-surface state is bounded by attached surfaces and repositories, never all historical surfaces. Affected boundary: attachment detach and host dispose. Verified safe: explicit form close removes the live-opening entry.

### B6

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-frontend, asm-review-data-security
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:542`
- Title: The panel never marks the closed opening non-live
- Evidence: `onCreateClosed` posts `this.refsToken` but leaves that value as the controller's live-token predicate. `handleProvisionOffer`, `handleCreateDefaults`, `handleRefs`, resolution, and debris handlers continue accepting replies carrying the just-retired token. Thus a reply already posted by the host before it processes close, but delivered to the webview afterward, is cached/applied against a disposed form. Reading the mutable controller field at close also fails to bind the callback to the dialog's captured opening if another open is initiated before the older dialog exits.
- Impact: Cancel and submit do not satisfy the accepted scenario that a later reply naming the retired opening changes nothing; retired answers can still mutate controller caches, and an overlapping open can send retirement for the successor instead of the form that closed, silently dropping that live form's answers.
- SuggestedFix: Represent panel liveness explicitly. Capture the opening in the dialog seed/callback, post close with that captured value, then mark it non-live (or advance an invalidation generation) so every reply guard rejects it. Add tests for a reply delivered after cancel/submit and for an older dialog closing after a successor opening has been initiated.
- Status: accepted in part
- Triage: Split, because the chair's two halves have different obligations.
  FIXED — the identity half: the view captures the opening as the form opens and hands that value
  back at close, so no exit resolves `refsToken` at callback time. The view also now retires on the
  disposal path (`this.closeDialog?.()`), which the dialog's raw `disposeAll` never reached — a
  create form superseded by any other dialog previously left its opening live forever, which is the
  case D3 says matters most. Idempotent against the cancel/submit exits.
  PARKED — the "mark it non-live" half: `refsToken` is also the guard for refs, resolutions, probes
  and debris, so invalidating it withdraws those channels' authority. That is B2's decision in the
  panel. I implemented it, watched it break an existing test that deliberately asserts a refs reply
  IS still stored after a dialog closes, and reverted it rather than changing accepted behaviour
  inside a fix round.
- Invariant inventory: reply acceptance and retirement use the immutable identity of the actual live dialog. Affected boundaries: cancel, submit, queued replies, overlapping replacement. Verified safe: ordinary close without an intervening token change posts the expected number.

## Adjudication notes

- Recorded build verification is green for tasks 1_1 through 3_2; the review ran no project verify command.
- The deliberate in-flight duplicate join is preserved; B4 concerns only a duplicate delivered after the completed marker was deleted.
- The known lack of a current `offers.lookup` redeemer was not reported. B2 is about the already-live refs/probe/debris authority and async publications that retirement leaves behind.
- Performance suggestions to cancel all never-settling provider reads were rejected as outside D4's accepted one-read-per-opening bound and substantially pre-existing. The global close scan was not kept separately; once historical-state leaks are fixed, its collection is structurally bounded by live surface/repository state.

## Author triage — summary

Reproduced every finding against the code before accepting it; none were rejected.

Fixed this round: B1, B3, B5, B6 (identity half), plus one finding the chair's report does not
carry — `asm-review-logic` reported directly that a provisioning read for repository A can still
publish after an opening supersedes it through repository B, and that is not in the B-list above.
Verified reachable (`openCreateForRepo` posts one defaults ask per target repository, so one
opening routinely owns several read slots) and fixed: the supersede path sweeps every slot under
the surface, and the read continuation re-checks the surface's live opening. Either half alone
refuses the publish, so only mutating both is caught — stated in the code rather than left to look
like a redundant guard nobody checked.

Parked for `asimov-plan`: B2, B4, and B6's second half. All three are the same shape — they need a
changed D5 or an unanswered D4 question, and B2 additionally hands retirement the debris
authorization boundary. Landing any of them as a fix commit would close this cycle as superseded.

Cycle 1 therefore cannot reach 0 gating blockers by remediation alone. Not a thrash stop: this is
round 1, no fix has been attempted twice, and no finding was reintroduced.
