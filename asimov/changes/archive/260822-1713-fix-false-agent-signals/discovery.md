# Discovery: fix-false-agent-signals

Source: `docs/research/20260822-orca-deep-dive/00-overview.md` §A "Bug-fix candidates
(likely live issues in AT today)" — 7 candidates (A1-A7) derived from reading orca
v1.4.178-rc.2. §A is explicitly a *candidate* list; this discovery verifies each
against AT's actual code before committing scope.

## Workstreams

| Workstream | Status | Method |
|---|---|---|
| Memory Recall | Done | `asm memory search` — restore/hydrate + running-detection priors |
| Existing Design/Plan Docs | Done | direct read — `asimov/specs/{claude-running-session-map,shell-integration-tracker,cross-restart-session-restore}` |
| Architecture Snapshot | Done | direct read — activity/title pipeline, OSC parser, session resolver |
| Internal Patterns | Done | direct read — vendored VS Code shell-integration scripts |
| External Research | Skipped | already captured in `docs/research/20260822-orca-deep-dive/` (7 docs) |
| Constraint Check | Skipped | no new deps, no build change |

## Key Findings

### 1. AT has no agent turn-state model — only pty-output activity

`TerminalActivityTracker` (`src/webview/terminal/TerminalActivityTracker.ts:25-49`)
sets `activityStatus = "running"` on any pty output and decays it to `"idle"` after
1500 ms of quiet. `TabBarUtils.buildTabBarData` (`:44-52`) aggregates it across split
leaves. That is the *entire* status pipeline: there is no `done` state, no completion
event, and no OS notification anywhere in the codebase.

Consequence for §A: candidates written against orca's 4-state turn machine
(`working`/`waiting`/`blocked`/`done`) have no consumer in AT that could lie.

### 2. A1 (sessionBoundary false-done) — NOT a live bug

Orca's rule is "a resumed/cleared session landing idle must not count as a completed
turn". AT never counts completed turns. `VaultLauncher` resume spawns a real
`claude --resume` process whose real output lights the tab; the signal is truthful.
A1 is a **precondition for C1** (hook status pipeline), not a defect today.

### 3. A2 (phantom running after reload) — NOT a live bug

Three independent guards already hold:

- Restore replays into xterm directly — `main.ts:795` `instance.terminal.write(msg.serializedBuffer)`
  — bypassing `onOutput`, so `activityTracker.markOutput` is never called for replayed bytes.
- `TerminalFactory.createTerminal` initialises `activityStatus: "idle"` (`:442`).
- `SessionSnapshotMetadata` (`src/session/SessionSnapshot.ts:11-60`) does not persist any
  activity/running field, so nothing can be resurrected as "running".

After a reload the extension host restarts, ptys die, and `isAgentLaunch` sessions are
re-spawned — a tab that lights up afterwards is genuinely running. Same verdict as A1:
`restoredUnconfirmed` becomes necessary only once C1 introduces persisted status.

### 4. A3 (spinner-title render churn) — LIVE

`TerminalFactory.ts:448-452` handles every xterm `onTitleChange` by assigning
`instance.name` and calling `onTabBarUpdate()` unconditionally. Agent TUIs rewrite the
OSC 0/2 title once per spinner frame (braille `U+2800-28FF`; Claude 2.1 quarter-circles
`U+25D0-25D3`), so a single working agent drives a full `renderTabBar()` pass ~10×/s:
Map rebuild, `querySelectorAll`, and unconditional `statusSpan.className` /
`tab.dataset.status` writes (`TabBarUtils.ts:183-189`). The name text write itself is
guarded (`:180`) but everything upstream of it is not. With N split panes running agents
the cost is N× and lands on the webview's main thread alongside xterm rendering.

Orca's fix is a *signature* comparison: strip decorative frame glyphs, collapse
whitespace, and skip the update when the signature is unchanged
(`agent-decorative-title-signature.ts:20-23,50-52`; doc 06 §4).

### 5. A4 (headless `claude -p` mis-mapping) — LIVE

`resolveClaudeSession` step 1 (`src/session/resolveClaudeSession.ts:60-71`) intersects
the live PID registry (`~/.claude/sessions/<pid>.json`) with the pane's pty descendants,
and on >1 match calls `pickNewest` — most-recently-modified `<sessionId>.jsonl` wins.

A Claude hook, a `settings.json` command, or any helper that shells out to
`claude -p`/`--print` runs as a descendant of the same pty and registers its own pid
file. Its transcript is written *at that moment*, so it reliably wins the mtime
tie-break against the interactive session the user is actually looking at. The pane then
resolves to a one-shot headless session and subagent preview
(`TerminalViewProvider.ts:758`, `TerminalEditorProvider.ts:691`) shows the wrong
transcript or `notFound`.

Orca's exclusion table plus the `--` terminator rule is the fix
(`agent-headless-command.ts:9-19`, doc 01 §3.3): treat argv containing `-p`,
`--print`, or `--output-format <non-tty>` *before* any `--` as headless and drop it
from the candidate set.

Blocker: AT has no way to read a pid's argv today — `processTree.ts` queries only
`pid ppid`. This change must widen that query.

