# Review: never-release-a-lock-a-pending-write-still-owns cycle 1 / round 2 — verification

## Decision

### VERDICT: APPROVE

**Why:** The remediation delta closes F001-F005 at their invariant boundaries, and review of the behavioral impact cone found no new gating or non-gating defect.

**Blocking:** 0 | **Warnings:** 0 | **Suggestions:** 0

## Review metadata

- Date: 2026-09-02
- Cycle: 1
- Round: 2
- Mode: verification
- Scope: remediation delta `e76ad2f56bc802a9c8633f2da359d69478e1cda8..b9a368845f51ccd9545d5556807916faf62df36a`, then cumulative impact-cone review
- Previous Head: `e76ad2f56bc802a9c8633f2da359d69478e1cda8`
- Head: `b9a368845f51ccd9545d5556807916faf62df36a` (product tree clean; only generated `asimov/changes/never-release-a-lock-a-pending-write-still-owns/analytics.json` was untracked)
- Reviewable lines: 95
- Scope lock: passed — the delta contains only remediation for accepted F001-F005, their witnesses, and task-completion metadata; no new capability, changed contract/design, or invariant owner
- Agents spawned:
  - `asm-review-logic` — F001-F003 plus lock-consumer impact cone — `gpt-5.6-sol[1M]`
  - `asm-review-frontend` — F004 retained-lock rendering — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — F005 preview authority reuse — `sonnet[1M]`
- Agents skipped:
  - `asm-review-data-security` — no authority contract changed beyond replacing preview's weaker duplicate with the previously accepted shared authority
  - `asm-review-contracts` — no wire/schema change; F004 was fixed with source-neutral copy
  - `asm-review-performance` — no growth-axis change in the remediation cone
