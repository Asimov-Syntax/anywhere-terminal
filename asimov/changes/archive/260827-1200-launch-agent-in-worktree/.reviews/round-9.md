# Review Round 9

- Date: 2026-08-27
- Cycle: 4
- Round: 9
- Mode: discovery
- Scope: range `711c9cfae902a35a8a6f68eb8c5d92f566db70c2..acdf445030bc4e3c532de473c160d8bfe3d7fe8e`
- Head: `acdf445030bc4e3c532de473c160d8bfe3d7fe8e` (explicit range scope; checkout also had dirty analytics cursor/state files excluded from the range)
- Change context: `launch-agent-in-worktree` — Gate 2 approved; D10, D11, D12, task 10_1, and the worktree-tree protocol requirements are accepted obligations
- Cycle context: round 8 superseded cycle 3 without adjudication; cycle 4 re-opens discovery around D12 and verifies the round-7 B5/W8/W6 gate set at current Head
- Reviewable lines: 91 added lines across reviewable production/state files; tests reviewed inline; changed Markdown was skipped as review content but approved change artifacts were read as intent/contract context
- Large-change note: not triggered
- Agents spawned:
  - asm-review-logic — observation authority, removal interleavings, carried gates — `gpt-5.6-sol[1M]`
  - asm-review-contracts — D12 launch/removal contract and destructive boundary coverage — `gpt-5.6-terra[1M]`
  - asm-review-frontend — carried rendered-identity and exact-boundary gates — `sonnet[1M]`
  - asm-review-performance — cache read growth and allocation cost — `gpt-5.6-luna[1M]`
  - asm-finder — full launch/removal authority flow and consumer inventory — `gpt-5.6-luna[1M]`
- Agents skipped:
  - asm-review-data-security — no persistence, auth, secrets, or new external-input boundary; destructive command safety was covered by logic/contracts across the full removal flow
  - asm-review-reuse — the new helper consolidates the three visible generation consumers; no mirrored implementation, split, parser, mapper, or repository capability was reimplemented
- Verdict: BLOCK
- Counts: 1 BLOCK | 1 WARN | 1 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` exits 0 and records task 10_1 at exit 0 with added-only boundary tests. No project type check, lint, or test command was run during review.

## Findings

### B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:1736`
- title: Removal authority can survive a concurrent withdrawal
- evidence: `assessRemoval()` captures `found = locate(...)` before awaiting both `runner.run(["status", "--porcelain"])` and `facts.externalSessions()`, then computes `listingDegraded` from `observationOf(found.repo)` on that old snapshot. Rebuilds acquire no mutation lock, and the rebuild gate serializes per scope rather than against the mutation body, so a watcher-driven repo rebuild or a whole-tree refresh can land during either await. If that rebuild retains a failed listing or makes git globally unusable, the current cache publishes no generation, but the captured repo still carries its prior generation and the assessment can authorize the destructive command. The post-attempt path repeats the same causal split at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:475`: it checks `bindings.isDegraded()` before awaiting `fsp.stat()`, then reads `bindings.resolve()` afterwards, so classification can combine authority and registration from different observations.
- impact: A removal can proceed after the repository's observation authority has been withdrawn, violating D12 and the protocol requirement that an unobserved repository authorizes no removal. After an attempted removal, the result can also be classified from mixed generations and report a clean result where the authoritative post-attempt listing became unavailable.
- suggestedFix: Treat the generation as a versioned observation token across the async removal flow. For pre-assessment, capture the target/listing generation, perform the async fact reads, then re-locate and require the same still-present generation before returning an authoritative assessment. For post-attempt observation, read registration plus authority from one current snapshot after the filesystem probe, or capture and revalidate the same generation across that probe. Add controlled interleaving regressions for a listing failure/global withdrawal during assessment and during post-attempt observation.
- status: open
- triage: new in cycle 4 discovery. Corroborated independently by chair full-flow trace and asm-review-logic. BLOCK remains HIGH because the affected side effect is destructive and the repo/whole rebuild paths are allowed to interleave with the mutation body's async reads.
- invariant: A repository observation that authorizes destructive removal must remain the same valid observation across every asynchronous fact-read, command-handoff, and post-attempt classification boundary.
- boundary inventory:
  - affected: pre-removal `status` await; pre-removal external-session await; watcher-driven repo rebuild during assessment; whole-tree refresh during assessment; post-attempt authority check followed by filesystem `stat`; registration resolution after that `stat`
  - verified safe: settled-state launch admission and handoff; settled-state removal assessment; stable global-unavailable reads; repo-local applies while global git is already unavailable; unwatched-but-successfully-listed repositories; round-7 rendered Resume identity capture

### W9

- ID: W9
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.actions.test.ts:1824`
- title: D12's destructive boundary is tested only at host bindings
- evidence: The new global-git-loss test calls `host.mutationBindings().assessRemoval()` directly, and the unwatched case does the same. Neither composes `createWorktreeMutationService`, invokes `removeWorktree()`, nor asserts that the runner received no `git worktree remove`. Production consumes the binding at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:285-350` and wires post-attempt observation separately in `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:462-489`.
- impact: The suite can stay green if the helper predicates remain correct but the destructive service bypasses, miswires, or mishandles `unavailable`; it also does not exercise the post-attempt D12 boundary where B8 occurs.
- suggestedFix: Add a composed host-plus-mutation-service regression that stages authority withdrawal, calls `removeWorktree`, asserts an `unavailable` outcome, and proves no remove command ran. Add the unwatched negative through the same service, plus deterministic interleavings for B8's assessment and post-attempt windows.
- status: open
- triage: new in cycle 4 discovery. Separate from round-7 W6, whose three requested boundaries are now covered; this warning concerns the newly approved destructive D12 execution boundary.

### S3

- ID: S3
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:283`
- title: Git-unavailable reads allocate a second repository object per repository
- evidence: `read()` already creates one output object and one worktree-array copy per repository, then the git-unavailable branch maps the output and shallow-clones every repository again solely to omit `generation`, with a possible third object where the global reason must be added.
- impact: Repeated reads during an outage create avoidable garbage proportional to repository count. Repository count is bounded by workspace roots and worktree arrays are not recopied by the new map, so there is no unbounded growth or demonstrated user-visible regression.
- suggestedFix: Omit `generation` while constructing `out` when global git is unavailable, reuse `out` when no reason must be added, and clone only repositories that need a degraded reason attached.
- status: open
- triage: new in cycle 4 discovery. Downgraded from the performance specialist's WARN/P2 to SUGGEST/P4 because the extra work occurs only in the degraded path, scales with structurally bounded workspace repositories, and does not copy worktree records or accumulate state.

