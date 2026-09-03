## 1. Ask the host for a folder

- [ ] 1_1 Carry the request and its answer on the wire
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-destination-can-be-chosen-with-the-system-folder-picker}; design.md D2, D3
  - **Boundary**: No new destination field on the create request, and no reply for a cancelled or failed dialog
  - **Acceptance**:
    - Outcome: The host opens the system folder picker on request and answers only the form that asked
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.test.ts src/types/messages.contract.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the request naming repository and opening, and the reply echoing the opening beside the chosen path.
    2. `src/providers/WorktreeHost.ts` — open the picker through the same `showOpenDialog` shape the file tree already uses, and post the reply only on a confirmed choice.
    3. `src/providers/WorktreeHost.test.ts` — witness the dialog options, the echoed opening, and that cancel and failure post nothing.

## 2. Offer it where the destination is stated

- [ ] 2_1 Put the chosen folder into the destination the form already has
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-destination-can-be-chosen-with-the-system-folder-picker}; design.md D1, D2, D3
  - **Boundary**: No change to how a destination is derived, shortened, validated, or displayed, and no persistence of a chosen folder
  - **Acceptance**:
    - Outcome: A chosen folder becomes the override and composes the same create typing it would
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — an action beside the destination that requests the picker, and applies an answer only when it names this opening.
    2. `src/webview/worktree/WorktreeController.ts` — bind the request and route the reply to the open form.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts` — witness that the two ways of naming one destination compose identical creates, that a foreign opening is ignored, and that cancelling changes nothing.
