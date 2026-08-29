# Workflow State: source-the-agent-row-preview

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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

Blueprint: docs/PLAN.md task WT-009.5
Lane: full (standard) — MEDIUM risk: a passively-refreshed row gains transcript-derived text, so the
cost is per-row-per-scan and the exposure is what a list may hold | flags: user-visible-ui, security-privacy
Planned at: 1a907750

- No Gate 1 fork. The one real fork — what a passive row may carry — was decided by the user before
  planning (option A, in the PLAN task's Notes) and is not reopened here.
- The spec reading the PLAN task assumed is confirmed against the file: the
  `SHALL NOT read message bodies beyond the first preview line` clause lives inside the INDEX
  requirement, while sibling requirements in the same spec authorize the detail path to read full
  transcripts (teammate turns collect across "the FULL streamed transcript", plus workflow sub-agent
  transcripts and per-turn segments). So option A widens one requirement, not the file's posture.
- Orca was not researched: this change is about this extension's own transcript readers and presence
  projection, and the seams it builds on are all in-repo.
- Reuse taken rather than invented: the `(mtimeMs, size)` freshness gate is the vault list path's own
  (`claudeReader.ts:373-440`, `storeStamp.ts:13-41`), and the per-row pass is `titleFromVault`'s shape,
  beside which the new dep sits — but not its ownership: the stamp and cache live in the service (D2).
- Rejected: reading `latestMessage` from `detail.ts`. It is the obvious reuse and it streams the whole
  transcript to build a 400-item timeline for one line — recorded in design.md D1 rather than left as
  a road not taken.
- Fastlane auto-decisions: oracle findings 3, 4, 6, 7 accepted and applied (single-owner preview
  service split out as its own task 1_2; coverage limited to file-backed sources and stated; 1_2
  verified against a real temporary file because a mocked dep cannot prove a file was not opened;
  1_4's file list widened to the two suites whose fixtures assume a stripped preview).
- Verify gate: type check, biome check src, 5109 unit tests and the I10 fs-deletion gate all pass. Lint
  is at its pre-existing baseline (5 errors / 14 warnings / 3 infos, identical to the 1a907750 clean
  tree) — every one in files this change does not touch.
- Residual validator warning triaged, not fixed: `agent-session-index` § "Metadata-only, bounded title
  preview, no egress" is long because it was already fused upstream (metadata + preview + truncation +
  cache/egress). Splitting it restructures an accepted requirement this change does not own; the added
  clause is one MAY.
