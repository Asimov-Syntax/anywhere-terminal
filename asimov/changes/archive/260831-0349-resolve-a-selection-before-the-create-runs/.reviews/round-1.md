# Review Round 1

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Review lane: fastlane
- Scope: range `e2af6641~1..HEAD`
- Head: `6d55dc078b8bc786993085e5e8579d27c79913dd` (tree dirty after the reviewed range: `asimov/changes/resolve-a-selection-before-the-create-runs/analytics.json`)
- Reviewable lines: 834
- Large change: yes — accuracy may decrease
- Recorded Verify Gate: `bun run asm change verify-status resolve-a-selection-before-the-create-runs` reports tasks `1_1` through `4_1` exit 0; review ran no project verify command
- Agents spawned:
  - `asm-review-data-security` — reattach trust boundary — `gpt-5.6-sol[1M]`
  - `asm-review-frontend` — resolution UI state — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — wire and design contracts — `sonnet[1M]`
  - `asm-review-logic` — async resolution flow — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — duplicated create resolution — `gpt-5.6-luna[1M]`
  - `asm-review-performance` — probe growth paths — `gpt-5.6-luna[1M]`
- Agents skipped: none
- Verdict: REJECT
- Counts: 6 BLOCK, 7 WARN, 0 SUGGEST
- Split: 6 feature blockers, 0 machinery blockers

## Findings

### B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:477`
- Title: Reattach trusts the WebView instead of re-establishing the repair authorization
- Evidence: The serialized mutation accepts inbound `repairPath`, `branch`, and `expectedOid`, but uses only the path and client-returned OID. It verifies that the path is a directory and that its `HEAD` equals `mode.expectedOid`, then runs `git worktree repair`; `mode.branch` is never consulted. It does not freshly require a normalized prunable listing record on that branch, a `.git` file naming an administrative directory that still exists, or directory `HEAD ===` the current host-read `refs/heads/<branch>` OID. `request.path` is also ignored, so the mode can name another path. At the offer boundary, `readGitLink` treats every non-directory lstat result as a file, so a symlink can satisfy the nominal “.git FILE” check. Invariant inventory — required invariant: repair runs only while authoritative repository state still proves the exact prunable selected-branch registration, linked-worktree/admin identity, and current branch/HEAD identity. Boundaries searched: listing/classification, filesystem/ref corroboration, WebView round trip, queue entry, pre-repair reads, post-repair listing. Affected: `.git` file classification, WebView redemption, and pre-repair authorization. Verified safe: ordinary offer-time admin/head reads and the post-repair loss-of-`prunable` observation.
- Impact: A malformed or stale request can attempt repair against a path or registration the host no longer offered. An honest request also passes if the branch ref moved while the checkout stayed at the recorded OID, or if the administrative link disappeared during the user/queue pause.
- SuggestedFix: Inside the coordinator, obtain an authoritative current listing and require the exact normalized path to remain prunable on `mode.branch`; re-read `.git` with a true regular-file/non-symlink check and require its admin directory; read both current branch OID and directory HEAD and require them to agree with the expected version before repair. Treat the inbound fields only as expected-version claims, or redeem a host-held offer bound to surface/repository/opening.
- Status: accepted
- Triage: Confirmed. D3 states conditions 2 and 3 are read at resolution AND re-established at the mutation; the branch delivered only condition 3 (HEAD/expectedOid). Condition 2 - the .git link and its admin directory - is never re-read, and mode.branch is never consulted. Verified the consequence is worse than reported: if the admin entry is pruned during the pause, `git worktree repair` has nothing to reconnect and no-ops, and the post-check asks only 'is this path still prunable?' - an unregistered path is not prunable, so the check passes vacuously and a repair that did nothing is reported as success, defeating section 2.3 condition 4. The readGitLink symlink hole is also confirmed: lstat().isDirectory() is false for a symlink, so it falls through to readFile and follows the link. Remediation inside D3 as already written - no D# change. FIX.

