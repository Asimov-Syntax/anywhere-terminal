# AnyWhere Terminal — System Design

A VS Code / Cursor extension that runs real terminals in every UI surface, and reads the
on-disk transcripts of AI coding CLIs so past sessions can be browsed and resumed.

This file is the index and the architecture-level view. Every subsystem has its own design
doc under `design/`; nothing here restates what those own.

## 1. Architecture Overview

Three layers with a hard boundary between them. The Extension Host owns processes, the
filesystem, and all VS Code API access. The WebView owns rendering and input. Nothing
crosses except serialized messages.

```mermaid
graph TB
    subgraph WV["WebView — browser sandbox, one per surface"]
        TERM["Terminals<br>xterm.js, tabs, split panes"]
        TREE["File tree"]
        VAULTUI["AI Vault panel<br>list + floating preview"]
        LINKS["Link + hover-preview layer"]
    end

    IPC["postMessage bridge<br>discriminated unions, src/types/messages.ts"]

    subgraph EH["Extension Host — Node.js"]
        PROV["Providers<br>sidebar · panel · editor"]
        SM["SessionManager<br>+ OutputBuffer, snapshots, storage"]
        PTY["PtyManager / PtySession<br>+ shell integration"]
        FTH["FileTreeHost<br>+ git decorations, watchers"]
        VAULT["VaultService<br>+ per-agent readers"]
        HOOKS["Cursor hook runtime"]
    end

    subgraph OS["Outside the extension"]
        SHELLS["Shell processes"]
        STORES["Agent transcript stores<br>~/.claude · ~/.codex · Cursor · OpenCode"]
    end

    TERM <--> IPC
    TREE <--> IPC
    VAULTUI <--> IPC
    LINKS <--> IPC
    IPC <--> PROV
    PROV --> SM
    PROV --> FTH
    PROV --> VAULT
    SM --> PTY
    PTY --- SHELLS
    PTY -.OSC 7 / 633.-> SM
    VAULT --- STORES
    HOOKS -.session state.-> SM
    SHELLS -.write.-> STORES
```

Two facts about this diagram carry most of the design weight:

- **A surface is a WebView, and every surface runs the same bundle.** Sidebar, panel and
  editor differ only by `data-terminal-location` on `<body>`. This is why a feature added to
  the shared bundle appears in all three surfaces whether or not its host handler exists —
  see the editor-surface gaps in `../audit/`.
- **The vault reads files the extension does not write.** Agent CLIs own those stores; the
  extension is a reader that must tolerate formats changing underneath it.

## 2. Component Design

### 2.1 File Structure

First-party source, by line count. Test files sit beside the code they cover (`*.test.ts`)
and are excluded from these counts.

| Path | Lines | Holds |
|------|-------|-------|
| `src/extension.ts` | 881 | activate, command registration, surface wiring |
| `src/commands/` | 397 | terminal and export commands |
| `src/providers/` | 8 295 | the three surface providers, panel serializer, `FileTreeHost`, git decorations, fs watcher pool, link and preview resolution |
| `src/session/` | 4 649 | `SessionManager`, `OutputBuffer`, snapshot pipeline, `SessionStorage`, shell-integration consumer |
| `src/pty/` | 1 509 | `PtyManager`, `PtySession`, OSC parser, process queries |
| `src/vault/` | 3 828 | `VaultService`, cache, launch, rename |
| `src/vault/readers/` | 9 068 | per-agent transcript parsers, shared detail pipeline |
| `src/cursor/` | 1 171 | hook install, runtime, executable resolution |
| `src/types/` | 1 486 | `messages.ts` (the IPC contract), `errors.ts` |
| `src/settings/` | 345 | settings readers |
| `src/shared/` | 74 | values used by both host and webview |
| `src/utils/` | 62 | |
| `src/webview/` | 2 869 | `main.ts`, `InputHandler`, split panes, tab bar, drag-drop |
| `src/webview/vault/` | 5 978 | vault list, preview, floating window |
| `src/webview/fileTree/` | 4 776 | tree, search, row actions |
| `src/webview/links/` | 3 264 | path detection, hover preview |
| `src/webview/terminal/` | 1 050 | `TerminalFactory`, activity tracking, title gating |
| `src/webview/messaging/` | 409 | `MessageRouter` |
| `src/webview/split/` | 396 | split tree renderer |
| `src/webview/state/` | 382 | persisted webview state |
| `src/webview/resize/` | 268 | fit and debounce |
| `src/webview/ui/` | 224 | banners, tab-bar helpers |
| `src/webview/theme/` | 189 | `ThemeManager` |
| `src/webview/flow/` | 53 | flow-control acks |
| `src/vendor/` | 39 827 | vendored VS Code sources (126 files) and Seti icons |

`src/vendor/` is upstream VS Code code pinned to a known SHA, not our design surface — see
[build-system.md](design/build-system.md) for how it is vendored and gated.

