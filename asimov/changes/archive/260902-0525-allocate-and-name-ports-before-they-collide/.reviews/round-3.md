# Review Round 3

- Date: 2026-09-02
- Cycle: 2
- Round: 3
- Mode: discovery
- Arbiter: yes
- Scope: cumulative committed range `1f4819b7..a56f77cb`, including Gate-2-reapproved remediation task 1_8
- Head: `a56f77cb95ed3afd9766e670dcc9fd89ba321229` (working tree dirty only from generated `asimov/changes/allocate-and-name-ports-before-they-collide/analytics.json`, outside the committed review range)
- Reviewable lines: 1627
- Note: Large change — accuracy may decrease
- Escalation flags: `cross-boundary`, `user-visible-ui`, shared filesystem state, cross-process serialization
- Agents spawned:
  - `asm-review-data-security` — cumulative filesystem authority and root substitution — `gpt-5.6-sol[1M]`
  - `asm-review-performance` — cumulative listing/read/probe/staged-writer bounds — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — retained claims, failure localization, and create-success semantics — `sonnet[1M]`
  - `asm-review-contracts` — offer redemption, result wire, and discovery option contracts — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — preview and result rendering — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — component authorization, path identity, and lock cohesion — `gpt-5.6-luna[1M]`
- Agents skipped: none
- Recorded verification: caller evidence reports 266 focused tests passing; 280 unit files / 6648 tests passing with `maxWorkers=4`; typecheck, changed-source Biome, and the filesystem-deletion gate passing; and project-wide Biome remaining exactly 3 errors / 14 warnings / 1 info on the clean baseline outside change-owned files. `bun run asm change verify-status allocate-and-name-ports-before-they-collide` reports every task exit 0. The review did not rerun project verification commands.
- Chair probes:
  - F001: after replacing an ancestor of the worktree path with a symlink to another regular directory tree, the production allocator returned `allocated` and wrote `APP=5183` beneath the redirected ancestor.
  - F002: the round-1 retained-plus-pending source-change witness now returns both names as failed.
  - F003: with `transactionMs: 10` and a target staged writer that never resolves, production `allocateWorktreePorts()` was still pending after 100 ms.
  - F004/F005: current code visibly appends `· preview` and distinguishes listing, staging, source-change, publication, lock, and unexpected failure paths.
- Verdict: BLOCK
- Status: blocked
- Counts: BLOCK 2 | WARN 0 | SUGGEST 0
- Blocking split: 2 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-reuse
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:320`
- title: Fresh authorization accepts a substituted regular root or parent
- evidence: The remediation rejects a symlink at the final root, but `readClaimsUnderRoot()` mints a new authorization from whatever directory currently resolves at `root`; it never compares that identity with the directory Git created or the mutation authorized. `lstat(root)` follows every parent component, so replacing an ancestor with a symlink leading to a regular directory at the expected leaf is accepted and then rechecked only against that replacement identity. A chair probe performed that ancestor substitution before allocation; the allocator returned `{ kind: "allocated", port: 5183 }` and wrote the claim beneath the redirected tree. Replacing the final root with another regular directory has the same result. The added regression test covers only a symlink at the final root. Sibling reads mint authority the same way and can accept claims from a substituted registration path.
- impact: The allocator can publish a successful claim outside the worktree directory whose identity the create mutation authorized. A substituted sibling can also hide genuine claims or contribute unrelated ones, allowing duplicate successful values or denial of allocation.
- suggestedFix: Capture the created worktree directory identity at the post-Git mutation boundary and carry it into allocation; require it before the first target read and before staging/commit. Freeze and recheck every relevant parent component without following substitutions, using an extracted budget-aware form of the repository's existing component-identity authorization. Apply equivalent authority to sibling paths, preferably consuming their normalized identities rather than minting trust from display spellings.
- status: accepted
- triage: Persists from round 1 through the same authority mechanism. The direct final-root symlink boundary is now safe, but the authorization is still freshly minted after a regular-root or ancestor substitution. Round-3 Arbiter sustains the gating blocker on the production probe and corroborating specialist evidence.
- invariant: Port claim reads and publication may act only beneath the worktree path and component identities authorized by the create/listing boundary, never beneath identities first observed after substitution.
- boundary inventory:
  - affected: target regular-root replacement; target parent-component substitution; sibling regular-root/parent substitution; absent/existing target reads; staged temporary creation; create/replace publication
  - verified safe: final-root symlink/non-directory rejection; stable final-root identity recheck within one allocator pass; final claim entry no-follow/type/identity checks; retained source reproof; staged temporary inode ownership; cooperating extension-process serialization
  - not safe: no created-root identity crosses from mutation to allocator; parent components are followed rather than frozen; sibling authority is minted from the currently resolved display path

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:571`
- title: Staging and publication remain outside the transaction deadline
- evidence: The remediation puts listing, root checks, bounded descriptor reads, source proof, and probes behind `withinBudget()`. The mutation-capable tail is not: `stageReplacement()` is awaited directly at line 571, `staged.commit()` directly at line 590, and `staged.discard()` directly at line 599, all while `LockedFile.withLock()` still owns the common repository lock. A chair probe set `transactionMs` to 10 ms and supplied a target staged writer whose `stageReplacement()` never resolves; `allocateWorktreePorts()` remained pending after 100 ms. The production staged writer performs mkdir/open/write/chmod/stat/link/rename/unlink operations through this same unbudgeted await path, and no changed test covers a stalled stage, commit, or discard.
- impact: One stalled filesystem publication can hold the repository-wide allocation lock indefinitely despite the accepted transaction deadline. Later windows block or time out, and the create result and any requested launch never arrive. A naive Promise race around commit would be worse because the rename/link could complete after serialization was released.
- suggestedFix: Give staged creation, commit, discard, and lock release one explicit budget-aware owner whose mutation cannot continue after timeout and after lock release. This likely requires a cancellable/bounded staged-writer contract or a port-specific transaction primitive; do not merely race a mutating promise and return while it can still publish. Add stalled-stage, stalled-commit, and stalled-cleanup witnesses.
- status: accepted
- triage: Persists from round 1 under the same wall-clock invariant. The original listing/read/preview boundaries are fixed, but cumulative discovery expands the unsafe inventory to the staged writer that completes the same locked transaction. The performance specialist reported no issue; it did not address the concrete stalled-stage witness, so the chair evidence controls. Round-3 Arbiter sustains the gating blocker.
- invariant: The allocation deadline covers every operation that can keep the common lock or preview/create result pending, and no mutation-capable work may continue after serialization is released.
- boundary inventory:
  - affected: target staging; create/replace commit; staged discard; common-lock release/handle cleanup
  - verified safe: preview deadline; listing remaining timeout and 1 MiB output cap; 512-record rejection before normalization/missing probes; bounded claim descriptor reads; target/sibling root rechecks; source proof; per-name probe count and deadline
  - not safe: staged writer and publication awaits have no remaining-budget enforcement; no test proves stalled mutation/cleanup termination

