# Review Round 2

- Date: 2026-08-31
- Cycle: 1
- Mode: verification
- Review lane: fastlane
- Scope: range `587a6086~1..48b1ee7eb75a5c13362479d5d08ec045af7d00f6`
- Previous round Head: `748dcb92566a2dc8a672f804734d09d48f81f27d`
- Head: `48b1ee7eb75a5c13362479d5d08ec045af7d00f6` (tree dirty after the reviewed range: `asimov/changes/state-what-the-worktree-will-lack/analytics.json`)
- Scope lock: passed — the range contains accepted remediation, its tests/formatter commits, task-completion metadata, and the W4 deferral note; no new capability, design delta, or invariant owner outside the accepted remediation
- Reviewable lines: 608
- Recorded Verify Gate: `.build/verified.ndjson` records exit 0 for tasks 2_1 through 2_4; review ran no project verify command
- Agents spawned:
  - `asm-review-data-security` — provider containment, errno, and growth boundaries — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — offer/form lifecycle and destination-channel isolation — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — checkbox state, redraw, accessibility, and dialog lifecycle — `sonnet[1M]`
- Agents skipped:
  - `asm-review-contracts` — current contract disposition adjudicated by chair; no separate schema cone beyond W4
  - `asm-review-performance` — B7 growth cone covered by data-security with named axes
  - `asm-review-reuse` — no remediation introduced a competing implementation requiring a separate reuse pass
- Verdict: REJECT
- Counts: 3 BLOCK, 3 WARN, 0 SUGGEST

## Prior finding disposition

### B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:686`
- Title: The production host never supplies the provisioning reader
- Evidence: `createWorktreeHost` now receives `readProvisioning`, backed by `createProvisioningDeps`; the real-filesystem suite exercises the same adapter/dependency seam.
- Impact: The shipped extension can now publish provisioning offers.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-reuse`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:266`
- Title: Resolved containment is skipped for the provider file and expanded glob matches
- Evidence: The root is prepared before the provider read, the provider path is checked at lines 275-280, and every expanded match is checked at lines 239-246. Real-filesystem tests cover both symlink escapes.
- Impact: The two escaped-read/model-entry boundaries identified in round 1 are refused.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`, `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/offerStore.ts:98`
- Title: Offer lookup is not scoped to the surface and repository that received it
- Evidence: `lookup(key, offerId)` now admits only the current offer under nested surface and repository maps; tests refuse cross-surface and cross-repository ids.
- Impact: A foreign offer id no longer resolves through this store.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`, `asm-review-logic`, `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:943`
- Title: A provisioning reply can clear the destination-answer gate with stale path data
- Evidence: Provisioning now travels through `applyProvisionOffer`/`bindProvisioning`; that callback updates only provisioning state and never touches the destination's `outstanding` flag. The ordering case has a focused regression test.
- Impact: An offer arriving during a destination request cannot enable Create on the previous path.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1145`
- Title: In-flight provisioning reads are still not bound to the opening that started them
- Evidence: `provisionReading` is keyed only by surface and repository. Form A can open and start a read, close, and be followed by form B while the key remains present. B starts no read; when A's promise resolves, the completion checks only host disposal and surface attachment, then issues/posts the result to the still-attached surface. No opening generation exists to prove that the result belongs to B. The added test labels its second branch-less request as a second form-open ask and deliberately expects both openings to share one read, so it codifies the cross-generation behavior rather than rejecting it.
- Impact: A reopened form can consume a model resolved for the form that preceded it, including provider contents that changed between close and reopen. The accepted one-read-per-current-form invariant remains broken.
- SuggestedFix: Give every opening a generation/token; bind the in-flight read to it, invalidate it on close/reopen, and post only when the same generation is still live. Repeated requests within one generation may join; a new generation must not.
- Status: persists from round 1
- Triage: accepted; remediation incomplete

**Status**: accepted

**Triage**: Confirmed. `provisionReading` is keyed `surface + repoId` with no notion of WHICH opening started the read, so a close-then-reopen inside the window makes form B join form A's read and receive its result. My round-1 fix closed the guard-before-await hole and stopped there; the reviewer is right that "one read per form" is not the same property as "no two reads at once".

Fix: a generation counter bumped on every form-opening ask. A completion whose generation is no longer current is dropped, and the reopening starts its own read. No new message — the branch-less ask already IS the opening signal.

### B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1153`
- Title: Normal form close neither revokes its offer nor rejects late completion
- Evidence: `forgetSurface` handles detach only. Closing the create dialog sends no host transition, `ProvisionOfferKey` has no form identity, and the completion guard considers a closed dialog valid while its surface remains attached. The controller retains every received offer in `provisionOffers`; opening the next dialog seeds from that old map before the fresh read completes, and a failed fresh read leaves the old offer displayed and resolvable. `applyProvisionOffer` also remains bound to the disposed dialog closure until another dialog replaces it.
- Impact: Closed-form authority survives normal cancel/submit, stale models can appear in a later form, and a read completing after close can mint an offer for no live form.
- SuggestedFix: Add an explicit form-close/invalidation transition and a per-opening identity in the request/offer key. Clear the controller's cached offer when a new opening starts, forget the closed form's host offer, and reject completions for any non-live generation.
- Status: persists from round 1
- Triage: accepted; surface-detach half fixed, normal form-lifetime half remains

