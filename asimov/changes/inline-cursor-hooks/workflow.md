# Workflow State: inline-cursor-hooks

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

Blueprint: none
Lane: full (standard) — security hardening plus migration of a released user-owned config registration | flags: security-privacy, data-migration, re-review
Fastlane: user authorized plan → bounded oracle → fixes → build → up to three review rounds → approval/sync/archive without further prompts.
Scope split: this change is Cursor-only and independently mergeable; Claude and destination relocation are separate changes.
Validator warning accepted: the cursor-agent-status ownership delta intentionally replaces the shipped stable-wrapper identity with exact current-inline and released-platform candidates; this is the contract change, not an accidental contradiction.
Plan oracle: all five BLOCK and both WARN findings accepted. D1/D2 now validate full URL authority/path, neutralize exported functions and tracing, and narrow pre-command code execution explicitly; D3 adds event provenance; D4 clarifies failed observability; D5 fixes the result schema; D8 removes unsafe age-based lock reclaim; tasks add release disclosure and transition controls.
Fastlane Gate 2: approved after bounded oracle fixes; open questions: none. Left out by design: Claude support, unknown storage roots, and destination relocation.
Fastlane re-approval: task 2_2 now matches D4 — executable fail-open bytes survive a failed migration, while runtime observability remains revoked.
Fastlane re-approval: task 1_1 verifies the recorded command itself; final lint still runs at the Verify Gate after the owned Cursor test files are formatted. Main baseline had formatter errors only in those two owned test files.
Fastlane re-approval: task 3_1 RED proved closed stdout raises SIGPIPE before drain; D1 now ignores PIPE before neutral output, and task 3_1 owns the resulting source-literal update.
Fastlane re-approval: real Cursor grammar admission rejected shell pattern-removal expansion, not command length; D1 now uses the executed POSIX awk validator, and task 3_3 owns source/test convergence before the final real-agent spike.
Fastlane re-approval: the reproducible real-agent harness is `.mjs`, avoiding tsc rootDir inclusion while Bun still imports the TypeScript literal.
Fastlane re-approval: the real spike proved Cursor sources BASH_ENV before D1; the privacy spec now matches D2’s enforceable boundary—AnyWhere Terminal-controlled execution after command entry—while loopback/proxy/curl obligations remain absolute.
