# Asimov Review Round 4

- Date: 2026-08-30
- Cycle: 2
- Round: 4
- Mode: verification
- Requested mode: fastlane
- Scope: commit range `c1517e77..eb18a6fcb552a7bc9c9cb68cfc0d7bc918a34dc9`
- Head: `eb18a6fcb552a7bc9c9cb68cfc0d7bc918a34dc9`
- Parent / prior reviewed Head: `c1517e774105efe74fb1f3c3142a3072d387757e`
- Tree: dirty outside the explicit range; current uncommitted analytics and `skills-lock.json` changes were excluded
- Scope lock: passed — the range contains only B1-R3/B2-R3 remediation, additive tests, review/task metadata, and WT-011.8 status metadata; no new capability, invariant owner, or changed `D#`
- Reviewable lines: 189 (56 production TypeScript + 133 Asimov analytics/build metadata); 114 changed test lines reviewed inline
- Agents spawned:
  - `asm-finder` — snapshot/status consumer impact inventory — `gpt-5.6-luna[1M]`
  - `asm-review-data-security` — B1/B2 storage invariant verification — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — checkpoint race and CASE-state verification — `gpt-5.6-terra[1M]`
- Agents skipped:
  - `asm-review-contracts` — no contract/design/schema surface changed; the existing D2/D5/D6 result vocabulary is unchanged
  - `asm-review-frontend` — no frontend cone
  - `asm-review-performance` — no changed growth axis or hot-path multiplicity
  - `asm-review-reuse` — one requested shared helper; no competing implementation in the cone
- Verification evidence: `.build/verified.ndjson` records task 3_1 at exit 0. The caller brief reports type check clean, 5,390 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. Seven new tests were observed red before the fixes. Review did not rerun project verification.
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST

## Verification scope and impact cone

1. B1-R3 invariant: a snapshot may return `ok` only when the copied database includes every committed row represented by the live main DB/WAL state; every uncertain sidecar state must remain non-conclusive.
2. B2-R3 invariant: an active IDE row excluded by a readability/content bound is present-but-unreadable and must return unknown, while an unfiltered active identity miss may return absent.
3. Impact cone: both SQLite snapshot entry points; Codex list/by-id/detail/parentage/child paths; OpenCode list/by-id/detail/snapshot paths; Cursor store detail/identity proof; Cursor IDE list/by-id/detail; cache/retry behavior for non-`ok` results.

## Finding

### B1-R3 — persists from round 3

