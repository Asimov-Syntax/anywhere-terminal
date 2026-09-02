# Workflow State: say-which-lock-a-save-left-behind

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-012.22`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.22
Lane: full
Planned at: a8252482b8a6c50a3d4a5c5fcc5126b934f1d403

## Plan attack triage (round 1, `asm-oracle`)

Rejected the plan, and the finding that reshaped it arrived BEFORE any code — which is the first time
in this line of work that happened, the previous two attempts having been caught by review instead.

- REFUTED, the premise: naming the lock cannot be made safe. The wire carries a pathname and text,
  never an identity, and a human acts on it minutes later; between the identity check and `unlink`,
  and again between the report and the user's hand, the name can be rebound. No disposition table
  closes that. The change now gives NO pathname to the user — design.md D1.
- REFUTED, the disposition table was not exhaustive: `ENOENT` with `nlink > 0n` — our lock renamed
  away — had no row. Added as `movedAway`.
- REFUTED, "the installer is unchanged" was jointly incompatible with the safety claim, because the
  installer ALREADY joins refused paths into a user warning (`AgentHookController.ts:358-360`) and an
  identity mismatch is one of them. So the harm is shipping today, was found by this attack rather
  than introduced, and is fixed here — reversing the earlier decision to leave the installer alone.
- REFUTED, "the type checker will enumerate consumers": `p.reason === "unsaved"` is not exhaustive
  over the union and keeps compiling when a value is added. The inventory is taken by hand.
- REFUTED, the reread was only ONE of two loss paths: `publish` also drops everything on a newer
  source switch. Not a defect — the panel is showing a different file by then — so it is named as
  deliberately uncovered rather than quietly missed.
- UNRESOLVED → specified: the renderer witness could have passed on an empty model, since the summary
  returns counts before inspecting problems. Task 1_3 now requires a POPULATED model.
- Corrected the attack on one point: `media/webview.js` is NOT checked in — `git ls-files media/`
  lists only images — so the compiled string is a build artifact, not a site to edit.
- Verify gate lint: 17 findings remain repo-wide, all in files this change does not touch and all present at base `c6a6f724` (which carried 18 — one error fewer now). Nearest: `src/webview/worktree/worktreeFormat.ts:30` and `src/webview/worktree/worktreePanel.css:635`.
- Task 1_3's declared Verify moved from `unit` to `command pnpm exec vitest run ...`: the suite runs under jsdom, so the default `bun test` runner fails it wholesale on `document is not defined` rather than on anything the task built.
- Round-1 handback: F002's no-op half needed a wire discriminator `ProvisionProblem` did not have, which is a changed D4 rather than remediation — parked before any fix edit, D4 revised, Gate 2 re-earned. Fixes land as tasks 2_1/2_2, so round 1 stands as cycle 1's discovery rather than being superseded.
- The oracle's attack found a third reachable state I had collapsed: `WorktreeHost.ts:2531` passed `written.ok && written.wrote`, merging a REFUSED save with a no-op. All three states already had real-filesystem witnesses at `writeNativeConfig.test.ts:998-1023`, built in task 1_2 and thrown away at the host in 1_3.
