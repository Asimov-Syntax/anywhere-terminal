# Review: never-release-a-lock-a-pending-write-still-owns cycle 1 / round 1 — discovery

## Decision

### VERDICT: REJECT

**Why:** Four gating defects still let deadline classification misreport or retain the wrong state, relabel committed replacement as failure, or present the retained lock inaccurately.

**Blocking:** 4 | **Warnings:** 1 | **Suggestions:** 0

**Split:** 4 feature / 0 machinery gating blockers.

## Review metadata

- Date: 2026-09-02
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: range `696d08109b4f2901e54d2789d2b6cbb50ff2e223..HEAD`
- Head: `e76ad2f56bc802a9c8633f2da359d69478e1cda8` (product tree clean; only generated `asimov/changes/never-release-a-lock-a-pending-write-still-owns/analytics.json` was untracked)
- Reviewable lines: 936
- Note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — `LockedFile` deadline state, late operations, and successor-safe release — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — port publication, cleanup, and shared exclude deadline — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — warning union and Worktree panel truthfulness — `sonnet[1M]`
  - `asm-review-data-security` — carried filesystem authority across selected writes — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — shared directory/identity authorization ownership — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-contracts` — no schema, route, or validation-pattern surface beyond the warning union reviewed by frontend and chair
  - `asm-review-performance` — no uncapped growth axis introduced; the changed flow adds transaction bounds
- Verification evidence: `bun run asm change verify-status never-release-a-lock-a-pending-write-still-owns` records tasks `1_1` through `1_3` exit 0. Caller supplied: task `1_3` focused suites passed 253 tests; exact `pnpm run check-types` passed; exact `pnpm run test:unit` passed 282 files / 6,693 tests; `pnpm exec biome check src` has only three pre-existing clean-tree format errors in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`; all six task files pass targeted Biome. Review did not rerun project verification commands.
- Verdict: REJECT
- Counts: BLOCK 4 | WARN 1 | SUGGEST 0
- Review master session id: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `asm-review-logic`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/utils/lockedFile.ts:86`
- title: Wall-clock expiry can lose to an in-flight protected operation
- evidence: `MutationGate.run()` consults `deadline.expired` only before starting the step, then races the step solely against `deadline.elapsed`. `afterDelay.expired` is wall-clock-derived, while the timer resolving `elapsed` may run later. If an exclusive open, link, rename, or other protected mutation settles after the wall-clock deadline but before the timer callback, `run()` returns success and never latches the observed wall-clock expiry. A targeted scratch probe set `expired = true` while a guarded mutation was pending, resolved the mutation without resolving `elapsed`, and `withLock()` returned `{ kind: "done", value: "published" }`. The same gap lets `open` become false and later true again if the clock moves backward before the timer callback, because the getter does not latch the wall-clock observation.
- impact: A protected publication may land after expiry and be reported successful, or a late exclusive open may be treated as a clean timeout and released instead of retained. This violates D1/D2/D5 and the accepted no-late-publication invariant.
- suggestedFix: Permanently latch the gate when either `deadline.expired` is observed or `deadline.elapsed` resolves. Recheck the latched/wall-clock state when every guarded operation settles; if expiry occurred while it was pending, classify it dirty, reject with `GateClosed`, and run any late-value cleanup. Add acquisition and publication witnesses where wall-clock expiry precedes timer resolution.
- status: accepted
- triage: Accept — latch wall-clock observation at protected-operation settlement and add wall-clock-first acquisition/publication witnesses; this implements D1/D2/D5 without changing their contract.
- invariant: Once either deadline signal says expiry, the gate never reopens; a protected operation crossing that instant is dirty even if the timer callback is delayed.
- boundary inventory:
  - affected: exclusive lock open; staged-file mutations; create link; replace rename
  - verified safe: timer-first expiry permanently closes the current gate; already-spent deadlines refuse a new exclusive open
  - not safe: wall-clock-first expiry while an operation is in flight; backward-clock movement before timer resolution

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `chair`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/utils/lockedFile.ts:349`
- title: A committed replace is relabeled as a timeout while handle cleanup stalls
- evidence: `commit("replace")` completes the guarded atomic rename, marks the temporary non-live, and then awaits `closeHandle()` before returning `true`. `withLock()` races the entire work callback against the deadline. If rename has committed the target but the file-handle close stalls, the deadline wins after the mutation is complete and `withLock()` returns `timedOut`. A targeted scratch probe waited until the injected rename completed, allowed the mutation gate to settle, then expired the deadline while the staged handle close remained pending; the result was `{ kind: "timedOut" }` although the replacement had already published.
- impact: Updating an existing `.env.worktree` or repository-local `info/exclude` can succeed on disk while the caller reports every selected port or the exclude update as failed. This directly violates D3/D6 and the specification that committed work remains successful when cleanup is late.
- suggestedFix: Make atomic rename the replace commit point. Return committed success before waiting on handle close, and treat close as bounded post-commit cleanup that cannot rewrite the authoritative outcome; expose a cleanup warning only if user action is required.
- status: accepted
- triage: Accept — make rename the replace commit point and observe handle close asynchronously so cleanup latency cannot rewrite committed success, as D3/D6 already require.
- invariant: Once link or rename has published the target, later cleanup latency cannot change success into failure.
- boundary inventory:
  - affected: replace commit for existing port claims; `atomicReplace` for `info/exclude`; any deadline-aware replace consumer
  - verified safe: create-link publication is already separated from temporary cleanup; lock release preserves committed work
  - not safe: staged handle close after replace rename

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `asm-review-logic`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/utils/lockedFile.ts:257`
- title: Read-only identity checks poison serialization as dirty mutations
- evidence: `ownsTemporaryPath()` runs its `lstat()` through `guarded(checkGate, ...)`, and the staged handle identity `stat()` at line 313 is guarded the same way. `MutationGate.run()` increments the one `inFlight` counter for every guarded operation and marks the gate dirty whenever the deadline resolves with that counter positive. A deadline during either read therefore returns `retainedLockPath`, even though no link, rename, unlink, write, chmod, or exclusive open is capable of landing late. The port-flow specialist independently confirmed the `lstat` schedule.
- impact: A slow metadata read between mutating steps leaves the administrative port lock indefinitely retained and blocks later allocators, contradicting the clean-timeout requirement and the proposal's explicit must-not: a timeout with no mutation in flight must not poison the repository.
- suggestedFix: Separate deadline-bounded observations from dirty-tracked mutations. Reads may refuse later publication when they time out, but only operations capable of changing the lock, target, or staged pathname should increment the dirty in-flight count.
- status: accepted
- triage: Accept — add an internal deadline-bounded observation path that closes the gate without incrementing dirty mutation state; the public WriteGate contract remains unchanged.
- invariant: Dirty retention is earned only by an in-flight operation capable of mutating protected filesystem state.
- boundary inventory:
  - affected: staged temporary `lstat`; staged handle `stat`; any future read passed through `WriteGate.guard`
  - verified safe: exclusive open, write, chmod, link, rename, and unlink are legitimate dirty operations
  - not safe: read-only identity observations

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `asm-review-frontend`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeView.ts:1853`
- title: A retained exclude lock is presented as the port-allocation lock
- evidence: `worktreePorts.ts:738-740` emits `lockRetained` when the port-claim lock is retained. The same function also emits that identical warning at lines 753-758 when `addToGitExclude()` reports retention of the separate repository-local `info/exclude` lock. `portSummary()` has one source-specific rendering: “The allocation lock was retained … later port allocations remain blocked.” When only the exclude lock is retained after ports committed, the allocation lock is not retained and later claim allocation is not what that lock blocks.
- impact: The panel tells users the wrong lock is retained and overstates which later operation is blocked, violating D4/D7's truthful warning mapping at the exact failure state this change adds.
- suggestedFix: Preserve the source in the wire contract, for example separate `portLockRetained` and `excludeLockRetained`, and render distinct guidance. A source-neutral warning is acceptable only if it remains accurate for both locks and does not claim port allocation is blocked by the exclude lock.
- status: accepted
- triage: Accept — use source-neutral retained-repository-lock guidance accurate for both serialization domains, avoiding an unnecessary wire-contract expansion while satisfying D4/D7.
- invariant: Each retained serialization domain must be reported as the domain actually retained.
- boundary inventory:
  - affected: retained port-claim lock; retained repository-local exclude lock; Worktree panel guidance
  - verified safe: exact retained paths are logged host-side; successful port counts remain authoritative; temporary cleanup and release failure have separate warnings
  - not safe: the shared `lockRetained` UI meaning

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-reuse`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:452`
- title: Port preview still uses a competing directory-authorization implementation
- evidence: Allocation now uses `src/utils/authorizedDirectory.ts`, which walks every ancestor, rejects zero inode identity, and rechecks each component. Preview still reaches `readClaimsUnderRoot()` and the local helpers at lines 168-193, which authorize only the leaf directory and accept zero inode identities. The shared extraction therefore did not replace the prior preview path.
- impact: Preview and allocation apply different identity semantics. An ancestor substitution or zero-inode platform can produce a preview from a directory the authoritative allocator later refuses, and future fixes to the shared helper will continue to drift from preview.
- suggestedFix: Use shared `authorizeDirectory()` and `directoryStillAuthorized()` in `readClaimsUnderRoot()` through the existing budget adapter, then remove the local leaf-only authorization helpers.
- status: accepted
- triage: Accept — replace preview's leaf-only helper with the shared ancestor-aware, nonzero-identity authorization under the existing budget.

