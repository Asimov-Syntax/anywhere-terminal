# Review Round 1 — add-last-activity-preview-to-agent-rows

| Field | Value |
|---|---|
| Date | 2026-08-29 |
| Cycle | 1 |
| Mode | discovery |
| Scope | range `cdfa932e..HEAD` |
| Head | `692543d5a6f135f941474c02a21185236f36a51a` |
| Tree state | dirty outside the reviewed range (`docs/PLAN.md`, `asimov/changes/active`) — not reviewed |
| Reviewable lines | ~104 (worktreeTreeView.ts 50, worktreePanel.css 51, worktreeRenderSignature.ts 3) |
| Agents spawned | asm-review-frontend (`gpt-5.6-terra[1m]`), asm-review-contracts (`sonnet[1m]`), asm-review-logic (`gpt-5.6-luna[1m]`) |
| Agents skipped | data-security (no data/auth/persistence surface), performance (no growth axis; render path is a full `replaceChildren` rebuild already gated by the signature), reuse (no new helper — the change removes code and reuses the existing `stripDecorations`) |
| Verdict | WARN |
| Counts | BLOCK 0 · WARN 1 · SUGGEST 4 |
| Split | 0 gating blockers — n/a |

## Verified claims

Every load-bearing claim in the author's handoff was checked rather than accepted.

1. **Selection by exclusion is sound.** `renderAgentRow` (`worktreeTreeView.ts:468`) is the only constructor of `.wt-arow` in `src/`. Its direct children are exactly the seven first-line spans plus the conditional `.wt-apreview`. Both production callers — `WorktreeView.ts:1223` and `WorktreeRemoveDialog.ts:266` — append the returned element and never inject children (the dialog only sets inline `paddingLeft`/`paddingRight`). The subagent section is a **sibling**, not a child (`WorktreeView.ts:1241`). So `.wt-arow > *:not(.wt-apreview) { grid-row: 1 }` can never sweep up a stray element. Confirmed independently by chair and asm-review-frontend.
2. **The implicit second row genuinely costs nothing.** Per CSS Grid, an implicit track is created only when an item is placed in it, and a gap exists only between two existing tracks. With no `.wt-apreview` child there is no row 2 and no `row-gap`. No rule anywhere sets `height`/`min-height` on `.wt-arow` or an ancestor. Placement is also unambiguous: the seven first-line items have a definite row and auto column, so grid step 2 lays them into columns 1–7 in DOM order; the preview has a definite row *and* column and is placed in step 1. `grid-column: 4 / -1` resolves against the 7 explicit columns, so `-1` is line 8.
3. **Single stripped local, three consumers.** `previewText` (`worktreeTreeView.ts:567`) feeds the span's `textContent`, the span's `dataset.tip`, and `el.dataset.tip`. The span is appended only when it is non-empty, so a decoration-only or whitespace-only preview produces no element. `stripDecorations` returns `""` for `undefined` (`worktreeFormat.ts:33`), so the `?? ""` that was dropped is not needed.
4. **The second caller holds.** `WorktreeRemoveDialog.ts:266` was not edited; no `.wt-arow`/`.wt-apreview` rule exists outside `worktreePanel.css`, so the dialog inherits the new grid without a competing override. `WorktreeRemoveDialog.test.ts:193` covers it.
5. **Dropping `r.model` from the signature is safe.** No renderer in `src/` reads `row.model` after the chip's removal, so it cannot change what is on screen without another signatured field moving. `NOT_RENDERED` in `worktreeRenderSignature.test.ts:195` still forces an explicit signatured-or-excused decision per field, and the excuse names WT-010.5 as the owner that must re-key it.
6. **`stripDecorations(r.preview)` in the signature is not a missed-repaint hazard.** The key and the paint run through the *identical* transform, so two previews that collapse to one signature also render identically. (Its content-loss side is finding W1 — a different concern.)
7. **Deleting the 380px breakpoint introduces no layout regression.** It was the only `@container vault` rule in `worktreePanel.css` (the rest use `vaultbar`). Removing the model chip also *reduced* first-line auto-track pressure at narrow widths, so the first line is less crowded than before, not more.
8. **No height assumption anywhere.** No virtualization, `offsetHeight`, `getBoundingClientRect`, scroll math, sticky-header sizing, or drag-drop insertion geometry in the Worktree webview. `WorktreeView.ts:834` calls `replaceChildren()` before every rebuild, so a row that gains or loses a preview cannot leave a stale span.
9. **Navigation is class-based, not positional.** `WorktreeView.ts:1443` enumerates rows via `querySelectorAll(NAV_ROWS)`; the extra child does not touch the roving tabindex or arrow traversal. No positional child reads (`children[n]`, `nth-child`, sibling walks) of `.wt-arow` exist in `src/`.
10. **Accessible order is unharmed.** DOM order (gutter → age → preview) matches visual reading order (line 1 left-to-right, then line 2), so the `treeitem`'s accessible name reads in the order the row is seen.

