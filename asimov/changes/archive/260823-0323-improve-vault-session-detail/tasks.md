## 1. Restore the Claude permission mode on resume

- [x] 1_1 Capture the session's most recent permission mode instead of its first — verified: npx vitest run 'src/vault/readers/claudeReader.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/agent-session-index/spec.md#claude-permission-mode-is-the-latest-recorded-mode; design.md D1
  - **Acceptance**:
    - Outcome: A session whose permission mode changed mid-transcript resumes under its latest mode
    - Verify: unit src/vault/readers/claudeReader.test.ts
  - **Plan**:
    1. src/vault/readers/claudeRecords.ts — rename `ClaudeTailTitles` → `ClaudeTailFields` with a `permissionMode` field; make `applyTailTitle` also record a `{"type":"permission-mode"}` record's mode and any record's top-level `permissionMode` (last wins); raise the tail-scan constant to 256 KB and rename it off `AI_TITLE_`.
    2. src/vault/readers/claudeReader.ts — drop `parseClaudeFile`'s first-wins guard so the head window keeps its last mode; in `buildClaudeEntry` prefer the tail value over the head value, omitting the flag when neither exists.
    3. Add fixtures under src/vault/__fixtures__/claude-permission-mode/ covering: mode changed mid-transcript, mode present only past the head break, and no mode recorded.

- [x] 1_2 Invalidate the vault list cache so the corrected mode reaches existing installs — verified: npx vitest run 'src/vault/VaultCacheStore.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/agent-session-index/spec.md#claude-permission-mode-is-the-latest-recorded-mode; design.md D2
  - **Acceptance**:
    - Outcome: A cache written before this change is discarded and rebuilt on the next refresh
    - Verify: unit src/vault/VaultCacheStore.test.ts
  - **Plan**:
    1. src/vault/cacheTypes.ts — bump `VAULT_CACHE_VERSION` 3 → 4.
    2. Add a load test asserting a document with a literal `version: 3` is rejected, alongside the existing stale-version-1 case.

## 2. Copyable folder, session id, and transcript path

- [x] 2_1 Rebuild the preview meta block as Folder / Session / Activity with copyable values — verified: npx vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-preview/spec.md#{safe-preview-rendering, session-detail-header-composition, copying-session-paths-and-ids-from-the-preview}; design.md D4, D6
  - **Acceptance**:
    - Outcome: The meta block shows folder + branch, session id + path, and age + stats in three rows
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. src/types/messages.ts — add `vaultCopyCwd` and `vaultCopySessionId`, each carrying `entryId` only, to the webview → extension union.
    2. src/webview/vault/renderAtoms.ts — add the shared `copyableValue` builder (hover reveals a copy glyph, click posts and flips to a tick); rebuild `buildPreviewMeta` into the three rows, folding the branch chip into Folder and the relative age into Activity, omitting the path segment when the entry is not file-backed.
    3. src/webview/vault/VaultPanel.ts — widen `VaultPanelPostMessage` to accept both new message types.
    4. src/webview/vault/PreviewController.ts — pass the panel's post-message into the meta builder so each value can post its copy request.

- [x] 2_2 Copy meta values in the webview instead of round-tripping through a full vault scan — verified: npx vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/vault-session-preview/spec.md#copying-session-paths-and-ids-from-the-preview; design.md D4
  - **Acceptance**:
    - Outcome: The clipboard holds the untruncated value of the last affordance activated
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. src/webview/vault/PreviewController.ts — resolve the value from the entry already in hand and write it with `navigator.clipboard.writeText`; drop the `postMessage` copy path for the meta block.
    2. src/webview/vault/renderAtoms.ts — await `onCopy` and confirm only on success, so the tick never claims a copy that failed.
    3. src/types/messages.ts + src/webview/vault/VaultPanel.ts — remove `vaultCopyCwd` and `vaultCopySessionId`; nothing posts them any more.
    4. src/providers/TerminalViewProvider.ts — remove the two handlers and their `handleMessage` cases. `vaultCopyFilePath` / `vaultCopyResumeCommand` stay: the context menu still uses them.

