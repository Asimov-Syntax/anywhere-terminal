# Workflow State: retire-a-preview-whose-entry-is-gone

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
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.5`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.5
Lane: full — a new outcome in a shipped failure-surface decision + escalation flag `re-review`; Mode: fastlane
Planned at: 5ceca2c0
Unparked once WT-011.8 shipped `VaultService.lookupEntry` (`found | absent | unknown`, `src/vault/types.ts:217`). Re-verified against current code: the seam exists, `getEntry` is now the collapsing view of it, and `src/extension.ts:681` still wires the collapsing one. design.md D3 rewritten onto the real contract, D2's bound restated as a cadence (oracle F3), D4 and D6 added — an inconclusive lookup must not blank a line either, which the old `null → forget` path did. Triage: .reviews/oracle-triage.md
Scope call (fastlane), UPHELD on verification: the blueprint acceptance's "a row whose transcript is temporarily unreadable keeps its last known line" is read as the TIMEOUT case shipped in WT-011.3, not as the file-missing case. Taking it literally would reverse `worktree-agent-presence` § "An agent row's preview line says what its session last did", which says a row whose transcript cannot be read carries no preview line at all. That requirement is accepted and this change does not reopen it (design.md D3). The oracle challenged this as unresolved; verifying § 2.3's own prose and shipped code confirmed the timeout reading, and the blueprint clause was corrected rather than the spec.

Build notes:
- Mutation testing: 6 mutations across the routing and the interval. M1 (an `unknown` falling through to the `found` branch) survived the first pass — the line was kept anyway by the `entry === undefined` guard below it, so only the wrongly-stamped `confirmedAt` distinguished the mutant. `does not let an inconclusive answer stand as a fresh confirmation` is that test; all 6 now die.
- The suite's `deps.entry` stubs were rewrapped mechanically for the widened seam (`--test-change` records it). One new test asserted the wrong wait — a resolved-then-unknown row is gated by the retry ladder's 2 × recheckMs, not by the interval — and was corrected to assert the ladder rather than relaxed.
- Review: cycle 1 closed at round 2, APPROVE, 0 gating blockers. Round 1's single BLOCK was a conformance gap against this change's own D4 — no `D#` moved and no owner was minted, so it was remediated in task 2_1 rather than handed back.
- Blueprint sync: § 2.5 records what shipped and why the inert `unknown` path is the bound rather than a detail; DESIGN.md § 12's failed-look row gains the re-confirmation and the inconclusive-answer rule. No new `D#` — D35 and D36 already own these decisions and this change implements them.
