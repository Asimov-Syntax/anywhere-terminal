# Tasks: stop-wasted-worktree-renders

## 1. Host gate

- [x] 1_1 Require the window to be displaying a surface before pushing to it — verified: bun test 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-tree-protocol/spec.md#deliver-each-push-only-to-surfaces-showing-the-view, design.md D2, design.md D4
  - **Acceptance**:
    - Outcome: an undisplayed surface receives no push
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. Add the display-state flag to `SurfaceState` in `src/providers/WorktreeHost.ts`, defaulting false for the reason the existing `visible` comment already gives, and require it in `broadcast()`'s recipient test.
    2. Widen `attach()`'s return to a handle carrying `dispose()` plus the setter, leaving `dispose()` in place so existing call sites keep compiling.
    3. In `src/providers/WorktreeHost.test.ts`, add the two cases the delta's scenarios pin — a declared-but-undisplayed surface is skipped, and a surface that has never reported display state is skipped. Both must fail before step 1.
    4. Every suite that attaches a surface and expects a push now has to say the window is displaying it. `src/providers/WorktreeHost.invalidation.test.ts` attaches without reporting, so move it to the same helper — setup only, no assertion changes.
    5. The gate and its only producers cannot land apart — a gate with nothing reporting leaves every worktree surface silent — so wire both here: report from the existing subscriptions in `src/providers/TerminalViewProvider.ts` and `src/providers/TerminalEditorProvider.ts`, seeding each at attach time. Proving that seam is 2_1.

- [x] 1_2 Serve a surface the moment it begins showing the view again — verified: bun test 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#serve-a-surface-that-is-displayed-again, design.md D3
  - **Acceptance**:
    - Outcome: a surface displayed again receives the current listings
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, make the transition into "showing" edge-triggered on the ANDed value rather than on either input, so a repeated report is a no-op.
    2. On that edge, post the current listings to that surface alone; where nothing has been built, take the existing `built === false` path instead of adding a second one.
    3. Build the message once and vary only the recipient set, so single-surface delivery cannot drift from `broadcast()`.
    4. Cover in `src/providers/WorktreeHost.test.ts`: listings change while a surface is not displayed, and it receives them on being displayed again with the rebuild count unchanged; and a repeated display report pushes nothing further.

## 2. Provider wiring

- [x] 2_1 Report display state from both providers that own a worktree surface — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#deliver-each-push-only-to-surfaces-showing-the-view, design.md D1
  - **Acceptance**:
    - Outcome: hiding and re-showing a worktree surface moves the host's view of whether it is displayed
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. Extend `src/providers/TerminalViewProvider.worktree.test.ts` with the round trip that hides a surface and shows it again, asserting pushes stop and resume — the wiring 1_1 had to land is unproven at this seam until it does.
    2. Add the editor panel's equivalent to `src/providers/TerminalEditorProvider.test.ts`, whose event carries `webviewPanel.visible` rather than the view's own flag.
    3. Correct the seeding or reporting in `src/providers/TerminalViewProvider.ts` and `src/providers/TerminalEditorProvider.ts` where the round trip shows 1_1 got it wrong.

## 3. Guard coverage

- [x] 3_1 Make an unkeyed wire field fail the build rather than render stale — verified: pnpm exec vitest run 'src/webview/worktree/worktreeRenderSignature.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: a wire field missing from the render key fails the build
    - Verify: unit src/webview/worktree/worktreeRenderSignature.test.ts
  - **Plan**:
    1. Build the fully populated fixtures in `src/webview/worktree/worktreeRenderSignature.test.ts`, typed so every field of the tree, repo, worktree, presence, agent-row and subagent shapes must be set — an added field is then a type error until the fixture sets it.
    2. Replace the hand-written mutation list at `:43-80` with a walk over those fixtures' own keys, asserting each moves the signature, descending into the nested row and subagent shapes.
    3. Give the walk an allow-list of excluded field names, each carrying its reason; `scannedAt` is the only current entry and the existing test at `:36-41` already states why.
    4. Confirm the walk fails when a field is added to a fixture and not to the key, then restore — a coverage proof that never went red proves nothing.

## 4. Review fixes (round 1)

- [x] 4_1 Close the round-1 findings on key coverage and the consumed rise — verified: bun test 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: .reviews/round-1.md#{b1, b2, w1}, design.md D3, design.md D5
  - **Acceptance**:
    - Outcome: a re-show whose delivery did not land is retried rather than consumed
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. B1 — key `viewId` on the agent row and `entryId` on the subagent row in `src/webview/worktree/worktreeRenderSignature.ts`, and delete their two allow-list entries in `src/webview/worktree/worktreeRenderSignature.test.ts`. Neither has a reader today; both are read by the Phase 4 tasks this proof exists to protect, and a listener closing over a row makes a no-op render hand back the old value.
    2. B2 — give the inline `unreadable` shape its own `Required` fixture and coverage entry in `src/webview/worktree/worktreeRenderSignature.test.ts`, so each of its fields is exercised on its own rather than only the first one `perturb` reaches.
    3. W1 — make `postTo` in `src/providers/WorktreeHost.ts` report whether it delivered, and record the rising edge only when delivery happened or none was owed, so a skipped or throwing post leaves the edge available to a later report.
    4. Cover in `src/providers/WorktreeHost.test.ts`: a post that throws on the rise, then a repeat report that succeeds; and the same for a surface that was not ready at the rise.
