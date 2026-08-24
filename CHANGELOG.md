# Changelog

All notable changes to **AnyWhere Terminal** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Cursor CLI and IDE history join the AI Vault.** Cursor rows now follow the same preview-first click / Enter / Space contract as Claude Code, Codex, and OpenCode, with `CLI` / `IDE` source badges. Explicit detail requests decode compatible CLI `store.db` root graphs, project JSONL mirrors, and Cursor IDE Composer records locally through bounded read-only snapshots; schema drift falls back to metadata-only detail. Only validated CLI rows expose explicit Resume through the detected `agent` / `cursor-agent` executable; IDE history, project mirrors, forged or stale entries, fork, cross-store Resume, and ACP embedding cannot receive CLI Resume capability.
- **Optional Cursor Agent activity and approval status.** The machine-scoped `anywhereTerminal.cursorAgent.hooks.enabled` setting adds fail-open, exactly owned user hooks that report authenticated pane-local working/idle activity; current-screen command approvals show an action-required tab state, including narrow wrapped menus. Disabling removes the managed entries, clears semantic identity immediately, and returns tabs to bounded PTY-output activity. The hook observer never persists or exposes raw payloads, prompts, shell output, account identity, or transcript content.

## [0.17.9] — 2026-08-23

### Added

- **Copy anything out of a session preview with one click.** The preview header now carries three tidy rows — **Folder** (with the git branch beside it), **Session** (its id and transcript file), and **Activity** (age, messages, tokens) — and every value on them is click-to-copy, with a tick to confirm the copy landed. Hover any value to see its full, untruncated text; the folder row discloses the whole path, and the branch chip copies just the branch name.
- **Rename a session straight from its preview.** Double-click the preview title and type — the same inline editor the session list uses, so the name sticks the same way. Enter saves, Escape cancels, and clicking away saves. It's a double-click because a single click still drags the preview window around.

### Changed

- **The preview title row is quieter.** The branch chip moved down into the Folder row where the rest of the session's context lives, and the two "jump to previous / next user message" buttons are gone from the header. Jumping now happens on **Alt+↑ / Alt+↓** while a preview is open, leaving the title room to show an actual title.

### Fixed

- **Resuming a Claude session now restores the permission mode you were last in.** The vault read only the *first* permission mode a transcript ever recorded, so a session you'd switched into (say) plan mode resumed under whatever mode it started in hours earlier. It now reads the latest mode the transcript records. Your existing session list is rebuilt once on the next refresh so already-indexed sessions get the corrected mode.
- **Copying from the session preview is instant and always copies what you clicked.** Each copy used to travel to the extension host and trigger a full, uncached scan of every agent's session store — so clicking two values in quick succession left whichever scan finished last on the clipboard, which wasn't necessarily the one you clicked. The copy now happens in the preview itself, in the order you clicked, and nothing is scanned at all.
- **Session list titles now match what Claude Code itself shows.** A session you'd named yourself, or one Claude hadn't generated a title for yet, fell all the way through to its first message. The reader now follows Claude's own precedence — your custom title, then Claude's generated title, then the last prompt, then the first — matching Claude for 146 of the 150 most recent real sessions (the other 4 record no title at all).
- **Tab titles no longer redraw the whole tab bar ten times a second.** An agent animating a spinner in its terminal title drove a full tab-bar re-render on every frame, in every pane. Renders now happen only when a tab's title actually changes.
- **Opening a subagent preview no longer lands on the wrong session.** A headless `claude -p` run — the kind a hook spawns in the background — registered itself as a live session and, having just written its transcript, won the tie-break against the interactive session you were actually looking at. Headless runs are now filtered out of that match.

## [0.17.8] — 2026-07-13

### Added

- **Terminal tabs now show activity at a glance.** Each tab carries a small status dot: it pulses green while the terminal is producing output, sits grey when idle, and turns red once the process has exited. In a split tab the dot lights up if *any* pane is still working, so a long-running command in a background pane is visible without switching to it. The pulse honors your system "reduce motion" setting.

### Fixed

- **Pasting a screenshot into Claude Code on Windows now works from Ctrl+V.** On Windows a copied screenshot lives on the clipboard as a device-independent bitmap (DIB) that the webview's paste event can't see, so Ctrl+V appeared to do nothing. When a Windows paste carries no visible image or text, the extension now reads the image from the OS clipboard host-side and fires the paste signal Claude Code uses there (Alt+V) — so a screenshot pastes with a plain Ctrl+V. Plain text paste stays on the native path and is unaffected.
- **Pasting an image into an agent on Linux (X11) no longer stalls for ~2 seconds.** The extension writes the image to the X selection with `xclip`, which forks a background process that owns the selection; waiting on that process's inherited output pipe added a ~2s delay to every image paste. It now hands `xclip` the image over stdin and waits only until the selection is claimed, so the paste registers immediately.

## [0.17.7] — 2026-07-08

### Added

- **Rename any session in the AI Vault.** Right-click a session — Claude Code, Codex, or OpenCode — and give it a name that sticks. For Codex and OpenCode, whose CLIs keep a real, user-editable title, the new name is written straight into the CLI's own store (its SQLite index) with a WAL-safe, parameterized write, so the rename is authoritative everywhere — the CLI shows it too, not just the vault. Claude Code has no writable title field (its title is derived from the summary/first prompt), so its rename is kept as a private overlay inside the extension. If a native write can't land — the store is locked or the row is gone — the vault falls back to the overlay so your name still shows.
- **The vault is now live.** The session list auto-refreshes whenever any agent writes to its store on disk, so it stays current without a manual refresh (the refresh button remains as a fallback). Open a session's preview and it follows along: new messages append and auto-scroll while you're at the bottom, and a "N new messages" pill appears if you've scrolled up.
- **More detail in the session preview.** Each assistant message now shows the model it used and its token usage (plus the context-window size where the agent records it), and the preview header shows the session's git branch as a chip for the agents that record it (Claude Code, Codex).
- **A gentle highlight when something changes.** When a session in the list updates, or a new message lands in the open preview, it briefly glows in that agent's accent color and fades away — a quiet cue that something moved, easy to notice without pulling your focus. It honors the system "reduce motion" setting.

### Fixed

