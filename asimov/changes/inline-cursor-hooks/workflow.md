# Workflow State: inline-cursor-hooks

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — security hardening plus migration of a released user-owned config registration | flags: security-privacy, data-migration, re-review
Fastlane: user authorized plan → bounded oracle → fixes → build → up to three review rounds → approval/sync/archive without further prompts.
Scope split: this change is Cursor-only and independently mergeable; Claude and destination relocation are separate changes.
Validator warning accepted: the cursor-agent-status ownership delta intentionally replaces the shipped stable-wrapper identity with exact current-inline and released-platform candidates; this is the contract change, not an accidental contradiction.
Plan oracle: all five BLOCK and both WARN findings accepted. D1/D2 now validate full URL authority/path, neutralize exported functions and tracing, and narrow pre-command code execution explicitly; D3 adds event provenance; D4 clarifies failed observability; D5 fixes the result schema; D8 removes unsafe age-based lock reclaim; tasks add release disclosure and transition controls.
Fastlane Gate 2: approved after bounded oracle fixes; open questions: none. Left out by design: Claude support, unknown storage roots, and destination relocation.
Fastlane re-approval: task 2_2 now matches D4 — executable fail-open bytes survive a failed migration, while runtime observability remains revoked.