- [x] 2_3 Style the three meta rows and the hover copy affordance — verified: manual — User re-checked the preview in a narrow sidebar: branch chip hugs its branch name, session id shows in full, no row wraps; hovering each of the four meta values shows a tooltip with its untruncated text and lights up only that value copy glyph
  - **Deps**: 2_1
  - **Refs**: specs/vault-session-preview/spec.md#{session-detail-header-composition, copying-session-paths-and-ids-from-the-preview}; design.md D4
  - **Acceptance**:
    - Outcome: Every meta value hugs its own text, discloses that text on hover, and arms only its own copy glyph
    - Verify: manual open a preview in a narrow sidebar — the branch chip is as wide as its branch name, the session id shows in full, no row wraps or widens the card; hovering a value shows a tooltip with its untruncated text and lights up that value's copy glyph alone
  - **Plan**:
    1. src/webview/vault/vaultPanel.css — style `.vault-preview-copyable` (hover glyph, copied tick, focus ring) and compose the two multi-value meta rows; keep `.vault-preview-branch-chip` and reuse it beside the folder leaf, dropping its `cursor: default` now that the chip is itself a copy affordance. Give the glyph a fixed-size box and centre the tick inside it, so confirming a copy cannot reflow the row.
    2. src/webview/vault/renderAtoms.ts — wrap a row's plain-text value in a span so it can be one-line clamped like the copyable values (a bare text node in a flex row cannot ellipsize).
    3. src/webview/vault/vaultPanel.css — delete the blanket `dd > .vault-preview-copyable:last-child:not(:only-child)` grow rule: it was written for the transcript path but also matches the branch chip, stretching a four-character branch to its 40% cap. Every value hugs; none grows.
    4. src/webview/vault/renderAtoms.ts — the transcript path becomes an icon-only affordance (full path in the tooltip and on the clipboard). Its rendered text showed only Claude's encoded cwd and a clipped filename — both already on screen — while consuming the width that truncated the session id. Drop `pathTail`, now unused.
    5. src/webview/vault/vaultPanel.css — move the monospace face off `dd` onto `.vault-preview-copyable-text`, so paths and ids stay monospaced but the Activity summary reads as prose.
    6. src/webview/vault/renderAtoms.ts + src/webview/vault/PreviewController.ts — attach the custom tooltip widget to every meta value and return its disposers alongside the element, merging them into the header's. Native `title` does not render in this webview, which is why no meta row showed a tooltip at all; `previewHeader.ts` already says so and uses `attachTooltip` for its buttons.
    7. src/webview/vault/renderAtoms.ts — the transcript path goes back to being a labelled value reading `transcript`, not a bare glyph. That retires the icon-only case entirely, so every meta value is text + its own hover glyph again.
    8. src/webview/vault/vaultPanel.css — revert to per-value hover reveal: hovering the folder must not light up the branch's copy button. With no icon-only affordance left, nothing needs row-level hover.
    9. src/webview/vault/renderAtoms.ts — give each value an `action` naming its copy, used as the accessible name, so a screen reader announces "Copy branch name" rather than the raw value.

- [x] 2_4 Make the git branch copyable alongside the folder — verified: npx vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/vault-session-preview/spec.md#copying-session-paths-and-ids-from-the-preview; design.md D4
  - **Acceptance**:
    - Outcome: The branch chip copies the branch name
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. src/webview/vault/renderAtoms.ts — give `copyableValue` optional `className` and `prefix`; add `gitBranch` to `MetaCopyTarget` and rebuild `branchChip` on top of `copyableValue`, keeping the ⎇ glyph as its prefix.
    2. src/webview/vault/PreviewController.ts — resolve `gitBranch` in `copyMeta`.

## 3. Title row and keyboard navigation

