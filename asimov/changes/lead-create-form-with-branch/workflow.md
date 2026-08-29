# Workflow State: lead-create-form-with-branch

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
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-009.3`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-009.3
Lane: light (small) — one dialog, one domain, no new wire field; flags: none
Planned at: 874fc77d

- Fastlane: no fork. `worktree-actions.md` § 3.2.1 settles every rule the form takes; nothing was left open for planning to choose.
- The repo picker goes BELOW the destination line, not into the advanced disclosure. "Nothing above the lead input" is a rule about order, and a multi-repo workspace cannot reach its destination without the picker — burying the input the destination is derived from would trade one contradiction for another.
- The folder choice defaults its secondary control to adding to the workspace, unconditionally. The design conditions that on "a workspace that already has folders", but `openCreateDialog` returns early without repos and repos require a folder — the condition cannot be false where the control exists, so no new wire field is added to evaluate it.
- The agent block's reveal is already implemented in the current form; this change pins it rather than rebuilding it, because a restructure that moves it is exactly where an unpinned rule goes quiet.
- The dangerous-posture rule is NOT already implemented, which I had recorded wrongly here. `initialPosture` returns undefined when every choice is dangerous, and the `<select>` then displays and submits its first option — the applied base requirement is violated today for that agent shape. Task 1_3 repairs it at both doors the requirement names. Scope the oracle surfaced, not scope this task set out with.
- Path transparency is preserved, not traded: the host-resolved path is still stated before the create can be authorized. What changes is that it is stated once, shortened, with the exact value reachable in the dialog.
- Must not: no new create wire field, no change to `WorktreeOpenAfter`, no branch-name suggestion.
- Oracle round: 5 findings, all verified against source and all accepted. Two were spec defects of mine — a submit rule that contradicted the retained detached mode, and a destination statement that could show the host default while the override submitted. Two were plan gaps — the tooltip target needed `tabindex` to be reachable by anything but a mouse, and the trap/dismissal coverage the blueprint's acceptance names was cut to the two easy cases. The fifth is the posture defect above.
- Gate 2 taken under fastlane: the question was put and went unanswered for 10 minutes. Task 1_3 (the posture defect) is the one item that grew scope; it is last, so it can still be pulled without touching the other two.
