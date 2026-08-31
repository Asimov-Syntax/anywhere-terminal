# Review Round 2

- Date: 2026-08-31
- Cycle: 1
- Mode: verification
- Review lane: fastlane
- Scope: range `4ae1ac51..773864cdb57c748913f50ce7a3c72ae3efc773ba`
- Previous round Head: `4ae1ac51e2051e29850fa8c96bccde9f75e02d3f`
- Head: `773864cdb57c748913f50ce7a3c72ae3efc773ba` (tree dirty after the reviewed range: `asimov/changes/clear-crash-debris-under-an-explicit-authorization/analytics.json`)
- Scope lock: passed — the range contains the accepted round-1 remediation, its witnesses, task metadata, and the committed round-1 record; no new capability, design delta, or invariant owner
- Reviewable lines: 436
- Recorded Verify Gate: `asm change verify-status` records task 1_8 exit 0 with 36 added assertions and mutation witnesses; review ran no project verify command
- Agents spawned:
  - `asm-review-data-security` — destructive boundary fixes — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — host/service authorization contracts — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — recover dialog lifecycle — `sonnet[1M]`
- Agents skipped:
  - `asm-review-logic` — destructive ordering and races were covered by data-security within the narrow remediation cone
  - `asm-review-performance` — no growth-axis remediation or new hot path
  - `asm-review-reuse` — the shared component extraction introduced no competing implementation requiring a separate lens
- Verdict: BLOCK
- Counts: 1 BLOCK, 3 WARN, 0 SUGGEST

## Prior finding disposition

### B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/providers/WorktreeHost.ts:1361`
- Title: The host still authorizes debris that the current form does not offer
- Evidence: `Opening.debrisCandidate` is set for every debris `occupiedCandidate`, regardless of the resolved mode. The dialog suppresses recovery when `effective.mode.kind === "reattach"`, but the host still issues for that hidden candidate; the token can then accompany a forged fresh create because create mode is not bound to the opening or authorization. Separately, admitting a newer probe updates `latestSeq` without clearing `debrisCandidate`, so the previous path remains authorizable throughout the newer probe's asynchronous resolution even though the form has already invalidated the old answer. Invariant inventory — boundaries searched: probe admission, pending resolution, published resolution, dialog offer predicate, opening candidate, authorization issuance, create mode/path admission, service reattach refusal; affected: synchronous invalidation, offerability, and authorization-to-mode binding; verified safe: paths outside the stored candidate are refused, a completed newer non-debris answer clears it, and same-mode reattach+debris is refused.
- Impact: A forged or misrouted webview request can obtain and redeem a delete authorization for either a reattach-hidden candidate or a candidate already withdrawn by a newer edit, preserving the round-1 path-not-shown deletion boundary.
- SuggestedFix: Clear the candidate synchronously whenever a newer probe is admitted. Store only an explicit host-derived recovery-offer path whose mode/target semantics match the form, and bind the authorization to that resolved action/opening so changing create mode cannot make a hidden candidate redeemable. The detached case must remain expressible explicitly rather than inferred from a reattach answer.
- Status: persists from round 1
- Triage: accepted; remediation incomplete at the reattach integration seam

### B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-contracts`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/providers/WorktreeHost.ts:1117`
- Title: The production IPC boundary rejects every debris-backed create
- Evidence: `isKnownDisposition` now validates both exact variants, requires non-empty path/fingerprint fields, rejects extras, and the create handler requires `authorization.path === msg.path`. The host test crosses the real boundary and observes the unchanged debris disposition at `createWorktree`.
- Impact: Valid recovery creates are now reachable in production and malformed/mismatched variants remain closed.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/worktreeMutationService.ts:780`
- Title: An unreadable current directory is redeemed as an empty one
- Evidence: A `null` current `readdir` now forgets the authorization and returns failure before redemption, removal, or git. Service witnesses assert no removal/worktree-add and that the store record is consumed.
- Impact: Unknown contents can no longer be interpreted as an empty safe subset.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/clearDebris.ts:153`
- Title: The authorized entry set is stale before recursive removal starts
- Evidence: `clearDebris` now performs a synchronous boundary `readdir`, compares every present entry against its approval, and starts removal without an intervening await. Tests refuse an appeared entry and an unreadable boundary read.
- Impact: An unapproved name appearing after redemption cannot be swept into recursive removal.
- SuggestedFix: none for the round-1 safety defect; see new W4 for over-narrow approval semantics
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`, `asm-review-data-security`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/clearDebris.ts:131`
- Title: The symlink-component and re-resolution guard is not retaken at the delete boundary
- Evidence: `clearDebris` now uses `walkComponentsSync` inside the same synchronous run as the final stat, `.git`, identity, and entry checks. `createPath.ts` shares root/separator parsing through `componentsOf`; tests refuse an ancestor symlink and an unreadable component.
- Impact: The recursive call no longer proceeds through a component the boundary observed as a symlink or could not inspect.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/clearDebris.ts:174`
- Title: Post-removal success does not prove the destination is gone
- Evidence: After removal, success now requires `probeEntry(resolvedPath) === "absent"`; both `present` and `unknown` fail, with remaining names reported when readable. Tests cover surviving and unprovable destinations.
- Impact: A resolved remove call is no longer enough to declare clearance complete.
- SuggestedFix: none for the false-success mechanism; see new W3 for the removal-rejection reporting branch
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/worktreeMutationService.ts:615`
- Title: A reattach can offer recovery and then report success without clearing it
- Evidence: The dialog explicitly suppresses an effective reattach offer, and the mutation service rejects reattach+debris before entering the repair branch. The service witness uses the live reattach harness and asserts `worktree repair` never issues.
- Impact: A same-mode reattach request cannot report successful repair while ignoring its debris disposition.
- SuggestedFix: none for this mode/service mechanism; B1 remains open because the host can still issue the hidden candidate's token for redemption under a changed mode
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/worktreeMutationService.ts:378`
- Title: Real unreadable failures are reported as “not debris”
- Evidence: `DebrisIssueResult` now preserves `notDebris` versus `unreadable`; missing identity, unknown `.git`, and unreadable entries return `unreadable`, while a present `.git` returns `notDebris`. The host forwards the discriminator unchanged.
- Impact: The user now receives the correct refusal class.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/webview/worktree/WorktreeCreateDialog.ts:1818`
- Title: A stale first response can still satisfy a later same-path request
- Evidence: `recoverAsked` is incremented locally but no request generation travels on `worktreeAuthorizeDebris` or returns on `worktreeDebrisAuthorized`. After request A is withdrawn and same-path request B is sent, a late answer to A sees a non-null `recoverAsked` and matching path, clears B's pending state, and installs A's grant. The new witness covers only an answer landing while no request is outstanding, not the A-after-B ordering.
- Impact: A withdrawn authorization conversation can still supply the entries/token shown and submitted for a later acceptance.
- SuggestedFix: Carry a per-request sequence/nonce through the request and answer and require an exact match with the currently outstanding acceptance; add the A-withdraw-B-reaccept-A-answer ordering witness.
- Status: persists from round 1
- Triage: accepted; remediation closes the no-request interval but not same-path out-of-order responses

