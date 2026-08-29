# Workflow State: fold-idle-worktrees

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
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: b22eb683

Blueprint: docs/PLAN.md task WT-009.1
Lane: light — one concern (the idle tail), reuses the existing disclosure and persistence; flags: user-visible-ui
Planned at: b22eb683

- Fastlane: no fork. docs/design/worktree-panel-ui.md § 3.6 settles the threshold, the treatment, the ordering, the counting rule and the search behaviour; nothing was left open for planning to choose.
- Idleness is a POSITIVE determination — no rows, presence loaded, no source degraded — not `rows.length === 0`. The blueprint names this as the task's trap: absence of evidence would fold away precisely the worktrees the degradation marker exists to surface.
- The fold is keyed per repository and namespaced so it cannot collide with a repo or worktree id. `pruneStaleState` rebuilds that set from live ids, so an unrecognised key is dropped every push — the key has to be carried there or persistence silently fails.
- Oracle blocker, accepted: one collapse key cannot carry both defaults. A restored `worktreeCollapsed` array already treats every absent key as EXPANDED, so an existing user would have met this feature unfolded — invisible to exactly the heavy-worktree users it is for. Taking a persisted seeded-marker rather than accepting that, because the design's threshold rule is only meaningful if the default actually reaches them.
- Oracle: cap and fold are resolved filter → partition → cap → fold. Without an order the cap's "Show all" affordance would appear twice and describe rows the fold owns.
- Oracle: the disclosure is a new row kind. `navRows` matches on class and derives depth from it, so reusing `.wt-repo` would give it the wrong depth and route its toggle through a repo id it does not have.
- Oracle confirmed and I accepted: folding a row out of the DOM does NOT regress the confidence-ceiling scheduler from the previous change. A folded worktree is agentless by construction, so it holds no claim that could cross; gaining an agent requires a push, which moves it out of the tail.
- Oracle confirmed the idleness predicate is right for the current model: `PresenceDegradation` carries no repo or worktree attribution, so anything narrower would invent it.
- Merged 1_1 and 1_2 into one task on the oracle's advice: they shared every file, and correctness depends on ordering, cap, fold, search, persistence and keyboard behaving together rather than on an intermediate state that gets reworked.
- A filter reveals the tail at RENDER time only, never by writing the fold open: the spec requires clearing the filter to return the tail to the user's own choice.
- Must not: no filter state, no popover, no "hide sleeping" toggle. § 7.5 keeps that deferred and this task is the 80% that pays for itself without it.

- Verify gate: lint runs in check mode; 17 findings, byte-identical to the same run on a detached worktree at HEAD before this change. Zero introduced.
