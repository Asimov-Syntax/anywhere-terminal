# Review Round 11

- Date: 2026-08-27
- Cycle: 4
- Round: 11
- Mode: verification
- Scope: range `e40429c411d49b11ef1b3e623a7bc4da1513098d..b26aeb50a63293c2ecee9fa6153dc6fb0ac355d7`
- Head: `b26aeb50a63293c2ecee9fa6153dc6fb0ac355d7` (explicit range scope; dirty checkout analytics after HEAD were excluded)
- Change context: `launch-agent-in-worktree` — Gate 2 approved; D12, task 12_1, and accepted round-10 B8 are the verification obligations
- Scope lock: passed — the range contains only B8 remediation, focused tests, and review/build/task metadata; it adds no new capability or semantic contract
- Reviewable lines: 22 changed lines across 2 reviewable production files; tests reviewed inline
- Agents spawned:
  - asm-review-logic — destructive observation through command handoff — `gpt-5.6-sol[1M]`
  - asm-review-contracts — synchronous dependency and production assembly — `gpt-5.6-terra[1M]`
- Agents skipped:
  - asm-review-data-security — no persistence, auth, secrets, external input, or new security boundary changed; destructive authority was covered by logic/contracts
  - asm-review-frontend — no webview behavior changed; the established unavailable-result route was verified inline
  - asm-review-performance — no collection, growth axis, recompute, or hot-path allocation changed
  - asm-review-reuse — no helper, parser, mapper, split, or duplicated repository capability was introduced
- Verdict: WARN
- Counts: 0 BLOCK | 1 WARN | 0 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` exits 0 and records task 12_1 at exit 0, scope unchanged, with four added assertions. Its recorded command is `pnpm run check-types && pnpm run test:unit`; the author reports 4,404 tests passing, types clean, and 13 pre-existing lint findings in untouched files.

## Open findings

### W10

- ID: W10
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.test.ts:357-372`
- title: The regression can pass with the observation check on the wrong side of the await
- evidence: The test makes `observation()` return `1` and then `2`, independently of the `assessRemoval` promise lifecycle. An implementation that performs both observation reads before `await deps.assessRemoval(target)` would also receive `1` then `2`, return the same `unavailable` outcome, issue no runner call, and satisfy every assertion. The test therefore proves that two unequal reads refuse, but not task 12_1's boundary: the second read occurs after the assessment resolves and immediately before command handoff.
- impact: The production fix is correctly placed today, but a future refactor can move the check back before the asynchronous handoff, reopen the destructive B8 race, and leave this regression green.
- suggestedFix: Drive the observation change from the assessment lifecycle. For example, return a controlled thenable that resolves the assessment and then flips the current observation before the awaiting continuation resumes; a pre-assessment comparison would then see `1 === 1` and the test would fail by issuing the remove command, while the current post-assessment comparison sees `2 !== 1` and refuses.
- status: open
- triage: new within the B8 verification cone. This is support coverage, not a present production defect, so it does not reopen B8 or block the implementation; it remains WARN because the uncovered regression can authorize irreversible deletion.

## Fixed findings

### B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:295-368` and `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:469`
- title: Removal observation remains valid through destructive command handoff
- evidence: The coordinator now captures `deps.observation(target.repoId)` before `await deps.assessRemoval(target)` and compares the same repository observation synchronously at line 364 immediately before calling `removeWorktree`. `removeWorktree` performs only synchronous validation/argv construction before invoking `runner.run`, and the production runner calls `execFile` synchronously inside its Promise executor, so no event-loop boundary exists between the comparison and command handoff. Production supplies the same `bindings.observation` authority used by `assessRemoval`; an absent initial observation makes the assessment unavailable, changed or withdrawn authority fails the final comparison, and per-repository generations are monotonic. Ordinary clean and confirmed forced removals share this check; forced redemption consumes the token before it and the mismatch path also calls `spend()`. The existing `unavailable`/`listing` shape is serialized and rendered as “nothing was changed.” Both specialists independently found no remaining production defect.
- impact: Evidence gathered for one repository observation can no longer authorize `git worktree remove` after a rebuild, git withdrawal, or remove-and-recreate has replaced that observation. The original irreversible replacement-deletion race is closed at the only coordinator that hands off the destructive command.
- suggestedFix: implemented in `b26aeb5`.
- status: fixed
- triage: round-10 accepted blocker verified fixed at the invariant level. Capturing before assessment deliberately covers the assessment plus caller handoff, a wider interval than returning the assessment's internal token.
- invariant: A repository observation that authorizes destructive removal must remain the same valid observation across every asynchronous fact-read, command-handoff, and post-attempt classification boundary.
- boundary inventory:
  - verified safe: status await and external-session await inside `assessRemoval`; assessment promise return/caller continuation; forced fingerprint redemption; synchronous coordinator-to-`removeWorktree` handoff; runner-to-`execFile` handoff; post-attempt stat and registration comparison; authority absent before assessment; authority changed or withdrawn during assessment; stable ordinary removals; stable forced removals; successfully listed-but-unwatched repositories; unrelated repository rebuilds
  - affected: none remaining in the reviewed behavioral cone

## Audit backlog

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeDialogShell.ts:38`
- title: Continue and worktree dialogs maintain parallel modal lifecycles
- evidence: The duplicated focus, Escape, disposal, and focus-restoration lifecycles predate this range.
- impact: Lifecycle fixes can drift between dialog families.
- suggestedFix: Consider a separate refactor that generalizes the worktree shell for Continue.
- status: audit-backlog
- triage: carried forward unchanged; outside the round-11 verification cone and non-gating

### AB1

- ID: AB1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:290`
- title: The prune dialog remains outside `closeDialog` ownership
- evidence: `openPruneDialog()` opens its dialog without assigning the returned disposer. This path predates and is outside the reviewed range.
- impact: A later dialog can stack over an open prune confirmation and leave its listener/focus trap mounted.
- suggestedFix: Address prune dialog ownership in the change that owns that pre-existing path.
- status: audit-backlog
- triage: carried forward unchanged; outside the round-11 verification cone and non-gating

### AB2

- ID: AB2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/LaunchBuilder.ts:234`
- title: Entry-backed Continue still ignores an explicit posture for a zero-choice agent
- evidence: `permissionArgs()` returns an empty list for an agent with no permission choices before consulting a supplied choice. This older Continue path is unchanged and outside the reviewed range.
- impact: The posture truthfulness rule is not universal across the older Continue path, but WT-005.3 did not introduce or worsen it.
- suggestedFix: In a change owning Continue admission, validate an explicit choice before the empty-choice fallback.
- status: audit-backlog
- triage: carried forward unchanged; outside the round-11 verification cone and non-gating

---

## Author triage (round 11)

**[W10] Regression can pass with the observation check on the wrong side of the await — Status: accepted**

Triage: correct — the test proved the refusal, not the ordering, and the ordering IS
the finding. Fixed by advancing the observation from inside `assessRemoval`, after it
resolves and before the coordinator's continuation resumes: an implementation that
compared before the await sees no movement, issues the command, and fails.