### B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:1298`
- Title: Create can be submitted before the current selection is resolved
- Evidence: One branch edit posts defaults and `worktreeCreateProbe` concurrently. Only the defaults request sets/clears `outstanding`; the new resolution callback explicitly “never touches” that gate. The button at lines 1161-1167 therefore becomes enabled when the destination reply arrives even if refs classification or reattach corroboration is still pending. The controller also retains the previous repository resolution until a later answer lands.
- Impact: The core “resolve before submit” requirement is not enforced. With refs still pending, an existing or stale branch can be submitted as fresh and only fail in git; after a repository/query revisit, an older held repair can be used before the new probe answers.
- SuggestedFix: Track a current resolution request identity alongside destination state, invalidate held resolution immediately on each new probe/repository change, and keep Create disabled until both matching destination and resolution answers have landed. The documented fail-open remains an answer, not permission to submit before an answer exists.
- Status: accepted
- Triage: Confirmed. Only the defaults request participates in `outstanding`; the resolution callback deliberately does not. The ADDED spec requirement says a state git can distinguish SHALL NOT be reported to the user only as a failure after the create was attempted - a submit that outruns its own classification is exactly that failure mode, so this is accepted scope not delivered. Form-state ownership is internal architecture; no D# change. FIX.

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `asm-review-contracts`, `asm-review-reuse`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:1320`
- Title: The dialog discards most of the resolution, so its fallback, action, and path can disagree with submission
- Evidence: The receive callback changes `draft.branchMode` only when `resolution.mode.kind === "reattach"`; `fresh`, `reuse`, and `adopt` preserve the prior draft mode. A prunable holder whose corroboration declines therefore remains `existing`, and `heldBranch()` keeps it blocked instead of applying D3’s fresh fallback. The callback also ignores `freePath`, `occupiedCandidate`, `blockedBy`, and `repairPath`; the visible destination remains the independently computed defaults path, while the controller later constructs a repair against the held resolution’s different `repairPath`. Controller and dialog separately interpret the same resolution.
- Impact: Declined/adopt states can be dead-ended or submitted as reuse instead of fresh. A corroborated repair can mutate/open a path different from the destination shown to the user, and the default form has no explicit fresh/reuse/repair statement despite the accepted requirement.
- SuggestedFix: Give one layer ownership of an authoritative effective resolution, map every mode explicitly, render an always-visible action and the exact path that action will use, and construct the submission from that same state. Add non-vacuous tests beginning from a stale held branch for declined/adopt and asserting visible path/action equals the posted request.
- Status: accepted
- Triage: Confirmed, and it is a coverage gap rather than only a defect. The spec requirement 'The resolution names both the path the create will take and the one it skipped' is landed on the wire and never rendered: freePath, occupiedCandidate and blockedBy reach the dialog and are dropped. Task 2_2's Acceptance was written to base-ref refusal alone, so no task ever owned rendering them. Needs a task with its own Outcome. HANDBACK.

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:426`
- Title: Fresh base refs never ride the host resolution and are not validated before submission
- Evidence: Approved D5 requires a fresh mode’s base to resolve to a commit host-side through the resolution. The probe contract and sole production sender carry only `repoId`, `token`, `query`, and optional candidate path; the controller sends only the branch query. Editing `baseInput` does not create a distinct branch ask, and no resolution field reports base validity. The mutation later passes the base directly to `git worktree add`.
- Impact: An unresolvable base remains enabled and appears acceptable until after the user submits, directly preserving the failure-after-create behavior the accepted spec says to remove.
- SuggestedFix: Include the current base/detached intent in a versioned host validation request (or an equivalent dedicated validation), resolve it to a commit before enabling Create, and render the invalid-base reason on the form. Ensure base edits invalidate the prior answer.
- Status: accepted
- Triage: Confirmed, and it is accepted scope never implemented. The spec requires the base ref be validated before submission and reported as unresolvable before the create is attempted, and D5 puts that validation host-side 'riding the resolution'. But D1's Interfaces block gives the probe only {repoId, token, query, candidatePath?} and the resolution no base-validity field, so the wire cannot carry the answer D5 promises. Fixing needs new fields on both messages - a changed D1. HANDBACK.

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:1045`
- Title: Same-query replies have no request order, so an older repair can replace the latest answer
- Evidence: `handleCreateResolution` accepts every response with the current opening token and unconditionally replaces the repository entry. The dialog checks only query text. In an A → B → A edit sequence within one opening, the first A can be delayed in corroboration while the second A resolves to fresh/adopt; when the first answer lands later, its token and query still match and it overwrites/applies `reattach`.
- Impact: The UI and submission can use a repair authorization that the newest classification withdrew. Combined with B1’s incomplete mutation re-check, the stale offer can reach the side effect; even after B1 is fixed, the form states the wrong current action.
- SuggestedFix: Add a monotonically increasing per-probe generation to request and response, store the latest generation per repository/opening, and discard older replies before either controller storage or dialog application.
- Status: accepted
- Triage: Premise confirmed: handleCreateResolution gates on token only and repairFor on query text, so two probes for one query within one opening are indistinguishable and a late one wins. They diverge only when the world changed between them, which corroborate()'s live filesystem and git reads can see. Note the harm is bounded once B1 lands - a stale reattach reaching the coordinator gets refused there, which is D3's stated design - but it is not closed: the form still displays and submits a classification the newest answer withdrew. The prescribed per-probe generation is a new field on both wire messages, so it changes D1's Interfaces. HANDBACK.

### B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1124`
- Title: Per-input probes accumulate unbounded continuations behind a slow refs read
- Evidence: The name `input` handler calls `syncDerived()`, which calls `askForDestination()`; `askedFor` suppresses only identical strings, so successive characters post successive probes despite the “settled edit” contract. Every probe starts `answerCreateProbe` and awaits the same unresolved refs promise. Growth inventory — axis: distinct input values/events while one enumeration is unresolved; retained work grows O(N) suspended continuations, then resumes into O(N × (R + W)) classification, where refs are capped at 500 but N and registered worktrees have no structural event-count bound. No cancellation, coalescing, debounce, or latest-only slot exists.
- Impact: Slow git plus rapid input retains and then releases a burst of stale classification work and responses, consuming extension-host memory/CPU and amplifying B5’s ordering race.
- SuggestedFix: Coalesce to one latest pending query per surface/repository/opening, and trigger authoritative probing only on a genuinely settled edit. When the refs promise settles, classify/post at most the latest request generation.
- Status: accepted
- Triage: Premise confirmed - syncDerived runs on every `input` event and askedFor suppresses only identical strings, so typing N characters emits N probes against D2's stated per-settled-selection cadence. Recording one narrowing for the record: the probe awaits the memoized refs promise rather than re-reading, pinned by WorktreeHost.actions.test.ts 'rides the enumeration the opening already took' and the assembly's single for-each-ref assertion, so the per-keystroke cost is an in-memory classification, not a git call, and N is bounded by keystrokes inside one read window. That narrows the severity, not the fix: debounce to settled edits plus latest-only retention is correct on its own terms and also removes B5's race amplification. Internal; no D# change. FIX, jointly with W2.

