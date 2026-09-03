# Review: allocate-and-name-ports-before-they-collide cycle 2 / round 4 — verification

## Decision

### VERDICT: WARN

**Why:** Parent F001 and F003 are fixed at their gating invariants and the end-to-end integration remains intact, but two non-gating cleanup-reporting gaps can leave a lock or staged temporary behind without returning the corresponding warning.

**Blocking:** 0 | **Warnings:** 2 | **Suggestions:** 0

## Review metadata

- Date: 2026-09-02
- Cycle: 2
- Round: 4
- Mode: verification
- Scope: remediation delta `a56f77cb95ed3afd9766e670dcc9fd89ba321229..c9b1a9aa78150b882dd0af6f525775d2f4feee96`, then the parent F001/F003 impact cone and integration seam
- Previous Head: `a56f77cb95ed3afd9766e670dcc9fd89ba321229`
- Head: `c9b1a9aa78150b882dd0af6f525775d2f4feee96` (product tree clean before this round file was written)
- Reviewable lines: 993
- Note: Large change — accuracy may decrease
- Scope lock: passed. The new directory-authority and retained-lock invariant owners were extracted into separate changes, independently planned, reviewed, implementation-approved, applied, and archived before this parent verification. Their child-internal non-gating dispositions remain authoritative in those archived reviews; this round reviews the parent witnesses and integration seams rather than reopening each child wholesale.
- Prerequisite changes:
  - `asimov/changes/archive/260902-0343-freeze-the-first-observed-worktree-before-writing/`
  - `asimov/changes/archive/260902-0459-never-release-a-lock-a-pending-write-still-owns/`
- Agents spawned:
  - `asm-review-logic` — F003 deadline gate, staged mutation, cleanup, release, and second-allocator exclusion — `opus[1M]`
  - `asm-review-data-security` — F001 carried target/sibling directory authority and substitution schedules — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — parent preview/result/warning integration and rendered notice — `sonnet[1M]`
- Agents skipped:
  - `asm-review-contracts` — no independent schema/route/design-pattern question beyond the result union and host-held offer seam covered by chair/frontend
  - `asm-review-performance` — no new growth-axis owner in the parent integration seam; child-internal bounded-fan-out dispositions remain with the archived child review
  - `asm-review-reuse` — shared authorization reuse was independently reviewed in the prerequisite and no new duplicate owner appears at the parent seam