### 2.2 Surfaces

| Surface | API | Registration | Notes |
|---------|-----|--------------|-------|
| Primary Sidebar | `WebviewViewProvider` | `viewsContainers.activitybar` | |
| Bottom Panel | `WebviewViewProvider` | `viewsContainers.panel` | |
| Editor Area | `WebviewPanel` | `createWebviewPanel()` | Own provider; restored by `TerminalPanelSerializer` |
| Secondary Sidebar | `WebviewViewProvider` | user "Move View" | Same provider as the primary sidebar |

Sidebar and panel share one `TerminalViewProvider` class with one instance each; the editor
area has a separate `TerminalEditorProvider`. That asymmetry is the source of the
editor-surface gaps recorded in `../audit/`.

## 3. Data Flows

| Flow | Document |
|------|----------|
| Terminal initialization | [flow-initialization.md](design/flow-initialization.md) |
| User input round-trip | [flow-user-input.md](design/flow-user-input.md) |
| Clipboard and image paste | [flow-clipboard.md](design/flow-clipboard.md) |
| View collapse / disposal / host restart | [flow-view-lifecycle.md](design/flow-view-lifecycle.md) |
| Multi-tab and split panes | [flow-multi-tab.md](design/flow-multi-tab.md) |

## 4. Subsystem Designs

| Subsystem | Document |
|-----------|----------|
| Message protocol | [message-protocol.md](design/message-protocol.md) |
| PTY spawning and shell detection | [pty-manager.md](design/pty-manager.md) |
| Session lifecycle and snapshots | [session-manager.md](design/session-manager.md) |
| Output buffering and flow control | [output-buffering.md](design/output-buffering.md) |
| xterm.js integration and split panes | [xterm-integration.md](design/xterm-integration.md) |
| Theme integration | [theme-integration.md](design/theme-integration.md) |
| Resize handling | [resize-handling.md](design/resize-handling.md) |
| Keyboard and input | [keyboard-input.md](design/keyboard-input.md) |
| WebView providers and surfaces | [webview-provider.md](design/webview-provider.md) |
| File tree | [file-tree.md](design/file-tree.md) |
| Link detection and hover preview | [link-detection.md](design/link-detection.md) |
| AI Vault | [vault.md](design/vault.md) |
| Vault transcript readers | [vault-readers.md](design/vault-readers.md) |
| Agent CLI integration | [agent-cli-integration.md](design/agent-cli-integration.md) |
| Error handling | [error-handling.md](design/error-handling.md) |
| Build system | [build-system.md](design/build-system.md) |

Planned, not yet implemented — see § 8:
[worktree-model.md](design/worktree-model.md) ·
[worktree-agent-presence.md](design/worktree-agent-presence.md) ·
[worktree-rpc.md](design/worktree-rpc.md) ·
[worktree-actions.md](design/worktree-actions.md) ·
[worktree-panel-ui.md](design/worktree-panel-ui.md) ·
[agent-hook-server.md](design/agent-hook-server.md)

## 5. Performance Design

Two mechanisms carry terminal throughput; both are specified in
[output-buffering.md](design/output-buffering.md) and
[resize-handling.md](design/resize-handling.md).

```mermaid
flowchart LR
    PTY["pty.onData"] --> OB["OutputBuffer<br>coalesce + adapt interval"]
    OB -->|"flush"| WV["WebView"]
    WV --> X["xterm.write"]
    WV -.->|"ack chars"| FC["Flow control"]
    FC -.->|"pause above high watermark<br>resume below low"| OB
```

- **Two-layer buffering.** The host coalesces PTY output and flushes on an adaptive timer
  whose interval moves between a floor and a ceiling with measured throughput.
- **Credit-based flow control.** The WebView acks consumed characters; the host pauses the
  PTY above a high watermark and resumes below a low one, so a runaway writer cannot
  outrun rendering.
- **Resize is debounced and computed in the WebView**, which measures cell dimensions and
  sends only settled `cols`/`rows`.

Rendering loads the WebGL addon where available. On context loss or construction failure it
falls back to xterm's built-in DOM renderer — there is no canvas addon — and a `webglFailed`
latch makes every later terminal skip WebGL too (`src/webview/terminal/TerminalFactory.ts:117-130`).

## 6. Security

### 6.1 WebView Content Security Policy

`default-src 'none'` with per-load nonce-gated scripts; styles, fonts and images limited to
the webview source, plus `blob:`/`data:` images for pasted-image previews. Exact directives
and rationale: [webview-provider.md](design/webview-provider.md).

### 6.2 Terminal output is attacker-controlled

Anything rendered in a terminal may come from a hostile process. Two consequences are
designed for rather than assumed away:

- **Links are resolved by the host, never by a webview-supplied path.** Path candidates are
  re-resolved against the session's cwd and the workspace before anything opens.
