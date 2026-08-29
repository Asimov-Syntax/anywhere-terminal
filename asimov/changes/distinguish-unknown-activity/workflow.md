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
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
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
- Task 1_3 is a `manual` Verify only the user can run (the rendered view at sidebar width, reduced motion on, monochrome theme). Left unticked and carried into the Approval block; the automated half of it — five states that stay distinct with every colour token collapsed — is asserted in WorktreeView.test.ts.
- Verify Gate: check-types, test:unit and the I10 gate pass. Lint is at its pre-change baseline (3 errors / 14 warnings, reproduced on a clean tree at HEAD~3), all in files this change does not touch.
- 1_1's Plan gained `worktreeTreeView.ts`: widening `strongestActivity`'s return type breaks its consumer's signature in the same commit, so the seam could not type-check split across two leases.
- Review cycle 1 ran three rounds: BLOCK (7 findings) → WARN 0-blocking (8) → WARN 0-blocking (7). Every finding was accepted; five are recorded as audit-backlog in the round files, all pre-existing or reaching past this change's scope. The exit condition was met at round 2 and holds; round 3's accepted fixes were taken before close rather than as a fourth round.
- The CSS shape guard was wrong in three different ways across the three rounds — colour-flattening hid the arc, `::after` and dropped fills hid an invisible state, then non-painting borders read as ink. It now models per-side border cascade and asserts the base layer paints; six counterfactuals fail it. It is still a stand-in, not a substitute, for the parked manual 1_3.
