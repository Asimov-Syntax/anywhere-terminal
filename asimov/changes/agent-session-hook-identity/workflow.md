# Workflow State: agent-session-hook-identity

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(user chose "drop Codex" at the 3_2 handback; the artifacts encode that choice and nothing else)_

## Implement

- [ ] All tasks done (`tasks.md`) _(5_1 is a `manual` Verify only the user can run)_
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
Lane: full (standard) — an agent-reported identity channel spanning pty env, two agent config files, the hook runtime and presence | flags: new-api-contract, security-privacy, infra, cross-boundary
3_2 handed back at implementation: Codex refuses an untrusted hook (`codex-rs/hooks/src/registry.rs` gates on `trusted_hash` unless `bypass_hook_trust`), so `~/.codex/hooks.json` alone installs nothing. D3 does not cover the trust grant.
Verify gate left unticked: 5_1's `manual` Verify needs a live OpenCode run the CLI cannot make. Type check and the full unit suite were observed passing (4401 tests); `biome check src/` (check mode, never `--write`) leaves 4 format failures — CursorHookController.test.ts, CursorHookInstaller.test.ts, resolveClaudeSession.test.ts, agentIdentity.test.ts — all reproduced on a detached HEAD worktree and none touched by this change.
Cursor is out of scope: orca extracts no session id from a cursor hook payload (`src/shared/agent-session-resume.ts` `case 'cursor': return null`), so there is no correspondence to copy, and a headless `cursor-agent` run fired no hook and wrote no chat directory at all.
