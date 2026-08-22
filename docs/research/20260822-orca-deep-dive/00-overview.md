# Orca deep-dive — Overview & roadmap for anywhere-terminal

Date: 2026-08-22. Source: `/Users/huybuidac/Projects/ai-oss/orca` (v1.4.178-rc.2, "Next-gen IDE for parallel agentic development", Electron). Seven research directions, each with its own doc:

| Doc | Direction | Core takeaway |
|---|---|---|
| [01](01-agent-detection.md) | Agent detection & process recognition | Table-driven recognizer over argv/process-tree/title with token-boundary matching; headless `claude -p` exclusion |
| [02](02-hook-status-architecture.md) | Hook-based agent state | Loopback HTTP hook server + per-agent hook install (Claude settings, Codex hooks.json, OpenCode injected plugin); 4-state turn machine |
| [03](03-interactive-prompts.md) | Interactive prompts / questions / interrupts | Question+approval captured as one JSON field; answer by option number via paced keystrokes; keystroke-inferred "answered"/"interrupted" |
| [04](04-launch-resume-permissions.md) | Launch / resume / permissions | One agent config table; sanitized session ids; idempotent resume selector; derived yolo/manual/mixed permission mode |
| [05](05-prompt-injection.md) | Prompt injection into TUIs | Bracketed-paste frame + render gate (`ESC[?25h` + 1.5s quiet) before Enter; edge-triggered submit verification |
| [06](06-completion-notifications.md) | Completion & notifications | Evidence ranked hook>title>process, never merged; quiet windows; truthfulness invariants; reconstructable notification ids |
| [07](07-orchestration-teams.md) | Inter-session communication & Claude agent teams | Mailbox delivers a one-line *pointer* (not the payload) into idle panes; transport-settled writes; Claude teams hosted via a PATH-shadowing tmux shim |

The single biggest architectural difference: **orca gets agent state from agent-emitted hooks it installs itself** (per-agent shims for codex/opencode/etc.), while anywhere-terminal today infers state from session files, PID registries, and terminal output. Almost everything below flows from that.

---

## A. Bug-fix candidates (likely live issues in AT today)

1. **False "done"/notification on resume** — a resumed/cleared session landing idle must not count as a completed turn. Orca flags these `sessionBoundary` and never completes on them (doc 06 §2). AT's vault resume (`VaultLauncher`) + tab lighting likely fires here.
2. **Phantom "running" tabs after VS Code reload** — rehydrated state must be marked `restoredUnconfirmed` and treated as not-fresh until re-confirmed (doc 06 §3.2). Applies to `src/session/SnapshotPersistence.ts` / hydrate path.
3. **Spinner-title re-render churn** — strip braille `U+2800–28FF` + quarter-circle `U+25D0–25D3` frames before diffing titles (`agent-decorative-title-signature`, doc 06 §4). Cheap win for webview tab renders.
4. **`claude -p` headless subprocesses counted as agents** — hooks and helper scripts spawn `claude --print` children; any process-based detection must exclude them (doc 01 §3.3).
5. **OSC 133;D leak from nested shells** — full-screen agents leak nested shells' command-end marks onto the main pty; orca *confirms* rather than trusts `133;D` (doc 01 §3.5). AT's `ShellIntegrationEvents`/`TrackedCommand` should adopt confirm-don't-trust.
6. **Paste/Enter race when injecting prompts** — if AT ever sends text + `\r` in one write, Claude leaves the prompt editable; minimum 50ms split, proper fix is the render gate (doc 05 §1.5).
7. **Substring agent-name matching** — `openclaude ⊃ claude`, `android ⊃ droid` class of false identity; use the token-boundary regex (doc 01 §3.1).

## B. Optimizations (same features, more robust/cheaper)

1. **Evidence split instead of merged status** — return `{hookState, titleStatus, source, confidence, livePtyRequired}` and let each consumer (tab dot, vault row, notifier) pick its rule (doc 06 §1).
2. **TTL-deduped process-table snapshot** (500ms) + tiered polling cadence with jitter and backoff (doc 01 §3.4, doc 06 §1) — replaces ad-hoc `ps` calls in `src/pty/processTree.ts`.
3. **Freshness scheduler** — one timer armed at the next expiry instead of polling loops for status decay (doc 06 §5.7).
4. **Degraded-scan stickiness** — a failed/slow process scan reuses the last positive identity; never downgrade to "shell" on timeout (doc 01 §3.5).
5. **Bounded transcript reading** — backward chunk scanning (64KB chunks, 4MB cap) for tail reads (doc 02 §3 command-code); relevant to vault detail head+tail readers.
6. **Notification burst cooldown (5s, per-window)** + coalescing (50ms trailing/250ms max) (doc 06 §4).