**Status**: accepted-modified

**Triage**: Confirmed as a defect; taking the fix, but not the mechanism as written, and the difference is worth stating plainly.

Confirmed: cancel/submit sends the host nothing, so an offer outlives the form that owned it until the surface detaches or a new form opens. The controller also seeds a reopened dialog from its cached offer, so a failed fresh read leaves the previous model on screen and resolvable — that half is a real bug and is fixed outright.

Modification: I am NOT adding an explicit form-close message. A close transition is a new webview→extension contract, and the offer's refresh semantics are owned by worktree-rpc.md § 2.4 — landing a new message as a review fix would be exactly the artifact change the remediation boundary says must go back through planning first. The generation from B5 plus clearing the controller's cached offer on open gives the same property everywhere the message would have: a reopened form never sees its predecessor's model, and a superseded generation cannot publish.

Residual, stated rather than hidden: an offer for a form the user CANCELS stays in the host store until that surface detaches or another form opens. Nothing redeems the store in this change (task Boundary — WT-012.2 owns execution), so this is retained memory, not live authority. If you consider the residual itself blocking rather than the reopen path, say so and it goes back to planning as a contract change instead of a fix.

### B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:203`
- Title: Glob enumeration and downstream model growth remain unbounded
- Evidence: `readdir()` still materializes the complete repository-controlled directory and line 217 copies/sorts every name before the accepted-row check runs. Non-matching names therefore consume unbounded scan memory/CPU. Matching paths that fail containment append unlimited `problems` without consuming `MAX_MODEL_ROWS`. Literal entries, ports, setup steps, and unknown-key problems also bypass the claimed model-wide row budget. The test covers only more than 200 safe matching glob entries.
- Impact: A directory with arbitrarily many non-matches or escaping symlinks can still produce unbounded host work or problem rows, and a compact YAML file can produce substantially more than 200 downstream rows through item kinds the cap does not count.
- SuggestedFix: Use bounded directory iteration with a hard examined-entry budget, and maintain shared budgets for every emitted model row (`entries`, `ports`, `setup`, `excluded`, and `problems`). Stop all further declarations after one bounded overflow problem.
- Status: persists from round 1
- Triage: accepted; match-row cap fixes only one boundary from the original inventory

**Status**: accepted

**Triage**: Confirmed, and my round-1 fix was half a fix — I checked the budget and did not follow it through.

Both halves verified: `[...names].sort()` materializes and copies the entire directory before any budget is consulted, so the enumeration cost is unbounded regardless of how many entries survive; and the 200-row check reads only `draft.entries.length`, so ports, setup steps, escaping-match problems and unknown-key problems all bypass the budget I described as model-wide. A directory of non-matching names, or one of escaping symlinks, still costs unboundedly.

Fix: iterate with `opendir` under a scan budget rather than materializing the listing, and apply one shared budget across every emitted collection — entries, ports, setup and problems alike.

### B8
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-data-security`, `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:287`
- Title: Read failures are silently classified as absence
- Evidence: Provider `readFile` and glob `readdir` now treat only `ENOENT`/`ENOTDIR` as absence and emit named `unreadable` problems for other failures. Tests cover both provider and glob-directory classifications.
- Impact: The original silent-empty behavior is removed.
- SuggestedFix: none for the original read boundaries; see new W6 for containment-resolution diagnostics
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`, `asm-review-reuse`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/provisioningDeps.ts:27`
- Title: Provider YAML is fully buffered and parsed without a byte budget
- Evidence: The production dependency reads at most `MAX_PROVIDER_BYTES + 1`, reports `EFBIG`, closes the handle, and never sends oversized content to the parser. The cap is enforced by the read rather than a preceding stat.
- Impact: Provider-file bytes are structurally bounded before parsing.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:522`
- Title: Unrelated form updates rebuild the section and reset every checkbox
- Evidence: An unchanged `offerId` now preserves the existing DOM, and checked ids are restored from `checkedByOffer` when the section legitimately redraws. Tests cover edits, replacement, and one repo-away/back path.
- Impact: The round-1 reset mechanism is removed.
- SuggestedFix: none for the original mechanism; see new W5 for listener accumulation introduced by the fix
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:262`
- Title: Checkbox accessible names omit the item being authorized
- Evidence: Each checkbox now references both the top line and subject through `aria-labelledby`; tests verify five distinct names containing the relevant path/command.
- Impact: Rows from the same provider are distinguishable to assistive technology.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W4
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:88`
- Title: Item identity is still minted inside one adapter rather than at final offer assembly
- Evidence: Behavior is unchanged: each adapter invocation starts at `i1`, while `offerStore.issue` stores and publishes those ids verbatim. The new comment accurately records the collision, but documentation does not restore the accepted per-final-offer identity invariant. The claimed missing assembly seam already exists: `offerStore.issue` receives the completed `ProvisionModel` and can clone/remint all selectable arrays without defining an adapter registry or guessing WT-012.4's merge shape.
- Impact: The contract still requires a later task to repair ambiguous merged ids; until fixed or user risk-accepted, this accepted warning remains open.
- SuggestedFix: Remint selectable ids inside `offerStore.issue` (or an immediately preceding final-offer function) from one counter over the completed model. This does not require changing adapter interfaces or choosing a merge algorithm.
- Status: persists from round 1
- Triage: accepted-modified by author; deferral is not remediation and no user-granted risk acceptance exists

