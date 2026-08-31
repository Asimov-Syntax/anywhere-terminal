# Review Round 3

- Date: 2026-08-31
- Cycle: 2
- Mode: discovery
- Review lane: fastlane
- Escalation flags: new-api-contract, cross-boundary
- Scope: range `e2af6641~1..HEAD`
- Head: `0ef331865c93021e725929947a0798efdb908070` (tree dirty after the reviewed range: modified `asimov/changes/resolve-a-selection-before-the-create-runs/analytics.json`)
- Reviewable lines: 1191
- Large change: yes — accuracy may decrease
- Recorded Verify Gate: tasks `1_1` through `5_4` are recorded exit 0 in `.build/verified.ndjson`; caller reports check-types clean, 5,961 unit tests passing across 265 files, and the unchanged 3-error / 14-warning / 1-info Biome baseline outside this change; review ran no project verify command
- Agents spawned:
  - `asm-review-contracts` — resolution wire and D1/D7/D8 integration — `gpt-5.6-sol[1M]`
  - `asm-review-frontend` — effective resolution UI and submit gate — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — async probe-to-mutation flow — `sonnet[1M]`
  - `asm-review-data-security` — reattach and IPC trust boundary — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — probe lifecycle and growth axes — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — resolver/listing/state-owner reuse — `gpt-5.6-luna[1M]`
- Agents skipped: none
- Verdict: REJECT
- Counts: 6 BLOCK, 2 WARN, 0 SUGGEST
- Split: 6 feature blockers, 0 machinery blockers

## Findings

