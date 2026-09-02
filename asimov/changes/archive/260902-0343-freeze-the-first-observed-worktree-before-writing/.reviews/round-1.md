# Review: freeze-the-first-observed-worktree-before-writing cycle 1 / round 1 — discovery

## Decision

### VERDICT: WARN

**Why:** The scoped implementation closes the intended authority and race boundaries, but the provisioning handoff does not prove that carried authorities name the roots being operated on, and the new component rechecks weaken the existing filesystem-work budget in two concrete paths.

**Blocking:** 0 | **Warnings:** 3 | **Suggestions:** 1

**Split:** 0 feature / 0 machinery gating blockers.

## Review metadata

- Date: 2026-09-02
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: product commits `8dc9347c`, `c79877da`, `992127fb`, `a6765ec1`, `56b8d83c`, plus the complete change artifacts under `asimov/changes/freeze-the-first-observed-worktree-before-writing/`
- Excluded: prerequisite test correction `cc481141` / `a8593aaa`; child2 and parent planning commits; unrelated commits in the linear range from review base `702555af`
- Head: `7aa50b57d90978f4b04c74d2c6ff3d02fe2fbe16` (working tree dirty only from generated analytics files outside this review deliverable; reviewed product content came from the explicit committed scope)
- Reviewable lines: 448
- Accepted residual: substitution after the final component recheck but before the immediately following syscall is not reported as a defect
- Agents spawned:
  - `asm-review-data-security` — component-chain authority, no-follow claim proof, and substitution schedules — `opus[1M]`
  - `asm-review-logic` — race schedules, error paths, and test strength — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — authority handoff, normalized listing ids, and API ownership — `sonnet[1M]`
  - `asm-review-performance` — transaction budget, growth axes, and outstanding filesystem work — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — shared identity/authorization ownership and duplicate helpers — `gpt-5.6-luna[1M]`
- Agents skipped: `asm-review-frontend` — no frontend production code changed
- Support agent: `asm-finder` — production callers and full-flow reachability
- Recorded verification: `bun run asm change verify-status freeze-the-first-observed-worktree-before-writing` reports tasks `1_1` through `1_5` exit 0. The task records cite focused Vitest runs, typecheck, and full unit runs. The review did not rerun project verification commands.
- Verdict: WARN
- Counts: BLOCK 0 | WARN 3 | SUGGEST 1
- Blocking split: 0 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-data-security`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/entryGate.ts:87`
- title: The provisioning gate carries authority without proving it names the operated roots
- evidence: `prepareEntryGate(mainCheckout, worktree, authorization, deps)` resolves `mainCheckout` and `worktree`, then attaches `authorization.source` and `authorization.destination` to those roots at lines 93-103 without checking that `authorization.source.path` names `mainCheckout` or that `authorization.destination.path` names `worktree`. Every later `requireSource()` / `requireDestination()` in `applyEntries.ts:196-203` therefore proves the carried component chain, not necessarily the path used by `admitEntry()` and the filesystem operations. The analogous port boundaries explicitly reject this mismatch at `worktreePorts.ts:507-509` and `:529-531`. The sole production caller currently passes the correct objects unchanged, so this is an unenforced security contract rather than a present input-controlled bypass.
- impact: A future or alternate caller can accidentally pair an authority with a different source or destination path; all authorization rechecks then succeed against the wrong chain while selected reads or writes use the unverified root, recreating the class of boundary failure this change is intended to prevent.
- suggestedFix: Make the gate reject a source or destination whose normalized path does not match the corresponding `AuthorizedDirectory.path`, using the authorization's platform semantics, or derive each `GateRoot.path` from the authorization and remove the duplicate path inputs. Add swapped/mismatched-pair tests.
- status: accepted
- triage: CONFIRMED as a changed API-contract gap. The current extension binding is correct, so this is WARN rather than a gating live exploit.
- invariant: A directory authority may authorize operations only at the exact root path it names.
- boundary inventory:
  - affected: provisioning source handoff; provisioning destination handoff; exported `prepareEntryGate` caller contract
  - verified safe: the current mutation service mints from `repoPath` / `check.path` and the current extension passes those same values; target and sibling port contracts verify path binding
  - not enforced: provisioning gate path-to-authority binding
- outcome: fixed — task 1_6 rejects mismatched source/destination authority paths using POSIX or case-insensitive Win32 normalization; focused and full verification passed.

### F002

