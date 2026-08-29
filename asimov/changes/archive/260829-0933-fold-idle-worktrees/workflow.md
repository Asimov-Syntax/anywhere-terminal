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
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-009.1
Lane: light — one concern (the idle tail), reuses the existing disclosure and persistence; flags: user-visible-ui
Planned at: b9467406

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

- Handback (review round 2, B3): reopened Gate 2. An ADDED clause cannot repeal an
  unmodified base requirement, and mine did — "the capping affordance SHALL report only
  what the cap excludes" against `A capped listing says it is capped` ("stating the full
  count"). Gate 2, tasks and verify unticked; the verify evidence was earned against the
  contradicting behaviour.
- Cap-clause fork settled toward the BASE requirement, not the delta: the double-
  description the ADDED clause exists to prevent is already fully carried by its other
  half ("the idle disclosure SHALL count only rows the cap admitted"). A total that
  happens to include idle rows is a count of the repository, not a claim about them, so
  the "reports only what the cap excludes" half was overreach — it bought nothing the
  clause did not already have and cost an accepted requirement plus `docs/design/
  worktree-panel-ui.md` § 8. Narrowing the delta and reverting the label.
- Notice reach is NOT planned here: it mints an invariant owner, so it is its own change
  and this one depends on it.
- Round-2 W6/W7 (notice reach) closed in `place-every-action-result`, archived at
  260829-0855. Nothing in 1_3 addressed them and nothing here claims to.
- W5 resolved by NOT rendering a disclosure that hides zero rows, rather than by making
  one non-interactive: `expandOrDescend` treats any row carrying `aria-expanded` as
  expandable, so an inert disclosure swallowed ArrowLeft before `parentOf` and could not
  be left at all.
- Verify gate: lint check mode, 17 findings, set-identical to the pre-change baseline.
- Cycle 2 (round-1 discovery at `0a597454`): WARN, 0 blockers. All three warnings accepted
  and fixed in task 1_4; no BLOCK was fixed or rebutted, so the cycle ends at re-verify
  rather than a re-review round. Triage in `.reviews/round-3.md`.
- Cycle-2 W1 was fixed at focus ARRIVAL rather than on the disclosure that carried the
  clause: the roving key was written only by the keyboard paths, so every row kind that
  re-renders on a pointer toggle had the same hole. One `focusin` delegate closes them all.
- The `toggleIdleTail` query guard is now unreachable from anything rendered — since W5 no
  disclosure is drawn under a filter, so no click arrives. Kept and documented as such: it
  and the reveal rule are the same rule, and the failure it prevents leaves no trace.
