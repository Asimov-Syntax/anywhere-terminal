# Design: improve-vault-session-detail

## Decisions

### D1: `permissionMode` is last-wins over the head scan ∪ a bounded tail scan

`parseClaudeFile` captures the **first** `permissionMode` it sees and stops at the first user+assistant pair (~record 20). Claude writes the mode on records throughout the transcript and re-writes it on every change, as a top-level field and as a dedicated `{"type":"permission-mode"}` record — so the current rule both misses it and goes stale.

Measured over 120 local transcripts (109 carry a mode):

| rule | correct | missing | stale/wrong |
|---|---|---|---|
| head-only, first-wins (today) | 87 | 19 | 3 |
| head last-wins ∪ 64 KB tail | 101 | 8 | 0 |
| head last-wins ∪ **256 KB** tail | **106** | 3 | **0** |
| head last-wins ∪ 512 KB tail | 108 | 1 | 0 |

Two changes, no new file pass:

1. `parseClaudeFile` drops its `=== undefined` guard so the head window keeps the **last** mode it sees. The early break stays — the head window is unchanged.
2. `readLatestTailTitles` already reads the last 64 KB of every changed session file for the title trailer. It grows to 256 KB and also collects the last `permissionMode` (top-level field or `permission-mode` record). Tail value wins over head; neither present → the flag is omitted and the CLI applies its own default.

256 KB over 64 KB buys 5 of the 8 remaining misses for ~192 KB extra on a read we already do. 512 KB buys 2 more and is not worth doubling the parse.

The captured value is passed to `--permission-mode` verbatim. `auto`, `bypassPermissions` and `default` all appear in local transcripts and all are accepted by `claude` 2.1.239; no allowlist is introduced, because filtering against a hardcoded set would silently drop a mode a newer CLI adds.

### D2: The vault list cache must be invalidated

`ReaderListCache` kind `"files"` stores the **derived entry** per session file keyed by `(mtimeMs, size)`. Every already-cached Claude entry therefore carries a `permissionMode` computed under D1's old rule and would be reused without re-reading — the fix would not reach any existing user. `VAULT_CACHE_VERSION` goes `3 → 4`; `VaultCacheStore.load` already discards any other version. Same remedy the Codex child-thread change used (`specs/agent-session-index/spec.md#read-codex-sessions`).

### D3: The branch chip moves out of the shared header builder

`previewHeader.ts` is shared with the subagent popup and is documented as consumer-agnostic; `branch` was the one vault-only field in its model. Moving the chip into the vault meta block removes `PreviewHeaderModel.branch` and the title-row chip entirely, so the builder gets smaller rather than gaining a mode. `.vault-preview-branch-chip` CSS is reused unchanged inside the Folder row.

### D4: One copyable-value atom, copying in the webview

The Folder leaf, the session id and the transcript path share one behaviour, so they share one builder in `renderAtoms.ts`:

```
copyableValue({ text, title, onCopy }) -> <button class="vault-preview-copyable">
  hover  → reveal a copy glyph + `title` tooltip (untruncated text)
  click  → await onCopy(); on success swap the glyph to a tick for ~1.2s
```

The clipboard write happens **in the webview**, via `navigator.clipboard.writeText`. No new message types; no host round-trip.

> Superseded the original decision, which routed all three through the host on the premise that "webview clipboard access is unreliable". That premise was false — `TerminalFactory.ts:161` already builds its `ClipboardProvider` from `navigator.clipboard.writeText` and it is the shipping Ctrl+C copy path in this same webview. The cost of the wrong premise was three defects, all of them structural rather than incidental (see R7).

The value copied is text the webview is already rendering, so the round-trip bought no safety: D9 exists to stop the **host acting on** a webview-supplied path — opening it, revealing it, executing it — and a clipboard write exercises no host privilege at all. `vaultCopyFilePath` and `vaultCopyResumeCommand` stay host-side for the context menu, which is a genuinely rare action and where `vaultCopyResumeCommand` needs host-side command construction.

Awaiting the write also makes the tick honest: it confirms a copy that happened, instead of firing optimistically alongside one that may still be seconds away or may silently never land.

Copies queue on **one rejection-safe promise chain** in `PreviewController`. `writeText` calls run in parallel and the Clipboard API specifies no cross-call ordering, so without the chain two rapid activations could still land in completion order — the same last-writer-wins defect the host round-trip had, one layer down (review B2). Each affordance also carries a monotonic activation counter, captured before the await: only the newest activation may add the tick or schedule its flash timer (review W2). Clearing at click time alone was not enough — the completion path resumes after an await, so a superseded copy could still land its tick and a later rejection would leave that tick standing, confirming a copy the clipboard refused.