- **Hover preview blocks sensitive paths by default** and caps how much it reads.

See [link-detection.md](design/link-detection.md).

### 6.3 PTY and vault

Shells inherit the user's environment with no elevated privileges, are children of the
Extension Host, and are killed on deactivation. Vault messages carry an entry id only — the
host re-resolves every on-disk location itself, and reads agent stores with bounded scans
and a read-only SQLite snapshot. See [vault.md](design/vault.md).

## 7. Testing Strategy

| Layer | Runner | Scope |
|-------|--------|-------|
| Unit | vitest (`pnpm test:unit`) | The bulk of the suite; host and webview modules, jsdom for webview |
| Integration | vitest | File-tree RPC, git decorations, extension activation |
| VS Code host | `vscode-test` (`pnpm test`) | See the gap noted in [build-system.md](design/build-system.md) § 14 |

Build gates run at package time, not in CI: type-check, lint, bundle-size ceiling, vendor
header check, VSIX contents check. [build-system.md](design/build-system.md) § 14 records
which gates are wired and which are not.

### 7.1 Manual Test Matrix

| Test case | Sidebar | Panel | Editor | Secondary |
|-----------|---------|-------|--------|-----------|
| Shell prompt appears | [ ] | [ ] | [ ] | [ ] |
| Resize and reflow | [ ] | [ ] | [ ] | [ ] |
| Copy / paste / image paste | [ ] | [ ] | [ ] | [ ] |
| Ctrl+C interrupts | [ ] | [ ] | [ ] | [ ] |
| Tabs and split panes | [ ] | [ ] | [ ] | [ ] |
| Full-screen app (vim) | [ ] | [ ] | [ ] | [ ] |
| Theme matches | [ ] | [ ] | [ ] | [ ] |
| Collapse / expand recovery | [ ] | [ ] | [ ] | [ ] |
| Host restart restores sessions | [ ] | [ ] | [ ] | [ ] |
| File tree actions | [ ] | [ ] | [ ] | [ ] |
| Vault list, preview, resume | [ ] | [ ] | [ ] | [ ] |
| Heavy output (`find /`) | [ ] | [ ] | [ ] | [ ] |

The editor column is where this matrix earns its keep — several features are present in the
editor surface but unhandled by its host provider (`../audit/`).

## 8. Worktree & Agent Presence Subsystem

A fourth view inside the AI Vault panel: the git worktrees of the workspace's repositories,
with the agents running inside each one. The view answers a question the session list cannot
— *where is work happening right now, and what is blocked* — and turns each worktree into a
place to act (open, create, remove, launch an agent).

### 8.1 Architecture

```mermaid
graph TB
    subgraph EH["Extension Host"]
        WS["workspace.workspaceFolders<br>+ vscode.git API"] --> DISC["Worktree discovery<br>rev-parse + worktree list"]
        DISC --> TREE["WorktreeTree cache<br>keyed by repoId"]
        SM["SessionManager<br>(this window's panes)"] --> PRES["Presence projection"]
        REG["Claude PID registry"] --> PRES
        VS["VaultService<br>(transcripts)"] --> PRES
        HOOK["Agent hook runtime<br>(generalized from src/cursor)"] -.-> PRES
        TREE --> PRES
        WATCH["Watcher pool<br>.git/worktrees, HEAD"] --> DISC
        PRES --> PUSH["worktreeTreeResponse"]
        ACT["Worktree actions<br>git worktree add/remove/lock/prune"] --> DISC
    end
    PUSH -->|postMessage| WV
    subgraph WV["WebView — AI Vault panel"]
        SEGCTL["Segmented control<br>Recent / Agent / Folder / Worktree"]
        SEGCTL --> BODY{"Active view"}
        BODY -->|sessions| LIST["Session list"]
        BODY -->|worktree| WTREE["Worktree tree"]
    end
    WTREE -->|actions| ACT
```

Four properties define the subsystem:

1. **The worktree tree and the agent presence projection are separate models**, pushed
   together in one message. Worktrees come from git and change rarely; presence comes from
   live panes and changes constantly. Merging them would let one stale git read erase live
   agent evidence.
2. **Evidence is never collapsed to a single status.** Every agent row carries what we know,
   where it came from, and how strongly — so the dot, the icon, and any future notifier each
   apply their own rule.
3. **Scope is this VS Code window**, with one deliberate exception: an agent running in a
   worktree from another window appears as an explicitly labelled `external` row. A worktree
   view that reports "nobody is working here" while an agent is mid-turn is worse than one
   that admits it cannot reach that pane.
4. **The host owns freshness.** Watcher-driven, debounced, pushed. Nothing polls except the
   machine-wide session registry, which emits no events.
