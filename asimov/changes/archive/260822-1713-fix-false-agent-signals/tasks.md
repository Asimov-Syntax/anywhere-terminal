# Tasks: fix-false-agent-signals

## 1. Tab-title render churn (A3)

- [x] 1_1 Add the decorative title-signature helper
  - **Deps**: none
  - **Refs**: specs/process-title-tracking/spec.md#requirement-osc-title-change-handling; design.md D4
  - **Scope**: `src/webview/terminal/titleSignature.ts`, `src/webview/terminal/titleSignature.test.ts`
  - **Acceptance**:
    - Outcome: `titleSignature(t)` strips `U+2800`–`U+28FF` and `U+25D0`–`U+25D3`, collapses whitespace runs to one space, and trims; `⠋ Fix tests` and `⠙ Fix tests` yield an identical signature while `⠋ Run build` differs.
    - Verify: unit src/webview/terminal/titleSignature.test.ts
  - **Plan**:
    1. Export one pure function; strip via a single character-class regex, collapse `\s+` to `" "`, trim. Cover empty string, all-decoration title, quarter-circle frames, and a title with no decoration.

- [x] 1_2 Gate the tab-bar re-render on the title signature
  - **Deps**: 1_1
  - **Refs**: specs/process-title-tracking/spec.md#requirement-osc-title-change-handling; design.md D4
  - **Scope**: `src/webview/terminal/TerminalFactory.ts`, `src/webview/state/WebviewStateStore.ts`, `src/webview/terminal/titleSignature.test.ts`
  - **Scope deviation (build)**: no `TerminalFactory.test.ts` exists and `createTerminal` constructs a real xterm `Terminal`, so the gating logic was extracted into `applyTitleChange` (same module as `titleSignature`) and tested there. `TerminalFactory` is a 2-line call site covered by type-check.
  - **Acceptance**:
    - Outcome: the `onTitleChange` handler assigns `instance.name` the raw title on every event, and calls `onTabBarUpdate()` only when the new signature differs from the stored one; the first title after creation always renders.
    - Verify: unit src/webview/terminal/TerminalFactory.test.ts
  - **Plan**:
    1. Add `lastTitleSignature?: string` AND `lastTitleDecorated?: boolean` to the terminal-instance type in `WebviewStateStore.ts` — both halves of the compared state must be declared, or a future typed rebuild silently drops the decoration bit and re-lands the frozen-spinner bug.
    2. In `TerminalFactory.ts:448`, compute the signature, always set `instance.name`, then compare-and-store before calling `onTabBarUpdate()`.
    3. Test: two spinner frames with identical text → one `onTabBarUpdate` call and `name` equal to the newest frame; changed text → a second call.

## 2. Headless `claude -p` mis-mapping (A4)

- [x] 2_1 Carry `entrypoint` through the running-session registry and expose the headless predicate
  - **Deps**: none
  - **Refs**: specs/claude-running-session-map/spec.md#requirement-detect-running-claude-sessions; design.md D1, D2; docs/research/20260822-orca-deep-dive/01-agent-detection.md
  - **Scope**: `src/vault/readers/runningSessions.ts`, `src/vault/readers/runningSessions.test.ts`
  - **Acceptance**:
    - Outcome: `RunningClaudeSession` carries optional `entrypoint` read verbatim when it is a string and left `undefined` otherwise; `isHeadlessSession` returns true only for values in `HEADLESS_ENTRYPOINTS` (currently `{"sdk-cli"}`) and false for `"cli"`, an unknown value, an empty string, and `undefined`; existing malformed-file and liveness behaviour is unchanged.
    - Verify: unit src/vault/readers/runningSessions.test.ts
  - **Plan**:
    1. Add the optional field to the interface and read it with a `typeof === "string"` guard inside the existing per-file try/catch.
    2. Keep `HEADLESS_ENTRYPOINTS` module-private (a `ReadonlySet` is an erased view over a live `Set`, so exporting it would let a caller `add("cli")`) and export only `isHeadlessSession`, with a comment naming the measured evidence (`discovery.md` §9.2) and why it is an allow-list (design.md D2).
    3. Tests: fixture files for `cli`, `sdk-cli`, absent, and non-string `entrypoint`.

- [x] 2_2 Discard headless sessions before resolving a terminal's Claude session
  - **Deps**: 2_1
  - **Refs**: specs/claude-running-session-map/spec.md#requirement-map-a-terminal-to-its-claude-session; design.md D3
  - **Scope**: `src/session/resolveClaudeSession.ts`, `src/session/resolveClaudeSession.test.ts`
  - **Acceptance**:
    - Outcome: the list returned by `deps.listRunning()` is filtered through `isHeadlessSession` once, before step 1, so headless entries can win neither the subtree intersection nor the cwd fallback; a step whose candidates are all filtered falls through to the next step instead of returning null; step 3 is unfiltered.
    - Verify: unit src/session/resolveClaudeSession.test.ts
  - **Plan**:
    1. Filter immediately after `await deps.listRunning()`; add a comment pointing at design.md D3 for why it is not filtered per-step.
    2. Tests: headless child with newer transcript mtime loses to the interactive session in the subtree; headless-only subtree falls through to the cwd fallback; headless entry in the cwd fallback is skipped; unknown `entrypoint` is retained; existing multi-candidate, Windows (`[]` subtree), and step-3 cases stay green.

## 3. Injection regression guard (A6)

- [x] 3_1 Assert the text-insert paths never emit payload text terminated by Enter
  - **Deps**: none
  - **Refs**: design.md D5; docs/research/20260822-orca-deep-dive/05-prompt-injection.md; proposal.md Out of scope
  - **Scope**: `src/webview/DragDropHandler.test.ts`
  - **Scope deviation (build)**: `InputHandler` posts only the `\x15` control payload — xterm handles paste natively, so no text flows through it. The only webview path that emits payload TEXT is `DragDropHandler`'s path insertion, so the guard lives with the code it actually guards.
  - **Acceptance**:
    - Outcome: a test drives the paste and path-insert helpers, captures the posted `input` messages, and asserts none matches `/[^\x00-\x1f]\r$/`; a case asserts the bare `"\x1b\r"` Alt+Enter payload is NOT flagged. A comment names the Claude "prompt stays editable" failure being guarded.
    - Verify: unit src/webview/DragDropHandler.test.ts
  - **Plan**:
    1. Assert the predicate over captured drop payloads, including the `"\x1b\r"` allowed case. Implemented as a code-point check rather than `/[^\x00-\x1f]\r$/` because Biome's `noControlCharactersInRegex` rejects the regex form.
