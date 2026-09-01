# Workflow State: fail-a-build-whose-bundle-cannot-resolve-itself

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the PLAN row fixes the artifact-not-sources constraint and the repo already has the gate idiom
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.12`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.12
Lane: light
Planned at: dfa36294
Lane: light — S, one new gate script plus wiring | flags: infra
- Adoption is `clean-now` (automated-rule reference): `dist/extension.js` at planning time carries only node builtins and `vscode`, so the rule passes on landing. No baseline, no ratchet.
- Specs are NO-DELTA: a build-time gate changes nothing the shipped extension does.
- Gate 2 taken under fastlane on the standing goal, with the user away.
