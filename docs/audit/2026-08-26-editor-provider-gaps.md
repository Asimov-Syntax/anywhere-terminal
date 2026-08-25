# Audit — editor-surface gaps and dead protocol

Found while syncing `docs/design/*` to code (2026-08-26). Every claim below was
grep-verified against the tree at `c242ecf`+merge. **Nothing here is fixed** — this
file exists so the findings are not lost when the doc sync lands.

Severity is deliberately conservative: a thing is only "user-visible" if a user can
reach it without a debugger.

## A. User-visible

### A1. The AI Vault renders in an editor tab but every action is a no-op

`webviewHtml.ts:32-43` states the HTML shell is identical for all three locations —
only `data-terminal-location` differs. `main.ts:956-957` constructs `VaultPanel`
whenever `#vault-panel` exists, with no location gate. So the vault UI **is present**
in an editor-hosted terminal.

But `TerminalEditorProvider` handles exactly one of the sixteen vault messages —
`requestSubagentPreview` (`TerminalEditorProvider.ts:639`). The other fifteen fall
through to `default: break` (`TerminalEditorProvider.ts:659-660`). No error, no log.

`TerminalViewProvider` handles all fifteen.

**Effect:** open a terminal as an editor tab, use the vault — it looks alive and does
nothing.

### A2. Right-click → split inside an editor terminal splits the wrong surface

`getProviderBySessionId` (`extension.ts:548-559`) scans only
`[sidebarProvider, panelProvider]`. For a session owned by an editor panel it returns
`undefined`, so `getCtxProvider` (`:566-574`) falls back to `getFocusedProvider()`,
which itself can only ever return a view provider (`:276-284`).

**Effect:** the new pane appears in the sidebar or panel rather than in the editor tab
the user right-clicked.

## B. Latent — unreachable today, will bite when the path opens

### B1. `requestSplitSession` has no editor handler

Handled only at `TerminalViewProvider.ts:1144`; sent from `main.ts:576` and `:611`.

Currently unreachable from an editor surface: the round-trip starts with the extension
posting `splitPane` / `splitPaneAt`, and both post through a view provider's
`view.webview` (`extension.ts:408`, and `postToCtxWebview` at `:577-583`). An editor
webview never receives the trigger, so it never sends the reply.

This is **not** a silent drop today. It becomes A2-shaped the moment split is wired to
editor panels.

### B2. `focus` has no editor handler — live, but inert

Reachability now established, and it is **not** B1's shape. `focus` is posted from a
plain DOM listener, `document.addEventListener("focusin", ...)` at `main.ts:1298-1321`,
independent of any host message. So every focus inside an editor-hosted terminal does
post a message that nothing handles (`TerminalViewProvider.ts:1197` is the only case).

Impact today is nil, which is why this stays in B: the handler only sets
`_lastActivePaneSessionId` and calls `markFocused()`, and both feed command routing
that can only ever target a view provider (`getFocusedProvider`, `extension.ts:276-284`).
Nothing an editor panel could contribute is read back. It becomes real the moment any
command routes to editor panels.

### A3. `anywhereTerminal.clearTerminal` never clears the visible screen

`ClearMessage` is declared as a **user-requested W→E** message — "User requested
terminal clear (scrollback + viewport)", `messages.ts:163-168`. But `doClearTerminal`
posts it the wrong way down the wire: `extension.ts:399` sends `{type:"clear", tabId}`
*to* the webview. `MessageRouter` has a `ctxClear` case (`:171`) and no `clear` case;
unknown types are dropped silently (`:258`).

**Effect:** the command clears host-side scrollback and the snapshot, and leaves the
xterm viewport untouched. Only the context-menu path (`ctxClear`, `main.ts:618`)
actually clears what the user sees.

### A4. Cmd+K clears the wrong session in a split pane

`InputHandler.ts:106` calls `terminal.clear()` on the pane it is attached to, then
`:107` posts `{type:"clear", tabId: getActiveTabId()}` — and `getActiveTabId` is
`() => store.activeTabId`, the **root tab** id (`TerminalFactory.ts:180`).

