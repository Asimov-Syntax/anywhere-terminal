# Workflow State: merge-only-the-declarations-proven-to-be-one

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [ ] Gate 2: plan approved

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