Rejected: keeping the round-trip but resolving from `listCached()`. It would cut the latency, but leaves the ordering race (two scans, last one wins the clipboard) and the silent-miss failure intact, and it still routes a value the webview already holds through two process boundaries to come back unchanged.

### D5: `Alt+↑/↓` binds through an optional capture-phase hook on the shared shell

The jump-to-user-message buttons leave the title row; `PreviewScrollNav.scrollToAdjacentUser` is kept and driven from the keyboard instead.

The binding must be **capture phase**: `main.ts` installs a capture-phase document key router that forwards keys to the PTY, and xterm's own handler would otherwise consume `Alt+ArrowUp` when the terminal holds DOM focus. The handler calls `preventDefault()` + `stopPropagation()` on a match.

`FloatingPreviewShell` already owns every document listener for the card, so it gains an optional `onKeyDown` dep attached as its own capture-phase listener in `attachCloseListeners` and removed in `detachCloseListeners`. The subagent popup passes nothing and gets no listener. The Esc/outside-click listeners keep their existing phase — untouched.

`PreviewController` guards the handler: ignore when `document.activeElement` is an `input`, `textarea`, or `contenteditable` (the inline rename editor), and when the row context menu is open.

There is no on-screen hint for the binding. That is the accepted cost of "no new chrome".

### D6: Activity merges age + stats into one row

`Modified` and `Activity` become one `Activity` row: `5m ago · 24 msgs · 18.2k tok · 8 tools`. The age is available at open time and the stats arrive with the detail, so the row renders immediately and gains its tail in place — which also removes the header's current one-row layout shift when the detail lands.

## Interfaces

```ts
// claudeRecords.ts — ClaudeTailTitles gains a non-title field, so it is renamed.
export interface ClaudeTailFields {
  customTitle?: string;
  aiTitle?: string;
  lastPrompt?: string;
  /** Last permission mode seen in the tail window (D1). */
  permissionMode?: string;
}

// renderAtoms.ts
export function copyableValue(opts: {
  text: string;                          // displayed (may ellipsize)
  title: string;                         // untruncated, shown on hover
  onCopy: () => void | Promise<void>;    // awaited; rejection skips the tick
  className?: string;                    // extra class (the branch chip's pill)
  prefix?: HTMLElement;                  // leading glyph (the branch ⎇)
}): HTMLElement;

// vaultListView.ts — takes the title ELEMENT, not the row that contains one
export function beginInlineRename(
  titleEl: HTMLElement,
  entry: VaultSessionEntry,
  cb: { commit: (name: string) => void; onDone?: () => void },
): void;

// previewHeader.ts callbacks — omitted by the subagent popup, which has no rename
onRenameTitle?: (titleEl: HTMLElement) => void;

// FloatingPreviewShell deps
onKeyDown?: (e: KeyboardEvent) => void;  // capture phase, attached while open
```

### D7: The preview title reuses the list's inline rename, on double-click

`beginInlineRename` (`vaultListView.ts`) already builds the editor, seeds it from `customName || title`, commits on `Enter`/blur, cancels on `Escape`, and stops key/pointer propagation. Its only tie to the list was locating `.vault-row-title` inside a row — so it takes the title **element** instead, and the list caller does that query. No second editor, no second commit path: both post `vaultRenameSession`.

**Double-click, not single.** `.vault-preview-title` is `flex: 1`, so it is most of the card's drag handle, and `.vault-preview-meta` is already excluded from dragging — making the title a click target too would leave the badge and the header padding. Double-click is also the conventional rename gesture. Rejected: a drag-aware single click (edit on pointerup only when the pointer never moved) — it keeps both gestures on one surface, but needs `FloatingWindow`'s internal `moved` flag plumbed out, and a click ending after a 2px twitch would silently do nothing.

`Escape` reaches the editor first because the shell's close listeners are **bubble** phase for the vault (`captureCloseListeners` is only set by the subagent popup), and the editor stops propagation. The `Alt+↑/↓` binding is capture phase but already declines while a text field holds the caret (D5).

An open editor must survive a repaint: `renderPreviewDetail` runs on every live-follow update and calls `shell.render(buildPreviewHeader(...), body)`, which would replace the input mid-keystroke. `buildPreviewHeader` therefore returns the **existing** header element while an edit is open, which also skips the tooltip dispose/re-track that a real rebuild does.

That retention is only safe if the flag is cleared on every exit. `beginInlineRename` returns an `end()` handle and `PreviewController.endTitleEdit()` runs it on both close and open, clearing `titleEditing` and `headerEl`. Leaving it to `blur` was the original bug: removing a focused node does not reliably fire one, so a close mid-rename left the flag set and the next open remounted the **previous** session's header — Resume, copy and rename callbacks still closed over that entry (review B1). `end()` commits, matching blur; only `Escape` cancels.

