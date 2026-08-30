# Asimov Review Round 5

- Date: 2026-08-30
- Cycle: 5
- Round: 5
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `95e5eb3c^..fbf369089114dce9887dd87941560d6799debf4b` (`HEAD` advanced once during review by a metadata/context-only commit, which was incorporated)
- Head: `fbf369089114dce9887dd87941560d6799debf4b`
- Tree: dirty outside the explicit range; current Asimov analytics updates, `skills-lock.json`, and an unrelated audit document were excluded
- Reviewable lines: 2,700, including 2,047 generated Asimov analytics/build metadata and 653 production-code lines; 1,311 changed test lines reviewed inline
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — pool concurrency, generations, leases, cleanup and disposal — `opus[1M]`
  - `asm-review-data-security` — stale-answer safety, unreadable paths, temp-file ownership and shutdown — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — fixed-key-space retention, transient growth and hot-path work — `sonnet[1M]` (report completed after transport retries)
  - `asm-review-contracts` — SQLite entry-point, status, callback and injection contracts — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — stamp/path/lifecycle ownership and repository reuse — `gpt-5.6-luna[1M]`
  - `asm-finder` — production caller, path-growth and list/detail/lookup/shutdown inventory — support search
- Agents skipped:
  - `asm-review-frontend` — no frontend, rendering, client-state or accessibility behavior changed
- Verification evidence: `.build/verified.ndjson` records all thirteen tasks at exit 0, including cycle-5 tasks 5_1 through 5_3. The caller records type check clean, 5,441 unit tests passing, I10 passing, and Biome `src` at 0 errors / 14 warnings baseline. Review did not rerun project verification.
- Verdict: WARN
- Counts: 0 BLOCK / 1 WARN / 2 SUGGEST
- Split over gating blockers: 0 feature / 0 machinery

## Risk map and full-flow trace

- **Top risk — stale absence:** `readPrimarySqlite` / `withPrimarySqliteSnapshot` probe presence, borrow through the process-wide pool, prove a coherent `db,wal,db,wal` generation, query only the engine snapshot, and release in `finally`. Unusable or changed generations never authorize a retained hit; snapshot failures remain `db-unreachable` / `query-error`, not empty `ok`.
- **Retention bound:** the complete production caller inventory proves that only Codex `state_5.sqlite`, OpenCode `opencode.db`, and Cursor IDE `state.vscdb` reach the retaining wrappers. `VaultService` supplies default options, so the production key space is fixed at three paths. Cursor CLI per-chat `store.db` detail/identity reads use plain `withSqliteSnapshot` and delete on last release.
- **List/cache flow:** Codex and OpenCode list caches now share `storeFilePaths` and the `readOnce` stat loop with the reuse gate while deliberately keeping their permissive usability policy. Cursor IDE also opts into retention in this range, but its list-cache source key still has a separate path list and stat loop (W4).
- **Concurrency:** matching generations join one production; later generations wait and then produce their own snapshot. A bounded waiter can displace the joinable map binding, so two same-path productions are reachable despite the literal “one in-flight” shorthand. That does not recreate B7: the displaced generation cannot also pass the stable-retention check after the write that caused displacement, and lease acquisition plus publication are synchronous in the current producer.
- **Lifetime:** producer, hit and join leases increment before any deletion boundary can run; supersession and idle eviction require zero leases; failed deletion retains ownership and retry eligibility; disposal closes admission, drains admitted borrows and leases, then destroys every `liveEntries` member and reports persistent failure.
- **Shutdown:** extension deactivation awaits default-pool disposal and logs cleanup failure before continuing extension teardown.

## Prior finding disposition

- B1-B6, W1-W3 and W5-W7 are fixed at their invariant boundaries in the reviewed range.
- B7 is fixed: the producer owns a lease before publication. The residual same-store deletion schedule proposed in the handback is not reachable for a stable retained producer, although displaced same-store flights themselves are reachable after the bounded wait.
- B8 is superseded by the approved D3 change. Full caller tracing confirms the replacement premise: retained keys are exactly the three fixed primary stores, while per-chat stores do not retain.
- W4 persists and its boundary inventory expands: Codex/OpenCode/pool path ownership was consolidated, but the newly retaining Cursor IDE reader exposes a fourth independently-authored list-cache path/stat loop.
- Prior rejected findings remain rejected. No `audit-backlog` or `risk-accepted` entry exists to carry forward.

