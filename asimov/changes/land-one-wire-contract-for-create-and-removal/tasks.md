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

- [x] 1_2 Carry the branch mode the user picked all the way to git — verified: bun test 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-create-says-which-kind-of-branch-it-wants; design.md D1, design.md D2
  - **Acceptance**:
    - Outcome: A new-branch create with no base ref succeeds instead of failing on an invalid reference
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. In `src/types/messages.ts`, replace `WorktreeCreateRequestBase`'s `branch?` / `baseRef?` / `detach?` with `mode: WorktreeCreateMode` and `disposition: DestinationDisposition`, and replace the `openAfter`/`launch` intersection with `afterCreate: WorktreeAfterCreate`.
    2. In `src/webview/worktree/WorktreeController.ts`, build the mode from `draft.branchMode` per design.md D2's table, substituting `"HEAD"` for a blank base ref in the `fresh-detached` case; the guard that drops an agent mode with no agent id becomes the guard that cannot build the `agent` variant.
    3. In `src/webview/worktree/WorktreeCreateDialog.ts`, derive the path slug from the mode rather than from `detached ? draft.baseRef : draft.branchName`.
    4. In `src/providers/WorktreeHost.ts`, change `createWorktree`'s request type to carry `mode`, `disposition` and `afterCreate`, and rewrite the inbound guards against the union — the `modes.includes(...)` allow-list and the launch-pairing check become `isKnownCreateMode` and `isKnownAfterCreate`, which reject an unknown discriminant and a variant missing a field its shape requires. They are not deleted: the message crosses a boundary where the type is erased, and rpc § 4 asks for the check on every inbound message.
    5. In `src/worktree/worktreeMutationService.ts`, rewrite `sourceOf` and `branchOf` as total maps from `WorktreeCreateMode` to `CreateSource` — `fresh` → `newBranch`, `reuse` → `existingBranch`, `fresh-detached` → `detached` — with no inference from which optional fields are present, and no `default` arm that could absorb a mode added later.
    6. In `src/worktree/worktreeMutations.ts`, leave `CreateSource` and the argv assembly as they are; they are git's vocabulary and already correct.
    6b. Change the service's `afterCreate` dependency to take one `WorktreeAfterCreate` instead of `(openAfter, launch?)`, and follow it into its implementation in `src/extension.ts` — splitting the union back into a mode and an optional payload at that call is the flattening the proposal forbids.
    7. In `src/webview/worktree/worktreeViewTypes.ts`, re-export `WorktreeCreateMode`, `DestinationDisposition` and `WorktreeAfterCreate` beside the other message types the webview reads.
    8. Update `src/webview/worktree/worktreeFixtures.ts`, `src/providers/WorktreeHost.actions.test.ts`, `src/webview/worktree/WorktreeController.test.ts` and the suites named in Plan paths to the new shape, changing inputs only and never an assertion about behaviour — except in `src/worktree/worktreeMutationService.test.ts`, which gains the case design.md D2 names: a `fresh` mode with no `baseRef` reaches git as `newBranch`, not `existingBranch`.

- [x] 1_3 Make the destination rule depend on what the mode needs — verified: bun test 'src/worktree/createPath.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 1_4 Report a removal as classed checks, and retire the boolean record — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: design.md D4, design.md D5
  - **Acceptance**:
    - Outcome: A blocked removal travels as classed checks and the panel renders the same lines
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. Add `src/worktree/removalChecks.ts` exporting `checksFor(assessment: RemovalAssessment): readonly RemovalCheck[]`, implementing design.md D4's table and nothing beyond it, with `src/worktree/removalChecks.test.ts` covering all three assessment kinds.
    1b. Add `count?: number` to `RemovalCheck` in `src/types/messages.ts` and to `docs/design/worktree-rpc.md` § 2.5. The panel renders the magnitude inside its own `<b>` element, so a count reaching it only as prose in `detail` cannot be re-rendered byte-identically, and parsing a number back out of a display string is not a contract.
    2. In `src/types/messages.ts`, replace `WorktreeRemoveBlockerPayload` and the `blocked` member's `blocker` field with `checks: readonly RemovalCheck[]`, and delete the interface.
    3. In `src/extension.ts`, replace `toBlockerPayload` with a projection that calls `checksFor` and carries the contained worktrees beside the checks; `src/webview/worktree/WorktreeView.ts` and `src/webview/worktree/WorktreeController.ts` follow the renamed field through.
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
