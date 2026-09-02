## 1. Prove and offer the source work

- [x] 1_1 Build exact counting and the bounded Git API adapter — verified: pnpm exec vitest run 'src/providers/gitDecorationProvider.test.ts' 'src/worktree/migrateChanges.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-move-offer-requires-an-identified-source-worktree, the-move-offer-states-one-complete-distinct-path-count, an-uncertain-migration-report-claims-only-proven-state} <!-- design.md D1, D2, D4, D5 -->
  - **Acceptance**:
    - Outcome: Bounded source snapshots gate migration through exact repositories opened under one deadline
    - Verify: command pnpm exec vitest run 'src/providers/gitDecorationProvider.test.ts' 'src/worktree/migrateChanges.test.ts'
  - **Plan**:
    1. `src/providers/git.ts`: add optional upstream `API.openRepository(Uri)` and `Repository.migrateChanges(sourceRepositoryPath, options)` surfaces with exact return and option shapes.
    2. `src/providers/gitDecorationProvider.ts`: expose the already-activated API read-only; cover unavailable, active and disposed accessor states in `src/providers/gitDecorationProvider.test.ts`.
    3. `src/worktree/migrateChanges.ts`: parse bounded porcelain into record signatures retaining rename and copy origins; refuse unmerged, malformed, overflowed, or failed reads.
    4. `src/worktree/migrateChanges.ts`: complete each affected path with a streamed hash over absence or filesystem kind, mode, symlink target, and file bytes under one 10-second and 512 MiB budget; capture `AuthorizedDirectory` plus no-follow `.git` identity, content, resolved admin target identity, and expose a recheck.
    5. `src/worktree/migrateChanges.ts`: add a source-offer probe that opens the exact source and requires `migrateChanges`, plus the execution adapter that opens both repositories, checks source evidence and snapshot with a clean destination, passes D1's options, and verifies empty source plus an exact non-conflicted destination snapshot.
    6. `src/worktree/migrateChanges.test.ts`: cover record forms and origins, large snapshots, every ineligible read, source directory replacement, `.git` replacement and in-place rewrite, admin-target replacement, null, rejected, and late opens, deadline and byte budgets, snapshot drift, exact options, and the source-destination matrix.

- [x] 1_2 Carry one source row through the opening — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-move-offer-requires-an-identified-source-worktree <!-- design.md D3 -->
  - **Acceptance**:
    - Outcome: Row-context create retains the source worktree identity
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts`: add optional `sourceWorktreeId` to the create opening and defaults request.
    2. `src/webview/worktree/WorktreeController.ts`: retain `WorktreeInfo.id` when a row opens create and send it only for that repository; repository-level and toolbar doors send none.
    3. `src/webview/worktree/WorktreeController.ts`: remove the source when the form switches repository instead of substituting another checkout.
    4. `src/webview/worktree/WorktreeController.test.ts`: cover linked and main row identity, repository and toolbar omission, opening replacement, and repository switching.

- [x] 1_3 Issue and retire the host-bound move offer — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-move-offer-requires-an-identified-source-worktree, the-move-offer-states-one-complete-distinct-path-count} <!-- design.md D3, D4 -->
  - **Acceptance**:
    - Outcome: Only a live source with a complete positive count receives an opaque move offer
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/types/messages.ts`: add a host-to-webview migration offer carrying opening, repository, source id, opaque offer id and count.
    2. `src/providers/WorktreeHost.ts`: resolve the source id from the current tree, prove repository ownership, and asynchronously request the exact source offer probe carrying source identity evidence and snapshot.
    3. `src/providers/WorktreeHost.ts`: mint each offer with cryptographic `randomUUID`, retain source id, evidence, and snapshot behind it, sweep on close, supersede and detach, and drop late results; inject the token source for deterministic tests.
    4. `src/extension.ts`: provide the exact source probe from `src/worktree/migrateChanges.ts`, `GitDecorationProvider`, the shared runner, and `Uri.file`.
    5. `src/providers/WorktreeHost.actions.test.ts`: cover source ownership, empty, unmerged, unavailable, and capability-absent probes, late completion, unguessable delivery, supersession and retirement.

