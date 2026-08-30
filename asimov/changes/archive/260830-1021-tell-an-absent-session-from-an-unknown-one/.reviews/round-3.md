# Asimov Review Round 3

- Date: 2026-08-30
- Cycle: 2
- Round: 3
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `16cd5756..c1517e774105efe74fb1f3c3142a3072d387757e`
- Head: `c1517e774105efe74fb1f3c3142a3072d387757e`
- Tree: dirty outside the explicit range; current uncommitted analytics, `docs/PLAN.md`, and `skills-lock.json` changes were excluded
- Reviewable lines: 2,362 (688 production TypeScript + 1,674 Asimov analytics/build metadata); 493 changed test lines reviewed inline
- Size note: Large change — accuracy may decrease. Count is dominated by Asimov analytics/build metadata.
- Agents spawned:
  - `asm-finder` — SQLite status, lookup/wrapper, and Cursor shared-resolver caller inventory — `gpt-5.6-luna[1M]`
  - `asm-review-data-security` — storage classification and read-completeness boundaries — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — reader result decision trees — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — adapter/status/wrapper contract migration — `sonnet[1M]`
  - `asm-review-logic` — Cursor resolver extraction impact — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — presence helper and resolver reuse — `gpt-5.6-luna[1M]`
  - `asm-review-performance` — lookup scan growth and duplicate work — `gpt-5.6-luna[1M]` (resumed after a transient API stop)
- Agents skipped:
  - `asm-review-frontend` — no frontend code changed
- Verification evidence: `.build/verified.ndjson` records tasks 1_1 through 2_1 at exit 0. The accepted build record and caller brief report type check clean, 5,381 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.
- Verdict: BLOCK
- Counts: 2 BLOCK, 0 WARN, 0 SUGGEST
- Split: 2 feature, 0 machinery

## Gate and classification

- Gate 2 is approved on the amended contract. Design D1-D6, task Acceptance/Boundary fields, docs/DESIGN.md D36, and WT-011.8 are binding.
- Reviewable production scope: the new lookup union, service/adapter compatibility seam, SQLite presence vocabulary, four reader classifications, and the Cursor resolver extraction in `4df34f4a`.
- Tests were reviewed inline. Change Markdown/spec artifacts and `docs/**` were skipped by file classification but read as accepted intent and architecture context.
- Committed analytics/build metadata is non-executable and consistently shaped.

## Risk map

1. A filtered or partial read reaches a new `absent` return and lets WT-011.5 retire a live preview.
2. The main SQLite file is reachable while its WAL is not, making an apparently successful snapshot incomplete.
3. `db-unreachable` reaches a list/detail/lookup consumer that still assumes the old status set.
4. Classified and nullable entry paths diverge, perform two reads, or lose service enrichment/id rewriting.
5. Cursor CLI/project classification is reused by detail, launch, child-link, and watch paths and may change their behavior.
6. Existing per-user/session scans gain duplicate work or a new unbounded growth axis.

Growth axes reviewed: Claude project/session directories; Codex rollout history; Cursor workspace buckets/chats and project transcripts; SQLite snapshot bytes. The change adds no new asymptotic scan or duplicate lookup.

## Full-flow trace

1. `VaultService.lookupEntry` parses the entry id, resolves the bounded process-local Cursor child locator, dispatches one adapter, rewrites found child identity, and applies `canFork` only on `found`. `getEntry` calls it once and unwraps both inconclusive states to null; all six external nullable callers remain untouched.
2. Claude lists the project root, prepares one resolved containment root, probes each deterministic candidate, and builds the entry. Failed/non-exhaustive paths return unknown; exhaustive misses return absent. The deliberate choice to make every false containment result non-exhaustive remains conservative and safe.
3. Codex queries SQLite, maps a returned row, and uses rollout filename fallback for `no-db`, `no-sqlite3`, and `db-unreachable`; a db-unreachable miss remains unknown because rollout cannot speak for the uninspected index. Its list explicitly gates success on `ok` and retries failures via empty cache sources.
4. OpenCode maps a successful point query, treats confirmed missing DB as absent, and every other SQLite failure as unknown. Its list treats db-unreachable as unreadable.
5. Cursor CLI and project lookup require completeness before claiming a unique candidate, then share metadata/cwd mapping with nullable detail/launch/watch consumers. IDE carries nested header query failure/unmappable rows out of the outer snapshot as unknown. Missing child locators remain unknown.
6. All exported `read*Entry` wrappers call their corresponding `lookup*Entry` once and only unwrap `found`.
7. The top-level SQLite presence split is correct, but the shared snapshot reader still collapses WAL-sidecar access failure and can return a successful stale base-only query; B1-R3 covers all SQLite-backed lookup boundaries.

