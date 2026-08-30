# Review Round 1: prove-the-store-is-readable-not-merely-there

**Date**: 2026-08-30
**Cycle**: 1
**Mode**: discovery
**Requested execution mode**: fastlane
**Scope**: commit `2b9d49f7` only
**Head**: `2b9d49f7fdc63725c0579f98ba23f46864915bc4` (working tree dirty outside the reviewed commit)
**Reviewable lines**: 270
**Agents spawned**: `asm-review-data-security`, `asm-review-logic`, `asm-review-contracts`; support trace by `asm-finder`
**Agents skipped**: `asm-review-frontend` (no UI code), `asm-review-performance` (no new collection, recompute, or additional hot-path syscall), `asm-review-reuse` (no new helper or duplicated repository capability)
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 2 WARN, 0 SUGGEST
**Blocker split**: 1 feature / 0 machinery

## Scope and accepted obligations

Gate 2 is approved. This review applied task 1_1 and change decisions D1/D2: both SQLite read entry points must classify a present-but-unreadable store as `db-unreachable` before pool work; only ENOENT/ENOTDIR may mean absent; the proof must not split across the two entry points or add another access check per pool hit. The explicit scope is commit `2b9d49f7` only; its parent belongs to WT-011.7 and was not reviewed.

## Risk map

- Readability authority: one filesystem predicate now claims the SQLite source can be read and gates both cache-hot and cache-cold paths.
- Cross-platform permissions: the extension and vault explicitly support macOS, Linux, and Windows, whose ACL semantics differ from POSIX mode bits.
- SQLite source set: a WAL-mode store's readable content is the database plus any live `-wal`, while the predicate checks only `dbPath`.
- Shared dependency seam: the changed predicate also backs the write path's boolean `exists` check.
- Status consumers: `no-db` authorizes absence/fallback behavior; `db-unreachable`/other failures surface unreadable or unknown.
- Test integrity: the real-filesystem case depends on permission enforcement, a retained pool entry, and a claimed fresh comparison.
- Scale: retained keys remain structurally bounded to primary stores; the patch replaces one existing access call and adds no collection or recompute growth axis.

## Full-flow trace

- Entry and engine: `readSqlite` and `withSqliteSnapshot` select `node:sqlite` or the CLI, then call the same `presence()` before any pool admission.
- Presence translation: production prefers `defaultDeps.access`; ENOENT/ENOTDIR become `no-db`, every other access error becomes `db-unreachable`.
- Cache hot path: after presence succeeds, `SnapshotPool.borrow` reads the `.db`/`-wal` generation and returns a retained snapshot when `(mtimeMs,size)` matches. A hit is reused regardless of whether the current borrower requested retention.
- Cache cold path: a miss takes an engine-owned read-only snapshot. Source-open failures map to `db-unreachable`; other snapshot failures map to `query-error`.
- Consumers: OpenCode and Cursor render an unreachable store as unreadable/unknown; Codex keeps its documented fallback while refusing to claim absence after an inconclusive database read. The read-side D2 judgement is correct for errors that reach `presenceFromAccessError`.
- Write side: `defaultWriteDeps.exists` aliases the changed boolean wrapper. An R_OK denial now exits `writeSqlite` as `no-db` before its engine can return `write-error`.
- Output: the intended POSIX base-file case is stopped before stale pool reuse, but the proof does not cover all supported permission mechanisms or all files SQLite must read.

## Findings

### B1

