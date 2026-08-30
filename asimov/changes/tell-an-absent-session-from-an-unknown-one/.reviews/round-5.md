# Asimov Review Round 5

- Date: 2026-08-30
- Cycle: 2
- Round: 5
- Mode: verification
- Requested mode: fastlane
- Scope: commit range `eb18a6fc..66e64b6e4fbc7df1e8148a104fbd01c171877c54`
- Head: `66e64b6e4fbc7df1e8148a104fbd01c171877c54`
- Parent / prior reviewed Head: `eb18a6fcb552a7bc9c9cb68cfc0d7bc918a34dc9`
- Tree: dirty outside the explicit range; current uncommitted analytics and `skills-lock.json` changes were excluded
- Scope lock: passed — only B1-R3 remediation, additive tests, prior-round/verification metadata, and no changed `D#` or new capability
- Reviewable lines: 96 (18 production TypeScript + 78 Asimov analytics/build metadata); 82 changed test lines reviewed inline
- Agents spawned:
  - `asm-review-data-security` — sidecars-first snapshot/data-integrity verification — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — copy-order race and regression-fixture verification — `gpt-5.6-terra[1M]` (resumed after a sleep interruption)
  - `asm-librarian` — official SQLite WAL/salt/wal-index/backup semantics — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-contracts` — no contract/status/design change
  - `asm-review-frontend` — no frontend cone
  - `asm-review-performance` — no changed growth axis
  - `asm-review-reuse` — only copy ordering changed
- Verification evidence: `.build/verified.ndjson` records task 3_2 at exit 0. The caller brief reports type check clean, 5,392 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. The two tests were mutation-checked against base-first ordering. Review did not rerun project verification.
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST
- Cycle cap: reached — cycle 2 has used discovery round 3 plus verification rounds 4 and 5. No further patch verification belongs in this cycle.

## Verification scope

- Verify B1-R3 across the same invariant inventory: main/WAL generation pairing, checkpoint/reset/unlink, concurrent writes and page reorganization, stale WAL replay, stale/mismatched SHM, both snapshot entry points, and conclusive zero-row consumers.
- Verify the regression fixture models the claimed sidecars-first/base-last interleaving rather than only distinguishing source order.
- B2-R3 remains fixed and outside the changed cone.

## Finding

### B1-R3 — persists from rounds 3 and 4

- ID: B1-R3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair; official SQLite evidence from `asm-librarian`)
- Class: feature
- File: `src/vault/sqlite.ts:353-361,392-400`
- Title: Sidecars-first still assembles unsupported WAL/base generations and can lose a pre-existing row
- Evidence: The fix assumes a WAL copied before a newer base is salt-mismatched and ignored. SQLite's salts do not validate a WAL against the main DB: WAL frame salts validate against the WAL header, and the SHM/wal-index copies those WAL salts. The main database carries no corresponding WAL salt. Chair probes confirmed the actual behavior. First, an older copied WAL beside a newer checkpointed base was replayed — the snapshot returned the old `wal-state` value instead of the newer base value, directly refuting the “ignored” claim. Second, after copying sidecars, the live DB checkpointed, deleted later rows, ran `VACUUM`, checkpointed again, and supplied the newer base. Opening the assembled snapshot returned `integrity_check=ok` but lost row `id=10`, which existed before sidecar copying and still existed in the live DB; the snapshot held 999 of the live 1,000 rows. Repeating without copying SHM produced the same loss, proving stale WAL replay — not a misleading SHM index — is sufficient. No probe file was retained.
- Invariant: a snapshot used to prove absence must correspond to one coherent SQLite generation and contain every row committed before its snapshot point. Boundary inventory searched: WAL absent/present/unreachable; WAL copy failure; checkpoint before/after either copy; WAL reset generation; stale WAL + newer base; stale/mismatched/missing SHM; ordinary replay; page reorganization/VACUUM; both read entry points; query-error consumers. Affected: any interleaving that pairs a self-valid older WAL with a structurally newer base whose pages were reorganized. Verified safe: sidecar access/copy failures remain query-error; missing/mismatched SHM is rebuildable and not authoritative; the narrow round-4 checkpoint row survives the new ordering; downstream non-`ok` mappings remain conservative.
- Impact: the copied database can be internally valid and return `ok` while omitting a live pre-existing session. Codex, OpenCode, or Cursor IDE may therefore still report absent and let WT-011.5 retire its preview. Because the result is valid SQLite rather than a query failure, downstream status handling cannot repair it.
- SuggestedFix: Stop assembling a live SQLite snapshot from independently copied generations. Hand the snapshot mechanism back to planning and choose an engine-supported coherent operation — for example the SQLite Online Backup API / `VACUUM INTO`, or a lock/quiescence protocol that owns the complete DB+WAL copy interval. The design must state its snapshot point, writer/checkpoint interaction, timeout/failure status, and both node:sqlite/CLI behavior before another implementation attempt.
- Status: persists
- Triage: accepted in round 3 and again in round 4; second verification patch failed the same invariant through mixed-generation replay

## Test-fidelity adjudication

- The tests are additive and mutation-discriminate base-first from sidecars-first, but they do not exercise the fix's central claim. In the injected `copy`, the base is copied with `fsp.copyFile` first; only after that copy completes does the callback checkpoint and unlink the live sidecars. Under sidecars-first, the snapshot therefore contains the old base plus its matching old WAL before the checkpoint occurs — not an older WAL paired with the newer post-checkpoint base.
- The tests prove that sidecars-first retains the round-4 row in that narrower order. They do not test whether SQLite ignores/replays a stale WAL against a newer base or whether page reorganization can remove a pre-existing row.

## SQLite semantics adjudication

- The author's salt premise is false. Official SQLite format documentation states WAL-frame salts match the WAL header; SHM stores copies of those salts. The main database has no matching WAL-generation salt.
- A stale/mismatched SHM is not the blocker: SQLite can rebuild the wal-index from the WAL, and the chair reproduced the data loss with no copied SHM.
- Official SQLite guidance does not recognize either raw copy ordering as safe under concurrent transactions/checkpoints. It recommends copying while quiescent/locked or using the Online Backup API, `VACUUM INTO`, or another engine-supported snapshot mechanism.
- The logic specialist reported no finding after analyzing ordinary append/checkpoint orders, but did not cover page reorganization. Its no-finding conclusion is refuted by the concrete valid-database probe that loses a pre-snapshot row.

## Prior finding disposition

- B2-R3 remains fixed.
- B1-R3 remains the one open gating invariant. Its inventory expanded across two verification patches from inaccessible sidecars, to checkpoint disappearance, to mixed-generation WAL replay. Patch-level remediation has failed.

## Route after cycle cap

Cycle 2 is exhausted. Do not attempt another patch-level fix in this cycle. Return the SQLite snapshot mechanism to `asimov-plan` for an approved design owning coherent live-database snapshot semantics. After that design and implementation complete, the next user-initiated review begins cycle 3 in discovery mode and reviews the new snapshot owner plus its integration seam.

## Inline support review

- No `.only`, disabled test, weakened assertion, or non-additive fixture change was introduced.
- The regression tests use a real WAL-mode DB and correctly keep the target row WAL-resident, but their checkpoint fires after the base copy, leaving the claimed old-WAL/new-base case untested.

## Accepted risk

None.

## Audit backlog

None.

## Author triage

- Status: accepted
- Triage: Accepted, and my rebuttal-shaped argument in the round-5 request was simply wrong. I claimed the WAL salt check makes an older WAL beside a newer base all-or-nothing; it does not. The salts live in the WAL header and are mirrored in the SHM, and the main database carries no WAL-generation counter to disagree with, so a self-consistent older WAL is replayed rather than rejected. The probe that reproduces it — checkpoint plus VACUUM between the sidecar copy and the base copy, yielding a snapshot that passes integrity_check while missing a pre-existing row — is decisive, and my own earlier probe never reached that state because it checkpointed only AFTER the base copy, where the base already held everything.

  Both of my patches shared one false premise: that two independently-timed file copies can be made to compose into a point-in-time snapshot by choosing their order. Order changes which interleavings lose data; it cannot remove the window. That is a mechanism defect, not a classification defect, and it predates this change — `readSqliteViaCopy` has snapshotted this way since the agent-session-index work, and every SQLite reader depends on it.

  So this is not remediation. Fixing it means replacing the snapshot mechanism (engine-supported: the Online Backup API, `VACUUM INTO`, or a generation-stability protocol that fails to `query-error`), which changes an accepted decision owned by an earlier change and mints a new invariant owner — snapshot atomicity — shared by every reader. Per the thrash-stop route it becomes its OWN change, approved and reviewed independently, with WT-011.8 depending on it. Handing back to `asimov-plan`; no third patch attempted in this file.
