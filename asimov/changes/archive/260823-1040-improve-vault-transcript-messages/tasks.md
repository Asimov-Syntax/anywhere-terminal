# Tasks: improve-vault-transcript-messages

## 1. Classify user records

- [x] 1_1 Add the record classifier and excise injected blocks from prompt text — verified: bun test 'src/vault/readers/userRecord.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-preview/spec.md#{injected-records-are-classified-never-shown-as-user-prompts, injected-blocks-are-excised-from-human-messages} <!-- design.md D1, D2 -->
  - **Acceptance**:
    - Outcome: a task-notification, a compaction record and a plumbing record each classify to their own kind
    - Verify: unit src/vault/readers/userRecord.test.ts
  - **Plan**:
    1. add `src/vault/readers/userRecord.ts` — `classifyUserRecord` returning the D1 tagged union; flags before text, whole-block `startsWith` anchoring, bounded scans for the task-notification field tags
    2. in `src/vault/readers/detail.ts`, extend `cleanPromptText` to excise `<system-reminder>` blocks anywhere in the text and re-classify the remainder; keep its name, signature and existing wrapper behaviour
    3. reuse the bounded tag-scan shape already used for `<teammate-message>` in `detail.ts` rather than adding regex over untrusted text

- [x] 1_2 Emit notice and compaction timeline items, and keep titles clean — verified: bun test 'src/vault/readers/detail.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{injected-records-are-classified-never-shown-as-user-prompts, session-titles-use-the-same-classification} <!-- design.md D1, D3 -->
  - **Acceptance**:
    - Outcome: a transcript with a notification and a compaction yields those two items and no user message carrying either
    - Verify: unit src/vault/readers/detail.test.ts
  - **Plan**:
    1. add the `notice` and `compaction` members to `VaultTimelineItem` in `src/vault/types.ts`
    2. switch `classifyClaudeStyleEvents` in `src/vault/readers/detail.ts` onto the union; bound both bodies with `MAX_MESSAGE_TEXT`
    3. split the text-level half out as `classifyUserText` in `src/vault/readers/userRecord.ts` so the record-level and title paths share one taxonomy
    4. map every non-prompt class to `undefined` in `extractUserText` in `src/vault/readers/claudeRecords.ts` so titles and `firstPrompt` skip them
    5. give both kinds a plain render in `src/webview/vault/previewTimeline.ts` so the tree type-checks; 2_1 replaces it with the collapsed presentation

## 2. Render the new kinds

- [x] 2_1 Render notices and compaction summaries as collapsed items — verified: npx vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/vault-session-preview/spec.md#{notices-and-compaction-summaries-render-collapsed, safe-preview-rendering} <!-- design.md D3 -->
  - **Acceptance**:
    - Outcome: each renders as one line, expanding to its body, and never behind a run cap
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. in `src/webview/vault/renderAtoms.ts`, extract the collapsible head and body shape out of `thinkingBlock` into one builder and re-point `thinkingBlock` at it
    2. add the notice and compaction builders on that shape; a body-less item renders as its line alone with no chevron
    3. add both kinds to `breaksRun` and to `renderTimelineItem` in `src/webview/vault/previewTimeline.ts`
    4. add the accent and collapsed rules to `src/webview/vault/vaultPanel.css` alongside the existing thinking-block rules

## 3. Address a single message

- [x] 3_1 Stamp a reader-assigned locator on message items — verified: npx vitest run 'src/vault/readers/claudeReader.detail.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript <!-- design.md D4 -->
  - **Acceptance**:
    - Outcome: Claude, Codex and OpenCode message items each carry their agent's locator
    - Verify: unit src/vault/readers/claudeReader.detail.test.ts
  - **Plan**:
    1. add optional `msgRef` to the message member of `VaultTimelineItem` in `src/vault/types.ts`
    2. set it from the record `uuid` in `src/vault/readers/detail.ts`, and from the message row id in `src/vault/readers/opencodeReader.ts`
    3. in `src/vault/readers/codexReader.ts`, stamp the line ordinal inside the streaming loop — before the head+tail buffer drops the middle — and emit it as `#<n>`

