# Orca deep-dive 4/7 — Launch, resume, permissions per agent

Source repo: `/Users/huybuidac/Projects/ai-oss/orca`. Maps to AT's `src/vault/LaunchBuilder.ts`, `src/vault/registry.ts`, `src/vault/VaultLauncher.ts`.

## 1. Per-agent command construction

One table drives everything — `TUI_AGENT_CONFIG` in `src/shared/tui-agent-config.ts:53-337`. Each entry: `detectCmd` (PATH probe), `launchCmd` (may differ: kiro → `kiro-cli chat --tui:205`, hermes → `hermes --tui:296`, command-code → `command-code --trust:238`), `expectedProcess` (pty process recognition), and a `promptInjectionMode`. Aliases because package name ≠ binary (`aug`→`auggie:217`, `qwen-code`→`qwen:283`, `continue`→`cn:243`, `mistral-vibe`→`vibe:274`).

**Prompt delivery axis** (`tui-agent-startup.ts:101-185`):

- `argv` — claude, codex, cursor, droid, pi, omp, grok, trae, prime-agent. Optional `argvPromptSeparator: '--'` for Cobra-style parsers so a prompt starting with `help`/`-x` isn't parsed as a subcommand (`tui-agent-config.ts:118,161,323`).
- `flag-prompt` (`--prompt`) — opencode, mimo-code (`:118`).
- `flag-prompt-interactive` (`--prompt-interactive`) — gemini, antigravity (`:156`).
- `flag-interactive` (`-i`) — copilot; `--prompt` would exit on completion (`:311`).
- `hermes-query`, `stdin-after-start` (paste after composer ready) for the rest.

**Drafts** (seed input without submitting): `draftPromptFlag: '--prefill'` for claude/openclaude, else `draftPromptEnvVar` (`ORCA_PI_PREFILL`, `ORCA_OMP_PREFILL`) with an explicit *post-launch* env clear appended (`tui-agent-startup.ts:295-305`) so a seeded draft can't leak into the next run in the same pty, plus a platform size guard (`:306-311`).

**Model / effort flags** live in a per-agent catalog, not launch code: claude `['--model', v]` + `['--effort', v]` (`agent-session-option-catalog-claude-codex.ts:164,86`), codex `['-m', v]` + `['-c','model_reasoning_effort=…']` (`:206,230`). `resolveAgentSessionOptionLaunch` (`agent-session-option-launch.ts:31-94`) detects when the user's own args already set a flag (`agentArgsOverride`) and then *emits the flag but does not record it as applied state* — the UI never claims a setting the user overrode. `resolveAgentLaunchCommand` (`tui-agent-launch-command.ts:24-101`) hard-fails when a command override conflicts with picker options (`:72-77`) and inserts options *before* a `--` terminator (`:103-109`).

Orca does **not** inject hooks via argv: claude launches with no `--settings` (`tui-agent-startup.test.ts:463-473`), codex with no `--profile` (`:433-443`). Hook wiring is out-of-band env (`ORCA_AGENT_HOOK_PORT/TOKEN/ENV/VERSION`) plus config-dir overlays (`OPENCODE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`) re-exported by shell wrappers (`src/main/zsh-startup-wrapper-builder.ts:71`).

## 2. Resume mechanics

`RESUMABLE_TUI_AGENTS` is a 12-agent subset (`agent-session-resume.ts:5-18`). Session ids come from the agent's own hook payload, per-agent key names (`extractAgentProviderSession:182-240`): claude/codex/gemini/droid/kimi `session_id`, opencode/mimo `sessionID`, antigravity `conversationId`, grok `sessionId|session_id`.

**Ids validated before touching a command line**: ≤512 chars, no control chars, **must not start with `-`** (`:87-101`) — cheap argv-injection guard.

Resume argv per agent (`getAgentResumeArgv:242-280`): `claude --resume <id>`, `codex resume <id>` (subcommand, not flag), `gemini --resume`, `agy --conversation`, `opencode --session <id>`, `droid/grok/devin --resume`, `mimo --session`, `pi --session <transcript path>`, `prime-agent --resume <path>`, `omp --resume <file|id>`. Pi/prime-agent resume by **file path** because their hook reports `session_file`; identity comparison accounts for that (`agentProviderSessionsEqual:167-180`). **Claude's transcript filename UUID no longer matches the hook `session_id`** — `transcriptPath` is stored separately for reading transcripts while resume still uses the id (`:26-33`). (AT's `src/session/resolveClaudeSession.ts` deals with the same divergence.)

Launch command captured for later resume deliberately strips one-time picker flags: `commandWithoutSessionOptions` is persisted (`tui-agent-startup.ts:81,280`); resume never re-injects session options (`tui-agent-startup-session-options.test.ts:142-153`).

