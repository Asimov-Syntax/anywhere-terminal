# Workflow State: state-what-the-worktree-will-lack

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

Blueprint: none
Lane: full
Planned at: eae86109

Blueprint: docs/PLAN.md task WT-012.1
Lane: full (M) — first slice of the provider layer; the model and its provenance rule are what every later Phase 12 task consumes | flags: new-api-contract, user-visible-ui
Direction (fastlane, no fork): one adapter as one function, no registry — WT-012.3 adds three more and WT-012.4 owns the merge, and that is the task that learns what the seam needs.
Planned at: eae86109
Dependency: `yaml` (eemeli/yaml 2.9.0) enters `dependencies` as its second entry. Verified against the registry before planning on it; `parse` is data-only, unlike js-yaml's unsafe load. design.md D1 records why a hand-rolled subset reader was rejected.
Blueprint edit pending approval: design.md D7 makes `ProvisionPort.port` optional, which contradicts `worktree-provisioning.md` § 2's required `number`. Port allocation is WT-012.6, two tasks downstream, so the field cannot be filled here. Syncs back to § 2 on approval.
Scope note: this repository's own `asimov/worktree.yaml` declares no `ports:`, so the port row is exercised by a fixture rather than by the real file.
Constraint carried into 1_4: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are read-only for this change. A design pass owns them, and `main` carries an unmerged second pass (48fe43ce) conflicting with this branch's (a42de0a0).

