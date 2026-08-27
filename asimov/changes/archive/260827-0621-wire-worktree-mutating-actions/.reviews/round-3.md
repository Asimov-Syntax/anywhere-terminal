# Review Round 3

- Date: 2026-08-27
- Cycle: 2
- Round: 3
- Mode: discovery
- Scope: working tree
- Context: New discovery cycle after cycle 1 stopped at round 2 and the accepted findings were re-planned into D14-D17 and tasks 7_1..7_8.
- Reviewable lines: 2758
- Size note: Large change — accuracy may decrease.
- Agents spawned:
  - asm-review-logic — destructive mutation ordering, confirmation lifetime, missing targets, and result integrity — opus[1M]
  - asm-review-frontend — create/prune entry, dialogs, result scope, and retry behavior — gpt-5.6-terra[1M]
  - asm-review-contracts — message/runtime contracts and D14-D17 obligations — sonnet[1M]
  - asm-review-data-security — untrusted paths/refs, destructive admission, and info/exclude — gpt-5.6-terra[1M]
  - asm-review-performance — queue/fingerprint/UI-state growth and rebuild costs — gpt-5.6-luna[1M]
  - asm-review-reuse — composition seams, dialog reachability, and duplicate mutation types — gpt-5.6-luna[1M]
  - asm-finder — end-to-end production reachability trace — inherited model
- Agents skipped: none
- Verdict: REJECT
- Counts: BLOCK 8 | WARN 7 | SUGGEST 0
- Verification: `pnpm run check-types` passed; focused mutation verification passed (11 files, 297 tests); `pnpm run test:unit` passed (215 files, 4157 tests); `git diff --check HEAD` passed. A scratch git reproduction confirmed that a newline-bearing worktree path is accepted and can inject `*` into `info/exclude`; another confirmed an explicit empty base ref makes `git worktree add -b` exit 128.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-frontend, asm-finder
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeContextMenu.ts:86
- title: The shipped mutation flow is still incomplete at create entry and result delivery
- evidence: The worktree menu accepts a `createWorktree` capability but `worktreeItems()` never renders an item that invokes it; the changed test at `WorktreeContextMenu.test.ts:358-363` explicitly continues to classify `createWorktree` as WT-005.3 alongside `resumeHere`, although only the launch mode is deferred. Separately, the production prune wrapper at `src/extension.ts:583` accepts only `(repoId, confirmedCount)` and discards the originating surface the host passes as its third argument, so `reportMutation` posts to nobody. Removal outcomes are stamped with `worktreeId` at `worktreeMutationService.ts:160`, while `WorktreeView.ts:551-565` renders such notices only inside rows still present after the rebuild; a successful removal removes that row before its outcome is posted. Boundary inventory affected: create UI entry; prune origin propagation; removal result scope/render after rebuild. Lock/unlock entry and origin delivery are verified safe.
- impact: Create remains unreachable in the shipped panel, prune produces no outcome on any surface, and successful or registration-removing removals can complete without any visible result. The accepted requirement that every offered mutation performs and every started mutation reports remains false.
- suggestedFix: Render a real create item wired to the existing defaults/dialog path while keeping only agent launch absent; forward prune's `origin` through the extension wrapper; and give removal outcomes a repo-level/orphan-result rendering path once their row disappears. Add extension-level and actual-menu tests rather than testing injected callbacks alone.
- status: persists from round 1
- triage: Same end-to-end production reachability invariant and wiring-omission mechanism as B1. The service exists now, but three boundary categories in the original inventory remain disconnected.

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-performance
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:147
- title: Confirmation invalidation is still not attached to every observation of disappearance
- evidence: `MutationCoordinator.run()` resolves after the forced rebuild and throws at `mutationCoordinator.ts:48-50` when the target vanished, before the removal body containing `spend()` and `fingerprints.forget()` runs. Ordinary watcher/whole-tree rebuilds in `WorktreeHost.ts:1153-1170` also have no fingerprint reconciliation hook. The only production `forget` calls are inside the removal body at `worktreeMutationService.ts:204-207,280-282`. Thus a token survives the exact rebuild that observed absence, and an externally removed worktree leaves its record until a later issue/redeem sweep. A same-path recreation uses the same `worktreeId`; empty fresh evidence is a subset of the approved set and can redeem the surviving token.
- impact: A confirmation can authorize forced deletion of a recreated worktree that the user never confirmed. It also retains complete blocker evidence for historical worktrees. D15's deliberate removal of `incarnation` is safe only if every authoritative absence calls `forget`, which current code does not do.
- suggestedFix: Put fingerprint reconciliation on the authoritative rebuild/resolve boundary, not inside one mutation body. Every rebuild should compare the previous/live worktree IDs and forget absent IDs; the pre-body missing-target path must also spend the submitted token. Test issue → rebuild observes absence → recreate same ID → old token reprompts.
- status: persists from round 1
- triage: Round-2's explicit D15 mechanism remains incomplete. Absence of `FingerprintTarget.incarnation` is not the defect; failure to execute the replacement observation invariant is.