A committed rename repaints in place: the host normalizes the name and pushes the authoritative entry to `refreshActiveEntry`, which patches the mounted title's `textContent` (review W1). Not an optimistic update — that would mean a second copy of the host's empty-value-resets rule in the webview, the exact drift this decision exists to avoid.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `readLatestTailTitles` | Tail window grows 64 KB → 256 KB; cost axis is *changed session files per refresh*, not session count — the incremental cache skips unchanged files entirely (`cacheTypes.ts` `kind:"files"`). Bounded at 256 KB regardless of transcript size. | Keep the byte cap a named constant; D1 records why 512 KB was rejected |
| `VAULT_CACHE_VERSION` bump | First refresh after upgrade rebuilds every agent's cache — one slow list on first open | Already the documented behaviour of `VaultCacheStore.load`; no migration path needed |
| `Alt+↑/↓` | Swallowed by xterm / the PTY key router when the terminal has focus | Capture phase + `preventDefault()` + `stopPropagation()` (D5); test asserts the handler runs with a terminal-focused `activeElement` |
| `Alt+↑/↓` | Fires while the inline rename editor is open, hijacking cursor movement | `activeElement` input/contenteditable guard + context-menu guard (D5) |
| `previewHeader` | Removing `branch` and the prev/next branch breaks the subagent popup's shared shape | Both consumers covered by `previewHeader.test.ts`; the popup never passed either field |
| Meta block | Three rows with long values in a narrow sidebar — the Session row is the widest | `dd` already `nowrap` + ellipsis; untruncated text lives in the hover tooltip, not the layout |
| Meta block | A grow rule written for one row silently matched another: `dd > .vault-preview-copyable:last-child:not(:only-child)` also selected the branch chip once the chip became a copyable, stretching a 4-character branch to its 40% cap (specificity 0,4,1 beat the chip's own `flex: 0 1 auto`) | No value grows; every one hugs its text. Structural selectors that depend on sibling POSITION are the hazard — a later task changed what class a child carried, not the CSS |
| Meta block | An icon-only affordance cannot use per-button hover reveal — hiding its glyph leaves nothing to hover — and a bare glyph does not say what it copies | Reveal on ROW hover (dim, brightening under the pointer); the tooltip names the action above the value, and that name is the accessible name. Left in flow rather than `display: none`, so it keeps its tab-order slot |
| Meta block | The rendered transcript path was pure redundancy — Claude's encoded cwd (the folder, one row above) plus a filename clipped by `text-overflow` (the session id, immediately left) — and `pathTail`'s left-shortening fought the CSS's right-ellipsis, losing the filename it existed to protect | The path is icon-only: full value in the tooltip and on the clipboard, and the reclaimed width lets the session id render in full |
| Meta copy (R7) | The host round-trip made three header buttons each run `VaultService.list()` — a **full uncached** re-read of every store (`VaultService.ts:299`). Rare context-menu cost, unacceptable per-click cost. | D4: copy in the webview; no scan, no round-trip |
| Meta copy (R7) | Two rapid clicks launch two independent uncached scans with no single-flight; the one that finishes **last** wins the clipboard, so the pasted value belongs to whichever button the user clicked first. | Same — a local write is synchronous and ordered |
| Meta copy (R7) | A resolve miss `return`s silently, leaving the *previous* clipboard content in place; the user pastes a stale value and reads it as a wrong answer. | Await the write; tick only on success, so a failure is visibly a non-copy |
| Meta copy | `.is-copied` swapped a `display:none` glyph for a `::after` tick of different width, reflowing the row on every click and again 1.2s later | Fixed-size icon box; the tick is centred inside it, so the box never changes width |
| `navigator.clipboard` | Write rejects without transient user activation or a focused document | Always inside the button's own click handler; rejection is caught and simply skips the tick |
| Title rename (D7) | A live-follow repaint replaces the header and destroys the open editor mid-keystroke | `buildPreviewHeader` returns the existing header element while an edit is open |
| Title rename (D7) | `Escape` closes the overlay instead of cancelling the edit | Vault close listeners are bubble phase; the editor stops propagation. Asserted, not assumed — the popup's `captureCloseListeners: true` would break this if it were ever shared |
| Title rename (D7) | The branch chip becomes a `<button>`, so it is now in the tab order and inside the drag handle | It sits in `.vault-preview-meta`, already excluded from dragging (`FloatingWindow.ts:126`) |