### W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-data-security`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1297`
- Title: `worktreeCreateProbe` crosses IPC without runtime field validation
- Evidence: The message type list validates only the discriminant. The new handler sends the payload straight to async code where `query` reaches string/path logic, `candidatePath` reaches `isPathInside`, and `token` is echoed. Unlike `worktreeCreate`, there is no exact-key/type/integer validator and the detached async call has no rejection handler.
- Impact: Malformed WebView data can cause unhandled asynchronous failures instead of failing closed, and the host cannot assert a well-formed opening token.
- SuggestedFix: Before dispatch, require only declared keys, a non-empty string repo id, string query, finite non-negative integer token, and optional non-empty string candidate path; keep containment as a separate semantic check.
- Status: accepted
- Triage: Confirmed - only the discriminant is checked before query, candidatePath and token enter async logic. Cheap and self-contained. FIX.

### W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:556`
- Title: The retained refs enumeration is repository-scoped, not surface/opening-scoped
- Evidence: `refsReads` is keyed only by `repoId`; every surface’s `requestWorktreeRefs` replaces it, and every probe retrieves whichever promise is currently stored. Two attached worktree surfaces can therefore make surface A classify against surface B’s later read rather than the enumeration A’s opening started.
- Impact: A failed or state-shifted read on one surface can make another surface resolve fresh/reuse/reattach against facts different from the list it was shown, violating D2’s same-opening ownership.
- SuggestedFix: Key the retained read by surface, repository, and opening token, retrieve that exact entry for the probe, and evict it on supersession/detach.
- Status: accepted
- Triage: Confirmed. refsReads is keyed by repoId alone, so a second attached surface's requestWorktreeRefs replaces the promise the first surface's probe consumes. Misclassification needs the replacing read to have failed (refs = [] classifies everything fresh), and that fails safe - a create against an existing branch is refused by git and surfaced verbatim per section 6 - which is why WARN is the right severity. Keying by surface/repo/opening is the same retention change B6 needs. FIX, jointly with B6.

