# Workflow State: offer-create-where-intent-arrives

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
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

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-009.4
Lane: light
Planned at: 0bb67ab9
- Fastlane: no fork. § 3.2.2 and § 3.1 settle every placement rule; nothing was left for planning to choose.
- The toolbar "+" is NOT shipped, contrary to the PLAN task's "alongside the existing toolbar button". `VaultPanel.ts:444` builds it only when `deps.onCreateWorktree` is supplied and `main.ts` supplies nothing, so the control the applied requirement "A control is offered only in the body it acts on" describes has never been constructed. Wiring it is repair of an applied requirement, not new scope, and it is what makes "four entry points" true rather than three.
- Audit § A1 (an author `display` rule defeating `[hidden]`, which would have leaked this button into the sessions body) is already closed by the archived `restore-view-affordances`; `webviewHtml.ts:110` carries the reset. So this change inherits a working hide and adds no CSS for it.
- "No worktrees yet" and "one worktree so far" are one state, not two — but not for the reason I first wrote. A repository does NOT always hold its main checkout: `listRepoWorktrees` returns zero worktrees with a degraded reason when the listing fails (`WorktreeDiscovery.ts:118-125`), and `renderRepo` draws that repository with no rows. Zero worktrees is therefore reachable and is a degraded repository, not an unbranched one. One CTA state is built, recognised from source evidence rather than from what got drawn.
- Orca was not re-researched: `docs/audit/2026-08-29-worktree-ui-vs-orca.md` § D3 already carries the comparison this change needs (Orca uses the same top-right "+"), and its four placements are what the blueprint adopted.
- Must not: no second create request construction site, no new wire message, no change to the create form itself.
- Oracle round: 7 findings, all verified against source and all accepted; 4 contradicted the plan. The unscoped toolbar open would have opened nothing on a cold panel (the request carries a repoId, `createRepos()` lists only answered repositories, `openCreateDialog` returns on an empty seed, and the picker is built once from the opening seed). A toolbar control with no repository would have been inert where the applied spec requires absent. A focusable header child breaks `onKeyDown`, which indexes `document.activeElement` into the row list and gets -1. And `bindActivation` binds a bubbling click on the header, so one gesture would create and collapse.
- The applied requirement "A control is offered only in the body it acts on" carries a truncated scenario line — "and the create-worktree control is" — which is why nothing caught that the control was never constructed. Completed in this change's MODIFIED block.
- Keyboard reach for a row-level action is a mechanism fork, auto-chosen under fastlane: the control joins the tab order only while its own row holds focus, which keeps the tree's single tab-stop entry and matches the roving model already in `WorktreeView`. It changes externally verifiable keyboard behaviour, so it is a MODIFIED delta on the traversal requirement rather than a task-local decision.
- Two validator warnings left standing: both name a MODIFIED requirement whose length is mostly inherited applied text. Splitting them would rewrite contracts this change does not own; each of my added paragraphs is two sentences.
- 1_1: the spec scenario "with none preselected on the user's behalf" was withdrawn during build — it is not externally verifiable. `WorktreeCreateDialog` resolves `deps.initialRepoId ?? first.repoId`, so a form always opens on some repository; a controller that named the first one and one that let the dialog fall back to it are indistinguishable from outside. A mutation of exactly that survived, which is how it surfaced. The observable claim — an unscoped door offers every repository and narrows nothing — is kept.
