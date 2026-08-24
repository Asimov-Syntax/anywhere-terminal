## 1. Contract

- [x] 1_1 Add the optional `continuation` flag to the sub-agent activity step and nested session item — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D3
  - **Acceptance**:
    - Outcome: both sub-agent shapes accept an optional `continuation` boolean
    - Verify: command pnpm run check-types
  - **Plan**:
    1. In `src/vault/types.ts`, add `continuation?: boolean` to the `kind: "subagent"` arm of `VaultActivityStep` and the `kind: "subagentSession"` arm of `VaultTimelineItem`, documented per the Interfaces sketch.

## 2. Reader normalization

- [x] 2_1 Mark continuations instead of deleting them, and name them from the full decoded set — verified: bun test 'src/vault/readers/cursorNormalization.test.ts' && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{cursor-subagent-continuation-identity, cursor-subagent-continuation-placement, cursor-subagent-declared-type-resolution} <!-- design.md D1, D2 -->
  - **Acceptance**:
    - Outcome: every invocation of a resumed agent survives, labelled with the declared type
    - Verify: unit src/vault/readers/cursorNormalization.test.ts
  - **Plan**:
    1. In `src/vault/readers/cursorNormalization.ts`, export `collectCursorAgentTypes(...groups)` building `childAgentId → declared type` from every subagent step whose name is not in `SUBAGENT_TOOL_NAMES`.
    2. Give `mergeCursorSubagentInvocations` an optional `declaredTypes` parameter; resolve each group's name from it, falling back to `launchStep()` and then to omitting the type.
    3. Replace the `superseded` filter with marking members after `group[0]` as `continuation: true`; keep `title`/`prompt`/`result`/`status` per member and keep the pass idempotent.
    4. Extend `cursorNormalization.test.ts` for: continuations retained in order, declared type applied when the launch is absent from the merged array, no chip when no launch was decoded, `continuation` unset on the owner, and re-merging one array twice being a no-op.

- [x] 2_2 Wire both Cursor reader paths to the shared type map and keep counts agent-level — verified: pnpm exec vitest run 'src/vault/readers/cursorStore.test.ts' && pnpm run check-types exit 0
  - **Deps**: 2_1
  - **Refs**: specs/vault-session-preview/spec.md#{cursor-subagent-continuation-identity, cursor-subagent-declared-type-resolution} <!-- design.md D2, D4 -->
  - **Acceptance**:
    - Outcome: sub-agent counts report distinct agents, not invocations
    - Verify: unit src/vault/readers/cursorStore.test.ts
  - **Plan**:
    1. In `src/vault/readers/cursorStore.ts`, build the map from `timeline` + `recentActivity` before merging either, pass it to both `mergeCursorSubagentInvocations` calls, and exclude `continuation` steps from `stats.subagentCount`.
    2. Apply the same three edits in `src/vault/readers/cursorTranscript.ts`, building the map from the uncapped `activity` plus the spliced `timeline` so the tail cut cannot hide a declaring launch.
    3. Cover in `cursorStore.test.ts` and `src/vault/readers/cursorTranscript.test.ts`: a twice-resumed background launch keeps all three invocations, names them all, and counts 1; the mirror's unlinkable launch leaves its continuations without a declared type.

- [x] 2_3 Carry the flag through child linking and drop continuations from the recent-activity strip — verified: pnpm exec vitest run 'src/vault/readers/cursorReader.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/vault-session-preview/spec.md#{cursor-subagent-continuation-identity, cursor-subagent-continuation-placement} <!-- design.md D3, D4 -->
  - **Acceptance**:
    - Outcome: a continuation opens the same child transcript as its launch card
    - Verify: unit src/vault/readers/cursorReader.test.ts
  - **Plan**:
    1. In `src/vault/readers/cursorReader.ts`, forward `continuation` from the private step onto the emitted `subagentSession` in `linkCursorChildSessions`.
    2. Filter `continuation` steps out in `visibleRecentActivity` so both reader call sites stay agent-level.
    3. Cover in `cursorReader.test.ts`: launch and continuation share one `entryId` from a single locator issue, the strip omits continuations, and a `limit` slice that cuts the launch card leaves its continuations visible and still named.

## 3. Presentation

- [x] 3_1 Render a continuation as a compact expandable row — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#cursor-subagent-continuation-placement <!-- design.md D5 -->
  - **Acceptance**:
    - Outcome: a continuation shows as a slim `↻ @agent · title` row that expands to the child transcript
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/previewTimeline.ts`, branch `renderSubagentSession` on `item.continuation`: add a `vault-preview-subagent--continuation` modifier, a `↻` glyph in place of the `agent` badge, omit the `firstMessage` paragraph, and keep the existing expand toggle plus `populateNested` wiring unchanged.
    2. In `src/webview/vault/vaultPanel.css`, style the modifier as a single-line subordinate row alongside the existing `.vault-preview-subagent` rules.
    3. Cover in `VaultPanel.test.ts`: the row renders slim with the agent chip and no first message, expanding it requests the shared `entryId`, and launch + continuation hold independent expansion state.

- [x] 3_3 Reveal an invocation's own turn when its card is expanded — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/vault-session-preview/spec.md#nested-invocation-turn-focus <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: expanding an invocation scrolls to and marks the turn its prompt began
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/previewTimeline.ts`, add a module-local `WeakMap` hint set from `renderSubagentSession` on expand and read in `renderNestedInto`; match the first user message whose normalized text starts with the invocation's normalized prompt, mark it, and feature-detect `scrollIntoView`.
    2. In `src/webview/vault/vaultPanel.css`, style the focus mark so it fades rather than persisting as permanent state.
    3. Cover in `VaultPanel.test.ts`: the third invocation marks the third turn, a non-matching prompt marks nothing, and an invocation without a prompt marks nothing.

- [x] 3_4 Match an invocation turn across the prompt's paragraph breaks — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_3
  - **Refs**: specs/vault-session-preview/spec.md#nested-invocation-turn-focus <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: an invocation whose prompt contains a blank line still reveals its own turn
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/previewTimeline.ts`, match on the prompt's first paragraph long enough to be evidence rather than the whole prompt — rendered block elements concatenate with no separator, so a blank line is unmatchable. Clear a prior mark before setting a new one, and centre the revealed turn.
    2. In `src/webview/vault/vaultPanel.css`, keep a durable accent on the revealed turn after the fade so the reveal survives the animation.
    3. Cover in `VaultPanel.test.ts`: a multi-paragraph prompt reveals its turn.

- [x] 3_2 Confirm a resumed Cursor agent reads correctly in a real session detail — verified: manual — User opened a real Cursor chat in the extension: launch card plus one continuation row per resume at its own position, all labelled with the declared type, each opening the same child transcript; expanding a row reveals and marks that invocation own turn
  - **Deps**: 2_2, 2_3, 3_1
  - **Refs**: specs/vault-session-preview/spec.md#{cursor-subagent-continuation-placement, cursor-subagent-declared-type-resolution}
  - **Acceptance**:
    - Outcome: each resume is visible where it happened and opens the agent's full transcript
    - Verify: manual open a Cursor chat that resumed a sub-agent; confirm a launch card plus one row per resume at its own position, all labelled with the declared type, each opening the same child transcript covering every turn