### W3
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:426`
- Title: The candidate-path override has no production sender
- Evidence: The only production `worktreeCreateProbe` sender omits `candidatePath`; outside tests the field appears only in its type and host consumer. Editing the dialog’s path override never sends it for assessment.
- Impact: D1’s override-assessment branch is unreachable in the running product, so an occupied manual override remains a submit-time failure and the host’s containment/disposition behavior is test-only.
- SuggestedFix: Send the current derived/manual candidate with a request generation whenever the authoritative resolution is asked, or remove/defer the field until the path owner can supply it.
- Status: accepted
- Triage: Confirmed - the only production sender omits candidatePath and editing the path override never triggers its assessment, so the host's override branch is reachable only from tests. Resolving it means either sending the field with a request generation or deferring it from the contract; both are decisions about D1's Interfaces and belong with B4/B5. HANDBACK scope.

### W4
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`, `asm-review-reuse`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1087`
- Title: Probe and defaults independently implement the same destination resolver
- Evidence: `answerCreateProbe` and `requestWorktreeCreateDefaults` each derive linked paths, root, registered/taken predicates, slug/base, and `suggestFreePath`, in separate requests that call `exists` independently. The probe’s occupied override also falls back to suffixing the derived base, not the override spelling.
- Impact: `resolution.freePath` and the defaults path actually submitted can disagree from filesystem timing or future edits, compounding B3’s split state.
- SuggestedFix: Extract one authoritative destination-resolution helper and let both response shapes project from its result.
- Status: accepted
- Triage: Confirmed - the probe handler and the defaults handler each derive root, taken paths, slug/base and free suffix through separate observations, so the resolution's freePath and the submitted destination can drift. Extracting one authoritative destination resolver is reuse-first remediation; no D# change. FIX.

### W5
- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: `asm-review-reuse`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutations.ts:362`
- Title: Post-repair verification reimplements the repository worktree listing capability
- Evidence: `prunablePaths` runs and parses `git worktree list --porcelain` directly, while `WorktreeDiscovery` already owns listing compatibility, `-z` fallback, normalization, and degraded-result handling.
- Impact: Git compatibility and path interpretation can drift between normal discovery and the mutation’s success proof.
- SuggestedFix: Extract/reuse a focused authoritative worktree-record reader, then project prunable paths at the mutation boundary.
- Status: accepted
- Triage: Upgraded from the chair's MEDIUM confidence - verified as a real divergence, not a stylistic one. WorktreeDiscovery.runListing negotiates `-z` through the worktree-list-z capability probe and parses with {nulDelimited} (WorktreeDiscovery.ts:77-93,128); prunablePaths hardcodes `worktree list --porcelain` and the default line parse (worktreeMutations.ts:363). The listing that offers a reattach and the listing that confirms it can therefore disagree about the same path, which is precisely the comparison section 2.3 condition 4 rests on. FIX - reuse the authoritative reader.

### W6
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:754`
- Title: The sole base-ref disabled reason is hidden inside collapsed Advanced content
- Evidence: `baseNote` is attached to `baseField`, which is appended into `advBody`; `advBody` starts hidden. No always-visible action summary carries the reason.
- Impact: In the default form state, keyboard and screen-reader users cannot discover why base ref is unavailable without expanding an unrelated disclosure.
- SuggestedFix: Render an always-visible accessible resolution summary near the destination/action area and reference it from the disabled base input.
- Status: accepted
- Triage: Confirmed - the only stated reason lives inside the initially collapsed Advanced body, so the rule D5 exists to make legible is undiscoverable without expanding unrelated content. FIX.

### W7
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.worktreeAssembly.test.ts:1219`
- Title: The production-boundary repair test bypasses the resolution-to-submit seam
- Evidence: One assembly test proves a resolution reaches the form only by checking the advanced base note. The next test handcrafts `worktreeCreate` and calls `host.handleMessage` directly, rather than submitting the opened dialog/controller state. It therefore never covers resolution gating, mode translation, displayed path versus repair path, or same-query ordering.
- Impact: The task’s end-to-end gate remains green while B2, B3, and B5 break the actual user flow.
- SuggestedFix: Drive one assembled dialog from typed selection through the real matching resolution and submit action, then assert the visible action/path, posted create payload, and issued repair command all agree; add delayed and declined corroboration variants.
- Status: accepted
- Triage: Confirmed, and it is the reason the other findings survived a green gate. The repair test handcrafts a worktreeCreate and calls host.handleMessage directly instead of submitting the opened dialog, so the seam B2, B3 and B5 break is never crossed. Coverage lands with those fixes rather than as separate work. FIX.
