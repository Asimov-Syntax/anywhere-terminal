# Asimov Review Round 4

- Date: 2026-08-30
- Cycle: 2
- Round: 4
- Cycle round: 1
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `dbaa01ee^..4e401984`, plus the caller-mandated current-tree integration seam in `src/vault/sqlite.ts` and `src/vault/snapshotPool.ts`
- Head: `e87eb4496025a3bac7eccc3d1663d4219c59f323` (the historical target range ends at `4e401984`; the pool seam was reviewed as it exists at this Head)
- Tree: dirty outside the requested scope; `skills-lock.json` and `docs/audit/2026-08-30-worktree-lifecycle-gaps.md` were excluded
- Reviewable lines: 2,215 in the explicit range, including generated Asimov analytics/build metadata; 406 added / 114 removed test lines reviewed inline. The requested post-range pool seam was context and is not included in this count.
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — atomicity witness, error flow and borrow/release lifecycle — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — read-only source, failure discrimination and stale-answer safety — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — approved D1-D4, task 2_3 proof and entry-point equivalence — `sonnet[1M]`
  - `asm-review-performance` — W2 resolution, duplicate work and temp-growth axes — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-frontend` — no frontend or client-state cone
  - `asm-review-reuse` — the reuse invariant owner is the independently reviewed archived change; this round reviews only its requested integration seam
- Verification evidence: `bun run asm change verify-status snapshot-a-live-store-atomically` records all seven tasks at exit 0. The caller reports type check clean, 5,443 unit tests passing, I10 passing, and `biome check src` at 0 errors / 14 warnings. Review did not rerun project verification.
- Targeted evidence: an isolated permission probe showed that after `chmod 000` on a database file, `fs.access(path)` in its default `F_OK` mode and `fs.stat(path)` still succeed while a read and a read-only `node:sqlite` open fail with `EACCES` / `ERR_SQLITE_ERROR`.
- Verdict: WARN
- Counts: 0 BLOCK, 1 WARN, 0 SUGGEST
- Split over gating blockers: 0 feature / 0 machinery

## Risk map and full-flow trace

- **Cold node flow:** `readSqlite` / `withSqliteSnapshot` → node/CLI probe → presence → pool generation proof → `mkdtemp` → read-only `DatabaseSync` source → Online Backup steps with a wall-clock abort → query/callback → status translation → lease release and pool-owned cleanup. The source is never opened read-write and a production throw cannot become `ok`.
- **Cold CLI flow:** the same gates → `sqlite3 -readonly <source> VACUUM INTO <destination>` → destination query → status translation → release. Open-class errors blame the source only after a source-only read proof; destination failure remains `query-error`.
- **Hot pool flow:** presence → coherent `db,wal,db,wal` generation → retained hit or matching-generation flight join → query/callback → release. Engine atomicity is preserved because the pool never assembles a snapshot and every cold production still calls `takeSnapshot`; generation mismatch or unusability forces a new atomic production.
- **B1 proof flow:** for node paths, checkpoint plus `VACUUM` runs synchronously inside the shipped backup progress callback; for CLI it runs after process spawn and before settlement. Control flow, not millisecond uniqueness, establishes start → churn completion → settlement. A serialized implementation that does not enter the shipped progress/process path fails the witnesses.
- **Failure flow:** pool production and callback throws reach `withPooledSnapshot`'s catch and become `db-unreachable` / `query-error`; failed deletion remains in `liveEntries`/`undeleted`, later retries, and is retried and reported by disposal. The one open seam is a retained hit whose metadata remains stat-able after read permission is revoked (W4).
- **Growth axes:** snapshot bytes are O(live database pages), known at 1.5 GB. Unchanged retained primary-store generations pay that cost once and reuse in about 1 ms; leases are bounded by concurrent readers and released in `finally`; retained production callers are the three fixed primary stores; per-chat stores deliberately retain nothing. Later generations may need independent snapshots to avoid serving a pre-write generation, so those are correctness work rather than duplicate work for W2.

## Findings

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:138-141`
- Title: A retained hit can bypass a live store that has become unreadable
- Evidence: every entry point first calls `defaultAccess`, but `fs.access(path)` without a mode proves only existence. The pool then authorizes a retained hit when `readStoreGeneration` can `stat` the database and WAL and their `(mtimeMs,size)` values match. POSIX read-permission revocation does not change those values and does not prevent either default `F_OK` access or `stat`. The targeted probe confirmed `access(F_OK): ok` and `stat: ok` after `chmod 000`, while reading and opening the same database with `new DatabaseSync(path, { readOnly: true })` failed. A retained snapshot therefore returns `ok` without exercising the source-open refusal that a cold path maps to `db-unreachable`. The current regression test at `src/vault/sqlite.test.ts:870-888` revokes directory search permission, which makes the presence check fail early, and does not cover a database file that remains discoverable/stat-able but cannot be read.
- Invariant: every store that the engine cannot currently open for snapshotting must fail closed through the existing status vocabulary; a pool hit must not weaken that boundary. Boundary inventory searched: database absent; directory unreachable; database file unreadable but stat-able; retained hot hit; cold node/CLI production; matching flight; callback/query failure; lease release. Affected: retained hot hits after file-level read permission or an equivalent access-state change that metadata stamps do not represent. Verified safe: missing/unsearchable paths; unusable generation reads; cold source refusal; destination refusal; production failure; generation changes; callback and cleanup paths.
- Impact: the hot path can report `ok` — including `ok` with zero rows — where the same live store on the cold path is `db-unreachable`. This breaks the status contract at the new pool seam and can disclose a retained snapshot after access to the source was revoked, although the snapshot bytes remain point-in-time coherent.
- SuggestedFix: require a retained hit to carry a current source-readability proof strong enough to match the supported engine's open boundary, or include access-state changes in the generation proof so they force a cold production and status mapping. Add a focused test that retains a snapshot, removes read access from the database while leaving it discoverable/stat-able, and requires both entry points to return non-`ok` with no rows/value.
- Status: new
- Triage: pending