**Effect:** with focus in a split pane, the viewport clears correctly but the host wipes
the *root tab's* scrollback cache, tracked commands and snapshot. The context-menu path
is correct — `ctxClear` carries an explicit `sessionId` (`main.ts:619`).

## C. Dead protocol and stale comments — no runtime effect

| # | Finding | Evidence |
|---|---------|----------|
| C1 | `persistPanelId` is sent but nothing handles it. `TerminalEditorProvider.ts:762-765` says the webview persists the id itself via `vscode.setState`, making the message vestigial. | declared `messages.ts:664`, sent `main.ts:700`, zero handlers |
| C2 | `OUT_OF_WORKSPACE` is documented as an error code but no emitter exists. Removal was deliberate. | `messages.ts:968,987`; recorded at `fileTreeRpc.integration.test.ts:151` |
| C3 | `filePreviewResult.truncated` doc comment says a 500-line cap; the real cap is 1000. | `messages.ts:876-877` vs `readFileForPreview.ts:29` |
| C4 | `FileTreeHost.handleMessage`'s doc comment shows an `if (host.handleMessage(...)) break;` pattern; both callers discard the return value. | `fileTreeHost.ts:228-238`; callers `TerminalViewProvider.ts:1255`, `TerminalEditorProvider.ts:602` |


## C2. Cosmetic — real, but not user-visible

| # | Finding | Evidence |
|---|---------|----------|
| C5 | `TERM_PROGRAM_VERSION` is always `"0.0.0"`. The lookup uses `anywhere-terminal.anywhere-terminal`; the real id is `huybuidac.anywhere-terminal` (`publisher` + `name`), so it always misses and falls to the default. Only affects an env var inside the spawned shell. | `PtyManager.ts:216-217` vs `package.json:2,6` |
| C6 | The node-pty failure toast says "Requires VS Code >= 1.109.0"; `engines.vscode` is `^1.105.0`. | `extension.ts:42` vs `package.json:41` |
| C7 | `InputHandler`'s `case "backspace"` (`:119`) is unreachable — the document-capture handler intercepts Cmd/Ctrl+Backspace first and stops propagation. | `main.ts:1116,1124` |

## Common root

A1, A2, B1 and B2 share one cause: `TerminalEditorProvider` was not kept in step as
vault and split panes were added, and several `extension.ts` helpers hardcode
`[sidebarProvider, panelProvider]`. A fix that only patches individual message cases
will drift again — the surface-dispatch helpers are the thing to address.

---

# Audit — doc/code accuracy (second pass)

Found during the same sync, in the **worktree blueprint docs**, which are on the
never-touch list for this pass because they describe an unimplemented feature. These
are not sync drift — they are claims about *already-shipped* code that are wrong.

| # | Where | Claim | Reality |
|---|-------|-------|---------|
| D1 | `docs/design/agent-hook-server.md:264` | `anywhereTerminal.cursorAgent.hooks.enabled` has scope `application` | `package.json:104` declares `"scope": "machine"` |
| D2 | `docs/design/agent-hook-server.md:43` | typed install failures are `lock-unavailable`, `write-failed`, `unsupported-config` | `CursorHookInstaller.ts:45` also has `windows-probe-failed`; the remove result (`:50`) adds `not-installed` |
| D3 | `src/vault/readers/claudeReader.ts:377,415` | comments say "the 64 KB ai-title tail read" | `TAIL_SCAN_BYTES = 256 * 1024` (`claudeRecords.ts:89`); that file's own comment records the 64 KB → 256 KB change. Comment-only — behaviour is 256 KB |

D3 is a code comment, not a doc. Listed here so it isn't lost.

## Not a defect — recorded so it isn't re-litigated