- **ID**: B1-R1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security`, expanded and corroborated by `chair`
- **Class**: feature
- **File:line**: `src/vault/sqlite.ts:145-166`
- **Title**: R_OK on the base file does not prove the SQLite store is readable
- **Evidence**: The repository explicitly supports Windows (`README.md:9,52`), and the vault's built-in engine fallback is described as the normal Windows path (`src/vault/sqlite.ts:93-96`). Node documents that `fs.access()` on Windows does not check ACLs and may report a path accessible despite ACL denial, so `R_OK` can still admit a retained snapshot when a cold SQLite open would fail. Independently, the repository defines a WAL store's source set as `[dbPath, dbPath + "-wal"]` (`src/vault/storeStamp.ts:42-47`), but the new proof checks only `dbPath`; generation reuse merely stats the WAL and therefore does not prove its contents readable. A disposable probe on this checkout made the base file R_OK and its live WAL unreadable: `fs.access(db,R_OK)` succeeded, `fs.access(wal,R_OK)` failed, and a new read-only `DatabaseSync` query failed with `ERR_SQLITE_ERROR`, errcode 14 (`unable to open database file`). The retained path would pass `defaultAccess`, observe unchanged stamps, and serve the old snapshot.
- **Impact**: The accepted status agreement remains false on a supported platform and for an ordinary WAL-mode permission boundary: a retained read can answer `ok` after the live store has become unreadable while a fresh process/pool answers `db-unreachable`. That is the exact contract divergence this task exists to close.
- **SuggestedFix**: Make the single pre-reuse proof equivalent to the source SQLite must read on every supported platform, including ACL enforcement and a present WAL. Reuse or replace existing generation work so this does not become an additional per-hit probe; a base-file `fs.open` alone is still insufficient for WAL mode. Add Windows-ACL coverage where available and a POSIX unreadable-WAL regression, or narrow the accepted contract explicitly through planning.
- **Status**: open
- **Triage**: pending

### W1

- **ID**: W1-R1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic` and `asm-review-contracts`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/vault/sqlite.ts:152,165,619,677-686`
- **Title**: The shared R_OK predicate changes write-path no-db semantics
- **Evidence**: `defaultDeps.exists` now returns false for any non-R_OK path, and `defaultWriteDeps.exists` aliases it. `writeSqlite` maps false directly to `no-db`, whose documented meaning is “the store file is absent.” Before this commit, an existing unreadable/write-only file passed F_OK and the actual SQLite write failure returned `write-error`; after this commit it is reported absent without attempting the write. The write status union has no unreachable member.
- **Impact**: A changed caller outside the two reviewed read entry points now conflates permission denial with absence. Current rename callers fall back on either failure, so the immediate UI outcome is preserved, but the exported and documented status contract is wrong and error detail is lost.
- **SuggestedFix**: Keep the write path on a true F_OK predicate, or give it a presence-aware gate that maps denial to `write-error` rather than `no-db`, while retaining the stronger read-side proof.
- **Status**: open
- **Triage**: pending

### W2

- **ID**: W2-R1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `chair`
- **Class**: feature
- **File:line**: `src/vault/sqlite.test.ts:890-921`
- **Title**: The regression's “cold” comparison can reuse the retained snapshot and its skip is recorded as a pass
- **Evidence**: The test warms the process-wide default pool for `dbFile`, then calls plain `readSqlite` on that same key. `SnapshotPool.borrowAdmitted` returns any matching retained entry before considering whether the current caller requested retention (`src/vault/snapshotPool.ts:138-142`), so the variable named `cold` does not force a new snapshot. With R_OK reverted and unchanged stamps, both post-chmod entry points can reuse the retained file; the test still kills the mutation, but it does not establish the claimed retained-`ok`/fresh-`db-unreachable` split. Separately, the unsupported-environment branch logs and `return`s; Vitest records that as a passing test, not a skipped test. The commit has no CI workflow guaranteeing a non-root POSIX runner, and Windows mode changes normally take this branch.
- **Impact**: The accepted cold-versus-retained scenario is not pinned, and root/ACL-ignoring/Windows runs can report a green test with none of the post-revocation assertions executed.
- **SuggestedFix**: Use a second independent store/key for the genuinely fresh call, or otherwise prove a new snapshot was attempted. Use Vitest's runtime skip facility so unsupported environments are reported as skipped rather than passed, while keeping the reason visible.
- **Status**: open
- **Triage**: pending

## Invariant inventory

- **A reported `ok` requires the live SQLite source to remain readable**: searched POSIX base-file mode, Windows ACL, present WAL, directory search denial, symlink following, cache hot/cold paths, and engine open failures. Sequential POSIX base-file denial and directory denial are safe. Windows ACL and an unreadable present WAL are affected by B1. `fs.access` and SQLite both follow a symlink path, so R_OK adds no distinct symlink class; the pre-existing check/use race remains and a permission change after the check can only be observed by a later call.
- **Only proved absence may become `no-db`**: searched both read entry points, reader translations, lookup behavior, and the shared write dependency. Read paths correctly centralize ENOENT/ENOTDIR in `presenceFromAccessError`; the write boolean collapse is affected by W1.
- **The regression distinguishes retained from fresh behavior**: searched pool keying, retain admission, hit reuse, generation stamps, chmod metadata, and unsupported-runner handling. The retained path is genuinely exercised because chmod does not move `(mtimeMs,size)`; the supposed fresh path and skip accounting are affected by W2.

## Inline support review

The changed test contains no `.only` or static `.skip`; its async operations are awaited and cleanup restores permissions before closing/removing the real store. The retained-snapshot half is causally honest. The early return is not an actual runner skip, and the second read is not guaranteed cold. The analytics metadata contains no credential material; its author email matches commit metadata.

## Repository-wide fs.access check

No other production `fs.access` call has the same existence-before-read weakness. The remaining F_OK uses are test helpers and temporary-file/existence assertions; they are outside production behavior.

## Recorded verification evidence

`bun run asm change verify-status prove-the-store-is-readable-not-merely-there` records task 1_1 exit 0 with unchanged scope and additive assertions. The caller additionally reports type check, 5,539 unit tests, the I10 gate, both esbuild bundles, and `biome check src` at the 0-error/14-warning baseline. Per review policy, no verify command or test suite was rerun. One disposable filesystem probe was created and removed in the same command to validate the unreadable-WAL boundary.

## Specialist results

- `asm-review-data-security` — filesystem permission semantics, supported platforms, and cache reuse — `gpt-5.6-sol[1M]` — B1.
- `asm-review-logic` — entry-point, pool, and shared-helper edge cases — `gpt-5.6-terra[1M]` — W1.
- `asm-review-contracts` — status vocabulary, caller translations, and task obligations — `sonnet[1M]` — W1.
- `asm-finder` — caller/consumer flow, fs.access inventory, and test-environment evidence — `gpt-5.6-luna[1M]` — support trace only.

---

## Author triage — round 1

**[B1] R_OK on the base file does not prove the SQLite store is readable**
- **Status**: accepted. D1 is refuted, not merely under-implemented.
- **Triage**: The probe settles it — base file R_OK, `-wal` unreadable, fresh read-only query fails
  with errcode 14 while the retained generation stays reusable. My D1 argued the fix was a one-line
  strengthening of a predicate that already ran on both entry points; what it actually proved is
  weaker than what its callers assume, on two independent axes. A WAL-mode store is a SET of files
  and the predicate checked one of them, and `fs.access` does not consult Windows ACLs, which this
  project supports. Neither gap is closable by choosing a different `mode` flag.
- **Handback, not remediation.** The task's own PLAN row said the decision it owns is WHERE the proof
  belongs; D1 answered "in the existing presence call, for free" and that answer is wrong. The
  replacement has a cost the proposal explicitly ruled out — proving readability means attempting the
  read, so the reuse path gains work per hit — and the PLAN row allows that only "if that is the
  decision recorded". Recording it is a new decision.

**[W1] The shared R_OK predicate changes write-path no-db semantics**
- **Status**: accepted
- **Triage**: A regression I introduced and did not look for. `defaultWriteDeps` is
  `{ exists: defaultDeps.exists }` (`src/vault/sqlite.ts:614`), which aliases the predicate I changed,
  so an existing but unreadable store answered `no-db` — documented as ABSENT — on the write path
  instead of reaching SQLite and returning `write-error`. Changing a shared helper without walking its
  consumers is the whole of the mistake.

**[W2] The regression's "cold" comparison is pooled and its skip is recorded as a pass**
- **Status**: accepted
- **Triage**: Both halves correct. `readSqlite` after a warmed pool hits the same store key, and
  `snapshotPool.ts:138-142` reuses a matching retained entry regardless of whether this borrower asked
  to retain — so the variable named `cold` was not cold. And the unsupported-environment branch logs
  and returns, which Vitest records as a PASS; I wrote it believing a warning plus early return was an
  honest skip, and it is exactly the vacuous pass I said I was avoiding. Needs a second store key and
  a real runtime skip.

**Disposition.** The change is handed back to plan. The code has been reverted from `main`
(`e2ac05ba`) rather than left in place: W1 is a live regression on a path this task never intended to
touch, and B1 means the shipped half does not deliver the acceptance either. Artifacts are kept —
only the code came off.