- [x] 3_1 Strip the branch chip and jump buttons from the preview title row — verified: npx vitest run 'src/webview/vault/previewHeader.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/vault-session-preview/spec.md#session-detail-header-composition; design.md D3
  - **Acceptance**:
    - Outcome: The title row carries only badge, title, Resume, Expand and Close
    - Verify: unit src/webview/vault/previewHeader.test.ts
  - **Plan**:
    1. src/webview/vault/previewHeader.ts — remove `PreviewHeaderModel.branch` and the title-row branch chip, and remove the `onPrevUser`/`onNextUser` callbacks and the buttons they gated.
    2. src/webview/vault/PreviewController.ts — stop passing `branch`, `onPrevUser` and `onNextUser`.
    3. src/webview/vault/icons.ts — drop `ICON_NAV_PREV` / `ICON_NAV_NEXT` once nothing imports them.

- [x] 3_2 Bind Alt+ArrowUp / Alt+ArrowDown to previous / next user message — verified: npx vitest run 'src/webview/vault/FloatingPreviewShell.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/vault-session-preview/spec.md#keyboard-navigation-between-user-messages; design.md D5
  - **Acceptance**:
    - Outcome: With the preview open, Alt+ArrowUp and Alt+ArrowDown jump between user messages instead of reaching the terminal
    - Verify: unit src/webview/vault/FloatingPreviewShell.test.ts
  - **Plan**:
    1. src/webview/vault/FloatingPreviewShell.ts — add an optional `onKeyDown` dep attached as its own capture-phase document listener in `attachCloseListeners` and removed in `detachCloseListeners`.
    2. src/webview/vault/PreviewController.ts — supply the handler: on Alt+ArrowUp/Down call `scrollNav.scrollToAdjacentUser(-1 | 1)` with `preventDefault()` + `stopPropagation()`; ignore it when the context menu is open or `document.activeElement` is an input, textarea, or contenteditable.

## 4. Renaming from the preview title

- [x] 4_1 Rename a session by double-clicking the preview title — verified: npx vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1, 2_4
  - **Refs**: specs/vault-session-preview/spec.md#renaming-a-session-from-the-preview-title; design.md D7
  - **Acceptance**:
    - Outcome: Double-clicking the preview title renames the session
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. src/webview/vault/vaultListView.ts — `beginInlineRename` takes the title element instead of locating `.vault-row-title` inside a row; guard on the element still being connected.
    2. src/webview/vault/VaultPanel.ts — the list caller does that query itself.
    3. src/webview/vault/previewHeader.ts — add an optional `onRenameTitle(titleEl)` callback, wired to the title's `dblclick` only when supplied, so the subagent popup keeps no rename.
    4. src/webview/vault/PreviewController.ts — open the editor, commit via `vaultRenameSession`, and hold the header element across repaints while the editor is open.

## 5. Review round 1 fixes

- [x] 5_1 Fix the round-1 blocking and warning findings — verified: npx vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-1.md#{B1, B2, W1, W2, W3}; design.md D4, D7
  - **Acceptance**:
    - Outcome: A reopened preview never carries the previous session's header, and the clipboard holds the last value activated
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. src/webview/vault/vaultListView.ts — `beginInlineRename` returns a handle that ends the edit, so a caller can close it without depending on `blur` firing on DOM removal (B1).
    2. src/webview/vault/PreviewController.ts — end and clear the editor, `titleEditing` and `headerEl` on close and on open (B1); serialize copies through one rejection-safe promise chain (B2); update the mounted title when the renamed entry returns (W1); consume Alt+Arrow while the context menu is open, still passing it through for text entry (W3).
    3. src/webview/vault/renderAtoms.ts — one stored flash timer per affordance, cleared at each activation so a failed retry cannot inherit an earlier tick (W2).

- [x] 5_2 Scope copy confirmation to the activation that produced it — verified: npx vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: .reviews/round-2.md#W2; design.md D4
  - **Acceptance**:
    - Outcome: Only the most recent activation of an affordance can confirm a copy
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. src/webview/vault/renderAtoms.ts — capture a per-button generation before the await; only the current generation may add the tick or schedule its timer.
    2. Add overlapping-activation tests: a delayed first success landing after a second activation that rejects, and two overlapping successes.