- [x] 3_2 Resolve a message record host-side and expose it over IPC — verified: npx vitest run 'src/vault/VaultService.detail.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript <!-- design.md D5 -->
  - **Acceptance**:
    - Outcome: a request naming an entry and a locator returns that record's complete JSON
    - Verify: unit src/vault/VaultService.detail.test.ts
  - **Plan**:
    1. add the bounded transcript-line scan both JSONL readers share as `src/vault/readers/recordLine.ts`, covered by `src/vault/readers/recordLine.test.ts`
    2. add a per-reader resolver — Claude scans for the `uuid`, OpenCode selects the row, Codex counts to the ordinal — in `src/vault/readers/claudeReader.ts`, `src/vault/readers/opencodeReader.ts`, `src/vault/readers/codexReader.ts`
    3. add `readMessageRecord` to `src/vault/VaultService.ts`, resolving the store location from the entry id only, capped at 256 KB with an error above it
    4. add the request and response messages to `src/types/messages.ts` and the handler case to `src/providers/TerminalViewProvider.ts`

## 4. Per-message actions

- [x] 4_1 Add the shared hover action bar with Markdown and JSON copy — verified: npx vitest run 'src/webview/vault/messageActions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1, 3_1
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: the hovered message shows a copy control offering Markdown and JSON
    - Verify: unit src/webview/vault/messageActions.test.ts
  - **Plan**:
    1. add `src/webview/vault/messageActions.ts` — one bar element plus a delegated hover and focus handler that positions it into the hovered message and resolves that element back to its source item
    2. bind each message element to its source item in `src/webview/vault/renderAtoms.ts`, passed in from `src/webview/vault/previewTimeline.ts`; add no per-message listener in either
    3. mount the bar in the preview body and route its writes through the existing `clipboardChain` in `src/webview/vault/PreviewController.ts`
    4. add the reveal-on-hover rules to `src/webview/vault/vaultPanel.css`

- [x] 4_2 Wire Raw copy to the host round-trip — verified: npx vitest run 'src/webview/vault/messageActions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2, 4_1
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript <!-- design.md D5, D6 -->
  - **Acceptance**:
    - Outcome: Raw copies the untruncated record, and reports unavailability instead of confirming
    - Verify: unit src/webview/vault/messageActions.test.ts
  - **Plan**:
    1. request the record from `src/webview/vault/PreviewController.ts` and resolve the pending copy on the reply, keyed by entry id and locator
    2. add the Raw action to `src/webview/vault/messageActions.ts`, hidden for a message carrying no locator; on an error reply leave the clipboard untouched and do not confirm
    3. route the reply through `src/webview/messaging/MessageRouter.ts`, `src/webview/main.ts` and `src/webview/vault/VaultPanel.ts` to the controller

## 5. Continue in New Session

- [x] 5_1 Compose the handoff prompt — verified: bun test 'src/vault/ContinuationPrompt.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-launch/spec.md#handoff-prompt-composition-and-safety <!-- design.md D7 -->
  - **Acceptance**:
    - Outcome: the prompt carries source, transcript path, the capped message quote and both instructions
    - Verify: unit src/vault/ContinuationPrompt.test.ts
  - **Plan**:
    1. add `src/vault/ContinuationPrompt.ts` — `buildContinuationPrompt(entry, messageText)` following the section order in design D7, quote capped at 4000 characters, transcript path included only when the entry is file-backed