## Findings

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorIdeReader.ts:6,260-278`
- Title: Cursor IDE leaves the store path and stamp loop with a fourth owner
- Evidence: this range changes Cursor IDE to the retaining `withPrimarySqliteSnapshot` path, so its reuse gate now derives the store generation through `storeFilePaths` and `readOnce`. Its persisted list-cache source key still independently constructs `[dbPath, dbPath-wal]` and performs its own `fs.stat -> FileStamp` loop in `sourceStamps()`, including a distinct `isFile()` policy. D1 and task 5_3 require one owner so the reuse gate and list cache cannot answer the same freshness question from separately-authored path sets. The current path sets happen to match, but the accepted single-owner outcome is not enforced at this newly retaining boundary.
- Invariant: the `.db` + `-wal` file set and its stat traversal have one owner wherever a persisted cache and retained-snapshot gate describe the same store. Boundary inventory searched: pool generation, Codex list cache, OpenCode list cache, Cursor IDE list cache, and Cursor CLI per-chat reads. Affected: Cursor IDE list cache. Verified safe: pool, Codex and OpenCode use the shared helper; Cursor CLI does not retain.
- Impact: a later sidecar/path or stat-policy change can invalidate reuse and the Cursor IDE persisted list cache against different source sets, re-opening the stale-cache class D1/W4 was meant to remove. There is no current stale answer because both path sets are equal today, so this remains WARN rather than BLOCK.
- SuggestedFix: route Cursor IDE through the shared path/stamp owner. Decide the existing `isFile()` behavior explicitly, then expose a shared permissive stamping primitive that preserves that verdict (or deliberately aligns it), and add a Cursor IDE case that fails if its cache source set diverges from `storeFilePaths`.
- Status: accepted; persists from round 2 with an expanded boundary
- Triage: pending cycle-5 remediation

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:477-478,548-549`
- Title: Primary wrappers type-check a fourth options argument and silently ignore it
- Evidence: both primary aliases are declared as `typeof readSqlite` / `typeof withSqliteSnapshot`, whose signatures now include a fourth `BorrowOptions` argument, but each implementation accepts only three arguments and always supplies `{ retain: true }`. A call such as `readPrimarySqlite(path, sql, deps, { retain: false })` therefore type-checks while its explicit option is discarded.
- Impact: no production caller passes the fourth argument today, but the public internal type advertises an opt-out the implementation does not honor, making future retention mistakes silent.
- SuggestedFix: give each primary wrapper an explicit three-parameter signature so the compiler rejects a fourth options argument.
- Status: new
- Triage: pending

### S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:203-210`
- Title: Non-retaining snapshots perform a second generation proof that cannot affect their outcome
- Evidence: after every successful `take()`, `produce()` unconditionally runs `readGeneration()` before evaluating `stable = retain && ...`. For Cursor CLI's deliberately non-retaining path, the second coherent generation read means four extra `fs.stat` calls whose result is discarded because `retain` is already false. The initial generation read remains necessary for safe in-flight joining; the post-production read does not.
- Impact: per-chat detail and identity reads pay avoidable filesystem work on every snapshot. This is not a correctness issue and is small beside large primary-store snapshots.
- SuggestedFix: after a successful `take()`, take the lease and return directly when retention is false; keep the second generation proof only for candidates that may be retained, preserving `liveEntries` ownership and cleanup on every failure path.
- Status: new
- Triage: pending

## Inline support review

- Snapshot-pool, SQLite-wrapper and generation behavior have focused changed tests; no `.only`, `.skip`, disabled case, unawaited async assertion, secret-bearing fixture or destructive seed was introduced.
- The cycle-5 tests discriminate non-retaining release, fixed opt-in retention, failed-release retry, final-idle retry, unreadable list-cache stamping and SQLite entry-point reuse/status behavior.
- The distinct-store B7 test no longer mutation-kills moving the producer lease after publication once capacity eviction is removed. A same-store displaced flight is reachable, but a valid stable-retention/supersession schedule that deletes the producer before handoff is not; no missing correctness test was reported.
- Unrelated test-file formatting and skipped research/design Markdown in the explicit range introduce no behavioral finding.
- Generated analytics/build metadata contains no credential or secret finding.

