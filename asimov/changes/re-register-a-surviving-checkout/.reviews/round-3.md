# Review Round 3

- Date: 2026-09-03
- Cycle: 1
- Mode: verification
- Review lane: fastlane
- Arbiter: yes
- Status: blocked
- Scope: range `3fe2103b5f13ca1db0d547ab273cdcf3e5c9e0bf..5de99febf5a38948e71547a852bd2d1b29c88e54`
- Head: `5de99febf5a38948e71547a852bd2d1b29c88e54` (tree dirty after the reviewed range only because `round-start` updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 85
- Large change: no
- Scope lock: passed — the range contains only round-2 remediation, its witnesses, and review/task metadata; it adds no capability, accepted-contract change, or new invariant owner
- Recorded Verify Gate: `check-types` clean; 7198 tests across 287 files passed under `UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6`; `gate:fs-deletion` and `build:check-requires` passed; `bun run asm change verify-status re-register-a-surviving-checkout` exited 0. Review ran no project verify command.
- Targeted chair probe: an injected `AdoptFs.writeFile` changed `<wt>/.git` to `ourLink` and then rejected. `adoptWorktree` returned a clean failure without residue, removed its administrative entry, and left `.git` pointing at the removed entry. The probe was inline and created no file.
- Agents spawned:
  - `asm-review-logic` — adoption identity and rollback — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — filesystem trust boundaries — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — verdict byte propagation — `sonnet[1M]`
- Agents skipped:
  - `asm-review-frontend` — no UI behavior is in the remediation cone
  - `asm-review-performance` — no persistence collection, growth axis, recompute, or hot-path accumulation is in the cone
  - `asm-review-reuse` — no helper, parser, validator, or split duplicates an existing capability in this delta
- Verdict: REJECT
- Counts: 3 BLOCK, 0 WARN, 0 SUGGEST
- Thrash stop: tripped — F005 and F006 each survive a second fix attempt against the same invariant; the change must return to planning rather than receive another patch in this cycle

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1122`
- Title: Adopt submission is not bound to the host-issued resolution
- Evidence: Round 2 verified the host-issued publication binding and its withdrawal lifetime across path, branch, OID, destination, surface, repository, and opening.
- Impact: The prior webview-to-host authority bypass remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; this remediation does not disturb the binding.

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptProbe.ts:73`
- Title: The surviving checkout is never bound to the current repository
- Evidence: The stale gitdir remains constrained to a direct entry under the normalized current repository common directory, and the same `repoId` reaches reconstruction.
- Impact: The prior cross-repository adoption path remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged by this range.

### F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:151`
- Title: Filesystem read failures are still converted into proof of absence
- Evidence: The opening link read now catches rejection and returns before `createEntry`; `null` or differing bytes also refuse before any mkdir. `adminDirIsThere` now throws when `stat` succeeds on a non-directory, so both probes classify it as unreadable. Invariant inventory — boundaries searched: offer and mutation probes, production adapter, opening snapshot, final reread, undo; affected: none remaining from F003; verified safe: permission/read failures, absence, non-directory target, and differing opening bytes.
- Impact: The destructive rollback witness from round 2 is closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 3. The accepted F003 witness now returns before any state is created or cleanup is reachable.

### F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:343`
- Title: Identity failure after mkdir leaks an unreported administrative entry
- Evidence: The created entry path and unreadable state remain present in the failure message reaching the user.
- Impact: The prior silent residue remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged by this range.

### F005
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:205`
- Title: Undo still has a check-then-write window that crosses link ownership
- Evidence: After `installed`, undo reads `linkPath` at line 206 and proves `now === ourLink`, then performs a separate `writeFile(linkPath, request.staleLink)` at lines 209-212. An external process can replace the link between those filesystem operations; cleanup then overwrites that registration with stale bytes. The new substitution witnesses move the link before undo's read and therefore cannot exercise this interval. This is not the settled final-claim window: it is a second unacknowledged read-then-write in failure cleanup. Invariant inventory — boundaries searched: failures before the final write, successful final write, entry identity cleanup, link substitution before undo read, link substitution after undo read; affected: substitution after undo's ownership read; verified safe: failures before installation and substitutions visible before undo's read.
- Impact: A failed adoption can still destroy another process's registration and may report its withdrawal as clean.
- SuggestedFix: Do not restore through a non-atomic ownership check. Without an ownership-preserving conditional primitive or accepted lock discipline, leave the installed entry/link intact and report residue rather than writing stale bytes over a path that can change concurrently.
- Status: accepted
- Triage: Persists from round 2. The same link-ownership invariant has now survived a second fix attempt, so the thrash stop is tripped and this requires planning handback rather than another local patch.

### F006
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:257`
- Title: The final stale-link proof precedes another filesystem await
- Evidence: The exact corroborated bytes now reach both reconstruction reads, closing the pre-reconstruction self-comparison defect. However, after the final link read at line 257, the function may await `${request.staleGitdir}/gitdir` at line 267 before writing at line 272. A registration can replace `<wt>/.git` during that additional filesystem operation and then be overwritten. The comment claims only the unavoidable instant between the final checks and write remains, but the implementation places an unrelated filesystem read inside that link-specific interval. Invariant inventory — boundaries searched: single-read raw production, verdict/request propagation, opening proof, entry creation, stale-target claim, final link proof, final write; affected: ordering of stale-target claim after final link proof; verified safe: changes before the opening read and changes before the final link read.
- Impact: A live registration restored during the stale-entry read can still be adopted over.
- SuggestedFix: Complete the stale-target inspection first, then perform the final `<wt>/.git` read immediately before its write. This preserves the settled non-atomic syscall gap without widening it with another await.
- Status: accepted
- Triage: Persists from round 2. The exact-byte mechanism is correct, but the same live-registration invariant survives at the final ordering boundary for a second fix attempt; the thrash stop is tripped.

### F007
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/reattachProbe.ts:140`
- Title: A malformed gitfile is accepted as adoption authority
- Evidence: `readGitLink` still requires Git's prefix at byte zero and carries the accepted file's exact text without loosening its grammar.
- Impact: The malformed-file authority defect remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged by this range.

### F008
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:2024`
- Title: A late refs reply desynchronizes adopt from its form controls
- Evidence: The resolved-mode guard remains intact and is outside this remediation delta.
- Impact: The prior form desynchronization remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2.

### F009
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:283`
- Title: The branch-tip guard runs after index reconstruction
- Evidence: Repair is still followed by the tip read and only then `reset --mixed`.
- Impact: The accepted D4 ordering remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2.

### F010
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-reuse`, `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:881`
- Title: Adoption bypasses the repository's capability-aware common-dir resolver
- Evidence: Corroboration and reconstruction still share the normalized `repoId` common directory.
- Impact: The prior resolver divergence remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2.

### F011
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:311`
- Title: Non-collision entry failures are reported as name exhaustion
- Evidence: Non-`EEXIST` failures retain their own reason; only actual collision exhaustion receives the exhaustion message.
- Impact: The prior misleading diagnosis remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2.

### F012
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:272`
- Title: A rejected final write can mutate the link without becoming owned
- Evidence: `installed` becomes true only after `await fs.writeFile(linkPath, ourLink)` fulfills. A write can truncate or change the file and then reject; the catch calls `failed()` with `installed === false`, so undo removes the administrative entry without reading or restoring the changed link and reports no residue. The chair's injected probe wrote all of `ourLink` and then rejected; the result was `{ ok: false }` without `leftBehind`, the entry was removed, and `.git` still pointed at that removed entry. Existing tests reject before mutating their store, so they do not witness this allowed failure shape.
- Impact: An ordinary write failure can leave a broken or partial `.git` link while the panel reports a clean failure, violating both the restore and residue-reporting obligations.
- SuggestedFix: Treat the final write outcome as indeterminate until its post-failure state is observed. Do not remove the entry or report clean withdrawal when the link may point to it; preserve a coherent entry/link pair and report residue unless ownership and restoration can be guaranteed.
- Status: accepted
- Triage: New in the round-2 remediation delta. This is independently actionable from F005's external-substitution window: it occurs when the adoption's own write mutates state and rejects before the success-only ownership flag is set.

## Arbiter dispositions

- F005 — `accepted`: both logic and data-security independently found the cleanup read/write gap, and direct code ordering shows it can overwrite a post-check replacement. It is load-bearing to the fail-clean obligation and is the second failed fix of the same invariant.
- F006 — `accepted`: the exact bytes are correctly propagated, but another filesystem await remains between the final link proof and write, making the residual materially wider than the stated settled limitation. It is load-bearing to the live-registration obligation and is the second failed fix of the same invariant.
- F012 — `accepted`: the injected dependency witness demonstrates a cleanly reported failure leaving a dangling link after a write that changed bytes and rejected. The defect is in the reviewed remediation path and directly falsifies the accepted failure contract.

## Adjudication notes

- The contracts specialist verified that `GitLink.file.raw` is sourced from the same read, propagated unchanged through `AdoptVerdict` and `AdoptRequest`, and represented consistently at all typed call sites. That closes the interface half of F006 but does not refute the reconstruction-local ordering defect.
- F005's post-check replacement and F012's rejected-after-side-effect write are separate actionable mechanisms: the former overwrites external state during cleanup; the latter leaves this adoption's own failed mutation behind while claiming cleanup succeeded.
- No finding outside the verification impact cone was admitted. No audit-backlog or accepted-risk entry exists.

## Author triage record (round 3)

I verified all three against the code before accepting; none is taken on the reviewer's word.

- **F005** — `adoptWorktree.ts:205-210`. The undo reads, compares to `ourLink`, then writes in a
  separate operation. Correct as reported.
- **F006** — `adoptWorktree.ts:257-271`. `readFile(linkPath)` is followed by an awaited
  `readFile(<staleGitdir>/gitdir)` before the write. The comment claims the residual is "the instant
  between these reads and the write"; it is in fact a whole filesystem round-trip wider. The
  mis-statement is the part I take hardest — the residual was recorded, and recorded wrong.
- **F012** — `adoptWorktree.ts:272`. `fs.writeFile` opens with `w`, which TRUNCATES before the first
  byte is written. A rejection therefore leaves `<wt>/.git` empty or partial while `installed` is
  still `false`, so the undo — correctly, under its own rule — leaves it alone, removes the entry,
  and reports a clean withdrawal over a `.git` that now names nothing. This one is worse than the
  window findings: it needs no second process at all.

**Thrash stop tripped**, on the chair's reading and mine: F005 and F006 are each a second failed
attempt at the same invariant. Of the three permitted options, 2 (risk-accept) and 3 (a bounded
extension round) both require the user's own grant, which I do not have. Option 1 applies and is
what the standing instruction for this branch already authorizes: hand back to `asimov-plan`.

**Remediation-boundary judgement — handback, not fixes.** F006 alone would be in-contract
remediation: reordering two reads changes no `D#`. F005 and F012 are not. Both are answered only by
deciding what a half-written or non-atomically-owned link IS — restore it, or leave a coherent pair
and report residue — and that is D4's undo contract, stated in design.md as "every failure withdraws
what it wrote". Changing it changes the meaning of a failed adoption to its caller and to the user
who reads the message. Patching all three locally would land a design change as a fix commit and
close the cycle as superseded. So no fix edits were made in this round.

**Fix hypothesis carried into planning, so it does not start from zero.** The three findings are one
missing primitive: this code proves things about a PATH and then writes to that path by name. The
tier that is reachable in pure Node — and the one cmux uses at every lock site rather than anchoring
(`docs/PLAN.md` WT-012.21 notes: open absolute, then validate the open descriptor with `fstat`,
never the path) — is to open `<wt>/.git` ONCE, prove identity and read its bytes through that
handle, and write through the same handle. A replacement by rename or unlink+create changes the
inode, so the handle keeps pointing at the file that was proved and the write cannot land on the
replacement. That is one mechanism for all three sites: the final claim, the undo restore, and the
indeterminate-write case, which the handle also makes recoverable because the file is still open
when the write rejects. It needs `O_TRUNC` off, an explicit truncate-and-write through the handle,
and a decision about what a rejected write reports — which is exactly the D4 amendment.
