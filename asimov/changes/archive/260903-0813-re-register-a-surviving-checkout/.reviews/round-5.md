# Review Round 5

- Date: 2026-09-03
- Cycle: 2
- Mode: verification
- Review lane: fastlane
- Scope: range `b7aad0b3792953bc8f41d7a5f5de583e1d3b72ac..5bdac775546072460ec756aeee3e1376a5bba31f`
- Head: `5bdac775546072460ec756aeee3e1376a5bba31f` (tree dirty only because the already-open round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 66
- Large change: no
- Scope lock: passed — D4/D9 and task 5_1 only encode remediation for round-4 F005/F013/F014 under the existing `adoptWorktree` owner; Gate 2 was re-earned before the code commit, and the range adds no capability or invariant owner.
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports tasks through `5_1` complete with exit 0. The author records `check-types`, 7214 tests across 287 files, `gate:fs-deletion`, and `build:check-requires` passing, with every touched file biome-clean; the repository-wide 4 errors / 15 warnings reproduce on base in untouched files. Review ran no project verify command.
- Verification impact cone: the pinned `<wt>/.git` descriptor from open through initial claim, failed-claim recovery, repair/tip/index failures, caller-deferred undo, entry removal, and `residueNote` rendering.
- Targeted scratch probes: one real-filesystem probe created a hard-link alias after the successful claim and forced repair failure; undo rewrote the alias from the installed link to `staleLink` and returned a clean failure. A second real-filesystem probe replaced `.git` immediately after restore with a new inode still naming this adoption's entry; cleanup reported `{ entryPath: null, link: "leftAsFound" }` after deleting that entry, leaving the visible link dangling. Both probes were created and deleted within their commands.
- Agents spawned:
  - `asm-review-data-security` — descriptor alias authority and cross-boundary writes — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — undo state machine and residue truthfulness — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — guard/witness causality — `sonnet[1M]`
- Agents skipped:
  - `asm-review-contracts` — no route/schema/API contract delta; caller result wording was reviewed inline
  - `asm-review-frontend` — no frontend behavior in the remediation cone
  - `asm-review-performance` — no collection, recompute, or hot-path growth axis
  - `asm-review-reuse` — no new helper, parser, split, or duplicated capability
- Verdict: BLOCK
- Counts: 2 BLOCK, 0 WARN, 0 SUGGEST

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1122`
- Title: Adopt submission is not bound to the host-issued resolution
- Evidence: The host-issued resolution binding remains intact; this remediation does not intersect it.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged in round 5.

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
- Triage: Fixed in round 2 and outside this remediation cone.

### F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:248`
- Title: Filesystem read failures are still converted into proof of absence
- Evidence: `openLink` and the opening positioned read still refuse before `createEntry`; round-5's corrected witness drives `LinkHandle.readAt` and asserts no write or git command occurred.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Production remained fixed; F014's witness defect is now also fixed.

### F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:494`
- Title: Identity failure after mkdir leaks an unreported administrative entry
- Evidence: The created path remains present in the failure message consumed by the caller.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: The round-2 disposition remains controlling.

### F005
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:361`
- Title: A detected replacement can still lose the administrative entry it names
- Evidence: The new post-restore `stillOurName()` check correctly detects a different-inode replacement and changes `state` to `leftAsFound`, but entry cleanup at lines 376-386 is independent of that state. If the replacement's bytes are `gitdir: <entryPath>\n`, cleanup removes `entryPath` and returns `{ entryPath: null, link: "leftAsFound" }` while the visible `.git` points to the directory just removed. The chair's real-filesystem probe made that replacement inside the restore write and observed exactly this result. The new witness instead replaces the link with `somebody-else`, and asserts neither that the replacement cannot name this entry nor that the entry survives, so it cannot close the coupled-resource branch round 4 explicitly identified.
- Impact: A failed adoption can still leave the checkout's visible `.git` naming a nonexistent administrative directory while reporting that no entry remains, falsifying D4/task 5_1's withdrawal invariant.
- SuggestedFix: Couple entry removal to the visible link outcome. On pathname identity divergence, retain and report the entry unless the implementation can prove the visible link does not depend on it; do not remove the entry merely because its own dev/ino is unchanged. Add pre- and post-restore replacement witnesses whose new inode still resolves to this adoption's entry.
- Status: accepted
- Triage: Persists from round 4. Reversing the ordinary order and adding the second identity sample close the unrelated-target/reporting arms, but not the replacement-that-still-names-our-entry arm already in F005's evidence and suggested fix.
- Invariant: Cleanup must not claim restoration, delete the administrative target, or overwrite a link unless ownership of the coupled link/entry state survives the mutation boundary.
- Boundary inventory: searched pre-restore name/handle identity, link target parsing, restore, post-restore identity, entry identity, removal success/failure, and caller residue wording. Affected: a different-inode link replacement before or after restore that still resolves to this adoption's entry. Verified safe: ordinary identity-stable restore; replacement resolving to an unrelated entry; entry removal failure after a successful restore, which returns `{ entryPath, link: "restored" }` and `residueNote` truthfully names both facts.

### F006
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:450`
- Title: The final stale-link proof precedes another filesystem await
- Evidence: The claim remains descriptor-bound, with the stale-entry read before the final identity/link-count checks.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 4 and not reopened by the undo delta.

### F007
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/reattachProbe.ts:142`
- Title: A malformed gitfile is accepted as adoption authority
- Evidence: The strict shared `gitdir:` grammar is unchanged.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and outside the cone.

### F008
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:2024`
- Title: A late refs reply desynchronizes adopt from its form controls
- Evidence: The resolved-mode guard is unchanged.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and outside the cone.

### F009
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:486`
- Title: The branch-tip guard runs after index reconstruction
- Evidence: Repair is still followed by the worktree-local tip read and only then `reset --mixed`.
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
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:889`
- Title: Adoption bypasses the repository's capability-aware common-dir resolver
- Evidence: Corroboration and reconstruction still share the normalized `repoId` common directory.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and outside the cone.

### F011
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:536`
- Title: Non-collision entry failures are reported as name exhaustion
- Evidence: Only `EEXIST` advances the candidate name; other failures retain their reason.
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
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:456`
- Title: A rejected final write can mutate the link without becoming owned
- Evidence: Partial/failed claim writes still enter descriptor-bound recovery and report `unknown` if recovery fails.
- Impact: The prior cleanly reported partial-link failure remains closed; F013 separately covers recovery mutating a newly aliased inode.
- SuggestedFix: None under F012; see F013.
- Status: fixed
- Triage: Fixed in round 4. The link-count defect uses the same recovery call but a different invariant and remains F013.

### F013
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:356`
- Title: Later descriptor restores bypass the link-count boundary
- Evidence: `oneName()` reads `nlink` from the descriptor at open and immediately before the initial claim, but `putLink()` truncates without enforcing that invariant. The deferred undo at line 356 and failed-claim recovery at line 461 call it without another `nlink` read. A hard-link alias created after a successful claim but before repair failure or caller-deferred undo passes `stillOurLink()` because the path and handle still identify the same inode; restore then truncates and rewrites both names. The chair's real-filesystem probe created the alias during forced repair failure and observed the foreign alias change from this adoption's link to `staleLink` while the function returned a clean failure and removed the entry. The integration witness only covers an alias present before open; the unit claim witness only covers one introduced before the initial claim.
- Impact: Failure recovery or withdrawal can still modify a pathname outside the selected checkout, so the security/privacy and cross-boundary violation from round 4 remains reachable.
- SuggestedFix: Enforce `nlink === 1` immediately before every descriptor truncate/write, including failed-claim recovery and deferred undo. If a later alias is observed, do not mutate it or remove the paired entry; return a residue state that truthfully describes the retained registration/alias boundary. Add witnesses that introduce the alias after the claim and before each later restore path.
- Status: accepted
- Triage: Persists from round 4 with the same causal mechanism and an expanded boundary inventory. Open and primary-claim guards are correct and descriptor-sourced, but they are not the right complete set of mutation points.
- Invariant: Mutation authority over one pathname does not authorize mutating another pathname that aliases the same inode.
- Boundary inventory: searched descriptor regular-file/open stat, opening `nlink`, pre-claim path identity and `nlink`, initial truncate/write, failed-claim recovery, repair/tip/index failures, deferred caller undo, and release. Affected: failed-claim recovery and post-claim/deferred undo restore. Verified safe: a pre-existing alias and an alias introduced during entry construction before the initial claim. The deliberate residual remains only an alias created after the last possible check immediately preceding each mutation, not the observable intervals currently left before later mutations.

### F014
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:870`
- Title: The unreadable-opening witness now fails at the stale-entry reader instead
- Evidence: The test now makes the returned handle's `readAt` reject and asserts both the filesystem write log and git-call log are empty. Removing the opening-read refusal reaches later work and breaks those assertions.
- Impact: The F003 boundary now has a causal witness.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 5. The specialist independently traced the guard-removal arm and found it causal.

## Adjudication notes

- F005 is sustained over the witness specialist's clean result. That specialist proved the new post-restore identity assertion is causal for changing `restored` to `leftAsFound`, but did not test the coupled entry decision. Direct code ordering and the chair's scratch probe show cleanup then deletes an entry the replacement still names; the data-security specialist independently reported the same defect.
- F013 is sustained over the witness specialist's statement that `putLink` has two guarded call sites. The implementation has three calls: initial claim, failed-claim recovery, and undo restore. Two specialists independently identified the unguarded later writes, and the chair reproduced the deferred-undo case against real hard links.
- The reversed ordinary undo order itself is correct. When restore succeeds and `removeDir` fails, the entry remains inert, the link holds the recorded stale bytes, the result carries `{ entryPath, link: "restored" }`, and `residueNote` states both facts. The blocker is the separate branch where a replacement still depends on the entry cleanup removes.
- At the two implemented F013 checkpoints, `nlink` is sourced from `handle.stat({ bigint: true })`, not a pathname stat. The defect is missing checkpoints before later descriptor mutations, not the source of the existing samples.
- F014 is fixed. The opening-read, ordinary order, post-restore reporting, opening `nlink`, and pre-claim `nlink` witnesses are causal for the guards they assert. What remained unwitnessed was the behaviorally reachable recovery/undo mutation boundary, which is production F013 rather than a support-only warning.
- No earlier closed finding other than F005/F013 is reopened. No audit-backlog or accepted-risk entry exists.

## Author triage record (round 5)

Both accepted; both verified against the code, and both were reproduced by the chair against a real
repository rather than argued.

- **F013 — accepted, and it is the clearest miss of the cycle.** `putLink` is called from three
  places — the claim, the failed-claim recovery, and the undo's restore — and only the claim is
  preceded by `oneName()`. An alias created after a successful claim is observable at both later
  writes and neither looks. The guard was written at the site instead of at the operation, which is
  why it covers one caller out of three.
- **F005 — accepted, and it is a coupling my own round-4 fix introduced.** Separating the link's
  outcome from the entry's removal is what let the two disagree: the post-restore check downgrades to
  `leftAsFound`, and the entry is removed anyway a few lines later. If the replacement link happens to
  name THIS adoption's entry, the withdrawal deletes the directory the visible link points at — the
  same dangling `.git` round 4 set out to make impossible, reached from the other side.

**Fourth round on F005, and this time the fix is not another guard.** Rounds 2 through 5 each added a
check to a step; this one removes the need for a check by stating the rule the steps were
approximating. The undo's obligation is one sentence — *never leave `<wt>/.git` naming a directory
that does not exist* — so the entry is removed only when the VISIBLE link does not name it, read by
pathname at the end, because "what does that name say now" is precisely a question about the name.
Ordering (round 4) and this coupling both fall out of that rule instead of being defended separately.

That is a change to D4's undo, so this is a handback and not a fix commit. D9's `nlink` sentence moves
with it: the boundary belongs to every write through the handle, not to the claim.
