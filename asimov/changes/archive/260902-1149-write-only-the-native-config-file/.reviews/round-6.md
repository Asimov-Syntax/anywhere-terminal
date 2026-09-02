# Review round 6 — write-only-the-native-config-file

- Date: 2026-09-02
- Cycle: 3
- Mode: discovery
- Review lane: fastlane
- Scope: range `5184b613..HEAD` — the round-5 artifact handback, approved D17 amendment, implementation, and recorded verify commit. Head `d5b9eec54c11711990ab0b414c8fb613c4c5d2f2`.
- Working tree: `asimov/changes/write-only-the-native-config-file/analytics.json` has additional uncommitted telemetry and `asimov/changes/prove-entry-reconstruction-on-windows/analytics.json` is untracked telemetry from another change; neither is part of the explicit reviewed range. No production file is dirty.
- Change context: Gate 2 is approved. This is a new cycle's discovery round because round-5 F025 was closed by an artifact handback that changed D17's mechanism and `NativeConfigDeps`, not by remediation inside cycle 2.
- Reviewable lines: 146 by the classifier — 76 changed TypeScript production lines and 70 changed analytics telemetry lines; 58 changed test lines were reviewed inline. The review artifacts and ordinary Markdown files were context or skipped support surface.
- Verify gate: `bun run asm change verify-status write-only-the-native-config-file` records task `7_1` `[x] exit 0`; commit `d5b9eec5` records 7018 tests and both invariant gates passing. Review did not re-run project verification.
- Targeted probe: a temporary repository used a recognized, contained FIFO at `asimov/worktree.yaml` with no writer and an existing native configuration requiring an edit. The production `writeNativeConfig` promise remained unresolved past 750 ms while `.vscode/worktree.json.anywhere-terminal.lock` existed. The process was killed and the temporary script and repository were removed in the same command.
- Agents spawned: 4 (logic, data-security, performance, reuse) plus chair self-review and mandatory full-flow trace. Contracts and frontend were skipped because this internal filesystem delegation changed no wire/schema or UI behavior; their applicable contract/error-flow questions were covered by chair and logic.
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 0 WARN · 0 SUGGEST.
- Split: 1 feature · 0 machinery.

## Cross-round filter

| ID | Round 5 | Round 6 | Evidence |
|---|---|---|---|
| F014 | fixed | **fixed** | The dialog pending-save derivation is outside this range and its host flow did not regress. |
| F019 | fixed | **fixed** | Destination construction remains based on `authorizedPathInsideRoot`'s returned value; the new reader call does not alter the target, lock, or temporary-path derivation. |
| F022 | fixed | **fixed** | First-create mode masking is untouched. |
| F023 | fixed | **fixed** | Switched-from selection eviction is untouched. |
| F025 | accepted | **fixed** | The writer now calls exported `baseFor` and keeps no membership, containment, existence, type, or readability rule of its own. Unknown, missing, outside, oversized, directory, and permission-denied bases reach the reader-owned answer and fail closed as `unnamed`; a stable base accepted by `baseFor` has no additional writer-side base predicate. |

## Findings