- [x] 5_2 Add the continue launch mode — verified: bun test 'src/vault/LaunchBuilder.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: specs/vault-session-launch/spec.md#handoff-prompt-composition-and-safety <!-- design.md D7 -->
  - **Acceptance**:
    - Outcome: each agent's continue argv carries the prompt as one inert argument
    - Verify: unit src/vault/LaunchBuilder.test.ts
  - **Plan**:
    1. add `continueCommand` to `AgentVaultDefinition` in `src/vault/types.ts` and per agent to `src/vault/registry.ts` — claude and codex positional, opencode behind `--prompt`
    2. add `"continue"` to `LaunchMode` and the `{{prompt}}` token to `substituteTokens` and `build` in `src/vault/LaunchBuilder.ts`, taking the value from the call rather than the entry
    3. pass the mode through `src/vault/VaultLauncher.ts`, refusing an agent with no continue command

- [x] 5_3 Wire the action from the message to the launch — verified: npx vitest run 'src/providers/TerminalViewProvider.vaultContinue.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2, 4_1, 5_2
  - **Refs**: specs/vault-session-launch/spec.md#continue-a-stored-session-in-a-new-session <!-- design.md D6, D8 -->
  - **Acceptance**:
    - Outcome: activating it on a user message opens a new tab running that agent, seeded from the message
    - Verify: unit src/providers/TerminalViewProvider.vaultContinue.test.ts
  - **Plan**:
    1. add the `vaultContinueSession` message carrying entry id and locator to `src/types/messages.ts`
    2. recover the quoted message's own text from a resolved record per agent in `src/vault/messageText.ts`, covered by `src/vault/messageText.test.ts`, refusing anything that is not a human turn
    3. in `src/providers/TerminalViewProvider.ts`, resolve the record, build the prompt, launch through the existing vault launch path, and surface the existing error notice when any step fails
    4. add the action to the bar for user messages only in `src/webview/vault/messageActions.ts`, wired from `src/webview/vault/PreviewController.ts`

## 6. Continue feedback

- [x] 6_1 Anchor the handoff prompt to the chosen message — verified: npx vitest run 'src/vault/ContinuationPrompt.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_3
  - **Refs**: specs/vault-session-launch/spec.md#handoff-prompt-composition-and-safety <!-- design.md D7 -->
  - **Acceptance**:
    - Outcome: the prompt names where the message sits in the transcript and marks the later turns as the attempt being resumed from
    - Verify: unit src/vault/ContinuationPrompt.test.ts
  - **Plan**:
    1. take the locator in `buildContinuationPrompt` in `src/vault/ContinuationPrompt.ts` and render it per agent — a uuid to grep, a rollout line, a message row id — beside the quote
    2. scope the transcript instruction to that anchor and say what the turns after it are
    3. pass the locator through from `src/providers/TerminalViewProvider.ts`

- [x] 6_2 Close the preview when a continue launches — verified: npx vitest run 'src/webview/vault/messageActions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_3
  - **Refs**: specs/vault-session-launch/spec.md#continue-a-stored-session-in-a-new-session <!-- design.md D8 -->
  - **Acceptance**:
    - Outcome: activating Continue dismisses the preview overlay
    - Verify: unit src/webview/vault/messageActions.test.ts
  - **Plan**:
    1. close the overlay in the `continueFrom` handler in `src/webview/vault/PreviewController.ts`, after the message is posted

## 7. Accepted review findings (round 1, partial)

- [x] 6_3 Make the action bar keyboard-reachable and stop leaking Raw requests — verified: npx vitest run 'src/webview/vault/messageActions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_2
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript <!-- .reviews/round-1.md F1, F2 -->
  - **Acceptance**:
    - Outcome: a real focus on a message reveals the bar, and closing the preview settles every pending Raw request
    - Verify: unit src/webview/vault/messageActions.test.ts
  - **Plan**:
    1. make a source-bound message focusable in `src/webview/vault/renderAtoms.ts` so Tab reaches it
    2. reject and clear `pendingRecords` in `closePreview` in `src/webview/vault/PreviewController.ts`
    3. replace the synthetic `focusin` assertion with one that focuses the element and reads `document.activeElement`