## Findings

### B1-R3

- ID: B1-R3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair)
- Class: feature
- File: `src/vault/sqlite.ts:298-303,332-340,374-384`; affected conclusive returns in `src/vault/readers/codexReader.ts:581-589`, `src/vault/readers/opencodeReader.ts:293-301`, `src/vault/readers/cursorIdeReader.ts:489-502`
- Title: An unreadable WAL can still become a successful empty lookup
- Evidence: D6's reason-preserving `presence()` checks only the main database. Both snapshot paths still test `-wal`/`-shm` through boolean `deps.exists`; the default `exists` maps every non-present result, including EACCES/EIO, to false, and a sidecar copy failure is also swallowed. The reader then queries only the base copy and can return `status: "ok", rows: []`. A targeted scratch probe created a WAL-mode database with one committed row resident only in the WAL; copying/querying the base file alone returned zero rows while the live WAL held 8,272 bytes. No probe file was retained.
- Invariant: `absent` requires a complete read of the authoritative store. Boundary inventory searched: main DB presence, base copy, WAL/SHM presence, sidecar copy, snapshot query, zero-row interpretation, row mapping, nullable wrappers, list retry caches. Affected: WAL presence/copy failure followed by an `ok` base-only query in Codex, OpenCode, and Cursor IDE. Verified safe: main DB absence is conclusive; main DB unreachability is `db-unreachable`; outer copy/query failures are non-`ok`; returned-but-unmappable rows are unknown; lists retry non-`ok` states.
- Impact: a live session committed only in SQLite's WAL can be reported absent and WT-011.5 can delete its preview, the exact false-absence failure D2 forbids. Lists/details may also expose a stale base snapshot as successful data.
- SuggestedFix: Make WAL presence/copy reason-preserving in both `readSqliteViaCopy` and `withSqliteSnapshot`. Skip the WAL only when absence is proven; an unreachable or failed-to-copy WAL must make the snapshot non-`ok` (or trigger a bounded whole-snapshot retry). Do not query a base-only copy as conclusive after a WAL failure.
- Status: accepted
- Triage: Accepted. Verified at the source: `defaultDeps` does supply `access` (`sqlite.ts:138`), so D6's reason-preserving `presence()` is live in production for the main database — but both sidecar loops (`:335`, `:377`) call `deps.exists` directly and so re-collapse EACCES/EIO to "not there", and the surrounding `catch` swallows a failed sidecar copy. The base-only snapshot then returns `ok` with zero rows, which D5 maps to `absent` for Codex, OpenCode and Cursor IDE. This is D6's own rule applied at a boundary D6 enumerated only for the main database, and D2 already governs the answer, so it is remediation and needs no design change. Fix: one presence-aware sidecar helper used by both `readSqliteViaCopy` and `withSqliteSnapshot` — skip only on proven absence, let unreachable and failed copies reach the existing outer catch as `query-error`, which every D5 table already maps to `unknown`. Choosing `query-error` over `db-unreachable` deliberately: the database WAS reachable, and `query-error` keeps every existing D5 row true verbatim, where `db-unreachable` would route Codex into a rollout fallback on the strength of a snapshot we just declared untrustworthy. Accepted cost: a WAL checkpointed away inside the copy window now yields `unknown` instead of a base-only read. That is the conservative direction D2 asks for, and a base copy taken before that checkpoint is stale anyway.

---

### B2-R3

