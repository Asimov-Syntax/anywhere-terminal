# Tasks: separate-presence-subscription-from-view-visibility

## 1. Let a surface ask for presence without asking for rows

- [x] 1_1 Carry a subscription level on the visibility message and read it in the host — verified: pnpm exec vitest run 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md#{d1-the-message-carries-a-level-not-a-second-boolean, d2-the-host-tracks-the-level-per-surface-the-scan-follows-subscription-enrichment-follows-drawing}
  - **Acceptance**:
    - Outcome: a presence-only subscriber still receives presence, and stops arming per-row work
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. In `src/types/messages.ts`, add an optional level to the visibility message, defaulting to the drawing one, and rewrite the doc comment so the field says what it now means rather than "pixels on screen".
    2. In `src/providers/WorktreeHost.ts`, store the level per surface beside the existing visible and displayed flags, leaving anyShowing and the scan arming untouched.
    3. In `src/providers/WorktreeHost.ts`, add a predicate answering whether any attached, displayed, subscribed surface is drawing rows, and pass its answer into the projection call.
    4. In `src/providers/WorktreeHost.test.ts`, cover: a presence-only surface arms the scan; it receives presence; the projection it drives is told not to enrich; one drawing surface makes the window enrich for all; and a surface that never subscribed still receives nothing.

- [x] 1_2 Skip per-row enrichment when nobody is drawing rows — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md#d3-projectoptions-gains-enrich-defaulting-true
  - **Acceptance**:
    - Outcome: a projection told not to enrich reads no titles and no previews, and ranks the same
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. In `src/worktree/presenceProjector.ts`, add the enrich option, defaulting true, and skip the title and preview passes when it is false.
    2. In `src/worktree/presenceProjector.test.ts`, cover: with enrichment off no title or preview read is issued; the rows and their waiting states are unchanged; and ranking still updates, since a stale order would reorder every group the moment the rail reopened.

- [x] 1_3 Post the level from the controller, and keep body work on the panel's own request — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.state.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d4-in-the-controller-body-work-keys-on-drawing-subscription-keys-on-either; specs/worktree-panel/spec.md#a-surface-subscribes-to-presence-for-what-it-draws-not-for-the-rail
  - **Acceptance**:
    - Outcome: collapsing under a scope keeps presence flowing, and still cancels an in-flight create
    - Verify: unit src/webview/worktree/WorktreeController.state.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeController.ts`, keep the panel's request and the scope's need in separate fields and derive the posted level from both, posting only when the level or the subscription itself changes.
    2. In `src/webview/worktree/WorktreeController.ts`, key the pendingCreate cleanup and body-only refresh eligibility on the panel's request falling to false, NOT on the subscription ending — this is the regression the earlier attempt shipped.
    3. In `src/webview/main.ts`, supply the scope-need callback and revalidate on the render route every scope change already reaches.
    4. In `src/webview/worktree/WorktreeController.test.ts`, update the one test that pins the exact visibility message shape — the level is part of it now.
    5. In `src/webview/worktree/WorktreeController.state.test.ts`, cover: collapsing under a scope posts the presence level rather than going quiet; clearing the scope then unsubscribes; a scope set while collapsed subscribes; a surface with no scope source behaves as it does today; and — the regression test — collapsing under a scope still cancels an in-flight create.

## 2. Round-1 review fixes

- [x] 2_1 Let an unresolved scope bootstrap, enrich on promotion, and make the two weak tests discriminate — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.state.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2, 1_3
  - **Refs**: design.md#d4-in-the-controller-body-work-keys-on-drawing-subscription-keys-on-either; specs/worktree-panel/spec.md#a-surface-subscribes-to-presence-for-what-it-draws-not-for-the-rail
  - **Acceptance**:
    - Outcome: a persisted scope resolves itself with the body hidden, and a reopened rail draws enriched rows
    - Verify: unit src/webview/worktree/WorktreeController.state.test.ts
  - **Plan**:
    1. In `src/webview/tabBarScope.ts`, add a predicate for "a scope is persisted, whether or not a tree has confirmed it", true only while the workbench is on (round-1 B1).
    2. In `src/webview/tabBarScopeWiring.ts`, expose that predicate on the interface main.ts consumes.
    3. In `src/webview/main.ts`, drive presenceNeeded from the new predicate rather than from effectiveScope, so an unresolved persisted scope subscribes and can be confirmed or dropped.
    4. In `src/webview/worktree/WorktreeController.ts`, request the tree when a standing subscription is promoted from presence to rows, so a reopened rail does not display the bare envelope until the next poll (round-1 W1). Demotion still requests nothing.
    5. In `src/providers/WorktreeHost.test.ts`, drive the scan through the injectable clock instead of a direct tree request, asserting that a presence-only subscriber arms it, that it runs with enrichment off, and that the last presence subscription ending cancels it (round-1 W2).
    6. In `src/worktree/presenceProjector.test.ts`, assert the rank value advances to the newer session under enrichment off, rather than merely remaining defined (round-1 S1).
    7. In `src/webview/tabBarScope.test.ts` and `src/webview/worktree/WorktreeController.state.test.ts`, cover a valid and a stale persisted scope with the body hidden, and the promotion request.
