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
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.5`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

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