5. **Discovery and presence are owned once per window, not once per surface.** Three webview
   surfaces render this view; if each drove its own watchers, git invocations, and registry
   scans, a user with the sidebar and an editor panel open would pay for everything twice.
   One owner per extension host with attached clients — the shape
   `VaultWatchCoordinator` already uses — and source work pauses only when *no* client has the
   Worktree view active.

**Remote development.** The blueprint assumes the extension runs workspace-side, which it
does: it declares `main` and loads `node-pty`, so in SSH, WSL, and dev-container windows VS
Code runs it on the remote, where git, the ptys, `~/.claude`, and the hook runtime all live
together. Nothing in the design reaches across the local/remote boundary, so no additional
work is required — but the assumption is recorded rather than left implicit. Browser-only
hosts (github.dev) are already unsupported for an unrelated reason: `node-pty` cannot load
there.

### 8.2 Component responsibilities

| Concern | Owner | Design |
|---------|-------|--------|
| Repo roots, worktree enumeration, identity, cache, watch | Extension host, new worktree module | [worktree-model.md](design/worktree-model.md) |
| Per-pane title and waiting evidence reaching the host | Each webview surface reports; the host aggregates by pane id | [worktree-agent-presence.md](design/worktree-agent-presence.md) § 3.3 + § 13.6 below |
| Pane→worktree mapping, agent identity, activity, external rows, subagents | Extension host, new presence module | [worktree-agent-presence.md](design/worktree-agent-presence.md) |
| Message contract and validation | `src/types/messages.ts` + the view provider | [worktree-rpc.md](design/worktree-rpc.md) |
| The fourth segment, tree rendering, states, keyboard | WebView, alongside `VaultPanel` | [worktree-panel-ui.md](design/worktree-panel-ui.md) |
| Create / remove / lock / prune / launch | Extension host, extending the vault launcher with a fresh-launch contract | [worktree-actions.md](design/worktree-actions.md) |
| Authoritative status and live subagent rosters | Extension host, **generalizing the existing Cursor hook runtime** to multiple agents | [agent-hook-server.md](design/agent-hook-server.md) |

### 8.3 Reuse — what this subsystem does not rebuild

| Existing capability | Location | Used for |
|---------------------|----------|----------|
| `vscode.git` API types + repository state events | `src/providers/git.ts` | Repo roots without re-implementing repo detection; branch changes for repos VS Code already has open |
| Root-aware path containment | `src/utils/pathBoundary.ts` | "Is this folder inside that worktree / repo root?" — extracted from `gitDecorationProvider.ts`, which had the only correct implementation of filesystem-root, separator-drift and drive-case handling |
| Watcher pool with per-event-kind debounce | `src/providers/fsWatcherPool.ts` | Watching `.git/worktrees` and `HEAD` — via `subscribePattern` only, since `subscribe()` ignores change events. The pool does **not** pause on window blur, and it currently cannot report a watcher-creation failure to its caller |
| Loopback hook runtime with per-session tokens | `src/cursor/CursorHookRuntime.ts` | **The** agent hook endpoint, widened from one agent to several. Already does constant-time token compare and liveness re-check at use time |
| Hook config installer with cross-process lock + atomic rename | `src/cursor/CursorHookInstaller.ts` | Writing managed entries into an agent's settings file without losing a concurrent edit |
| Hook enable/disable controller | `src/cursor/CursorHookController.ts` | Settings-driven lifecycle; one controller for all agents, never two |
| Pty env contributor seam | `SessionEnvironmentContributor`, `SessionManager.ts:101` | Reaching the agent at spawn — **currently a singular slot that must widen** |
| Shared watch coordinator with attached clients | `src/providers/VaultWatchCoordinator.ts` | The pattern for owning discovery once per window rather than once per webview surface |
| Per-pane activity projection **rules** | `src/webview/terminal/TerminalActivityTracker.ts` | The projection logic only. The tracker instance itself is webview-side and sees just its own surface's panes, so presence cannot consume it — see § 13.6 |
| Live Claude session registry | `src/vault/readers/runningSessions.ts` | External rows, with headless runs excluded |
| Pane→session resolution | `src/session/resolveClaudeSession.ts` | Linking a pane to a vault entry |
| Agent registry, argv builder, launcher | `src/vault/registry.ts`, `LaunchBuilder.ts`, `VaultLauncher.ts` | Launching an agent into a worktree |
| Session preview overlay | `src/webview/vault/PreviewController.ts` | Opening a transcript from an agent row |
| Reveal / copy-path / copy-resume handlers | `src/providers/TerminalViewProvider.ts` | Worktree variants of the same actions |
| Render-signature no-op guard | `src/webview/vault/vaultRenderSignature.ts` | Suppressing spinner-driven re-renders |

### 8.4 Truthfulness invariants

These hold across every layer and are testable statements, not aspirations. Each prevents a
specific false claim the view could otherwise make.