### B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:583`
- Title: Post-repair disappearance still satisfies the repair-success proof
- Evidence: The new pre-command listing and corroboration correctly require the stale registration before `git worktree repair`, but the postcondition remains only `!holdsStaleRegistration(after, repairPath, branch)`. That predicate is false both when the same registration is now non-prunable and when it disappeared, moved branches, or was replaced. An external prune after the precheck but before the command can therefore make `repair` exit 0 with nothing to reconnect; the post-list contains no stale record and lines 590-599 run `afterCreate` and report success. Invariant inventory — required invariant: success means the exact registration offered before the pause still exists at the normalized path and branch, and only its `prunable` state changed. Boundaries searched: pre-list, filesystem/link/ref corroboration, git command, post-list, after-create side effect. Affected: post-list identity/existence proof. Verified safe: pre-list presence, branch match, regular `.git` link/admin directory, directory HEAD/current branch OID, expected OID, and a still-prunable post-record all fail closed.
- Impact: A no-op or concurrently invalidated repair can be announced as successful, then open a terminal/window or launch an agent at a directory that is no longer proven to be a registered worktree.
- SuggestedFix: Require the post-list to contain the same normalized path and branch as a non-prunable record; treat absence, ambiguity, branch change, or replacement as unavailable/indeterminate. Carry enough listing identity to distinguish the pre/post record if path+branch is not unique enough.
- Status: accepted
- Triage: Persists from round-1 B1. The pre-command vacuous-success hole was fixed, but the same invariant and causal mechanism remain at the post-command boundary.
- Author-Triage: Accepted, and my round-1 fix narrowed it rather than closing it: a CONCURRENT prune is now needed instead of any user pause. Absence from the prunable set is not the proof; presence as a non-prunable record on the same branch is. Inside D3, no D# change.

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `asm-review-frontend`, `asm-review-reuse`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:1126`
- Title: The effective resolution still does not own the displayed or submitted destination
- Evidence: The callback stores the complete answer in `effective`, but `syncDerived` builds `draft.path`, the destination line, and collision text from `repo.resolvedPath` / `repo.collidedWith` or the local override; no production webview code consumes `effective.freePath` or `effective.occupiedCandidate`. The live-holder guard also re-derives from `WorktreeRef.heldBy` instead of `effective.blockedBy`. On submit, `WorktreeController` posts `draft.path` and separately re-reads its own resolution map to construct `reattach`. In the reattach flow this can state/submit the defaults free path while the mutation ignores it and repairs `mode.repairPath` elsewhere. The new assembly test asserts only the action text and issued repair argv, not the displayed path or posted create payload.
- Impact: Mode/action, displayed path, collision/debris statement, guards, request path, and repair target remain separate interpretations. The user can be shown one destination while another directory is repaired, and the spec-required skipped occupied candidate remains invisible.
- SuggestedFix: Make one effective selection snapshot the sole source for mode, `freePath`, occupied-candidate text/disposition, `blockedBy`, guards, and request construction. For reattach, display and submit the repair target consistently; remove the controller-side second interpretation.
- Status: accepted
- Triage: Persists from round-1 B3 and incorporates the same unresolved candidate-path surface from W3.
- Author-Triage: Accepted. I made the effective resolution own the MODE and stopped there — freePath, occupiedCandidate and blockedBy still arrive and are dropped, and the controller still rebuilds the reattach request from its own map. 5_3's Plan step 2 required this rendering; I ticked the task on an Acceptance covering only the submit gate, so the tick could not catch the gap.

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `asm-review-frontend`, `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:427`
- Title: Production probes omit the base and destination override they are meant to validate
- Evidence: The sole production sender receives only `(repoId, branch)` and posts `{repoId, token, seq, query}`; it never sends D1's `base` or `candidatePath`. The dialog's ask identity is only repository+branch. Base and path edits call `syncDerived`, but if the branch is unchanged they neither clear `effective`, mint a new `seq`, nor arm the resolution gate. Consequently `resolveBaseVerdict` receives `undefined`, `baseValid` is absent, and the dialog treats absence as no error. Even after wiring the field, the host currently validates only `mode.kind === "fresh"`; `adopt` is mapped by the dialog to a fresh/new create but receives no base verdict.
- Impact: An invalid or changed base and an occupied/changed override reach `git worktree add` as post-submit failures. The resolution and submit gate describe a different selection than the request, directly violating approved D1/D7 and tasks 5_2-5_3.
- SuggestedFix: Replace the branch-only callback with a settled-selection snapshot containing repository, query, detached/new intent, applicable base, and exact candidate override. Include all fields in request identity, invalidate/sequence on any change, require a matching verdict before submit, and validate base for every mode the dialog turns into a new create, including adopt fallback.
- Status: accepted
- Triage: Persists from round-1 B4 and W3. The wire was amended, but the production sender and gate do not use the amended fields.
- Author-Triage: Accepted, and it is the headline. I landed base and baseValid on the wire and in the host, wrote in 5_3's Plan that the controller sends candidatePath and base, and never implemented it. baseValid is therefore never produced outside tests that inject it, and D7 is satisfied on paper only — the declared-posted-handled-never-routed class this change exists to catch. W7 is why the gate stayed green.

### B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:1243`
- Title: The purported settled-edit probe still fires on every keystroke
- Evidence: The `input` handler calls `syncDerived()`, which calls `askForDestination()`; each changed partial branch produces a new ask key and invokes `onBranchChange`, posting both defaults and a probe. The adjacent comment claims `input` only rerenders and `change` performs the request, but the call graph does the opposite. Host-side `latestProbe` checks suppress stale answers only after continuations have been created: every probe first runs `resolveDestination` over the repository worktrees and then awaits the same refs promise. Growth inventory — axis: keystrokes while one enumeration is unresolved, multiplied by worktrees/collision checks per probe. Affected boundaries: input cadence, synchronous destination scan, suspended refs continuations. Verified safe: only the latest continuation proceeds to corroboration/base validation and posts.
- Impact: Rapid typing under a slow refs read retains O(N) continuations and performs O(N×W) destination work/filesystem occupancy checks, preserving the resource burst and race amplification accepted in round 1.
- SuggestedFix: Debounce/coalesce at the dialog boundary so only a genuinely settled selection posts, and retain one latest pending selection per opening rather than one continuation per spelling. Keep host sequence checks as a backstop, not the cadence mechanism.
- Status: accepted
- Triage: Persists from round-1 B6. Latest-seq suppression narrowed the work after the refs await but did not implement the accepted settled-edit cadence or prevent continuation creation.
- Author-Triage: Accepted. I fixed the host half and never debounced the sender, though 5_2's Plan named both. syncDerived still reaches askForDestination on every input event, defeating the change-not-input intent the code comment states.

### B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:565`
- Title: Per-opening probe state grows for the host lifetime
- Evidence: `refsReads` and `latestProbe` are keyed by surface+repository+opening token. Every dialog opening increments the token and inserts new entries, but a new opening or dialog close never removes the prior token's entries. Cleanup occurs only when the entire surface detaches; host `dispose()` clears neither map. Growth inventory — axis: create-dialog openings per attached surface over the extension-host lifetime. Each opening retains a settled promise/result (up to the refs cap) plus sequence state. Affected boundaries: opening supersession, close, host disposal. Verified safe: surface detach removes every key for that surface.
- Impact: Repeated open/close cycles cause monotonic retained state even with no dialog active, violating task 5_2's explicit supersession-eviction obligation.
- SuggestedFix: Retire previous opening keys when a newer token for the same surface/repository arrives, add dialog-close retirement if needed, and clear both maps on host disposal.
- Status: open
- Triage: New in cycle 2 discovery. The surface/repository ownership fix introduced a per-opening key without the matching lifecycle eviction.
- Author-Triage: Accepted, and it is a regression my own round-1 W2 fix introduced: keying by surface+repo+opening stopped the borrowing but made both maps grow one entry per opening, retired only on surface detach and never on host disposal.