`agent-hook-server.md:189-190` plans a `waiting` turn state from Claude's
`PreToolUse` / `PermissionRequest`. No shipped hook produces `waiting` today: the
`EVENT_EFFECTS` table yields only `clear` / `working` / `quiet`
(`CursorHookRuntime.ts:43,46-59`), and the only live source of `waiting` is the
screen-scraping approval detector (`CursorApprovalDetector.ts:47`). That is planned
new behaviour, consistent with the doc's own ":344 Cursor's existing behaviour passes
unchanged" — not drift. Flagged only so DESIGN.md § 15's turn-state ↔ activity mapping
is not read as already-implemented.


---

# Audit — build, release and gate integrity

From the build/packaging sweep. Separate from the editor-surface cluster above.

| # | Finding | Evidence |
|---|---------|----------|
| E1 | `scripts/measure-vendor-delta.mjs` is orphaned — no `package.json` script references it, so the 650 KB vendor-growth budget **never runs**. | `package.json` scripts; `measure-vendor-delta.mjs:41` |
| E2 | `pnpm test` has no config. `"test": "vscode-test"` but no `.vscode-test.mjs`/`.js`/`.cjs` exists anywhere in the repo. | `package.json` scripts |
| E3 | Gate comments quote stale ceilings: both `check-bundle-size.mjs:30` and `measure-vendor-delta.mjs:35` still say 3.6 MB (real: 4.5 MB, `check-bundle-size.mjs:16`); `check-bundle-size.mjs:35-36` says the vendor delta is gated at ≤450 KB (real: 650 KB). | as cited |
| E4 | No CI. No `.github/workflows`; every gate runs only locally via `pnpm package` / `scripts/release.sh`. | repo tree |
| E5 | `ShellNotFoundError` is unreachable by construction — `detectShell` returns a last-resort default unconditionally. | `PtyManager.ts:167`; class at `errors.ts:43-51` |
| E6 | `ErrorCode.BufferOverflow` is referenced by nothing — no class, no throw, no test. Overflow is handled by silent FIFO eviction in `OutputBuffer.append`. | `errors.ts:10` |
| E7 | `safeSendWithRetry` results are never inspected — every call site is `void`-ed, so an exhausted retry of `init`/`tabCreated` vanishes with no log. | call sites; `TerminalViewProvider.ts:1471-1498` |
| E8 | Four copies of `safePostMessage` and two of `safeSendWithRetry`; the latter have **diverged** — only the provider copy accepts `shouldAbort`. | `TerminalViewProvider.ts:1455`, `TerminalEditorProvider.ts:885`, `SessionManager.ts:1453`, `extension.ts:822` |
| E9 | Split keybindings skip the editor surface — `ctrl+\` / `ctrl+shift+\` `when` clauses name only `anywhereTerminal.sidebar` and `anywhereTerminal.panel`. Same family as A2/B1 above. | `package.json:571-584` |

## Already known — not a new finding

`pnpm lint` (`biome check --write --unsafe src/`) running inside `pnpm package`, which
`release.sh` invokes *after* its step-1 clean-tree check, is already recorded from a
prior session (drift left uncommitted; the release commit stages only `package.json` +
`CHANGELOG.md`; the dirty tree then fails the next release's precondition at
`release.sh:39`).

One angle the existing record does **not** state and that is worth keeping: because the
autofix is `--unsafe` and runs inside the packaging step, a fix can land in the shipped
VSIX without review. A prior session also observed `--unsafe` breaking the build by
removing a write-only private field's declaration while leaving its assignments — which
`vitest` cannot catch, since esbuild strips types.

## F. Misleading log strings

`TerminalFactory` logs "falling back to **canvas** renderer" on WebGL context loss and
"using **canvas** fallback for all future terminals" on construction failure
(`src/webview/terminal/TerminalFactory.ts:123,127`). There is no canvas addon — only
`@xterm/addon-webgl` is a dependency (`package.json:627`), and `grep -rn "addon-canvas"`
over `package.json` and `src/` returns nothing. The real fallback is xterm's built-in DOM
renderer.

Harmless at runtime, but the strings sent the old `DESIGN.md` — and this sync's first draft
of it — into claiming a three-tier WebGL → canvas → DOM chain that does not exist.