- [x] 6_4 Classify session titles from the whole record, not just its message — verified: npx vitest run 'src/vault/readers/claudeReader.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_2
  - **Refs**: specs/vault-session-preview/spec.md#session-titles-use-the-same-classification <!-- .reviews/round-1.md L1 -->
  - **Acceptance**:
    - Outcome: a compaction record titles nothing, matching what the timeline does with it
    - Verify: unit src/vault/readers/claudeReader.test.ts
  - **Plan**:
    1. take the whole record in `extractUserText` in `src/vault/readers/claudeRecords.ts` and route it through `classifyUserRecord`
    2. update its callers in `src/vault/readers/claudeRecords.ts`, `src/vault/readers/claudeReader.ts` and `src/vault/readers/claudeTeam.ts`

- [x] 6_5 Resolve an OpenCode record completely, or fail — verified: npx vitest run 'src/vault/readers/opencodeReader.detail.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_2
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript <!-- .reviews/round-1.md L2, L3, L4 -->
  - **Acceptance**:
    - Outcome: a part-query failure and an unparseable part each refuse rather than returning a partial record
    - Verify: unit src/vault/readers/opencodeReader.detail.test.ts
  - **Plan**:
    1. drop the preview part cap from the resolver in `src/vault/readers/opencodeReader.ts` and bound it by the record byte cap instead
    2. fail the resolve when either query fails, rather than substituting an empty part list
    3. refuse extraction in `src/vault/messageText.ts` when any stored part cannot be parsed, covered in `src/vault/messageText.test.ts`

- [x] 6_6 Reject a locator that does not address a message — verified: npx vitest run src/vault/readers/codexReader.detail.test.ts src/vault/readers/claudeReader.detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_2
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript <!-- .reviews/round-1.md L5, L6 -->
  - **Acceptance**:
    - Outcome: a locator pointing at a tool call or other non-message record resolves nothing
    - Verify: command npx vitest run src/vault/readers/codexReader.detail.test.ts src/vault/readers/claudeReader.detail.test.ts
  - **Plan**:
    1. require a message-shaped record in the codex predicate in `src/vault/readers/codexReader.ts`
    2. require a user or assistant record in the claude predicate in `src/vault/readers/claudeReader.ts`
    3. cover both in `src/vault/readers/codexReader.detail.test.ts` and `src/vault/readers/claudeReader.detail.test.ts`

## 8. User feedback

- [x] 7_1 Carry the session's run settings into a continued session — verified: npx vitest run 'src/vault/LaunchBuilder.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_6
  - **Refs**: specs/vault-session-launch/spec.md#continue-a-stored-session-in-a-new-session
  - **Acceptance**:
    - Outcome: continuing an entry captured in a permission-bypassing mode starts the new session in that mode
    - Verify: unit src/vault/LaunchBuilder.test.ts
  - **Plan**:
    1. give each agent's `continueCommand` in `src/vault/registry.ts` the same captured run flags its `resumeCommand` carries — model and permission posture, not the session locator — with the prompt token last
    2. cover the continue expansion in `src/vault/LaunchBuilder.test.ts`

## 9. Continue redesign (user feedback)

- [x] 8_1 Resolve the fork point from either side of a turn — verified: npx vitest run 'src/webview/vault/forkPoint.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_1
  - **Refs**: specs/vault-session-launch/spec.md#continue-a-stored-session-in-a-new-session <!-- design.md D9 -->
  - **Acceptance**:
    - Outcome: an assistant message and the user message after it resolve to the same anchor and seed pair
    - Verify: unit src/webview/vault/forkPoint.test.ts
  - **Plan**:
    1. add `src/webview/vault/forkPoint.ts` — from a timeline and a chosen item, return `{ anchorRef?, seedRef?, anchorText? }` per the D9 table
    2. expose the rendered timeline to the bar in `src/webview/vault/messageActions.ts` so either entry point resolves through one function
    3. offer Continue on assistant messages too in `src/webview/vault/messageActions.ts`
    4. pass the rendered timeline in from `src/webview/vault/PreviewController.ts`; 8_3 replaces its launch call with the dialog

