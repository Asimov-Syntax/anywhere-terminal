# Orca deep-dive 3/7 — Interactive prompt / question / interrupt detection

Source repo: `/Users/huybuidac/Projects/ai-oss/orca`. Directly relevant to AT's AskUserQuestion timeline item and any future "answer from the panel" affordance.

## 1. Detection mechanisms + captured data

**Primary: hook-driven.** Vendor events fold into `working | blocked | waiting | done` (`src/shared/agent-status-types.ts:18`); `waiting`/`blocked` both render as the "permission" visual state (`src/renderer/src/lib/agent-status.ts:167-177`).

Three prompt classes, distinguished by **tool name**, not event name:

- **AskUserQuestion** — `isAskUserQuestionTool()` normalizes punctuation/case and matches `askuserquestion` or `requestuserinput`, covering Claude `AskUserQuestion`, grok/Pi `ask_user_question`, Codex ≥0.145 `request_user_input` (`agent-question-answered-intent.ts:19-22`). Claude emits it as `PreToolUse` (auto-allowed) — normally a *working* event — so there's an explicit override to `waiting` (`agent-hook-listener.ts:2980-2995`). Same override for Kimi (`:3265`), Droid (`:4132`), Pi (`:4071`), Grok (`:4237`).
- **Permission prompt** — `hook_event_name: 'PermissionRequest'` with any other tool → `waiting`. OpenCode maps its `permission.asked` SDK event onto that name (`opencode-permission-status.test.ts:7-20`). Copilot's PermissionRequest fires on *every* invocation so it's deliberately kept `working` (`:3994`); Codex/Amp pre-execution gates likewise (`:3950`).
- **Plan approval** — no dedicated path; `ExitPlanMode` arrives as a normal PermissionRequest/tool approval and renders as an approval card.

**Captured payload** is one string field, `interactivePrompt`, built by `deriveInteractivePrompt` (`agent-hook-listener.ts:918-951`):

- question → `JSON.stringify(tool_input)` **untruncated** (full `{questions:[{question,header,multiSelect,options:[{label,description}]}]}`), capped at 16000 chars vs the 160-char `toolInput` preview (`agent-status-types.ts:274-276`). No-truncation rule pinned by `agent-hook-listener-interactive-prompts.test.ts:104-134`.
- approval → `JSON.stringify({approval:{tool, summary}})`, summary = `command ?? file_path ?? path ?? url ?? pattern`, else clipped JSON (`:901-916`).

**Fallback: terminal-output parsing** for hookless/remote panes (`src/main/runtime/orca-runtime.ts`):

- `findTerminalWaitBlockedSignal` (`:40160-40250`) scans the lowercased screen tail for codex update/trust/cwd/model-migration/hooks-review prompts + generic approval (`runtime-types.ts:787-794`), gated by one combined sentinel regex first for cost.
- Cursor's approval menu matched *structurally*: ≥2 lines each containing a marker (`'run (once)'`, `'to allowlist?'`, `'run everything'`, `'skip & tell the agent'`, `:40079`) **and** ending in a key-hint regex `(esc|tab|enter|⏎…)$` (`:40126-40134`), confined to the last 8 lines so an answered menu in scrollback doesn't re-fire (`:40089`), and the last choice line must be the last line (`:40117`).
- Staleness: a later "ready prompt" index beats an earlier blocked-signal index (`:39947`, `:39980`).
- OSC-title status as third source (`:18908`).
- `getTerminalInteractiveWait` (`:18883-18930`) fuses all three, returns `{source: 'prompt-text'|'title'|'hook'}` with a tri-state contract: `null` = evaluated, not waiting; `undefined` = **could not evaluate** — never conflated (`:18879-18882`).

## 2. Answering — keystrokes to the PTY

Pure PTY writes, no API/file. `buildAskAnswerKeys` (`src/shared/native-chat-ask.ts:204-249`) returns ordered key groups; `sendNativeChatAskAnswer` (`native-chat-runtime-send.ts:337-390`) writes one group per `NATIVE_CHAT_QUESTION_STEP_MS` tick — **a navigation key batched with Enter commits before the selector applies it**.

Sequences (`native-chat-ask.ts:185-189`): `ASK_ENTER='\r'`, `ASK_NEXT_TAB='\x1b[C'`, `ASK_PREVIOUS_ROW='\x1b[A'`, `ASK_NEXT_ROW='\x1b[B'`, `ASK_NOTES='\t'`, cancel/deny `ESC='\x1b'`, Codex skip `'\x7f'`.

**Key insight** (`native-chat-ask.ts:176-184`): pasting the option **label** silently answered as option 1 — bare Enter commits the *highlighted* row and pasted text doesn't move the highlight. So answers are driven by the option's **1-based number**:

- Claude: single-select digit selects+commits and auto-advances; free text = `String(options.length+1)` ("Type something" row) + text + `\r`; multi-select digits toggle then `\x1b[C` to Submit; multi-question/multi-select ends with one `\r`.
- Codex (`buildCodexAskAnswerKeys :257-304`): submits on the final digit; notes attach to the highlighted row via arrow-nav + Tab + text + Enter.
- Approval cards: raw `'1'` = Allow, `ESC` = Deny (`native-chat-interactive-prompt.ts:75-78`).

Delivery is *verified*: `sendRuntimePtyInputVerified` returns the host's acceptance; the card stays visible if `delivered === false` (`native-chat-runtime-send.ts:356-378`).

## 3. Confirming the answer / clearing stale prompts

Claude emits **no hook when a question is answered** — orca infers it from the submit keystroke:

- Renderer hot path: `observeSentTerminalInput` rejects with one Set lookup before touching state (`agent-question-answered-inference.ts:71-83`). Candidate inputs: `\r`, `\n`, `\r\n`, `\x1b[13u`, `\x1b[13;1u`, digits `1-9` (`agent-question-answered-intent.ts:24-35`).
- **Prompt-shape gate** (`:37-85`): a digit only counts if the cached `interactivePrompt` parses to exactly one non-multiSelect question and `digit <= options.length`. Malformed JSON fails closed.
- Renderer sends a **baseline snapshot** (`paneKey, baselineUpdatedAt, baselineStateStartedAt, baselinePrompt, baselineAgentType`); main re-validates every field plus `restoredUnconfirmed`, staleness, and that the tool is still an ask tool (`server.ts:999-1049`). A racing real hook always wins.
- On success `clearClaudeAnsweredQuestionWait` (`agent-hook-listener.ts:2849-2876`) restores the stashed pre-wait lead state, wipes the tool snapshot except `lastAssistantMessage`, re-gates against running children.
- Stale-card prevention, three layers: `resolveToolState` **never inherits** `previous.interactivePrompt` (`:706-716`); `deriveInteractivePrompt` refuses to rebuild on post-tool events (`:924-940`); `waitingToolUseId` lets a *parallel sibling's* PostToolUse re-emit the cached waiting payload instead of clearing the card (`:3024-3034`, `:3143`).
- UI dismisses by content key so the post-tool echo of the same prompt doesn't re-show, resetting the dismissal once the prompt clears (`NativeChatInteractiveCard.tsx:11-30, 74-107`).

## 4. Interrupt intent

Renderer captures a baseline on Escape/Ctrl+C (`agent-interrupt-inference.ts`), waits `AGENT_INTERRUPT_SETTLE_MS = 500` for a real hook before firing (`agent-interrupt-intent.ts:5`). Per-agent:

- opencode/copilot need **double Escape** on the same turn (first Escape is a TUI cancel), arming baseline expires after 500ms (`:41-46, :241-258`).
- gemini, codex+Escape, double-escape agents flush **immediately** — they emit an idle hook before the settle timer fires (`:48-56`).
- droid + Ctrl+C ignored entirely (exits the CLI) (`:58-63`).
- Escape on a Claude pane already `waiting` on an ask tool reroutes to the *question-answered* path, not interrupt (`server.ts:935-942`).

Main-side vetoes (`server.ts:901-996`): `providerSessionOnly`, `restoredUnconfirmed`, strict baseline equality, staleness, any non-idle subagent, Claude panes with running non-agent tasks/session crons. On success it marks the lead turn interrupted so later child events can't resurrect `working`.

## 5. Worth porting to anywhere-terminal

1. **One `interactivePrompt` string, untruncated, capped separately from tool preview** — two envelope shapes (`{questions}` / `{approval}`) discriminated at parse time unify AskUserQuestion + permission + plan approval in one vault timeline item type. AT already has the AskUserQuestion timeline item; this generalizes it.
2. **Answer by option number, never by label** — highest-value if AT grows "answer from vault panel": pasting the label silently answers option 1.
3. **Paced keystroke groups + verified writes** — one group per tick; nav-key + Enter in one batch commits early.
4. **Never inherit the prompt across events + `waitingToolUseId`** — kills stale cards from parallel-tool completions, exactly the failure mode a timeline rendering questions inline will hit.
5. **Baseline-revalidated inference** for the missing "answered" event — renderer proposes with a snapshot, authority re-validates every field so a real event always wins. Generalizes to any inferred lifecycle transition.
6. **Prompt-shape gate before treating a digit as submit** (`agent-question-answered-intent.ts:37-85`).
7. **Structural output matching with recency window** (`orca-runtime.ts:40079-40134`): marker + trailing-key regex, last 8 lines, must own the bottom of the screen; ready-prompt-index beats blocked-index. Far more robust than substring matching for hookless agents.
8. **Tri-state wait result** — `null` (not waiting) vs `undefined` (couldn't evaluate) must never collapse.