## Full-flow trace

- Deadline start and acquisition: `allocateWorktreePorts()` mints one deadline before the common port lock and passes it into `LockedFile.withLock()`. Timer-first and already-spent cases are covered, but F001 breaks wall-clock-first expiry while acquisition or mutation is in flight.
- Claim transaction: lock acquisition → fresh listing under the same budget → listing-time sibling authority → bounded claim reads → target authority and source proof → staged claim write → guarded link/rename. Directory substitution before the final recheck fails closed; substitution after that recheck is the accepted Node `openat` residual from the prerequisite design and is not a finding. F003 incorrectly treats read-only proof work as a dirty mutation.
- Cleanup and exclude: successful create-link publication is separated from inode-owned temporary cleanup, and lock release is identity-checked. Existing-file replace still waits on handle close before acknowledging commit, producing F002. The same deadline reaches `addToGitExclude()` and is cancelled only by the allocation owner after cleanup and exclude result handling.
- Result propagation: allocation outcomes and warning keys flow through `worktreeMutationService` → extension host `worktreeProvisionResult` → `WorktreeController` merge → `WorktreeView.portSummary()`. Counts remain based on authoritative per-port outcomes, but F004 collapses two retained-lock domains into false guidance.
- Authority flow: successful Git create → one source/destination authorization pair at the mutation seam → selected file apply and target port apply. The data-security specialist's final recheck-to-syscall concern was rejected because the accepted prerequisite explicitly records that Node lacks descriptor-relative traversal and makes that exact window an out-of-scope residual.

## Inline support review

- Changed tests contain no `.only` or `.skip` additions.
- Focused deadline tests cover timer-first latch, dirty publication, clean timeout, late acquisition, successor-safe release, and create cleanup. They do not cover wall-clock-first expiry, read-only in-flight classification, or replace-commit cleanup latency; those omissions correspond to F001-F003 rather than separate findings.
- No changed fixture or seed introduced PII, credentials, or destructive setup.
