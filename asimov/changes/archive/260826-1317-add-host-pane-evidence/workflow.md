# Workflow State: add-host-pane-evidence

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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

Blueprint: docs/PLAN.md task WT-004.0
Lane: full (standard) — new webview→host direction plus a host-side registry touched from the pty data path | flags: new-api-contract, cross-boundary

Mode: fastlane — auto-chosen at every gate.
Auto-decision: no real fork; the design doc fixes the transport contract, so Gate 1 was answered from it and marked `[-]`.
Auto-decision: `waiting` is reported rather than re-derived host-side (design.md D4 records the open choice worktree-agent-presence.md § 3.3 left).
Auto-decision: spec deltas land in a new capability `pane-evidence-transport` rather than extending `worktree-tree-protocol`, which owns tree push, not pane evidence.
Oracle review: 4 BLOCK + 3 SHOULD, all accepted — evidence lifetime rekeyed from the session map to the pane (D2), message made partial (D3), output tap moved to the flush point (D6), serializer added to the routing lease, projection scope and two spec requirements narrowed, verification gates raised. None rejected.
Verify gate: lint run in check mode (`biome check src/`), not the repo's `pnpm lint` (`--write --unsafe`); 13 warnings remain, identical to the clean-HEAD baseline and confined to files this change does not touch (vaultPanel.css, fileTreePanel.css, VaultService.customName.test.ts, SnapshotPersistence.ts, fileTreeRpc.integration.test.ts).
Deviation: task 3_3's Plan named `SessionManager.ts` in prose only, so its first lease excluded it; Plan paths corrected and re-leased before any edit.
Scope boundary: the store is written but not read in this change — `WorktreeHost.presence()` stays empty until WT-004.1, per the PLAN.md WT-004.0 Notes.
Review round 1 (`asm-review-master`, resume id `a24856c0d09914b20`): 2 BLOCK, 2 WARN. B1 accepted (view close bypassed evidence deletion — fixed as 4_1, D2 corrected: closing a pane and closing a view are two paths, not one). W2 accepted (title cap bounded the payload, not the work — fixed as 4_2). W1 accepted in part (sync-throw post no longer counts as output; async rejection/`false` deliberately still does — evidence is the pane's, not the surface's). B2 rebutted.
Follow-up (not this change): an empty OSC title leaves the tab label at the previous title (`applyTitleChange`), so the reporter matches it rather than diverging. Whether an empty title should CLEAR the label belongs to `process-title-tracking` — both sides must move together.
Review round 2 (same chair, `a24856c0d09914b20`): B1 and W2 confirmed fixed. B3 accepted — the round-1 W2 fix had redefined the reported title by slicing the raw string first; replaced with a bounded single-pass normalizer that yields the capped prefix of the FULL signature, with decoration still read from the whole raw title (tasks 5_1). W1 accepted, reversing the round-1 partial rebuttal: D8 governs visibility gating, not delivery, and D6's own goal is alignment with what the surface received — the observer now fires on `postMessage` resolving `true`, stamped at flush time; no generation token, since the store's no-create-on-write rule already makes a late stamp for a deleted pane a no-op. W3 accepted (reverse view index). D6 updated for the delivery condition.
B2 (sustained by the chair) was escalated to the user, who directed the fix rather than a follow-up change. Task 6_1: `applyTitleChange` assigns an empty title like any other, `TerminalInstance` keeps the host-assigned `defaultName` (`name` is the field xterm rewrites, so the original survives a clear only if kept), `buildTabBarData` resolves the `Terminal N` fallback in one place so root and split tabs cannot disagree, and the reporter guard is gone so the host learns of the clear. `Terminal N` chosen over blank / last-non-empty because it is what VS Code's own terminal does and is already this pane's label.
Scope growth: this change now also owns a `process-title-tracking` MODIFIED delta — the tab-label behavior for a cleared title is externally verifiable and was not previously specified. Validator warns twice on it, both intended: the requirement is long because MODIFIED replaces the whole inherited block, and the flagged contradiction with the existing spec IS the delta (overlap 0.87, antonym 0.14).
Review round 3 (same chair): 0 BLOCK — all four round-2 findings confirmed fixed, loop exit condition met. W4 accepted and fixed in 7_1: making the flush observer asynchronous in round 2 created a reordering window, so `markOutput` now refuses a timestamp no newer than the one held. W2 rebutted on measurement — I implemented the suggested fusion first and benchmarked it, 20 events each: 8 MB undecorated title 1.6 ms split vs 326 ms fused, 8 MB all-spinner 390 ms vs 425 ms, ordinary title ~0 ms both. The two reads are a native regex and an interpreted loop and do not cost alike, so fusing spends the expensive one over the whole range and forfeits the loop's early exit. Reverted; numbers recorded at the function.
Validator: 2 warnings left standing on the `process-title-tracking` delta, both intended — MODIFIED replaces the whole inherited requirement block so its length is the original's, and the flagged contradiction with the existing spec IS the delta.
Blueprint sync: worktree-agent-presence.md § 3.3 corrected where the built seam contradicted it — evidence lifetime is the pane's, not `SessionManager`'s (the old text said only session removal discards); waiting is reported on its own message rather than left as an open either/or; output is counted on delivery; the shared projection and the store are named. Also repaired two dangling `§ 13.6` cross-references in DESIGN.md § 8.2/8.3 — no such section exists, the seam is owned by § 8.6.