- **Pasting an image into Claude Code on Windows now works.** Claude Code binds image paste to **Alt+V** on Windows — plain Ctrl+V there is an ordinary text paste that never reads the clipboard image (Claude just prints "No image found in clipboard. Use alt+v…"). The extension had been sending Ctrl+V on every non-macOS platform, so image paste silently did nothing for Claude on Windows. The paste signal is now chosen per platform — empty bracketed paste on macOS, Alt+V on Windows, Ctrl+V on Linux — while Codex and OpenCode keep their fixed Ctrl+V everywhere. macOS and Linux behavior is unchanged.

## [0.17.6] — 2026-07-07

### Added

- **Paste images directly into Claude Code, Codex, and OpenCode.** Copy an image — a screenshot, an image from the browser, or an image file in Finder/Explorer — and paste it into an AI CLI running in the terminal; the CLI receives it as `[Image #N]`. The image bytes never cross the PTY: the extension mirrors the pasted image onto your OS clipboard (macOS, Linux via `wl-copy`/`xclip`, Windows via PowerShell) and emits the paste signal each CLI expects — Codex and OpenCode read a fixed Ctrl+V on every platform, while Claude uses its OS-native signal. Hovering the `[Image #N]` placeholder shows a preview of what you pasted. On macOS this also works with **Ctrl+V** (which isn't the system paste shortcut): the extension reads the clipboard image host-side for the preview, correctly resolving a copied image *file* to its contents rather than its generic file icon.

## [0.17.5] — 2026-06-28

### Fixed

- **Resuming a recent Codex session no longer fails with `invalid value 'managed' for '--sandbox'`.** Codex CLI 0.136 started recording a new, granular `managed` sandbox policy for sessions, but `codex resume -s` only accepts `read-only`, `workspace-write`, or `danger-full-access` — so resuming any `managed` session aborted before it started. The vault now maps a `managed` policy to the closest accepted mode (`workspace-write` when it grants write access, otherwise `read-only`) and drops the `-s` flag entirely for any unrecognized future policy type, letting Codex fall back to its configured default instead of crashing. The cached session list is rebuilt once on upgrade so previously-indexed sessions pick up the fix.

## [0.17.4] — 2026-06-21

### Added

- **Nested subagents now nest correctly in the session preview and the terminal popup.** Claude Code (v2.1.172+) lets a subagent spawn its own subagents — up to five levels deep. Previously the AI Vault preview and the in-terminal subagent popup flattened every subagent into the root session, so the tree was lost and the subagent count was off. They now reconstruct the real parent→child tree from each subagent's spawn id: the root shows only the subagents it launched directly, and expanding any subagent reveals the sub-subagents it spawned, recursively — including a new expand-in-place drill-down inside the terminal popup. Older sessions and the OpenCode/Codex readers are unchanged.
- **A resumed agent you quit now drops you into a shell instead of a frozen tab.** A vault-resumed agent (Claude Code / Codex / OpenCode) runs as the terminal's root process, so quitting it (e.g. Ctrl+C) used to exit the whole PTY and freeze the tab at "[Process exited]". The tab now automatically spawns your default shell in place, so input returns. The tab's identity flips to that shell, so reloading the window restores the shell rather than re-resuming the agent you already quit — but reloading while the agent is still running still auto-resumes it.

### Fixed

- **Long assistant messages are no longer truncated in the session preview.** Assistant transcript bodies were capped at 2000 characters and cut with an ellipsis, dropping the tail of long answers. Assistant bodies now render in full across the Claude Code, Codex, and OpenCode readers — your prompts and the agent's reasoning stay capped, and the timeline is still bounded by item count and the head/tail record windows.

## [0.17.3] — 2026-06-04

### Changed

- **README rebuilt around the AI Coding Vault.** The README now leads with the AI Vault and the coding-agent feature set — resume/fork Claude Code · Codex · OpenCode sessions, the floating session preview, clickable paths, and file/image hover previews — with new screenshots of the Vault panel and the session preview. The vault privacy note was corrected: a non-authoritative, owner-only metadata cache (bounded session titles + working directories) is persisted under VS Code storage for an instant open, while full session content is read on demand and nothing leaves your machine. The OpenCode fork minimum version is corrected to ≥ 1.1.54.
- **Marketplace discovery keywords.** Added `ai`, `ai agent`, `coding agent`, `claude code`, `codex`, `opencode`, `windsurf`, and `antigravity` so the extension surfaces for AI-CLI searches on the VS Code Marketplace and Open VSX.

## [0.17.2] — 2026-06-04

### Added

- **Right-click a file-tree row for path actions.** A real file or folder row now opens an in-webview context menu: **Reveal in Finder / File Explorer**, **Copy Path**, **Copy Relative Path**, and **Delete** (moves to trash after a confirm dialog). Synthetic rows (search overflow/error, empty/loading states) and the root header don't open it. All actions are validated host-side against the active tree root and generation; relative paths use forward slashes on every platform.
- **Codex subagent sessions now nest inside their parent.** Codex stores each subagent run as a separate thread, so the vault listed them as standalone top-level sessions. Child threads are now hidden from the index and surfaced as expandable nested sub-sessions inside the parent's preview — matching how Claude Code and OpenCode sub-agents already appear. Parentage is read from Codex's SQLite graph metadata, falling back to JSONL session metadata, and degrades to the old flat behavior when neither is available.
- **See the questions an agent asked you — and your answers — in the session preview.** When a session uses the ask-the-user tool (Claude Code's `AskUserQuestion`, OpenCode's `question`, Codex's `request_user_input`), the preview now renders it as a distinct block instead of a bare "Question" chip: the question, the option(s) you picked, and a **click-to-expand** list of every option with its description (your choice highlighted). The block always stays visible — it's never collapsed inside a tool run. A question the session ended on shows **Awaiting answer**, and Codex secret answers are masked.

### Changed

- **Resuming from the session preview now closes it.** Clicking Resume in the AI Vault session preview resumes the session in a terminal and dismisses the floating preview in one step, instead of leaving it open over the terminal you just switched to.
- **Session preview no longer covers the terminal tab bar.** Whether floating or **maximized**, the preview now stops below the terminal tab strip (shown when 2+ terminals are open) so its tabs stay clickable. The floating card's top is clamped below the strip when anchored, restored, dragged, or resized upward; the maximized card starts at the strip's bottom instead of the viewport top. Both track the tab bar showing/hiding live.

### Fixed

- **Missing file links no longer interrupt the terminal.** Hovering a path that does not resolve now stays silent instead of opening an empty preview or showing "File not found", and clicking a nonexistent path now no-ops without an error toast.
- **Maximized session preview keeps a visible border.** When maximized, the preview filled the whole editor with a matching background and its 1px separator was clipped past the viewport edge, so it blended into the editor. The border now renders inside the viewport (`box-sizing: border-box`) as a clear separator.
- **The final assistant message no longer disappears from a long session preview.** When a turn ended with a tool call — e.g. an `AskUserQuestion` prompt or a closing `git status` — the run's concluding message was buried behind "Show N more", so the last visible item was a tool rather than the answer. A capped run now pins its concluding assistant message so it stays in view, and ask-the-user prompts break out of the run entirely.

## [0.17.1] — 2026-06-02

### Fixed

- **Pasted-image hover now previews the image you actually pasted.** The hover preview correlated the `[Image #N]` placeholder to its image by absolute paste order, but AI CLIs restart their `[Image #N]` counter every prompt while the terminal caches images for the whole session — so after your first prompt, hovering a new image showed an earlier one (e.g. paste image 1, send, paste image 2 → hover showed image 1). Placeholders now map to the most-recently pasted images by their position within the current prompt, so the newest tag always previews the newest image.

## [0.17.0] — 2026-06-02

### Added

- **Preview pasted images on hover.** When you paste an image into a terminal running an AI CLI (Claude Code, Codex, OpenCode), the tool renders a compact `[Image #N]` placeholder in the prompt. Hovering that placeholder now shows a preview of the image you actually pasted, so you can see what you attached at a glance. The image is captured in the terminal at paste time and rendered locally — nothing is sent anywhere, and the CLI's own paste handling is untouched. The preview fills the popup width with auto-scaled height and flips above the tag when there isn't room below it, reusing the existing floating hover-preview popup.

## [0.16.1] — 2026-05-31

### Changed

- **Fast, reliable hover tooltips in the AI Vault preview.** Its header buttons now use the same shared, body-mounted tooltip as the file tree instead of the native `title` attribute — which renders with long, OS-dependent delays inside VS Code webviews and is clipped by a panel's `overflow`. Tooltips appear immediately and can extend past the panel edge.
- **Collapsible vault groups and thinking blocks.** In Agent / Folder grouping each group header collapses (click or keyboard) to hide its rows; assistant "thinking" in the session preview now shows a one-line gist with a chevron to expand the full text.
- **Accessibility.** Sub-agent, team-member, and workflow/team group nodes in the session preview now expose proper screen-reader labels.

## [0.16.0] — 2026-05-29

### Added

- **AI Coding Vault** — a collapsible panel stacked above the file tree that lists your recent local AI-CLI sessions (Claude Code, Codex, OpenCode) and lets you **resume or fork** any of them in a new terminal. Sessions are read live from each tool's own store on every open — metadata only (a bounded, never-persisted title preview; nothing is cached or sent off the machine). Includes client-side search and a **"This folder only"** filter scoped to the focused terminal's folder. Fork is offered only where supported (OpenCode ≥ 1.14.50). Open it from the file-tree header button or the `AI Vault: Open` command.
- **Cross-platform session reading (Windows, Linux, macOS).** Store locations resolve per-OS from the home directory plus each tool's env overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME` / `CODEX_SQLITE_HOME`, `XDG_DATA_HOME`). When the `sqlite3` CLI is missing (typically Windows), reads fall back to the built-in `node:sqlite` engine — no native dependency. A missing store or missing tooling degrades to an empty list, never an error.

### Changed

- **Smoother sidebar collapse.** The AI Vault and file tree now collapse/expand with a VS-Code-style pixel animation (matching the Outline/Timeline panes), so toggling one section no longer makes the other bounce. In left/right docks each section folds into a thin vertical strip with aligned, correctly-pointing chevrons.
- **AI Vault — redesigned for scanning.** Real agent brand icons (Claude / Codex / OpenCode) tinted by a per-agent accent, **grouping modes** (Recent, Agent, Folder — persisted), compact single-line rows with an icon-only Resume on hover, and a **right-click context menu** (Resume in New Tab, Open, Reveal in Finder, Copy File Path / Resume Command, Open Working Directory). Activating a row opens a **content-rich floating session preview** — first prompt, recent-activity timeline (tool / sub-agent steps), latest assistant message, and activity stats — read on demand per session.
- **Vault session preview — movable, persistent, and easier to navigate.** The floating preview now remembers its **size, position, and maximized state** across reloads and full VS Code restarts; **drag its header** to move it; and a **transient ↑ / ↓ control** appears while you scroll, auto-hiding when idle. "Scroll to first message" loads the entire session (paging through older windows, bounded by the read cap) before jumping to its true first message.
- **Vault preview — clearer nested sub-agent steps.** A spawned sub-agent now reads as a **highlighted, accent-bordered block** with an **`agent` badge** and its `@<name>` shown distinctly from the task description, instead of one run-on bold line. OpenCode sessions no longer **duplicate** the agent (e.g. `@asm-review-logic · Review logic architecture (@asm-review-logic subagent)`) — the redundant `(@… subagent)` suffix is stripped, and the agent name is **recovered even when OpenCode records it only in the title** (a frequently empty `agent` field). Custom agent names with spaces or slashes are handled too.
- **Terminal file hover preview — roomier overlay.** The hover popup opens **wider** (560 → 640 px), can be **dragged (header) and resized (corner grip)** for the current hover, and renders as a **panel-level overlay** so it can extend over the AI Vault / file tree instead of being clipped to the terminal. The footer stays pinned while the body scrolls. Geometry is no longer persisted — each hover starts fresh at the default size.

## [0.15.0] — 2026-05-28

### Added

- **Open Folder button** in the file tree header — browse another folder into the tree via a native picker, without reloading the workspace or touching terminals.
- **In-panel position menu** (top/bottom/left/right) replacing the QuickPick modal, with keyboard nav and ARIA `menuitemradio` semantics.
- Hover tooltips on header buttons, a bottom-position divider, a re-root pulse, and a collapse/expand animation. Collapsing the tree at left/right folds it into a thin vertical strip.

### Changed

- The file tree panel is **always present** — minimize it by collapsing the root row instead. Removed the Close button and the title-bar Toggle commands.

## [0.14.1] — 2026-05-27

### Fixed

- **Shell integration scripts now ship with the VSIX.** `0.14.0` excluded `resources/shell-integration/*` from the published package via a missing `.vscodeignore` allowlist entry, breaking every shell-integration injection at startup with `ENOENT` when the injector tried to copy `shellIntegration-env.zsh` etc. into the per-session temp ZDOTDIR. Added `!resources/**` to `.vscodeignore` and a `build:check-vsix` gate that runs `vsce ls` and asserts every runtime-required file is in the include set — wired into `pnpm package` so the same class of regression cannot ship again.

## [0.14.0] — 2026-05-27

### Added

- **Export terminal sessions to file.** Three new command-palette entries — `Export Current Tab Scrollback`, `Export Last Command`, `Export Command…` — write the focused tab's output to a user-chosen path via the workspace FS API (remote/virtual workspaces supported). Output is ANSI-stripped by default; pick `.ansi` for raw escapes. Per-command export uses OSC 633 shell integration to capture command-line + exit code + cwd alongside the output.
- **Shell integration auto-injected for bash, zsh, fish, pwsh.** Per-session nonce protects the OSC 633 `E` (command-line) marker against forged input. Vendored MIT-licensed VS Code scripts; user `--noprofile --norc` / `-NoProfile` flags are respected.

### Fixed

- **Bash and zsh terminals now source user `.bashrc` / `.zshrc` / `.zprofile` / `.zlogin` / `.zshenv` again.** The shell-integration injector was missing the `VSCODE_INJECTION=1` env var the vendored scripts gate user-rc sourcing on; terminals were starting with no user PATH, aliases, prompt, or functions. `USER_ZDOTDIR` now falls back to `$HOME` (zsh default) instead of empty string.
- **`Cmd+K` (clear scrollback) now also wipes the tracked-commands list** — closing the privacy boundary so `Export Last Command` / `Export Command` cannot surface output captured before the clear, and the boundary survives a window restart.
- **Empty prompt lines no longer accumulate above the restore divider on each reload.** The headless mirror's seed buffer was retaining each previous shell's final prompt; the new PTY's prompt now overwrites that row before the next snapshot.

## [0.13.0] — 2026-05-26

### Added

- **Terminal sessions survive window reload and VS Code restart.** Scrollback, names, cwd, and split layouts restore for sidebar, panel, and editor terminals. Cmd+R keeps the shell running; full restart shows the prior session read-only with a fresh shell beneath. Toggle via `anywhereTerminal.sessionRestore.enabled`.

### Changed

- **Editor terminal Cmd+R no longer kills the PTY.** Closing an editor tab schedules a 5 s grace-period destroy that the panel-serializer cancels on revive.
- **Collapsing the file tree shrinks the panel to its header strip** (top/bottom), so the terminal area reclaims the saved size instead of leaving a blank strip below the title.

### Fixed

- **File tree collapse state survives reload.** A minimized tree no longer pops back open on Cmd+R — the mount path now honors the persisted `expandedPaths` set for the root.
- **External reveal signals don't pop the tree open while collapsed.** Auto-reveal on editor-tab switch is a no-op; OSC 7 inside the workspace stays silent; OSC 7 outside re-roots the header while keeping the body collapsed. Same for workspace-folder changes.

## [0.12.1] — 2026-05-24

### Fixed

- **Closing one of two split panes now lets the survivor fill the full width again.** After closing one side of a 2-pane split (e.g. close right pane of a side-by-side layout), the surviving pane stayed clamped at ~50% width — window-resize couldn't grow it back. Root cause: the `.split-leaf { flex: 1 }` rule lived in `src/webview/split.css`, but that file was never imported into the webview HTML. So a lone leaf at the root of `tabContainer` fell back to `flex: 0 1 auto` and sized itself to the xterm canvas's stale half-width intrinsic size. Branch children were unaffected because the renderer writes inline flex ratios per child. The layout invariant (`flex: 1`, `min-width/height: 0`) now lives inline in `SplitContainer.ts` so it can't drift, and the dead `split.css` is removed.

## [0.12.0] — 2026-05-24

### Added

- **Live filesystem sync in the file tree.** Paste, rename, or delete a file from anywhere — VS Code Explorer, terminal, Finder, another editor — and the AnyWhere Terminal file tree refreshes within ~150 ms with no manual re-expand. Works for the workspace root AND for arbitrary directories the user navigates to (`/tmp/foo`, `~/projects/bar`, etc.). Built on a process-level pool of per-directory non-recursive `vscode.workspace.createFileSystemWatcher` instances shared across the sidebar, panel, and editor file-tree hosts, debounced 150 ms per path. ENOSPC/EMFILE on watcher construction is caught and logged; a soft cap warns at 500 watched directories.
- **Window-focus rehydrate.** When you alt-tab back to VS Code (or wake the laptop), every root and currently-expanded directory in the tree re-fetches automatically so any changes made while the window was unfocused show up immediately. Mirrors VS Code's own `ExplorerService` pattern around macOS sleep/wake event drops.
- **Search results refresh on filesystem changes.** The in-panel file-tree search controller drops its 60 s enumeration cache when an fs event lands inside its scope, so a paste-then-search workflow surfaces newly-created files without waiting for the cache to expire.
- **Folder dirty badge picks color from the highest-severity descendant.** A folder whose descendants are all untracked now renders GREEN (matching VS Code Explorer); a folder containing a conflict renders RED; mixed contents fall back through the severity ladder `conflicted > deleted > modified > renamed > added > untracked`. Both the folder name AND the `•` dot are tinted, and the dot is bumped to 18 px so it reads clearly alongside file rows. Previously every dirty folder rendered the modified yellow regardless of what was actually dirty inside.
- **Sub-folders show the correct color before you expand them.** The extension host now aggregates per-directory descendant dirty counts from the git provider and ships them with every directory listing, so a collapsed `docs/` folder full of untracked files lights up GREEN on first open — no manual expand required.

### Fixed

- **File-tree no longer blinks on every fs refresh.** Two independent blink sources eliminated: (1) `Tree.rebuildRows` previously did a wholesale `list.splice(0, oldLen, newRows)` that destroyed every DOM row on every change; replaced with a common-prefix + common-suffix diff so a single create/delete only re-splices the affected row. (2) `Tree.refresh` cleared `node.children` then re-rendered synchronously, flashing an "empty subtree" frame before the new children loaded; the intermediate render is now skipped so old rows stay in DOM until the diff-splice replaces them. Scroll position, selection, and focus are preserved across refreshes.
- **No more focus theft when clicking a file in VS Code Explorer.** `revealPath` previously called `tree.domFocus()` unconditionally — so every time `ActiveFileRevealer` fired on an editor change (e.g. user clicked a different file in Explorer), our tree grabbed keyboard focus from whatever the user was actually interacting with. The autoReveal path now only updates selection and scrolls the matching row into view; user-initiated reveals (OSC 7 from a terminal `cd`, "Reveal in File Tree" command) still focus the tree as before.
- **Auto-reveal no longer scrolls the viewport when the row is already visible.** Clicking through files in VS Code Explorer used to re-center the matching row on every click, even when it was already in view — jarring movement on rapid click-through. `Tree.revealElement` now bails out when the target row sits inside `[firstVisibleIndex, lastVisibleIndex]`; off-screen rows still scroll into the middle as before.
- **Folder badge clears correctly when all dirty descendants are cleaned.** A previously-dirty folder that got staged + committed (or whose dirty files were deleted) could stay tinted dirty forever for unexpanded subtrees, because no leaf walk would ever fire to reset the bucket. The host's authoritative "clean" stamp now explicitly clears the cached bucket on the next directory listing.
- **Watcher subscriptions no longer leak under concurrency or rapid root rotation.** Three concurrency hardening fixes: rapid `setRoot` rotations (A→B→C within ~150 ms) used to orphan host-side subscriptions because the unsubscribe carried a stale `rootGeneration`; concurrent `getChildren(samePath)` calls where one rejected used to tear down the shared subscription the surviving caller still needed; a subscriber callback disposing another mid-fanout used to still fire the disposed subscriber. Each path has dedicated regression tests.

### Internals

- New `src/providers/fsWatcherPool.ts` — singleton, refcounted by absolute path, injected into every `FileTreeHost` so the three concurrent hosts share OS watcher instances (`vscode.git`-style topology).
- New `src/webview/fileTree/folderDirtyState.ts` — `dominantDirtyStatus` helper + `FolderDirtyCounts` type, used by the renderer to pick the badge color.
- 4 new IPC message types (`request-subscribe-fs-changes`, `request-unsubscribe-fs-changes`, `fs-changes-invalidated`, `fs-rehydrate`) and a new optional `FileEntry.dirtyDescendantCountsByStatus` field.
- `Tree.flatRowEquals` helper drives the new diff-splice — compares full FlatRow shape (element + depth + expanded + hasChildren + matchData) so expand/collapse and other shape changes still re-render correctly.
- 4 specs landed: `fs-watcher-pool` (new), `fs-watcher-sync` (new), `folder-dirty-color` (new), `file-tree-rpc` (extended with subscribe/unsubscribe/invalidate/rehydrate requirements).

## [0.11.4] — 2026-05-23

### Added

- **VS Code-style git decorations in the file tree.** Files carry their git status as a single-letter badge (`M`, `A`, `U`, `D`, `C`, `R`) plus a color tint that follows the theme's `gitDecoration.*ResourceForeground` palette — modified yellow, untracked green, deleted red with strike-through, etc. Parent folders show a `•` indicator when any descendant is dirty (excluding `deleted` and `ignored`, matching VS Code Explorer). Works across sidebar, panel, and editor-tab file trees, driven by the built-in `vscode.git` extension — no separate dependency, and the tree degrades gracefully when git is disabled, uninstalled, or fails to activate.
- **Decoration updates land within ~100 ms.** Status changes from the editor, terminal, or external tools propagate through a debounced delta channel; multiple bursts coalesce into a single repaint per window. A monotonic per-path revision counter rejects out-of-order applies so a stale snapshot can't overwrite a fresher delta.

### Changed

- **Scrollbar gutter widened around the git status badge** so the `M`/`A`/`U` letter is never overlapped by the vertical scrollbar when the file list is scrollable.

## [0.11.3] — 2026-05-23

### Added

- **In-panel file-tree search.** New search icon in the file-tree header turns the header into a search input; type to fuzzy-match files inside the currently-focused folder (or the workspace root when nothing is focused). Two modes via toggle: **Filter** (only matches shown, ranked) and **Highlight** (all in-scope files, matches highlighted and sorted to top). Keyboard: `↑/↓` move between results, `Enter` opens the focused file, `Esc` exits search. Ranking uses a vendored subset of VS Code's `fuzzyScore` so results match VS Code Quick Open ordering.
- **Search excludes hidden / build artefacts / gitignored files.** Combined `files.exclude` + `search.exclude` user-setting globs are passed to the enumeration (so `node_modules`, `.git`, `.DS_Store`, dist artefacts never enter results), then `git check-ignore` drops anything matched by `.gitignore` (silently no-ops in non-git scopes). Up to 2000 files per scope; an overflow footer surfaces when the cap is reached.

### Changed

- **File tree now sorts directories before files** — alphabetic, locale-aware, case-insensitive within each group (e.g. `README` and `readme` sort together, `é` lands next to `e`). Matches VS Code Explorer's default. Applied at the `read-directory` RPC boundary; search results keep their own score/alphabetic ordering.

## [0.11.2] — 2026-05-23

### Added

- **Auto-reveal the active editor file in the File Tree.** Focusing an editor tab now expands ancestor folders, selects the file row, and scrolls it to the center of the tree — matching VS Code Explorer's `explorer.autoReveal`. Works across sidebar, panel, and editor file-tree hosts.
- **`anywhereTerminal.fileTree.autoReveal`** (`boolean | "focusNoScroll"`, default `true`) — set to `false` to disable, or to `"focusNoScroll"` to highlight the active file without scrolling the tree.
- **`anywhereTerminal.fileTree.autoRevealExclude`** (glob object, default `{ "**/node_modules": true, "**/bower_components": true }`) — paths matching any pattern (or whose ancestor folder matches) are skipped. Per-platform case sensitivity (case-insensitive on macOS/Windows, case-sensitive on Linux); invalid globs are dropped with a one-time console warning.

### Changed

- **Terminal vertical scrollbar is visible again and matches the file-tree style.** xterm v6's scrollbar was previously zeroed out via a 1px overview-ruler lane plus transparent slider colors. Those overrides are removed; `ThemeManager` now wires the slider to VS Code's `--vscode-scrollbarSlider-*` tokens, and `XtermFitService` stops reserving horizontal space for it — the scrollbar overlays the rightmost cells on hover/scroll instead of pushing columns inward.

### Fixed

- **No more background flicker when dragging a sidebar terminal wider.** `ResizeCoordinator` was re-classifying the webview as `panel` vs `sidebar` from the container's aspect ratio on every `ResizeObserver` tick and pushing that into `ThemeManager`, so once the user crossed the `width > height * 1.2` threshold the body background flipped between `--vscode-sideBar-background` and `--vscode-panel-background` (and xterm's `theme.background` followed). The real location is already baked into `data-terminal-location` at HTML-generation time, so the inference is removed entirely along with the unused `onLocationChange` callback and `WebviewShape` API.

## [0.11.1] — 2026-05-23

### Fixed

- **Cmd+Backspace / Ctrl+Backspace (kill-line) now works regardless of focus.** The shortcut was previously only routed through xterm.js's `attachCustomKeyEventHandler`, which only fires when xterm's hidden textarea has DOM focus. With the file tree open, clicking the tree shifted focus away from xterm, so `Cmd+Delete` in the terminal area became a no-op. Routed at the document-capture level alongside `Cmd+Left/Right` (start/end of line) and `Option+Left/Right` (word jump) so it reaches the active pane regardless of which sibling element holds focus.

### Changed

- **File-tree header root row** — uses the actual workspace folder name (no more `ALL-CAPS` text-transform, `0.05em` letter-spacing, or 11px font-size). The heading now reads as a normal folder name.
- **File-tree row indentation** matches VS Code Explorer's stepping: `paddingLeft = 20 + depth * 20px`. Step is `chevron-width (16) + flex gap (4) = 20px`, so a child row's leading glyph (chevron or file icon) sits roughly under its parent row's name first letter. Top-level rows sit just inside the header root name.

## [0.11.0] — 2026-05-23

### Added

- **Embedded File Tree panel.** Browse the workspace alongside the terminal without context-switching. Available in the sidebar, panel, and editor host — each location remembers its own open/closed state, position, and size independently. Defaults to visible on first install so the feature is discoverable.
- **Four positions per location** — `top`, `bottom`, `left`, `right`. Drag the resize sash on the edge facing the terminal to adjust; size is persisted per location. A move button in the header rotates through positions for the active host.
- **Toggle commands** — `AnyWhere Terminal: Toggle File Tree` (active focus) plus per-host variants `…Toggle File Tree (Sidebar)` / `…(Panel)` so commands routed from outside the webview land in the right place even when the user is focused elsewhere.
- **Reveal in File Tree** — command on terminal context (formerly "Reveal Working Directory in File Explorer"). Resolves the target via the extension-side cwd (OS process table), webview-side OSC 7 cwd, then last-known workspace root.
- **Drag a file row, drop on a terminal pane** — inserts the file's path at the cursor with shell-appropriate quoting. Re-uses the existing terminal drop handler.
- **VSCode-grade virtual scrolling and keyboard handling.** Powered by a vendored `vs/base/browser/ui/list/` (listWidget) under `src/vendor/vscode/` and a thin generic `Tree<T>` wrapper. Supports expand/collapse, arrow-key navigation, type-ahead, and WAI-ARIA Tree pattern (`role="tree"`, `aria-expanded`, `treeitem`).
- **`.gitignore` filtering** — directories and files ignored by git are hidden from the tree. Uses `git check-ignore -z --stdin` for batched NUL-delimited queries; falls back gracefully when git is unavailable.
- **Header with root folder + actions.** The header shows the workspace root name (click to expand/collapse) with a close button on the far right and the move button next to it. Root row is hidden from the virtual list so the header doubles as the root affordance.
- **Codicon-style chevron icons** via 2 inline SVG sprites. Codicon font is NOT vendored — bundle stays lean.

### Internals

- New `src/vendor/vscode/` tree mirroring upstream paths for future vendored widgets (inputbox, contextview, hover). Per-file Microsoft MIT headers preserved; full attribution in `THIRD_PARTY_NOTICES.md`.
- New `Tree<T>` wrapper with pluggable `ITreeDataSource<T>` + `ITreeRenderer<T>` interfaces mirroring AsyncDataTree's shape, so a future swap to the upstream async tree is a drop-in replacement.
- Extension ↔ webview RPC: `RequestReadDirectory` / `ReadDirectoryResponse` typed messages, batched per-request with `crypto.randomUUID()` IDs.
- Identity-stable `FileNode` cache in `FileSystemDataSource` — collapse + re-expand without re-fetch, with stale-async drop semantics on workspace root change.
- `FileTreeHost` companion object shared by the three terminal view providers (sidebar/panel/editor) — owns `rootGeneration`, workspace-folder change subscription, and the message-router fan-out.
- `FileTreeController` encapsulates webview-side bootstrap + the 5 router handlers (`readDirectoryResponse`, `workspaceRootChanged`, `toggle`, `setPosition`, `reveal`). `main.ts` constructs one controller per webview.
- `FileTreeSash` extracted from the panel — owns pointer capture, orientation math, and `--file-tree-size` updates.
- One-shot WebviewState migration from the legacy `fileTree` slot to per-location `fileTreeByLocation.sidebar` — runs synchronously on first `getState()`.

### Security

- OSC 7 cwd capture path is hardened: 16 KB encoded cap, 4 KB decoded cap, control-byte rejection, absolute-path check, and `(deleted)` suffix rejection.
- `git check-ignore` is invoked with `-z --stdin` (NUL-delimited stdin/stdout) — paths containing newlines or shell metacharacters cannot escape the protocol.



### Added

- **Tab rename.** Give any terminal tab a meaningful name via double-click on the tab label (inline input), right-click → `Rename Tab…`, command palette `AnyWhere Terminal: Rename Tab`, or `F2` when a terminal webview is focused. The custom name persists across window reloads (workspace-scoped). Clear the name (empty input) to revert to the live process title. OSC title updates continue to track the shell process but are subordinated to the custom name when one is set. Rename applies to root tabs only; split-pane process names are suppressed while a custom root name is active.

### Fixed

- **Hover preview markdown spacing** — the popup now matches VSCode's `.monaco-hover` compact margins. Previously, `white-space: pre` and browser-default heading/paragraph margins produced very airy popups (e.g. for `.reviews/round-1.md`). Switched to `white-space: normal; word-wrap: break-word` and applied VSCode's style budget: uniform `margin: 8px 0` for block elements, scaled-down heading sizes (h1 1.4em → h6 1em), tight `padding-left: 20px` on lists, and first/last-child margin resets. Fenced code blocks keep `white-space: pre` so long lines still scroll horizontally.
- **Hover preview "File not found" for paths wrapped by Claude Code / Codex CLI** — AI CLI tools emit their own `\n` + indent for continuation (not terminal soft-wrap), so `isWrapped` stays false and xterm pads the trailing cells with spaces. The prior heuristic required row 1 to fill the full column width, which never held for these CLIs. The path-join logic now uses last-token analysis (trailing non-whitespace must look like a tool-call prefix or contain an absolute-path root) and handles three continuation shapes: `"none"` (no join), `"marker"` (preserves whitespace seam for `· lines` regex), and `"in-path"` (strips row-1 trailing padding and row-2 leading indent).

## [0.10.0] — 2026-05-22

### Added

- **Hover preview for file paths in the terminal.** Hover over any clickable path and a 300 ms debounced popup shows the file's content with syntax highlighting (Shiki) and markdown rendering (markdown-it). Code is rendered with line numbers; the active line scrolls into view and gets a highlight bar when the path carries a line suffix.
- **Line-target suffixes recognised in the popup and on click**: `path:42`, `path:42:7`, `path(42,7)`, `path#L42`, `path:42-58` (line range), and Claude CLI's `Read(/abs/path · lines 180-299)` pattern. The popup scrolls the first line of the range to the centre.
- **Soft-wrap reassembly** — when a path wraps across terminal rows (e.g. `Read(...)` with a long absolute path), the link provider now joins the continuation rows so the hover and click resolve to the full path instead of just the visible fragment. Capped at 8 rows / 3000 characters and gated to tool-call prefixes or absolute-path tokens so unrelated full-width rows are never glued together.
- **"Open" button in the popup header.** Click to open the file in an editor tab — same flow as clicking the underlined path in the terminal.
- **Selectable popup content.** Text cursor inside the body; you can drag-select and copy out of the preview. Line numbers stay non-selectable so copy is clean.
- **Trust-policy gate with `Press Cmd / Ctrl to preview` override.** Dotfiles (`.env`, `.bashrc`), known-sensitive folders (`.git`, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.config`, `node_modules`, `.terraform`, `.terraform.d`, `.npm`, `.gem`, `.azure`, `.bluemix`, `.helm`), and files outside the workspace are blocked from auto-preview. Pressing Cmd (macOS) or Ctrl (Win/Linux) during the hover overrides the block for that one file.
- New settings:
  - `anywhereTerminal.hoverPreview.delay` (default `300` ms, range 100–2000) — debounce before the popup fetches the file.
  - `anywhereTerminal.hoverPreview.blockSensitive` (default `true`, `scope: "application"`) — turn the trust policy on/off. Application-scoped so a hostile workspace cannot flip it via `.vscode/settings.json`.

### Security

- Trust bases are `initialCwd + workspaceFolders` only. Shell-emitted OSC 7 / OSC 633 cwd is NEVER used as a trust base — a hostile process emitting `cwd=/` cannot silently disable the override gate.
- Memory-bounded reads via `node:fs/promises.open()` + a pre-allocated 1 MB buffer. Even if a file is swapped under us between `stat` and read (TOCTOU), the buffer caps total bytes — large files surface as `too-large` rather than blowing up the extension host.
- Symlinks pointing into the workspace are treated as out-of-workspace (`requires-confirmation`) because the lexical path doesn't tell us where the target lives.
- The webview-side override gesture requires both an active `requires-confirmation` state AND a fresh `Meta` / `Control` key press — incidental modifier-held keystrokes (Cmd+C, Cmd+Tab) no longer trigger a re-fetch with `override: true`.
- Markdown rendering runs with `html: false, linkify: false, validateLink: () => false` (no inline HTML, no auto-linkification, no link clicks from inside the preview).
- IPC payloads are validated: paths > 4096 chars, NUL bytes, non-string fields, and oversized `sessionId` / `requestId` are rejected before the resolver runs.

## [0.9.1] — 2026-05-21

### Fixed

- **Clickable path opens the right file when the shell has `cd`'d into the same directory the path is named for.** Example: terminal cwd is `/some/.../a`, output line contains `a/file.md`. Previously the resolver joined them into `/some/.../a/a/file.md` (which didn't exist) and surfaced "File not found". The resolver now fans each cwd source into multiple candidates via VS Code's reverse-segment match algorithm, so both `/some/.../a/a/file.md` and `/some/.../a/file.md` are tried — the second one opens.
- Clicking an absolute path no longer generates a bogus `<cwd>/<full-absolute-path>` concatenation candidate (Node's `path.join` was silently double-rooting the path). Absolute paths now short-circuit to a single candidate.
- Symlinks to directories are correctly treated as directories and fall through instead of being passed to `showTextDocument` (which would error). Uses the `Directory` bit mask rather than strict equality on `FileType`.

### Added

- **Tilde-prefixed paths** (`~/foo.md`) are detected and expanded to the user's home directory.
- **`file://` URIs** (`file:///abs/path.md`, percent-encoded `file:///abs/foo%20bar.md`) are claimed by the terminal detector and decoded via `vscode.Uri.parse`.
- **Wider path detection** — the bare-path regex now accepts `#`, `&`, `=`, `%`, `:`, backslashes, and non-ASCII Unicode (CJK, accents, etc.). Quoted forms continue to capture paths with spaces or parentheses. Two new noise filters reject `<identifier>=<value>` (e.g. `Version=1.2.3.4`) and bare `<package>@<version>` specs (e.g. `react@18.2.0`); patch-file names like `react@18.2.0.patch` are preserved.
- **Workspace basename fallback** for `findFiles` — when a clicked path like `a/file.md` doesn't match the workspace glob, the resolver retries with just `file.md` and filters results that end with `/a/file.md`. Both searches share one 2-second timeout budget.

### Security

- `file://` URIs with a non-empty authority are rejected. Without this guard, a hostile process writing `file://attacker.example.com/share/x.md` to the terminal would have triggered an SMB connection (and potentially leaked NTLM credentials) on click via the Windows UNC path that `vscode.Uri.parse` produces.
- Decoded `fsPath` is screened for embedded NUL bytes so log diagnostics always match what `fs.stat` actually opens.

## [0.9.0] — 2026-05-21

### Added

- **Clickable file paths in terminal output** — detected paths (`src/foo.ts:42:7`, Python tracebacks, Windows `C:\path`, etc.) are underlined and open in VS Code on click, jumping to the parsed line/column. Modal confirm before opening files outside the workspace.
- Relative paths resolve even when the shell has `cd`'d into a subdirectory. The resolver reads the live cwd from the OS process table (Linux/macOS) and OSC 7 / OSC 633 reports, falling back to a workspace search with QuickPick disambiguation when multiple files match.
- New setting `anywhereTerminal.fileSearch.maxResults` (default `50`) caps the QuickPick list for monorepos with many duplicate filenames.

### Security

- Shell-reported cwd is treated as a resolution hint only, never as a trust base — the out-of-workspace confirm modal cannot be bypassed by hostile terminal output.

## [0.8.0] — 2026-05-11

### Removed

- Plain-click cursor positioning (added in 0.6.1) is removed. The custom hijack handler emitted arrow-key escape sequences whenever the user clicked, which leaked raw `^[[D` / `^[[C` characters into the terminal whenever the shell was not at a readline prompt — most reproducibly during shell startup, after switching panel tabs, in the middle of long-running commands, and on multi-line input. Without shell integration (OSC 133/633) there is no reliable signal for "shell is at a prompt", so the heuristic guards (idle window, first-input gate, wrapped-input range) could not close every case. `Alt+Click` (Option+Click on macOS) continues to move the cursor via xterm.js's built-in `altClickMovesCursor` default.

## [0.6.2] — 2026-05-11

### Changed

- Updated marketplace description and keywords for clearer discovery (mentions split panes, tabs, theming, WebGL, Cursor).

## [0.6.1] — 2026-05-10

### Added

- Click cursor positioning in the terminal pane (`ClickCursorHandler`) — click in the terminal to move the shell cursor. (Removed in 0.8.0 — see entry above.)

## [0.6.0] — 2026-05-09

### Added

- Cursor IDE integration — the extension now installs and runs against Cursor 3.2.21+ (VS Code 1.105.1 baseline). Includes host-compatibility spec and discovery docs.
- Asimov core skill set, MCP server configurations, and updated environment settings (preceding commit, shipped together with 0.6.0).

## [0.5.0] — 2026-05-07

### Added

- Bundled `asm` binary for build/test tooling.

### Changed

- Tab bar layout is now responsive — tabs collapse and overflow gracefully on narrow views.

## [0.4.0] — 2026-05-06

### Added

- Confirmation prompt before opening URLs from terminal output.

### Fixed

- `Cmd+Click` on URLs now opens links in the default browser instead of inside the editor.
- `Shift+Enter` and macOS line/word navigation keys (`Cmd+←/→`, `Option+←/→`, `Cmd+Backspace`) are intercepted correctly and forwarded to the shell.

## [0.3.2] — 2026-03-22

Release-only bump — same code as 0.3.1.

## [0.3.1] — 2026-03-09 → 2026-03-20

### Added

- Insert file path into the terminal via the Explorer right-click menu, plus `Shift+drag` from the Explorer.
- `Cmd+Backspace` (macOS) / `Ctrl+Backspace` shortcut to kill the input line (sends `Ctrl+U`).

### Changed

- Major refactor of the webview terminal:
  - Extracted `TerminalFactory`, split renderer, and flow control into dedicated modules.
  - Extracted `WebviewStateStore`, `ResizeCoordinator`, `MessageRouter` from `main.ts`.
  - Extracted `ThemeManager`, `BannerService`, `XtermFitService` from `main.ts`.
- Introduced skill locking and comprehensive webview terminal refactoring documentation.

### Fixed

- Acknowledgement routing for backpressure messages.
- Resize timer leaks on rapid pane changes.
- Render service guard for disposed panes.

## [0.3.0] — 2026-03-07

### Added

- Extension settings: `shell.macOS`, `shell.args`, `scrollback`, `fontSize`, `fontFamily`, `cursorBlink`, `defaultCwd`.
- Advanced theme integration that follows VS Code dark / light / high-contrast themes.
- Performance optimization pass: adaptive output buffering, WebGL hardening, overflow protection, per-session memory tracking.
- Right-click context menu inside terminal panes (clear, kill, new, split, close) and Escape key handling.
- Enhanced terminal status feedback and error handling — visible status banners on failure.

### Changed

- Improved context menu command targeting and terminal fitting; removed unused native clipboard commands.

## [0.2.5] — 2026-03-04 → 2026-03-07

### Added

- **Bottom Panel terminal view** — drop-in replacement for the built-in panel terminal.
- **Editor Terminal** — open a terminal as an editor tab via `WebviewPanel`.
- **Session Manager** — central registry coordinating sessions across Sidebar / Panel / Editor.
- **Multi-tab UI** — tab bar, switching, and keyboard shortcuts for multiple sessions per view.
- **Secondary Sidebar** support — move the terminal to the right pane via the command palette.
- **Split panes** — binary split tree, split container UI, drag-to-resize handles, recursive splitting.
- Split commands, keybindings (`Cmd+\`, `Cmd+Shift+\`), and pane focus management.
- Last-pane-close handling and visible separator between split panes.
- View-specific commands for Sidebar vs. Panel (tab bar buttons).
- Context menu actions on split panes: close, split vertical, split horizontal.
- Dynamic terminal location inference and theme application based on host view.
- View lifecycle resilience: terminals survive view collapse/show cycles.

### Changed

- Hide xterm.js native scrollbar in favor of VS Code's scrollbar styling.
- Refined deployment scripts.

### Fixed

- Ghost tabs caused by stale UUIDs after pane close.
- Wrong split-button icons in the title bar.
- Invalid tab restoration on view re-mount.

## [0.2.4] — 2026-03-04

### Changed

- General UI polish across the sidebar webview.

## [0.2.1] — 2026-03-04

Release-only bump (git tag `v0.2.1`).

## [0.2.0] — 2026-03-04

Release-only bump (git tag `v0.2.0`).

## [0.1.1] — 2026-03-04

### Added

- WebGL addon for xterm.js — GPU-accelerated rendering, smooth on Retina displays.
- Deployment scripts (`deploy`, `deploy:vsce`, `deploy:ovsx`, `deploy:patch`, `deploy:minor`).

### Fixed

- Double-input issue caused by duplicate keystroke listeners.

### Changed

- Disabled Biome's `useNamingConvention` lint rule for a more flexible naming style.

## [0.0.1] — 2026-03-03 → 2026-03-04

Initial scaffold — never published, but the foundation for everything that followed.

### Added

- Webview-hosted xterm.js terminal in the **Primary Sidebar** via Activity Bar entry.
- PTY integration through `node-pty` with `PtyManager` and `PtySession` for dynamic process management.
- IPC layer between extension host and webview with output buffering and flow control.
- Clipboard support (`Cmd+C` / `Cmd+V`).
- Project scaffolding: TypeScript, esbuild bundling, Biome linting, Vitest unit tests, VS Code integration tests.
- Initial design and planning documentation.

[v0.2.0]: https://github.com/huybuidac/anywhere-terminal/releases/tag/v0.2.0
[v0.2.1]: https://github.com/huybuidac/anywhere-terminal/releases/tag/v0.2.1