### B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:1378
- title: A registered missing worktree can never reach the removal command
- evidence: Routing deliberately admits `WorktreeInfo.missing` so its stale registration can be removed (`WorktreeHost.ts:646-664`), but `assessRemoval()` unconditionally runs `git status --porcelain` with the missing directory as cwd. The runner returns a failed read for that nonexistent cwd, `evaluateRemoval()` turns it into `unavailable`, and the service runs no mutation. Retrying repeats the same impossible status read forever.
- impact: The documented recovery path for a missing worktree registration is unreachable; the panel offers only a retry that cannot succeed.
- suggestedFix: Treat status as not applicable when the authoritative listing already marks the linked worktree directory missing, while continuing to assess listing, session, containment, main-worktree, and lock evidence. Cover a missing registration through the real host/service path.
- status: new
- triage: Concrete contradiction between the changed host's admission comment and its assessment behavior. D16 correctly fails closed on unreadable evidence, but a known-absent directory is not an unreadable status source.

### B9

- ID: B9
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend, asm-review-reuse, asm-finder
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:117
- title: Prune starts immediately and the required confirmation dialog is dead code
- evidence: The menu callback posts `worktreePrune` directly at `WorktreeController.ts:117-123`; the indeterminate-result follow-up posts directly at `:219-225`. `openWorktreePruneDialog()` has no production caller, only its isolated test. The ellipsis in the menu label therefore promises a confirmation that never opens.
- impact: One click starts a repository mutation without the required confirmation naming how many registrations will be dropped. This breaks D13 and the accepted panel requirement.
- suggestedFix: Make the prune dialog the canonical path for both entry points, pass it the panel-derived count and repo label, and post only from its confirm callback. Add a controller/view integration test that asserts no `worktreePrune` message before confirmation.
- status: new
- triage: Escalated above the frontend/reuse WARN recommendations because the accepted confirmation is a mandatory precondition for a destructive registration mutation, not optional UX.

### B10

- ID: B10
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/gitExclude.ts:55
- title: A create path can inject arbitrary repository exclude rules
- evidence: `validateCreatePath()` permits newline/control characters in POSIX path components. After git accepts such a worktree path, the service forwards the raw normalized absolute path to `addToGitExclude()`, which appends it verbatim. A scratch repo confirmed that Git accepts a target ending in `x\n*`; the resulting exclude file contains a separate `*` pattern and hides an unrelated untracked file from `git status`. The same call also writes one absolute worktree path per create, although Git exclude patterns are repo-relative and D8 requires one create-root entry.
- impact: An untrusted/malformed webview message can alter unrelated repository ignore behavior and conceal arbitrary untracked files. Normal nested creates also fail to keep the parent clean and accumulate ineffective entries.
- suggestedFix: Reject CR/LF and unsupported control characters before git; independently derive one escaped, repo-relative create-root directory pattern; and append only that validated pattern idempotently rather than serializing the created path.
- status: new
- triage: Directly reproduced against real git. This crosses the webview trust boundary and modifies repository metadata beyond the requested worktree operation.

### B11

- ID: B11
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:249
- title: The default new-branch create sends an explicit empty base reference
- evidence: The dialog initializes `baseRef` to `""` and does not require it for new-branch mode. The controller always includes `baseRef: draft.baseRef`; `sourceOf()` treats any defined base ref as explicit, and `createWorktree()` appends it to argv. A scratch repo confirmed `git worktree add -b feat <path> ""` exits 128 with `fatal: invalid reference:`.
- impact: The normal create flow fails whenever the user leaves the optional base-ref field blank instead of defaulting to HEAD.
- suggestedFix: Omit `baseRef` for new-branch requests when the trimmed field is empty; retain a required non-empty ref for detached mode. Add the blank-default end-to-end case.
- status: new
- triage: Escalated above the frontend WARN because the default path through a headline capability deterministically fails.

### B12

