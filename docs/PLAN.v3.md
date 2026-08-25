# AnyWhere Terminal — Strategic Feature Plan

> **Status:** Working draft — synthesized from two external research reports (May 2026), independent oracle review, and audit of current `v0.11.4` codebase.
>
> **Scope:** Feature prioritization by user need × technical feasibility × strategic fit. Organized by phase, not version.
>
> **Purpose:** This document is intended to be self-contained so it can be fed into other research platforms (ChatGPT, Gemini, Claude.ai web, etc.) to continue external research and validation.

---

## 1. Project Context (for external research continuation)

### What AnyWhere Terminal is

**AnyWhere Terminal (AT)** is a VS Code / Cursor extension that breaks the integrated terminal out of the bottom panel. Users can place a fully-functional PTY terminal in any of four locations: Primary Sidebar, Secondary Sidebar, bottom Panel, or as an Editor tab.

- **Repo:** `huybuidac/anywhere-terminal` (MIT) — Marketplace ID `huybuidac.anywhere-terminal`
- **Current version:** `0.11.4` (released 2026-05-23)
- **Stack:** TypeScript, node-pty (host), xterm.js v6 + WebGL (webview), esbuild bundler
- **Platform:** macOS only (Intel + Apple Silicon). Windows/Linux on roadmap.
- **Compatibility:** VS Code `>=1.105.0`, Cursor `>=3.2.21`

### Architecture summary

- **Host side (`src/`):** extension activation, three `*ViewProvider` (sidebar, panel, editor), `SessionManager`, `PtyManager` / `PtySession`, OSC parser, file-tree RPC, git decoration provider.
- **Webview side (`src/webview/`):** xterm.js renderer, split tree, tabs UI, file tree (vendored from `vs/base/browser/ui/list`), theme manager, link providers, hover preview, state store.
- **IPC:** typed message router between extension and webview; `workspaceState` for persistence (currently only tab custom names).

### What AT already ships (do not propose re-doing these)

| Capability | Notes |
|---|---|
| Multi-location placement | Sidebar / Secondary Sidebar / Panel / Editor — unique vs built-in terminal |
| Recursive split panes | Vertical + horizontal, drag-to-resize |
| Tabs with rename | Double-click / F2 / context menu; persists to `workspaceState` |
| Embedded file tree | VS Code-style list widget, search, git decorations (M/A/U/D), auto-reveal, .gitignore filtering, drag-out-to-paste |
| Copy / paste | Selection-aware `Cmd+C` (sends `SIGINT` if no selection), fast `Cmd+V` (no throttle) |
| Drag & drop file paths | From Explorer or embedded file tree into terminal |
| Clickable links | `Cmd+Click` for files + URLs; hover preview for file paths |
| Theme integration | Auto-follows `vscode.workbench.colorTheme` including high-contrast |
| Adaptive flow control | `cat huge.log` doesn't freeze UI |
| OSC 7 + OSC 633 parser | Implemented in `src/pty/oscParser.ts` — but **only `Cwd` sub-command is surfaced**; lifecycle sub-commands `A/B/C/D/E` parsed but not exposed to webview |
| WebGL rendering | xterm.js WebGL addon, GPU-accelerated |
| Cwd resolution | OS process table + OSC 7 + OSC 633 `P;Cwd` triangulation in `src/pty/processCwd.ts` |

### What AT does NOT ship yet (the gap surface)

| Gap | Severity |
|---|---|
| Windows / Linux support | Blocks ~70% of dev market |
| Buffer restore across webview reload | High — single most-requested terminal feature globally |
| Process revive across full VS Code restart | High — but hard; tmux/screen are the only known approaches |
| Workspace templates / auto-launch profiles | High — proven by Restore Terminals (108k installs) and Terminals Manager (74k installs) |
| Shell integration command lifecycle (A/B/C/D/E) surfaced to UI | Foundation for command blocks, notifications, copy-output |
| Command blocks UI (Warp-style) | Medium-high — biggest possible UX differentiator |
| History autosuggest (fish ghost text) | Medium — pain cluster around Microsoft's intrusive Suggest feature |
| Save terminal buffer to file | Low-medium |
| Finish notifications for long-running commands | Low-medium |
| Broadcast input to multiple panes | Low — but trivial to implement |
| AI features (any kind) | Medium — high upside, contested timing |
| SSH / Remote terminal pipeline | High demand globally, but out-of-scope for AT's positioning |
| True detached OS window | #2 most-upvoted VS Code feature ever; API doesn't allow it |

### Competitive positioning