**Status**: accepted

**Triage**: Reversing my round-1 deferral. The reviewer's mechanism defeats my objection rather than restating the finding, which is the right outcome for a rebuttal.

My reasoning was that reminting needs an assembly layer that does not exist, so doing it now would guess WT-012.4's merge shape — design.md D2's failure. But `offerStore.issue` IS the assembly point: it already receives the completed model and hands back the offer, and reminting there needs no registry, no detection order and no merge algorithm. It makes ids offer-scoped by construction, which is what `ProvisionItemId` now claims they are.

Accepted and fixed. The doc comment 2_4 added stays — it states the property; `issue` now enforces it.

### S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: `asm-review-performance`, `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:943`
- Title: Offer delivery reconstructs all repository form data to update one repository
- Evidence: `handleProvisionOffer` now passes only the changed repo id and offer through `applyProvisionOffer`; it no longer calls `createRepos()`.
- Impact: The O(repositories²) temporary reconstruction is removed.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

## New findings in the impact cone

### W5
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:546`
- Title: Every redraw adds another persistent checkbox change listener
- Evidence: `bringBox` is created once, but every non-guarded `syncBringOver` call attaches a new delegated `change` listener and none is removed. Hiding a no-offer repo resets `drawnOfferId`, so every away/back switch attaches another listener. Each closure retains its own offer's `held` set; with two offered repositories, a toggle dispatches through all old listeners and adapter-local ids overlap (`i1`, `i2`, ...), so a toggle in one repo can mutate another repo's saved selection as well as growing O(redraws) handlers.
- Impact: Checkbox state can leak across repository offers and each toggle becomes progressively more expensive during a long-lived dialog.
- SuggestedFix: Install one listener outside `syncBringOver` and have it consult a mutable current offer/set, or store and remove the previous listener before each redraw.
- Status: open
- Triage: new remediation-cone regression

**Status**: accepted

**Triage**: Confirmed, and it is mine from round 1. `bringBox.addEventListener` sits inside `syncBringOver`, so every redraw installs another delegated handler and none is removed. Each closes over the `held` set of the redraw that created it, and item ids are offer-local — every offer starts at `i1` — so a stale handler writes another offer's selection under a colliding id. That is the W2 fix leaking across repositories, which is worse than the bug W2 fixed.

Fix: one listener registered once, outside `syncBringOver`, resolving the current offer's set at event time rather than capturing one.

### W6
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:275`
- Title: Filesystem resolution failures are reported as proven path escapes
- Evidence: `contained()` returns only a boolean, while `isResolvedPathInsideRoot` returns `false` both for a path resolved outside and for `EACCES`, `ELOOP`, or other resolution failures. Provider-file, glob-parent, literal, and expanded-match branches consequently report every false result as `malformed`/outside. The new read/readdir errno tests inject failures after identity `realpath`, so they do not cover this production distinction.
- Impact: The file remains safely refused and named, unlike round-1 B8's silent omission, but the UI can falsely claim an unreadable path escaped the repository and the structured `reason` is wrong.
- SuggestedFix: Preserve a discriminated containment result (`inside`, `outside`, `absent`, `unreadable`) or otherwise retain resolution failure classification; map only proven escapes to `malformed` and filesystem refusal to `unreadable`.
- Status: open
- Triage: new boundary found inside the accepted B2/B8 impact cone; WARN because the path is still refused and named

**Status**: accepted

**Triage**: Confirmed. `contained()` returns a bare boolean, and `isResolvedPathInsideRoot` answers `false` both for a path proven to resolve outside the root and for a resolution that failed — EACCES on a parent directory, ELOOP on a symlink cycle. Every `false` is then reported as `malformed`, i.e. "does not resolve inside the repository", which is a claim the code has not established.

The refusal itself is correct and stays: an unresolvable path is not safe to materialize. What is wrong is the stated reason, and after B8 made this module careful about exactly that distinction elsewhere, leaving it wrong here is inconsistent. Fix: a discriminated result — inside / outside / unresolvable — with `malformed` reserved for proven escapes and `unreadable` for resolution failures.

## Accepted risk

None.

## Audit backlog

None.
