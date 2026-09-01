# Workflow State: offer-a-yielding-declaration-as-yielding

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the offer must stop promising what the apply refuses
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
Lane: light
Planned at: 2559e6c2
- Split out of `award-a-contested-destination-or-refuse-it` at its round-3 thrash stop: F007's live half needs a new invariant owner in the webview, which the remediation boundary keeps out of the parent's fix loop. The parent depends on this reaching APPROVE.
- This is the USER-FACING face of a scope cut the user has not ruled on: held declarations are refused on every volume, including one that genuinely keeps the two spellings apart. If the user reverses that, this change is reversed with it.
- A group with no favoured member is deliberately untouched — unselecting either member would pick a winner the apply itself does not.