- [x] 1_4 Render the unchecked offer and reset changed consent — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#{the-move-offer-states-one-complete-distinct-path-count, move-consent-applies-to-execution-time-source-work, declining-to-move-performs-no-migration} <!-- design.md D3, D6 -->
  - **Acceptance**:
    - Outcome: The row states its count, starts unchecked, and resets when its offer changes
    - Verify: command pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' 'src/webview/worktree/WorktreeController.test.ts'
  - **Plan**:
    1. `src/webview/worktree/worktreeViewTypes.ts`: carry the active migration offer in each repository seed and the checked offer id in `WorktreeCreateDraft`.
    2. `src/webview/messaging/MessageRouter.ts`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/worktreeMessageHandlers.ts`: route, store and apply only offers matching the live opening, repository and source.
    3. `src/webview/worktree/WorktreeCreateDialog.ts`: render an initially unchecked row saying N is the current snapshot and Git will move execution-time uncommitted work; preserve unrelated redraws, reset replacement offers, and hide it for reattach, adopt, or repository switching.
    4. `src/webview/worktree/WorktreeCreateDialog.test.ts`: cover singular and plural text, default decline, checked draft, redraw preservation, replacement reset, mode exclusion and repository switch.
    5. `src/webview/worktree/WorktreeController.test.ts`: cover offer routing, stale opening rejection, and application to the current form.

- [x] 1_5 Refuse special-file replacement during snapshot reads — verified: pnpm exec vitest run 'src/worktree/migrateChanges.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 1_4
  - **Refs**: design.md D4
  - **Acceptance**:
    - Outcome: Snapshot hashing opens only regular files and returns within its deadline when a path is a writerless FIFO
    - Verify: unit src/worktree/migrateChanges.test.ts
  - **Plan**:
    1. `src/worktree/migrateChanges.ts`, `src/utils/regularFileRead.ts`: expose the opened handle before its type check, use no-follow regular-file opens, bounded handle reads, post-read path identity, and deadline-bounded cleanup.
    2. `src/worktree/migrateChanges.test.ts`: cover real writerless FIFO replacement, outside and same-identity symlinks, exact byte bounds, successful and stalled close, stalled initial fstat, and open-after-timeout cleanup.

## 2. Redeem and execute the move

- [x] 2_1 Redeem only the delivered offer — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 1_5
  - **Refs**: specs/worktree-panel/spec.md#{the-move-offer-states-one-complete-distinct-path-count, declining-to-move-performs-no-migration} <!-- design.md D3, D6 -->
  - **Acceptance**:
    - Outcome: Only the current opaque offer reaches create with host-held source and count
    - Verify: command pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' 'src/webview/worktree/WorktreeController.test.ts'
  - **Plan**:
    1. `src/types/messages.ts`: add optional `migrateChanges: { offerId: string }` to `WorktreeCreateRequestMessage`; no count or source path comes back from the webview.
    2. `src/webview/worktree/WorktreeController.ts`: serialize only the checked current offer id.
    3. `src/providers/WorktreeHost.ts`: validate the inbound shape, redeem against the live opening and new-checkout mode, re-resolve the source row, recheck source identity, `.git` and snapshot, and pass only host-held source path, evidence, and snapshot to create.
    4. `src/providers/WorktreeHost.actions.test.ts`: cover malformed, unknown, cross-opening, cross-source, replaced-directory, rewritten-`.git`, replaced-admin, and stale-snapshot offers plus successful redemption.
    5. `src/webview/worktree/WorktreeController.test.ts`: assert absent and checked wire shapes without source path or count.

- [x] 2_2 Move before later work and stop on indeterminate state — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' 'src/extension.worktreeMutations.test.ts' 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{the-work-moves-between-a-new-checkout-and-every-later-step, migration-uncertainty-does-not-undo-a-successful-create, declining-to-move-performs-no-migration} <!-- design.md D1, D2, D5, D6, D7 -->
  - **Acceptance**:
    - Outcome: Proven migration precedes later work and uncertainty preserves only the successful create
    - Verify: command pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' 'src/extension.worktreeMutations.test.ts' 'src/extension.worktreeAssembly.test.ts'
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts`: add host-held source path, source identity evidence, and snapshot to new-checkout requests plus an optional binding returning `moved` or `indeterminate`.
    2. `src/worktree/worktreeMutationService.ts`: after successful `git worktree add`, perform the existing nested-root exclusion before migration, then continue authorization and later work only for `moved`; return successful create with `migrationIndeterminate` otherwise.
    3. `src/worktree/worktreeMutationService.ts`: normalize the created worktree id when migration alone produced a report; declined creates never call the binding and surviving-directory modes cannot carry it.
    4. `src/worktree/worktreeMutationService.test.ts`: cover nested and outside-root ordering, failed-exclusion snapshot drift, move-only and declined creates, every mode, evidence forwarding, no later work, no rollback, normalized identity, and moved provisioning, ports and launch.
    5. `src/extension.ts`: bind the adapter from `src/worktree/migrateChanges.ts` to the shared runner, Git API, filesystem, source authorization, and `Uri.file`, and map its bounded reasons.
    6. `src/extension.worktreeMutations.test.ts` and `src/extension.worktreeAssembly.test.ts`: prove production supplies the binding, forwards exact source evidence and snapshot, proceeds only after correlated `moved`, and reports indeterminate state after create success.

- [x] 2_3 Carry and render truthful migration uncertainty — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#an-uncertain-migration-report-claims-only-proven-state <!-- design.md D2, D7 -->
  - **Acceptance**:
    - Outcome: The successful create notice warns that migration state is uncertain
    - Verify: command pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' 'src/webview/worktree/WorktreeView.test.ts'
  - **Plan**:
    1. `src/types/messages.ts`: carry optional `migrationIndeterminate` on the successful `WorktreeMutationResultMessage` beside existing post-create outcomes.
    2. `src/extension.ts`: include the field when converting `MutationOutcome` to the wire result.
    3. `src/webview/worktree/worktreeViewTypes.ts` and `src/webview/worktree/WorktreeController.ts`: retain it without disturbing provisioning, ports, launch or branch-delete fields.
    4. `src/webview/worktree/WorktreeView.ts`: include it in the render signature; keep the create title successful, take warning tone, state that later steps did not run, and direct inspection of source, destination and stashes.
    5. `src/webview/worktree/WorktreeController.test.ts` and `src/webview/worktree/WorktreeView.test.ts`: cover transport, render updates, coexisting outcomes, and forbidden restoration or single-location claims.

