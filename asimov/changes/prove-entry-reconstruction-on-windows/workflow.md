# Workflow State: prove-entry-reconstruction-on-windows

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the harness and the recipe already exist, only the platform answer is missing
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-012.14`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.14
Lane: light
Planned at: 4e81e3a4
Lane: light — S, a spike; no product code
- PARKED on 1_2, which needs a Windows machine this session does not have. `scripts/verify-windows-worktree-entry.mjs` was already committed; nothing about it had to change.
- 1_1 captured the darwin control into evidence/darwin-control.txt: verdict RECIPE WORKS on git 2.50.1, all ten checks pass, and the four files the recipe writes are byte-identical to the ones git writes itself AND unchanged by `git worktree repair`. That last part is the load-bearing half — it means the recipe is not merely accepted but produces exactly git's own normal form on this platform, so any Windows difference is a real platform difference rather than a sloppy fixture.
- The spike is NOT satisfied by the control. Its acceptance names Windows, and the interesting output is the diff between platforms.
- Task 1_2 is BLOCKED ON HARDWARE, not on a decision. Its Verify is `manual` and its Boundary forbids modifying the harness to make a platform pass, so it cannot be ticked from darwin — the protocol's "never tick an unrun Verify" applies and the Verify Gate stays unticked. Everything else is ready: `scripts/verify-windows-worktree-entry.mjs` is written and the macOS control is captured in `evidence/darwin-control.txt`.
- Two unblock paths, neither takeable from here. (a) Run `node scripts/verify-windows-worktree-entry.mjs` in a clone on any Windows box with git and node, and paste its RESULT block. (b) A Windows CI runner would satisfy the same Verify, but this repository has no `.github/workflows` at all — standing up its first CI system for one spike is a larger, separate decision than this change owns, so it is recorded as an option rather than taken.
- Note the acceptance's escape clause does NOT apply while the recipe is unrun: "if adoption cannot be made to work there the mode is refused on that platform" requires the recipe to have been executed and FAILED. "Not executed" is not "failed", and refusing adoption on Windows off the back of an untested guess would be exactly the half-working outcome the task exists to prevent.
