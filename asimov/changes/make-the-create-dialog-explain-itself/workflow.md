# Workflow State: make-the-create-dialog-explain-itself

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

Blueprint: none
Lane: full (standard) — one dialog, but process-launch and destructive-action defaults make misleading fallback medium risk | flags: none
Planned at: 2d6a8436
Follow-up: `suggest-worktree-initialization` — bounded repository-root `.env`/lockfile suggestions, host-held opt-in offers, and setup-before-agent recommendation; mechanically split because it adds an evidence/authority owner rather than dialog language alone.
Fastlane decision: the save control is `Save current choices as defaults`, not `Choose files & setup…`; inspection showed it writes immediately and opens no chooser, so an ellipsis or configuration verb would preserve the original ambiguity.


Blueprint: none
Lane: full
Planned at: 2d6a8436
Oracle attack: accepted all material findings. No-axis agents are UNKNOWN rather than safe; save wording covers source + files; repo switches select an explicit-safe agent without reordering; disabled reasons distinguish selection checks from destination state and use a live region; the footer stays visible in short viewports. The spec delta MODIFIES the standing agent-block and save scenarios rather than appending contradictions.
Oracle ledger: dangerous-default row refuted before triage and supported after the explicit-safe-only amendment; destructive-clearance and shared-gate rows supported, with the entry-list requirement narrowed to before Create becomes available.