AT is not a terminal emulator competing with iTerm2/Warp/Tabby. It is **a VS Code surface extension that happens to be a terminal**. Its closest competitors are:

| Extension | Installs | Overlap with AT |
|---|---|---|
| Restore Terminals (`EthanSK.restore-terminals`) | 108,383 | Workspace auto-launch only |
| Terminal Keeper | 222,388 | Session restore + import from package managers |
| Terminals Manager (`fabiospampinato.vscode-terminals`) | 74,203 | Power-user JSONC config, tmux/screen persistence |
| Run Terminal Command | 487,889 | Saved command launcher only |
| Secondary Terminal | (newer) | Sidebar terminal with AI awareness — direct overlap with AT's sidebar positioning |
| Windows Terminal Integration | 69,549 | External terminal launcher, complementary |

AT's defensible moat is the **combination** of multi-location placement + recursive splits + embedded file tree + git decorations. None of the above ship all four.

### Strategic thesis (from research synthesis)

Both research docs converge on: **"built-in-first, workflow-first."** Do not compete with terminal engines (xterm.js is fine). Do not try to be Warp-in-a-box. Win by being the **most reliable orchestration layer** for terminal work inside VS Code — persistence, correct shell/cwd context, command lifecycle awareness, layout flexibility, and keyboard-first UX.

---

## 2. Research Sources

This plan is grounded in two complementary external research reports stored in this repo:

| File | Lens | Strength |
|---|---|---|
| `docs/external-research/custom-claude.md` | English, GitHub-issue-centric, install counts, dated direct quotes from Microsoft maintainers | Best for issue traceability and frequency ranking |
| `docs/external-research/custom-gpt.md` | Vietnamese, workflow-and-trust-centric, multi-source (GitHub + Reddit + Stack Overflow + Marketplace) | Best for UX trade-offs, sentiment polarity, and trust/security framing |

### Key external references cited (for follow-up deep research)