- ID: F002
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-performance`, `asm-review-data-security`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/applyEntries.ts:196`
- title: Directory-authority rechecks run outside the shared provisioning deadline
- evidence: `requireAuthorized()` calls `authority.directoryStillAuthorized(root.authorization)` without an `AuthorizationBudget` and without racing the call against `budget.deadline`. Production passes the module-level `directoryStillAuthorized` at `extension.ts:596`, so its component `lstat` calls use the unbounded default and bypass both the injected apply filesystem and the 60-second deadline. The walk invokes this at least once per visited node (`applyEntries.ts:444`), again around each file copy (`:485`), and before each directory read (`:522`). The growth axis is capped at 20,000 nodes, but each check expands by the source/destination component count and any one filesystem await can stall indefinitely.
- impact: A sleeping or stalled filesystem can hold the repository mutation queue after the accepted provisioning deadline, and ordinary large trees pay hundreds of thousands of unmetered component observations that the existing cost model does not account for.
- suggestedFix: Pass a deadline-backed `AuthorizationBudget` and the apply filesystem's `lstat` into `directoryStillAuthorized`; expiry should produce the existing failed selected-entry outcome. Keep the required checks immediately before reads and mutations, but avoid duplicate checks where one proof point covers the same imminent operation.
- status: accepted
- triage: CONFIRMED by both security and performance lenses. This does not challenge the accepted final recheck-to-syscall residual; it concerns filesystem observations before that residual which are outside the apply deadline.
- invariant: Every filesystem observation added to bounded provisioning must be covered by the same wall-clock budget as the operation it guards.
- boundary inventory:
  - affected: entry-start proof; per-node source `lstat`; source `readlink` / `readdir`; destination `mkdir` / `symlink`; file-copy source and destination proof
  - verified safe: node and byte counts remain structurally capped; file-copy streaming receives the deadline abort signal; port target and sibling authorization uses the transaction budget
  - not safe: component-chain recheck awaits in file provisioning

### F003

- ID: F003
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:607`
- title: Listing-time authority can leave 512 timed-out filesystem operations behind per allocation
- evidence: The fresh-listing adapter authorizes every listed worktree concurrently with `Promise.all(listing.worktrees.map(...authorizeDirectory...))` at lines 607-615. The listing cap is 512. Each component observation uses `authorizationBudget.run`, whose implementation is `withinBudget()` in `worktreePorts.ts:132-154`; that function races the promise against a timer but cannot cancel the underlying `lstat`. When the deadline wins, each concurrent authorization can leave one filesystem operation running, and a later allocation can start another capped batch after the lock is released.
- impact: A stalled mount with a large listing can make the transaction return on time while hundreds of unresolved filesystem calls continue consuming or queueing libuv filesystem work. Repeated creates can multiply those leftovers and starve unrelated extension filesystem operations.
- suggestedFix: Authorize listing rows with a small bounded concurrency rather than unbounded `Promise.all`, stop scheduling new rows once the shared deadline expires, and cap the number of uncancellable observations that can remain after timeout.
- status: accepted
- triage: CONFIRMED from the changed production fan-out and the non-cancelling budget implementation. The per-transaction sibling count is capped, so this is WARN rather than uncapped single-transaction growth.
- invariant: A bounded transaction must also bound the outstanding work it can leave after returning.
- boundary inventory:
  - affected: normalized listing-time sibling authority minting; timeout cleanup; repeated allocations
  - verified safe: listing records are capped at 512; the caller receives a failed allocation within the deadline; no claim publication follows an incomplete listing
  - not safe: outstanding uncancellable `lstat` count across timed-out transactions

### F004

- ID: F004
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: `asm-review-data-security`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:553`
- title: Budget expiry is reported as an observed directory substitution
- evidence: `directoryStillAuthorized()` catches both identity mismatch and `BudgetExpired` and returns `false`. The target call sites at lines 553-558, 620-627, 635-639, and 668-677 map that undifferentiated result to messages stating that the worktree directory or claim file changed. The new expiry test asserts only a failed outcome, not the diagnostic.
- impact: A slow transaction is presented as evidence that the checkout changed, making a security-relevant diagnosis less trustworthy and less actionable.
- suggestedFix: Preserve an expiry outcome separately from identity mismatch and report transaction timeout for that branch; assert the reason in the expiry witness.
- status: accepted
- triage: CONFIRMED diagnostic collapse; fail-closed behavior remains correct, so this is non-gating.

## Full-flow trace

- Post-create provisioning: successful `git worktree add` → one concurrent source/destination mint in `worktreeMutationService.ts:958-967` → the same objects passed to file provisioning and target ports → entry admission → authority rechecks before selected content reads and destination mutations → per-entry failed outcomes on lost authority → Git create and launch ordering preserved.
- Target port publication: mutation-issued destination authority → fresh Git listing under the common lock → normalized listing-row authority → sibling reads bracketed by full-chain checks and no-follow final-entry proof → target read bracketed by mutation authority → staged write → source proof and final directory checks → commit → retained claims receive a final proof.
- Sibling authority: `WorktreeInfo.id` is the authorization and read location; `displayPath` is carried only as display context → target row excluded by authorized leaf identity → incomplete, expired, unavailable, or changed sibling proof fails fresh allocation.
- Nonzero identity: shared `fileIdentityOf` rejects numeric and bigint zero → directory mint/recheck, claim-file proof, staged temporary ownership, and lock release consume the non-vacuous comparison.
- Accepted residual respected: no finding treats substitution after the final component check and before the immediately following Node syscall as eliminable.

## Sub-agents spawned

- `asm-review-data-security`: filesystem authority and substitution schedules — `opus[1M]`
- `asm-review-logic`: races and error behavior — `gpt-5.6-terra[1M]`
- `asm-review-contracts`: handoff and API contracts — `sonnet[1M]`
- `asm-review-performance`: scale and budgets — `gpt-5.6-terra[1M]`
- `asm-review-reuse`: shared implementation ownership — `gpt-5.6-luna[1M]`