- ID: B2-R3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` and `asm-review-logic` (corroborated by chair)
- Class: feature
- File: `src/vault/readers/cursorIdeReader.ts:304-315,496-502`
- Title: Cursor IDE filters a present oversized header into absent
- Evidence: The point query includes `length(CAST(value AS BLOB)) <= MAX_JSON_CHARS`. An active top-level composer whose header exceeds 2 MiB, or whose value is NULL, is therefore removed by SQL before `parseHeaderRow` can classify the present-but-unusable row. The successful zero-row result becomes `{ status: "absent" }`. A targeted scratch probe inserted an active `composer-1` row with a 2,097,254-byte value; the exact filter returned zero rows while an unfiltered identity query returned the stored row. No probe file was retained.
- Invariant: a content/compatibility bound may make a present row unreadable, never absent. Boundary inventory searched: id parsing, outer snapshot status, header identity query, archived/subagent domain filters, payload-size filter, row parsing/workspace identity, composer/bubble detail queries, nullable wrapper. Affected: oversized or NULL payload hidden by the header query. Verified safe: nested query failure and returned-but-unmappable row are unknown; a completed identity miss may be absent; archived/subagent rows are outside the active top-level IDE domain; later composer/bubble failures retain a found limited metadata entry.
- Impact: a live active IDE session with a large/private-schema header is treated as deleted, allowing its preview to be retired instead of retained through an unknown cycle.
- SuggestedFix: Establish identity independently of payload readability. Query the active top-level row by identity while also exposing payload length (or a bounded `CASE` projection); return unknown when the matching row is oversized/NULL/unmappable, and absent only when the unfiltered active identity query returns no row.
- Status: accepted
- Triage: Accepted. The `length(CAST(value AS BLOB)) <= MAX_JSON_CHARS` predicate sits in the WHERE clause, so an oversized or NULL header is removed by SQL before `parseHeaderRow` can classify it — the reader never reaches the `failed: true` branch at `:316-318` that D5 already specifies for a present-but-unparseable row. So the fix makes the code match D5 as written rather than changing it: remediation, no design change. Fix: drop the size predicate from WHERE and keep the bound as a projection — a `CASE` that yields the value only when it is small, plus the measured length — so identity is established unfiltered while the oversized blob is still never materialized. A matched row that is oversized or NULL becomes `failed: true` (unknown); `absent` survives only for an unfiltered identity miss. The archived/subagent predicates stay in WHERE: those are domain filters, not readability filters, and the chair verified them safe. The composerData/bubble size filters also stay — a failure there already retains a `found` limited-metadata entry.

## Prior finding disposition

### B1-R1 — fixed

- Severity remains BLOCK. The inner Cursor IDE header query now carries failure and unmappable-row outcomes through the successful outer snapshot as unknown; a completed active identity miss remains absent. The workspace mismatch branch was re-evaluated under the amended D5 contract and the store's unique `composerId` identity: a locator combining that unique composer with another workspace is not a stored session. B2-R3 is a new mechanism — SQL filtering hides the row before mapping — not persistence of B1-R1.

### B2-R1 — fixed

- CLI and project found answers now require the enumeration that proves uniqueness to complete. The shared nullable resolver behavior on incomplete enumeration changed intentionally: preserving the formerly readable candidate for detail/launch would reintroduce the arbitrary-duplicate launch risk B2-R1 identified.

### B3-R1 — fixed

- Codex list gates success on `status === "ok"`; db-unreachable is unreadable/retryable. By-id db-unreachable reaches rollout fallback, returns found from a readable rollout, and remains unknown after a miss because SQLite was never inspected.

### W1-R1 — fixed

- CLI/project eligibility, mapping, cwd resolution, and classification now live in shared resolvers; nullable consumers are thin adapters.

## Inline support review

- No changed test contains `.only` or an unconditional disabled case. Three permission tests use `skipIf(root)` because chmod cannot produce denial as root; this is an environment guard, not abandoned coverage.
- Added async assertions are awaited.
- Coverage correctly exercises the four round-1 fixes and the reader wrappers, but has no case for an inaccessible/present WAL sidecar or an active oversized Cursor IDE header.
- No changed fixture introduces credentials, PII, or transcript bodies outside test-local temporary stores.

## Adjudication notes

- The two surviving blockers were independently found by data-security; B2-R3 was also found by the general logic specialist, and both were reproduced by chair scratch probes.
- The logic specialist's symlink/rejected-bucket findings were dropped. The accepted store contracts enumerate regular Claude project directories, Codex rollout directories/files, and validated Cursor bucket directories; they do not require following symlinked container entries or unsafe bucket names. The resolved-containment contract requires checking an enumerated transcript before reading it, not expanding unsupported container types into the store domain.
- The Cursor impact WARN was dropped. On an incomplete CLI/project enumeration, a readable candidate is not proven unique; allowing legacy detail/launch/watch consumers to use it would restore the arbitrary-duplicate launch defect accepted as B2-R1. The changed behavior is the intended safety consequence of the amended D5 uniqueness rule.
- The contracts WARN claiming an exhaustive rollout miss should make db-unreachable absent was rejected. The caller's deliberate decision and D2 control: rollout cannot prove absence from an SQLite index that was unreachable and uninspected, so unknown is correct.
- The reuse WARN was dropped as out of scope and unchanged-code cleanup. Task 1_3 accepts a vault-shared errno owner; migrating two established worktree implementations is not required for this behavior and round 1 already adjudicated the same suggestion.
- The contracts comment-only suggestion was dropped as non-behavioral. The performance specialist found no changed growth or duplicate-work issue.

## Accepted risk

None.

## Audit backlog

None.
