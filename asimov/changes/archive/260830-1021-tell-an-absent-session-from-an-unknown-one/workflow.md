# Workflow State: tell-an-absent-session-from-an-unknown-one

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Lane: full
Planned at: 6967dbc3

Blueprint: docs/PLAN.md task WT-011.8
Lane: full — widens a shipped adapter contract across four readers; escalation flag `new-api-contract`; Mode: fastlane
Planned at: 6967dbc3
Origin: split out of WT-011.5 at planning, when oracle review showed its mechanism did not exist. That change is parked and depends on this one.
No fork at Gate 1: the only candidate alternative — a separate `entryExists` probe beside `entry` — asks each store the same question twice and lets the two answers disagree, so it was rejected in design.md D1 rather than asked.
Spec: NO-DELTA. Nothing user-observable changes; the consumer (WT-011.5) owns the visible delta.
Oracle round: 5 BLOCK / 1 WARN / 1 SUGGEST, all verified against code and all accepted. Triage in .reviews/oracle-triage.md; it reversed D2's missing-store rule, demoted the Cursor child-map miss from absent to unknown, and added task 1_2. Peer file map that seeded two of the findings: .reviews/explore-evidence.md.
Validator warning triaged, not fixed: task 1_1 names 9 files. Its edit is a ~5-line wrapper in each of the four readers plus one type, one interface and two tests — well inside the sizing rule by lines. Splitting it would put src/vault/VaultService.ts back into the parallel wave, which is the contention an earlier validate run flagged.
Verify Gate: type check clean; biome check src at its 4/14/3 baseline; 5372 unit tests pass; I10 gate ok.
Deviation (1_3): the oracle's F3 placed the Claude fix on the per-candidate `stat` catch, where it is unreachable — `isResolvedPathInsideRoot` returns false for EACCES before the stat runs. The scan therefore treats ANY containment refusal as non-exhaustive. Tightening it needs pathBoundary to report its reason, which is a shipped security predicate with seven call sites and its own task.
Deviation (1_2, 1_3): the errno-to-presence decision was extracted to src/utils/fsPresence.ts rather than restated in each scanner.
Round 1 review: REJECT — 3 BLOCK / 1 WARN, all verified and accepted (.reviews/round-1.md). B3 is a regression task 1_2 introduced: `db-unreachable` bypassed the codex rollout fallback that EACCES used to reach through `no-db`, and fell through the list path's status ladder into its `ok` branch. Verify gate unticked until the fixes re-run it.
Artifact amended before fixing (remediation boundary): design.md D5's Codex `db-unreachable` row now keeps the rollout fallback, and the Cursor table gains the uniqueness and IDE-header rows. B1/B2 needed no decision change.
Round 2: SUPERSEDED — the D5 amendment was landed as a fix commit rather than handed back, so the cycle closed without adjudicating B1/B2/B3/W1. Gate 2 unticked and re-earned on the amended contract; the next review is cycle 2's discovery round over 4df34f4a end to end.
- Cycle 2 hit the round cap on B1-R3 and the fix loop is stopped. The blocker is the file-copy snapshot mechanism in `sqlite.ts`, not this change's classification work: two independently-timed copies cannot compose into a point-in-time snapshot whatever their order. It is owned by an earlier change and shared by every SQLite reader, so it goes back to `asimov-plan` as its own change and WT-011.8 depends on it. Tasks 1_1-3_2 stay done and committed; nothing is reverted.