## Full-flow trace (discovery, mandatory)

Presence push → `WorktreeView.setData` → `worktreeSignature` guard → `replaceChildren()` full rebuild → `renderAgentRow` → DOM + `dataset.tip`; degradation path via `presentedActivity`. Second entry mode: `WorktreeRemoveDialog` renders the same row inside a fixed-position dialog. No IPC, persistence, identity, cache, or error path is touched by this change. Nothing surfaced in the trace beyond the findings below.

## Findings

### [W1] A title-shaped decoration stripper is applied to a prose-shaped field

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-logic (corroborated by chair)
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:567` (and `worktreeRenderSignature.ts:92`), via `src/webview/worktree/worktreeFormat.ts:23-37`
- **Evidence**: `GLYPH_FRAMES = /^[⠋⠙…✻✽✢✶✳*\s]+/` includes a bare `*`, and `ASCII_FRAME = /^[|/\\-]\s+/` matches a leading `- `. Both are anchored to the string start and the result is `.trim()`ed. Applied to a preview, `"* npm test"` renders as `"npm test"` and `"- npm test"` renders as `"npm test"`; a preview that is only such characters yields `""` and therefore no span at all. The helper's own doc comment scopes it to "decorative animation frames agents print **in front of a pane title**", and its `ASCII_FRAME` comment shows the character class was tuned against *title* inputs (a path starting `/Users/…`), not transcript prose.
- **Impact**: The row's most useful line can silently drop leading content, or vanish entirely, when the preview's first characters are a bullet rather than a spinner. Latent today — `presenceProjector.ts` populates `preview` on no row — but WT-009.5 sources that content from transcript text and tool output, where a leading `- ` or `* ` is an ordinary line, not decoration.
- **Fix**: Settle this in WT-009.5, which owns the input distribution. Either narrow the preview's stripper to unambiguous spinner frames (drop bare `*` and the `- ` alternation for this field), or have the source strip at read time where provenance is known and hand the view text that needs no stripping. Add cases for `"* item"` and `"- item"` when you do.
- **Status**: accepted · **Triage**: The evidence holds — `"* item"` and `"- item"` both strip to `"item"`, and `"* "` strips to `""` and draws no line. The fix is NOT taken here: `stripDecorations` also governs `row.title` (`agentRowTitle`) and the host strips the same frames (`worktree-agent-presence` § 3.4), so narrowing the pattern changes title rendering under an accepted contract this change does not own — remediation would mint a decision outside its spec delta. It is also unreachable today: `presenceProjector.ts` populates `preview` on no row. Assigned to WT-009.5, which sources the content and is the only task that can size the pattern against the real input distribution; recorded as an obligation in its PLAN Notes, with the `"* item"` / `"- item"` cases named.

### [S1] Search matches the raw preview while the row draws the stripped one

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:786`
- **Evidence**: `matches()` tests `(row.preview ?? "").toLowerCase().includes(q)` — raw. In the same predicate the title is matched through `agentRowTitle(row)`, which is `stripDecorations(row.title) || "(untitled)"` (`worktreeFormat.ts:326`). Before this change the row *displayed* the raw preview too, so search and display agreed; after it, the preview is the only field in the predicate matched against text the row no longer shows.
- **Impact**: Low and one-directional — raw is a superset of stripped, so search can never miss visible text, only produce a hit on a decoration prefix (or on a bullet that W1 ate) that the row does not display. No accepted requirement covers search matching, which is why this is a suggestion rather than a defect.
- **Fix**: Match `stripDecorations(row.preview)` for symmetry with the title, or leave it and note the asymmetry — but decide it deliberately rather than by omission.
- **Status**: accepted, decided as-is · **Triage**: Decided rather than inherited, as asked. `matches()` keeps the RAW preview. Raw is a superset, so search can never miss text the row displays; the only cost is a hit on a prefix that is not drawn. Coupling search to `stripDecorations` now would bake in the exact transform W1 puts in question, and W1's resolution in WT-009.5 may narrow or relocate it — at which point the asymmetry largely disappears on its own. Revisit with W1, not before.

