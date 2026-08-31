# Workflow State: offer-a-pull-request-as-a-source

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

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

Build note (D5 gap, deliberate): the fork-remote statement names a write this change does not
perform. Until a task owns configuring the remote, selecting a fork-headed pull request creates
`pr/<number>` from its base with no remote for the head, so the statement is true of the create § 5
describes and not yet of the one that runs. D5 accepted this split — the announcement is what makes
the eventual write legitimate — but it is a user-visible gap and is flagged for review rather than
left for it to find.

Build note (flakes, not this change): `src/vault/snapshotPool.test.ts` and
`src/extension.worktreeAssembly.test.ts` each failed once under the full suite and passed on a
re-run with no edit between. Both are pre-existing timing flakes; the recorded verifications are
from runs where the whole suite passed.

Verify gate: lint is at this worktree's standing baseline — 3 errors / 14 warnings / 1 info, every
one in `src/agentHooks`, `src/cursor`, `src/session`, `src/test`, `src/vault`, `src/webview/*.css`
and `src/webview/worktree/worktreeFormat.ts`, none in a file this change touches. Checked in check
mode; the auto-fix form was never run.

Review: cycle 1, three rounds, APPROVE with 0 gating blockers. Round 1 REJECT (3 BLOCK, 4 WARN),
round 2 BLOCK (2, both round-1 remediation stopping short of its own boundary), round 3 APPROVE. No
finding was rebutted and none was risk-accepted.

Blueprint sync: worktree-create.md § 4.1 gained the pull-request cap and why it is not the same
claim as the ref cap; § 5 gained the split between stating the fork remote and configuring it, the
fact that a pull request feeds the existing resolution rather than adding one, and the `gh` client
that fixes what "unavailable" covers. WT-012.9 Status → done. No other PLAN row touched.

Follow-up with no owner: nothing configures a fork remote. § 5 now records that the form states the
requirement and that the create does not meet it. It needs its own PLAN task — a repository-level
write with its own failure surface, which is why it was not folded into a fix round.
