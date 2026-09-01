# Tasks: carry-a-contest-membership-once

Every refused member of a contest carries a reason naming every member, so `N` members cost `O(N·T)`
of result text over a wire whose input is capped at `T`. The membership travels once instead.

- [x] 1_1 Carry a contest's membership once on the result message — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: src/types/messages.ts, asimov/changes/award-a-contested-destination-or-refuse-it/.reviews/round-3.md#f008
  - **Acceptance**:
    - Outcome: The result message carries each contest's membership once, and a step references it
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/types/messages.ts` gains a contest shape on `WorktreeProvisionResultMessage` and a reference on `ProvisionStepResult`.
    2. `src/worktree/provisioning/applyProvisioning.ts` returns the contests beside the steps and stops repeating membership in every reason.
    3. `src/worktree/provisioning/applyProvisioning.test.ts` asserts the membership appears once per contest and that each refused step points at it.
    4. `src/extension.ts` passes the contests through with the steps it already forwards.

- [x] 1_2 Render the membership from the contest, not from the reason — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: src/webview/worktree/WorktreeView.ts
  - **Acceptance**:
    - Outcome: A refused contested row still shows every member by path and declaring file
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` and `src/webview/worktree/worktreeViewTypes.ts` carry the contests from the message to the view state.
    2. `src/webview/worktree/WorktreeView.ts` composes each refused row's notice from its contest's membership plus its own reason.
    3. `src/webview/worktree/WorktreeView.test.ts` witnesses the rendered text for a three-member contest.

- [ ] 1_3 Bound what one contest can put on the wire
  - **Deps**: 1_2
  - **Refs**: asimov/changes/award-a-contested-destination-or-refuse-it/.reviews/round-3.md#f008
  - **Acceptance**:
    - Outcome: Result text stays linear in the declarations the model already caps
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyProvisioning.test.ts` witnesses that a large contest's total result text is linear in its membership rather than quadratic.