- ID: B1-R3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` and `asm-review-logic` (corroborated by chair)
- Class: feature
- File: `src/vault/sqlite.ts:293-304,349-358,381-387`
- Title: A WAL checkpoint before the presence check still makes the stale base copy look complete
- Evidence: Both snapshot paths copy the main database first and only then call `copySidecars`. If the live WAL holds a committed session when the base is copied, then checkpoints into the live main DB and disappears before `presence(-wal)`, line 297 sees proven absence and skips the WAL. The comment at line 298 assumes the already-created base copy is whole, but it predates the checkpoint and is stale. The query then returns `ok` against that base-only copy. A targeted scratch probe reproduced the exact order: create a committed WAL-only row, copy the main DB, checkpoint/truncate the live WAL, then query the copy. At sidecar observation the WAL was absent, the live DB contained one row, and the snapshot contained zero. No probe file was retained.
- Invariant: absence requires a complete authoritative read. Boundary inventory verified: main presence; main copy; WAL absent before the operation; WAL present/unreachable; copy failure; WAL disappearance before/after its presence result; checkpoint between main copy and sidecar observation; both `readSqliteViaCopy` and `withSqliteSnapshot`; every query-error consumer and retry/cache branch. Affected: checkpoint completes after main copy but before WAL presence. Verified safe: unreachable sidecars and failed copies now become query-error; a sidecar observed present and disappearing before copy becomes query-error; a database with no WAL throughout the copy is safe; every downstream query-error consumer degrades conservatively without Codex rollout fallback.
- Impact: a live row can still produce `status: "ok", rows: []`, allowing Codex, OpenCode, or Cursor IDE to return absent and WT-011.5 to retire its preview. B1-R3 is therefore not fixed at the invariant level.
- SuggestedFix: Do not apply a post-copy absence observation to a pre-observation base copy. Use a bounded stable-snapshot protocol: when WAL absence is observed, take/re-take the base copy after that observation and verify the WAL/main state stayed stable around the copy; if it changed, retry or return query-error. An SQLite backup/snapshot primitive is also acceptable. Add the checkpoint-after-base-copy regression, not only sidecars absent from the start.
- Status: persists
- Triage: accepted in round 3; round-4 verification failed at the checkpoint/disappearance boundary

## Fixed finding

### B2-R3 — fixed

- The header query now filters only the accepted active top-level domain (`composerId`, non-archived, non-subagent). Payload size moved into a `CASE` projection, so small values are parsed normally while oversized, NULL, BLOB, or malformed values retain the row and fail mapping to unknown. A true active identity miss remains absent; workspace mismatch retains the amended D5 behavior. The real-SQL tests cover oversized, NULL, missing, and valid values.

## Status and consumer adjudication

- `query-error` is the correct status for a reachable main DB whose snapshot assembly failed. `db-unreachable` would incorrectly send Codex into rollout fallback; query-error keeps the untrusted snapshot from being replaced by a different source and every D5 row remains unchanged.
- The finder inventory confirmed all affected consumers already handle query-error conservatively: Codex list retries with unreadable state and by-id returns unknown; Codex detail/parentage paths degrade without a conclusive miss; OpenCode list retries as unreadable and by-id returns unknown; OpenCode details fail/limit safely; Cursor store detail becomes limited and identity proof fails closed; Cursor IDE list is unreadable, by-id unknown, and detail null.
- No consumer or cache stores the failed snapshot as a successful empty result.
- The intended false-unknown trade is acceptable when a sidecar is observed present/unreachable or disappears during its copy. The implementation does not yet make that trade when checkpoint disappearance occurs before the sidecar presence call; that case remains a false absent and is the persistent blocker.

## Inline support review

- Test edits are additive apart from import reflow; no existing assertion was removed or weakened, and no `.only`/disabled case was added.
- The sidecar tests cover unreachable, copy failure, proven absence from the outset, shared snapshot use, and query suppression after failure. They do not cover a WAL that checkpoints away after the base copy but before sidecar presence.
- Cursor IDE tests exercise the production SQL against a real temporary SQLite store for oversized, NULL, missing, and valid headers.

## Adjudication notes

- Both specialists independently found the checkpoint-before-presence race and agreed B1-R3 persists. Chair reproduced it with a real WAL-mode SQLite scratch probe.
- The logic specialist's suggestion for direct downstream query-error tests was not promoted: no downstream branch changed, the full consumer inventory shows the existing mappings, and the persistent source-level race already gates the round.
- No valid finding exists outside the verification impact cone; audit backlog remains empty.

## Accepted risk

None.

## Audit backlog

None.

## Author triage

- Status: accepted
- Triage: Accepted in full; the probe is right and the round-3 fix was incomplete. I had the sidecar copy AFTER the base copy, which leaves exactly the window described: the base is taken, a checkpoint then moves WAL rows into the live store and removes the WAL, and the later presence check correctly sees a proven absence and skips it — so a base copied before those rows landed is queried as conclusive. Fixed by inverting the order rather than by adding a stability protocol: sidecars first, base last. Whatever a checkpoint moves out of the WAL is in the base by the time the base is copied, and a now-stale WAL copy is salt-mismatched so SQLite ignores it in favour of that newer base; both interleavings leave the row present, and no retry, extra syscall, or new decision is needed. Regression added for both entry points and mutation-checked — reverting to base-first fails exactly those two tests. Recorded honestly: my first two attempts at that regression passed under BOTH orderings (the checkpoint fired before the base copy, and the seeded row was already in the base file), so they proved nothing; the committed version was rebuilt until it discriminated.