## Prior finding disposition

- B1: fixed by task 2_3. The node tests act inside real backup steps; the CLI test brackets the spawned snapshot process; all three record start, completed churn and settlement in causal order.
- B2: remains fixed. Throwing from the node backup progress callback aborts the real backup and the deadline test is deterministically expired with `-1`.
- W1: remains fixed. Both engines distinguish a readable source plus failed destination from genuine source refusal.
- W2: fixed by the current pool seam. Unchanged retained primary stores pay one O(pages) production per generation, concurrent matching readers share it, both entry points share the same pool, and writes force a new atomic snapshot. The measured 1.5 GB path improves from 2.4-3.0 s unretained to about 1 ms reused.
- W3: remains fixed. The production deadline/progress path is mutation-discriminated.
- S1: remains fixed. The stale mechanism comment introduced in the original range was corrected.
- S2: fixed by task 2_3. The deadline test uses a budget already expired before its first progress step.

## Adjudicated specialist candidates

- Metadata `(mtimeMs,size)` ABA was not re-reported: the archived reuse design explicitly states the same-tick/same-size exposure as inherited from the shipped list cache, and this target range does not widen or change that mechanism. No new evidence delta tied it to this change's implementation.
- Multiple same-path productions after bounded mismatched-generation waits were not accepted as W2 persistence: the current caller has observed a different generation and cannot safely join the older flight; the independently reviewed pool design deliberately waits, rechecks, then permits fresh correctness work rather than starving on continuous writes.
- An in-pool retention allowlist/cap was not re-opened: the archived change's full caller inventory proves only the three fixed primary stores use the retaining wrappers, while per-chat stores use non-retaining entry points. This was previously adjudicated as rejected candidate R12.
- Retry exhaustion was not re-opened: exhausted deletions remain owned in `liveEntries`, disposal retries every one and reports persistent failures. The five-attempt runtime policy was previously adjudicated as intentional.
- The `defaultRunNodeQuery` comment candidate was dropped because the cited lines are unchanged in the explicit target range and the issue is non-critical documentation drift.

## Inline support review

- Task 2_3's tests exercise the shipped node snapshot through `readSqlite` and `withSqliteSnapshot`, plus the real CLI process path. No `.only`, `.skip`, disabled assertion or unawaited operation was introduced.
- The whole-or-failure assertion remains the accepted contract; requiring `ok` under churn would over-strengthen it.
- Pool seam tests cover unchanged reuse, WAL-write invalidation, shared entry points, unreadable directory failure, production failure, lease lifetime and disposal. W4 identifies the missing file-level unreadability boundary.

## Accepted risk

None.

## Audit backlog

None.

---

## Author triage (cycle 2, round 4)

**[W4] A retained hit can bypass a live store that has become unreadable** — Status: accepted,
**parked as its own change** rather than fixed in this cycle.

Triage: the finding is correct and reproduces as described — `fs.access` in its default mode proves
existence, not readability; `stat` still answers for a file whose read permission was revoked, so
the generation is unchanged and the retained snapshot is served as `ok` while a cold read of the
same store returns `db-unreachable`. The chair is also right that the existing unreadability test
revokes DIRECTORY search permission, which fails earlier and never reaches this boundary.

It is not remediation, and landing it as a fix commit here would be the mistake the remediation
boundary exists to prevent. The fix is not "add a check": it is a decision about **what proof
authorizes a hot hit**, and every available answer changes an accepted contract —

- proving `R_OK` in the presence check changes what separates `no-db` from `db-unreachable`, a
  status vocabulary pinned by tests and consumed outside this change;
- folding access state into the generation adds a third input to a proof whose two inputs are
  deliberate and documented (`storeStamp.ts`), and makes every reuse decision pay a syscall the
  reuse design specifically bounded;
- proving readability only at the pool boundary splits the status contract across two owners.

Choosing among those is a new `D#` with a new invariant owner, so it goes back to the blueprint as
its own task rather than being absorbed here.

Scope note on the impact line: the snapshot served is one this process already took while it had
permission, held in a temp directory it owns, so "expose retained data after source access was
revoked" is a contract divergence rather than a fresh disclosure — the bytes were already read
lawfully. That does not reduce the finding to cosmetic: two paths answering the same question
differently is exactly what a status vocabulary exists to prevent.

**Verdict**: 0 gating blockers. B1 fixed and now reviewed, W2 answered by the archived reuse change
with measurements. This change archives; W4 becomes a blueprint task.

