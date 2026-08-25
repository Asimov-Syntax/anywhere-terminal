# Workflow State: separate-detail-completeness-signals

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [ ] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (small) — user-visible preview affordance; MEDIUM risk on a flag every provider's pagination reads | flags: none
Direction (no fork): route source truncation through the existing `finalizeDetail`, keep the pageable flag from the limit comparison — the shape Claude and Codex already use.
Spec finding: the existing `Bounded detail retains both transcript ends` requirement itself mandated `truncated: true` for source-window truncation, so the delta MODIFIES it — two ADDED requirements alone would have left the spec self-contradicting.
Warning rejected: that requirement's 866-char length is inherited text; MODIFIED replaces whole blocks and splitting the head+tail contract is out of scope for a bug fix.
E2E is N/A in project.md — no box for it.
Review: 3 rounds run, loop exhausted; all round-3 findings then fixed and re-verified. User declined a 4th round.
Review (was): Rounds 1-2 findings all fixed; round 3 leaves 2 BLOCK + 1 SUGGEST open, triaged and accepted in .reviews/round-3.md. Verify Gate is green but the change is NOT approvable as it stands.
Sequencing: must land BEFORE `unify-vault-detail-contract`, which rewrites these same expressions; that change is holding.