### B8
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1135`
- Title: Lexical override containment can probe outside the create root through symlinks
- Evidence: `candidatePath` is untrusted IPC. `resolveDestination` admits it with lexical `isPathInside(override, root)` and then calls `options.exists`; production assembles that as `fs.existsSync`, which follows symlinks. A candidate spelled beneath the create root but traversing a symlink to an outside directory therefore tests the outside target. The resolution distinguishes existence through `freePath` and `occupiedCandidate`, defeating the explicit comment/security purpose of containing this field.
- Impact: A compromised WebView can use the new probe API as a filesystem-existence oracle outside the configured create root. Wiring the currently missing production sender would also expose this behavior to ordinary override use.
- SuggestedFix: Resolve/normalize the candidate and create root through the same symlink-aware containment boundary used for create authorization before any existence check; refuse unreadable, unresolved, or escaping candidates rather than falling back to a lexical result.
- Status: open
- Triage: New cross-boundary defect in the D1 candidate override.
- Author-Triage: Accepted, and it breaks a standing instruction rather than merely being weak. Containment is lexical, and the answer then authorizes options.exists, which follows symlinks. The resolved variants in pathBoundary are what to use when the answer authorizes a filesystem read, and this is that case.

### W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1391`
- Title: The probe boundary still does not validate the complete payload
- Evidence: The guard checks top-level scalar types but does not validate `msg.base` at all, uses `Number.isFinite` rather than non-negative safe integers for token/seq, and does not enforce exact keys. `base: null` reaches `resolveBaseVerdict` and throws on `base.kind`; the detached async call has no rejection handler. Unknown or incomplete base variants can instead be interpolated into git arguments.
- Impact: Malformed WebView data can cause unhandled async failures or misleading validation rather than failing closed at the IPC boundary.
- SuggestedFix: Add an exact runtime validator for the whole probe: declared keys only; non-empty repo/query/candidate where required; non-negative safe-integer token/seq; and base absent, exact detached, or exact ref with a non-empty string.
- Status: accepted
- Triage: Persists from round-1 W1; the newly added nested base contract widened the still-incomplete boundary.
- Author-Triage: Accepted as a partial fix: base is unvalidated and Number.isFinite is used where non-negative safe integers are meant, so base: null reaches detached async work.

### W7
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.worktreeAssembly.test.ts:1219`
- Title: The replacement assembly test still does not prove path or base agreement
- Evidence: Task 5_4 required the visible action, displayed path, posted create payload, and issued argv to agree. The added test asserts the action note, enabled button, repair argv, absence of add, and cleared prunable flag; it never asserts the displayed destination or intercepted `worktreeCreate.path/mode`. Base-validation tests inject `baseValid` directly into the dialog rather than proving a base edit travels through the production sender and host.
- Impact: The gate remains green while B3/B4 break the exact production seams the task says it covers.
- SuggestedFix: Capture the posted create message and assert displayed destination = posted path = effective resolution target = git argv for fresh and reattach. Add a production-path invalid-base case and a destination-override case that prove the outgoing probe carries both fields.
- Status: accepted
- Triage: Persists from round-1 W7. The test now clicks the real form, but its assertions still omit the values that were previously split.

## Prior findings resolved in this discovery

- B2 — fixed for the branch/query axis: a bound resolver now keeps Create disabled until a matching branch resolution lands. B4 documents the still-uncovered base/path axes.
- B5 — fixed: token+seq and latest checks prevent an older same-query resolution answer from replacing a newer one.
- W2 — fixed: refs ownership is now keyed by surface, repository, and opening. B7 is the separate lifecycle-retention defect introduced by that key.
- W4 — fixed at the implementation-reuse level: defaults and probes call one destination helper. The surviving split-state defect is B3.
- W5 — fixed: offer and mutation use the same injected `listRepoWorktrees` capability; the line-only parser was removed.
- W6 — fixed: the action/base reason is rendered outside the collapsed Advanced body.

## Audit backlog

None.
- Author-Triage: Accepted, and it is why B3, B4 and B6 survived a green gate twice. The walk asserts action text, button state and repair argv but never that the displayed destination, the posted create path and the issued argv name one path, and the base cases inject baseValid instead of travelling through the production sender.