- ID: B12
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-reuse
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:693
- title: Create defaults are neither configuration-aware nor the destination the form submits
- evidence: Production never passes `readWorktreeCreateRoot` into `createWorktreeHost`, so explicit configuration is ignored. The host checks collisions for `<root>/<repo-label>` using registered IDs only and returns that path. The dialog then ignores `message.path` in the normal case and derives `<root>/<repo-label>-<branch>` client-side at `WorktreeCreateDialog.ts:308-312`; its collision hint is therefore about a different candidate, and unregistered filesystem collisions are never considered. On Windows this client derivation also hardcodes `/` rather than the host/platform path API.
- impact: The form can show and submit an occupied or differently configured path rather than the free destination the host resolved. Explicit user settings do not outrank detection, and collision suffixes can describe a path that will not be created.
- suggestedFix: Wire the settings reader at production composition, and make collision resolution operate on the actual branch-derived candidate. Either include the branch/ref in a host request (including updates as it changes) or move the final suggestion to a host validation round-trip; the form must submit the returned path verbatim.
- status: new
- triage: Full-flow divergence from the approved host-authoritative destination requirement. Unit tests assert each isolated half but never compare the defaults reply with the submitted request.

### B13

- ID: B13
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:479
- title: Post-removal filesystem read failures are treated as proof that the directory is absent
- evidence: `observeAfter()` maps every `fsp.stat(journalledPath)` rejection to `existsOnDisk: false`, including EACCES, I/O, and transient filesystem failures. If git reports success and the registration is gone, `classifyRemoval()` then returns `ok` even when the directory still exists but could not be statted. Listing degradation is typed separately, but filesystem observation has no unavailable member.
- impact: The panel can report a clean irreversible removal without an authoritative filesystem observation, violating D11's independent comparison rule.
- suggestedFix: Distinguish absence codes from unreadable stat failures. Return a typed unavailable/null observation for non-absence errors and classify it as indeterminate; add permission/I/O failure tests.
- status: new
- triage: Round-2 B7's prior inference and degraded-listing mechanisms are fixed. This is a new failure mechanism at the independent filesystem source, so it receives a new ID.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/docs/design/worktree-rpc.md:1
- title: The implementation protocol exists now, but project-design synchronization is still pending
- evidence: Typed inbound/outbound messages now exist, fixing the implementation half of W3, but the project blueprint still documents the pre-change RPC/outcome vocabulary and workflow.md still has Blueprint sync incomplete.
- impact: Until sync, future work can implement against stale public design contracts.
- suggestedFix: Complete the existing Blueprint sync gate before archive, applying the accepted change deltas to worktree-rpc.md, worktree-actions.md, and the canonical value registry.
- status: persists from round 1
- triage: Retained at WARN severity per severity stability. This is an already-accepted archive obligation, not a new implementation defect.

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutations.ts:88
- title: A failed prune dry-run is fabricated as a zero count
- evidence: `countPrunable()` returns `0` for any non-zero/timed-out dry run. The service compares that value to the untrusted `confirmedCount`; a zero count can therefore satisfy the guard and proceed to `git worktree prune` without an authoritative count. The host does not require a positive finite integer.
- impact: Prune can run when its authorization count was unreadable rather than zero.
- suggestedFix: Return a typed count-read outcome and report unavailable/error without running prune on failure; reject non-positive, non-integer, or non-finite confirmed counts at the host boundary.
- status: new
- triage: Kept at WARN because normal rendered entry paths derive a positive count; exploitation requires a malformed/stale message, but the untrusted boundary still needs to fail closed.

### W5

- ID: W5
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:276
- title: Removal performs a redundant third full rebuild and projection
- evidence: The coordinator performs the accepted pre-action rebuild and a post-action rebuild in `finally`, while the removal body performs another full `forceRebuild()` before classification. Each removal therefore lists, updates cache, projects presence, and broadcasts three times.
- impact: Removal pays one unnecessary O(live worktrees + presence rows) cycle and extra surface work.
- suggestedFix: Let one layer own the post-attempt rebuild and expose its authoritative result to classification, rather than rebuilding in both the body and coordinator.
- status: new
- triage: Downgraded from the performance specialist's BLOCK: the extra recompute is fixed per interactive removal, not an unbounded hot-event loop. It remains material avoidable work.

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:167
- title: Controller mutation state grows with historical repositories and worktrees
- evidence: `createDefaults` retains every repo ever answered and `actionResults` retains one result per historical action/scope. `handleTreeResponse()` never reconciles either collection against the current tree. Removed-row results are invisible and therefore cannot be dismissed; a same-path recreation can later display the stale result on the new row. Blocked results retain blocker payloads proportional to files, panes, and sessions.
- impact: Long-lived surfaces accumulate memory and stale UI by repository/worktree history rather than current state.
- suggestedFix: Reconcile defaults and results on every authoritative tree response; preserve an orphan removal result only in an explicit bounded repo-level notice until dismissed.
- status: new
- triage: Confirmed unbounded history axis, but kept at WARN because it is surface-local and action-paced rather than a hot event-path accumulator.

