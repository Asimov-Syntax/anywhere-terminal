# Workflow State: retire-a-preview-whose-entry-is-gone

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [ ] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
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
Planned at: d6b6f295
PARKED at Gate 2 (not approved, no code written): oracle review showed the mechanism does not exist — `getEntry` cannot tell a deleted entry from a failed reader. Split out as docs/PLAN.md WT-011.8, which this change now depends on. Artifacts stay as-is until it lands; design.md carries the banner. Triage: .reviews/oracle-triage.md
Scope call (fastlane), UPHELD on verification: the blueprint acceptance's "a row whose transcript is temporarily unreadable keeps its last known line" is read as the TIMEOUT case shipped in WT-011.3, not as the file-missing case. Taking it literally would reverse `worktree-agent-presence` § "An agent row's preview line says what its session last did", which says a row whose transcript cannot be read carries no preview line at all. That requirement is accepted and this change does not reopen it (design.md D3). The oracle challenged this as unresolved; verifying § 2.3's own prose and shipped code confirmed the timeout reading, and the blueprint clause was corrected rather than the spec.