### F026 — A FIFO base can hold the native-config lock indefinitely

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:480`
- Title: A FIFO base can hold the native-config lock indefinitely
- Evidence: The changed line awaits `baseFor` from inside `LockedFile.withLock`. `baseFor` reaches production `openProviderFile`, whose `createProvisioningDeps().readFile` calls `readBounded`; `readBounded` begins with `open(filePath, "r")` at `provisioningDeps.ts:36`. On POSIX, opening a FIFO read-only with no writer waits rather than rejecting. The byte cap applies only after that open returns, and there is no nonblocking flag, abort, or timeout. `withLock` releases at `lockedJsonFile.ts:84` only after the work promise resolves or throws. A targeted full production-path probe replaced the recognized, contained `asimov/worktree.yaml` with a FIFO after creating an editable native document: `writeNativeConfig` was still unresolved after 750 ms and its sibling lock existed throughout. This is a different mechanism and impact from F025: reader/writer eligibility delegation is now complete, but the delegated read has no liveness bound when moved under the write lock.
- Impact: A repository-controlled special file, or a post-offer replacement with one, can leave the save unanswered and keep the native configuration locked until another process opens the FIFO or the extension process is restarted. Later saves wait for the sibling lock and then fail their one-second acquisition window; the changed flow turns an unreadable base into a persistent local denial of the save path rather than the required refusal.
- SuggestedFix: Fix the reader-owned open, not the writer. Make the production provider open itself nonblocking and validate the opened handle as a regular file before reading (with the platform-equivalent safe operation), or enforce another real cancellation/liveness bound that closes the handle and returns the reader's unreadable result. Keep `writeNativeConfig` delegating only to `baseFor`; adding a writer-side `lstat` would reopen F025's partial-reconstruction failure and would remain racy.
- Status: accepted
- Resolution: closed by the dependency `open-a-provider-file-without-waiting-on-it`, planned, built
  and reviewed to APPROVE independently (`docs/PLAN.md` WT-012.20, archived
  260902-1135). The remediation is NOT in this change's diff: its plan attack refuted the
  writer-side check this finding's SuggestedFix could also have been read as licensing, because
  `lstat` then a path-based read is a race, so the bound went into the open itself. Both witnesses
  the fix owes this change live in `src/worktree/provisioning/writeNativeConfig.test.ts` — a pipe
  already at the target, and a pipe that replaces it after the writer observed it — and both assert
  a refusal, no lock file left, and a following save that still runs. `writeNativeConfig.ts` is
  unchanged.
- Triage: New gating discovery finding. Boundary inventory searched: exact adapter membership, resolved containment, root preparation, bounded bytes, special-file type, lock acquisition/release, nested locks, adapter parsing, secondary-file reads, directory scanning, immediate host reread, and refusal mapping. Affected: special files whose open can wait indefinitely, especially a FIFO with no peer, because the wait now occurs while the native lock is held. Verified safe: stable unknown/absolute/traversal/outside/missing/oversized/directory/permission-denied cases fail closed; `baseFor` performs no adapter parse, secondary-file read, directory scan, or nested lock; F019's authorized destination remains intact.

## Verified sound

- F025's invariant-level handback is implemented: `FRAMEWORK_ORDER` is private again, `baseFor` is the only base-eligibility decision, both return failures map to `unnamed`, and production wires the same bounded provider dependencies used by `readProvisioning`.
- The lock-held work has no repository-size growth axis after a successful open: one fixed-size adapter-list lookup, one containment walk by path depth, and at most `MAX_PROVIDER_BYTES + 1` bytes. The blocker is the open's missing time/liveness bound, not byte growth, parsing, recomputation, or enumeration.
- No re-entrant lock acquisition or lock-order cycle is introduced. The base operation reads a framework file and does not acquire `LockedFile`; the failure is that an unresolved read prevents the already-held native lock from reaching release.
- The widened `unnamed` message matches both missing and unreadable reader outcomes. The host still rereads after either success or refusal and publishes only into the live opening.
- The three new witnesses are additive, awaited, and discriminate oversized, directory, and permission-denied bases without weakening existing round-3/round-4 path witnesses. They do not cover the special-file liveness boundary in F026.

## Sub-agents spawned

- asm-review-logic: complete delegation, error flow, re-entrancy, and host wiring — `gpt-5.6-sol[1M]`
- asm-review-data-security: filesystem authorization, path-oracle closure, and fail-closed cases — `gpt-5.6-terra[1M]`
- asm-review-performance: lock-held work, byte budget, growth axes, and starvation — `sonnet[1M]`
- asm-review-reuse: removal of writer-side eligibility reconstruction and API cohesion — `gpt-5.6-luna[1M]`