### 6. A5 (OSC 633 command-end leak from nested shells) — LIVE

Chain verified end to end:

1. `PtyManager.ts:259-266` spawns zsh/bash with `--login`.
2. `injectShellIntegration` passes `ZDOTDIR=<temp>` **in the spawn env**, so zsh carries
   it as an exported parameter.
3. `resources/shell-integration/shellIntegration-rc.zsh:191-193` restores
   `ZDOTDIR=$USER_ZDOTDIR` only `if [[ $options[login] = off && … ]]` — for AT's login
   shell the temp `ZDOTDIR` therefore **stays exported to every child process**.
4. The re-entry guard `VSCODE_SHELL_INTEGRATION=1` is assigned without `export`
   (`shellIntegration-rc.zsh:15`, `shellIntegration-bash.sh:11`) → not inherited.

So any nested *interactive* zsh — the shells full-screen agents spawn for their tool
calls — re-sources the vendored rc and emits its own `OSC 633;A/B/C/D` onto the parent's
pty. `OscParser.handleOsc633` (`src/pty/oscParser.ts:211-239`) trusts `D` unconditionally
and emits `commandEnd`, closing the parent's in-flight `TrackedCommand` early — output
after that point is dropped from the export.

Note `VSCODE_NONCE` is `unset` after capture (`rc.zsh:99-100`, `bash.sh:175-176`), so the
nested shell's `E` (command line) markers *do* fail nonce validation — but `A`/`B`/`C`/`D`
carry no nonce and are not covered by that defence.

### 7. A6 (paste/Enter race) — NOT a live bug

No code path writes prompt text and `\r` in one pty write. The only `\x1b\r` write is
`main.ts:1052` (Alt+Enter for codex on Windows), which carries no payload. Worth a
regression guard so a future programmatic send path cannot regress into it, but no
production change.

### 8. A7 (substring agent-name matching) — no live call site

AT never matches agent identity by name: running detection is pid-registry based
(`runningSessions.ts`), and `registry.ts` `detect.executable` is used for launch, not for
recognising a running process. The `openclaude ⊃ claude` false-identity class therefore
cannot occur today. The token-boundary matcher is still needed as the *substrate* for A4
(recognising `claude` in an argv string), so it lands there rather than as its own fix.

## Gap Analysis

| Component | Have | Need | Gap |
|---|---|---|---|
| Tab title updates | Unconditional re-render per OSC title write (`TerminalFactory.ts:448`) | Skip when only decorative frame glyphs changed | Decorative-signature function + call-site guard |
| Process table query | `ps -axo pid=,ppid=` (`processTree.ts:88-93`) | argv per pid, to classify headless | Widen query to `pid,ppid,args`; keep pure parse testable |
| Claude session resolution | pid ∩ subtree, mtime tie-break (`resolveClaudeSession.ts:60-71`) | Drop headless `claude -p` candidates before tie-break | Headless classifier + new dep on the resolver |
| Agent name matching | none | Token-boundary match, path/extension aware | New shared util (A7 substrate) |
| OSC 633 `D` handling | Trusted unconditionally (`oscParser.ts:231-239`) | Only close a command the same shell opened | Depth/ownership guard in the parser |
| Nested-shell env | temp `ZDOTDIR` exported to children (login shells) | Nested shells must not re-source | Env-level fix at spawn, or parser-level guard, or both |

## Options

### Option A — Parser-only guard for A5

Ignore `633;D` when no `633;C` was seen on this pty since the last `D` (state machine
rejects unbalanced end markers). Pure, unit-testable, no shell-script edits, works for
bash/fish/pwsh too.

Trade-off: a *nested* shell that emits a full `C…D` pair still opens and closes a phantom
command, corrupting the tracked-command list even though the parent's command survives.
Fixes the truncation but not the pollution.

### Option B — Env fix only

Stop exporting the temp `ZDOTDIR` past the login shell (unset it in the vendored rc, or
export `VSCODE_SHELL_INTEGRATION` so the guard is inherited).

Trade-off: edits vendored MIT VS Code scripts, which we resync from upstream — drift risk
and a maintenance note on every future sync. Also cannot defend against a shell that
sources the integration for its own reasons.

### Option C — Env fix + parser guard (Recommended)

Do both, with the env fix carried as an AT-owned wrapper rather than an edit to the
vendored file: after the vendored rc is sourced, AT's own snippet unsets the temp
`ZDOTDIR`. The parser guard stays as defence-in-depth and is what the tests assert
against, so correctness does not depend on a shell script we do not own.

Recommended because the parser guard alone leaves phantom commands in the export list,
and the env fix alone is silently lost on the next vendored-script resync.

### Option D — Confirm-don't-trust via process probe

Orca's literal approach: on `D`, probe the process tree to confirm the agent really
exited before closing the command.

Trade-off: an async `ps` shell-out on the hot OSC path, per command end. Rejected —
`OscParser` is synchronous and pure by design (`oscParser.ts` header), and the ownership
question is answerable structurally without IO.

## Risks

