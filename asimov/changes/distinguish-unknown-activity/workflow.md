# Workflow State: distinguish-unknown-activity

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-008.1`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-008.1
Lane: light — one concern (the state vocabulary), no contract change, no new invariant owner
Planned at: 94135439

- Fastlane: no fork. The audit's § B2 named the cause as "one hollow circle for working/idle/unknown"; the shipped CSS already gives waiting/running/idle/exited four distinct shapes. The real defects are that `unknown` does not exist at all — the projector's fallback lands such rows on `idle`, a positive claim from an absence — and that `running` differs from `idle` only by colour once motion is removed. Scope set to those two.
- Live trigger for `unknown` is the presence degradation list; `activitySource: "none"` is never emitted by the projector today (fixtures and tests only), so it is kept as the defensive branch rather than the common path.
- No design.md: the derivation table and the source mapping are owned by docs/design/worktree-panel-ui.md § 7.2 and cited from there.