- [x] 2_4 Conform the migration change to the repository formatter — verified: pnpm exec biome check src/providers/WorktreeHost.ts src/providers/WorktreeHost.actions.test.ts src/worktree/worktreeMutationService.ts src/worktree/worktreeMutationService.test.ts src/webview/worktree/WorktreeView.ts src/webview/worktree/WorktreeView.test.ts && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 2_3
  - **Refs**: design.md D3, D6, D7
  - **Acceptance**:
    - Outcome: Every migration-owned source and test file passes the repository's check-mode formatter
    - Verify: command pnpm exec biome check src/providers/WorktreeHost.ts src/providers/WorktreeHost.actions.test.ts src/worktree/worktreeMutationService.ts src/worktree/worktreeMutationService.test.ts src/webview/worktree/WorktreeView.ts src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`, `src/providers/WorktreeHost.actions.test.ts`: apply only formatter-equivalent line wrapping to migration redemption.
    2. `src/worktree/worktreeMutationService.ts`, `src/worktree/worktreeMutationService.test.ts`: sort the migration type import and apply formatter-equivalent wrapping to migration execution tests.
    3. `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`: apply formatter-equivalent wrapping to the uncertainty notice and witness.

## 3. Close review-discovered identity boundaries

- [x] 3_1 Bracket identity and bound evidence reads — verified: pnpm exec vitest run 'src/worktree/migrateChanges.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 2_4
  - **Refs**: design.md D2, D4, D8 <!-- review round 1 F001, F002, F004, F005 -->
  - **Acceptance**:
    - Outcome: Persistent identity drift is rejected within the snapshot memory bound
    - Verify: command pnpm exec vitest run 'src/worktree/migrateChanges.test.ts'
  - **Plan**:
    1. `src/worktree/migrateChanges.ts`: extend worktree evidence with its resolved common repository and admin back-pointer, export bounded destination capture, bracket snapshots with both observed identities, and recapture source evidence after the API resolves.
    2. `src/worktree/migrateChanges.ts`: reject static or persisting intermediate-component redirection around final-component reads; refuse linked-worktree `.git` content above 1 MiB before allocation and read accepted content into one exact-size buffer.
    3. `src/worktree/migrateChanges.test.ts`: cover offer-time snapshot bracketing, repository and back-pointer mismatches, persistent destination replacement surrounding the call, bracketed post-call source `.git` substitution, static and persistent intermediate-directory symlinks, over-cap refusal, peak allocation, and a 132 KiB UTF-8 gitdir path.

- [x] 3_2 Capture destination and exclude the selected source — verified: pnpm exec vitest run 'src/worktree/createPath.test.ts' 'src/worktree/worktreeMutationService.test.ts' 'src/extension.worktreeMutations.test.ts' 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D6, D8; specs/worktree-panel/spec.md#{the-work-moves-between-a-new-checkout-and-every-later-step, migration-uncertainty-does-not-undo-a-successful-create} <!-- review round 1 F001, F003 -->
  - **Acceptance**:
    - Outcome: The observed destination reaches migration only after narrow selected-source exclusion
    - Verify: command pnpm exec vitest run 'src/worktree/createPath.test.ts' 'src/worktree/worktreeMutationService.test.ts' 'src/extension.worktreeMutations.test.ts' 'src/extension.worktreeAssembly.test.ts'
  - **Plan**:
    1. `src/worktree/createPath.ts`, `src/worktree/createPath.test.ts`: admit a destination nested only in the migration-selected source worktree while retaining every other worktree-overlap refusal.
    2. `src/worktree/worktreeMutationService.ts`: immediately capture the observed destination after create, carry it into migration, require narrow source-relative exclusion, preserve separate nonfatal main-checkout hygiene, deduplicate identical rules, and stop with successful uncertainty on a failed migration proof.
    3. `src/extension.ts`: bind destination capture and both exclusion subjects to the shared runner, repository id, filesystem authorization, and migration adapter.
    4. `src/worktree/worktreeMutationService.test.ts`, `src/extension.worktreeMutations.test.ts`, `src/extension.worktreeAssembly.test.ts`: cover destination evidence forwarding, linked-source nesting outside main with sibling movable work, narrow independent exclusions without duplicate writes, nonfatal main-hygiene failure, migration-exclusion failure, capture failure, indeterminate short-circuit, and production bindings.

**Waves**: `1_1 | 1_2 | 1_3 | 1_4 | 2_1 | 2_2 | 2_3 | 2_4 | 3_1 | 3_2`
