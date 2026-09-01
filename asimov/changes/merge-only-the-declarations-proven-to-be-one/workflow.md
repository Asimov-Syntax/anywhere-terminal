# Workflow State: merge-only-the-declarations-proven-to-be-one

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
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
Planned at: 414b0aef

Blueprint: docs/PLAN.md task WT-012.17
Lane: full — HIGH risk: this is the seventh mechanism proposed for one invariant and six are refuted; getting it wrong in the merging direction silently deletes a declaration the repository made | flags: new-api-contract
- Scoped by an oracle attack before planning, not after. Its boundary result is why WT-012.17 was split: the read path can prove only spelling-level identity, because git creates the worktree AFTER the offer is drawn and the folding rule belongs to that directory. WT-012.18 owns the apply-time half.
- Refuted before this change starts, do not re-propose: lexical-only normalization; a single-file case probe (a case-toggled symlink answers for the wrong volume); a two-spelling resolution probe; `realpath` per path (two aliases, one answer, two slots); `lstat` dev+ino per path (two hard links share an inode, a symlinked parent defeats no-follow, Windows `st_ino` collides past 2^53 without `{ bigint: true }`); `toLowerCase()` on Windows path semantics (over-merges `İ`/`i̇`, `ẞ`/`ß`, `Ϗ`/`ϗ`, which NTFS keeps apart through `$UpCase` with no normalization).
- Also refuted as a repair: ASCII-only folding. It closes the Windows over-merge but worsens the other direction — `Straße`/`STRASSE` and `ﬀ`/`ff` are one file on APFS, so splitting them recreates the round-7 defect where both rows arrive default-selected and the inherited mode wins the apply.
- Reuse, verified before planning: `BringRow.excluded` in `src/webview/worktree/WorktreeCreateDialog.ts:296-313` is already a row that is drawn with its provenance and carries no checkbox. The unresolved pair is a second marker down that same rendering path, not a new pattern.
- Plan attack run before Gate 2, not after. It refuted three ledger rows and two of my own claims, all accepted and applied: the "no I/O" witness was unfalsifiable as written (provider files ARE opened, so an empty-list assertion could never hold); the no-loss claim had to narrow to declarations with DISTINCT spellings; and a singular favoured member cannot represent native+native, so a group now carries an optional favoured id and is a connected component rather than a pair.
- Two findings were mine to own rather than the sibling's: `offerStore.remint()` replaces every entry id, so a group naming pre-remint ids points at ids nobody holds — silent and total, now task 2_1 step 4. And task 1_1's RED step could not have failed on this darwin lane, because the old fold only fired when `path.sep === "\\"`; the platform flag is now injected.
- The spec delta was MODIFYING a requirement that is not in the accepted baseline — it is an ADDED requirement of the sibling `assemble-one-config-from-several-files`, which now Depends On this task. Modifying a requirement owned by a change that depends on you is circular; the delta is ADDED-only now, and its two on-disk scenarios moved out to WT-012.18 where a witness can exist.
- Gate 2 taken under fastlane on the user's "ok nhé, tự chốt đi" (2026-09-01). The scope decision that preceded it — splitting WT-012.17 from WT-012.18 and dropping the unsatisfiable "one row before creation" clause — was made while the user was away and confirmed by them afterwards.
- Task 1_1 corrected the first ledger row a second time, and the correction came from RUNNING the witness rather than reasoning about it. The oracle had refuted "the recorded path list is empty" because provider files are opened; my replacement — "no recorded path derives from a declaration" — failed too, and the failure was informative: `/repo/kept` reaches `realpath` because containment resolves every declared path to check where it lands. That is the security property F009 exists to protect and it must not be asserted away. The witness is now differential: two fakes that disagree about every declared path must yield identical rows.
- Task 1_1 RED was proved by three mutations, not one. `toLowerCase()` kills 4 of the 7 conserved-declaration assertions, a Win32 dot-strip plus NFKD kills 2 more, and `toUpperCase()` kills the last (`Straße`/`STRASSE`). Each assertion is therefore non-vacuous against at least one plausible fold; none of them is a test that could only pass.