- [x] 8_2 Let the host answer which agents can be continued into — verified: npx vitest run 'src/vault/registry.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_1
  - **Refs**: specs/vault-session-launch/spec.md#continuation-is-confirmed-before-anything-launches <!-- design.md D11 -->
  - **Acceptance**:
    - Outcome: the reply lists only agents present on PATH that have a continue command, each with its permission choices
    - Verify: unit src/vault/registry.test.ts
  - **Plan**:
    1. add optional `permissionChoices` to `AgentVaultDefinition` in `src/vault/types.ts` and populate it per agent in `src/vault/registry.ts` — Claude's four modes, Codex's approval plus sandbox presets, none for OpenCode
    2. add the detection probe beside the data it filters in `src/vault/registry.ts`, on the injectable exec shape `src/vault/forkSupport.ts` already uses
    3. add the request and response messages to `src/types/messages.ts` and the handler to `src/providers/TerminalViewProvider.ts`

- [x] 8_3 Build the confirmation dialog — verified: npx vitest run 'src/webview/vault/ContinueDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_1, 8_2
  - **Refs**: specs/vault-session-launch/spec.md#continuation-is-confirmed-before-anything-launches <!-- design.md D10, D11, D12 -->
  - **Acceptance**:
    - Outcome: activating Continue opens a dialog that starts nothing until confirmed, and nothing at all when dismissed
    - Verify: unit src/webview/vault/ContinueDialog.test.ts
  - **Plan**:
    1. add `src/webview/vault/ContinueDialog.ts` — source line, anchor preview, editable instruction, intent checkbox (checked), agent select, permission select, cwd line, and a dismiss plus a start control
    2. fill the editor from the D5 record round trip so the instruction is the untruncated message, not the timeline's capped text
    3. add the dialog rules to `src/webview/vault/vaultPanel.css`
    4. open it from `src/webview/vault/PreviewController.ts` instead of posting the launch directly
    5. route the launch-targets reply through `src/webview/messaging/MessageRouter.ts`, `src/webview/main.ts` and `src/webview/vault/VaultPanel.ts`, as the record reply already is

- [x] 8_4 Compose the prompt around a reader-authored instruction — verified: npx vitest run 'src/vault/ContinuationPrompt.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_3
  - **Refs**: specs/vault-session-launch/spec.md#handoff-prompt-composition-and-safety <!-- design.md D10, D12 -->
  - **Acceptance**:
    - Outcome: the prompt carries the reader's instruction, the anchoring reply's locator, and the intent block only when it was left enabled
    - Verify: unit src/vault/ContinuationPrompt.test.ts
  - **Plan**:
    1. take the instruction, the optional anchor ref and the intent flag in `buildContinuationPrompt` in `src/vault/ContinuationPrompt.ts`; keep the cap and the fence
    2. carry the dialog's fields on `vaultContinueSession` in `src/types/messages.ts` and thread them through `src/providers/TerminalViewProvider.ts`
    3. compose the anchor line from the locator alone — the prompt needs the address, not the record — and compose without it when there is none

- [x] 8_5 Launch under the chosen agent and permission posture — verified: npx vitest run 'src/vault/LaunchBuilder.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_4
  - **Refs**: specs/vault-session-launch/spec.md#continuation-is-confirmed-before-anything-launches <!-- design.md D11 -->
  - **Acceptance**:
    - Outcome: the argv is the chosen agent's continue command carrying that choice's permission args
    - Verify: unit src/vault/LaunchBuilder.test.ts
  - **Plan**:
    1. take the target agent and permission choice id in `build` in `src/vault/LaunchBuilder.ts`, defaulting to the entry's agent and captured posture
    2. expand the choice's args ahead of the prompt token; drop the captured `--permission-mode` fragment from `continueCommand` in `src/vault/registry.ts` now the choice owns it
    3. thread the choice from the handler in `src/providers/TerminalViewProvider.ts` through `src/vault/VaultLauncher.ts`