| # | Invariant |
|---|-----------|
| I1 | A failed or timed-out scan never downgrades a row. Absence of evidence is not evidence of absence |
| I2 | A spinner frame proves activity, never identity. No agent icon without a proven identity |
| I3 | An `external` row is never focusable and is always labelled as running outside this window |
| I4 | Identity confidence and activity confidence are derived independently from their own source; neither is collapsed into a single field |
| I5 | Transcript-derived subagents are history, rendered as history, with `live: false` |
| I6 | A resumed or cleared session landing idle is not a completed turn |
| I7 | Hook status is never carried across a window reload — the process that published it is gone, so the pane returns to inference |
| I8 | Degraded data is labelled with its failing source and reason; a repo that fails to list keeps its last good listing. An empty result that is genuinely empty is not degraded |
| I9 | Decorative title frames are stripped in the webview, before any message, comparison, render signature, or identity test |
| I10 | The extension never deletes files directly; directory removal is delegated to git — which still deletes recursively, so this bounds our bugs, not git's consequences |
| I11 | A subagent row nests exactly one level, carries no pane identity, and activates its parent's pane |
| I12 | Children inherit their parent's freshness — a stale parent leaves no provably-working child |
| I13 | Every turn state maps to exactly one activity; a state no event can produce does not exist |
| I14 | A confirmation authorizes the blocker set it was shown; a blocker that appears afterwards re-prompts, and a working agent is never force-removable |
| I15 | A failed or timed-out mutation still forces a rebuild; a state git and the filesystem disagree about is reported as indeterminate, never as a clean failure |
| I16 | Agent-reported identity is a lookup key only; no reported path is opened on the report's authority |

### 8.5 Security posture

| Surface | Control |
|---------|---------|
| Webview-supplied ids | Re-resolved host-side to paths the host itself issued |
| Webview-supplied **paths** | One action takes one: `worktreeCreate` names a path for an object that does not exist yet, so there is no id to resolve from. It is untrusted input — validated host-side, revalidated after any queue wait, symlinked components refused, with a residual TOCTOU window documented rather than denied |
| Git invocation | argv arrays only; refs and paths validated; leading `-` rejected |
| Destructive actions | Blockers re-evaluated at execution and bound to the confirmation by fingerprint; a newly appeared blocker re-prompts; a running or waiting agent is never force-removable; the main worktree is never removable |
| File deletion | Never performed directly; delegated to `git worktree remove`, whose deletion is recursive and irreversible |
| Hook endpoint | Loopback bind, ephemeral port, **per-session** token re-validated against live registration at use time, POST-only, fail-open, 1 MB cap. The trust boundary is the pane, not the agent: same-pane child processes inherit the coordinates and are inside it |
| Agent config mutation | Opt-in setting, off by default; cross-process lock + atomic rename; unknown keys preserved; symlinked destination refused; uninstall command; absolute script path reconciled on extension update |
| Agent-reported identity | `sessionId` looked up in the vault store; `transcriptPath` compared against the store, never opened on the report's authority |
| Prompt delivery | Native prefill preferred; otherwise an argv token or a pty write, never shell interpolation |
| Launch environment | **Known pre-existing gap.** `PtyManager.buildEnvironment()` clones the whole host `process.env` and the agent allowlist merges over it rather than filtering, so launched agents inherit host credentials. Affects every vault launch, not just this feature; recorded, not fixed here |

### 8.6 Host / webview boundary and multi-surface fan-out

The AI Vault is **not** its own webview. It is a DOM section mounted into the same webview
document that hosts the terminals (`src/providers/webviewHtml.ts:694-696`), and that document
is loaded by **three** surfaces — sidebar, panel, and editor — each of which therefore runs
its own `VaultPanel` instance over its own state. Three consequences the design must hold:

| Consequence | Rule |
|-------------|------|
| There is no single "the webview" | The host **broadcasts** the tree to every live webview. A reply to one surface's request still goes to all, because they render the same window-scoped truth |
| Every surface retains its DOM while hidden | All three are registered with `retainContextWhenHidden: true` (`src/extension.ts:198-231`, `src/providers/TerminalEditorProvider.ts:189-197`). A hidden surface's tree still costs DOM work on push, so pushes are skipped for surfaces whose Worktree view is not the active segment, and the render-signature guard catches the rest |
| Per-surface state is not window state | Anything scoped to the window — which panes exist, what each is doing — must be projected **host-side**. Anything genuinely per-surface — scroll, collapse, expansion — stays in that surface's own persisted state |

The last row is why the agent-activity projection lives in the host rather than reusing the
existing per-surface tracker: a tracker in the sidebar cannot see a pane in the editor, so a
window-scoped view built on it would under-report by construction. The projection *rules* are
shared with the tracker; the *instance* is not.

---

## 9. Key Design Decisions — Worktree Subsystem