1. **Widening the `ps` query changes parse surface** (`processTree.ts`) — `args` contains
   spaces, so the existing `^(\d+)\s+(\d+)$` line regex breaks. Mitigation: keep
   `parseProcessTable` returning the same map for existing callers and add a separate
   parse for the argv variant; both stay pure with fixture tests.
2. **`ps` output truncation** — BSD `ps` truncates long command lines. A `claude -p` with a
   huge prompt could have its flags visible but tail cut. Mitigation: the classifier only
   inspects the leading argv tokens up to `--`, which survive truncation.
3. **A5 fix could suppress legitimate `D`** — a real command end must never be dropped.
   Mitigation: the guard only rejects a `D` with no matching open `C`; balanced pairs are
   untouched. Covered by an explicit "normal command still closes" test.
4. **Vendored-script drift** — if the env fix touches `resources/shell-integration/*`, the
   next upstream resync silently reverts it. Mitigation: Option C keeps the fix in
   AT-owned code (`ShellIntegrationInjector`), not in the vendored file.
5. **Scope honesty** — A1/A2 are dropped as not-live. Risk that they resurface once C1
   lands. Mitigation: recorded above and in `proposal.md` Out of Scope with the exact
   precondition that would make them real.

## Open questions

None blocking. A5's runtime reproduction (nested interactive zsh under a full-screen
agent) is asserted from the code chain rather than observed; the parser-level test is
written against the marker stream, so it holds regardless of how the nested shell got
there.

---

## 9. Post-oracle verification (2026-08-22)

An independent oracle review challenged §5 and §6. Both challenges were re-verified
directly; the results overturn part of this document. Findings above are left intact and
corrected here rather than rewritten, so the reasoning trail stays auditable.

### 9.1 §6 (A5) is WRONG — there is no `ZDOTDIR` leak

`resources/shell-integration/shellIntegration-login.zsh:6` sets `ZDOTDIR=$USER_ZDOTDIR`
**unconditionally, as its first statement** — before the `-o login` guard. AT spawns
`--login` (`PtyManager.ts:266`), so the copied `.zlogin` always runs and always restores
`ZDOTDIR`. Independently, when the user has a `.zshrc`, `shellIntegration-rc.zsh:28-29`
has already set `ZDOTDIR=$USER_ZDOTDIR` before sourcing it.

§6 concluded a leak from the fact that `rc.zsh:191` restores `ZDOTDIR` only for non-login
shells. That reading was incomplete: the login path has its own restore in a different
file. Both branches therefore end with `ZDOTDIR = USER_ZDOTDIR`, so a nested zsh reads the
user's real config and never re-sources the integration. bash/fish/pwsh receive
`--init-file` / `--init-command` / `-command` *arguments*, which children do not inherit.

**No verified trigger for the nested-marker leak exists in AT.** A5 is dropped from this
change and recorded as unverified hardening.

The oracle additionally showed the proposed alt-screen gate was unsound in its own right:
`shellIntegration-rc.zsh:135-141,161-168` emits `D` from `precmd` with no screen-state
check, so a command that enters the alternate screen and dies without restoring
(`printf '\e[?1049h'`, a SIGKILLed TUI) leaves the scanner latched and the *real* `D` would
be dropped — turning a hypothetical bug into a certain one. Two independent reasons to
drop it.

### 9.2 §5 (A4) is CONFIRMED — with a cheaper classifier than argv

Empirically verified on this machine (claude 2.1.239). Running
`claude -p "reply with the single word: ok"` while polling `~/.claude/sessions/`:

```
registry file count: 9 → 10 → 9        (a live PID file is written, then removed on exit)
new file 30454.json:
  {"pid":30454, … "kind":"interactive", "entrypoint":"sdk-cli", …}
ps -p 30454 -o args=:
  claude -p reply with the single word: ok
```

So a headless one-shot **does** register a live PID file and **can** compete in
`resolveClaudeSession` step 1. A4 is live.

Two classifiers are available, and the registry one is strictly better:

| Signal | Cost | Verdict |
|---|---|---|
| `entrypoint` field | free — `runningSessions.ts` already reads and parses this file | **Chosen.** Interactive sessions carry `"cli"`; the headless run carried `"sdk-cli"` |
| `kind` field | free | **Useless** — the headless entry also reported `"interactive"` |
| argv via `ps -o args=` | widens the `ps` query, adds a parse variant, changes `ResolveClaudeSessionDeps` and both provider wirings | Rejected — same answer for materially more surface |

The oracle's instinct to prefer registry metadata over reconstructed argv was right; its
specific suggestion (`kind`) was not, and the measurement above is why the plan names
`entrypoint` instead.

### 9.3 Residual limitation (accepted, not fixed)

Filtering the running registry covers steps 1 and 2 of resolution. Step 3
(`newestSessionUnderCwd`) picks the newest transcript on disk regardless of how it was
produced, so a *finished* `claude -p` run can still win there. It is only reachable when no
running session matches at all — i.e. the pane has no live Claude — so the mis-mapped
preview it could produce is a much weaker failure than the live-process case. Filtering it
would require reading each transcript's metadata; deferred.
