# Orca deep-dive 5/7 — Reliable prompt injection into agent TUIs

Source repo: `/Users/huybuidac/Projects/ai-oss/orca`. Maps to AT's `src/webview/InputHandler.ts`, `src/shared/imagePasteTrigger.ts`, `src/providers/clipboardImageSync.ts`, and any programmatic send path.

## 1. Send pipeline (main-process, guarded path)

Entry: `sendTerminalAgentPrompt(handle, prompt)` — `src/main/runtime/orca-runtime.ts:18637`.

1. **Payload build** — `buildAgentPromptPasteBytes` = `ESC[200~` + sanitized text + `ESC[201~` (`agent-prompt-injection.ts:38`). Sanitization replaces every raw `\x1b` with the literal `<ESC>` (main path, `:22`) — an embedded `ESC[201~` from scrollback would otherwise close the frame early and run the tail as keystrokes. Renderer path replaces ESC with `U+241B` (`terminal-bracketed-paste.ts:51`).
2. **Size gate** — 16 MiB max, byte-measured with event-loop yields (`orca-runtime.ts:18652`, `terminal-input.ts:8-9`).
3. **Serialization** — every submission for a `(ptyId, lifecycleGeneration)` queues on a promise tail so two prompts can never interleave (`orca-runtime.ts:19449`). Renderer equivalent: per-pty mutex `runTerminalPtyInputTransaction` (`terminal-pty-input-transaction.ts`, 28 lines).
4. **Chunked write** — 16 KiB UTF-8-boundary-safe chunks, `await setTimeout(0)` between chunks (`orca-runtime.ts:19375-19399`). Before *every* chunk it re-asserts: abort signal, pty lifecycle generation unchanged, permission-state unchanged (`:19379-19387`). If a chunk fails mid-frame it writes a lone `ESC[201~` to close bracketed paste so the TUI isn't stuck in paste mode (`:19408`; renderer mirror `agent-draft-paste-content.ts:76-92, 205`).
5. **Settle before Enter** — the key idea. For claude/codex it arms a **render gate** instead of a fixed sleep (`orca-runtime.ts:19522`): subscribe to pty output, wait for `ESC[?25h` (DECTCEM show-cursor, emitted after the paste is accepted), then **1500 ms of output quiet**, hard cap **8000 ms** (`:2029-2032`). Everything else: fixed delay **500 ms posix / 1500 ms win32** (`agent-prompt-injection.ts:7-17` — ConPTY renders long pastes slower; early Enter leaves text in the composer).
6. **Submit** — single `\r` (`agent-prompt-injection.ts:5`), preceded by one more precondition re-check (`orca-runtime.ts:19426-19437`).
7. **Verify** — below.

Renderer/light path uses a flat **50 ms** gap between paste-end and `\r` (`POST_PASTE_SUBMIT_DELAY_MS`, `agent-paste-draft.ts:37, 210-221`) — Claude Code leaves the prompt editable if paste-end and Enter land in the same pty write.

## 2. Submission verification

`verifyAgentPromptSubmission` (`src/main/runtime/agent-prompt-submission-verification.ts:17`, ~90 lines, trivially portable) polls a status snapshot every **50 ms** for **5000 ms** and succeeds only when `workingSequence` increments — the agent transitioned *into* `working`. Sequence counters (not raw status) make it edge-triggered and immune to sampling misses (`orca-runtime.ts:12165-12192`). Status source: OSC window title merged with hook-reported status, newest-wins (`:19471-19502`).

Failure modes are distinct errors (`rpc/errors.ts:63-66`):

- `agent_prompt_stalled` — no working transition in 5 s.
- `agent_prompt_blocked` — a permission/approval prompt appeared (checked before, during every chunk, and after) — prevents the prompt being eaten by a "trust this folder?" menu.
- `terminal_handle_stale` — pty lifecycle generation changed mid-send.
- `request_aborted`.

**No retry anywhere.** Fail loudly and report; renderer maps to user-facing messages incl. `partial-submit-failed` = "notes may already be pasted but could not submit" (`active-agent-note-send-result.ts:9, 40`).

**Two-phase guarded send over RPC** (`active-agent-note-send.ts:167`): readiness probe → `terminal.send{text: pasteBytes, requireAgentStatus:'sendable'}` → 50 ms → re-probe → `terminal.send{enter:true, requireAgentStatus:'sendable'}`. The server **rejects a combined text+enter payload when `requireAgentStatus` is set** so a guard flip can't cause partial delivery (`rpc/methods/terminal.ts:1350`), and re-asserts preconditions immediately before the pty write (`:1360-1375`).

