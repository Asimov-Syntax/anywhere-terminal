# Review Round 8

- Date: 2026-09-03
- Cycle: 3
- Mode: verification
- Review lane: fastlane
- Escalation: security-privacy
- Scope: range `4f986c80d772138299d93d6b49ef0c22f4dec4bf..e648245ae30abdb50b0f00f040de90a364bb49ce`; verification delta `56ec158779bacdaa5623f0cbeadcfa9c8eb3b33f..e648245ae30abdb50b0f00f040de90a364bb49ce`
- Head: `e648245ae30abdb50b0f00f040de90a364bb49ce` (tree dirty only because the open review round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json` and `workflow.md`)
- Reviewable lines: 312
- Large change: no
- Scope lock: clear. Task 8_1, D4, and the spec delta are the accepted remediation of round-7 F005; `verify-status` records task 8_1 as `scope-unchanged`, and no new invariant owner or capability entered the cone.
- Accepted context: workflow Gate 2 is approved; task 8_1, design D4/D9, the obligation ledger, and WT-012.15 govern the remediation.
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports task 8_1 complete with exit 0. The author records `check-types` clean, 7227 tests across 287 files, and biome clean on every touched file. Review ran no project verify command.
- Risk map: repository-owned administrative state; descriptor ownership before a fallible initial write; `locked` publication/removal across failure and success; name-based marker unlink after identity sampling; caller-deferred undo/release; residue truthfulness; prune/retry witness causality. Failed-entry growth is capped at 100 minted ids per basename, so no performance specialist was warranted.
- Behavioral cone: `nodeAdoptFs` -> `adoptWorktree` construction/claim/repair/tip/index/withdrawal -> `worktreeMutationService` post-write branch proof and release/undo -> git list/prune/retry outcomes; D4/ledger/spec are the accepted contracts for that cone.
- Targeted scratch probes:
  - A `gitdir` containing a partial prefix that names an existing directory survived `git worktree prune --expire now`, while an empty `gitdir` was removed as invalid.
  - Forcing production-shaped `createPinned` to publish such a prefix and then throw made `adoptWorktree` return a residue-free failure, remove `locked`, and leave the entry surviving a real prune.
  - Replacing the entry immediately before the success-path marker unlink made `adoptWorktree` return `ok: true` while deleting the replacement's `locked` marker.
- Agents spawned:
  - `asm-review-data-security` — pinned entry, marker authority, and destructive residuals — `opus[1M]`
  - `asm-review-logic` — exit state machine, handle lifetime, and witness causality — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — D4/D9/ledger/spec/residue consistency — `sonnet[1M]`
- Agents skipped:
  - `asm-review-frontend` — no frontend behavior in the remediation cone
  - `asm-review-performance` — no uncapped collection or hot-path recomputation; entry-name attempts are capped
  - `asm-review-reuse` — no duplicated repository capability or split in this remediation
- Verdict: REJECT
- Counts: 3 BLOCK, 1 WARN, 0 SUGGEST

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
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:628`
- Title: The marker unlink is not consistently gated by current entry ownership
- Evidence: The remediation removes recursive directory deletion and the withdrawal now performs the D4 identity sample before unlinking `locked`. The success path is a second name-addressed unlink, however, and calls `removeFile(<entry>/locked)` with no entry-identity proof after the last sample at line 533; claim, repair, tip read, and index rebuild all intervene. A focused scratch probe replaced the entry at the success unlink and observed `{ ok: true }` while the replacement's `locked` marker was removed. The data/security specialist independently identified this boundary. The logic specialist's objection to the withdrawal's sample-then-unlink interval is not a separate finding: D4 explicitly admits that residual; the defect here is that the success path lacks even the best-effort gate D4 claims every remaining name act has.
- Impact: Another process's construction or durable worktree lock can be removed. A concurrent/later prune can then recursively collect that replacement entry, and this adoption can still report success. The round-7 ownership-before-name-mutation invariant therefore persists at the new success-unlock boundary.
- SuggestedFix: Apply the achievable D4 contract to every marker unlink, not only withdrawal: immediately before either unlink, require the entry name to resolve to the captured identity; on mismatch, do not touch the marker and return/report the unresolved entry. The residual remains non-atomic and must stay stated, but no call site may omit the proof entirely.
- Status: accepted
- Triage: Persists from round 7 under the same ownership-before-name-mutation mechanism, now at the success marker boundary introduced by task 8_1. The recursive `removeDir` arm is fixed; the new non-recursive name mutation is not consistently governed by the replacement contract.
- Invariant: Repository administrative state may be mutated by name only after the strongest available current ownership proof, and any unresolved handoff must not be reported as success or clean withdrawal.
- Boundary inventory: searched locked-before-gitdir construction, withdrawal truncate, withdrawal marker unlink, success marker unlink, caller-deferred undo, release, prune, and retry. Affected: success marker unlink after the last entry identity sample. Verified safe: no recursive removal or adopt-triggered prune remains; withdrawal carries the admitted best-effort identity gate; descriptor-bound truncation does not hit a different-inode replacement.

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
### F017
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:1015`
- Title: Failed pinned-gitdir initialization loses the descriptor before withdrawal owns it
- Evidence: `createPinned` publishes `<entry>/gitdir`, performs a fallible multi-write loop, then closes and throws on a later write failure. Because the assignment at `adoptWorktree.ts:522` never completes, `entry` remains null; `undo()` skips the descriptor truncate, removes `locked`, sets `collectable = true`, and returns no residue. A focused production-shaped probe wrote an existing-directory prefix, threw, and observed a residue-free failure with `locked` gone; real `git worktree prune --expire now` left that entry in place. Both logic and data/security specialists independently found the lost-handle path.
- Impact: ENOSPC/EIO or a zero-progress/failed later write can leave a partial `gitdir` that git never collects, while the user is told the withdrawal was clean. Retries mint `-2`, `-3`, and later ids around durable invisible administrative residue, directly falsifying task 8_1's routine-prune outcome.
- SuggestedFix: The achievable contract is that once the exclusive inode exists, its descriptor belongs to the adoption state machine before any fallible initialization. Return/transfer the handle first and write under outer undo, or return a failure object carrying the handle; if the inode cannot be emptied, preserve `locked`, report the entry path, and close the handle exactly once.
- Status: accepted
- Triage: New in round 8. Same failure cone as F005, but a different mechanism: the helper hides a partially initialized inode and disposes the only object-bound authority before outer withdrawal can settle it.

### F018
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/re-register-a-surviving-checkout/design.md:53`
- Title: Accepted artifacts still promise the withdrawn entry-removal contract
- Evidence: D4's title, sequence, and opening rationale still say `gitdir` is first (lines 53-80), and its undo still says to re-lstat and remove the entry unconditionally (lines 88-96), before the amendment says `locked` is first and no directory is deleted (lines 115-150). The ledger still cites `removeDir` failures and “gitdir written first” (lines 382, 389), while its new row says the entry path is reported without the “only when handoff fails” qualifier. The accepted spec likewise says branch/tip withdrawals remove the registration (lines 63, 74), an incomplete undo “cannot remove the entry” (line 131), and a partial claim leaves “no administrative entry” (line 158); its new requirement also says every collectable entry is named (lines 101-104), unlike `residueNote`, which deliberately omits clean handoffs. The contracts specialist independently confirmed the stale undo-removal scenario; the chair's full-artifact pass found the broader contradictory set. `residueNote` itself matches the narrowed implementation.
- Impact: The accepted source of truth simultaneously requires mutually exclusive outcomes. The implementation cannot satisfy both, a later builder/reviewer cannot know which requirement governs, and applying this delta would preserve the exact absolute guarantee round 7 required planning to withdraw.
- SuggestedFix: Restate one achievable contract everywhere: `locked` precedes `gitdir`; no directory is removed; successful handoff means empty gitdir plus unlocked marker and is not named; failed empty/unlock is retained locked and named; the marker unlink remains a stated non-atomic residual. Rewrite the old branch/tip/partial-write scenarios and ledger witnesses to use handoff/collection rather than removal/no-entry-left language.
- Status: accepted
- Triage: New in round 8. This is a material divergence among Gate-2-approved obligations, not editorial style.

### F019
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:56`
- Title: Exact-once closure of the new entry handle has no witness
- Evidence: The fake adds `entryClosed` and increments it in the entry handle's `close`, but no assertion reads `store.entryClosed()`. The existing deferred-undo/release test at lines 1123-1141 checks only the worktree-link handle through `wasClosed()`. Thus the requested exact-once rule for the newly introduced handle can regress to a leak or double close without failing a test.
- Impact: The lifetime claim that makes caller-deferred undo safe is not protected despite this change's repeated history of guards with vacuous witnesses.
- SuggestedFix: Assert entry-handle close count `0` while a successful result is held and exactly `1` after each `undo()`/`release()` path, including a post-construction failure; keep the link-handle assertions separate.
- Status: accepted
- Triage: New support finding in round 8; production inspection found the ordinary undo/release paths close once, but the stated witness does not prove it.


## Adjudication notes

- F005 remains gating only for the ungated success-path marker unlink. The withdrawal's identify-then-unlink interval was reviewed as the residual the caller asked to judge: D4 states that it is non-atomic and that it can make a replacement eligible for git collection. That direct effect is honestly stated, so the logic specialist's request to close the interval is rejected as a separate finding. The success path is outside that stated gate and was reproduced deleting a foreign marker.
- F017 is raised from the data/security specialist's WARN to BLOCK on materially stronger evidence: a focused real-git probe produced the clean-reported, non-collectable state, directly falsifying task 8_1 Acceptance rather than merely identifying a theoretical error path.
- F018 merges the contracts specialist's stale scenario with the chair's broader D4/ledger/spec inventory. Because Gate 2 approves these as obligations and they require incompatible behavior, this gates verification.
- The contracts specialist's identify-after-mkdir observation is not reopened: F004 deliberately chose a conservative named failure where entry identity was never captured, and no new destructive behavior was shown. The orphaned `removeDir` comment is style/cleanup and is dropped.
- Witness causality: the integration round-trip is causal to `git worktree prune` because it first proves the entry remains, then requires the post-prune directory set to equal the baseline. Moving `locked` after `gitdir` fails the unit write-order witness; the integration case alone samples at `repair` and proves marker/prune behavior, not that vulnerable ordering. The entry-gitdir alias guard is causal. No witness covers partial initialization after the inode is published, and F019 records the separate exact-once close gap.
- No audit-backlog or accepted-risk entry exists.

## Author triage record (round 8)

All four accepted, no rebuttals. None is a design change, and that is the difference from rounds 3-7:
the withdrawal's contract is settled and what these findings hit is my execution of it.

- **F005 — accepted, and it is the same gate written at one site instead of in the operation.** This
  is round-5 F013's shape exactly: the undo proves ownership before unlinking `locked` and the success
  path does not, so an entry replaced during `repair`/tip/index has its marker removed by us. Fixed by
  making the ownership proof part of the unlink rather than something a caller remembers, so both
  callers inherit it. Remediation under D4's existing rule, which already says the unlink is gated —
  the code just did not do it everywhere.
- **F017 — accepted, my bug, and the chair reproduced it against real git.** `createPinned` published
  the inode and then did a fallible write before returning the handle, so a rejection there left an
  entry the withdrawal could not empty and did not know about. The seam is wrong, not the rule: the
  descriptor must belong to the caller from the instant the inode exists. `createPinned` now returns
  the handle for an EMPTY file and `adoptWorktree` writes the bytes through it, so there is no window
  where the file exists and nobody holds it.
- **F018 — accepted, and it is the plainest failure in this round: I changed the decision and left the
  old sentences standing.** D4's title, its step table and its opening rationale, the ledger's
  `removeDir` citations, and two spec requirements still describe the removal contract that rounds 7
  and 8 retired. Nothing here is a new decision — it is deleting text the handback already superseded.
- **F019 — accepted.** `entryClosed` is incremented by the fake and read by nothing, which is a
  counter pretending to be a witness. Exactly-once closure is load-bearing now that two handles are
  held, so it gets assertions on both terminal paths.

No new `D#`, no new invariant owner, so this is a fix round rather than a fourth handback.
