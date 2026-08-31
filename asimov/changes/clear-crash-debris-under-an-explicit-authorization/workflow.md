# Workflow State: clear-crash-debris-under-an-explicit-authorization

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

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

Blueprint: docs/PLAN.md task WT-012.12
Lane: full (standard) — the one create path that deletes | flags: security-privacy
Planned at: cf4492aa

Gate 1: no fork — `worktree-create.md` § 2.2 already fixes every bound, and WT-012.0 landed the wire
types. Direction auto-chosen under fastlane.
Auto-decision: debris classification replaces `dispositionOf`'s registration proxy rather than being
added beside it — the proxy is wrong for a pruned checkout, which is WT-012.15's, not debris (D1).
Auto-decision: a sibling authorization store rather than generalizing removal's fingerprint store —
no shared comparison logic, and the removal store guards the riskier action (D2).
Auto-decision: the delete site is allowlisted in the I10 gate rather than moved outside its scope —
passing by hiding inverts what the gate is for (D4).

Handback (1_6): the wire has no carrier for a debris authorization. `worktreeCreateResolution`
carries `ResolvedDisposition`, which the previous change deliberately narrowed so a probe answer
holds nothing a delete could be built from, and no other message lets the host issue one — so the
webview cannot populate `DestinationDisposition.debris.authorization`. Tasks 1_1-1_5 are committed
and the host half is complete; 1_6 needs a new host-to-webview carrier, which is a `new-api-contract`
change needing its own D# rather than a fix inside this task.
Gate 2 re-earned at f28549b9 after the 1_6 handback: D6 adds the carrier, the delta gains the
"issued only when asked for" requirement, and 1_6 splits into the wire (1_6) and the dialog (1_7).
Auto-decision: a separate request rather than widening the probe answer — the probe fires on every
settled edit, so a token on it would mint deletes for paths nobody asked to delete (D6).