| # | Decision | Alternative rejected | Rationale |
|---|----------|---------------------|-----------|
| D1 | Worktree is a fourth **view** that swaps the panel body | A fourth `GroupMode` in `groupEntries()` | Grouping buckets already-loaded sessions, so a worktree with zero agents would vanish. A worktree is a different entity that exists, and is actionable, with no sessions |
| D2 | Group by normalized `git-common-dir`, not by repository `rootUri` | Group by workspace folder | A workspace holding both a repo and one of its own linked worktrees would otherwise render two groups for one repo |
| D3 | `WorktreeInfo.id` is the normalized absolute path | Composite `<repoId>:<path>` | Paths may contain `:`; a path already belongs to exactly one worktree, so a composite id buys nothing and costs an escaping rule |
| D4 | Realpath both sides of every path comparison | Lexical comparison | macOS reports `/private/var` from the process table and `/var` from git; without realpath every worktree under a symlinked root shows zero agents |
| D5 | Tree and presence are one message | Two messages | Prevents rendering an agent row whose worktree is absent from the tree currently held |
| D6 | External (other-window) agents shown, labelled, non-focusable | Hide them entirely | Silence would claim a busy worktree is idle. Labelling is honest; offering focus would be a lie |
| D7 | Subagents from transcripts, flagged `live: false`, fetched lazily | Live roster from day one | A live roster requires hooks. Transcript data is real but post-hoc; rendering it as live would be the exact failure the evidence model exists to prevent |
| D8 | Persist a new `vaultView` key beside `vaultGroupMode` | Widen the `vaultGroupMode` union | Keeps a *view* value from flowing into `groupEntries()`, and leaves existing persisted state valid |
| D9 | Default to the Worktree view only when the workspace has a git repo | Always default to Worktree | A repo-less workspace would open on a permanently empty panel, which reads as broken |
| D10 | Destructive actions confirm through a host round trip that names live panes and external agents | Client-side confirmation | Only the host can see live panes and registry sessions; the blockers are re-evaluated at execution, so a confirmation is a permission, not a bypass token |
| D11 | Removal never deletes the branch and never kills panes | Bundle both into "remove" | Each is a separate consequence; bundling destroys work the user believed was merely un-checked-out |
| D12 | Hook installation is opt-in, off by default | On by default | It writes into a config file the user owns. The view degrades gracefully without it, which makes off-by-default acceptable rather than crippling |
| D13 | Hook status supersedes inference only while fresh | Hook status always wins | A stale hook row must fall back to identity-only, or a reload resurrects an unanswerable question card |
| D14 | Virtualization is out of scope; cap with a "show all" affordance | Virtualize the tree | Worktree counts are tens, not thousands. A cap that says so beats a silent truncation and beats premature machinery |
| D15 | The create form carries an agent picker; creating and launching is one action | Two separate actions the user composes | Creating a worktree in order to put an agent in it is one intent. The launch reuses the standalone launch path, and a failed launch never rolls back a successful create |
| D16 | No filesystem path on any tree row | Path truncated from the left on the worktree row | At sidebar width a path crowds out the branch name, which is the identity users navigate by. The path stays reachable from the tooltip and the copy action |
| D17 | The worktree row's leading glyph shows the strongest agent state | A separate status column | One glyph slot keeps rows single-line and aligned; `waiting` outranks `running` because it is the state that needs a human |
| D18 | Generalize the existing Cursor hook stack into one multi-agent runtime | A second `AgentHookServer` beside it, or per-launch `--settings` injection | `src/cursor/` already ships the loopback runtime, per-session tokens, the env-contributor seam, the locked+atomic config installer, and an event reducer. A second server would duplicate all of it and collide on the singular contributor slot; two controllers could disagree about enablement and disposal. The reference implementation also chose global install over `--settings`, and tests that choice explicitly |
| D19 | No on-disk endpoint artifact; env at spawn is the only channel | The reference's endpoint file | That file exists to let a *static* config entry find a *moving* server — necessary there because ptys are daemonized and agents can be remote. Here ptys die with the window, so spawn-time env can never go stale, and a window-global file against a window-local runtime would misroute one window's events into another's |
| D20 | No single `confidence` field; derive it per source | One field on the row | A pane can be authoritative for identity and fallback for activity, or the reverse. One field forces a lossy choice; the sources already carry the answer |
| D21 | Watch `.git/worktrees` non-recursively plus the two `HEAD` targets, with a 1 s/repo rebuild floor | Recursive `worktrees/**` | That subtree holds `index`, `FETCH_HEAD`, `ORIG_HEAD` and `logs/`, which churn on nearly every git operation. An agent working in a linked worktree would drive a relist plus a broadcast several times a second, indefinitely |
| D22 | Confirmations are bound to their blocker set by fingerprint | A bare `force: true` re-send | Otherwise confirming "3 untracked files" also authorizes deleting a worktree that acquired a live agent in the meantime — approval for something the user never saw |
| D23 | Ship in stages: navigation core first, then create+launch, then hooks | All seven phases in sequence | The first four phases answer "which worktrees exist, where are my agents, take me there", which is the daily-use core. Hook work is the largest and least certain piece and should not gate it |
| D24 | The launch environment gap is recorded, not fixed here | Fold an env-policy fix into this feature | It affects every vault launch, predates this feature, and changing it touches unrelated paths. Fixing it inside a worktree feature would hide a security change in an unrelated diff |

