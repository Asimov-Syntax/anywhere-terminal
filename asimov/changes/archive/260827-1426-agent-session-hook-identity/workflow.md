# Workflow State: agent-session-hook-identity

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(user chose "drop Codex" at the 3_2 handback; the artifacts encode that choice and nothing else)_

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(cycle 1: 3 rounds, then the user's bounded extension round; 10 findings accepted and fixed, 1 rebutted and sustained)_
- [x] Gate: implementation approved _(approved while 5_1 was still outstanding; it was walked after the gate, headlessly — see Notes)_
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — an agent-reported identity channel spanning pty env, two agent config files, the hook runtime and presence | flags: new-api-contract, security-privacy, infra, cross-boundary
3_2 handed back at implementation: Codex refuses an untrusted hook (`codex-rs/hooks/src/registry.rs` gates on `trusted_hash` unless `bypass_hook_trust`), so `~/.codex/hooks.json` alone installs nothing. D3 does not cover the trust grant.
Lint: `biome check src/` (check mode, never `--write`) leaves 3 format failures — CursorHookInstaller.test.ts, resolveClaudeSession.test.ts, agentIdentity.test.ts — all reproduced on a detached HEAD worktree and none touched by this change.
5_1 was walked against real OpenCode 1.18.22 headlessly, not through the extension UI: the generated plugin loaded by a real `opencode serve` reported the same id opencode's own API returned, `opencode.db` holds it as `session.id`, and `readOpenCodeEntry` resolves it. The one leg not walked is the extension host rendering that entry id into a row, which needs a running VS Code window; unit tests cover it.
Review cycle 1 hit the 3-round cap with 2 blockers open (B1 precedence, B8 revocation); the user chose the bounded extension round, and both were fixed under one stated hypothesis in 6_3. No reviewer has re-verified those two fixes — the chair closed cycle 1, so a further review would open cycle 2 in discovery.
Cursor is out of scope: orca extracts no session id from a cursor hook payload (`src/shared/agent-session-resume.ts` `case 'cursor': return null`), so there is no correspondence to copy, and a headless `cursor-agent` run fired no hook and wrote no chat directory at all.
