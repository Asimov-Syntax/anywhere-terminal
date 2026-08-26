# Workflow State: surface-external-agent-rows

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no real fork — see Notes)_
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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-004.2
Lane: full (standard) — reader contract change fans out to two providers, the projector and the host | flags: cross-boundary
Fastlane: no Gate 1 fork — external rows ride the registry read the projector already takes per rebuild, so the only open call was where the scan is paced, and § 3.7 already fixes that at 5 s while shown.
Dedupe limit: a registry session is deduped against the window rows this rebuild emitted; a pane inside no worktree emits no row, so its session can still surface as external under the registry's own cwd (design.md D3).
Oracle pass: 7 BLOCKs, 6 accepted as raised, 1 accepted-modified — D3's dedupe now resolves every pane (blueprint § 3.5.4 requires it), D2 hands the external pass the headless-filtered index, D6 became an external-only projection, D7 and D8 are new, and 3_2 drives its timer from a window-level showing predicate. Modified: the oracle asked that a failed read's retained list also serve pane resolution; D7 types the failure through instead, since resolving a pane against a list the failed read did not produce would manufacture identity evidence.
Rejected: listing each task's own test file in Plan — the build lease leaves test files writable by design and Plan names production paths. 1_1's Verify became a command carrying the type check, which is what actually proves its three consumers moved.
Verify gate: 13 lint warnings remain, all pre-existing and in files this change does not touch (fileTreePanel.css, vaultPanel.css, SnapshotPersistence.ts, fileTreeRpc.integration.test.ts); the noCommaOperator finding in VaultService.customName.test.ts reproduces on a clean HEAD worktree.
Review cycle 1: 3 rounds, closed at the round cap with 2 gating blockers (round-3 B1, B3). Fastlane took thrash-stop option 1 — handback to planning — over a 4th patch: both blockers are the same defect (state retired by its producer without an acknowledgement from the consumer that applies it), once for pane evidence between host and projector and once for the rank delta between projector and cache. A boolean cannot say WHICH pass saw the evidence; that is a design decision, not a patch. S1 stays non-gating and carries into cycle 2.
Cycle 2 plan: no spec delta — round-3 B1/B3 are conformance defects against requirements this change already accepted, not new external behavior. D11 states the shared rule (producer counts, consumer acknowledges) and D12 replaces round 2's `ranksMoved()`; D6 and D8 keep their decisions and point at them. B1 and B3 stay ONE task: both leases are `WorktreeHost.ts`.
Oracle pass (cycle 2): D11 sound as written; 2 BLOCKs accepted as raised. D12 now advances `appliedRankRevision` only after `cache.reorder` — verified that the rebuild gate serializes per scope and that `merge` retains the stored worktree array for a degraded listing, so neither `applyRepo` nor `applyBuild` establishes cache-wide order. 6_1's Verify became a command carrying both suites plus the type check, because host tests fake the projector and cannot prove its revision semantics. Oracle found no third instance of the defect in `failingSince`, `externalSeen`, `lastSessions`, `lastWindowPass` or the resolution slots.
6_1 mutation evidence: capturing the generation after the pass instead of before, and letting a cache assembly acknowledge a rank revision, each fail exactly the regression written for them. The `!projectionDirty` half of the apply guard survives mutation by construction — a dirty iteration always forces a full rerun whose own capture is at least as new — and is kept as defence in depth, noted at the call site.
Cycle 2 round 1 (round-4): 0 blockers — both cycle-1 blockers verified fixed. All four WARNs accepted and fixed in 7_1/7_2; each verified before triage (`isSafeSessionId` is the canonical guard the reader was ignoring; `sameTree` compared positionally, and D12's own reorder is what permutes that order). S1 rejected again, non-gating.
Cycle 2 round 2 (round-5): APPROVE, 0 blockers 0 warnings. S1 carried out of the change as a measured follow-up, unfixed by decision across five rounds.