### W7

- ID: W7
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:383
- title: A post-create follow-up failure rewrites a successful create as an error
- evidence: After git succeeds, `afterCreate()` can reject while opening a new window or adding the folder. That rejection reaches the outer error handler and reports the create as failed even though the worktree and branch already exist. The same code comment says post-success hygiene must not be fatal.
- impact: Users can retry a create that already succeeded and receive a collision, while the original result falsely says nothing was created.
- suggestedFix: Preserve the successful create outcome and report follow-up failure separately/bounded; never let open-after work replace the mutation result.
- status: new
- triage: Concrete partial-success reporting defect, but no mutation safety bypass.

### W8

- ID: W8
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-frontend, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:467
- title: Blocked remove results lose repository scope and evade replacement
- evidence: `toActionResult()` returns a blocked result without `repoId`, while normal results include it and deduplication compares action, worktreeId, and repoId. A later blocked result therefore does not replace an earlier remove notice for the same row.
- impact: The origin can show duplicate or conflicting notices for one removal attempt sequence.
- suggestedFix: Preserve the common scope, including repoId, in the blocked conversion and test replacement across blocked/error transitions.
- status: new
- triage: Corroborated frontend finding.

### W9

- ID: W9
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:211
- title: Branch names are not validated before invoking git
- evidence: The dialog exposes an optional `validateBranch` dependency, but the controller never supplies it and the host validates only mode/path shape. Invalid non-flag branch names therefore reach `git worktree add` and are rejected only after a mutation attempt/rebuild.
- impact: The form offers submissions the accepted contract says should be rejected before git, producing avoidable mutation attempts and generic git errors instead of field-level feedback.
- suggestedFix: Put authoritative ref validation host-side (for example `git check-ref-format --branch`) and optionally mirror it in the dialog for immediate feedback; treat the host result as decisive.
- status: new
- triage: Kept at WARN because argv and leading-dash defenses prevent command injection and git still refuses invalid refs.

## Resolved prior findings

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/createPath.ts:145
- title: Platform-specific lexical path walking now preserves POSIX backslashes and Windows roots
- evidence: POSIX splits only `/`; win32 splits both separators after preserving `parse().root`. Focused tests cover the prior fail-open cases.
- impact: The prior lexical symlink bypass is closed.
- suggestedFix: none
- status: fixed
- triage: Round-2 B3 invariant verified across POSIX, drive-root, and UNC boundary tests.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:326
- title: Create identity is observed on both sides of the queue wait
- evidence: Full validation runs before queueing and again after the barrier; candidate/ancestor identity and emptiness are compared immediately before git.
- impact: The prior replacement race is refused on supported filesystems.
- suggestedFix: none
- status: fixed
- triage: Round-2 B4 acceptance and focused swap/emptiness tests verified.

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeBlockers.ts:66
- title: Unreadable blocker sources now produce unavailable instead of empty evidence
- evidence: Status, sessions, and listing failure are typed and independently tested; unavailable issues no fingerprint and runs no mutation.
- impact: The prior fail-open removal admission is closed for existing worktrees.
- suggestedFix: none
- status: fixed
- triage: B8 is a separate not-applicable missing-directory case, not a reopening of B6's fallback-value mechanism.

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:464
- title: Registration and filesystem aftermath are now read independently and degraded listings are indeterminate
- evidence: The journalled path is statted independently and listing degradation returns null to classification.
- impact: The prior inference from registration and last-good listing is closed.
- suggestedFix: none
- status: fixed
- triage: B13 records the newly discovered non-absence stat-error mechanism separately.

## Author triage — round 3 (cycle 2 discovery)

All eight blockers verified against current code before triage. None rebutted. Every one
reproduces from the cited line; the three that could have been contested were checked hardest
and each held.

