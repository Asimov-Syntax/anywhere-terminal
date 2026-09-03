# Review Round 4

- Date: 2026-09-03
- Cycle: 2
- Mode: discovery
- Review lane: fastlane
- Scope: range `3fe2103b5f13ca1db0d547ab273cdcf3e5c9e0bf..b7aad0b3792953bc8f41d7a5f5de583e1d3b72ac`
- Head: `b7aad0b3792953bc8f41d7a5f5de583e1d3b72ac` (tree dirty only because the already-open round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 334
- Large change: no
- Scope: new cycle after the round-3 option-1 handback; Gate 2 was re-earned on D9 and the D9 oracle blockers were folded in before tasks 4_1 and 4_2
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports tasks `1_0` through `4_2` complete with exit 0. The author records `check-types`, 7209 tests across 287 files, `gate:fs-deletion`, and `build:check-requires` passing; the first full-suite run hit the documented load flake and the immediate rerun passed. Review ran no project verify command.
- Full-flow trace: offer/corroboration carries one raw link snapshot into `adoptWorktree`; the reconstruction opens one descriptor, builds the administrative entry, claims through the descriptor, repairs/checks/reset, then the service either withdraws through `undo()` or accepts through `release()`. Failure traces covered pre-claim cleanup, partial claim recovery, post-claim undo, branch/listing withdrawal, and the kept-adoption release path.
- Agents spawned:
  - `asm-review-logic` — adoption state machine and handle lifetime — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — filesystem authority and cross-process boundary — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — parser, result, and lifecycle contracts — `sonnet[1M]`
  - `asm-review-logic` — race-witness vacuity — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — parser extraction and existing primitives — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-frontend` — no changed frontend behavior in this range
  - `asm-review-performance` — no collection growth, recompute, query, or hot-path scale axis
- Verdict: BLOCK
- Counts: 2 BLOCK, 1 WARN, 0 SUGGEST
- Blocking split: 0 feature / 2 machinery — machinery majority; build must run its premise audit

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1122`
- Title: Adopt submission is not bound to the host-issued resolution
- Evidence: The host-issued resolution binding and its consumers remain intact in the cumulative change.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged by D9.

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptProbe.ts:73`
- Title: The surviving checkout is never bound to the current repository
- Evidence: The normalized common-directory binding remains intact and reaches reconstruction unchanged.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged by D9.

### F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:223`
- Title: Filesystem read failures are still converted into proof of absence
- Evidence: `openLink` and its opening positioned read both refuse before `createEntry`; the entry-side reader still distinguishes absence from unreadability.
- Impact: The production defect remains closed. F014 records that one unit witness no longer proves this boundary after the adapter change.
- SuggestedFix: None to production code; see F014 for the witness.
- Status: fixed
- Triage: Fixed in round 3; D9 preserves fail-closed production behavior.

### F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:494`
- Title: Identity failure after mkdir leaks an unreported administrative entry
- Evidence: `createEntry`'s failure message still includes the exact entry path. A specialist proposed reopening because `created.leftBehind` is not forwarded, but the only consumer reports the same message and therefore does not conceal the durable path.
- Impact: No newly evidenced user-visible loss beyond the already-adjudicated representation choice.
- SuggestedFix: None.
- Status: fixed
- Triage: The round-2 adjudication remains controlling; no material new evidence reopens F004.

### F005
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:293`
- Title: Undo's identity proof still expires before restoration
- Evidence: `stillOurLink()` samples path-vs-handle identity at lines 293-296, returns, and `undo()` later calls `putLink(request.staleLink)` at line 344 with no post-restoration identity sample. A different-inode replacement after that sample survives because the write lands on the pinned old inode, but `putLink` returns true and the undo classifies the pathname as `restored`; the administrative entry was already removed at lines 325-330. If the replacement names this adoption's entry, the link is left pointing to the entry the undo deleted. This is a one-way A→B substitution after the undo's sample, not the documented A→B→A endpoint residual and not the accepted same-inode `git worktree repair` case.
- Impact: A failed adoption can report a clean withdrawal while the pathname was not restored, and can leave `<wt>/.git` pointing to a removed administrative entry.
- SuggestedFix: The cleanup needs a coupled link/entry ownership rule, not another pre-write sample. Do not remove the entry before the restoration outcome is known; sample path-vs-handle identity after the restore attempt, and when a replacement makes the pair ambiguous retain and report the administrative entry rather than claiming a clean undo. If D9 cannot define a race-safe ordering for both resources, hand the failure path back to planning and leave the coherent adoption installed as reported residue.
- Status: accepted
- Triage: Persists from rounds 2-3 under D9. The handle closes the claim write's pathname substitution, but the same check-then-write invariant remains in the deferred undo and still falsifies the fail-clean obligation.
- Invariant: Cleanup must not claim restoration, delete the administrative target, or overwrite a link unless ownership of the coupled link/entry state survives the mutation boundary.
- Boundary inventory: searched claim pre/post identity, partial-write recovery, repair-normalized same-inode link, post-claim link replacement, undo identity/read/restore, entry removal, and caller-deferred withdrawal. Affected: replacement after undo's identity sample and before restoration. Verified safe: replacement visible before `stillOurLink`, same-inode relative normalization, failures before installation, and ordinary no-race withdrawal.

### F006
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:390`
- Title: The final stale-link proof precedes another filesystem await
- Evidence: The intervening stale-entry read remains, but a different-inode replacement no longer receives the write: the write is descriptor-bound and the pathname identity is checked before and after the claim. The remaining same-inode writer is D9's explicitly narrowed parity case.
- Impact: The previously destructive distinguishable replacement path is closed.
- SuggestedFix: None under accepted D9.
- Status: fixed
- Triage: Fixed in round 4 by the handle pin and claim endpoint checks; no broader exclusion than D9 is asserted.

### F007
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/reattachProbe.ts:142`
- Title: A malformed gitfile is accepted as adoption authority
- Evidence: `gitdirOf` is a literal extraction of the existing strict prefix/trim/resolve grammar, and `readGitLink` still rejects malformed heads.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; the extraction does not change accepted or refused inputs.

### F008
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:2024`
- Title: A late refs reply desynchronizes adopt from its form controls
- Evidence: Outside this range; the resolved-mode guard remains intact.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2.

### F009
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:432`
- Title: The branch-tip guard runs after index reconstruction
- Evidence: Repair is followed by the worktree-local tip read and only then `reset --mixed`.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and preserved by D9.

### F010
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-reuse`, `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:889`
- Title: Adoption bypasses the repository's capability-aware common-dir resolver
- Evidence: Corroboration and reconstruction still share the normalized `repoId` common directory.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2.

### F011
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:478`
- Title: Non-collision entry failures are reported as name exhaustion
- Evidence: Only `EEXIST` advances the candidate name; other failures keep their own reason.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2.

### F012
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:263`
- Title: A rejected final write can mutate the link without becoming owned
- Evidence: The claim is now an explicit truncate/write-all state machine. Short writes loop; zero or rejected writes enter recovery through the same handle; failed recovery sets the sticky `unknown` residue and the service reports it even when the entry was removed.
- Impact: The cleanly reported partial-link failure is closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 4. The unit fake exercises successful recovery, failed recovery, short fulfillment, and zero fulfillment.

### F013
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:946`
- Title: The pinned handle accepts a hard-linked `.git` and can rewrite its foreign alias
- Evidence: `O_NOFOLLOW` excludes only symbolic links, and the descriptor check at lines 946-951 accepts any regular file. A `.git` hard-linked to another writable regular file containing the expected valid `gitdir:` bytes passes the stale-byte and path-vs-handle identity checks because both names share the same inode; `truncate` and `writeAt` then alter the other name as well. Unlike D9's accepted same-inode concurrent writer, a pre-existing hard-link alias is observable through descriptor `nlink` and is not parity the decision states as unavoidable.
- Impact: Adoption can modify a file outside the selected checkout and repository administrative entry while reporting success, violating the boundary that `<wt>/.git` is the only changed path.
- SuggestedFix: Refuse an opened descriptor whose `nlink` is not 1 and repeat the descriptor link-count check immediately before the claim. Add a real-filesystem hard-link witness asserting the alias bytes remain unchanged. Document any remaining concurrent hard-link creation residual rather than silently widening D9.
- Status: accepted
- Triage: New in round 4. The security/privacy and cross-boundary flags make the foreign-alias write gating.
- Invariant: Mutation authority over a pathname does not authorize mutating another pathname that aliases the same inode.
- Boundary inventory: searched symlink refusal, descriptor file type, path-vs-handle identity, hard-link count, claim truncate/write, and post-write identity. Affected: pre-existing multi-link regular inode. Verified safe: symbolic-link leaf where `O_NOFOLLOW` is defined, non-regular descriptor, and different-inode pathname replacement.

### F014
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:859`
- Title: The unreadable-opening witness now fails at the stale-entry reader instead
- Evidence: The test overrides `AdoptFs.readFile`, but D9 moved the opening link read to `openLink().readAt(0)`. The override is reached later for `${staleGitdir}/gitdir`, so the result is still false and undo removes the entry; assertions check only the final bytes and absent directory. Removing the opening `readAt` rejection guard would not make this test fail, despite its name and comment claiming refusal before creation.
- Impact: The F003 opening-read boundary can regress while the named test remains green, repeating the witness-vacuity pattern that defeated the first three rounds.
- SuggestedFix: Make the returned handle's opening `readAt(0)` reject and assert no `mkdir`, entry-file write, git command, truncate, or link write occurred; do not use the unrelated entry-side `readFile` seam.
- Status: accepted
- Triage: New support-code warning in round 4; it does not reopen F003 because the production guard is presently correct.

## Adjudication notes

- The logic specialist's F005 is sustained and merged with the chair's full-flow trace. The same specialist's F004 reopening is rejected because the exact entry path remains in the failure message consumed by the UI; no new impact changes round 2's disposition.
- The witness specialist's proposed post-write-identity warning is rejected. The test at `adoptWorktree.test.ts:793-824` captures the old identity, replaces the pathname before returning that captured value, lets the pre-check pass, then relies on the post-write check to refuse; it causally exercises the guard the specialist said was uncovered.
- The data-security hard-link finding is sustained. D9's explicit parity exception concerns an indistinguishable in-place writer, whereas a pre-existing multi-link inode is descriptor-observable and expands the write beyond the promised path.
- The contracts specialist found `gitdirOf` behavior-preserving and the `staleLink`/residue/result flow exhaustive. The reuse specialist found no duplicated repository capability. No performance or frontend risk is present in this range.
- No audit-backlog or accepted-risk entry exists.

## Author triage record (round 4)

All three verified against the code before acceptance.

- **F005 — accepted.** `undo()` removes the entry FIRST (`adoptWorktree.ts`, `removeDir` before the
  link block) and `stillOurLink()` samples identity and then returns, so the restore that follows has
  no proof left. The destructive outcome is closed — the handle means our write lands on the detached
  inode, not on the replacement — but two real defects remain: a window in which we report `restored`
  while the visible link is somebody else's, and an ordering that can leave `<wt>/.git` naming an
  entry this undo has already removed.
- **F013 — accepted.** `O_NOFOLLOW` excludes a symlink; nothing excludes a hard link. `isFile()` is
  true of an inode with `nlink > 1`, and truncating the descriptor rewrites every alias, including
  one outside the checkout. Unlike D9's in-place writer this is OBSERVABLE before the write —
  `nlink` is right there in the `fstat` we already take — and this repository already refuses on it
  at `src/agentHooks/install/lockedJsonFile.ts`. A boundary we can see and do not check is not a
  stated residual, it is a miss.
- **F014 — accepted.** The case overrides `AdoptFs.readFile`, which after 4_1 no longer reads the
  link at all; it fails later at the stale-entry read and the end-state assertions pass anyway. It
  would survive removing the guard it is named for. Exactly the vacuity class rounds 1-3 kept dying
  on, and the second one this cycle after the pre-write identity witness.

**This is a handback, not a fix loop.** F005's invariant has now survived three attempts. The two
changes it needs are both design: D4 states the undo's order ("remove it and restore the recorded
bytes"), and reversing that order changes what states the withdrawal can be interrupted in; D9 owns
what the pinned handle is allowed to be pointing at, and `nlink` adds a boundary it does not
currently claim. Patching either in place would land a design change as a fix commit.

**Premise audit** — the round is 2 machinery / 0 feature, so the Split line requires one. It does not
apply, for the reason recorded in round 1: the shipped baseline has surviving checkouts git has
pruned, and the whole change is the recovery mechanism for that state. Machinery is its nature, not
scope creep. No evidenced state is being served by speculation here.
