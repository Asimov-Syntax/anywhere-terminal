# Review Round 1

- Date: 2026-09-03
- Cycle: 1
- Mode: discovery
- Requested orchestration: fastlane
- Scope: commit range `21a436f1..d9a0d94b51c1d895f524647875949c0ac1cecaab`
- Head: `d9a0d94b51c1d895f524647875949c0ac1cecaab` (tree dirty only from review bookkeeping in `analytics.json` after round start)
- Reviewable lines: 112 across `src/cursor/CursorHookInstaller.ts` and `src/agentHooks/install/lockedJsonFile.ts`; tests reviewed inline; docs classified as skipped but read as accepted design context
- Agents spawned:
  - `asm-review-data-security`: staging creation, cleanup ownership, residual security boundaries — `gpt-5.6-sol[1M]`
  - `asm-review-logic`: FileHandle lifecycle, locking state, outcome edge cases — `gpt-5.6-terra[1M]`
  - `asm-review-contracts`: install/uninstall result and consumer contracts — `sonnet[1M]`
  - `asm-review-reuse`: shared lock/staging reuse and fake-filesystem seam — `gpt-5.6-luna[1M]`
  - `asm-finder`: caller, consumer, and filesystem-operation trace
- Agents skipped: frontend (no UI diff); performance (no collection, growth axis, or hot-path change)
- Verdict: BLOCK
- Counts: BLOCK 2, WARN 2, SUGGEST 0
- Split over gating blockers: 1 feature / 1 machinery

## Findings

### F001 — Failure cleanup can unlink a substituted staging object

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by `asm-review-data-security` and `asm-review-reuse`
- Class: machinery
- File: `src/cursor/CursorHookInstaller.ts:398`
- Status: accepted
- Evidence: Once `open(temporaryPath, "wx", ...)` succeeds, every later write, chmod, close, or replace failure enters the catch and unconditionally resolves `temporaryPath` again for `unlink`. An observer can move the created file away, put another object at the leaf, and arrange or coincide with a replace failure; cleanup then removes the substitute without proving it is the opened object. The failed-create arm correctly refuses to unlink an object it did not create, but the post-open failure arm does not preserve that ownership rule. This mechanism existed in the predecessor but remains in a changed security-critical hunk and is not among the exact R1-R4 boundaries presented for user acceptance. Invariant inventory: destructive cleanup must remove only an object still identified as owned. Searched boundaries: failed exclusive create, post-open write/chmod/close failure, replace failure, lock release, and shared staged discard. Affected: Cursor post-open failure cleanup. Verified safe: failed create performs no unlink; handle writes/chmod do not re-resolve the path; stable foreign lock substitution is refused by `LockedFile.releaseLock`.
- Impact: A security hardening that explicitly stops deleting foreign lock objects still has an undisclosed failure path that can delete a foreign staging-path object. The accepted-risk record covers R1-R4, not this cleanup boundary, so the residual statement and the implementation's ownership guarantee are incomplete.
- Suggested Fix: Reuse `LockedFile.stageReplacement(...).commit("replace")`/`discard()` or extract its identity-aware staging primitive so stable substitutions are refused. Inventory the remaining check-then-unlink window under the same identity invariant; if pure Node cannot close it, add that exact cleanup boundary to the residual statement and obtain user acceptance rather than treating the current R1-R4 grant as covering it.
- Triage: Accepted. Concrete changed-path evidence establishes a destructive ownership violation outside the recorded accepted-risk boundaries.

**Status**: accepted
**Triage**: Correct, and it is my own gap rather than a pre-existing one. `atomicReplace`'s catch
unlinks `temporaryPath` with no identity check after a successful exclusive create, so an observer
who moves the owned file and substitutes another object has that substitute deleted. It is NOT
covered by the accepted R1-R4: R3 is `LockedFile.stageReplacement`'s check-then-rename, a different
site. The shape of the miss is the point — I hardened the LOCK by reuse and left STAGING duplicated,
and the gap landed in the duplicate. Fix by reusing `LockedFile.stageReplacement`, which already
discards only what it owns, rather than adding a third ownership check. That changes design.md D1's
mechanism, so it is a handback, not a fix commit.

### F002 — Shared lock acquisition changes missing-parent results and creates configuration state

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by `asm-review-logic` and `asm-review-contracts`
- Class: feature
- File: `src/cursor/CursorHookInstaller.ts:292`
- Status: accepted
- Evidence: Cursor now delegates to `LockedFile.withLock`, whose acquisition first performs recursive `mkdir(dirname(configPath))`. The removed Cursor acquisition went directly to `open(lockPath, "wx")`, so an absent parent returned `lock-unavailable` without mutation. A targeted probe against this head with a missing `.cursor` directory returned `{installed:true}` and created the directory and `hooks.json`; the old code's non-EEXIST `ENOENT` arm returned the supplied lock-unavailable result. On Windows removal-only install, the same change can turn `lock-unavailable` plus unresolved paths into `unsupported-platform` after creating `.cursor`.
- Impact: Fresh-install and uninstall behavior, warning reason, unresolved-path payload, controller success/failure interpretation, and filesystem state change beyond the accepted D2 release-failure broadening. This is especially visible on unsupported Windows hosts, where an unsupported operation now creates configuration state before reporting unsupported-platform.
- Suggested Fix: Preserve Cursor's prior no-parent-creation acquisition policy while still using `LockedFile`—for example, add an explicit shared acquisition option or adapter that skips parent creation for this caller. Add real absent-parent install/uninstall coverage for POSIX and the Windows removal-only result arms.
- Triage: Accepted. The direct probe and baseline establish a material contract divergence from the caller's stated intended scope.

