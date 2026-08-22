# Orca deep-dive 1/7 — Agent detection & process recognition

Source repo: `/Users/huybuidac/Projects/ai-oss/orca` (v1.4.178-rc.2). All `file:line` refs are into that repo.

## 1. Detection pipeline

Two independent axes: **who is installed** (PATH probe) and **who is running in this pty** (process/title/hook evidence).

**Installed-agent detection** — `src/shared/tui-agent-detection-commands.ts:43-70`. One declarative table (`TUI_AGENT_CONFIG`, `tui-agent-config.ts:53`) drives everything: `detectCmd` + `detectCmdAliases` + `detectRequiredCommands` (agent counts installed only if a co-requisite exists, e.g. claude-agent-teams needs `orca` AND `claude`, `:62-77`) + `detectUnsupportedRuntimes` (`'win32' | 'wsl'` as first-class runtimes, `:18`).

**Running-agent identity precedence** — `src/renderer/src/lib/use-tab-agent.ts:159-169`, documented at `:172-185`:

```
live hook > foreground process > title > completed hook > sleeping session > launchAgent > sibling hook
```

A separate durable *ownership* resolver (`src/shared/pane-agent-owner.ts:45-58`) has a different order — `launchAgent > startupLaunchAgent > initialStatusAgent > commandInferredAgent > hookAgent > … > sleepingSession` — used to *normalize* the signals above, not to pick the answer. That split is deliberate: ownership answers "whose pane", identity answers "who is running now".

**Process recognition** (`src/shared/agent-process-recognition.ts`) resolution order inside one command line, `:279-315`:

