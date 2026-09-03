# Workflow State: find-env-files-the-workspace-declares

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
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none
Planned at: a304c7e5
Evidence: `/Users/huybuidac/Projects/koto/koto-prototype` declares `workspaces.packages = ["apps/*", "packages/*"]`, has no root `.env`, and carries `apps/web/.env`, `apps/server/.env`, `packages/infra/.env` — the reported defect.
Fastlane decision: workspace membership is read from the repository's own manifest rather than guessed from conventional directory names, which would miss a repo that names them differently and invent them in one that has none.`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Planned at: a304c7e5
Evidence: `/Users/huybuidac/Projects/koto/koto-prototype` declares `workspaces.packages = ["apps/*", "packages/*"]`, has no root `.env`, and carries `apps/web/.env`, `apps/server/.env`, `packages/infra/.env` — the reported defect.
Fastlane decision: workspace membership is read from the repository's own manifest rather than guessed from conventional directory names, which would miss a repo that names them differently and invent them in one that has none.
Lane: full
Planned at: a304c7e5

Plan attack: the oracle's trace of shipped code refuted two ledger rows as written, and both were repaired in design rather than accepted. `MAX_SCAN` counts only wildcard expansion, so a manifest of literal directories was unbounded (D2); `readJsonc` recovers a partial tree and reports syntax errors out-of-band, so an undefined-only check would act on half a manifest (D1).
