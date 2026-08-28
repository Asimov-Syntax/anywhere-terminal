# Workflow State: remove-rejected-hook-installer

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — forward removal across activation, manifest, user-config writer, blueprint, and archived history | flags: security-privacy, re-review

Fastlane: user selected installer-only forward cleanup; generic runtime and Cursor adapter are explicit hard boundaries.
Blueprint exception: this recovery change resets WT-006.2 to todo rather than claiming it complete.
Fastlane Gate 2: approved — five tasks preserve the reviewed runtime, restore the Cursor bridge, remove only rejected installer ownership, repair blueprint dependencies, and archive unapplied history.
Implementation handback: full-suite I6/I7 evidence proved Claude runtime registration is load-bearing for completed WT-006.3; installer-only deletion is superseded and this cleanup waits on install-claude-hooks-v1.
- Superseded by `install-claude-hooks-v1`: full-suite WT-006.3 evidence proved installer-only deletion invalid. Archived incomplete; no specification delta was applied.
