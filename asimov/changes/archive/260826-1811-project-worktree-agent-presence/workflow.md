# Workflow State: project-worktree-agent-presence

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
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-004.1
Lane: full (standard) — window-scoped projection spanning host, shared bundle and webview | flags: cross-boundary

Review: cycle 1, 3 rounds (the user's cap), then ONE bounded extension round at the thrash stop —
round 3 ended with a blocker, no accepted artifact was contradicted, and B1 was a three-line
correctness fix, so neither a handback nor a risk-accept applied. Task 4_3's three fixes carry gate
and per-fix mutation evidence but no chair review; that is stated in .reviews/round-3.md rather than
left to be assumed.

Blueprint sync: worktree-agent-presence.md § 6 corrected per D7 (a spinner-only title feeds neither
identity nor activity in the host), and § 3.3 gained the shell-title row plus the rule that
`activitySource` names the rule that decided rather than the state it landed in (D6, round-1 W2).

Auto-decisions (fastlane):
- Identity rank 3 (`process`) has no source in-repo and is skipped, not faked — recorded in design.md D4.
- The registry read behind identity rank 2 stays untyped here; its typed outcome belongs to WT-004.2 (design.md D10).
- Activity source follows `worktree-agent-presence.md` § 3.3 verbatim (`output` for every window-pane state), with design.md D6's single exception: a shell-name title that forced `idle` reports `title`. Semantic hook evidence is not promoted to `activitySource: "hook"` here — the blueprint lumps it under `output` and WT-004.1 does not reopen that.
- Presence declines `resolveClaudeSession`'s step 3 (`newestSessionUnderCwd`): the newest transcript recorded under a directory proves an agent ran there once, not that one is in this pane now, so it is bound to `null` in `presenceDeps.ts`.
- `PresenceProjectorDeps.normalize` is `path.resolve` only. `isPathInside` owns separator and drive-letter folding; a realpath would have to be async, so a pane whose shell reports a symlinked cwd where git reported the physical path is not attributed.
- design.md D7 deliberately departs from `worktree-agent-presence.md` § 6's "a spinner feeds activity": the host receives decoration-stripped titles, so it cannot tell an animating spinner from a frozen one. Correct § 6 at sync time.

Orca reference (/Users/huybuidac/Projects/ai-oss/orca), read 2026-08-26:
- `src/shared/agent-name-token-match.ts` confirms design.md D5's boundary regex verbatim, and records the real misfires: `opencode-blinker` ⊃ `opencode`, `openclaude` ⊃ `claude`.
- Same file carries a lesson D5 currently contradicts: the TITLE-detection name list is deliberately NARROWER than the launchable-agent list, because a short common word ("amp", and for us "cursor") classifies ordinary shell titles as agent activity. Rank 1 tests a binary basename and may read `VAULT_AGENT_IDS`; rank 4 needs its own curated list. Fold into D5 / tasks 1_1 and 2_2 at triage.
- `src/shared/agent-title-status.ts` `clearWorkingIndicators` exists because stale exit titles kept reporting working — independent corroboration of design.md D7's refusal to derive `running` from a decoration-only title.

Self-review of D4/D5 plumbing (read-only, 2026-08-26) — apply at triage:
- MISSED REUSE: `agentKindForExecutable` (src/vault/registry.ts) already IS identity rank 1 — basename normalization, `.exe/.cmd/.bat/.ps1` stripping, and cursor's `agent`/`cursor-agent` aliases, returning a `VaultAgentId`. Four call sites already gate it on `session.isAgentLaunch`. Task 2_2 must reuse it, not reimplement it. It imports `node:child_process`, so it is host-only — which is fine, rank 1 is host-only.
- Consequence for D5: the shared module narrows to what the WEBVIEW also needs — `isShellName` for the tab's shell-title rule, plus the curated title-name matcher. Rank 1 does not go through it.
- `SessionManager.respawnFallbackShell` clears `isAgentLaunch` (SessionManager.ts:742) when the agent exits and a shell takes the pane, so rank 1 stops claiming on its own. No extra guard needed; state it in D4 so nobody adds one.
