# Workflow State: collapse-the-rail-after-a-sidebar-selection

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

Blueprint: docs/PLAN.md task WT-010.4
Lane: light (small) — LOW risk: one new webview behaviour, no new state, no protocol; no escalation
flag (`user-visible-ui` is a PLAN label, not one of triage's) | flags: none
Planned at: 95545535

- PREMISE, checked before planning: most of WT-010.4's acceptance is ALREADY SHIPPED. The
  "two columns at panel and editor, stacked at sidebar" composition is what `defaultPositionFor`
  (`FileTreeController.ts:70-78`) already returns — `right`, `left`, `bottom` — through the
  `file-tree--` position classes the layout has carried since before this epic. Reduced motion is
  already honoured by `runAuxCollapseAnimation` (`main.ts:196-199`), which the vault section's
  collapse already routes through. So this change builds the ONE thing that does not exist — the
  collapse on selection — and turns the rest into guarding tests rather than re-implementing it.
  That is why the change id names the behaviour and not the task.
- Auto-decision: a persisted position wins over the location default, unchanged. Forcing a side
  under the rollout would silently move a file tree the user docked themselves, and this design doc
  already settles the principle for the sibling case — § 2.2, "a persisted `vaultView` always wins —
  an explicit user choice is never overridden".
- Auto-decision: the automatic collapse passes `{ persist: false }`. `vaultCollapsed` is the user's
  own preference and the panel seeds from it on every open; writing it here would mean a user who
  once selected a worktree opens collapsed forever for a reason they never chose.
- Must-not: no new persisted key, no change to what `vaultCollapsed` means, no change to the
  position defaults, and nothing collapses while the rollout setting is off.

## HANDBACK — implementation evidence contradicts an accepted requirement

Raised while building 1_2, before the fix loop. Task 1_1 is built, verified and committed; 1_2 is
parked with its lease released.

**The chain.** Collapsing the vault section reports the worktree view invisible —
`syncWorktreeVisibility` in `VaultPanel.ts` emits `worktreeBodyEl !== null && view === "worktree" &&
!collapsed`. `WorktreeController.setVisible` posts `worktreeViewVisibility: false`, and
`WorktreeHost.ts:1590-1594` sets `state.visible = false`, then re-runs `reconcileShowing` and
`reconcileScan`. Pushes to that surface stop, so `onAttribution` stops firing and the presence half
of the tab bar's waiting evidence freezes at the moment of the collapse.

**What that contradicts.** `tab-bar-component` § "The count reads every source that can say a pane
is waiting" — *"Neither source alone SHALL be able to suppress the count"*, with the scenario
*"Only presence knows → the tab is counted"*. `TabBarUtils.ts:103-110` reads both halves:
`instance.activityStatus === "waiting"` stays live because it is surface-local, and
`waiting.has(paneId)` is the frozen half. A pane only presence knows about stops raising the count
while the rail is collapsed. It also contradicts this change's own new requirement, "Scope does not
depend on the layout".

**Why it is a handback and not a fix.** The collapse is exactly the state the user is in right
after every selection under this change, which is when the escape control matters most. Resolving it
is a design decision with more than one defensible answer, and each one moves an accepted contract:

- Keep reporting the view visible while it is collapsed only because a selection collapsed it —
  changes what `worktreeViewVisibility` means, and § 3.7's scan-cadence rule reads it.
- Have the host keep pushing to a surface that holds a scope even when the view is not visible —
  changes the push gate.
- Accept a frozen presence half while collapsed and weaken the tab-bar requirement — a scope cut,
  which fastlane never auto-chooses.

**Not introduced here.** A user could already collapse the section by hand and get the same freeze,
so the gap predates this change. What this change does is make it the routine path rather than an
occasional one. That is worth stating plainly at the gate: the honest options include fixing the
pre-existing gap as its own change and having this one depend on it.

## Handback resolved — option 2, narrowed

Taken under the standing instruction to decide rather than ask, after the user reaffirmed it.

Of the three options, 3 is a scope cut and 1 makes `worktreeViewVisibility` lie. Option 2 is
correct AND narrow, because the message never meant "pixels are on screen" — it means "this surface
still renders presence-derived UI". A surface holding a scope does exactly that: WT-010.1 requires
the escape control to be reachable while the panel is collapsed, and that control is drawn from
presence. Reporting invisible there was already wrong, which is why the pre-existing gap exists. So
this RESTORES `tab-bar-component` § "The count reads every source that can say a pane is waiting"
rather than weakening it, and the rule lives where the message is formed — the controller — not
split across `main.ts`.

Durable consequence for blueprint sync: `worktree-agent-presence.md` § 3.7's scan-cadence rule reads
this same visibility, so a surface holding a scope now also keeps the external scan alive. That is
the intended trade — a scope is a live filter whose badge depends on presence — and it is recorded
in the design doc rather than left as an emergent effect.

- HANDBACK, round-2 B4: this change owes "the same count is carried on it ... whether the rail is
  collapsed to its header strip" (its own spec, Requirement: Scope does not depend on the layout)
  and WT-010.4's "the escape control survives a collapsed rail". Task 1_2 implemented that by
  widening `worktreeViewVisibility` to mean "still draws from presence", and round 1 showed the
  widening also armed the 5s external scan and its uncapped per-row preview I/O (B1) and put the
  pendingCreate cleanup behind an early return (B2). `reconcileScan` reads the same value and
  presence has no separate channel, so there is no in-contract lever: telling a subscription apart
  from a drawn body is a new protocol concept and a new invariant owner. 1_2 is reverted here and
  re-earned by the dependency change below, which lands BEFORE this change archives.
- Depends on: separate-presence-subscription-from-view-visibility

- Review closed APPROVE at cycle 2 / round 3, after the dependency landed. Cycle 1's three rounds
  are in .reviews/round-1.md and round-2.md; cycle 1 closed as superseded when the fix moved to
  its own change, per the remediation boundary.
