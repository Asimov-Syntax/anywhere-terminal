# Workflow State: snapshot-a-live-store-atomically

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no fork: the mechanism was settled by probe before planning)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Planned at: 200dee01
Flags: security-privacy (a false-empty read of another process's live store), re-review (parent handback)
Origin: handback from tell-an-absent-session-from-an-unknown-one cycle 2 round 5, finding B1-R3. That change depends on this one and its next review starts cycle 3 in discovery mode.
Blueprint note: no PLAN task of its own — it is the invariant owner split out of WT-011.8 under the remediation boundary, so WT-011.8's row stays the blueprint record.
Validate warnings triaged: both are "requirement is long". WAL-safe read-only SQLite access (502) is one atomicity contract stated as a SHALL plus the three SHALL-NOTs that define it; splitting it would scatter one contract. SQLite engine selection (707) is inherited verbatim in substance from the shipped requirement — rewriting it further would edit contracts this change does not touch.
Mechanism evidence gathered before planning, not at build: node:sqlite backup() on Node v24.7.0 snapshots a live WAL store whole (1001/1001 rows incl. the WAL-resident one, integrity_check ok, unaffected by a following checkpoint+VACUUM); read-only source open works even with an unwritable store directory; the D13 "silent empty" case throws ERR_SQLITE_ERROR instead; sqlite3 CLI VACUUM INTO under -readonly exits 0 and is queryable.
Deviation: 1_3's commit was made before its verify-task tick, and that verify then failed on an unrelated flaky test (a 5s timeout in extension.worktreeAssembly.test.ts). Re-run clean twice; the task was re-leased and ticked with real evidence afterwards. The commit ordering was wrong, not the evidence.
Watch: the new tests do real sqlite and real sqlite3-CLI I/O inside the parallel suite, which is the most likely cause of that timeout flake. If it recurs, serialise them rather than raising the timeout.
Dead code removed with the mechanism: the `copy` dep, `cloneOrCopy`, and `readSqliteViaCopy`'s name — nothing in this module copies a store any more.
ARCHIVE BLOCKED: round-1 W2 (a ~190x read regression on large stores: 522 MB measured at 951 ms via backup vs 5 ms via APFS clone) is acknowledged, not risk-accepted. It is owned by `reuse-a-snapshot-while-the-store-is-unchanged`; this change must not archive until that lands and cycle 2 discovery reviews the seam.
Cycle 1 closed at its 3-round cap with B1 fixed in 2_3 but unreviewed. Next review is cycle 2, round 1, discovery.
ARCHIVE UNBLOCKED (2026-08-30): `reuse-a-snapshot-while-the-store-is-unchanged` archived as `archive/260830-0956-...`. Round-1 W2's regression is answered rather than accepted: the pool now sits behind both entry points of THIS change, and the cost it measured is paid once per store generation instead of once per read. Measured on the live 1.5 GB `opencode.db`: 2.4-3.0 s unretained, 1 ms reused, and a write correctly forces a fresh snapshot. W2 asked for the cost to stop being per-read; it is.

