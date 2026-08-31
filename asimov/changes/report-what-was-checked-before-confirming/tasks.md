# Tasks: report-what-was-checked-before-confirming

## 1. Ask without acting

- [ ] 1_1 Put the assess round trip on the wire
  - **Deps**: none
  - **Refs**: design.md D1; design.md#interfaces
  - **Acceptance**:
    - Outcome: The two assess messages exist and every caller names their fields
    - Verify: command pnpm run check-types
  - **Plan**:
    1. `src/types/messages.ts`: add `WorktreeRemoveAssessRequestMessage` and `WorktreeRemoveAssessmentMessage` from the Interfaces block, and register the request in `WORKTREE_MESSAGE_TYPES` — it travels webview → extension.
    2. Same file: the assessment reuses the existing `RemovalCheck` and the contained-worktree wire shape already carried by `WorktreeRemoveAssessmentPayload`; do not define a second copy of either.
  - **Boundary**: types only — no handler, no render, nothing changes behaviour here

- [ ] 1_2 The host answers an assessment and removes nothing
  - **Deps**: 1_1
  - **Refs**: design.md D1, D4; specs/worktree-panel/spec.md#a-removal-is-reported-before-anything-is-deleted
  - **Acceptance**:
    - Outcome: An assess request answers with the checks and deletes nothing
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: handle `worktreeRemoveAssess` by calling the existing `assessRemoval` binding and posting `worktreeRemoveAssessment` to the asking surface. A target that will not resolve posts nothing.
    2. Same file: issue the fingerprint only where the blocked path already would — an assessment whose every `confirmable` check passed, and a refusal, carry none.
    3. `src/providers/WorktreeHost.actions.test.ts`: the removal capability is never invoked for an assess; a failed-confirmable assessment carries a fingerprint and an all-passed one carries none; an unresolvable target posts nothing.
  - **Boundary**: `assessRemoval` and `evaluateRemoval` are called, never reimplemented, and no check is added, removed or reclassified

## 2. The report says what was checked

- [ ] 2_1 Render every check with its outcome
  - **Deps**: 1_1
  - **Refs**: design.md D2; specs/worktree-panel/spec.md#the-report-shows-every-check-not-only-the-failing-ones
  - **Acceptance**:
    - Outcome: Passed and not-applicable checks appear in the report with their outcome
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: drive the report from the `checks` list instead of the five hand-picked conditions. A check with no copy renders from its `id` and `outcome` rather than being dropped.
    2. `src/webview/worktree/worktreePanel.css`: check-row styles beside the existing `.wt-blockers` / `.wt-warnbox` / `.wt-refusebox` block, in the panel's own `.wt-` idiom.
    3. `src/webview/worktree/WorktreeRemoveDialog.test.ts`: a passed check renders as passed; a `notApplicable` check renders as neither passed nor failed; an unrecognized id still renders a row; the panes-keep-running sentence is present.
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and must not be edited

- [ ] 2_2 A typed confirmation, only where it was earned
  - **Deps**: 2_1
  - **Refs**: design.md D3, D5; specs/worktree-panel/spec.md#a-typed-confirmation-is-required-only-where-one-was-earned; specs/worktree-panel/spec.md#the-panel-takes-a-check-s-class-from-the-assessment
  - **Acceptance**:
    - Outcome: Only an unpassed confirmable check makes the name have to be retyped
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: compute both predicates from `cls` and `outcome` per D3, `refused` first. The confirm control stays inert until the trimmed input matches the displayed name.
    2. `src/webview/worktree/worktreePanel.css`: styles for the input and its inert confirm.
    3. `src/webview/worktree/WorktreeRemoveDialog.test.ts`: an all-passed assessment needs no typing; a failed confirmable check does; an unproven-proof-only assessment does not; a refusal has no confirm element in the DOM at all; typing the name does not unlock a proof-gated option.
  - **Boundary**: the panel decides nothing about class — `cls` is read off the wire, never inferred from `id`

## 3. The menu asks before it deletes

- [ ] 3_1 Remove Worktree opens the report
  - **Deps**: 1_2, 2_2
  - **Refs**: design.md D1, D4; specs/worktree-panel/spec.md#a-removal-is-reported-before-anything-is-deleted
  - **Acceptance**:
    - Outcome: Choosing Remove Worktree deletes nothing until the report is confirmed
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts`: the `removeWorktree` action posts `worktreeRemoveAssess` rather than an unforced `worktreeRemove`; handle `worktreeRemoveAssessment` by opening the report.
    2. `src/webview/worktree/worktreeMessageHandlers.ts`: route the new inbound message.
    3. `src/webview/worktree/WorktreeController.test.ts`: choosing remove posts an assess and no removal; confirming an all-passed report posts `force: false` with no fingerprint; confirming an earned typed confirmation posts `force: true` with the fingerprint the assessment carried.
  - **Boundary**: the existing blocked-result path stays — a removal blocked at execution time still reports and re-offers, since D4 relies on it

- [ ] 3_2 Prove it through the shipped wiring
  - **Deps**: 3_1
  - **Refs**: design.md D1, D4
  - **Acceptance**:
    - Outcome: The assembled extension reports before removing and removes on confirmation
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts`: walk a clean worktree from the menu action to the report and assert nothing was removed until the confirm, then that the confirm removes it.
    2. Same file: walk a worktree with a failed confirmable check and assert the typed confirmation is what authorizes the forced removal.
  - **Boundary**: no production behaviour is added here — this task proves what tasks 1 to 3_1 built, through the real assembly