## 3. Per-agent quirks

Table-driven (`tui-agent-config.ts:53+`):

- **claude**: `--prefill <text>` seeds the composer at launch — preferred over pasting, kills the race entirely (`:59`). Render gate applies.
- **codex**: readiness = the `›` composer glyph after DECSET 2004; timeout raised to **20 s**; needs a pre-written trust artifact (`preflightTrust:'codex'`) so the first-launch trust menu doesn't swallow the paste; **on Windows it reads console input records → newlines must be Alt+Enter (`\x1b\r`)**, not a VT paste frame (`:86-94`; encoder `terminal-bracketed-paste.ts:82-102`).
- **opencode / mimo**: enables bracketed paste ~1.5-2 s *before* the composer mounts → gate on post-2004 `ESC[?25h` and explicitly do **not** arm a quiet window (it would fire in the silent gap) (`:125`; rationale `draft-paste-ready-scanner.ts:96-104`).
- **grok**: `❯` anchored on alt-screen enter `ESC[?1049h`, *revoked* on `ESC[?1049l` — `❯` is also starship/pure's shell prompt; otherwise the draft pastes into the shell (`draft-paste-ready-scanner.ts:49-63, 145`).
- **pi / prime-agent**: CSI-u Shift+Enter (`\x1b[13;2u`); env-var prefill.
- Default unknown agents: quiet window after DECSET 2004.

## 4. Draft / queue delivery

- **Launch-time drafts**: `pasteDraftWhenAgentReady` (`agent-paste-draft.ts:81`) waits for the pty (8 s budget, separate from readiness budget), subscribes as a **sidecar** observer (never steals xterm's primary handler) and **replays the pre-handler buffer** so a fast TUI's early escape sequences aren't missed (`agent-draft-readiness.ts:83-87`). On readiness timeout, falls back to a 1 s process/title ownership probe rather than dropping the prompt (`agent-paste-draft.ts:119-131`), then toasts on total failure (`agent-background-draft-delivery.ts:15`).
- **Follow-ups into a running agent**: `sendFollowupPromptWhenAgentReady` (`agent-followup-delivery.ts:14`) polls `ps` foreground every 150 ms × 30 (4.5 s), requiring a *positive* agent-process match before writing — "must not type into an arbitrary shell". After attempt 4, accepts a known interpreter wrapper (python/node) with live children.
- **Busy agent**: no persistent queue — readiness gating + the per-pty submission tail is the queue; `terminal.wait{for:'tui-idle'}` blocks the notes-send path until idle (`active-agent-note-send.ts:94-108`).
- **Image paste**: force-bracketed paste of the temp file path, bypassing stale-bracketed-paste-mode suppression — `terminal-clipboard-paste.ts:81-95`; raw-path safety regexes `terminal-drop-image-path.ts:9-10`. (Relevant to AT's macOS «class furl» clipboard path and Ctrl+V debounce.)

## 5. Worth porting (ranked)

1. **Render gate instead of a fixed Enter delay** — `orca-runtime.ts:19522-19610` + `:2029-2032`. The single highest-value fix for "Enter fired too early / prompt left in the box".
2. **Platform-split fallback delay** 500/1500 ms (`agent-prompt-injection.ts:7-17`).
3. **Edge-triggered verification via a working-transition counter**, 50 ms poll / 5 s deadline, `blocked` vs `stalled` vs `stale-handle` as separate errors.
4. **Per-pty submission mutex** so paste+Enter is atomic (`terminal-pty-input-transaction.ts`).
5. **ESC sanitization + guaranteed `ESC[201~` close on partial failure**.
6. **Per-agent readiness scanner** (pure, incremental, 512-byte ring, anchor+marker+revocation) — `draft-paste-ready-scanner.ts`. Directly maps to claude/codex/opencode.
7. **Sidecar pty subscription + pre-handler replay** so readiness detection can't race handler attachment (`agent-draft-readiness.ts:56-87`).
8. **Windows input-record newline encoding** (`\x1b\r` / `\x1b[13;2u`) for codex on ConPTY.
9. **Prefer native prefill (`claude --prefill`) over paste** when we control the launch — applies to AT's VaultLauncher resume-with-prompt.
10. **Two-phase guarded RPC send** refusing combined text+enter (`terminal.ts:1350`).