## C. Upgrades (architecture-level)

1. **Hook-based status pipeline** — the flagship. Loopback HTTP server (~100 lines) + env injection at pty spawn + endpoint file that hook scripts re-source (survives reload with daemonized ptys) + per-agent installers: Claude `settings.json` hooks, Codex `hooks.json` in managed CODEX_HOME, OpenCode injected JS plugin. Full 8-step porting plan in doc 02 §5. This replaces/augments PID-registry running detection and gives AT: precise turn state, question/approval payloads, subagent rosters, `transcript_path`/`session_id` linking live terminals to vault timelines.
2. **Render-gated prompt injection + edge-triggered submit verification** — doc 05 §1-2. Upgrades VaultLauncher resume-with-prompt and any programmatic send.
3. **Unified agent config table** — extend `src/vault/registry.ts` with launch/injection/permission/detection columns so all per-agent knowledge lives in one place (doc 04 §1, doc 01 §1).
4. **Truthfulness invariants as tests** — port the projection test checklist (doc 06 §3) as AT test cases; they encode a year of status-lying bugs.
5. **Transport-settled pty writes** — `pty.write` returning `Promise<boolean>` instead of void; nothing is marked delivered/submitted until the transport confirms (doc 07 §1). Prerequisite for reliable injection (C2) and messaging (D9).
6. **Launch-token identity tuple** — inject `AT_LAUNCH_TOKEN`/`AT_PANE_KEY` at spawn and attest by hash, so "which pane is this really" survives reload/resume (doc 07 §5.4).

## D. Feature suggestions (new capabilities orca proves viable)

1. **Answer AskUserQuestion / approve permissions from the vault panel** — AT already renders AskUserQuestion timeline items; orca shows the full loop: capture untruncated `{questions}` payload → render options → answer by **option number** via paced keystrokes → infer "answered" from the submit keystroke with baseline re-validation (doc 03). Would make the vault panel interactive, incl. from a different window than the terminal.
2. **Live status in vault list** — hook payload's `session_id`/`transcript_path` links a running terminal to its vault entry: show working/waiting/done per session row, "needs attention" badges (doc 02 §5.8).
3. **Permission mode switcher** — one yolo/manual/mixed toggle across claude/codex/opencode using the per-agent yolo-args table, mode *derived* from args (doc 04 §4).
4. **Prompt-seeded launch** — resume/fork from vault with a prefilled prompt: `claude --prefill`, opencode `--prompt`, codex argv (doc 04 §1, doc 05 §3).
5. **Follow-up queue** — type a prompt while the agent is busy; deliver when idle via readiness gating (doc 05 §4).
6. **Interrupt from UI** — safe Ctrl+C/double-Esc semantics per agent with baseline-guarded inference (doc 03 §4).
7. **Completion notifications with dismiss-on-focus** — reconstructable ids + quiet windows (doc 06 §4-5).
8. **Host Claude agent teams as native VS Code splits** — ship a PATH-shadowing `tmux` shim that RPCs back to the extension host and maps `split-window`/`send-keys`/`respawn-pane` onto `SplitModel`; orca proves the whole verb set fits 6 terminal ops (doc 07 §2, §5.3).
9. **Session-to-session messaging** — pointer-not-payload delivery gated on observed-idle + transport-settled writes; generic across claude/codex/opencode since the payload is pulled via CLI (doc 07 §1, §5.1-5.2).

## Suggested sequencing

1. **Quick wins (days)**: A3 spinner-frame signature, A7 token-boundary matching, A4 headless exclusion, B6 burst cooldown, A6 paste/Enter split.
2. **Status correctness (1-2 weeks)**: B1 evidence split, A1 sessionBoundary, A2 restoredUnconfirmed, quiet-window done (doc 06 §5.4) — fixes the tab-lighting family of bugs for good.
3. **Hook pipeline (the big one)**: doc 02 §5 steps 1-3 (server + env + Claude hooks) first; Codex and OpenCode shims after. Unlocks D1/D2 vault features.
4. **Injection hardening**: render gate + verification when D4/D5 features land.
