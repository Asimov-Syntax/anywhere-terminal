# Tasks: land-one-wire-contract-for-create-and-removal

## 1. The contract

- [x] 1_1 Declare the create, offer and removal shapes on the wire — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D6
  - **Acceptance**:
    - Outcome: The five-member mode union, the offer, and the check model are declared and compile
    - Verify: command pnpm run check-types
  - **Plan**:
    1. In `src/types/messages.ts`, add `WorktreeCreateMode`, `DestinationDisposition`, `DebrisAuthorization`, `WorktreeAfterCreate`, `ProvisionSelection`, `RemovalCheckOutcome`, `RemovalCheckClass`, `RemovalCheck`, `BranchDeleteOffer` and `BranchDeleteRequest` exactly as `docs/design/worktree-rpc.md` §§ 2.3–2.6 declares them, copying the doc comments that state each shape's reason.
    2. In the same file, leave `WorktreeCreateRequestMessage` and `WorktreeRemoveBlockerPayload` untouched — 1_2 and 1_4 replace them, and changing them here would break the tree before either has a migration.
    3. Add no entry to `WORKTREE_MESSAGE_TYPES`: no new message type exists, only new shapes on existing ones.
  - **Boundary**: no change to any existing exported type in this task

- [ ] 1_2 Carry the branch mode and destination disposition from the dialog to git
  - **Deps**: 1_1
  - **Refs**: design.md D1, design.md D2
  - **Acceptance**:
    - Outcome: A create request states its mode as a union, unflattened at every boundary
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. In `src/types/messages.ts`, replace `WorktreeCreateRequestBase`'s `branch?` / `baseRef?` / `detach?` with `mode: WorktreeCreateMode` and `disposition: DestinationDisposition`, and replace the `openAfter`/`launch` intersection with `afterCreate: WorktreeAfterCreate`.
    2. In `src/webview/worktree/WorktreeController.ts`, build the mode from the draft per design.md D2 and post it; the guard that drops an agent mode with no agent id becomes the guard that cannot build the `agent` variant.
    3. In `src/webview/worktree/WorktreeCreateDialog.ts`, derive the path slug from the mode rather than from `detached ? draft.baseRef : draft.branchName`.
    4. In `src/providers/WorktreeHost.ts`, change `createWorktree`'s request type to carry `mode`, `disposition` and `afterCreate`, and delete the hand-written `modes.includes(...)` and `(openAfter === "agent") !== (launch !== undefined)` checks — the union is what refuses those now.
    5. In `src/worktree/worktreeMutationService.ts` and `src/worktree/worktreeMutations.ts`, read the mode where `branch` / `baseRef` / `detach` were read, assembling the same argv for `fresh` and `fresh-detached`.
    6. Update `src/webview/worktree/worktreeFixtures.ts` and the suites named in Plan paths to the new shape, changing inputs only and never an assertion about behaviour.

- [ ] 1_3 Make the destination rule depend on what the mode needs
  - **Deps**: 1_2
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: A recovery mode accepts an existing directory that a fresh create still refuses
    - Verify: unit src/worktree/createPath.test.ts
  - **Plan**:
    1. In `src/worktree/createPath.ts`, add `CreatePathIntent` per design.md D3 and take it as a parameter of `validateCreatePath`, applying the existence and emptiness rule the intent names instead of the current unconditional one.
    2. In the same file, add `intentFor(mode, disposition)` returning the intent, and export it — this is the only place mode and disposition are mapped to a path rule.
    3. Import `isPathInside` from `src/utils/pathBoundary.ts` for any containment question; write no second containment implementation.
    4. In `src/worktree/worktreeMutationService.ts`, call `intentFor` at the create site and pass the result to both `validateCreatePath` calls, so the pre-spawn re-check applies the same rule as the first.
  - **Boundary**: no containment implementation anywhere in `src/` but `src/utils/pathBoundary.ts` — `rg -n 'function isPathInside' src/` must find that file and no other

- [ ] 1_4 Report a removal as classed checks, and retire the boolean record
  - **Deps**: 1_3
  - **Refs**: design.md D4, design.md D5
  - **Acceptance**:
    - Outcome: A blocked removal travels as classed checks and the panel renders the same lines
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. Add `src/worktree/removalChecks.ts` exporting `checksFor(assessment: RemovalAssessment): readonly RemovalCheck[]`, implementing design.md D4's table and nothing beyond it.
    2. In `src/types/messages.ts`, replace `WorktreeRemoveBlockerPayload` and the `blocked` member's `blocker` field with `checks: readonly RemovalCheck[]`, and delete the interface.
    3. In `src/worktree/worktreeMutationService.ts`, call `checksFor` where the boolean record was assembled.
    4. In `src/webview/worktree/WorktreeRemoveDialog.ts`, make `isRemoveRefused` read `cls === "refusal"` with a failing outcome, and make `buildBlockerList` and `buildForceWarning` read the check list; every rendered string stays byte-identical.
    5. In `src/webview/worktree/worktreeViewTypes.ts` and `src/webview/worktree/worktreeFixtures.ts`, follow the type through; leave `src/worktree/worktreeBlockers.ts` and `src/worktree/worktreeFingerprint.ts` unchanged.
  - **Boundary**: no new check id beyond design.md D4's table

- [ ] 1_5 Prove the shapes that must not compile do not compile
  - **Deps**: 1_4
  - **Refs**: design.md D6
  - **Acceptance**:
    - Outcome: Every unrepresentable request shape fails the type check
    - Verify: command pnpm run check-types
  - **Plan**:
    1. Add `src/types/messages.contract.test.ts` asserting with `@ts-expect-error`, one case per line with a comment naming the rule: a `reuse` carrying `baseRef`, a `reattach` carrying `baseRef`, an `adopt` carrying `baseRef`, a `fresh-detached` carrying `branch`, a non-`agent` `WorktreeAfterCreate` carrying `agentId` or `waitForSetup`, and a `ProvisionSelection` carrying a command or a path field.
    2. In the same file, assert positively that each of the five modes and the `agent` after-create variant construct without error, so a union accidentally widened to `any` fails rather than passes.
    3. Add one runtime `expect` so the file is a valid Vitest suite; the type assertions are what `pnpm run check-types` judges.
