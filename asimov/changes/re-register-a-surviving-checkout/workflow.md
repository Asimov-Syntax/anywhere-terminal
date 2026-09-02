# Workflow State: re-register-a-surviving-checkout

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

Blueprint: docs/PLAN.md task WT-012.15
Lane: full (standard) — writes into git's administrative directory; the guard git cannot supply is silent when it fails | flags: security-privacy, cross-boundary
Planned at: fc419071
- No fork at Gate 1: the wire already carries adopt end to end (`WorktreeCreateMode.adopt`, `ResolvedMode.adopt`, `intentFor`'s `mustExistAsDirectory`), and § 2.4 fixes the mechanism. What was missing is a detector, an executor and the form's action.
- WT-012.14 is NOT waited on. Its answer decides one predicate (design.md D7), so the capability is built now and the Windows arm is a defaulted parameter both platforms can witness. Withholding an unverified mode is what WT-012.14's own acceptance asks for; claiming it fails there is what it forbids.
- Adopt is offered only where the selected branch exists (D2). A surviving checkout plus a branch nobody has made has no ref to attach to and no tip to promise, so that destination stays occupied and the suffixed fresh path stands.