**Claude selector guard** (`agent-resume-launch-command.ts:84-169`): the user's persisted command may already contain `--resume/-r/--continue/-c`; those tokens are span-spliced out (plus a trailing stale id) and exactly one authoritative selector appended before claude's `--` terminator. Fails *open*: unparseable command, wrapper like `bash -c claude`, PowerShell `--%`, or any token flagged `divergesFromShell` → append untouched. Joined `-r<id>` deliberately not matched (`:16-20`).

**argv-drop** (`agent-resume-argv-drop.ts:44-63`) is the inverse: when the account owning a session can't be verified, strip the resume suffix so the pane starts clean instead of resuming under the wrong account. Tries several quoting spellings (`:18-24`), requires a whitespace boundary (`:29`), returns `unrecognized` if the locator still appears elsewhere — in which case the caller **refuses to spawn** rather than run an uncancellable resume (`src/main/codex/codex-unverified-resume-launch.ts:28-34`). Also re-strips the same argv out of `ORCA_SEQUENCED_STARTUP_COMMAND` env (`src/main/ipc/pty.ts:4421-4439`).

## 3. Shell / platform

Three shells only: `'posix' | 'powershell' | 'cmd'` (`tui-agent-startup-shell.ts:10`); fish deliberately *not* a member — `quotePortableUnixArg` (`:191-216`) emits backslashes as `"\\"` and apostrophes as `"'"` between single-quoted runs, which round-trips identically in sh/bash/zsh/dash/fish (fish single quotes aren't literal; the `'\''` idiom corrupts regexes and UNC paths). cmd quoting carets `^&|<>()%!"` (`:223`); PowerShell doubles `'` and gets a leading `&` call operator (`:219,233`). `clearEnvCommand` (`:302-330`): dual `$fish_pid` probe + `set --erase -g` / `unset`, trailing `true`, `command test` to defeat aliases — the text may be pasted into shells Orca never spawned. WSL: `--exec` instead of `--` to stop wsl.exe expanding `$VAR` in argv (`wsl-login-shell-command.ts:15-20`); login shell from `getent passwd`, `-ilc` for bash/zsh (interactive so nvm/mise PATH matches) and `-lc` for sh/dash (`:22-39`); rc-banner noise fenced with a per-call nonce (`:71-105`).

## 4. Permission model

Three modes only: `'yolo' | 'manual' | 'mixed'` (`tui-agent-permissions.ts:4`), and mode is **derived, not stored**: current args === the agent's yolo string → yolo, empty → manual, anything else → mixed (`:58-63`); across agents, any divergence collapses to `mixed` (`:75-94`).

Per-agent yolo args, flat table `YOLO_TUI_AGENT_ARGS` (`:6-32`): claude `--dangerously-skip-permissions`, codex `--dangerously-bypass-approvals-and-sandbox`, gemini/crush/cursor/kimi/copilot/rovo/ante/trae `--yolo`, aider `--yes-always`, amp `--dangerously-allow-all`, kiro `--trust-all-tools`, autohand `--unrestricted`, qwen `--approval-mode yolo`, grok `--permission-mode bypassPermissions`, devin `--permission-mode bypass`; env-only agents (`goose: GOOSE_MODE=auto`, `:34-36`). Applying a mode only rewrites entries the user hasn't customized (`:147-163`). `UNSUPPORTED_TUI_AGENT_ARGS` sanitizes flags that don't exist on that TUI out of persisted settings (`tui-agent-launch-defaults.ts:5-34`).

## 5. Worth porting to anywhere-terminal

1. **One config table + `promptInjectionMode` enum** (`tui-agent-config.ts:20-51`) instead of per-agent branches; adding an agent = one object literal. AT's `src/vault/registry.ts` is already table-shaped — extend it with launch/injection/permission columns.
2. **Session-id sanitizing before argv** — reject leading `-`, control chars, >512 chars (`agent-session-resume.ts:87-101`). Add to `LaunchBuilder` (AT is argv-array-safe already, but leading `-` can still flip into an option).
3. **Resume-selector idempotence** — strip existing `--resume/-r/--continue` from a user-supplied command, append exactly one, explicit fail-open when the command isn't modelable (`agent-resume-launch-command.ts:84-130`). Same bug class as a stale `--resume` in a saved AT profile.
4. **`commandWithoutSessionOptions`** — persist launch command *minus* one-shot picker flags so resume replays user intent, not UI state (`tui-agent-startup.ts:81`).
5. **argv-drop with refuse-to-launch outcome** (`agent-resume-argv-drop.ts:44-63`) — three-state result (`dropped`/`absent`/`unrecognized`), not best-effort regex.
6. **Portable Unix quoting that ignores which shell** (`tui-agent-startup-shell.ts:191-226`).
7. **Derived permission mode + per-agent yolo table** (`tui-agent-permissions.ts:6-63`) — one settings toggle across N agents, `mixed` as first-class state. Feature candidate for AT's launch UI.
8. **Post-launch env clear for prefill vars** (`tui-agent-startup.ts:295-305`).
