# Workflow State: install-claude-hooks-v1

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
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-006.2`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes
Fastlane amendment Gate 2: approved — reuse the reviewed inline Cursor branch; remediate Claude identity/diagnostics, location sequencing, and admission tests without expanding product scope.
User directed round-1 Cursor remediation to merge `huybuidac/inline-cursor-hooks`; D2/task 5_3 reuse that reviewed branch and prohibit duplicate bridge rework.
Round 1 REJECT accepted all six blockers, two warnings, and two suggestions. B4-B6 invalidate D2 exact-byte restoration, so cycle 1 is superseded and Gate 2 reopens for the safety-delta amendment before remediation.
- 2026-08-28: User waived resource-contention-only full-suite timeouts; tasks use focused tests, and the full suite runs only at the final gate with one Vitest worker.

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-006.2
Lane: full (standard) — security-sensitive user-config writer replacement plus real CLI boundary | flags: security-privacy, re-review

Fastlane: user chose Claude v1 before Cursor forward-port after full-suite evidence proved WT-006.3 depends on Claude registration.
Scope correction: ce2e8010 runtime/controller and both agent decoders remain; only rejected durable installer ownership is replaced.
Plan oracle: four BLOCK, two WARN, and one SUGGEST accepted; canonical-group ownership conflicts, encoded session grammar, serialized authority, pre-entry tracing boundary, isolated real-CLI settings, Cursor bridge integration, and explicit absence gates now own the corrections.
Fastlane Gate 2: approved after oracle recheck returned APPROVE with no remaining blocker; open questions: none.
