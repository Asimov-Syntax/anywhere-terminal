# Tasks: collapse-the-rail-after-a-sidebar-selection

## 1. Hand the room back after a selection

- [x] 1_1 Collapse the rail on an explicit selection in the stacked layout — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-selection-in-the-narrow-layout-hands-the-room-back, a-collapse-the-user-did-not-ask-for-is-not-their-choice}
  - **Acceptance**:
    - Outcome: selecting a worktree in the stacked layout collapses the rail, and nothing else does
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/VaultPanel.ts`, add a public `collapseAfterSelection()` that calls `this.setCollapsed(true, { persist: false })` and returns early when already collapsed, so an automatic collapse is never written into `vaultCollapsed`.
    2. In `src/webview/main.ts`, call it from the `onSelectWorktree` callback passed to `WorktreeController.mount`, alongside the existing `tabBarScope?.onSelectWorktree(worktreeId)`, and only when `msg.worktreeWorkbench` is true, the selection is a worktree rather than `null`, and the layout is the stacked one.
    3. In `src/webview/main.ts`, read the stacked-layout condition from the `webview-layout` element's `file-tree--top` / `file-tree--bottom` class the way `runAuxCollapseAnimation` already does, so one definition of the axis serves both and a user who docked the rail to a side keeps it open.
    4. In `src/webview/vault/VaultPanel.test.ts`, cover: an automatic collapse does not call `persistCollapsed`; it is inert when the rail is already collapsed; and the user's own header toggle still persists.

- [-] 1_2 Keep presence flowing to a surface that holds a scope — reverted by 2_1 (round-1 B1/B2/S2), then DELIVERED by the dependency change separate-presence-subscription-from-view-visibility, archived at 01b1227b. The behaviour this task names now ships: main.ts supplies presenceNeeded and revalidatePresence, and a collapsed rail holding a scope stays subscribed at the presence level. Not re-implemented here (round-2 B4).
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#scope-does-not-depend-on-the-layout
  - **Acceptance**:
    - Outcome: a scoped surface keeps receiving presence with the rail collapsed
    - Verify: none — nothing is built here; the dependency change carries the tests for this behaviour
  - **Plan**: SUPERSEDED — do not follow. Every step below described widening the
    `worktreeViewVisibility` boolean to mean "still draws from presence", which the round-1 review rejected as blockers one and two and suggestion two: the same value arms the external scan, so it kept uncapped per-row enrichment alive
    for a body drawing nothing, and it put the `pendingCreate` cleanup behind an early return. The
    shipped mechanism is a subscription LEVEL on that message, designed and built in
    `separate-presence-subscription-from-view-visibility` (archived 01b1227b); read its design.md
    D1-D4 rather than anything here. The dead spec anchor this task used to cite went with the
    revert (round-2 review S1).

## 2. Round-1 review fixes

- [x] 2_1 Cut the presence widening and close the rollout, focus and motion gaps — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-selection-in-the-narrow-layout-hands-the-room-back, a-collapse-the-user-did-not-ask-for-is-not-their-choice}
  - **Acceptance**:
    - Outcome: round-1 blockers are gone — the gate reads the live rollout, the collapse animates and keeps focus
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. Revert task 1_2 in `src/webview/worktree/WorktreeController.ts` — drop the presenceNeeded dep, the separate requested field and revalidateVisibility, restoring the single-valued setVisible so every hide reaches the pendingCreate cleanup (round-1 B1, B2, S2).
    2. Revert the matching wiring in `src/webview/main.ts` — the presenceNeeded argument and the revalidateVisibility call in the render callback.
    3. Remove the presence describe from `src/webview/worktree/WorktreeController.state.test.ts` and the two scope entries 1_2 added to `asimov/changes/collapse-the-rail-after-a-sidebar-selection/specs/worktree-panel/spec.md`, since the behaviour they specify moves to its own change.
    4. In `src/webview/main.ts`, gate the automatic collapse on a live rollout read rather than the init-time snapshot, so an off-to-on flip starts collapsing and an on-to-off flip stops (round-1 B3).
    5. In `src/webview/vault/VaultPanel.ts`, separate persistence from animation so the automatic collapse animates through the shared reduced-motion path while still not writing vaultCollapsed (round-1 S1).
    6. In `src/webview/vault/VaultPanel.ts`, move focus to a surviving control when the element being hidden holds it (round-1 W1).
    7. Extract the gate into a pure predicate in `src/webview/vault/collapseAfterSelection.ts` alongside the stacked-layout read, since `src/webview/main.ts` is a bootstrap module that exports nothing and cannot be unit-tested; this also stops the three invariants living only in the caller (round-1 W-level shape note).
    8. In `src/webview/vault/collapseAfterSelection.test.ts`, cover both rollout directions, a null selection, and each docked layout.
    9. In `src/webview/vault/VaultPanel.test.ts`, cover the animation on an automatic collapse and the focus handoff.