**Microsoft VS Code repo issues** (primary signal of demand — search at https://github.com/microsoft/vscode/issues/{number}):

| Issue | Topic | Why it matters |
|---|---|---|
| `#44302` | Restore terminal sessions between restarts (open since 2018) | Canonical persistence issue; Daniel Imms (`Tyriar`) explicitly says VS Code will not solve this and defers to extensions |
| `#128001` | Workspace-specific persistent / saved terminals | Labeled `extension-candidate` — explicit invitation |
| `#131634` | Process revive across restarts (companion to #44302) | Technical hard part |
| `#123518` | Remote terminal processes survive only 60s after disconnect | SSH-specific persistence |
| `#210277` | Tab autocomplete that defers to the shell | Anti-pattern reference |
| `#279538` | Terminal Suggest is intrusive, breaks experienced workflows | Lesson on how NOT to do autocomplete |
| `#283496` | Same as above — Tab keybinding collision | |
| `#287694` | Auto-approve all terminal commands for an agent session | AI agent UX |
| `#270207` | AI agents cannot read SSH terminal output | The agentic terminal blocker |
| `#252647` | Terminal tabs can only be placed left or right | Layout pain |
| `#252458`, `#254638`, `#160501` | Vertical / flexible split requests | |
| `#19348` | Allow Ctrl+C / Ctrl+V copy-paste in integrated terminal | Years-long usability complaint |
| `#238802` | Can't select and copy from Terminal view | |
| `#112557` | Editor Ctrl+V pastes into terminal due to focus bug | |
| `#283056` | Remove paste throttling (5ms per 50 chars) | Fixed in Insiders 2026; Jarred Sumner viral X post Dec 2025 |
| `#213304` | Terminal output rendering chokes on large logs | Performance hot path `lineFeed @ InputHandler.ts:709` |
| `#185413`, `#214420`, `#311849`, `#292572` | General terminal perf debt | |

**Microsoft `vscode-remote-release` issues** (for SSH context):

| Issue | Topic |
|---|---|
| `#8444` | Remote-SSH terminal slow, file-open takes 30-60s |
| `#10869` | `screen -v` takes ~11s due to `poll(POLLNVAL)` storm (>1M syscalls) |
| `#1257`, `#9219`, `#4379` | Remote SSH disconnect / lag clusters |

**VS Code Roadmap wiki** (canonical for "most-upvoted" claims):
- https://github.com/microsoft/vscode/wiki/Roadmap
- Quote: *"Support for detachable workbench parts is our most upvoted feature request which due to architectural issues is challenging to implement."* — detachable terminals is the #2 most-upvoted feature ever.

**Marketplace pages** (install counts spot-verified 2026-05-24):
- `fabiospampinato.vscode-terminals` — Terminals Manager, 71,699–74,203 installs (officially recommended by VS Code team in #44302)
- `EthanSK.restore-terminals` — 108,383 installs
- `aosho235.vscode-save-terminal-buffer`
- `tobilg.ghostty-terminal` — *"Terminal powered by ghostty-web (WASM) instead of xterm.js"* (proof-of-concept for alternate renderer)
- `Orta.cc-terminal`
- `ms-vscode-remote.remote-ssh` — 33,967,307 installs (scale reference)
- `formulahendry.terminal` — 1.8M installs, author note: *"this extension will have limited updates for bug fix or feature development, because VS Code already has basic built-in support for the terminal from v1.2"* — cautionary tale of being absorbed by core

**External tools referenced for "import" features:**
- Warp — command blocks, AI agent in scroll stream, IDE-style prompt editing. Bidirectional demand: `warpdotdev/Warp #3560` asks for Warp inside VS Code.
- iTerm2 / Tabby / Terminator — flexible split panes, broadcast input, saved SSH profiles, Sixel image protocol
- Fish / Zsh — history-based ghost text autosuggest (`Right Arrow` to accept), per-directory history, rich tab completion

**MCP terminal pattern reference:**
- `SteffMet/tabby-vscode-agent` — runs MCP server inside Tabby, exposes terminal control to Copilot/Cursor/Windsurf with "Pair Programming Mode" that requires confirmation before destructive commands. This pattern (MCP server bridging shell ↔ AI client) is becoming a de-facto standard.

**Direct quotes worth re-grounding in:**
- *"We have no plans on restoring sessions like this. … Instead we're opting for extensions like Terminals Manager to take up this role."* — Daniel Imms (`Tyriar`), VS Code terminal lead, microsoft/vscode #44302
- *"Why is pasting into VSCode Terminal slow? Because it sleeps for 5ms every 50 characters."* — Jarred Sumner (Bun creator), X, Dec 2025
- *"AI agents (GitHub Copilot, etc.) cannot automatically read SSH terminal output in VS Code without getting stuck waiting for responses."* — GitHub user, microsoft/vscode #270207
- *"This behavior feels intrusive and breaks a workflow that has been refined for years by experienced developers."* — GitHub user, microsoft/vscode #279538 (about Terminal Suggest)

**VS Code APIs relevant to this plan** (canonical docs at https://code.visualstudio.com/api):
- `vscode.window.createTerminal(TerminalOptions)` — standard PTY
- `vscode.window.createTerminal(ExtensionTerminalOptions)` / `Pseudoterminal` — custom surface (what AT uses)
- `vscode.window.registerTerminalProfileProvider`
- `vscode.EnvironmentVariableCollection`
- `vscode.window.onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution` (1.93+)
- `vscode.lm` (Language Model API, VS Code 1.90+) — bridge to user's chosen AI provider, **no bundle required**
- Shell integration via OSC 633 — documented at https://code.visualstudio.com/docs/terminal/shell-integration
- `untrustedWorkspaces` manifest contribution for Restricted Mode

---

## 3. Analysis Methodology

1. **Read both research docs in full** — extract pain clusters and feature requests.
2. **Audit current AT codebase** (`src/session`, `src/pty`, `src/providers`, `src/webview`) to determine which gaps actually exist vs which are already shipped.
3. **Score each candidate feature** along three axes:
   - **User need** — frequency of mention in research, install counts of existing partial solutions
   - **Technical difficulty** — LOC estimate, dependency surface, platform risk
   - **Strategic fit** — does it reinforce AT's "anywhere + workflow orchestration" positioning, or pull it sideways?
4. **Independent oracle review** (`asm-oracle` agent) — second opinion to flag overweighted or underweighted items.
5. **Revise** based on oracle disagreements (documented inline below).

### Headline oracle disagreements (resolved in this plan)

1. **Cross-platform must be Phase 1, not later.** Original draft put Windows/Linux at Phase 3. Oracle: macOS-only is the immediate market ceiling — every other feature is multiplied by ~0.3 until this is fixed.
2. **Workspace auto-launch is a trust risk, not a slam-dunk feature.** Original draft proposed auto-spawn on workspace open. Oracle: in light of recent VS Code extension supply-chain incidents (May 2026), repo-controlled commands that auto-execute will be perceived as a security smell. Reframed as manual trigger + preview + confirm.
3. **"Buffer restore" must be labeled honestly.** Original draft loosely called this "session restore." Oracle: that wording implies process revive — overselling will damage trust the first time a user's `npm run watch` is dead after reload. Reframed as **"visual restore, process not revived"** in all user-facing copy.
4. **Command blocks need an instrumentation milestone first.** Original draft proposed building UI immediately. Oracle: shell integration is unreliable across user shells (oh-my-zsh + custom prompts, fish with non-standard config, manually-installed zsh on macOS). Build detection + clear "active/inactive" UX before any UI.
5. **Trust / privacy posture is a missing cross-cutting concern.** Bumped to Phase 0.

---

## 4. Phase 0 — Cross-Cutting Trust & Privacy Posture

Apply across every phase below. Documented here so it isn't re-litigated per feature.

| Principle | Concrete commitment |
|---|---|
| No terminal-content collection | README + privacy doc state explicitly. No analytics that include scrollback, command text, env vars, or output. |
| Restricted Mode declaration | `capabilities.untrustedWorkspaces = { supported: "limited" }` in `package.json`. Auto-launch commands, MCP server, and any AI features disabled until workspace is trusted. |
| AI features always opt-in per action | No background indexing of terminal output. No auto-send-to-LLM. Right-click → "Explain with AI" is opt-in per selection. |
| Auto-launch commands: preview-first | Workspace template open shows preview popup with full command list. User clicks "Run" or "Skip commands". Never silently executes. |
| MCP server (if shipped) | Opt-in per workspace via setting. Pair-Programming-Mode-style per-command confirmation for write/destructive intents. |
| Status bar restraint | One single optional status item ("workspace layout active / command running") — not a row of vendor-pushed buttons. |
| Minimum permissions | Manifest `activationEvents` and `contributes` audited; no permissions taken "for future use." |

**Why this matters now:** May 2026 saw the GitHub-employee-compromise incident via a malicious VS Code extension. Research-and-go-public users are visibly more permission-cautious than 12 months ago. Reference: `custom-gpt.md` cite cluster `turn37*`.

---

## 5. Phase 1 — Cross-Platform + Minimal Persistence

**Goal:** Remove the two largest adoption blockers — macOS-only and "my terminal resets when I reload window."

**Why this phase first:** Oracle's #1 disagreement with the original plan. Every later feature's reach is capped at ~30% of devs until Windows/Linux ships.

### 1.1 Windows support

| Item | Notes |
|---|---|
| node-pty prebuild | Bundle native binaries for win32-x64 + win32-arm64 |
| Default shell detection | PowerShell 7 > Windows PowerShell > cmd; respect `COMSPEC` |
| Keybinding normalization | `Ctrl` ↔ `Cmd` mapping centralized; `Ctrl+C` selection-aware semantics ported |
| Path handling | Forward slash normalization; OSC 7 cwd parsing handles Windows-style paths |
| Smoke tests | Spawn / resize / input / output / kill on Windows 10 + 11 |

**Estimate:** 2-3 weeks. **References:** AT `README.md` Known Limitations; node-pty cross-platform docs.

### 1.2 Linux support

| Item | Notes |
|---|---|
| Same as Windows, less platform-specific work | bash/zsh/fish default detection; `$SHELL` honored |
| Distro matrix | At minimum Ubuntu LTS, Fedora, Arch |

**Estimate:** 1-2 weeks (after Windows lessons).

### 1.3 Buffer restore across webview reload (visual-only)

**Honest framing:** *"Your scrollback survives Ctrl+R. Your running process does not."*

| Item | Notes |
|---|---|
| Snapshot strategy | Last `N` lines of scrollback (cap at ~500KB) + cursor position + cwd, serialized to `workspaceState` every 5s and on `onWillDispose` |
| Restore strategy | On webview init, if a snapshot exists for this terminal slot, paint it into xterm.js as historical content before the new PTY's first byte; show a single dim divider line: `─── reattached ───` |
| Eviction | Snapshots older than 24h dropped; per-workspace cap of 10MB total |
| What this does NOT do | Process revive (no tmux wrap). Marked clearly in command palette, README, and notification on first use. |

**Estimate:** 300-500 LOC, ~1 week. Builds on existing `OutputBuffer.ts` and `workspaceState` infrastructure used for tab names.

**References:** microsoft/vscode #44302, #128001, #131634 (the persistence issue cluster); `custom-claude.md` §1.1; `custom-gpt.md` cụm #1 (`turn40view3`, `turn6view2`).

### 1.4 Save terminal buffer to file

| Item | Notes |
|---|---|
| Command | `AnyWhere Terminal: Save Buffer to File...` — open save dialog, dump full scrollback (not just visible) |
| Format options | Plain text (default), ANSI-stripped, with-ANSI (for replay in compatible viewers) |

**Estimate:** ~100 LOC, 1 day. **References:** existing extension `aosho235.vscode-save-terminal-buffer`; `custom-claude.md` §2 rank #4.

### 1.5 Broadcast input to all panes in a group (quick win)

| Item | Notes |
|---|---|
| Command | `AnyWhere Terminal: Broadcast Input to Group` (toggle) |
| UI | Status bar indicator while active; pane border tint |
| Scope | Per split-group, not per-tab — matches iTerm2 mental model |

**Estimate:** ~200 LOC, 2-3 days. AT's split tree already fans events; this is a small extension.

**References:** `custom-claude.md` §4 "iTerm2/Tabby" comparison (broadcast input).

---

## 6. Phase 2 — Workspace Templates (Trust-First)

**Goal:** Solve the "open project → restore my terminal layout" workflow without becoming a security smell.

**Critical reframing from oracle:** Manual-trigger + preview, never auto-spawn.

### 2.1 Schema and config file

| Item | Notes |
|---|---|
| File | `.vscode/anywhere-terminals.json` (workspace-scoped, git-trackable) |
| Schema | Named terminals + split layout + cwd (relative to workspace) + optional `startupCommands[]` + location preference (sidebar/panel/editor) |
| Schema lessons | Study Terminals Manager and Terminal Keeper JSONC for what works; deliberately simpler than both |

### 2.2 Manual restore UX

| Item | Notes |
|---|---|
| Trigger | Command `AnyWhere Terminal: Launch Workspace Layout` (no keybinding by default) |
| Discovery | When a workspace with a config opens for the first time, show a one-time toast: *"This workspace has an AnyWhere Terminal layout. Launch it?"* with `Launch` / `Dismiss` / `Don't show again`. **Not** an auto-spawn. |
| Preview | Modal shows the full layout tree + every startup command verbatim. User clicks `Run All`, `Run Without Startup Commands`, or `Cancel`. |
| Trusted-mode gate | `startupCommands` are disabled in Restricted Mode. Layout-only restore is allowed. |

### 2.3 Save current layout as template

| Item | Notes |
|---|---|
| Command | `AnyWhere Terminal: Save Current Layout to Workspace` — dumps current tabs + splits + cwds (but not commands) to `.vscode/anywhere-terminals.json` for the user to edit/commit |

**Estimate:** 600-1000 LOC, ~3 weeks. **References:** Restore Terminals (`EthanSK.restore-terminals`, 108k installs) and Terminals Manager (`fabiospampinato.vscode-terminals`, 74k installs); `custom-claude.md` §2 rank #9; `custom-gpt.md` must-have #1 (`turn21view4`, `turn23view0`).

---

## 7. Phase 3 — Shell Integration Instrumentation

**Goal:** Build the foundation that Phase 4 (command blocks) depends on, with **honest detection** so users always know whether the feature is working.

**Critical reframing from oracle:** Build detection and visible "active/inactive" status **before** any block UI. Fallback must be honestly degraded, not faked with prompt-detection heuristics.

### 3.1 Surface OSC 633 lifecycle to webview

| Item | Notes |
|---|---|
| Already parsed | `src/pty/oscParser.ts` parses OSC 633 frames; only `P;Cwd=<path>` is currently consumed |
| Wire up A/B/C/D | A = prompt start, B = command start, C = command output start, D = command finished + exit code |
| IPC | Extend message router to forward lifecycle events to webview state store |

### 3.2 Per-session shell-integration detection

| Item | Notes |
|---|---|
| Heuristic | If OSC 633 A or B observed within first 10s of PTY spawn, mark session `shellIntegration: active`. Otherwise `inactive`. |
| UI | Small status icon in tab title bar — green dot = active, gray = inactive (with tooltip and link to install instructions) |
| Manual installation guide | Documentation page for zsh / bash / fish / pwsh with copy-paste snippets, mirroring VS Code's own approach |

### 3.3 Features gated on `shellIntegration: active`

| Feature | Why gated |
|---|---|
| Copy Last Command Output | Needs C/D boundary to know what "last output" means |
| Finish Notification | Needs D + exit code to know when long-running commands complete |
| Command Blocks (Phase 4) | Same |

For sessions where shell integration is inactive, these commands are visibly disabled with a tooltip explaining why and linking to setup instructions. **Never** simulate using heuristics — the false-positive rate on prompts like `❯ ` or `$ ` is too high and the trust damage from miscut blocks is severe.

**Estimate:** 800-1200 LOC, 3-4 weeks. **References:** `code.visualstudio.com/docs/terminal/shell-integration`; AT `src/pty/oscParser.ts` (existing parser); custom-claude.md §5.2 "OSC 633 already documented and stable"; oracle review §4.

---

## 8. Phase 4 — Command Blocks (Gated Moonshot)

**Goal:** The largest possible UX differentiator. Wrap each prompt-to-output as a navigable, collapsible "block" — the Warp UX, inside VS Code.

**Gating:** Only enabled for sessions where Phase 3 marks `shellIntegration: active`. Inactive sessions show vanilla xterm rendering with a hint banner.

### 4.1 Block UI overlay

| Item | Notes |
|---|---|
| Renderer | Do **not** replace xterm.js. Render block borders + actions as DOM overlay aligned to xterm's row coordinates using `linkifier`-style positioning |
| Per-block actions | Collapse / expand, copy-output-only, copy-command-only, rerun-command, mark-as-failed (visual only) |
| Navigation | `Cmd+Up` / `Cmd+Down` jumps to previous/next prompt; `Cmd+Shift+Up/Down` selects across blocks |
| Exit code badge | Green check / red X / yellow signal-killed icon next to each finished block |

### 4.2 Block-derived features (free riders)

| Feature | Notes |
|---|---|
| Copy Last Command Output | Right-click in terminal background → action |
| Finish Notification | If command runs >10s **and** window unfocused at exit, show VS Code notification with exit code |
| Jump to last failed | Command palette: `AnyWhere Terminal: Jump to Last Failed Command` |

### 4.3 Honest fallback

When `shellIntegration: inactive`:
- No block borders rendered (vanilla xterm)
- Top of pane shows a dismissible banner: *"Enable shell integration to see command blocks. [Install for zsh] [Don't show again]"*
- Block-derived features are visibly disabled in menus, not hidden

**Estimate:** 1500-2500 LOC, 5-6 weeks. **References:** Warp's block concept (Hacker News Show HN: Warp); `custom-claude.md` §5.2 "Warp-style command blocks inside VSCode"; custom-gpt.md "execution state" `turn32view2`.

**Risk acknowledgement:** This is the biggest swing in the plan. Failure mode = users with broken shell integration see a half-empty feature and uninstall. Mitigation = the detection-first gating in Phase 3.

---

## 9. Phase 5 — UX Moat (History Autosuggest)

**Goal:** Fix the thing Microsoft's Terminal Suggest got wrong. Ship history-based ghost text **without** stealing the Tab key.

### 5.1 Fish-style history ghost text

| Item | Notes |
|---|---|
| Source | `~/.zsh_history` / `~/.bash_history` / `~/.local/share/fish/fish_history` — read at session start, append on each accepted command |
| Per-workspace augmentation | Separate history file at `.vscode/.anywhere-terminal-history` (gitignored) — workspace-local entries ranked higher |
| Rendering | Dim ghost text after cursor (CSS opacity 0.5, color from theme `editorWhitespace.foreground`); overlay div absolutely positioned over xterm cursor row |
| Accept keys | `Right Arrow` accepts whole suggestion (fish semantics); `Cmd+Right` accepts one word; `Esc` dismisses |
| **What it does NOT do** | Never intercept `Tab`. Tab continues to route to shell native completion. This is the explicit fix for microsoft/vscode #279538 and #283496. |

### 5.2 Per-directory history

| Item | Notes |
|---|---|
| Behavior | When cwd changes (via OSC 7 / OSC 633), boost rank of commands previously used in this directory |
| Privacy | All local; never synced |

**Estimate:** 1000-1500 LOC, 3-4 weeks. **References:** fish_autosuggestion behavior; microsoft/vscode #279538, #283496 (the anti-pattern); custom-claude.md §2 rank #5; custom-gpt.md `turn6view1`, `turn6view3`.

---

## 10. Phase 6 — AI Bridge (Optional)

**Goal:** Add AI value without bundling models, without vendor lock, and without violating the trust posture from Phase 0.

**Critical positioning:** AT does **not** become an AI product. AT bridges to the user's chosen AI provider.

### 6.1 vscode.lm API bridge

| Item | Notes |
|---|---|
| API | `vscode.lm.selectChatModels()` — uses whatever the user has authorized in their VS Code (Copilot, locally-running Ollama via Continue, custom providers) |
| First feature | Right-click selection in terminal → `Explain with AI` → opens a quick panel showing model response |
| Second feature | Right-click last error → `Explain this Error` → uses the OSC 633 D exit code + last block output (requires Phase 3 + 4) |
| Hard limits | No NL-to-command generation in v1 (too easy to misfire destructive commands); explanation only |
| Graceful degrade | If `vscode.lm` has no available model, commands are visibly disabled with explanation |

### 6.2 MCP server bridge (separate decision)

| Item | Notes |
|---|---|
| Pattern | Mirror `SteffMet/tabby-vscode-agent` — embed an MCP server that exposes terminal control to external clients (Claude Desktop, Cursor, Windsurf) |
| Opt-in | Disabled by default. Per-workspace setting. |
| Confirmation | Pair-Programming-Mode style — every command from an MCP client requires user confirmation before execution. Read-only operations (list panes, get output) can be auto-allowed. |
| Risk | Substantially larger security surface than 6.1. Defer until 6.1 is battle-tested. |

**Estimate:** 6.1 = 500-800 LOC, 2 weeks. 6.2 = 1500-2000 LOC, 4-6 weeks plus security review. **References:** `code.visualstudio.com/api/extension-guides/language-model`; microsoft/vscode #270207 (the AI-over-SSH blocker — AT cannot solve this directly without SSH support, but bridge mode lets the user's existing AI solve it); custom-claude.md §3 AI section; custom-gpt.md nice-to-have AI (`turn6view0`).

**Why AI is last, not first:** Oracle was definitive on this. AT's credible moat is terminal placement + layout + persistence + command-state. AI before reliability looks like a gimmick and worsens the "extension reads my terminal" trust problem. Once Phases 1-5 are solid, AI becomes a clean additive layer.

---

## 11. Explicitly Skipped Features

| Skipped | Why |
|---|---|
| **tmux/screen wrap for process revive** | Tmux/screen not always installed (Windows fails entirely). Wraps add ~200ms launch latency. Conflicts with native VS Code persistence settings. ROI vs simple buffer restore is low for the median user. Reconsider if there's specific demand from DevOps users after Phase 1 ships. |
| **True detached OS window** | VS Code API does not allow extension webviews to detach into standalone OS windows. The #2 most-upvoted VS Code feature ever is open precisely because Microsoft can't ship it. AT's "Editor tab" location is the highest-ROI approximation possible within the extension model — not 80% of demand, but the best available. Hacks (browser window + WebSocket, Electron sidecar) bring a second app's worth of security, lifecycle, focus, clipboard, and theme problems. |
| **SSH / Remote-SSH improvements** | AT has no SSH layer. Building one would be a multi-month project that duplicates `ms-vscode-remote.remote-ssh` (33.9M installs). Out of scope for AT's positioning. Microsoft's stack should solve this. |
| **Team config sync / shared layouts** | Requires backend, auth, billing. Wrong shape for a solo OSS extension. Users can already commit `.vscode/anywhere-terminals.json` to git for team sharing — that's enough. |
| **Replace xterm.js with Ghostty WASM or custom WebGPU renderer** | xterm.js v6 + WebGL is already fine. Replacement risks losing theme integration, WebGL stability, link providers, and the linkifier API used by hover preview. ROI unclear. Reconsider only if a specific perf bottleneck makes it necessary. Reference: `tobilg.ghostty-terminal` exists but adoption is minimal. |
| **Local LLM bundling** | Bundle bloat (multi-hundred-MB models), GPU concerns, support burden. Use `vscode.lm` bridge instead — let Continue / Ollama-VS-Code / Copilot handle the inference. |
| **Native sshd connection manager UI** | Tabby provides this standalone. VS Code Remote-SSH handles `~/.ssh/config` parsing. AT shouldn't reinvent. |
| **Image rendering (Sixel / iTerm protocol)** | Demand exists but small. VS Code core already has `terminal.integrated.enableImages`. Wait for upstream xterm.js image support to stabilize before importing. |

---

## 12. Open Questions for Continued External Research

These are the highest-value questions to take to other research platforms (ChatGPT, Gemini, Claude.ai web) for additional validation:

1. **Restore Terminals' churn rate.** Install count (108k) is known; how many users uninstall within 30 days because the JSON config is too rigid? If high, AT's preview-first UX could capture meaningful share.
2. **Cursor-specific terminal pain.** AT supports Cursor but neither research doc deeply analyzed Cursor users separately. Are there Cursor-specific issues (e.g., agent mode and terminal interaction) that warrant Cursor-first feature work?
3. **Windows Terminal Integration's value prop.** Its 69k installs hint at a real "I want external terminal" segment. Should AT explicitly support a "launch in Windows Terminal / iTerm2 / Tabby" command for this segment, or stay focused on in-editor?
4. **Command blocks: zsh+oh-my-zsh shell-integration success rate.** What percent of real-world zsh users successfully get OSC 633 lifecycle when VS Code auto-injects? If <60%, the Phase 4 moonshot is materially riskier than current plan assumes.
5. **MCP terminal-control adoption.** SteffMet's `tabby-vscode-agent` was the canonical example as of late 2025. Has the pattern proliferated? If so, AT shipping an MCP bridge becomes a parity feature, not differentiation.
6. **Trust signals after May 2026 GitHub-extension incident.** What concrete trust signals (signed extensions? install-time permission scoping? telemetry transparency reports?) are users now expecting from terminal-adjacent extensions? Phase 0 may need to grow.
7. **Reddit data freshness.** Both research docs noted Reddit had been heavily de-indexed by search engines at time of research. A fresh pull from r/vscode, r/devops, r/programming via Reddit API could surface 2026-specific pain not yet captured here.
8. **Pricing model for AT.** This plan assumes free / open-source. Is there a credible paid tier (team sync, AI bridge with managed inference) that wouldn't violate the trust posture? Reference Copilot Pro $10/mo, Tabnine Dev $12/mo, Warp Build $20/mo.

---

## 13. Caveats Inherited from Source Research

These limitations apply transitively to this plan and should be re-validated before any large commitment:

- **GitHub reaction counts could not be verified individually** in the source research because GitHub's sort-by-reactions URL is blocked by robots.txt and most issue pages now show "Reactions are currently unavailable" to scrapers. The "most upvoted" claims for the VS Code roadmap (detachable parts → terminals) are confirmed via the Microsoft Wiki Roadmap page, but quantitative ranking of other issues is approximate.
- **Marketplace install counts are spot values for 2026-05-24** and drift; they are not normalized for active usage. A high install count can include users who tried-and-uninstalled.
- **Some sources are forward-looking / speculative**: the paste-throttling fix (microsoft/vscode #283056) was `insiders-released` at time of research but had not shipped to stable. Verify before claiming "VS Code core has already fixed this."
- **AI feature demand is moving fast.** Findings from 2024–early 2026 may already be partly addressed by Copilot in newer VS Code Insiders builds. Re-verify Phase 6 against the latest VS Code release notes before scheduling.
- **Pricing tiers shift frequently** — GitHub Copilot is moving to usage-based billing on 2026-06-01, and Warp's tier structure was overhauled 2025-12-01. Re-verify before any go-to-market work.

---

## Appendix A — Effort Summary

| Phase | Estimate | Cumulative |
|---|---|---|
| Phase 0 | 1 week (documentation + manifest) | 1w |
| Phase 1 | 5-7 weeks | 6-8w |
| Phase 2 | 3 weeks | 9-11w |
| Phase 3 | 3-4 weeks | 12-15w |
| Phase 4 | 5-6 weeks | 17-21w |
| Phase 5 | 3-4 weeks | 20-25w |
| Phase 6 (6.1 only) | 2 weeks | 22-27w |
| Phase 6.2 (MCP) | 4-6 weeks (optional) | 26-33w |

**Total to "AT is a complete, AI-bridged, cross-platform terminal orchestration extension":** roughly 6-7 months solo, or 3-4 months with a second contributor on cross-platform work in parallel.

## Appendix B — Mapping of Plan Items to Research Source Lines

For quick traceability when re-reading the research docs:

- Phase 1 cross-platform → `custom-claude.md` §5 (implicit, AT-specific addition from oracle), AT `README.md` Known Limitations
- Phase 1 buffer restore → `custom-claude.md` §1.1 / §2 rank #1; `custom-gpt.md` cụm "Phiên & khởi tạo" `turn40view3`
- Phase 1 save buffer → `custom-claude.md` §2 rank #4 (Save Terminal Buffer extension)
- Phase 1 broadcast input → `custom-claude.md` §4 "iTerm2 / Tabby"
- Phase 2 workspace templates → `custom-claude.md` §2 rank #9; `custom-gpt.md` must-have `turn21view4`, `turn23view0`
- Phase 3 shell integration → `custom-claude.md` §5.2 (OSC 633); `custom-gpt.md` `turn32view2`, `turn32view3`
- Phase 4 command blocks → `custom-claude.md` §4 (Warp comparison), §5.2 ("Warp-style command blocks inside VSCode")
- Phase 5 history autosuggest → `custom-claude.md` §2 rank #5, §5.4; `custom-gpt.md` `turn6view1`, `turn6view3`; microsoft/vscode #279538 + #283496 (anti-pattern)
- Phase 6 AI bridge → `custom-claude.md` §3 AI section; `custom-gpt.md` nice-to-have AI `turn6view0`; microsoft/vscode #270207 (the SSH agent blocker)
- Skipped items rationale → oracle review §4-6; `custom-gpt.md` cautions on trust `turn37*` cluster
