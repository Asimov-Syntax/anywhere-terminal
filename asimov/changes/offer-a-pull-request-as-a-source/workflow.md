# Workflow State: offer-a-pull-request-as-a-source

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
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Planned at: 5dcf88c4

Blueprint: docs/PLAN.md task WT-012.9
Lane: full (L) — a new external dependency on the wire's far side and a new source kind in the one
control the create dialog is built around | flags: user-visible-ui
Planned at: 5dcf88c4

Gate 1 (user, 2026-08-31): the forge is reached by shelling out to the `gh` CLI. The alternatives put
were VS Code's built-in GitHub authentication plus `fetch`, and adding octokit as a third runtime
dependency; the user chose `gh`. Consequence accepted with it: the feature is absent on a machine
without `gh`, which § 5's "one quiet row" already describes as a first-class state rather than an
error.
Auto-decision: `gh` runs through `createGitCommandRunner({ executable: "gh" })` rather than a new
process seam. That factory is already parameterised on the executable, already resolves rather than
rejects, and already reports `failedToSpawn` — which is exactly "gh is not installed", the state that
has to become a quiet row rather than a thrown error (D2).
Auto-decision: pull requests travel on their own message, fired from the same `requestWorktreeRefs`
handler but resolving independently, so a slow forge cannot delay the ref list § 4.1 requires to
arrive first (D3).
