# Review Round 10

- Date: 2026-08-27
- Cycle: 4
- Round: 10
- Mode: verification
- Scope: range `acdf445030bc4e3c532de473c160d8bfe3d7fe8e..e40429c411d49b11ef1b3e623a7bc4da1513098d`
- Head: `e40429c411d49b11ef1b3e623a7bc4da1513098d` (explicit range scope; checkout analytics cursor/state changes were excluded)
- Change context: `launch-agent-in-worktree` — Gate 2 approved; D12, task 11_1, and round-9 B8/W9/S3 are the accepted verification obligations
- Scope lock: passed — the range contains only round-9 remediation, focused tests, and review/build/task metadata; it adds no new capability or semantic contract
- Reviewable lines: 62 changed lines across 3 reviewable production files; tests reviewed inline
- Agents spawned:
  - asm-review-logic — observation authority through destructive command handoff — `gpt-5.6-sol[1M]`
  - asm-review-contracts — shared binding contract and assembled destructive boundary — `gpt-5.6-terra[1M]`
  - asm-review-performance — degraded cache-read allocation and semantics — `gpt-5.6-luna[1M]`
- Agents skipped:
  - asm-review-data-security — no persistence, auth, secrets, or external-input boundary changed; destructive authority was covered by logic/contracts
  - asm-review-frontend — no webview behavior changed in the remediation cone
  - asm-review-reuse — no helper, split, parser, mapper, or repository capability was introduced or mirrored
- Verdict: BLOCK
- Counts: 1 BLOCK | 0 WARN | 0 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` exits 0 and records task 11_1 at exit 0 with scope unchanged and added-only tests plus two mechanical renames. The author reports 4,400 tests passing, types clean, and 13 pre-existing lint findings confined to untouched files.

## Open findings

### B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:1737` and `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:285-347`
- title: Removal observation token is discarded before destructive command handoff
- evidence: `assessRemoval()` now revalidates observation N after its status and external-session awaits, but returns only `RemovalAssessment`; N is not carried to its consumer. `removeWorktree()` resumes after `await deps.assessRemoval(target)` and invokes `git worktree remove` without another observation check. The return-to-caller handoff is itself an asynchronous boundary: a watcher/global-rebuild continuation already queued behind `assessRemoval`'s final continuation can apply N+1 or withdraw authority after line 1737, before the mutation service's await continuation reaches line 347. The new tests make rebuild finish inside `externalSessions()`, so the internal recheck sees it; none stages movement after assessment returns and before the command.
- impact: A removal can still execute after the observation that authorized its assessment has changed or disappeared. A remove-and-recreate at the same path can therefore let evidence gathered for the prior registration authorize deleting its replacement, violating D12's destructive command-handoff invariant.
- suggestedFix: Carry the captured observation with the assessment and revalidate it synchronously at the mutation service immediately before calling `removeWorktree`, with no intervening await; alternatively expose a host operation that validates the token and begins command handoff atomically. Add a composed regression that pauses after assessment returns, advances or withdraws the repository observation, resumes, and proves no remove argv is issued.
- status: open
- triage: persists from round 9. The remediation closes the status await, external-session await, and post-attempt stat boundaries, but drops the same token before the caller's `await assessRemoval` continuation reaches the destructive command. Severity and confidence remain unchanged because this is the same invariant, causal mechanism, and destructive impact; corroborated independently by chair and asm-review-logic.
- invariant: A repository observation that authorizes destructive removal must remain the same valid observation across every asynchronous fact-read, command-handoff, and post-attempt classification boundary.
- boundary inventory:
  - affected: `assessRemoval` promise return / caller await continuation through the `git worktree remove` handoff; watcher-driven repo rebuild or whole-tree/global withdrawal queued between those continuations
  - verified safe: status await and external-session await when movement completes before the new recheck; post-attempt filesystem stat followed by registration resolution; observation absent before either reader; stable ordinary removals; successfully listed-but-unwatched removals; unrelated repository rebuilds

## Fixed findings

### W9

- ID: W9
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.worktreeAssembly.test.ts:391`
- title: The assembled destructive boundary now proves an unobserved repository runs no remove command
- evidence: The new walk assembles the real host and mutation service, makes `git worktree list` fail, forces the repository rebuild, enters through the rendered Remove item, and asserts the runner recorded no `worktree remove`. The pre-existing passing removal uses the same VS Code harness without `createFileSystemWatcher`, so it also proves an observed-but-unwatched repository remains removable.
- impact: The prior host-binding-only coverage gap is closed for both the unobserved refusal and unwatched allowance at the shipped menu-to-git boundary.
- suggestedFix: implemented in `e40429c`.
- status: fixed
- triage: round-9 accepted finding verified fixed. B8's remaining final-handoff race is carried under B8's invariant rather than reopening W9 as a separate coverage warning.

### S3

- ID: S3
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:256`
- title: Git-unavailable reads withhold generation during output construction
- evidence: `read()` now omits `generation` while constructing `out` whenever global git is unavailable. It reuses `out` when there is no global reason and maps only to clone repositories that need the reason attached; repositories already carrying a specific degradation are reused. Ordering, unreadable aggregation, generation withholding, reason precedence, and the per-read worktree-array copy remain unchanged.
- impact: The outage path no longer allocates an unconditional second repository object per workspace repository.
- suggestedFix: implemented in `e40429c`.
- status: fixed
- triage: round-9 accepted finding verified fixed; no regression in the bounded repository-count growth axis.

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
- triage: carried forward unchanged; outside the round-10 verification cone and non-gating

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
- triage: carried forward unchanged; outside the round-10 verification cone and non-gating

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
- triage: carried forward unchanged; outside the round-10 verification cone and non-gating

---

## Author triage (round 10)

**[B8] Removal observation token is discarded before destructive command handoff — Status: accepted**

Triage: correct, and my round-9 impact manifest missed it — I enumerated the reads
inside `assessRemoval` and the reads inside `observeAfter`, and never the gap
between them, where the caller resumes from an `await` a queued rebuild
continuation can beat. Fixed by capturing the observation in the coordinator
BEFORE it assesses and re-asking it immediately before `removeWorktree`, with no
`await` in between — a wider window than returning the token from the assessment,
and closed at the only place that issues the destructive command.
