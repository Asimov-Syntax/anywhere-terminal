# Review Round 7

- Date: 2026-09-03
- Cycle: 3
- Mode: discovery
- Review lane: fastlane
- Escalation: security-privacy
- Scope: range `4f986c80d772138299d93d6b49ef0c22f4dec4bf..56ec158779bacdaa5623f0cbeadcfa9c8eb3b33f`
- Head: `56ec158779bacdaa5623f0cbeadcfa9c8eb3b33f` (tree dirty only because the open review round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 109
- Large change: no
- Accepted context: workflow Gate 2 is approved; task 7_1, design D4/D9, and the obligation ledger govern this redesign.
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports task `7_1` complete with exit 0. The author records `check-types`, 7224 tests across 287 files, and biome clean on every file this change touches. Review ran no project verify command.
- Risk map: recursive mutation of repository-owned administrative state; dev/ino authority across asynchronous deletion; descriptor-bound link writes and nlink semantics; partial-write recovery; caller-visible residue; retry detection. The candidate-name growth axis is structurally capped at 100 attempts per basename; ordinary withdrawal removes its entry and a failed removal is reported.
- Full-flow trace: `worktreeMutationService` revalidates the candidate and branch, `probeAdopt` binds the stale link to the repository, `adoptWorktree` opens one descriptor, constructs and claims the entry/link, runs repair/tip/index checks, then either releases on accepted success or settles the link and removes the entry on every withdrawal. The caller's post-write listing checks use the returned undo. Retry flows through `probeAdopt`, which offers the directory when the stale link names an absent entry.
- Targeted scratch probes:
  - Retaining the created entry made the new integration retry witness fail: `worktrees/` contained `survivor` instead of returning to its prior empty state.
  - Removing the `nlink === 0`/`linkLost` branch made the named unit witness fail its expected `leftAsFound` residue, proving it reaches the post-identity, pre-write count branch rather than an earlier identity refusal.
  - Substituting a foreign entry after `identify(entryPath)` but before `removeDir(entryPath)` made a focused scratch witness fail because the replacement directory was recursively deleted.
- Agents spawned:
  - `asm-review-data-security` — filesystem authority, nlink, and destructive cleanup — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — withdrawal state machine and failure outcomes — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — D4/D9, residue, and retry contract alignment — `sonnet[1M]`
  - `asm-review-logic` — fake fidelity and witness causality — `gpt-5.6-terra[1M]`
- Agents skipped:
  - `asm-review-frontend` — no frontend behavior in the range
  - `asm-review-performance` — no uncapped collection or full-history recomputation; entry-name attempts are capped
  - `asm-review-reuse` — no new repository capability, parser, helper split, or duplicated implementation
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST
- Split: 0 feature / 1 machinery

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1122`
- Title: Adopt submission is not bound to the host-issued resolution
- Evidence: The host-issued resolution binding remains intact and the redesign does not intersect it.
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
- Evidence: The common-directory binding remains intact and is exercised by the retry probe.
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
- Triage: Fixed in round 2; unchanged.

### F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:617`
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
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:456`
- Title: The entry ownership proof expires before recursive deletion
- Evidence: The redesign correctly removes the visible-link condition, but withdrawal still awaits `fs.identify(entryPath)` at line 456 and then separately calls recursive pathname removal at lines 462-465. A concurrent process can remove the identified directory and create a different registration at the same pathname between those operations; production's `fsp.rm(path, { recursive: true, force: true })` then deletes the replacement. A focused scratch witness installed a different dev/ino inside `removeDir`, after the successful identity sample, and observed that replacement being removed. The state-machine specialist independently reported the same schedule.
- Impact: A failed adoption can recursively delete another worktree's newly created administrative entry, corrupting that worktree's registration. This falsifies D4/task 7_1's claim that the removed entry is the one this adoption created and is proven by dev/ino rather than pathname.
- SuggestedFix: Hand the cleanup contract back to planning. With the current Node primitives, “always remove the created entry” and “never delete a replacement at the same name” cannot both be guaranteed: the dev/ino sample and pathname deletion are not coupled. The achievable contract must either add an ownership-preserving deletion primitive/native helper, or make cleanup non-destructive/best-effort and design a bounded, reusable, explicitly reported residual rather than recursively deleting after a stale sample.
- Status: accepted
- Triage: Persists under F005 with materially new boundary evidence. The redesign closes the visible-link dependency, F005's round-5/6 arm, but the same check-then-mutate ownership mechanism remains at the administrative-entry boundary first inventoried in round 1. This is the seventh consecutive discovery/verification appearance; the cycle cap requires planning handback, not another local guard.
- Invariant: Cleanup must not overwrite or delete repository administrative state unless ownership remains bound through the destructive operation, and must not report a clean withdrawal when that ownership is unresolved.
- Boundary inventory: searched exclusive mkdir, entry-file creation, post-create identity, link claim/recovery/restore, visible-link independence, entry identity, recursive removal, remove failure, caller-deferred undo, and retry detection. Affected: directory substitution after the final entry identity sample and before recursive pathname removal. Verified safe: substitution visible at the identity sample is retained and reported; an already absent entry is treated as removed; the new link-state outcomes do not overwrite different-inode replacements; successful removal with no substitution returns the destination to `probeAdopt`'s retry state.

### F006
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:525`
- Title: The final stale-link proof precedes another filesystem await
- Evidence: The descriptor-bound claim and opening stale-byte witness remain causal.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 4; unchanged.

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
- Evidence: The resolved-mode guard is unchanged.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and outside this range.

### F009
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:582`
- Title: The branch-tip guard runs after index reconstruction
- Evidence: Repair is followed by the worktree-local tip read and only then `reset --mixed`.
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
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:649`
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
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:538`
- Title: A rejected final write can mutate the link without becoming owned
- Evidence: Partial claim writes still enter descriptor-bound recovery, and unsuccessful recovery is reported.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 4; the three-outcome redesign preserves it.

### F013
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:321`
- Title: Later descriptor restores bypass the link-count boundary
- Evidence: Every write still samples the descriptor's name count inside `putLink`; the new failed-recovery witness covers the prior test gap.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 6 and preserved by the count-valued implementation.

### F014
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:920`
- Title: The unreadable-opening witness fails at the stale-entry reader instead
- Evidence: The handle-level witness still refuses before writes or git calls.
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
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:303`
- Title: A pre-truncate alias refusal is treated as unknown mutation
- Evidence: `putLink` now distinguishes `wrote`, `notWritten`, and `unknown`; claim-time `notWritten` skips recovery and withdraws the entry. The same-name alias witness asserts no unknown residue.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 7. The three-outcome state machine closes the accepted round-6 mechanism.

### F016
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:1296`
- Title: Failed-claim recovery has no late-alias witness
- Evidence: The new test truncates and fails the initial claim, creates the alias before recovery, and asserts recovery does not rewrite the aliased inode and reports unknown residue.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 7; the witness reaches the previously uncovered third `putLink` caller.

## Adjudication notes

- F005 is sustained with independent agreement from the state-machine specialist and chair, plus a focused scratch witness. The data/security and contracts specialists accepted the design-level dev/ino story but did not address the interval between the successful identity sample and production's recursive `fsp.rm`; direct code and witness evidence decide the conflict.
- The redesign does close round 6's visible-link dependency: no link content read gates entry deletion, the retry integration witness is causal when retention is reintroduced, and the `nlink === 0` witness is causal when its dedicated branch is removed.
- The contracts specialist proposed warning that restore-time `notWritten` maps to `unknown`. This is rejected as a finding: D9, task 7_1, the implementation comment, and the caller brief deliberately require that mapping because this adoption's installed link remains and the destination was not put back. The wording is conservative but contract-conformant.
- The contracts specialist also suggested a combined claim-alias plus `removeDir`-failure test. No defect was established: before the claim writes, the stale bytes remain intact, so `restored` is truthful if entry cleanup alone fails.
- No audit-backlog or accepted-risk entry exists.
- Because this is cycle 3 and F005 remains gating, the cycle cap requires mandatory handback to planning. Another pathname sample cannot close the entry identity-to-removal interval.

## Author triage record (round 7)

**F005 — accepted, seventh appearance, and the chair is right about the mechanism.** The link
dependency really is gone — the chair verified that independently, and the zero-reads witness holds.
What round 6's redesign did was move the same check-then-mutate pair up one level: `identify(entryPath)`
proves ownership of a DIRECTORY and `removeDir(entryPath)` then deletes by PATHNAME, so a replacement
landing between them is deleted under its owner. Production's `rm -r` makes that destructive rather
than merely wrong. The chair reproduced it with a scratch witness; I am not rebutting it.

**I do not accept the chair's framing that the two guarantees cannot coexist.** Its statement of the
achievable contract offers a native primitive or a best-effort residual. There is a third option it
did not consider, and it is the move this change already made one level down: stop deleting by
pathname at all.

`<entry>/gitdir` is a file THIS adoption creates. Hold its descriptor from creation, and the
withdrawal `ftruncate`s it through that descriptor instead of calling `removeDir`. Verified against
git 2.50.1, an entry whose `gitdir` is empty is omitted from `git worktree list` and collected by
`git worktree prune` — `Removing worktrees/a: invalid gitdir file` — while an entry nobody touched
survives the same prune untouched. So the collection is performed by git, under git's own ownership
rules, and this process never names a directory it deletes.

Both guarantees then hold together: the created entry always becomes collectable, and a replacement
is never touched, because a replacement rebinds the pathname to a new inode while our descriptor keeps
ours — truncating it reaches a detached object and harms nothing. That is D9's argument applied to the
entry, and D9 is already accepted in this change.

The residual is bounded and nameable, which is what the chair asked for: between the truncate and the
prune an empty directory exists, invisible to `git worktree list`; and where the truncate itself fails
the entry keeps a valid `gitdir`, stays listed, and must be reported by path. Neither is a leak — the
first is collected by the next prune, and the withdrawal runs one itself.

**This is a handback, not a fix.** It rewrites D4's withdrawal and adds an obligation to D9, and the
cycle cap makes option 1 mandatory here regardless. Gate 2 is reopened.
