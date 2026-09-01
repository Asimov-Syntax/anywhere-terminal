# Workflow State: materialize-declared-files-into-a-new-worktree

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

Blueprint: none
Lane: full
Planned at: 50e6428d

Blueprint: docs/PLAN.md task WT-012.2
Lane: full (standard) — HIGH risk: writes files into a directory that did not exist a moment ago,
from paths a checked-in file supplied | flags: security-privacy, cross-boundary, new-api-contract
Planned at: 50e6428d
- `new-api-contract` added beyond PLAN's two labels: `ProvisionStepResult` and
  `worktreeProvisionResult` are documented at worktree-rpc.md § 2.2 line 115 and defined NOWHERE in
  `src/`, and `WorktreeCreateRequestMessage` grows `provision?`. Three wire additions is a contract
  change whatever the PLAN row says.
- Admission screen, re-run after discovery as the skill requires: ONE new invariant owner — the
  discipline by which provider-declared material is written into a new worktree. Copy and link are
  two modes of one step sharing one validation path, not two owners, and the result contract is the
  reporting half of the same acceptance story rather than a second story. No split proposed.
- Verified before planning on them: `ProvisionEntry`/`ProvisionModel`/`ProvisionSelection` DO exist
  (`src/types/messages.ts:851-945`); `ProvisionStepResult` does NOT; there is no apply code and no
  recursive copy helper anywhere in `src/` to reuse; `offerStore.ts:11` names WT-012.2 as its first
  redeemer, which this change is.
- The seam is `src/worktree/worktreeMutationService.ts:891-920`, between `addToGitExclude` and
  `afterCreate`. Chosen over "after the create returns" because `afterCreate` launches an agent INTO
  the worktree and would otherwise start before its `.env` landed.
- Validate warning triaged as a false positive, not fixed away: the lockfile / `node_modules`
  requirement reads as prescribing implementation because it names two files, but both are material
  the user is shown a refused row for. The behaviour is externally verifiable; the wording was
  already loosened once and further loosening would stop naming what is refused.
- FOLLOW-UP, needs its own PLAN task and is NOT closed here: rpc § 2.4 requires a stale `offerId` to
  produce no create AND a freshly resolved model, re-presented, awaiting a second submission. D3
  builds the refusal; the re-present half is provisioning UI. Carried as a ledger row rather than
  left implicit.