Decisions made on the user's behalf and recorded rather than asked: D3, D4, D5, D8, D11, D14,
D19–D22. D15–D17 were derived from the reference screenshots reviewed 2026-08-25 and supersede
earlier placeholders in the UI design. D18, D23, and D24 were chosen by the user at the peer-review
triage on 2026-08-25.

---

## 10. Cross-Document Consistency Registry

Contract-critical values and the intentional cross-layer mappings. A value here has exactly
one definition; every other document references it.

| Value | Canonical form | Defined in | Referenced by |
|-------|----------------|-----------|---------------|
| Path normalization rule | realpath → NFC → collapse/strip separators → Windows drive-letter uppercase + case-insensitive compare | [worktree-model.md](design/worktree-model.md) § 3.1 | agent-presence § 3.1, actions § 3, rpc § 4 |
| `WorktreeInfo.id` | Normalized absolute worktree path | [worktree-model.md](design/worktree-model.md) § 2 | rpc § 2, presence § 2, ui § 3, actions § 2 |
| `repoId` | Normalized absolute git common dir | [worktree-model.md](design/worktree-model.md) § 3.2 | rpc § 2, ui § 3.1, actions § 3 |
| `rowId` | `window:<paneId>` or `external:<agent>:<sessionId>` | [worktree-agent-presence.md](design/worktree-agent-presence.md) § 3.5 | rpc § 2, ui § 6 |
| Vault entry id | `<agent>:<sessionId>` — **pre-existing**, defined in `src/vault/types.ts:53` | Code | presence § 2, rpc § 2, actions § 2 |
| Activity vocabulary | `running` / `waiting` / `idle` / `exited` — the first three match `TerminalActivityStatus`; `exited` means the pty died with the tab still open | [worktree-agent-presence.md](design/worktree-agent-presence.md) § 2 | ui § 3.3, hook-server § 4.5 |
| Turn-state vocabulary | `working` / `waiting` / `done` — hook-layer only, **deliberately distinct** from the activity vocabulary above. There is no `blocked` | [agent-hook-server.md](design/agent-hook-server.md) § 3 | presence § 3.3 |
| Evidence tuple | `agentSource`, `activitySource` — confidence is **derived**, never a field | [worktree-agent-presence.md](design/worktree-agent-presence.md) § 2 | ui § 4, hook-server § 4.5 |
| Degradation record | `PresenceDegradation { source, reason, since }` / `WorktreeRepo.degraded` — a reason, never a bare boolean | [worktree-agent-presence.md](design/worktree-agent-presence.md) § 2 | ui § 3, model § 2 |
| Scope values | `window` / `external` | [worktree-agent-presence.md](design/worktree-agent-presence.md) § 2 | ui § 4, rpc § 3 |
| Watcher debounce | 150 ms — the pool's existing `DEBOUNCE_MS` | `src/providers/fsWatcherPool.ts:35` | model § 3.5, presence § 3.7 |
| Watcher rebuild floor | 1 s per repo, watcher-driven rebuilds only; forced refresh bypasses it | [worktree-model.md](design/worktree-model.md) § 3.5 | presence § 3.7 |
| External-scan cadence | Flat 5 s while any surface shows the view; paused otherwise | [worktree-agent-presence.md](design/worktree-agent-presence.md) § 3.7 | — |
| Hook staleness window | 60 s — a status older than this is identity-only | [agent-hook-server.md](design/agent-hook-server.md) § 4.5 | presence § 3.3 |
| Minimum supported git | 2.31 — supplies `locked` / `prunable`. Only `-z` (2.36) has a fallback | [worktree-model.md](design/worktree-model.md) § 3.3 | — |
| Git command timeout | 10 s for read-only listings; mutations get a longer, cancellable budget | [worktree-model.md](design/worktree-model.md) § 5 | rpc § 5, actions § 3.6 |
| Action outcome | `ok` / `error` / `indeterminate` | [worktree-rpc.md](design/worktree-rpc.md) § 2.2 | actions § 3.6 |
| Hook env var — **planned** Claude server | `AT_HOOK_URL` — base, session id, and token in one value so a partial set cannot be inherited. Sole channel for that server; no on-disk endpoint artifact | [agent-hook-server.md](design/agent-hook-server.md) § 4.2 | — |
| Hook env var — **shipped** Cursor runtime | `ANYWHERE_TERMINAL_CURSOR_URL = http://127.0.0.1:<port>/<sessionId>/<token>/`. Unlike the planned server it **does** write on-disk artefacts: an observer wrapper script plus entries in `~/.cursor/hooks.json` | `src/cursor/CursorHookRuntime.ts:188-189`; artefacts at `CursorHookInstaller.ts:280,293` | [agent-cli-integration.md](design/agent-cli-integration.md) |
| Hook settings keys | `anywhereTerminal.agentHooks.claude.enabled`, `anywhereTerminal.agentHooks.claudeConfigDir`, and the pre-existing `anywhereTerminal.cursorAgent.hooks.enabled` | [agent-hook-server.md](design/agent-hook-server.md) § 4.7 | — |
| Hook uninstall command | `anywhereTerminal.agentHooks.uninstall` | [agent-hook-server.md](design/agent-hook-server.md) § 4.7 | — |
| Persisted view keys | `vaultView`, `vaultGroupMode`, `worktreeCollapsed`, `worktreeExpandedRows` — per **surface**, not per window | [worktree-panel-ui.md](design/worktree-panel-ui.md) § 2.1 | — |
| Worktree settings keys | `anywhereTerminal.worktree.createRoot` (string, default empty = sibling of the main worktree), `anywhereTerminal.worktree.rowActivation` (`focus` \| `preview`, default `focus`) | [worktree-actions.md](design/worktree-actions.md) § 3.2, [worktree-panel-ui.md](design/worktree-panel-ui.md) § 6 | — |
| `WorktreeOpenAfter` | `none` / `terminal` / `agent` / `newWindow` / `addToWorkspace` | [worktree-rpc.md](design/worktree-rpc.md) § 2.2 | actions § 3.2 |
| Worktree row state precedence | `waiting` > `running` > `idle` > `exited` | [worktree-panel-ui.md](design/worktree-panel-ui.md) § 7.2 | ui § 8 |

