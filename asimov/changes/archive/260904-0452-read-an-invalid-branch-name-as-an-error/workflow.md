# Workflow State: read-an-invalid-branch-name-as-an-error

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the repository has already recorded the only admissible direction
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [-] Review done — skipped: no escalation flag. The change adds one optional wire field beside `baseValid`, asks git through the create's own `branchNameIsValid`, and reads the answer into a field error the form already renders. Both Boundaries carry witnesses: an unaskable git answers nothing, and a verdict for a name the user has typed past is dropped.
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: ec0ea842
Source: the user's screenshot feedback, verbatim — "branch name ko được có dấu cách hay lỗi thì dùng
ux lỗi đi, ai lại đi hiện 'wait to check this session' thật ư?".
The seam is already there and dead: `deps.validateBranch` (WorktreeCreateDialog.ts:212) is declared,
called at :2893, and supplied by NOTHING in production — only by tests. `draft.branchError`
(worktreeViewTypes.ts:322) is written at :2894 and read by nobody. So today an unacceptable name is
refused by git only after Create is pressed, and until the probe answers the form says "Waiting to
check this selection." — which is what the user saw.
Not a fork: `branchNameIsValid` (worktreeMutations.ts:252) already carries the repository's recorded
decision — "Asked of git rather than reimplemented: check-ref-format's rules are long,
version-dependent and easy to get subtly wrong, and a validator that is merely close is worse than
none". A webview-local validator is refused by that decision, not chosen against here.
Must not: decide acceptability anywhere but git; turn an unaskable git into a refusal (`null` is "not
told", and the create still proceeds for git to refuse directly); add prose to the disabled action;
or weaken the checked-out-elsewhere refusal that owns the same field.
`baseValid` is the precedent the whole change rides: same message, same shape, same "absent means
nobody was asked", same asked-only-where-it-applies rule.
No design.md: no fork, and no obligation ledger — nothing here touches a mutable resource whose
failure outlives the request. Both constraints live as task Boundaries.

Verify gate: 7713/7713, type check clean, I10 and bundle gates green, `verify-status` exits 0 with
both tasks stamped. Biome reports the same 1 error / 14 warnings / 1 info as before the change; the
one format finding this change introduced was fixed with `biome format --write` scoped to the single
file, never the `--write --unsafe` form the lint script runs.
1_2 needed no controller edit after all: `handleCreateResolution` forwards the whole message, so the
new field rides it. Recorded on the task's own Plan.