## New findings within the remediation cone

### W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/clearDebris.ts:165`
- Title: A rejected recursive removal still does not report what remains
- Evidence: `rm({ recursive: true })` can remove part of a tree before rejecting, but the catch branch returns the error immediately and never probes/readdir the destination. The post-remove remaining-state logic runs only when `remove` resolves. This is inside the B6/D5 impact cone and no test covers a throwing removal that leaves named entries.
- Impact: The create correctly fails, but the user is not told which debris survived, contrary to the accepted partial-clearance reporting obligation.
- SuggestedFix: After a removal rejection, take the same error-aware post-state probe and append bounded remaining names when present, while preserving the original removal error.
- Status: accepted
- Triage: Confirmed: the catch returns the error and never probes, so a recursive removal that deleted half a tree and then rejected reports the error alone. The requirement says a create never reports success for a clearance that did not complete — it reports failure here, so this is not a correctness hole — but the user is told a delete failed without being told what survived it, which is the same reporting gap the post-removal path already closes. Fix: keep the error and append the survivors where they can be read.

### W4
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/worktreeMutationService.ts:803`
- Title: The final boundary compares against the redemption snapshot, not the user's approved set
- Evidence: After the store verifies `entries` is a subset of the issued evidence, the service passes those current `entries` into `clearDebris` as the approval. If an entry present at issuance disappears before redemption and reappears before the boundary read, it is still inside the user's approved set but is now classified as newly appeared. The test covers an approved entry disappearing and staying gone, not disappearing and reappearing.
- Impact: A safe clearance can be refused under the exact concurrent-writer case for which D2 chose subset semantics, causing unnecessary re-prompts despite no unapproved name being present.
- SuggestedFix: Have redemption return the original approved evidence on a successful spend, and pass that evidence to the final boundary comparison; add a disappearance-then-reappearance witness.
- Status: accepted
- Triage: Real and worth fixing, and it fails CLOSED — an approved entry that vanished before the redemption and reappeared before the delete is refused as new, so the risk is a spurious re-prompt rather than an unapproved delete. It is still the wrong comparison: the spec binds the removal to the evidence the authorization was issued over, and the redemption's intermediate reading is not that. Fix: a successful redemption returns the approved evidence, and the boundary compares against it.

## Author triage summary — round 2

- Accepted: B1 (persists), W2 (persists), W3, W4. Rebutted: none. Six of round 1's seven blockers verified fixed.
- B1's three sub-claims each check out against the code:
  1. `debrisCandidate` is recorded for every debris candidate including a `reattach` resolution, which the dialog
     deliberately never offers — so the host would authorize a path no form put on screen. The host CAN tell the
     executable mode apart: the probe carries `base.kind === "detached"`, which is exactly when the form discards a
     reattach classification, so the candidate is recorded for a reattach resolution only under that.
  2. Admitting a newer probe sets `latestSeq` and leaves the previous candidate standing, so the withdrawn path
     stays authorizable for the whole time the new resolution is in flight. Cleared synchronously at admission.
  3. Binding to the resolved mode: with (1) and (2) closed, a forged `reattach` + debris create is already refused
     before the repair branch (B7), so this sub-claim is covered rather than separately outstanding.
- W2's remaining hole is real: `recoverAsked` is local, so a late answer to request A satisfies request B for the
  same path. A correlation id round-trips on the request and the answer — the same thing `seq` already does for the
  probe. This adds a field to an existing message pair; D6 owns that pair and its shape question is unchanged, so it
  is conformance rather than a new decision.
- Obligation test: none of the four needs a new or changed `D#` and none mints a new invariant owner. Remediation.
- Round 3 of cycle 1. If it still returns a blocker the thrash stop applies and the options go to the user.
