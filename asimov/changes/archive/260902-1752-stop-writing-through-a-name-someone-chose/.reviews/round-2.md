# Review Round 2

- Date: 2026-09-03
- Cycle: 2
- Mode: discovery
- Requested orchestration: fastlane
- Scope: commit range `d9a0d94b51c1d895f524647875949c0ac1cecaab..eed906888e185819ef5961f82c2316f3c2dfc325`
- Head: `eed906888e185819ef5961f82c2316f3c2dfc325` (tree dirty only from review bookkeeping in `analytics.json` after round start)
- Reviewable lines: 74 in `src/cursor/CursorHookInstaller.ts`; tests reviewed inline; accepted design and task deltas read as context
- Agents spawned:
  - `asm-review-data-security`: shared staging, cleanup identity, directory races — `gpt-5.6-sol[1M]`
  - `asm-review-logic`: instance state, parent gate, failure paths — `gpt-5.6-terra[1M]`
  - `asm-review-contracts`: installer results and Windows fixture semantics — `sonnet[1M]`
  - `asm-review-reuse`: LockedFile reuse and fake-filesystem seam — `gpt-5.6-luna[1M]`
- Agents skipped: frontend (no UI diff); performance (no collection, growth axis, or hot-path change)
- Verdict: BLOCK
- Counts: BLOCK 1, WARN 1, SUGGEST 0
- Prior findings fixed: 2
- Split over gating blockers: 1 feature / 0 machinery

## Findings

### F001 — Failure cleanup can unlink a substituted staging object

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by `asm-review-data-security` and `asm-review-reuse`
- Class: machinery
- File: `src/cursor/CursorHookInstaller.ts:385`
- Status: fixed
- Evidence: Cursor's copied open/write/chmod/close/rename/catch implementation is deleted. `atomicReplace` now delegates to `LockedFile.atomicReplace`, whose staging records the opened identity, refuses a stable substituted pathname in `ownsTemporaryPath`, and uses the same guarded `discard` after handle-write, chmod, or replace failure. The Cursor witness substitutes a different object inside the injected replace failure and confirms it survives; the shared invariant owner's tests also cover failed replace cleanup and substituted staging. Boundary inventory rechecked: failed create, handle write, chmod, commit/replace, discard, and stable foreign substitution all route through the one shared staging owner. R3 remains the accepted check-then-act window.
- Impact: The duplicate destructive cleanup mechanism no longer exists in Cursor.
- Suggested Fix: None.
- Triage: Fixed at the invariant owner rather than patched at the reported line.

### F002 — Shared lock acquisition changes missing-parent results and creates configuration state

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by `asm-review-logic`
- Class: feature
- File: `src/cursor/CursorHookInstaller.ts:305`
- Status: accepted
- Evidence: `withLock` stats the parent, but then calls `LockedFile.withLock`; its acquisition recursively creates that same parent before opening the lock. If the directory is removed or renamed after the stat, the delegated `mkdir` recreates it and reconcile can write `hooks.json`. Cursor's removed acquisition instead opened the lock directly, so the same interleaving ended with `ENOENT`, returned the unchanged `lockUnavailable` value, and created nothing. This is the same directory-name re-resolution family as R1, but it is a new avoidable boundary and defeats the separately accepted no-parent-creation obligation; R1's platform limitation does not require retaining recursive creation.
- Impact: F002 remains reproducible under a deterministic interleaving. Install or uninstall can recreate a Cursor configuration directory after another actor removed it, despite the restored policy claiming that an absent parent refuses without mutation.
- Suggested Fix: Put the policy in the acquisition primitive rather than in a precheck: add a `LockedFile` mode that skips recursive parent creation, or inject an acquisition adapter whose mkdir is a no-op so the subsequent exclusive open itself returns `ENOENT`. Keep the stable absent-parent tests and add the remove-between-check-and-acquire witness.
- Triage: Persists from round 1. The pre-stat narrows the original defect but does not close the invariant at the act that recreates the directory.
- Author triage: accepted, and the distinction from R1 is right — R1 is redirection we cannot prevent, this is creation we simply need not perform. My first fix put the policy at the caller and left the act at the callee, which is why a window existed at all. Second attempt on this invariant, so the next one that fails it trips the thrash stop. Fixing it in `LockedFile` where the `mkdir` is: with creation skipped, `open(lockPath, "wx")` returns ENOENT on an absent parent, `acquireLock` returns undefined, and the caller gets its unchanged `lockUnavailable` — no window, and the precheck is deleted rather than kept as belt-and-braces.