- [x] 9_1 Fix the dialog's field sizing — verified: manual — user reloaded the window and confirmed: no field crosses the card edge, the reply box opens taller and drags, and the resizer no longer paints a light frame
  - **Deps**: 8_5
  - **Refs**: specs/vault-session-launch/spec.md#continuation-is-confirmed-before-anything-launches <!-- user feedback -->
  - **Acceptance**:
    - Outcome: no field overflows the card, and the anchor preview opens taller and resizes
    - Verify: manual open the dialog and check no field crosses the card edge and the reply box drags taller
  - **Plan**:
    1. give every full-width field in `src/webview/vault/vaultPanel.css` a border-box, since this codebase sets it per rule rather than globally
    2. open the anchor preview taller and make it drag-resizable, as the instruction box already is
    3. drop the now-unused `extractMessageText` import 8_4 left behind in `src/providers/TerminalViewProvider.ts`
    4. theme the scrollbar corner and the resizer on both boxes — Chromium paints them light by default, which is the white frame under a scrollable resizable field

- [x] 9_2 Keep the dialog open, and give the reply box the same handle as the editor — verified: npx vitest run 'src/webview/vault/ContinueDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_5
  - **Refs**: specs/vault-session-launch/spec.md#continuation-is-confirmed-before-anything-launches <!-- user feedback -->
  - **Acceptance**:
    - Outcome: clicking inside the dialog leaves it open
    - Verify: unit src/webview/vault/ContinueDialog.test.ts
  - **Plan**:
    1. exclude the dialog from the preview shell's outside-click dismissal in `src/webview/vault/PreviewController.ts` — it mounts outside the card, so every click in it read as a click outside the preview
    2. render the anchor preview as a read-only textarea in `src/webview/vault/ContinueDialog.ts` so its resizer matches the instruction box instead of painting over the scrollbar
    3. drop the div's own resize rules in `src/webview/vault/vaultPanel.css`

## 10. Accepted review findings (round 2)

- [x] 10_1 Validate the continuation launch frame host-side — verified: npx vitest run src/providers/TerminalViewProvider.vaultContinue.test.ts src/vault/ContinuationPrompt.test.ts src/vault/LaunchBuilder.test.ts src/vault/messageText.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_2
  - **Refs**: specs/vault-session-launch/spec.md#{continuation-is-confirmed-before-anything-launches, handoff-prompt-composition-and-safety} <!-- design.md D13; .reviews/round-2.md B1, W1, W2 -->
  - **Acceptance**:
    - Outcome: a continuation launches only with a host-resolved assistant anchor, inert store metadata and the exact visible permission choice
    - Verify: command npx vitest run src/providers/TerminalViewProvider.vaultContinue.test.ts src/vault/ContinuationPrompt.test.ts src/vault/LaunchBuilder.test.ts src/vault/messageText.test.ts
  - **Plan**:
    1. add agent-specific assistant-record validation and canonical locator recovery in `src/vault/messageText.ts`, covered by `src/vault/messageText.test.ts`
    2. resolve and validate `anchorRef` before prompt composition in `src/providers/TerminalViewProvider.ts`, covered by `src/providers/TerminalViewProvider.vaultContinue.test.ts`
    3. serialize store-derived metadata as an explicitly untrusted fenced block in `src/vault/ContinuationPrompt.ts`, covered by `src/vault/ContinuationPrompt.test.ts`
    4. reject an unknown explicit permission choice and use the first visible safe choice only for an unsupported implicit captured posture in `src/vault/LaunchBuilder.ts`, covered by `src/vault/LaunchBuilder.test.ts`