- Recorded verification: caller evidence reports exact `pnpm run check-types` passing; exact `pnpm run test:unit` and the capped full suite both passing 282 files / 6,700 tests; focused lock consumers passing 305 tests; targeted changed-file Biome passing; and clean-tree project Biome retaining only the three pre-existing format errors in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`. `bun run asm change verify-status allocate-and-name-ports-before-they-collide` records all eight parent tasks exit 0 with `scope-changed` because the two prerequisite children own the final remediation. Caller evidence also records parent validation at zero errors and one historical task-sizing warning. The review did not rerun project verification commands.
- `git diff --check a56f77cb95ed3afd9766e670dcc9fd89ba321229..c9b1a9aa78150b882dd0af6f525775d2f4feee96` passed.
- Review master session id: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Verdict: WARN
- Counts: BLOCK 0 | WARN 2 | SUGGEST 0

## Finding dispositions

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `chair`, `asm-review-data-security`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:958`
- title: Fresh authorization accepted a substituted regular root or parent
- evidence: Fixed. Immediately after Git create succeeds, the mutation service freezes one source/destination authorization pair and passes the same destination authority into port allocation. `AuthorizedDirectory` freezes every absolute path component with nonzero device/inode identity and rechecks the complete chain. Production fresh listing authorizes each normalized `WorktreeInfo.id` under the allocation budget; the allocator rejects path/authority mismatch, excludes the target by authorized leaf identity rather than display spelling, and brackets each sibling claim read with listing-issued full-chain checks. Target absent/existing reads are bracketed by the mutation-issued authority; staging begins only after another full-chain check; create/replace publication follows source identity/mode/byte proof bracketed by target checks and the staged writer's no-follow/nonzero-identity ownership. Focused witnesses cover regular leaf replacement, ancestor substitution, listing-time sibling recreation, normalized-alias self-exclusion, absent create, existing replace/reuse, pre-commit source change, and failed publication without redirected writes.
- impact: Resolved — target publication cannot mint trust from a replacement observed after Git create, and substituted sibling paths cannot hide or invent claims while producing a successful allocation.
- suggestedFix: Applied through the archived `freeze-the-first-observed-worktree-before-writing` prerequisite and the parent mutation/listing integration.
- status: fixed
- triage: verified — chair and data-security specialist traced every round-3 boundary. First observation is correctly not described as proof of the exact inode Git created, and substitution after the final component recheck but before the immediately following syscall remains the accepted Node/dirfd residual.
- invariant: Port claim reads and publication may act only beneath the worktree path and component identities authorized by the create/listing boundary, never beneath identities first observed after substitution.
- boundary inventory:
  - fixed: target regular-root replacement; target parent-component substitution; sibling regular-root/parent substitution; absent target read; existing target read; staging admission; create publication; replace publication
  - verified safe: final-root symlink/non-directory refusal; final claim entry no-follow/type/nonzero-identity checks; retained-source reproof; staged temporary inode ownership; normalized-id sibling authorization; identity-based target self-exclusion; create success with failed selected work

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `chair`, `asm-review-logic`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/utils/lockedFile.ts:60`
- title: Staging and publication remained outside the transaction deadline
- evidence: Fixed at the gating invariant. `LockedFile.withLock(deadline, …)` creates one latched gate before exclusive acquisition and returns typed `done`, `unavailable`, or `timedOut` outcomes. Wall-clock-first and timer-first expiry close permanently. Exclusive lock open, staged temporary open/write/chmod, create link, replace rename, and prepublication discard unlink are dirty mutation-capable operations; stage-parent mkdir and staged identity observations are bounded clean operations. A dirty timeout closes handles without unlinking the lock pathname, so any late mutation remains serialized and a second allocator is excluded. A clean timeout refuses later publication and starts release of the owned lock. Create/replace commit points are separated from inode-owned postcommit temporary cleanup; late temporary cleanup or lock release cannot rewrite committed success. Port allocation maps dirty retention to failed uncommitted names plus `lockRetained`, logs the exact path host-side, carries the same deadline into repository-local exclude mutation, and cancels only after bounded outcomes are classified. F006 and F008 are separate reporting mechanisms: neither permits publication after release nor removes second-allocator exclusion.
- impact: Resolved — lock acquisition, staging, publication, prepublication discard, postcommit cleanup, and release now produce a bounded result without allowing a late claim to escape serialization.
- suggestedFix: Applied through the archived `never-release-a-lock-a-pending-write-still-owns` prerequisite and its parent port/exclude/UI integration.
- status: fixed
- triage: verified — chair and logic specialist traced acquisition; stage mkdir/open/write/chmod/stat; create link and replace rename; prepublication discard; safe postcommit cleanup; successor-safe release; clean/dirty classification; wall/timer ordering; and second allocator exclusion. The surviving warning gaps do not reopen the original BLOCK because they affect returned diagnostics after fail-closed behavior, not the serialization invariant.
- invariant: The allocation deadline covers every operation that can keep the common lock or preview/create result pending, and no mutation-capable work may continue after serialization is released.
- boundary inventory:
  - fixed: exclusive lock acquisition; stage parent mkdir; staged exclusive open; staged write; chmod; staged stat; create link; replace rename; prepublication discard; postcommit temporary cleanup; lock identity/stat/unlink/handle cleanup; retained-lock classification
  - verified safe: clean timeout refuses later publication; dirty timeout retains serialization; already-expired transactions start no listing or publication; wall-clock expiry cannot reopen; committed outcomes survive cleanup delay/failure; a second allocator cannot enter while a late protected mutation may land

## New findings

### F006

- ID: F006
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-logic`, `chair`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/utils/lockedFile.ts:245`
- title: A clean-timeout release failure can miss the returned lock warning
- evidence: The clean-timeout exits at lines 245-251, 265-270, and 278-283 start `releaseLock()` asynchronously and return `timedOut` immediately. Their callback can invoke `onLockReleaseFailed` only after `allocateWorktreePorts()` has copied the mutable `warnings` array into its returned value at `src/worktree/worktreePorts.ts:736`. A stalled or failed `handle.stat` / lock-path `lstat` / `unlink` therefore leaves the lock pathname blocking later allocators while the result contains neither `lockReleaseFailed` nor `lockRetained`; only a late host log can observe it.
- impact: The allocator remains fail-closed and no duplicate claim can publish, but the panel can tell the user only that allocation timed out and omit that later allocations remain blocked by an unreleased lock.
- suggestedFix: Carry bounded release cleanup state in `LockedOutcome` rather than through a callback that may fire after return. When clean-timeout release cannot be proven complete within the result bound, return a release-pending/failed flag that the port caller maps to `lockReleaseFailed` while preserving the bounded result.
- status: accepted
- triage: confirmed inside F003's cleanup impact cone. Non-gating because serialization remains fail-closed and committed state is not corrupted; the defect is missing actionable cleanup reporting.
- invariant: Every lock pathname that may remain after an allocator result returns must be represented in that returned result's warnings.
- boundary inventory:
  - affected: clean timeout after acquisition; clean timeout after work; asynchronous lock stat/lstat/unlink/handle cleanup; warning snapshot
  - verified safe: dirty timeout returns `lockRetained`; ordinary completed-work release failure is observed before its `done` outcome returns; second allocator remains excluded by the surviving pathname

### F008

- ID: F008
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: `asm-review-logic`, `chair`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:647`
- title: Prepublication staged-temporary cleanup failure is not reported
- evidence: When staging succeeded but source proof or publication failed, the allocator awaits `staged.discard(gate)` and discards its boolean result. `discard()` returns `false` when ownership cannot be re-proven, when its unlink fails for a non-ENOENT reason, or when a closed gate forces close-only abandonment. The postcommit cleanup path at lines 717-722 checks the same result and emits `temporaryCleanupFailed`; the prepublication path emits nothing. The unpredictable temporary is named `..env.worktree.<hex>.tmp`, so the exact `/.env.worktree` exclude rule does not hide it.
- impact: A failed allocation can leave an untracked temporary in the new worktree while the panel reports only the port failure and gives no cleanup warning. Allocation correctness and serialization remain intact.
- suggestedFix: Fold prepublication discard completion into the returned work/lock outcome before warnings are snapshotted. A prompt `false` and a discard that outlives the deadline should both produce `temporaryCleanupFailed`; do not rely on a late mutation of the caller's warnings array.
- status: accepted
- triage: confirmed inside F003's prepublication-discard impact cone. Non-gating because the target claim is not falsely reported successful and a dirty late unlink remains serialized; the defect is an undisclosed leftover temporary.
- invariant: Cleanup that may leave a worktree-visible staged pathname must produce a warning in the returned provisioning result.
- boundary inventory:
  - affected: source-proof failure after staging; failed create/replace publication; prepublication ownership mismatch; unlink failure or timeout; warning transport
  - verified safe: postcommit cleanup already emits `temporaryCleanupFailed`; failed pending names remain failed; dirty mutation timeouts retain the repository lock