**Intentional mapping, not an equality**: the hook layer's turn state and the presence layer's
activity are different vocabularies on purpose. Turn state describes an agent's conversation;
activity describes a terminal. The mapping is total in one direction and partial in the other:

| Turn state | Activity |
|------------|----------|
| `working` | `running` |
| `waiting` | `waiting` |
| `done` | `idle` — never `exited`, because a finished turn does not close the pane |

`exited` has no turn-state preimage. It is produced only by pty exit and overrides any
published hook state.

**Status:** this mapping describes the planned Claude hook server. No shipped hook emits
`waiting` today — the Cursor runtime produces only working/idle transitions, and the sole
live source of `waiting` is the approval detector. See
[agent-cli-integration.md](design/agent-cli-integration.md).

### 10.1 Shipped-code values referenced by more than one document

The registry above covers the planned worktree subsystem. These are values in shipped code
that more than one design doc has to agree on. Each has one canonical definition; every
other doc references it rather than restating it.

| Value | Canonical form | Defined in | Referenced by |
|-------|----------------|-----------|---------------|
| Flow-control ack batch | `ACK_BATCH_SIZE = 5000` | `src/webview/flow/FlowControl.ts:11` | output-buffering, message-protocol. **Hazard:** `src/types/messages.ts:173` restates it in a comment with no shared constant — the two can drift |
| Output watermarks | 100 000 high / 5 000 low, adaptive flush 4–16 ms | [output-buffering.md](design/output-buffering.md) § 2 | flow-user-input, session-manager |
| PTY default geometry | 80 cols × 30 rows | `src/pty/PtySession.ts:139-140` | pty-manager, session-manager |
| Editor-panel grace destroy | 5 000 ms | `src/providers/TerminalEditorProvider.ts:42` | session-manager, webview-provider, flow-view-lifecycle |
| Default scrollback | 10 000 lines | `src/settings/SettingsReader.ts:22` | xterm-integration, build-system |
| `TerminalActivityStatus` | `idle` \| `running` \| `waiting`; precedence `waiting > (semanticWorking \|\| outputActive) > idle`, idle delay 1500 ms | `src/webview/terminal/TerminalActivityTracker.ts:1,30,119-123` | agent-cli-integration, xterm-integration, and § 10's activity-vocabulary row above |
| Max pasted image | 20 MiB | `src/shared/imagePasteTrigger.ts:21` | flow-clipboard, keyboard-input, link-detection |
| File-tree drag MIME | `application/x-anywhere-terminal-file-tree-path` | `src/webview/fileTree/ReadOnlyFileRenderer.ts:101` | file-tree, flow-clipboard |
| Hover-preview defaults | `delay: 300 ms` (clamp 100–2000), `blockSensitive: true` | `src/providers/hoverPreviewSettings.ts:17-20,27` | link-detection, theme-integration |
| Vault entry id | `<agent>:<sessionId>`, split on the **first** colon only | `src/vault/types.ts:53,57` | vault, vault-readers, message-protocol |
