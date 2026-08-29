# Workflow State: add-last-activity-preview-to-agent-rows

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

Blueprint: docs/PLAN.md task WT-009.2
Lane: light (small) — six files in one domain, no new state, no protocol, LOW risk | flags: none

- Gate 1 was a real fork and was NOT auto-chosen. Discovery contradicted the blueprint: `WorktreeAgentRow` declares `preview` and `worktreeTreeView.ts` already renders it, but `presenceProjector.ts` populates it on no row, and `vaultListView.ts` renders no preview line either — so both premises in the PLAN task's Notes were wrong. Sourcing the content means carrying transcript text past what `agent-session-index` permits, which is a product-scope and privacy decision fastlane may not take. The user chose the split: this change ships the layout, and the source became WT-009.5.
- Orca was not researched again: `docs/audit/2026-08-29-worktree-ui-vs-orca.md` § B3 already owns the comparison this task came from.
- `model` stays declared on `WorktreeAgentRow` and only leaves the row and the signature. The projector never set it either, so the chip was already unreachable; the inspector (WT-010.5) is its stated home, and that task has to put `model` back into the signature when it actually renders it.
- Oracle review: 7 findings, all accepted, all applied before Gate 2. The load-bearing three: an explicit `grid-template-rows: auto auto` would still reserve the 5px row gap on a preview-less row, so the second row is created implicitly by the preview itself; the preview is placed from the title column rather than `1 / -1`, which would sit it under the glyphs; and "the preview truncates before the title" stopped being enforceable the moment the two occupied different rows — the spec and the PLAN acceptance now say the two lines ellipsize independently instead. It also caught that `renderAgentRow` has a second caller in `WorktreeRemoveDialog`, and that 1_1/1_2 as originally split produced no independently reviewable state.
- 1_2 is a `manual` Verify I cannot run — it needs the panel open in VS Code at two widths, and the
  project has no harness that lays CSS out (jsdom measures nothing; `@vscode/test-electron` cannot
  reach inside the webview iframe). It stays `[ ]`, the Verify Gate stays unticked, and its steps go
  to the user in the Approval block.
- Lint: `biome check src --max-diagnostics=200` reports 10 files. One is a file this change touches —
  `worktreePanel.css` `lint/style/noDescendingSpecificity` at `.wt-hist-label` — and it reproduces
  identically on a clean worktree at HEAD~1, in selectors this change does not go near.
- Review round 1 (cycle 1, discovery): WARN — 0 blocking, 1 warning, 4 suggestions, all five accepted.
  S2/S3/S4 fixed as task 1_3. S1 (search matches the raw preview) was decided as-is and left raw:
  raw is a superset, so search can never miss displayed text, and binding it to `stripDecorations`
  now would fix in place the very transform W1 questions.
- W1's fix is owed by WT-009.5, not by this change: `stripDecorations` strips a leading `- ` or `* `,
  which is content in a prose preview, but the same helper governs `row.title` and the host strips the
  same frames (worktree-agent-presence § 3.4) — narrowing it here would move an accepted contract this
  change does not own. Unreachable today, since the projector sets `preview` on no row. Blueprint sync
  must carry this obligation into WT-009.5's PLAN Notes, with the `"* item"` / `"- item"` cases named.

Planned at: cdfa932e