| # | Status | Triage |
|---|---|---|
| B1 | accepted | Three separate holes, all real. `WorktreeContextMenu.worktreeItems` builds its item list without `a.createWorktree`, so the callback 7_8 wired is unreachable from the UI; `extension.ts:583` calls `mutations().pruneRepo(repoId, confirmedCount)` and drops the third `origin` argument, so a prune reports to nobody; and a successful removal's notice is keyed to a `worktreeId` the post-attempt rebuild has already removed from the tree, so `resultsFor` finds no row to attach it to. My 7_8 tests called the menu callback directly and asserted on `actionResults` state, which is exactly why none of the three showed. |
| B5 | accepted | Confirmed at `mutationCoordinator.ts:48` — the `null` target throws before `body` runs, so the removal body's `spend()` and `forget` are both skipped on the one path where the worktree is already gone. Worse, D15's actual claim ("every rebuild that does not find `worktreeId` drops that worktree's fingerprint") is implemented only inside the removal body; ordinary watcher-driven rebuilds reconcile nothing. The decision is right and the implementation does not carry it. |
| B8 | accepted | `assessRemoval` runs `git status --porcelain` with `found.wt.displayPath` as cwd. For a `missing` worktree that directory is gone, so the spawn fails, `porcelain` becomes `{ok:false}`, and D16 correctly reports `unavailable` — permanently. `worktree-actions.md:348` states removing a `missing` worktree succeeds and prunes the registration, so D16's fail-closed rule has closed the documented recovery path. Fix is per-source applicability, not weakening D16. |
| B9 | accepted | `openWorktreePruneDialog` has no caller outside its own test. Both prune paths post `worktreePrune` on click. D13's whole point is that the confirmation names a count; posting without it means the count is never confirmed by anyone. |
| B10 | accepted | Two defects in one line. `entry` is appended verbatim, so a create path containing a newline writes additional exclude lines — the chair reproduced this against real git. Separately the entry is an ABSOLUTE path, and `info/exclude` patterns are repo-root-relative, so every normal create has been appending a line that never matched anything. D8 has therefore never worked, and its failure was silent. |
| B11 | accepted | `WorktreeCreateDraft.baseRef` initializes to `""` and the controller spreads it unconditionally for `new` and `detached`. Git receives an explicit empty ref and exits `fatal: invalid reference:`. The default new-branch create — the most common path — fails deterministically. |
| B12 | accepted | `readWorktreeCreateRoot` exists in `SettingsReader` and `extension.ts` never passes `createRoot` to the host, so `resolveCreateRoot` always takes the unconfigured branch: the setting the spec's own scenario names is ignored in production. The second half is mine: the host resolves collisions for `<root>/<repo-label>` while the form submits `<pathParent>/<pathPrefix>-<branch>`, so the free path the host proved is not the path that gets submitted. Satisfying the accepted requirement needs the branch in the defaults request; that is a protocol extension serving an existing spec line, not a new decision. |
| B13 | accepted | `.stat(journalledPath).then(() => true).catch(() => false)` maps EACCES, EIO and every other rejection onto "the directory is gone". Combined with a zero-exit git result that is classified as clean success — on the one action that cannot be undone. Same class as round-2 B6, one layer further out. |
| W3 | accepted | Already queued for Blueprint Sync; the § 3 payload table is stale in five rows and two outbound messages are undocumented. |
| W4 | accepted | `countPrunable` returning `0` for a failed dry run is the prune-shaped instance of B6/B13: unreadable becomes benign. Fixed with the same typed-read shape D16 introduced. |
| W5 | accepted | Three rebuilds per removal — coordinator before, removal body for classification, coordinator after. Fixing it means one layer owning the post-attempt rebuild; folds naturally into the B5 fix, which has to touch the same seam. |
| W6 | accepted | `createDefaults` and `actionResults` are never reconciled against the tree, so a notice for a removed row is undismissable and can reattach to a recreated same-path row. The second half is a small D15 echo at the panel layer. |
| W7 | accepted | An `openAfter` failure rewriting a successful create as an error contradicts "a failed launch leaves the created worktree in place" (PLAN WT-005.3 acceptance, same principle). |
| W8 | accepted | Blocked results drop `repoId`, so notice replacement misses them and they stack. |
| W9 | accepted | Branch validation exists in the dialog deps and is not supplied, so invalid names reach git. Cheap to wire. |

Not rebutted, and worth stating plainly: the round-3 findings are overwhelmingly COMPOSITION
defects — production wiring that no unit test exercised — in a change whose unit coverage is
otherwise strong (4157 tests, every task mutation-checked). Tasks 8_1..8_9 below are therefore
weighted toward tests that traverse the real assembly rather than more per-module cases.