## Fixed carried findings

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:532`
- title: Resume Here freezes registration identity at the rendered menu boundary
- evidence: `WorktreeContextMenu.openForAgent()` calls `captureTarget` synchronously before building/opening the menu; `captureMenuTarget()` freezes row id, worktree id, and generation; `resumeHere()` posts only that frozen target and checks the row id. The exact generation A -> generation-only B -> retained menu click regression asserts A is posted.
- impact: The prior replacement-identity handoff is closed.
- suggestedFix: implemented in `711c9cf`.
- status: fixed
- triage: round-7 accepted finding verified fixed at current Head; acdf445 does not reopen it.

### W8

- ID: W8
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:116`
- title: Listing and watcher degradation remain independent and truthful
- evidence: listing degradation remains on the cached repo, watcher failure is stored separately as `unwatched`, successful repo rebuilds preserve that claim, and `read()` composes both with the listing failure first. Watch recovery clears only the watcher claim. Generation remains present for observed-but-unwatched listings and absent for retained listings.
- impact: D11's stale-data disclosure and authority boundary now agree.
- suggestedFix: implemented in `711c9cf`.
- status: fixed
- triage: round-7 accepted finding verified fixed at current Head; D12 reuses generation and does not re-conflate display degradation.

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.test.ts:788`
- title: Round-7 exact boundary coverage is now explicit
- evidence: the suite now covers menu-open generation A -> generation-only B -> click, launch handoff across an unrelated repository rebuild, and observed-but-unwatched launch together with its stale-data warning.
- impact: The three causal boundaries requested by round 7 can no longer pass only incidentally.
- suggestedFix: implemented in `711c9cf`.
- status: fixed
- triage: round-7 accepted finding verified fixed at current Head. W9 is a new D12 destructive-service coverage gap, not persistence of W6.

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
- triage: carried forward, non-gating

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
- triage: carried forward, non-gating

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
- triage: carried forward, non-gating

---

## Author triage (round 9)

**[B8] Removal authority can survive a concurrent withdrawal — Status: accepted**

Triage: correct, and it is the change's recurring defect shape at the one boundary
the fix never reached. D10 already made a launch re-read its observation after the
await that separates admission from acting; `assessRemoval` and `observeAfter` were
left reading theirs once and trusting it across `git status`, `externalSessions()`
and `fsp.stat`. D12 says removal asks the same claim as a launch, so it must also
ask it at the same moments. Fixed at both listed boundaries with an invariant-level
test each: the observation is captured, and re-checked after every await that
separates reading from acting. A withdrawal or an advance in between fails closed.

**[W9] D12's destructive boundary is tested only at host bindings — Status: accepted**

Triage: this change's own round-3 finding was that module-level tests cannot see
wiring defects, and the binding-level tests here are exactly that. Covered in the
assembly walk, which drives the real mutation service through the real host.

**[S3] Git-unavailable reads allocate a second repository object — Status: accepted**

Triage: trivial and it removes a clone rather than adding a branch, so the cheaper
form is also the simpler one.
