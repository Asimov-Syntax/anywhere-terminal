# Workflow State: keep-contested-session-title

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [ ] Gate 2: plan approved

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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light

## Notes

- Found from a live report plus temporary logging, not from reading: the projector computed
  `finalTitle: "cyberk-skills-04"` for both panes, so the name was resolved and then discarded.
- Two claims were sharing one field. `entryId` means "this pane owns the session", and
  `titleFromVault` also used it as "look the title up here". A contest must withdraw the first;
  withdrawing the second was accidental, and invisible until a pane had no title of its own —
  every existing test in the block used `title: "zsh"`.
- The pane's own title still wins. A pane running `npm run watch` is named by what it runs, not by
  a session it just lost; that case is now asserted rather than incidental.
- Verify Gate: check-types clean, 235 files / 4714 tests, gate exit 0, lint 13 warnings + 4 infos —
  identical to `main` under the same biome 2.4.5.
- Round-1 B1 accepted and fixed in 2_1. My guard asked whether a title EXISTS when the question was
  who OWNS it, so two live cases stayed broken: a pane reporting `""` (a real state — `paneEvidence.ts`
  separates "reported nothing" from "never reported"), and a registry slug like `cyberk-skills-04`
  that could never be upgraded to the vault's real title. `titleSourceId` is now set only where the
  pane does not name itself, so its presence alone is the permission to read the vault.
