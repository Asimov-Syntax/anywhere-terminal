# Review Round 9

- Date: 2026-09-03
- Cycle: 3
- Mode: verification
- Review lane: fastlane
- Escalation: security-privacy, re-review
- Scope: range `4f986c80d772138299d93d6b49ef0c22f4dec4bf..f51be25d874dad6cd66c3cabfbd4040611b71ff2`; verification delta `e648245ae30abdb50b0f00f040de90a364bb49ce..f51be25d874dad6cd66c3cabfbd4040611b71ff2`
- Head: `f51be25d874dad6cd66c3cabfbd4040611b71ff2` (tree dirty only because the open review round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 166
- Large change: no
- Scope lock: clear. Task 9_1 changes only the accepted remediation cone for round-8 F005, F017, F018, and F019; it adds no capability, new or changed D#, or new invariant owner. The artifact edits reconcile the already-approved D4 handoff contract.
- Accepted context: workflow Gate 2 is approved; task 9_1, design D4/D9, the obligation ledger, and the two referenced worktree-panel requirements govern the remediation.
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports task 9_1 complete, exit 0, `scope-unchanged`, with ten assertions added and no inherited assertion weakened or removed. Review ran no project verify command.
- Risk map: repository-owned Git administrative state; name-addressed marker unlink and entry-identity proof; descriptor ownership before the first fallible entry write; partial and zero-progress writes; deferred undo/release handle lifetime; accepted design/spec consistency. No uncapped collection or hot-path recomputation entered the delta; failed id minting remains structurally capped at 100.
- Behavioral cone: `nodeAdoptFs.createPinned` -> `adoptWorktree` entry construction/write -> success unlock or withdrawal -> returned undo/release -> `worktreeMutationService` post-write listing/branch proof and residue reporting -> Git list/prune/retry outcomes; D4/ledger/spec are the accepted contracts for that cone.
- Agents spawned:
  - `asm-review-data-security` — ownership proof, descriptor transfer, and destructive residuals — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — state machine, failure paths, and handle lifetime — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — D4/ledger/spec cleanup and witness conformance — `sonnet[1M]`
- Agents skipped:
  - `asm-review-frontend` — no frontend behavior in the remediation cone
  - `asm-review-performance` — no unbounded growth, full-history recompute, or hot path in the delta
  - `asm-review-reuse` — `unlockIfOurs` is a local extraction of the accepted proof rather than a second repository capability or duplicated implementation
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1122`
- Title: Adopt submission is not bound to the host-issued resolution
- Evidence: The host-issued resolution binding remains intact and the task 9_1 cone does not intersect it.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptProbe.ts:73`
- Title: The surviving checkout is never bound to the current repository
- Evidence: The common-directory binding remains intact and outside this remediation delta.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:262`
- Title: Filesystem read failures are converted into proof of absence
- Evidence: Opening descriptor and positioned-read failures still refuse before entry creation.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:675`
- Title: Identity failure after mkdir leaks an unreported administrative entry
- Evidence: `createEntry` still returns the created entry path when its identity cannot be captured.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F005
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:419`
- Title: The marker unlink is not consistently gated by current entry ownership
- Evidence: Both marker-unlink callers now enter `unlockIfOurs()`, which immediately compares the current entry identity with the identity captured at creation before calling `removeFile`. Mismatch and non-absence identify failures refuse the unlink; absence performs no unlink. The new success-boundary witness substitutes the identity only at that helper's third entry sample and asserts refusal with the replacement marker intact. Data/security found no remaining ownership bypass. The stated identity-sample-to-unlink interval remains the accepted D4 residual.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 9. The ownership-before-name-mutation invariant now governs withdrawal and success through one operation rather than call-site discipline.
- Invariant: Repository administrative state may be mutated by name only after the strongest available current ownership proof, and an unresolved handoff must not be reported as successful or clean.
- Boundary inventory: searched construction marker write, withdrawal truncate, withdrawal marker unlink, success marker unlink, missing/replaced/unreadable entry outcomes, caller-deferred undo, release, post-write list proof, prune, and retry. Verified safe in this delta: both marker-unlink callers share the identity gate; mismatch does not unlink; a missing name causes no unlink and the caller's post-write registration proof refuses the adoption. Accepted residual: replacement between the identity sample and the unlink.

### F006
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:600`
- Title: The final stale-link proof precedes another filesystem await
- Evidence: The descriptor-bound claim and opening stale-byte witness remain causal.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 4 and unchanged.

### F007
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/reattachProbe.ts:142`
- Title: A malformed gitfile is accepted as adoption authority
- Evidence: The strict shared `gitdir: ` grammar remains intact.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F008
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:2024`
- Title: A late refs reply desynchronizes adopt from its form controls
- Evidence: The resolved-mode guard remains intact and outside this remediation delta.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F009
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:644`
- Title: The branch-tip guard runs after index reconstruction
- Evidence: Repair remains followed by the worktree-local tip read and only then `reset --mixed`.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and preserved.

### F010
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-reuse`, `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:895`
- Title: Adoption bypasses the capability-aware common-dir resolver
- Evidence: Corroboration and reconstruction still share the normalized `repoId` common directory.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F011
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:686`
- Title: Non-collision entry failures are reported as name exhaustion
- Evidence: Only `EEXIST` advances the candidate name; other errors retain their reason.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F012
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:600`
- Title: A rejected final write can mutate the link without becoming owned
- Evidence: Partial claim writes still enter descriptor-bound recovery, and unsuccessful recovery is reported.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 4 and preserved.

### F013
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:324`
- Title: Later descriptor restores bypass the link-count boundary
- Evidence: Every link write still samples the descriptor's name count inside `putLink`; task 9_1 does not alter that boundary.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 6 and preserved.

### F014
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:920`
- Title: The unreadable-opening witness fails at the stale-entry reader instead
- Evidence: The handle-level witness still refuses before writes or Git calls.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 5 and unchanged.

### F015
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:324`
- Title: A pre-truncate alias refusal is treated as unknown mutation
- Evidence: `putLink` still distinguishes `wrote`, `notWritten`, and `unknown`, with the two call-site mappings intentionally distinct.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 7 and preserved.

### F016
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:1296`
- Title: Failed-claim recovery has no late-alias witness
- Evidence: The existing test still reaches the failed-claim recovery boundary and task 9_1 does not alter it.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 7 and unchanged.

### F017
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:537`
- Title: Failed pinned-gitdir initialization loses the descriptor before withdrawal owns it
- Evidence: `createPinned(path)` now creates and returns an empty held file without writing. `adoptWorktree` assigns that handle before entering the short-write loop, so every thrown, zero-progress, or partial-write exit reaches `failed()` with `entry !== null`; withdrawal truncates the held object before marker handoff and closes the handle. The real adapter and both fakes share the signature. The new witness throws from `writeAt` after publication and asserts the entry is collectable and the handle close count is one. Data/security found no remaining lost-handle path.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 9. Descriptor authority now belongs to the outer adoption state machine from publication onward.
- Invariant: Once the exclusive entry inode exists, its descriptor belongs to the adoption state machine before any fallible initialization.
- Boundary inventory: searched exclusive open, assignment, short/zero/full write, thrown write after mutation, subsequent file creation failures, withdrawal truncate, marker handoff, and close. Verified safe: all post-publication write exits retain the handle and enter withdrawal; adapters implement the empty-file contract. Accepted residuals are the already-stated same-inode and proof-to-unlink races, not descriptor loss.

### F018
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/re-register-a-surviving-checkout/specs/worktree-panel/spec.md:63`
- Title: Accepted artifacts still promise the withdrawn entry-removal contract
- Evidence: The delta correctly rewrites D4's title, construction table, and opening rationale, and replaces two spec statements. It leaves three exact scenarios that round-8 F018 inventoried unchanged: branch-claim withdrawal says “the registration the adoption wrote is removed” at line 63; tip-mismatch withdrawal says “the registration is removed” at line 74; and incomplete undo still says it “cannot remove the entry” at line 132. The current implementation and D4 delete no directory and instead empty/unlock the entry for Git collection. Additional contradictions remain in `design.md`: the obligation ledger at line 393 still says the entry path is reported without limiting that to a failed handoff, while the code and spec lines 104-105 deliberately omit a collectable entry; the risk map at line 406 still says `gitdir` is written first although D4 and the code write `locked` first. The contracts specialist independently confirmed the unchanged spec inventory.
- Impact: Gate-2-approved sources still prescribe mutually incompatible mechanisms and outcomes. Task 9_1 claims F018 closed, but a builder or reviewer following the spec/risk map can reintroduce entry removal or the prune-vulnerable construction order, and cannot tell when residue must name the entry.
- SuggestedFix: Finish the accepted reconciliation: replace lines 63 and 74 with handoff-to-Git-collection outcomes; replace line 132 with failure to empty or unlock the entry; qualify the ledger's entry-path reporting to failed handoff only; and change the risk-map mitigation from `gitdir`-first to `locked`-first plus held-descriptor initialization.
- Status: accepted
- Triage: Persists from round 8. The remediation changed part of the prior inventory but left several exact accepted contradictions standing; no severity change.
- Invariant: Approved design, task, ledger, and spec must state one achievable withdrawal contract: locked-first construction; no directory deletion; successful handoff means empty gitdir plus marker removal and no required residue path; failed empty/unlock remains locked and is named.
- Boundary inventory: searched D4 title/table/rationale, undo description, obligation ledger semantics/defeaters/witnesses, risk map, branch-claim withdrawal, tip-mismatch withdrawal, incomplete undo, partial-link-write withdrawal, `residueNote`, and task 9_1. Affected: spec lines 63, 74, 132; ledger line 393; risk map line 406. Verified safe: D4's primary sequence and rationale, the partial-link-write scenario, task 9_1 intent, and `residueNote`.

### F019
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:1361`
- Title: Exact-once closure of the new entry handle has no witness
- Evidence: The new terminal-path witness asserts zero closes while a successful result is held, exactly one after `release()`, and exactly one after a post-construction withdrawal. The failed-write witness separately asserts one close after a write rejection immediately after inode publication. Link-handle assertions remain separate.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 9. Both terminal paths and the F017 early failure boundary now read the close counter.

## Adjudication notes

- F005 is fixed. The common operation performs the current entry-identity comparison before either marker unlink. The logic specialist proposed a BLOCK because `unlockIfOurs()` maps an absent entry to `true` at the success caller. That finding is not sustained: absence performs no name mutation, and the only production consumer does not treat `adoptWorktree`'s provisional success as authoritative — `worktreeMutationService.ts:927-937` immediately re-lists and requires a non-prunable record for the adopted path/branch, then calls `undo()` on absence. If another process recreates a valid matching registration before that proof, the final state is valid; otherwise the user receives a refusal. The missing-entry behavior also predates this delta because the old success unlink used forceful removal. No changed-path defect remains.
- F017 is fixed at the invariant boundary: the handle assignment precedes every initialization write, including short-write continuation and zero-progress rejection.
- F019 is fixed by causal reads of `entryClosed` on success release, ordinary withdrawal, and post-publication write failure.
- F018 remains the sole gate. The issue is not editorial style: the unchanged statements are accepted obligations and mitigation claims that prescribe the superseded mechanism.
- No audit-backlog or accepted-risk entry exists.

## Author triage record (round 9)

### F018 — Status: accepted

The finding is right, and it is the same defect as round 8's F018 rather than a
new one: I changed the decision in the round-7 handback and then reconciled the
artifacts by hand, which is exactly the method that leaves survivors. Round 8
caught four passages; round 9 caught four more the same way.

Remediation, not a handback — no `D#` moves and no invariant owner is minted.
D4 already says the withdrawal deletes nothing and constructs under `locked`;
every line below was text that contradicted a decision already accepted, so
correcting it changes no contract and no code.

Four edits, one per cited passage:

1. `specs/worktree-panel/spec.md:63` — "the registration the adoption wrote is
   removed" → withdrawn, emptied and unlocked so git's own collection takes it.
2. `specs/worktree-panel/spec.md:74` — "the registration is removed" → the same
   withdrawal, on the tip-mismatch scenario.
3. `specs/worktree-panel/spec.md:132` — an undo that "cannot remove the entry" →
   cannot empty or unlock it. The implementation has no removal to fail at.
4. `design.md` withdrawal ledger row — the entry path was described as always
   reported; the implementation reports `entryPath: collectable ? null : entryPath`,
   so the row now restricts it to a handoff that did not complete.
5. `design.md` risk map, "A partial reconstruction leaves the repository listing
   a broken worktree" — "`gitdir` first and `<wt>/.git` last" was the pre-handback
   order and directly contradicts D4. Now locked-first, with the descriptor-owned
   `gitdir` initialization that round-8 F017 installed.

No production code is touched, so there is no new witness to write: each of these
passages describes behavior an existing witness already covers — the withdrawal
round-trip integration case, the locked-during-construction case, and the
post-publication write failure added for F017. The fix-delta audit is therefore
the text itself: `git diff` over the two artifacts, read against D4.

The proposed missing-entry success-path blocker was not sustained by the chair,
and I add nothing to it.
