# Review Round 1

- Date: 2026-09-01
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: range `1f4819b7..a51362c6`
- Head: `a51362c6af5b08b5bb5de3f495bc049c93add9e5` (working tree dirty only from the ignored generated `asimov/changes/allocate-and-name-ports-before-they-collide/analytics.json`; review content came from the committed range)
- Reviewable lines: 1427
- Note: Large change — accuracy may decrease
- Escalation flags: `cross-boundary`, `user-visible-ui`, shared filesystem state, cross-process serialization
- Agents spawned:
  - `asm-review-logic` — allocator concurrency, retained claims, atomic publication, and create-success error paths — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — no-follow file authority, common-dir boundaries, and exclude mutation — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — host-held offer redemption and result contract — `sonnet[1M]`
  - `asm-review-frontend` — provisional preview and result rendering — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — sibling/file/probe/deadline bounds under the allocation lock — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — locked-file extraction, strict-read reuse, and path-identity ownership — `gpt-5.6-luna[1M]`
- Agents skipped: none
- Recorded verification: caller evidence reports typecheck passing; 280 unit files / 6638 tests passing with `maxWorkers=4`; the filesystem-deletion gate passing; changed-source Biome passing all 24 files; and project-wide Biome remaining exactly 3 errors / 14 warnings / 1 info, reproduced on a clean baseline outside change-owned files. `bun run asm change verify-status allocate-and-name-ports-before-they-collide` also reports every task exit 0. The review did not rerun project verification commands.
- Chair probes: a substituted worktree root received `.env.worktree` outside the authorized checkout while returning `allocated`; a detected target edit left a retained name reported `reused`; and a thrown Git listing was reported as lock contention. Each probe used a temporary directory removed in the same command.
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 2 | SUGGEST 0
- Blocking split: 3 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:443`
- title: A substituted worktree root redirects claim publication outside the authorized checkout
- evidence: `readClaims()` authorizes only the final `.env.worktree` entry; `ENOENT` at line 132 is accepted as an absent file without authorizing the worktree root or its parent components. `sourceStillMatches()` repeats only that final-entry absence check at lines 174-180. `stageReplacement()` is then constructed for the joined path at line 443 and follows parent-directory symlinks while creating its sibling temporary. A targeted probe replaced the worktree root with a symlink to another directory before allocation; the allocator returned `{ kind: "allocated", port: 5183 }` and wrote `APP=5183` into the symlink target.
- impact: State outside the newly created worktree can be modified while the UI reports a successful claim. This crosses the filesystem authority boundary and leaves the registered checkout without a trustworthy local claim file.
- suggestedFix: Authorize the created worktree root and every relevant parent component after Git succeeds, refuse symbolic-link/non-directory substitutions, and recheck that authorization immediately before staging and publication. Reuse or extract the repository's component-identity authorization discipline rather than adding another final-entry-only variant; keep the documented residual final-syscall race explicit.
- status: accepted
- triage: CONFIRMED by a production-function probe. This is not the accepted unrelated-editor final-syscall window: the root was already substituted before the allocator's read, and the allocator never checked it.
- invariant: Port claim reads and publication may act only beneath the newly created worktree path whose directory identity the mutation authorized.
- boundary inventory:
  - affected: absent target read; existing target read through a substituted parent; source recheck; staged temporary creation; create/replace publication; sibling claim authority
  - verified safe: a final-entry symlink or non-regular file is refused; an opened final entry is identity-checked; staged temporary ownership is inode-checked; the common lock serializes cooperating extension processes
  - not safe: parent and worktree-root identity are never authorized or rechecked

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:410`
- title: A detected target change leaves retained assignments reported as successful
- evidence: Existing assignments are immediately recorded as `reused` at lines 410-417. Target reauthorization runs only inside `pending.size > 0`, and a failed `sourceStillMatches()` changes only pending allocations to failures at lines 447-463. A targeted probe started with `APP=5183`, selected retained `APP` plus missing `DB`, and changed the file during staging. The allocator detected the mismatch, failed `DB`, but still returned `APP` as `{ kind: "reused", port: 5183 }` while the final file contained no `APP` assignment. With only retained names, no final reauthorization runs at all.
- impact: A successful result need not map to a persisted claim. A later allocator can therefore choose the supposedly reused value, producing duplicate successful outcomes and violating the task's load-bearing uniqueness/persistence acceptance.
- suggestedFix: Reauthorize the source immediately before returning any retained success, including the no-pending path. When the source no longer matches, downgrade every retained result whose assignment is no longer proven; keep staging/publication failures local to pending names only when the retained source remains authorized.
- status: accepted
- triage: CONFIRMED by probe and by the logic specialist. The code already detects the source mismatch, so preserving `reused` is not merely the unavoidable race after a final check; it is a success retained after contrary evidence.
- invariant: Every `allocated` or `reused` result must still have the reported value in the authorized target at the transaction's final proof point.
- boundary inventory:
  - affected: retained-only transactions; retained plus pending transactions; source mismatch after staging; final result assembly
  - verified safe: pending allocations become failures when source reauthorization or commit fails; cooperating extension writers share the common lock; successful commit publishes retained bytes plus pending assignments atomically
  - not safe: retained results are never downgraded after a failed source proof

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:359`
- title: Allocation and preview budgets are checked after work that can exceed them
- evidence: The authoritative 5-second deadline is minted at line 359, but `listWorktrees()` is awaited before the first deadline check at lines 360-361; the production Git runner permits that listing to run for 10 seconds and buffer 32 MiB. Sibling and target `lstat`/`open`/`readFile` awaits have no remaining-budget cancellation. `readClaims()` and `sourceStillMatches()` buffer the whole file at lines 148 and 212 before applying the 64 KiB byte check, so a concurrently growing regular file can exceed the stated cap while it is being read. The preview path at lines 298-326 has no transaction deadline at all and performs the same sequential reads plus per-name probes before an offer is issued.
- impact: The create form can wait indefinitely for a best-effort preview, and authoritative allocation can hold the repository-wide lock beyond its accepted bound. Other windows then block or time out behind one slow filesystem/listing operation, while memory and I/O can exceed the named claim-file budget.
- suggestedFix: Enforce one abortable wall-clock budget across each preview/allocation operation, propagate the remaining deadline into the Git listing and every filesystem/probe operation, and use bounded descriptor reads that stop at `MAX_CLAIM_BYTES + 1` rather than checking after buffering. Enforce the sibling cap while consuming/parsing the listing, or return an explicit over-cap degraded result before normalization/scanning continues.
- status: accepted
- triage: The performance specialist's sibling-list and claim-read reports are merged here under one invariant. The existing Git runner's 10-second/32-MiB ceiling means the listing is finite, so it is not a separate uncapped-growth finding; it still exceeds the accepted 5-second transaction deadline and does not enforce the 512-record cap while work runs.
- invariant: Count, byte, and wall-clock budgets must stop work while it runs across preview and authoritative allocation, not audit completed awaits afterward.
- boundary inventory:
  - affected: preview sibling reads; preview probes; authoritative Git listing; sibling claim reads; target claim read; source recheck
  - verified safe: lock acquisition is bounded; the Git runner has a broader 10-second/32-MiB ceiling; claim scan is refused after a listing over 512; pre-open file sizes are checked; probes are capped at 32 per name and the production socket probe has a 1-second timer; offered rows are capped upstream
  - not safe: no shared abortable 5-second transaction budget; no bounded file-descriptor read; no preview deadline; sibling cap is enforced only after full listing parse/normalization

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-frontend, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeCreateDialog.ts:340`
- title: A numeric preview is presented as the value to allocate, not as provisional
- evidence: The row renders the verb `Allocate port` and the subject `NAME=number`; only the unavailable arm includes the word `preview`. No visible or accessible text qualifies a supplied number as provisional, even though the locked pass may change or fail it.
- impact: Users can reasonably read the number as the committed or reserved value, then receive a different result after creation. This misses the accepted requirement that a preview be presented as provisional rather than as a reservation.
- suggestedFix: Qualify every supplied number in visible/accessibility text, for example `APP=5183 · preview` or `APP=5183 · provisional`, and assert the qualifier in the dialog test.
- status: accepted
- triage: Sustained from the frontend specialist. The code avoids the literal word “reserved,” but the successful arm still lacks the affirmative provisional semantics the specification requires.

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreePorts.ts:482`
- title: Failure outcomes invent lock contention or concurrent edits regardless of the actual cause
- evidence: The same `lockFailure()` value is passed as both the lock-unavailable and work-failed fallback at lines 481-482. A targeted probe where `listWorktrees()` threw `git listing failed` returned `port claims could not be locked`, although the lock was acquired. Separately, any staging or commit failure is reported at line 462 as `the port claim file changed`, including permission, disk, temporary-file, link, or rename failures where no change was observed.
- impact: The result channel tells users the wrong remediation: wait for/remove a lock that was not contended, or look for an external edit when publication failed for another reason. The create remains successful as required, but its per-port report is not truthful about what failed.
- suggestedFix: Use distinct typed internal failure causes for lock acquisition, sibling proof/listing, source mismatch, staging, and publication; map them to accurate per-port reasons while preserving the existing create-success and batch-warning contract.
- status: accepted
- triage: CONFIRMED by a production-function probe for the work-failed fallback. The publication arm follows the same evidence-erasing pattern and is directly reachable through the existing injected failure test.

## Adjudication notes

- Full-flow trace covered: create opening → host provisioning read → best-effort preview → reminted host-held offer → opaque-id redemption → Git create → file materialization → common-dir port transaction → repository-local exclude → mutation result → ordered provisioning result → controller merge → rendered notice.
- The offer/redemption and result-wire paths were sustained as safe by the chair and contracts specialist: item ids are reminted per offer, looked up in the current surface/repository scope, and ports remain separate from path-bearing entries.
- The data-security specialist reported no finding. F001 is chair-only because it came from the end-to-end post-create path and a targeted substituted-root probe rather than the final-entry checks in isolation.
- The reuse specialist's proposed `samePath()` BLOCK was rejected: the production create path is normalized by `validateCreatePath()` and that exact `check.path` is passed to `git worktree add`; no changed-flow witness established an alias divergence for the newly created worktree. Comparing the listing's already-normalized `id` would still reduce drift, but without a concrete defect it is not reported.
- The reuse specialist's strict-read duplication concern is folded into F001 and F003: the concrete drift is the omitted parent-component authorization and the post-buffer byte check. A separate duplication-only finding would not be independently actionable.
- Inline support review found no changed `.only`/`.skip`, missing async waits, fixture secrets, or contradictory behavioral-source execution instructions.
