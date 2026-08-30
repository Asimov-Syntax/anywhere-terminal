# Workflow State: suppress-a-preview-that-repeats-the-title

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.4`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.4
Lane: light — one pure function and its call site; DESIGN.md § 9 D34 already settled the rule, so no design fork remains. Mode: fastlane
Planned at: 16a8f338
Must not: suppress on similarity, shared prefix, or truncated comparison — exact equality after the title's own normalization only (D34). Must not strip decoration from a preview that is drawn.
Scope call (fastlane): the delta also retires `worktree-panel`'s "A decorative frame is neither shown in a preview nor a reason to repaint". Discovery found it superseded by `source-the-agent-row-preview` D4 (commit 837e2ba6, "stop treating a preview as a pane title"), which reversed it in code and in worktree-panel-ui § 3.3 but left the spec standing — `worktreeTreeView.ts:608` and `worktreeRenderSignature.ts:113` have both contradicted it since, with a test asserting the opposite. Folded in rather than deferred because this task writes the one function that decides what a preview shows, and leaving the old rule on the books would ship two answers for one concept.
Its neighbour scenario, "a preview that is only decoration renders as one line", is DELETED with it rather than rehomed (oracle F2): `worktree-agent-presence` § "A preview is message text, not a pane title" is the newer contract and says a marker-only preview renders as itself. A MODIFIED delta drops the scenario from the requirement that carries it.
Oracle F3 corrected the comparison before any code was written: the plan had `stripDecorations` running over the preview too, which is what D4 forbids — it turns "* deploy the build" into "deploy the build" and "*" into "". D34's wording is singular, "after the title's own normalization", and only the title is normalized.
Round 1: APPROVE, zero findings. The chair verified the spec-delta supersession chain independently. It also declared that `asm-review-contracts` and `asm-review-reuse` never reported and claimed no coverage for them — accepted rather than re-run: the spec-delta question those lenses would own is the one the chair audited itself in depth, and the diff is one pure function plus a call site.
