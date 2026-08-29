# Workflow State: restore-view-affordances

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light (small) — three verified webview findings, one domain, no protocol change | flags: none
Planned at: 1f3abc7d

- Source: `docs/audit/2026-08-29-worktree-ui-vs-orca.md` § A1, § E1, § E2.
- Gate 1 (user): delegated tooltip over per-element attach; all three findings in one change; vault session list in scope.
- Reuse: the tooltip widget already exists (`src/webview/ui/Tooltip.ts` + `ui/tooltip.css`, used by file-tree, vault header, preview header). This change adds one delegated export to it; a second tooltip system is the failure mode to avoid. Event delegation via `closest()` is already an idiom here (`main.ts`, `FloatingWindow.ts`, `HoverPreviewPopup.ts`).
- jsdom cannot prove § A1: it reports `display: none` for a `hidden` element whether or not the `[hidden]` reset exists, so no computed-style assertion can go red. The tripwire is a source-level assertion over the generated HTML, matching the project's existing `gate:fs-deletion` shape.
- Out of scope: the spinner ceiling (audit § E3), the worktree-first redesign (§ F), and the duplicate-session-row question (§ B6 — dropped by the user).
