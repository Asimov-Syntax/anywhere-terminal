# Workflow State: surface-what-the-scope-hides

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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

Lane: full (standard) — MEDIUM risk: the failure mode is silence, and the union of two differently-covering sources is where an under-report hides | flags: user-visible-ui, re-review
Planned at: 7128f51c

Blueprint: docs/PLAN.md task WT-010.2
- No Gate 1 fork. The blueprint's design (worktree-scope.md § 3.3, § 4.2, § 4.3) already chose the
  contested calls and recorded why: the union over two evidence sources, no badge at zero, and
  selection as navigation rather than a pinned active pane. Nothing in the code contradicted them.
- Admission screen re-run after discovery: one new invariant owner (I19), one acceptance story —
  the filter never strands you. The badge, the activation rule and the empty region are three faces
  of it, and the blueprint already split the filter itself into WT-010.1.
- Orca was not researched: this change is about this extension's own scope filter, and
  `docs/audit/2026-08-29-worktree-ui-vs-orca.md` holds the comparison the PLAN task came from.
- `main.ts` is touched by 1_2, 1_3 and 1_4, so those three serialize regardless of the wave plan's
  arithmetic. Built solo, in task order.
- Oracle review: 7 findings, all accepted, all applied before Gate 2. Four were blocking. The three
  load-bearing corrections: selection must activate a PANE through the existing `activatePane`
  primitive, because a mixed split is presented for one leaf while another leaf is active inside it
  and tab identity cannot express that; nothing hides `#terminal-container` on the empty-scope
  branch, so the region would have appeared beside the very terminal the scope hides; and keying the
  raw waiting set would have broken the shipped no-DOM-work requirement, so the guard keys the
  derived badge count and the requirement is narrowed by a MODIFIED delta rather than silently.
  It also caught that `createTab` carries no worktree identity and would open in the wrong directory.
- The oracle wanted activation and the empty region as ONE task; the validator wanted the resulting
  10-file task split. Split on rendering vs decision instead — 1_3 builds the region, 1_4 owns the
  single calculation — so the decision that must not fork is still in one task.