- Verification evidence: `bun run asm change verify-status never-release-a-lock-a-pending-write-still-owns` records tasks `1_1` through `1_4` exit 0. Caller supplied: focused lock consumers passed 305 tests; task verification passed 272 focused tests; capped full run passed 282 files / 6,700 tests; exact `pnpm run check-types` passed; exact `pnpm run test:unit` retry passed 282 files / 6,700 tests after the first exact attempt hit the known extension teardown flake following an earlier capped pass; targeted Biome passed; full clean-tree Biome still has only the same three pre-existing format errors outside the change. Review did not rerun project verification commands.
- Verdict: APPROVE
- Counts: BLOCK 0 | WARN 0 | SUGGEST 0
- Review master session id: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Finding dispositions

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `asm-review-logic`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/utils/lockedFile.ts:69`
- title: Wall-clock expiry can lose to an in-flight protected operation
- evidence: `MutationGate.open` now permanently closes the gate when wall-clock expiry is observed. Both fulfillment and rejection settlement paths call `open` while the mutation count is still positive, so a protected operation crossing wall-clock-first expiry marks the gate dirty and returns `GateClosed`; timer-first expiry uses the same latch. Dedicated witnesses cover exclusive-open crossing, guarded-mutation crossing, and backward clock movement after wall-clock closure.
- impact: Closed — protected acquisition/publication cannot be accepted after wall-clock-first expiry, and an observed expiry cannot reopen.
- suggestedFix: Implemented: permanent close latch plus mutation-settlement expiry check and wall-clock-first witnesses.
- status: fixed
- triage: verified — specialist and chair traced exclusive open, staged mutations, create link, replace rename, and timer/wall-clock ordering.
- invariant: Once either deadline signal says expiry, the gate never reopens; a protected operation crossing that instant is dirty even if the timer callback is delayed.
- boundary inventory:
  - fixed: exclusive lock open; staged-file mutations; create link; replace rename; clock rewind after observed wall expiry
  - verified safe: timer-first expiry; already-spent entry refusal; late fulfillment and rejection observation

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `chair`, `asm-review-logic`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/utils/lockedFile.ts:407`
- title: A committed replace is relabeled as a timeout while handle cleanup stalls
- evidence: Replace commit now treats successful atomic rename as the commit point, marks the staged path non-live, detaches the handle, starts an internally observed asynchronous close, and immediately returns `true`. The stalled-close witness confirms `withLock()` returns `{ kind: "done", value: "committed" }` while close remains pending.
- impact: Closed — existing `.env.worktree`, `info/exclude`, and generic `atomicReplace` callers retain authoritative committed success when handle cleanup is late.
- suggestedFix: Implemented: handle close moved behind the replace commit point and rejection remains observed.
- status: fixed
- triage: verified — create, replace, generic atomic replace, exclude, and port-claim consumers were reviewed in the impact cone.
- invariant: Once link or rename has published the target, later cleanup latency cannot change success into failure.
- boundary inventory:
  - fixed: replace commit for existing claim files; exclude atomic replacement; generic atomic replacement
  - verified safe: create-link cleanup; pre-commit failure discard; lock release; successor ownership

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `asm-review-logic`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/utils/lockedFile.ts:88`
- title: Read-only identity checks poison serialization as dirty mutations
- evidence: `MutationGate.observe()` now bounds non-publishing observations without incrementing mutation state. Staged temporary `lstat`, staged handle `stat`, and stage-parent `mkdir` use this clean path. Exclusive open, write, chmod, link, rename, and unlink remain on the dirty mutation path. The staged-identity timeout witness returns a clean timeout and releases the lock.
- impact: Closed — slow identity observations no longer create permanent administrative locks, while late mutation-capable syscalls still retain serialization.
- suggestedFix: Implemented: separate clean observation path from dirty mutation tracking.
- status: fixed
- triage: verified — every boundary named in the round-1 inventory and author impact manifest was classified and traced.
- invariant: Dirty retention is earned only by an in-flight operation capable of mutating protected filesystem state.
- boundary inventory:
  - clean: stage parent mkdir; staged temporary lstat; staged handle stat
  - dirty: exclusive open; write; chmod; create link; replace rename; discard unlink

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `asm-review-frontend`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeView.ts:1855`
- title: A retained exclude lock is presented as the port-allocation lock
- evidence: The retained-lock copy is now source-neutral: “A repository lock was retained … related worktree setup may remain blocked until cleanup.” It is accurate for both the port-claim and repository-local exclude serialization domains and no longer states that later port allocations remain blocked. Port counts, failure details, warning tone, and render-key inputs are unchanged.
- impact: Closed — users receive truthful guidance regardless of which retained path the host logged.
- suggestedFix: Implemented: source-neutral retained-repository-lock wording with a regression assertion against the prior overclaim.
- status: fixed
- triage: verified — frontend specialist confirmed both warning sources and the complete rendering impact cone.
- invariant: Each retained serialization domain must be reported without claiming a different domain is retained.
- boundary inventory:
  - fixed: port-lock retention rendering; exclude-lock retention rendering
  - verified safe: authoritative success counts; warning tone; render invalidation; exact host-side path logs

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-reuse`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:322`
- title: Port preview still uses a competing directory-authorization implementation
- evidence: `readClaimsUnderRoot()`, shared by preview and allocation, now calls the common ancestor-aware `authorizeDirectory()` and `directoryStillAuthorized()` through the existing transaction budget. The local leaf-only authorization type and helpers were removed. New witnesses reject zero inode identity and ancestor substitution before any port probe.
- impact: Closed — preview and authoritative allocation now use one nonzero-identity, full-component authorization rule.
- suggestedFix: Implemented: shared authorization reuse and removal of duplicate helpers.
- status: fixed
- triage: verified — reuse specialist found no remaining duplicate preview authorization semantics.

## Impact-cone review

- Lock primitive: acquisition, stage parent creation, exclusive temporary open, write, chmod, identity observation, create link, replace rename, prepublication discard, abandonment, and lock release were traced under timer-first and wall-clock-first ordering.
- Consumers: repository-local exclude and worktree port publication retain the deadline overload; generic no-deadline callers retain compatibility. Existing target replacement and create publication preserve their respective success/cleanup semantics.
- Port flow: shared deadline propagation and owner cancellation are unchanged. Preview now shares allocation authority but keeps its existing deadline budget and fail-closed behavior.
- UI flow: the warning key and message transport are unchanged; only the inaccurate source-specific rendering changed, leaving committed counts and result identity intact.

## Inline support review

- The remediation tests directly reproduce every prior finding witness without weakening existing assertions.
- No `.only` or `.skip` was added.
- No new fixture, seed, credential, or destructive test setup entered the verification cone.