- [x] 10_2 Enforce Raw byte bounds before materialization — verified: npx vitest run src/vault/readers/recordLine.test.ts src/vault/readers/claudeReader.detail.test.ts src/vault/readers/codexReader.detail.test.ts src/vault/readers/opencodeReader.detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_2
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript <!-- design.md D14; .reviews/round-2.md B2, B3 -->
  - **Acceptance**:
    - Outcome: oversized JSONL lines and OpenCode row sets are refused before the extension host materializes their complete record
    - Verify: command npx vitest run src/vault/readers/recordLine.test.ts src/vault/readers/claudeReader.detail.test.ts src/vault/readers/codexReader.detail.test.ts src/vault/readers/opencodeReader.detail.test.ts
  - **Plan**:
    1. replace the readline resolver in `src/vault/readers/recordLine.ts` with a byte-chunk physical-line scanner carrying bounded target hints, covered by `src/vault/readers/recordLine.test.ts`
    2. pass the Claude uuid and Codex ordinal hints from `src/vault/readers/claudeReader.ts` and `src/vault/readers/codexReader.ts`, preserving their reader detail tests
    3. preflight the exact encoded size of OpenCode record rows in SQLite before fetching payloads in `src/vault/readers/opencodeReader.ts`, covered by `src/vault/readers/opencodeReader.detail.test.ts`

- [x] 10_3 Keep fork, Raw-action and dialog state exact across preview bounds — verified: npx vitest run src/vault/readers/detail.test.ts src/webview/vault/forkPoint.test.ts src/webview/vault/ContinueDialog.test.ts src/webview/vault/messageActions.test.ts src/webview/vault/VaultPanel.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_2
  - **Refs**: specs/vault-session-launch/spec.md#{continue-a-stored-session-in-a-new-session, continuation-is-confirmed-before-anything-launches} specs/vault-session-preview/spec.md#{notices-and-compaction-summaries-render-collapsed, copying-a-single-message-from-the-transcript} <!-- design.md D15; .reviews/round-2.md B4, W3-W7, S1 -->
  - **Acceptance**:
    - Outcome: bounded previews keep continuation, Raw actions, modality and teardown exact
    - Verify: command npx vitest run src/vault/readers/detail.test.ts src/webview/vault/forkPoint.test.ts src/webview/vault/ContinueDialog.test.ts src/webview/vault/messageActions.test.ts src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. add a `gap` timeline kind and reader-owned locators for notice/compaction items in `src/vault/types.ts` and `src/vault/readers/detail.ts`, covered by `src/vault/readers/detail.test.ts`
    2. stop fork scans at a gap and return an empty fork point for an unanchored user turn in `src/webview/vault/forkPoint.ts`, covered by `src/webview/vault/forkPoint.test.ts`
    3. bind notice/compaction blocks to the shared Raw action while keeping message-only actions hidden in `src/webview/vault/renderAtoms.ts`, `src/webview/vault/previewTimeline.ts` and `src/webview/vault/messageActions.ts`, covered by `src/webview/vault/messageActions.test.ts` and `src/webview/vault/VaultPanel.test.ts`
    4. extract the shared latest-success state machine to `src/webview/vault/latestSuccess.ts`, use it from `src/webview/vault/renderAtoms.ts` and `src/webview/vault/messageActions.ts`, and cover it through the existing copy suites
    5. make instruction loading fail closed, keep keyboard focus modal, restore it on dismissal and dispose action bars on every body teardown in `src/webview/vault/ContinueDialog.ts` and `src/webview/vault/PreviewController.ts`, covered by `src/webview/vault/ContinueDialog.test.ts` and `src/webview/vault/VaultPanel.test.ts`
    6. render the gap affordance and required interaction states in `src/webview/vault/vaultPanel.css`

## 11. Interruption feedback