**Status**: accepted
**Triage**: Confirmed by my own before/after probe rather than on the chair's word. At `21a436f1`,
`install()` with an absent config parent returned
`{installed:false, reason:"lock-unavailable", unresolved:[...]}` and created nothing. At `d9a0d94b`
it returns `{installed:true}` and leaves `.cursor/hooks.json` behind. `LockedFile.acquireLock`
recursively creates the parent; Cursor's own acquisition never did. This writes Cursor configuration
for a user who may not have Cursor installed, and it is user-visible. Cursor's no-parent-creation
policy is restored explicitly.

### F003 — The hybrid-filesystem guard observes an unrelated directory

- ID: F003
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- Class: machinery
- File: `src/cursor/CursorHookInstaller.test.ts:1089`
- Status: accepted
- Evidence: The test creates an arbitrary temporary `probe`, runs the installer with hard-coded `C:\\Users\\alice...` fake paths, then asserts only that `probe` is empty. Any operation filled from real `node:fs/promises` resolves those Windows-shaped names elsewhere on the POSIX test host, not inside `probe`; the test also does not assert the install result. It therefore still passes if a fake operation is removed and real mkdir/open/read activity occurs outside the probe. The current fake does supply every operation reachable through `LockedFile.withLock` (`mkdir`, `open`, handle `stat`/`close`, `lstat`, `unlink`); only `link` is omitted, and that method is not reachable in this flow.
- Impact: The present Windows fixture does not currently fall through, but the declared regression witness cannot detect the future partial-double failure it claims to guard and can allow disk pollution or wrong outcome arms unnoticed.
- Suggested Fix: Make the fake type-complete for the shared lock contract with fail-fast implementations for unreachable operations, or construct an explicit lock-filesystem adapter and assert every reachable call/result. Do not use an unrelated directory as evidence that no real filesystem call occurred.
- Triage: Accepted as a test-quality warning, not a current production escape.

**Status**: accepted
**Triage**: Correct and worth more than its severity. The witness watches a temp directory the code
would never touch, while a real fallthrough would resolve the Windows-shaped paths relative to cwd —
so it passes whether or not the defect exists. That is an assertion that cannot fail, which is worse
than no assertion because it reads as coverage. Replaced with a fail-fast double that throws on any
operation it does not implement, so an omission surfaces as an error rather than as silence.

### F004 — The rewritten write-failure test no longer reaches a returned handle

- ID: F004
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- Class: machinery
- File: `src/cursor/CursorHookInstaller.test.ts:561`
- Status: accepted
- Evidence: The inherited `fs.writeFile` failure test was rewritten to make `fs.open` throw for `.tmp`. That preserves the pre-create failure result but never exercises the new `FileHandle.writeFile`, `FileHandle.chmod`, or close-on-failure paths introduced by this change. The rename-failure test reaches the post-close path but does not assert temporary cleanup or close behavior. The Windows sibling-path rewrite does preserve its former path-shape coverage by replacing the clock suffix with deterministic random bytes; the weakening is confined to the second declared rewrite.
- Impact: The exact new lifecycle the review was asked to scrutinize has no regression witness for failures after exclusive creation, including whether the handle closes and whether cleanup acts on the correct object.
- Suggested Fix: Return an instrumented temporary handle from the injected `open`, fail its `writeFile` and `chmod` in separate cases, and assert close was attempted and owned temporary state was handled as intended. Extend the replace-failure witness to assert the same lifecycle boundary.
- Triage: Accepted. Production control flow attempts closure, but the declared inherited-test rewrite does not preserve post-open failure coverage.

**Status**: accepted
**Triage**: Correct. Moving the injection from `fs.writeFile` to `open` left the post-create failure
paths — handle `writeFile`, `chmod`, and `replace` — with no witness at all, and F001 makes exactly
those paths load-bearing. Cases added for each, asserting the handle is closed and that only an owned
temporary is discarded.

## Accepted risk

The following user-granted risks are re-listed and do not gate this round. Owner: WT-012.21. Expiry: none. Reactivation trigger: a Node release exposing usable descriptor-relative `openat`/`renameat` operations.

- R1 — Directory substitution between named operations. Status: risk-accepted.
- R2 — Release-leaf substitution between identity comparison and unlink. Status: risk-accepted.
- R3 — Temporary-leaf substitution between ownership comparison and rename. Status: risk-accepted.
- R4 — Post-release wedge when a rebound lock name is refused and no age reclaim exists. Status: risk-accepted.

F001 prevents treating this list as complete: failure cleanup is another destructive pathname boundary and must be fixed or explicitly incorporated into the accepted-risk inventory.

## Clean areas

- `atomicReplace` attempts to close the handle on every path after a successful open. A replace failure invokes `close()` a second time after the successful pre-replace close; a targeted Node probe showed repeated `FileHandle.close()` fulfills, so no production finding was retained for double-close.
- The `LockedFile` callback adapter preserves the result payload and changes only `reason` to `lock-release-failed` for non-released dispositions.
- The Windows fake currently supplies all filesystem operations reachable through lock acquisition/release and Cursor reconcile; omitted `link` is unreachable in this flow.
- No `.only` or `.skip` was introduced in the reviewed test diff.
