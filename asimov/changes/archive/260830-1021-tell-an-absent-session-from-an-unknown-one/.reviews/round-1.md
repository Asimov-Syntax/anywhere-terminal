# Asimov Review Round 1

- Date: 2026-08-30
- Cycle: 1
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `16cd5756..a9fb304a7a0c8367f2292e1fa0fb4073da445bff`
- Head: `a9fb304a7a0c8367f2292e1fa0fb4073da445bff`
- Tree: dirty outside the explicit range; uncommitted analytics, `docs/PLAN.md`, and `skills-lock.json` changes were excluded
- Reviewable lines: 2,054 (597 production TypeScript + 1,457 Asimov analytics/build metadata); 369 changed test lines reviewed inline
- Size note: Large change — accuracy may decrease. Count is dominated by Asimov analytics/build metadata.
- Agents spawned:
  - `asm-finder` — getEntry/read-wrapper/SqliteStatus caller inventory — `gpt-5.6-luna[1M]`
  - `asm-review-data-security` — storage, SQLite status, and filesystem classification — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — adapter contract, wiring, wrappers, and callers — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — Claude/Codex exhaustiveness and fallback behavior — `sonnet[1M]`
  - `asm-review-logic` — Cursor CLI/project/IDE/child classification — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — presence helper and resolver cohesion — `gpt-5.6-luna[1M]`
  - `asm-review-performance` — per-user scan growth axes and duplicate work — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-frontend` — no frontend code changed
- Verification evidence: `bun run asm change verify-status tell-an-absent-session-from-an-unknown-one` records all six tasks at exit 0. The accepted build record/caller brief reports type check clean, 5,372 unit tests passing, I10 gate passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.
- Verdict: REJECT
- Counts: 3 BLOCK, 1 WARN, 0 SUGGEST
- Split: 3 feature, 0 machinery

## Gate and classification

- Gate 2 is approved. Design D1-D6, task Acceptance/Boundary fields, docs/DESIGN.md D36, and WT-011.8 are binding.
- Reviewable production scope: the new lookup result contract, adapter/service wiring, SQLite presence vocabulary, and Claude/Codex/OpenCode/Cursor reader classification paths.
- Tests were reviewed inline. Change Markdown/spec artifacts and `docs/**` were skipped by file classification but read as accepted intent and project architecture context.
- The committed analytics/build metadata is consistently shaped and did not introduce executable behavior.

## Full-flow trace

1. Six existing external call sites in `extension.ts`, `TerminalViewProvider.ts`, and `VaultLauncher.ts` still call `VaultService.getEntry`; `getLaunchTarget` also uses it for non-Cursor resume. They consume only entry-or-null.
2. `getEntry` now unwraps `lookupEntry`. `lookupEntry` parses the id, resolves Cursor child locators, dispatches the widened adapter, rewrites found child ids, and applies the existing `canFork` enrichment. Unknown agents/malformed ids remain null after unwrapping; missing Cursor child locators correctly become `unknown` without reader dispatch.
3. Claude performs the project-root listing, resolved containment check, candidate stat, and entry build. Every failed/partial boundary becomes `unknown`; only an exhaustive miss becomes `absent`. The conservative treatment of every false containment predicate is acceptable because the predicate does not expose whether false means outside-root or filesystem refusal.
4. Codex queries SQLite first and falls back to rollout JSONL for selected statuses. The new `db-unreachable` branch is not migrated consistently: the list falls through as successful empty data, while by-id skips a rollout fallback that pre-range behavior could use.
5. OpenCode handles `db-unreachable` as unreadable/unknown and keeps confirmed `no-db` conclusive. Its nullable wrapper is an exact unwrap.
6. Cursor CLI enumerates chat buckets, project lookup probes two layouts, IDE lookup opens a snapshot and runs a header query, and child ids resolve through the bounded process-local map. Three incomplete-read branches are misclassified: CLI/project can return `found` without proving uniqueness, and IDE can return `absent` after a failed or unmappable header query.
7. All exported nullable `read*Entry` functions call the corresponding `lookup*Entry` exactly once and only unwrap `found`. No wrapper performs a duplicate lookup, and no changed scan worsens the existing per-user project/session/chat growth axes.

## Findings

### B1-R1

- ID: B1-R1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair)
- Class: feature
- File: `src/vault/readers/cursorIdeReader.ts:305-310,477-483`
- Title: Cursor IDE header failures are reported as proven absence
- Evidence: `composerFromSnapshot` returns `undefined` both when the header query itself is non-`ok` and when the returned header cannot be parsed or does not match the requested workspace. The lookup callback collapses that to `null`; because the outer snapshot completed, `lookupCursorIdeEntry` then maps every such null to `{ status: "absent" }`. An outer successful snapshot proves neither that the inner query ran successfully nor that a malformed row means no session exists.
- Invariant: `absent` requires a completed relevant enumeration with no match. Boundary inventory searched: id validation, outer database presence/snapshot creation, inner header query, zero-row result, row mapping/workspace identity, composer-data query, bubble query, nullable wrapper. Affected: inner query failure and unmappable/mismatched header. Verified safe: invalid ids are impossible store keys; confirmed `no-db` is absent; outer `db-unreachable`/`no-sqlite3`/`query-error` are unknown; failures after a valid header can still return the metadata entry.
- Impact: WT-011.5 can retire a live Cursor IDE preview during a SQLite query failure or schema/mapping drift — the exact false-absence failure D2 forbids.
- SuggestedFix: Make the snapshot callback return a classified header lookup: successful zero rows → absent; failed header query or returned-but-unmappable/mismatched row → unknown; valid header → found. Add lookup tests for inner query error and malformed/mismatched header, not only outer snapshot statuses.
- Status: open
- Triage: pending

---

### B2-R1

- ID: B2-R1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (Cursor; corroborated by chair)
- Class: feature
- File: `src/vault/readers/cursorPaths.ts:320-328`; `src/vault/readers/cursorTranscript.ts:331-351`
- Title: Incomplete Cursor enumerations can still claim a unique found session
- Evidence: The CLI lookup returns the first accessible candidate before checking `complete`; an unreadable bucket may contain the same chat id, so a genuinely ambiguous id is reported `found`. The project lookup similarly returns the one successful layout before consulting `complete`; if the other layout's stat failed, the required exactly-one-layout condition is unproven. The added tests cover an incomplete no-match and a known ambiguity, but not one accessible match plus an inaccessible competing location.
- Invariant: A locator whose contract rejects duplicate locations may return `found` only after the uniqueness-defining enumeration completed. Boundary inventory searched: CLI root listing, per-bucket listing, known duplicate aggregation, CLI no-match, project nested/flat stat probes, project duplicate layouts, IDE lookup, host child map. Affected: CLI found branch and project found branch. Verified safe: no-match absence is gated by completeness; known duplicates are unknown; missing child locators are unknown.
- Impact: launch/resume may select an arbitrary duplicate Cursor chat or project transcript while part of the location space is unreadable, contradicting the promised conclusive answer.
- SuggestedFix: Require completeness before returning the unique candidate; otherwise return `unknown`. Add one-found-plus-one-inaccessible tests for both CLI buckets and project layouts. This exposes a conflict with D3's literal “unchanged for every input” promise because the legacy resolver selected the accessible candidate in this partial state; triage must either narrow that overbroad compatibility claim for an already-ambiguous state or explicitly redesign the compatibility boundary rather than silently returning a non-conclusive `found`.
- Status: open
- Triage: pending

---

### B3-R1

- ID: B3-R1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (Claude/Codex), `asm-review-data-security`, and `asm-review-reuse` (corroborated by chair)
- Class: feature
- File: `src/vault/readers/codexReader.ts:530-561,579-602`
- Title: The new `db-unreachable` status breaks both Codex consumers
- Evidence: `readCodexThreadRowsForParentage` now propagates all `SqliteStatus` members. `readCodexSessions` handles `no-db`/`no-sqlite3` and `query-error`, then assumes the only remaining status is `ok`; `db-unreachable` therefore reaches the successful-empty path with empty rows and may be cached with `unreadable: 0`. Separately, pre-range `readSqlite` collapsed access failures to `no-db`, so `readCodexEntry` attempted the rollout filename fallback. The new lookup excludes `db-unreachable` from that fallback and immediately returns unknown, so a readable rollout beside an unreachable/looping database changes from found to null for all existing `getEntry` callers.
- Invariant: A split status must be migrated at every consumer without turning failure into successful emptiness or discarding an existing independently readable found source. Boundary inventory searched: Codex list/aggregate, by-id lookup, rollout hot/cold fallback, cache sources, OpenCode list/lookup, Cursor IDE list/lookup, generic detail/snapshot failure paths, nullable wrappers and six `getEntry` callers. Affected: Codex list and Codex by-id. Verified safe: OpenCode list marks `db-unreachable` unreadable; OpenCode/Cursor IDE by-id classify it unknown; generic detail/snapshot consumers reject non-`ok`; wrappers unwrap once.
- Impact: an inaccessible Codex database can hide the whole session list as an empty successful store, and can also prevent launch/resume/cwd/title/preview resolution for a session whose rollout file remains readable. The latter violates D3's unchanged-caller behavior.
- SuggestedFix: Gate the list success path explicitly on `status === "ok"` and route `db-unreachable` to unreadable/retry behavior. For by-id, retain the pre-range rollout attempt for `db-unreachable`: a readable rollout may return found; if it is not found or the scan is partial, return unknown because the database remained uninspected. Add list and rollout-present regression tests for `db-unreachable`.
- Status: open
- Triage: pending

---

### W1-R1

- ID: W1-R1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-reuse`
- Class: feature
- File: `src/vault/readers/cursorReader.ts:431-472,649-690`
- Title: Classified Cursor lookup duplicates both existing resolver implementations
- Evidence: The new project branch repeats candidate resolution, file stat, cwd resolution, and entry mapping from `resolveCursorProjectSession`; the CLI branch repeats candidate resolution, metadata stat/read/compatibility, store-db eligibility, and mapping from `resolveCursorCliSession`. Task 1_6 called for threading status out of those resolvers, but the implementation leaves two independently editable copies.
- Impact: detail/launch-target resolution and the new by-id lookup can drift on eligibility, mapping, or error handling; the B2 remediation is especially likely to leave the two paths with intentionally unexplained differences.
- SuggestedFix: Extract one classified CLI resolver and one classified project resolver, then make nullable/legacy consumers thin adapters over those shared results. Keep any deliberate compatibility exception explicit at that adapter boundary.
- Status: open
- Triage: pending

## Inline support review

- No changed test contains `.only`. Permission tests use `skipIf(root)` because chmod cannot provoke denial as root; this is environment-guarded rather than a disabled assertion.
- Added async assertions are awaited.
- Coverage misses the three blocking combinations: Cursor IDE inner-query/mapping failure, Cursor accessible candidate plus inaccessible duplicate location, and Codex `db-unreachable` with list/by-id fallback behavior.
- No changed fixture introduces credentials or user transcript bodies.

## Deliberate-decision adjudication

- Claude's “every false containment result makes the scan non-exhaustive” choice is acceptable. The shipped predicate conflates outside-root resolution with access/refusal errors; treating both as unknown can only delay an absence, never invent one, and path security remains fail-closed.
- The Claude per-candidate stat catch should remain. It is reachable after a successful containment realpath if the path changes or stat fails transiently; ENOENT preserves exhaustiveness while EIO/ENOMEM makes the scan unknown. Lack of a deterministic chmod test does not make the protection dead.
- `cursorChildLocators` misses correctly return unknown: the map is process-local and capacity-evicted.
- OpenCode's `no-db`/`db-unreachable` list split is correct. Cursor IDE's list path also treats every non-`no-db` outer failure as unreadable. Codex is the missed consumer.
- All nullable `read*Entry` wrappers are exact one-call unwrappers; the defects are inside classification/fallback logic, not wrapper divergence.

## Adjudication notes

- The contracts specialist reported no findings and asserted `getEntry` remained behavior-identical. That conclusion is refuted for Codex `db-unreachable` by the base/current branch trace: before the split the status was `no-db` and entered rollout fallback; after the split it short-circuits to unknown.
- The data-security specialist found the Cursor IDE false-absence and Codex list defects. Its statement that Codex by-id preserved fallback semantics is refuted by the same base/current evidence and the logic specialist's independent trace.
- The two Cursor specialist findings were merged into B2 because both violate the same uniqueness invariant through the same causal mechanism: returning a candidate before consulting completeness.
- The Codex list and by-id findings were merged into B3 as two boundaries broken by the same `db-unreachable` migration.
- The reuse suggestion to replace unchanged worktree-local ENOENT/ENOTDIR helpers was dropped: task 1_3 accepts a vault-shared helper, and no concrete changed behavior requires broadening this change into worktree code.
- The performance specialist found no changed scale regression or duplicate lookup. Existing Claude/Codex/Cursor history scans retain their pre-range growth axes and asymptotic work.

## Accepted risk

None.

## Audit backlog

None.

---

# Author triage — round 1

All four findings verified against the code before triage. All accepted; none rebutted.

## B1 — Cursor IDE header failures reported as proven absence — ACCEPTED

Verified at `cursorIdeReader.ts:305-310`: `composerFromSnapshot` returns the same `undefined` for a
header query that FAILED (`headerResult.status !== "ok"`) and for one that ran and matched nothing
(`rows.length !== 1`), and again for an unparseable or workspace-mismatched header. The outer
snapshot is still `ok`, so `lookupCursorIdeEntry:477-483` calls all of it `absent`. That is the exact
defect this change exists to remove, reproduced one layer down. My own D5 row — "the query ran, so a
composer that is not in the store is genuinely not there" — is untrue of a nested query that did not
run.

## B2 — an incomplete enumeration can still claim a unique match — ACCEPTED

Verified at `cursorPaths.ts:320-328` and `cursorTranscript.ts:331-351`. I checked `complete` only on
the miss path. But uniqueness is the thing the CLI lookup asserts by returning a candidate at all —
`listCursorChatCandidates` drops ids that appear in more than one bucket — so an unlisted bucket
could hold the duplicate that would have made this id ambiguous. Same shape in the project lookup:
returning `existing[0]` when the other layout's `stat` failed asserts "exactly one layout exists"
from a scan that saw one. Completeness gates the `found` answer too, not just `absent`.

## B3 — `db-unreachable` breaks both Codex consumers — ACCEPTED, and it is a live regression

The one finding that is not a missed classification but behaviour I broke.

- `codexReader.ts:530-545`: the list path branches on `no-db`/`no-sqlite3` and `query-error`, then
  falls through to a comment that reads `// status === "ok"`. `db-unreachable` now lands there and
  becomes a successful empty listing with `unreadable: 0`.
- `codexReader.ts:579-602`: before task 1_2, an EACCES on the database became `no-db` and entered the
  rollout-file fallback. It now returns `unknown` before the fallback runs, so a session whose
  rollout file is perfectly readable stops resolving for every existing `getEntry` caller — launch,
  resume, cwd, title.

That directly contradicts D3's promise that no existing caller changes behaviour, and I verified the
promise by reading the six call sites rather than by exercising this path. Blaming D5's table is not
a defence: I wrote the row that dropped the fallback.

## W1 — the classified Cursor lookup duplicates both resolvers — ACCEPTED

Verified: `lookupCursorEntry` re-implements the metadata, eligibility, stat, cwd and mapping steps
that `resolveCursorCliSession` and `resolveCursorProjectSession` already own, rather than threading
classification through them as task 1_6's plan said. Fixed first, because B2's fix lands inside those
resolvers and would otherwise have to be written twice.

## Artifact handback, taken before the fixes

B3's fix changes an accepted decision rather than restoring one: design.md D5's Codex table says
`db-unreachable` answers `unknown`, and the correct behaviour is to attempt the rollout fallback
first and answer `unknown` only if that walk cannot prove absence either. Per the remediation
boundary that is a changed `D#`, not remediation, so D5 is amended and the reasoning recorded before
any code moves. B1 and B2 need no decision change — they are D2 applied where I failed to apply it.
