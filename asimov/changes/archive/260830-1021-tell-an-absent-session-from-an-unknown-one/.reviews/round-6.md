# Asimov Review Round 6

- Date: 2026-08-30
- Cycle: 3
- Round: 6 (cycle round 1)
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `16cd57564a71a782acb8a8c5c397a7da138280b9..200dee01278a768d2e9c4d30ca8dcd1d5617560b`
- Head: `200dee01278a768d2e9c4d30ca8dcd1d5617560b`
- Integration tree inspected at: `48ddb2778f13b6463ed46e45b9ff86db2a173658`; the separately archived `snapshot-a-live-store-atomically` and `reuse-a-snapshot-while-the-store-is-unchanged` commits were excluded from the review range and inspected only at WT-011.8's current integration seam
- Tree: dirty outside the explicit range; `.claude/settings.json`, `.gitignore`, `asimov/changes/attribute-a-path-to-the-worktree-it-resolves-into/analytics.json`, and `docs/audit/2026-08-30-worktree-lifecycle-gaps.md` were excluded
- Reviewable lines: 2,544 (758 production TypeScript/active-state lines + 1,786 Asimov analytics/build metadata); 688 changed test lines reviewed inline
- Size note: Large change — accuracy may decrease. The count is dominated by Asimov analytics/build metadata and includes the prior cycle's remediation commits.
- Agents spawned:
  - `asm-finder` — lookup callers, hot/cold snapshot flow, and fallback inventory — `gpt-5.6-luna[1M]`
  - `asm-review-data-security` — SQLite status, atomic snapshot, and retained-snapshot integration — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — Claude and Cursor traversal/classification — `sonnet[1M]`
  - `asm-review-logic` — Codex and OpenCode status/fallback ladders — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — adapter/service contract, wiring, and caller compatibility — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — lookup growth axes and snapshot reuse — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — shared presence helper and classified/nullable wrapper cohesion — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-frontend` — no frontend code changed
- Verification evidence: `bun run asm change verify-status tell-an-absent-session-from-an-unknown-one` records all nine implementation/remediation tasks at exit 0. The caller's current-tree gate brief records type check clean, 5,443 unit tests passing, I10 passing, and `biome check src` at 0 errors / 14 warnings. Review did not rerun project verification.
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST
- Split: 0 feature, 0 machinery

## Gate and classification

- Gate 2 is approved. Change design D1-D6, task Acceptance/Boundary fields, project design D36, and WT-011.8 are binding.
- The explicit range is the first change-id commit's parent through the last commit naming the change-id. The two archived snapshot changes and later unrelated commits are not part of the diff.
- Reviewable production surfaces: `src/utils/fsPresence.ts`, `src/vault/types.ts`, `src/vault/VaultAgentAdapter.ts`, `src/vault/VaultService.ts`, the four reader families, and `src/vault/sqlite.ts`.
- Tests were reviewed inline. `docs/**` and ordinary Markdown review/history artifacts were skipped per classification. Asimov JSON/build metadata was inspected as generated state and carried no behavioral finding.
- No material divergence from the accepted intent was found.

## Risk map

1. Public adapter/service contract: nullable `entry` becomes `found | absent | unknown`, while `getEntry` and injected legacy readers must preserve their old behavior.
2. Cross-reader epistemic invariant: only a completed enumeration may report `absent`; access, query, containment, parse, mapping, and partial-walk failures must report `unknown`.
3. SQLite data integrity: a zero-row result is conclusive only when obtained from an engine-coherent fresh snapshot or a retained snapshot whose current store generation was proved equal.
4. Codex dual-source fallback: the SQLite status must choose whether rollout fallback may find an entry and whether a miss is conclusive.
5. Cursor uniqueness: a partial bucket/layout enumeration cannot report either a unique `found` candidate or `absent`.
6. Existing caller compatibility: launch, reveal, cwd/title projection, and presence code continue through `getEntry`, which collapses both non-found states to `null`.

Growth axes: Claude project directories, Codex rollout history, and Cursor bucket history grow per user/session history, but those scans predate this contract change and were not duplicated. Point SQL queries are bounded. Retained snapshots are bounded by the fixed set of one-per-agent primary store paths; per-chat stores do not retain.

## Full-flow trace

1. `VaultService.lookupEntry` parses the composite id. An unknown agent or malformed id is conclusively absent; a missing Cursor child-locator is unknown because the process-local map can evict or restart.
2. The service dispatches exactly once to the agent adapter. A found entry alone receives Cursor id rewriting and `canFork` enrichment. `getEntry` unwraps found and maps both absent and unknown to the same `null` existing callers already consume.
3. Claude resolves the projects root, scans every project candidate, and monotonically downgrades `exhaustive` on non-absence failures. A found-but-unbuildable transcript is unknown; only a missing root or completed miss is absent.
4. Cursor CLI and project locators carry completeness through bucket/layout enumeration. Ambiguity, partial traversal, metadata/stat/cwd failure, or present-but-ineligible data is unknown. Cursor IDE moves the header-size bound into the projection so a present oversized/NULL row is unknown, and carries inner query failure past an outer successful snapshot.
5. Codex queries SQLite first. `ok` plus zero rows is absent; a returned-but-unmappable row or query error is unknown. `no-db`, `no-sqlite3`, and `db-unreachable` retain rollout lookup for positive resolution; a no-match after `db-unreachable` remains unknown, while a conclusive unavailable-index state plus exhaustive rollout miss may be absent. OpenCode has no fallback: confirmed `no-db` is absent; every other non-`ok` status is unknown.
6. On the current integration tree, primary SQLite lookup cold paths take an engine-owned atomic snapshot. Hot paths borrow a retained snapshot only after a coherent two-pass `.db`/`-wal` generation equals the retained generation. Unreadable/unusable generation reads cannot hit retained state; a write invalidates the generation and forces a fresh snapshot; snapshot/query failures map to non-`ok`. Therefore an empty `ok` result from either fresh or reused path comes from a completed enumeration rather than a partial file assembly.
7. The result returns to local extension callers. No auth/identity boundary or external side effect is added by this range; the future WT-011.5 consumer is the first caller intended to distinguish absent from unknown.

## Verification-question answers

| Failure mode | Claude | Codex | OpenCode | Cursor |
|---|---|---|---|---|
| Thrown/failed query | N/A | `unknown` | `unknown` | IDE: `unknown` |
| Unreadable store/file/path | `unknown` | positive rollout may still be `found`; otherwise `unknown` when the DB or walk was unreadable | `unknown` | `unknown` |
| Unparseable/present-but-unmappable record | `unknown` | `unknown` | `unknown` | `unknown` |
| Confirmed missing store | `absent` | rollout fallback decides; exhaustive miss is `absent` | `absent` | `absent` for the relevant store shape |
| Completed empty enumeration/query | `absent` | `absent` | `absent` | `absent` |
| Reused SQLite snapshot | N/A | empty is conclusive only after generation-equal reuse | empty is conclusive only after generation-equal reuse | IDE empty is conclusive only after generation-equal reuse |

The four reader families agree on the governing distinction. Their status ladders differ only where the source model differs, principally Codex's independently readable rollout fallback.

## Findings

None.

## Prior finding disposition

- B1-R3 — fixed. The independently archived atomic-snapshot change removed raw base/WAL/SHM assembly, and the current WT-011.8 integration reaches only engine-owned snapshots. The independently archived reuse change gates retained snapshots on a coherent current generation and refuses reuse when the store cannot be proved readable/unchanged. Both fresh and reused zero-row seams were traced safe.
- B2-R3 — remains fixed. Cursor IDE establishes row identity without filtering oversized/NULL header values out of the result set.
- B1-R1, B2-R1, B3-R1, and W1-R1 — remain fixed; the fresh discovery found no recurrence through the current integration cone.

## Inline support review

- No `.only`, unconditional disabled test, weakened assertion, missing async `await`, PII, or secret fixture was introduced.
- The permission tests use conditional root skips because `chmod` cannot model denial as root; the same classification is exercised through injected dependency failures elsewhere.
- Reader tests cover completed misses, access/query failure, present-but-unmappable records, legacy nullable wrappers, Cursor partial uniqueness, and Codex fallback behavior.
- Current snapshot tests cover retained reuse, post-write invalidation, cross-entry-point sharing, and refusing retained success after readability changes.

## Adjudication notes

- Data/security, both logic assignments, performance, and reuse reported no findings.
- The contracts specialist proposed a WARN that an injected/overridden adapter can reject instead of returning `unknown`. It was dropped: the pre-range nullable injection seam also propagated promise rejection, task 1_1 and D3 require that seam's behavior to remain unchanged, and `Promise<VaultEntryLookup>` does not declare a never-reject transport contract. All concrete production lookup failures named by D2-D6 are caught and classified. Catching arbitrary injected rejection here would be new behavior, not repair of the widened result union.
- The file-reader specialist noted direct helper tests could be added, but existing reader-level tests exercise the state machines through their public behavior; no concrete defect or support WARN survived.

## Accepted risk

None.

## Audit backlog

None.

---

## Author triage (cycle 3, round 1)

No findings to triage. Recording two things the report settles that earlier cycles could not, so the
archive carries them:

- The safety rule the whole parent chain exists to protect — **`absent` may be reported only from an
  enumeration that completed** — was re-checked against the paths that did not exist when cycle 2
  was capped: a completed enumeration served from a REUSED snapshot. It holds, because reuse is
  gated on a coherent current generation, so an unreadable or changed store cannot serve a stale
  empty result as conclusive.
- Cycle 2's B1-R3 is closed by `snapshot-a-live-store-atomically`, archived earlier today. That
  handback is what this change waited on, and the seam it created is now reviewed rather than
  assumed.

The contracts specialist's rejected-injected-promise warning was dropped by the chair as pre-existing
legacy-seam behaviour the accepted scope preserves deliberately. Agreed, and noted here rather than
silently: it is the kind of finding that returns next cycle unless the reason it was dropped is on
the record.