### [S2] The `row-gap` comment names a value the declaration contradicts

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/worktreePanel.css:389-391`
- **Evidence**: `/* Separate from the column gap: 5px of vertical air between the two lines is tighter than the horizontal rhythm, and one `gap` cannot say both. */` sits directly above `row-gap: 1px;`, with `column-gap: 5px;` directly above it. The sentence names 5px as the *vertical* air and then claims it is tighter than the horizontal rhythm, which is also 5px. The intended statement is the opposite: 5px of vertical air would be too loose, so the row gap is 1px.
- **Impact**: The rationale comments in this file are the design record for a layout that has no browser harness to verify it — a comment naming the wrong number is the kind of thing a later reader trusts over the declaration. Not formatting: the sentence is factually wrong about the code beneath it.
- **Fix**: Reword to say the vertical rhythm is deliberately tighter than the 5px horizontal one, hence `1px`.
- **Status**: accepted · **Triage**: Correct and mine — the comment was written against a 5px row gap and the declaration went to 1px. Comment rewritten to state the value it sits above and why the two gaps differ.

### [S3] Slot numbering in `renderAgentRow` no longer matches the row it describes

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:545, 570, 578, 584`
- **Evidence**: The numbered comments now run `5 — external-scope chip`, `7 — collapsed child count`, `8 — age`, `9 — the second line`. Slot 6 left with the model chip and the sequence was not re-based, so the numbers no longer index the seven grid columns the function's own header comment and the CSS both now declare (scope is column 5, count 6, age 7 — and the preview is not a first-line slot at all).
- **Impact**: Purely navigational, but the numbering exists precisely to let a reader line the DOM order up against the grid columns, and it now misleads on both counts.
- **Fix**: Renumber 1–7 for the first line and label the preview as the second line rather than slot 9.
- **Status**: accepted · **Triage**: Correct — the sequence still indexes the deleted eight-slot row. Renumbered 1–8 against DOM order, with the preview named as the second line rather than given a first-line slot number.

### [S4] The manual verify steps omit the only row that fills the scope column

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File**: `asimov/changes/add-last-activity-preview-to-agent-rows/tasks.md` (task 1_2 Verify)
- **Evidence**: Task 1_2 asks for a previewed row and a preview-less row at a wide and a narrow width. An `external` row is the only configuration where column 5 (`.wt-scope`, `auto`, `white-space: nowrap`, an uppercase "OTHER WINDOW" chip) is non-empty, and it is the one first-line configuration that puts real min-content pressure on the `minmax(0, 1fr)` title at narrow width. jsdom cannot see it and no other step covers it.
- **Impact**: The single unverifiable requirement in the change ("the age and the leading glyphs SHALL NOT truncate at any width") is checked against the easiest first line rather than the hardest one.
- **Fix**: Add "and one row with the external-scope chip" to 1_2's narrow-width step before handing it to the user.
- **Status**: accepted · **Triage**: Correct — the external row is the only one that fills the scope column, and it is the hardest first line for the no-truncation claim. Added to 1_2's narrow-width step before the task is handed over.

## Gate observations (not findings)

- Task 1_2 is `[ ]` and the Verify Gate is unticked, correctly — the project has no harness that lays CSS out. The chair did not run any project verify command (skill rule); Task 1_1's recorded evidence (`check-types` + `test:unit`, 4993 tests / 237 files green) and the passing `gate:fs-deletion` are cited as-is.
- The `lint/style/noDescendingSpecificity` diagnostic at `.wt-hist-label` in `worktreePanel.css` is in selectors this change does not touch, and the author reproduced it at HEAD~1. Accepted as baseline; not re-run.
- `docs/PLAN.md` and `asimov/changes/active` are modified in the working tree, outside the reviewed range — not reviewed. `docs/ui/worktree.html` is a separate `wk-`-prefixed mock, not a mirror of `worktreePanel.css`, and is classified skipped.
- The intended behavior is unreachable in production until WT-009.5 sources the preview content — verified, and consistent with the accepted Gate 1 split recorded in `workflow.md`.

## Audit backlog

None.

## Accepted risk

None.