- [x] 11_1 Render a user interruption as a notice — verified: npx vitest run src/vault/readers/userRecord.test.ts src/vault/readers/detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 10_3
  - **Refs**: specs/vault-session-preview/spec.md#injected-records-are-classified-never-shown-as-user-prompts <!-- design.md D2; user feedback, session c2e95097-c96a-4d04-905e-ba28876311b6 -->
  - **Acceptance**:
    - Outcome: an interrupted Claude response produces a notice and no user message
    - Verify: command npx vitest run src/vault/readers/userRecord.test.ts src/vault/readers/detail.test.ts
  - **Plan**:
    1. classify a user record carrying `interruptedMessageId` as an interruption notice in `src/vault/readers/userRecord.ts`, covered by `src/vault/readers/userRecord.test.ts`
    2. cover the timeline outcome in `src/vault/readers/detail.test.ts`

## 12. Accepted review findings (round 3)

- [x] 12_1 Close the remaining reader snapshot and gap boundaries — verified: npx vitest run src/vault/readers/opencodeReader.detail.test.ts src/vault/readers/codexReader.detail.test.ts src/vault/readers/claudeReader.detail.test.ts src/webview/vault/forkPoint.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 11_1
  - **Refs**: specs/vault-session-preview/spec.md#copying-a-single-message-from-the-transcript specs/vault-session-launch/spec.md#continue-a-stored-session-in-a-new-session <!-- design.md D14, D15; .reviews/round-3.md B3, W4, W9 -->
  - **Acceptance**:
    - Outcome: Raw bounds and continuation gaps remain correct under live growth and duplicate locator text
    - Verify: command npx vitest run src/vault/readers/opencodeReader.detail.test.ts src/vault/readers/codexReader.detail.test.ts src/vault/readers/claudeReader.detail.test.ts src/webview/vault/forkPoint.test.ts
  - **Plan**:
    1. replace OpenCode's multi-snapshot preflight/fetch with one conditional bounded SQL result in `src/vault/readers/opencodeReader.ts`, covered by a live-growth regression in `src/vault/readers/opencodeReader.detail.test.ts`
    2. emit the shared gap sentinel before Codex payload parsing in `src/vault/readers/codexReader.ts`, covered by `src/vault/readers/codexReader.detail.test.ts`
    3. insert an OpenCode gap between proven non-overlapping message windows before timeline bounding in `src/vault/readers/opencodeReader.ts`, covered by `src/vault/readers/opencodeReader.detail.test.ts`
    4. use an exact serialized Claude `uuid` field/value hint in `src/vault/readers/claudeReader.ts`, covered by a quoted-uuid oversized-line case in `src/vault/readers/claudeReader.detail.test.ts`

- [x] 12_2 Enforce and announce the confirmed instruction boundary — verified: npx vitest run src/webview/vault/ContinueDialog.test.ts src/vault/ContinuationPrompt.test.ts src/providers/TerminalViewProvider.vaultContinue.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 11_1
  - **Refs**: specs/vault-session-launch/spec.md#{continuation-is-confirmed-before-anything-launches, handoff-prompt-composition-and-safety} <!-- design.md D15, D16; .reviews/round-3.md W6, W8, S3 -->
  - **Acceptance**:
    - Outcome: the dialog and host enforce one visible instruction cap without changing confirmed text or leaking modal focus
    - Verify: command npx vitest run src/webview/vault/ContinueDialog.test.ts src/vault/ContinuationPrompt.test.ts src/providers/TerminalViewProvider.vaultContinue.test.ts
  - **Plan**:
    1. add the dependency-free shared cap in `src/vault/continuationLimits.ts` and consume it from `src/vault/ContinuationPrompt.ts` and `src/webview/vault/ContinueDialog.ts`
    2. expose the cap and counter, remove the anchor preview from tab order and make async status a polite live region in `src/webview/vault/ContinueDialog.ts` and `src/webview/vault/vaultPanel.css`, covered by `src/webview/vault/ContinueDialog.test.ts`
    3. reject over-cap IPC instructions before prompt composition in `src/providers/TerminalViewProvider.ts`, covered by `src/providers/TerminalViewProvider.vaultContinue.test.ts`
    4. refuse over-cap prompt requests without truncating in `src/vault/ContinuationPrompt.ts`, covered by `src/vault/ContinuationPrompt.test.ts`