## Prior finding resolution

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:614`
- title: A detected target change left retained assignments reported as successful
- evidence: Fixed. When no pending write persisted the authorized bytes, every `reused` result is re-proven against the directory authorization and original source; a mismatch downgrades each retained result to failed. When pending publication succeeds, its pre-commit source proof and atomic old-plus-new contents prove the retained values. The round-1 retained-plus-pending probe now returns two failed outcomes after the injected source edit, and a retained-only regression witness is present.
- impact: Resolved.
- suggestedFix: Applied.
- status: fixed
- triage: fixed in `042b4755`; corroborated by chair and logic specialist.

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-frontend, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeCreateDialog.ts:341`
- title: A numeric preview was presented as the value to allocate, not as provisional
- evidence: Fixed. A supplied value renders as `NAME=number · preview`, while the unavailable arm remains `NAME · preview unavailable`; both are included in the checkbox's accessible name through the existing labelled metadata.
- impact: Resolved.
- suggestedFix: Applied.
- status: fixed
- triage: fixed in `042b4755`; frontend specialist found no remaining rendering issue.

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:463`
- title: Failure outcomes invented lock contention or concurrent edits regardless of cause
- evidence: Fixed. Lock-unavailable and unexpected-work fallbacks are distinct; listing completion/proof, root authorization, staging, pre-commit source mismatch, and publication each produce a cause matching the failed boundary. Lock-release and exclude failures remain warning-only after committed outcomes.
- impact: Resolved.
- suggestedFix: Applied.
- status: fixed
- triage: fixed in `042b4755`; corroborated by chair and logic specialist.

## Adjudication notes

- Full-flow trace covered initial and switched-provider preview; reminted host-held offers; opaque-id selection; files-plus-ports and ports-only creates; retained-only and retained-plus-pending claims; fresh sibling listing; target/sibling authorization; stage/commit/source mismatch; exclude and lock-release warnings; ordered result delivery; controller merge; and rendered summaries.
- The contracts specialist's setup-step BLOCK was rejected as unchanged and explicitly owned by WT-012.11: this change intentionally redeems entries and ports only, and task 1_5's accepted boundary names those two collections. It is not an emergency outside the changed feature path.
- The contracts specialist's optional `maxWorktrees` warning was rejected: callers without the new options intentionally retain the prior bounded Git-runner behavior, while the port allocator is the accepted caller that supplies the stricter 512/1 MiB/remaining-time contract.
- The reuse specialist's component-authorization finding is merged into F001; the parent-substitution probe raises its concrete impact from WARN to the existing BLOCK severity. Its local `isNotFound` duplication has no behavioral witness and is not reported. Its `samePath()` concern remains unproven in the production create flow and is not reported.
- The performance specialist found no issue, but F003's staged-writer witness exercises an operation outside the specialist's safe-boundary reasoning. Evidence controls over role.
- No new finding IDs survived adjudication. F001 and F003 preserve their original severities and IDs; F002, F004, and F005 are fixed.
- Inline support review found no changed `.only`/`.skip`, missing async waits, fixture secrets, or contradictory behavioral-source instructions. `git diff --check 1f4819b7..a56f77cb` was clean.

## Arbiter dispositions

- F001 — **accepted**: direct final-root symlinks are refused, but a regular replacement or substituted ancestor is freshly authorized and can still redirect a successful claim outside the create-authorized checkout.
- F003 — **accepted**: listing/read/probe budgets are repaired, but staged creation, commit, discard, and lock cleanup remain outside the transaction deadline; the stalled-stage witness keeps the common lock past the accepted bound.

## Status

BLOCKED. Round 3 is the final review and two accepted gating blockers remain. The change parks and must not archive. A round 4 requires an explicit user grant through the review control plane; no coordinator or agent message supplies that consent.

## Remediation boundary

The patch-level remediation did not close either invariant completely.

- F001 now needs authority to cross the mutation-to-allocator seam and a shared component-aware, budget-aware path authorization owner. Minting a new final-root identity inside the allocator cannot prove it is the directory Git created.
- F003 now reaches the shared staged-writer boundary. Adding another Promise race would permit a late mutation after lock release; planning must decide whether `LockedFile` gains a bounded/cancellable mutation contract or port publication receives its own invariant owner.

Both require planning-level ownership rather than another unreviewed patch. The final automatic round therefore parks the change with both blockers accepted.
