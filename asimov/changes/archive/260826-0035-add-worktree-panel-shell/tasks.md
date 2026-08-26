<!--
  Retroactive record: the implementation landed before this change was opened. Every task below
  verifies a contract the spec now owes against code that already exists. A failing task is a
  real defect to fix under its lease, not a signal to rebuild.
-->

## 1. Panel shell

- [x] 1_1 Verify the fourth segment swaps the body without disturbing the sessions view
  - **Deps**: none
  - **Refs**: specs/vault-panel/spec.md#{worktree-view-segment, switching-bodies-preserves-what-the-other-body-held, grouping-modes}
  - **Acceptance**:
    - Outcome: Selecting Worktree swaps the body and returns leaving grouping intact.
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. `src/webview/vault/VaultPanel.ts` — segment construction, `setView`, `syncView`, `syncSegmented`.
    2. `src/webview/state/WebviewState.ts` — the persisted view key.

- [x] 1_2 Verify every header control acts on the shown body or is absent
  - **Deps**: 1_1
  - **Refs**: specs/vault-panel/spec.md#{view-scoped-panel-controls, in-panel-client-side-search}
  - **Acceptance**:
    - Outcome: The worktree body issues no session-index request.
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. `src/webview/vault/VaultPanel.ts` — refresh handler, search routing, create and folder-filter gating.

## 2. Tree rendering and the truthfulness rules

- [x] 2_1 Verify tree structure, repo grouping, the path rule, and the render cap
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{present-the-supplied-worktree-tree, no-row-exposes-a-filesystem-path, a-capped-listing-says-it-is-capped}
  - **Acceptance**:
    - Outcome: Every supplied worktree renders once, and no row shows a path.
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeView.ts` — repo and worktree render paths, the cap.
    2. `src/webview/worktree/worktreeTreeView.ts` — row builders and the tooltip that carries the path.

- [x] 2_2 Verify the evidence rules each row encodes
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{strongest-state-wins-and-shape-carries-it, no-agent-identity-is-claimed-without-evidence, activity-confidence-is-marked-independently-of-identity, an-agent-outside-this-window-is-labelled-and-never-offered-focus, subagents-render-as-history}
  - **Acceptance**:
    - Outcome: Every claim a row makes traces to evidence the row carries.
    - Verify: unit src/webview/worktree/worktreeFormat.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreeFormat.ts` — strongest-state precedence, identity and activity predicates.
    2. `src/webview/worktree/worktreeTreeView.ts` — icon gating, scope label, subagent section.

- [x] 2_3 Verify every state the design names renders distinctly
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#{each-cause-of-emptiness-reads-differently, degraded-scope-is-named-and-honest-emptiness-is-not}
  - **Acceptance**:
    - Outcome: Four causes of emptiness read differently and honest emptiness carries no notice.
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeView.ts` — state selection, degraded and action notices.
    2. `src/webview/worktree/worktreeTreeView.ts` — empty states, skeleton, refresh marker.

## 3. Interaction

- [x] 3_1 Verify keyboard traversal follows the hierarchy and focus survives disclosure
  - **Deps**: 2_3
  - **Refs**: specs/worktree-panel/spec.md#{keyboard-traversal-follows-the-declared-hierarchy, filtering-keeps-the-ancestors-of-a-match}
  - **Acceptance**:
    - Outcome: Left reaches the parent, Right stops on a leaf, focus never falls to body.
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeView.ts` — `navRows`, `depthOf`, `parentOf`, `expandOrDescend`, focus restore.
    2. `src/webview/worktree/worktreeTreeView.ts` — the stable key each row carries.

- [x] 3_2 Verify both disclosure levels persist independently and absent differs from empty
  - **Deps**: 3_3
  - **Refs**: specs/worktree-panel/spec.md#two-independent-disclosure-levels
  - **Acceptance**:
    - Outcome: An empty persisted set keeps everything expanded rather than reseeding defaults.
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeView.ts` — collapse seeding, `pruneStaleState`, persistence callbacks.
    2. `src/webview/main.ts` — the getters that must preserve `undefined`.

- [x] 3_3 Verify a no-op push performs no DOM work
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#a-push-that-changed-nothing-changes-no-pixels
  - **Acceptance**:
    - Outcome: A spinner-frame-only push leaves scroll, focus, and expansion untouched.
    - Verify: unit src/webview/worktree/worktreeRenderSignature.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreeRenderSignature.ts` — every display-driving field in the key.
    2. `src/webview/worktree/WorktreeView.ts` — the action-result half of the key.

## 4. Action surfaces

- [x] 4_1 Verify each menu omits rather than disables what the row cannot do
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#a-row-is-never-offered-an-action-it-cannot-perform
  - **Acceptance**:
    - Outcome: An unavailable action is absent from the menu, never present and disabled.
    - Verify: unit src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeContextMenu.ts` — both item sets and their omissions.

- [x] 4_2 Verify the remove confirmation names the risk and the refusal offers no confirm
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#a-destructive-confirmation-names-the-whole-risk
  - **Acceptance**:
    - Outcome: A refused removal renders no confirm control.
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts` — refusal test, blocker list, force warning.
    2. `src/webview/worktree/worktreeDialogShell.ts` — the shell both dialogs share.

- [x] 4_3 Verify the create form's posture default and its destination copy
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#{a-dangerous-posture-is-offered-but-never-preselected, a-destination-is-named-only-once-it-is-known}
  - **Acceptance**:
    - Outcome: The dangerous posture is offered unselected and no unresolved destination is claimed.
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — posture list, collision copy, agent rebuild.
    2. `src/webview/worktree/worktreeViewTypes.ts` — the resolved-path field the copy depends on.

## 5. Design gate

- [x] 5_1 Obtain user sign-off on the rendered shell against the approved mockup
  - **Deps**: 1_1, 1_2, 2_1, 2_2, 2_3, 3_1, 3_2, 3_3, 4_1, 4_2, 4_3
  - **Refs**: docs/PLAN.md#wt-0021-fourth-segment--static-tree-shell
  - **Acceptance**:
    - Outcome: The user accepts the rendered shell as the settled visual language.
    - Verify: manual open the Worktree segment in the Extension Development Host, compare against docs/ui/worktree.html at sidebar width, and record the user's decision
