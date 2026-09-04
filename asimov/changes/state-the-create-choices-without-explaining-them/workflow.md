# Workflow State: state-the-create-choices-without-explaining-them

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the user stated the direction
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
Lane: full
Planned at: 1e6faf3c

Blueprint: none
Lane: full — escalation flags: none. Touches display text and one rendering path; the two things that
could regress are named as proposal Must-nots.
Planned at: 1e6faf3c
Source: the user's screenshot feedback, verbatim — "đang giải thích quá dài dòng … ví dụ copy mấy cái
.env thì là copy thôi, giỉa thích cái gì thế, cùng lắm thì thêm icon hint vào - làm cho nó phẳng,
ngắn gọn thôi" and "tương tự cái nút save current choice và checkbox wait for...".
No design.md: no fork, no obligation ledger — nothing here touches a mutable resource whose failure
outlives the request. The two constraints that would have been decisions live as Boundaries on 1_1
and 2_1 instead.
Auto-decision (fastlane): the secrets warning is kept and moved rather than cut. It is the only thing
on screen marking a row as a secret file, and the user's own words allowed a hint ("cùng lắm thì thêm
icon hint vào").
The shipped spec MANDATED the verbosity — `Every initialization suggestion is explicit and explained`
required a suggestion to "explain what selecting it does", and `The provisioning save action names
what it persists` required the adjacent explanation. Both are MODIFIED here rather than worked around.
Follow-up already scaffolded: `read-an-invalid-branch-name-as-an-error` owns the user's third point.
Its target requirement is `A disabled create action states what it is waiting for`, which likewise
mandates today's behaviour — "Waiting to check this selection." is the spec's "pending clearance
assessment" reason, not an accident.