### F003 — The hybrid-filesystem guard observes an unrelated directory

- ID: F003
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; corroborated by `asm-review-contracts` and `asm-review-reuse`
- Class: machinery
- File: `src/cursor/CursorHookInstaller.test.ts:133`
- Status: accepted
- Evidence: The unrelated-directory assertion was removed, but the replacement Proxy still does not seal the path used by production code. Both `CursorHookInstaller` and `LockedFile` build their filesystem adapters with object spread over real defaults. Object spread enumerates only the Proxy target's existing own keys; it never reads an omitted property, so the `get` trap does not fire and the real default remains. The new witness at line 1105 accesses `memoryFs.link` directly and therefore proves only direct Proxy access. A targeted JavaScript probe reproduced the distinction: direct access threw `missing link`, while `{ link: realLink, ...sealed }` retained `realLink` without invoking the trap. The fixture currently implements all operations reachable by these Windows tests, so no present test is known to escape; the regression guard still cannot detect a future omission.
- Impact: Task 1_6's accepted outcome remains false through the actual constructor path. A future omitted operation can silently reach real `node:fs/promises` while the new arm-check stays green.
- Suggested Fix: Pass a type-complete filesystem object that explicitly owns every shared-lock operation, using fail-fast functions for operations the fixture must never call, or change the test seam so an explicit filesystem is not merged over real defaults. Arm-check by deleting one operation and invoking `CursorHookInstaller.install()`, not by directly reading the Proxy property.
- Triage: Persists from round 1. The attempted witness tests a different access mechanism from the one the installer uses.

### F004 — The rewritten write-failure test no longer reaches a returned handle

- ID: F004
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- Class: machinery
- File: `src/cursor/CursorHookInstaller.test.ts:1145`
- Status: fixed
- Evidence: Cursor now routes staging through the already-tested `LockedFile` invariant owner. Added integration witnesses make a returned temporary handle fail at `writeFile` and `chmod`, while the existing and new replace-failure witnesses cover commit failure and stable substitution. The shared `lockedJsonFile.test.ts` suite asserts failed replace leaves no owned temporary and that a substituted pathname is neither committed nor cleaned. Closure and cleanup no longer belong to a Cursor-local implementation.
- Impact: The post-create lifecycle is covered at its shared owner and at the Cursor delegation seam.
- Suggested Fix: None.
- Triage: Fixed through reuse plus focused integration coverage.
- Author triage: accepted. I reproduced the spread stripping the Proxy before the chair's report arrived, via the reuse specialist. This is the round-1 defect relocated, not fixed: a guard that looks like a guard and cannot fire. The lesson is that the arm-check has to run through `install()` — the production path — rather than against the fixture object, which is exactly what the chair's suggested fix specifies and what I failed to do the first time.

## Accepted risk

The following user-granted risks remain non-gating. Owner: WT-012.21. Expiry: none. Reactivation trigger: a Node release exposing usable descriptor-relative `openat`/`renameat` operations.

- R1 — Directory substitution between named lock, staging, read, and commit operations. Status: risk-accepted. The new parent-precheck-to-recursive-mkdir boundary shares the name-rebinding mechanism, but it is not waived here because recursive recreation is avoidable and violates the separate no-parent-creation contract (F002).
- R2 — Release-leaf substitution between identity comparison and unlink. Status: risk-accepted.
- R3 — Temporary-leaf substitution between ownership comparison and rename/discard. Status: risk-accepted.
- R4 — Post-release wedge when a rebound lock name is refused and no age reclaim exists. Status: risk-accepted.

## Clean areas

- Two fresh `LockedFile` instances are safe. Lock ownership is local to the `withLock` call's handle, staging state is local to `stageReplacement`, and the class stores only immutable path/dependency configuration. `atomicReplace` does not acquire a second lock. Both instances receive the same `fs`, `sleep`, `platform`, `rename`, and `randomBytes` references.
- The Windows `directories` set models a real filesystem invariant that the former file-only double omitted: a represented config file necessarily has a directory parent. Without it, all nine paths return at the new parent gate before reaching the behavior each test owns. No result assertion was weakened by adding the directory identity.
- `unsupported-platform`, `unsupported-config`, unresolved-path, lock-unavailable, and lock-release-failed translations remain unchanged once the parent exists.
- No `.only` or `.skip` was introduced.
