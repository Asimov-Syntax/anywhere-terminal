# Workflow State: launch-agent-in-worktree

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
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-005.3
Gate 1 (fastlane auto): prompt delivery — declare `promptDelivery`, build the argv path only, defer the pty writer (design.md D3). The blueprint asks for the pty fallback; no registry agent needs it.
Lane: full (standard) — new fresh-launch registry contract + host wiring + two entry paths (menu, create form) | flags: new-api-contract
Verify gate: lint's remaining findings are pre-existing and confined to files this change never touched (SnapshotPersistence.ts, fileTreeRpc.integration.test.ts, VaultService.customName.test.ts, two CSS files).
Oracle pass: 5 BLOCK / 1 WARN / 1 SUGGEST — 5 accepted, 2 accepted-modified (pty writer replaced by `canSeedPrompt` + a PLAN deferral; `openFailed` meaning broadened instead of renamed).
Review: 4 rounds run (round 3 was the fix loop's one bounded extension). Rounds 1-3 closed six findings; round 4 rejected with three blockers that are one defect shape — a value read on one side of an `await` and trusted on the other. Patching each occurrence found the next; handing back to `asimov-plan` for a designed request-identity contract instead. User chose the handback and asked for an oracle consult mining /Users/huybuidac/Projects/ai-oss/orca for prior art.
Rework (round-4 handback): design D10 — one immutable launch intent; a per-repo generation owned by WorktreeCache replaces `head:branch`. Oracle consult verified orca's `instanceId` prior art and that rebuilds are driven by git HEAD/admin watches only, so failing closed on an intervening rebuild does not refuse launches during ordinary editing. Validate's 3 residual warnings are on ticked tasks 6_1/6_3 — left alone rather than rewriting verified evidence.
Rework outcome: 7_1-7_4 landed. The create-then-launch generation guard was implemented and WITHDRAWN — the host's post-create rebuild does not reliably report the worktree the create just made, so the guard refused real launches; design.md D10 records the boundary and the spec bullet was corrected to match. Lint check-mode is clean apart from the 13 pre-existing warnings in files this change never touched.
Round 5 (cycle 2 discovery): BLOCK — 2 blockers, 2 warnings, all four accepted, none rebutted. B7 was mine from 7_1 (advancing the generation on a degraded apply invalidated old intents but minted new authority); B5 was the resume path, which round 4 never named and I did not extend the fix to. Fixed in 8_1: a retained apply publishes no registration, `markDegraded` separates annotation from re-listing, admission returns the admitted intent rather than a boolean (W7, and what D10 specified all along), and resume quotes its registration.
Round 6: SUPERSEDED, not adjudicated — the chair ruled that d9f3897 makes a semantic design decision round 5 did not approve (an unwatched repository keeps launch authority). Correct call: that belongs to Gate 2, not to a fix loop. Handback to planning to decide it explicitly as D11; the round-5 gate set carries forward unverified into cycle 3.
Gate 2 re-earned (fastlane auto): D11 decides the boundary explicitly — a retained listing publishes no registration, an unwatched-but-listed repository keeps its own. Option A (refuse on any `degraded`) was rejected on evidence: it disabled every launch in the assembly walk, whose host has no file watcher. Option C (re-list at admission) collapses to A. The code already matches D11, so no task changed and the 8_1 verification evidence stands.
Round 7 (cycle 3 discovery): BLOCK — 1 blocker, 2 warnings, all accepted, D11 upheld. B5 was a consequence of D10's own render-signature exclusion, which my round-5 fix ignored; the capture moved to menu-build time. W8 was the other half of the degradation split left undone, and fixing it surfaced two more readers of `degraded` that wanted the listing claim only — both now ask the registration token. Fixed in 9_1.
