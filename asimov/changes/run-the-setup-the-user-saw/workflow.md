# Workflow State: run-the-setup-the-user-saw

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no product fork; use the host-held offer, one bounded shell runner, row-scoped retry, and the existing mutation queue
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.11
Lane: full (standard) — setup execution crosses host, shell, worktree lifecycle, and UI state | flags: security-privacy
Mode: fastlane — direction, plan, build, review, approval, blueprint sync, and archive auto-proceed within accepted scope
Oracle triage: accepted four blockers and five warnings into D2-D6/tasks; Windows now uses EncodedCommand, setup-only creates mint authority/id, retry is provisioning-only and preserves contests, PTY starts after open with a bounded transcript; rejected the asimov-provenance warning because native plus its named base are both active in the shipped model
Plan drift check: HEAD advanced only by the approved plan commit; all named source seams remain byte-identical to 628c2ec9
Planned at: 2e5573fb
Verify gate lint exception: Biome 2.4.5 still exits 1 on clean `82cb1ba6` only in unchanged `worktreeFormat.ts`, `VaultService.customName.test.ts`, three hook-installer tests, and existing CSS/suppression diagnostics; all 27 setup-delta source files pass check mode.
Review round 1 handback: accepted F001-F010; the reserved-port collision changes the external port contract, so D2-D5 and the delta spec were reopened before remediation.
Replan Oracle: F001-F010 supported; narrowed F006 ownership to tasks 5_1/5_2 and added oversized/UTF-8/batching/disposal plus controller stale-action witnesses.
Validation warning accepted: completed task 4_4 is one behavior-free formatting pass despite spanning 11 already-changed files; splitting it retroactively adds no verification value.
Round 4 grant: the user's prior instruction `cho phép replan, them round review` authorizes one bounded extra review; fix hypothesis is null-prototype environments, settle-before-kill, copied retained slices, and replay recreation.
Round 6 grant: the user's explicit instruction `cho phép round 6` authorizes remediation and one verification review for Round 5 F015-F017.
Round 6 state caveat: the corrected APPROVE artifact conflicts with the earlier superseded entry because the CLI has no amend path and the ledger gate forbids hand-editing.
Round 7 grant: the user's explicit instruction `cho phép round 7` authorizes one fresh discovery round solely to restore an authoritative supported-CLI review ledger entry.
Round 8 grant: the user selected `Cho phép Round 8` to remediate and verify Round 7 F018.