1. argv[0] exact normalized basename (quotes stripped, path stripped, `.exe/.cmd/.bat/.ps1` stripped) → `PROCESS_TO_AGENT` (`:58-81`, built from `expectedProcess` + detectCmds + first launch token; first writer wins so wrapper configs can't steal `claude`, `:74-78`).
2. Prefix escape hatch for versioned/platform binaries: `codex-*`, `grok-*` only (`:88-96`).
3. Subcommand gate: `orca` is only an agent when argv[1] === `claude-teams` (`:292-296`, `:308-313`).
4. Headless one-shot filter — drop `claude -p/--print/--output-format json` etc. (`agent-headless-command.ts:9-16`, `print-mode-headless-command.ts`), toggleable via `includeHeadlessOneShot` because TUI consumers and non-interactivity guards want opposite answers (`:283-285`).
5. Interpreter unwrap: only if argv[0] is node/python/shell (`isInterpreterProcessName` `:160`), walk argv skipping interpreter options (`-r/--require/--import/--loader` consume a value; `-e/--eval/-p/--print` abort entirely, `:180-189`), then require the token to look like a path (`tokenLooksExecutable` `:146-158`).
6. Node package-path identities: exact regex install paths (`agent-node-entrypoint-identities.ts:5-30`) for CLIs whose shim is a generic `cli.js`/`index.js`, plus `NODE_PACKAGE_SCRIPT_ENTRYPOINTS` requiring `node_modules/@openai/codex/` in the path (`:52-55`, `:205-221`).
7. Python: `-m <module>` (first dotted segment) or a `.py` under `/bin/`, `/scripts/`, `/site-packages/` (`:223-255`).

**Process-tree selection** (POSIX, `src/main/providers/agent-foreground-process.ts:110-136`): collect all descendants of the shell pid from a cached `ps -axo pid=,ppid=,stat=,command=`, score `+` in `stat` (terminal foreground) at 10 000 and depth at 1 (`:44-49`), then take the first recognized. If *anything* in the tree holds `+`, non-`+` rows are skipped — so a Ctrl-Z'd agent doesn't masquerade as live (`:118-123`). Then collapse to the outermost same-title-group ancestor so `shell → omp → pi` reports `omp` (`foreground-wrapper-agent.ts:25-56`).

**Windows** has no `+`: `windows-agent-foreground-process.ts:190-214` recognizes all descendants, keeps only *leaves* of recognized lineages, and returns an identity **only if exactly one distinct leaf name survives** — ambiguity yields `null`. Descendants are additionally intersected with the real ConPTY pid set (`:74-80`) and disambiguated by cwd/context-path substring with token boundaries (`:246-281`).

**Title detection** (`terminal-title-agent-type.ts`) is ordered most-specific-first: OpenCode native marker → Claude's glyph prefixes → Gemini glyphs → Pi-compatible synthetic → explicit name tokens (codex/openclaude/copilot/grok/devin/antigravity/opencode/mimo/aider) → Cursor's closed title set → droid/hermes → generic Claude braille heuristic (`:122-207`). Two exported facets: `resolveTerminalTitleAgentType` (activity) vs `resolveExplicitTerminalTitleAgentType` (`:281-287`), which rejects Claude's bare `✳`/`. `/`* `/spinner prefixes as "something is running, not proof of who". `isClaudeIdentityFrameTitle` (`:252`) goes further — the title must *present* Claude (`^claude( code)?( ready|idle|…)?$` after decoration stripping) rather than mention it.

## 2. Edge cases (from tests)

`agent-process-recognition.test.ts`:

- `claude --resume abc123` = agent; `claude --print`, `-p`, `--output-format=json` = not (`:47-67`). `--` terminates option parsing: `traecli -- "--print the release notes"` is interactive (`:163-166`).
- Renamed/ambiguous binaries: Trae is `traecli`, explicitly *not* `trae-cli`/`trae-agent` (unrelated bytedance project) (`:133-147`); Kiro is `kiro-cli`, aug is `auggie`, mistral-vibe is `vibe`, qwen-code is `qwen`, continue is `cn` (shell builtin otherwise) — `tui-agent-config.ts:202,216,273,281,243`.
- Substring poisoning: `ante-obsidian`/`antechamber` ≠ ante (`:98-99`); `cmd.exe` ≠ command-code (`:81-82`); `node /tmp/not-an-agent.js "compare opencode vs orca…"` = null (`:332-353`); `node C:\repo\codex.js` = null but `…\@openai\codex\bin\codex.js` = codex (`:344`, `:226-229`).
- Vendor forks: `codex-aarch64-ap`, `grok-0.2.51` (`:11-17`, `:363-368`); Cursor's versioned `cursor-agent/versions/*/index.js` accepted but `C:\repo\cursor-agent\index.js` rejected (`:314-330`).
- Wrappers: `node <nvm>/bin/codex`, `node …npm\codex.cmd`, `python3.12 /opt/homebrew/bin/hermes --tui`, `python -m aider`, `python …\Scripts\aider.py` (`:194-235`).
- Title tests (`agent-detection.test.ts`): `~/mimo/working`, `pi-scratch ready`, `cursor.exe`, `~/cursor-rules` all reject; `OC | …` accepts, `oc | …`/`OCTOPUS |` reject (`:104-151`); status words inside an OpenCode session summary stay inert (`:135-143`).

## 3. Worth porting to anywhere-terminal

1. **Whole-token name matching with a path-aware boundary** — `agent-name-token-match.ts:36-41`: `(?<![\w./\\-])name(?:\.(exe|cmd|bat|ps1))?(?![\w./\\-])`. Kills the entire `opencode-blinker`/`openclaude ⊃ claude`/`android ⊃ droid` false-identity class in one regex. Cheapest highest-value port for vault + tab titles.
2. **Two-facet title identity: activity vs committed** — `terminal-title-agent-type.ts:270-287` + `pane-agent-evidence.ts:43-50`. A spinner proves *something runs*; only a name proves *who*. Export both, force callers to pick.
3. **Headless one-shot exclusion table** — `agent-headless-command.ts:9-19`. `claude -p` hook subprocesses are the #1 false "an agent is running" source; the `--` terminator rule (`agent-session-option-agent-args.ts:1-4`) makes it safe against prompts that look like flags.
4. **`+`-in-`ps stat` foreground gate with tree-wide arming** — `agent-foreground-process.ts:44-49,110-136`, over a TTL-deduped `ps` snapshot (`process-table-snapshot.ts:22,168-180`, 500 ms dedupe rationale at `:16-21`). AT owns the pty and knows `shellPid` → real "which agent is foreground right now" almost for free. Note the Ctrl-Z nuance (`:118-123`).
5. **Degraded-scan stickiness** — `stable-foreground-process.ts:24-40`. A failed/timed-out scan returns `available:false` and reuses the last positively-recognized agent instead of falling back to the shell name → a slow scan never fires a false "agent finished". Pairs with the OSC-133-boundary read schedule in `pane-foreground-agent-tracker.ts:37-44,164-232`: read once at command start, *confirm* (don't trust) `133;D` at command end, because full-screen agents leak nested shells' `133;D` onto the main pty. **AT uses shell-integration events (`src/pty/ShellIntegrationEvents.ts`) — this leak almost certainly affects us too.**
6. Bonus: **command-line shadowing** (`pty-connection.ts:1397-1430`) — accumulate typed keystrokes into a pending command line, run the recognizer on Enter → identity for manually-typed `codex`/`opencode` in a generic terminal, gated so typing inside a live TUI can't override process/launch evidence.

## Mapping to anywhere-terminal

- `src/pty/processTree.ts` — grow toward the `ps stat +` foreground gate + snapshot TTL dedupe.
- `src/pty/oscParser.ts`, `ShellIntegrationEvents.ts` — apply the 133;D confirm-don't-trust rule.
- `src/vault/readers/runningSessions.ts` — today PID-registry based (Claude only); the recognizer table generalizes running-detection to codex/opencode without registries.
- Terminal tab titles / vault entries — adopt token-match regex + two-facet identity before showing an agent badge.