## Prior fixed findings

- F002 remains fixed: retained-only and retained-plus-pending successes still require final authorized source proof.
- F004 remains fixed: supplied numeric values remain visibly qualified as previews.
- F005 remains fixed for its original mechanism: lock acquisition, listing/proof, source change, staging, and publication reasons remain distinguished. F006/F008 concern missing cleanup warnings, not a recurrence of the original cause-collapsing failure reason.

## Parent integration trace

- Host preview: every issued provisioning model runs the best-effort preview before offer issuance; failed preview strips only the number and preserves the selectable configured name.
- Host authority: submission carries opaque ids only; the host resolves those ids against its current stored offer and passes only host-held `ProvisionPort` objects into create.
- Create/service: Git create succeeds first; one source/destination authority pair is frozen; files run before ports and ports before launch; ports-only selections still run; authorization/allocation failures remain provisioning outcomes rather than create failures.
- Authoritative allocation: fresh normalized sibling listing, carried sibling authority, claim reads, choice, staged publication, cleanup, and exclude update retain their accepted ordering and typed outcomes.
- Wire: the create result is posted first, followed on the same origin channel by the required complete `ports` array and optional warning union. Warning keys participate in render invalidation when emitted; F006/F008 identify cases where the producer fails to emit them before return.
- UI: the controller merges provisioning onto the existing create notice; the view still coalesces duplicate ids by configured name, counts unique ready names, names only changed previews or failures, keeps unchanged successes silent, and renders retained-lock guidance accurately for either repository lock.

## Adjudication notes

- The logic specialist's late exclusive-open rejection suggestion was rejected. The approved child D1/D2 contract intentionally classifies an exclusive `open("wx")` that loses the deadline race as dirty because the bounded caller must return before it can know whether the operation will later create the lock. A late rejection does not retroactively make that conservative result incorrect at the decision point.
- The logic specialist's unbounded post-create authorization suggestion was rejected. The approved directory-authority D2 explicitly leaves mutation-seam authorization on the unbounded default and claims no new wall-clock bound there; a general preference for another bound is not an obligation in this parent verification.
- A late recursive stage-parent `mkdir` remains classified clean by the approved retained-lock D2 contract because it is idempotent directory existence, starts no exclusive open afterward, and cannot publish a claim. It does not reopen F003.
- Data-security and frontend specialists reported no findings.

## Inline support review

- Changed tests add no `.only` or `.skip`.
- The remediation witnesses cover the prior production mechanisms rather than only mocks at one quoted line.
- No changed fixture or seed introduces credentials, PII, or destructive setup.
- No audit-backlog or accepted-risk entry was introduced in this parent verification round.