## Rejected or merged specialist candidates

### R7 — retry exhaustion

- Proposed: WARN / MEDIUM / P3
- Agent: `asm-review-performance`
- Title: Five failed deletions create monotone temp-disk growth
- Status: remains rejected from round 4
- Triage: `MAX_DELETE_ATTEMPTS` is the explicit bounded retry policy already adjudicated in R7. Exhausted entries remain in `liveEntries`, and `dispose()` retries every live entry regardless of the attempt ceiling and reports any directory it still cannot delete; the specialist's claim that disposal loses visibility is contradicted by `dispose():298-307`.

### R11 — matched joiners should retry a failed shared production

- Proposed: WARN / MEDIUM / P3
- Agent: `asm-review-logic`
- Status: rejected
- Triage: D4 deliberately makes concurrent same-generation callers share one production, including its failure. The sibling mismatched-generation branch suppresses the rejection only because it was waiting for a different generation's slot, not consuming that production. The accepted contract requires a caller arriving after failure to retry, which the identity-checked map cleanup provides; independent retries by every concurrent joiner would amplify the expensive failure.

### R12 — restore an in-pool capacity backstop

- Proposed: SUGGEST / MEDIUM / P4
- Agent: `asm-review-logic`
- Status: rejected
- Triage: D3 explicitly replaces enforcement with a structurally fixed key space. Full production tracing proves the three retaining paths and the non-retaining per-chat path; adding a cap or retainable-path policy inside the pool would reintroduce the machinery the accepted design removed without a current violating caller.

### R13 — post-production generation rejection orphans the snapshot

- Proposed: WARN / MEDIUM / P4
- Agent: `asm-review-logic`
- Status: merged in part into S2; ownership claim rejected
- Triage: the default coherent generation reader absorbs stat failures and does not reject. An injected reader can reject, but the entry remains in `liveEntries` and disposal retains ownership and cleanup visibility; it is not ownerless. The concrete avoidable non-retaining read remains as S2.

---

## Author triage (round 5)

**[W4] Cursor IDE leaves the store path and stamp loop with a fourth owner** — Status: accepted.
Triage: agreed, and found independently by the author before the report arrived (recorded in
workflow.md) — the reuse specialist reported this area clean, so this is the fourth finding this
change has had reach triage from somewhere other than the specialist that owned it. The chair's
framing is the right one: the paths match today, so this is not a live stale answer, it is D1's
single-owner obligation left unmet at a boundary that only just became a retaining one.

The `isFile()` question the chair asked to be decided explicitly: **the guard is dropped.** It exists
in `sourceStamps` and has never existed in `readOnce`, which is precisely the divergence D1 forbids —
the list cache and the reuse gate must answer the same freshness question the same way, and keeping a
policy on one side to avoid touching it would preserve the defect the finding names. Dropping it
changes behaviour only where a DIRECTORY sits at the store path or its `-wal`: previously skipped,
now stamped. That state cannot produce a working store — the snapshot would fail and the read would
report a status, never `ok` with zero rows — so the guard is incidental, not load-bearing. Pinned by
a test either way, so the decision is recorded in the suite rather than in this file alone.

**[S1] Primary wrappers accept and ignore a fourth options argument** — Status: accepted.
Triage: a real trap rather than a style point. `typeof readSqlite` gives the wrapper a fourth
parameter it silently discards, so `readPrimarySqlite(db, sql, deps, { retain: false })` type-checks
and retains anyway — the exact mistake a future caller would make when trying to opt OUT at a
primary reader. Fixed by giving the wrappers explicit three-parameter signatures, so the opt-out is
a compile error instead of a silent no-op.

**[S2] Non-retaining snapshots perform an unnecessary second generation proof** — Status: accepted.
Triage: correct, and it is the per-chat path that pays it — the one D3 identifies as the high-count
axis (72 stores on the development machine), so four wasted stats per store is the wrong place to
leave them. The second proof exists only to decide retention (D2), so it is skipped when there is no
retention to decide. Note this does NOT weaken D2: a snapshot that will not be retained needs no
attribution to a store state, because nothing will ever be served from it again.

