# Workflow State: state-what-the-worktree-will-lack

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
Lane: full
Planned at: eae86109

Blueprint: docs/PLAN.md task WT-012.1
Lane: full (M) — first slice of the provider layer; the model and its provenance rule are what every later Phase 12 task consumes | flags: new-api-contract, user-visible-ui
Direction (fastlane, no fork): one adapter as one function, no registry — WT-012.3 adds three more and WT-012.4 owns the merge, and that is the task that learns what the seam needs.
Planned at: eae86109
Dependency: `yaml` (eemeli/yaml 2.9.0) enters `dependencies` as its second entry. Verified against the registry before planning on it; `parse` is data-only, unlike js-yaml's unsafe load. design.md D1 records why a hand-rolled subset reader was rejected.
Blueprint edit pending approval: design.md D7 makes `ProvisionPort.port` optional, which contradicts `worktree-provisioning.md` § 2's required `number`. Port allocation is WT-012.6, two tasks downstream, so the field cannot be filled here. Syncs back to § 2 on approval.
Scope note: this repository's own `asimov/worktree.yaml` declares no `ports:`, so the port row is exercised by a fixture rather than by the real file.
Constraint carried into 1_4: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are read-only for this change. A design pass owns them, and `main` carries an unmerged second pass (48fe43ce) conflicting with this branch's (a42de0a0).
Deviation (1_1): the Plan said `ProvisionItemId` was already landed by WT-012.0. Only `ProvisionSelection` was — WT-012.0's own Plan named the id type but its task declared the selection alone. Added here with the rest of the model. `worktreeProvisionOffer` is NOT added to `WORKTREE_MESSAGE_TYPES`: that list enumerates what the webview sends, and this travels the other way.

Deviation (1_4): D6's summary says rows render checked "matching the mockups", but the mockup on this branch draws Run setup UNCHECKED and annotates why, and the same D6 paragraph cites § 7's rule that a setup command is off unless the user leaves it on. Setup rows render unchecked; copy, link and port rows render checked. Nothing reads the checked state in this change.
Deviation (1_4): the Plan said to take class names from `docs/ui/worktree-create-dialog.css`. That file is a mockup asset no shipped module loads — the panel's stylesheet is `src/webview/worktree/worktreePanel.css` and its whole idiom is `wt-`-prefixed. The mockup's structure and proportions were carried over; the `cw-` names were not. Neither `docs/ui` file was touched.
Deviation (1_4): the offer is held in its own per-repo map rather than folded into `WorktreeCreateDefaultsMessage` — the host issues one offer per form and answers the destination per keystroke, so a folded offer would be dropped by the second answer.
Deviation (1_5): the Plan said problem rows offer to open the file. No affordance was added — the only open-a-file message this webview has (`openFile`) resolves its path against a terminal session's cwd, and there is no session here. The spec requires the file be NAMED, which it is; an inert button is worse than none. A real open is a new wire message and belongs to whichever task earns it.
Verify gate: biome reports 3 pre-existing format errors and the baseline 14 warnings. All three — `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, `src/cursor/CursorHookInstaller.test.ts` — reproduce on a clean detached worktree at the change base (eae86109) and are untouched by this change's diff. Biome 2.4.5.
