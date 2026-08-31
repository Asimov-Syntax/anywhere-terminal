## 1. Clearing debris

- [x] 1_1 Classify a destination as debris by reading for `.git` — verified: pnpm exec vitest run 'src/worktree/debrisClassification.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-destination-holding-debris-is-offered-as-recover-not-silently-avoided; design.md D1
  - **Acceptance**:
    - Outcome: An unregistered directory holding a `.git` file is not reported as debris; one holding no `.git` is
    - Verify: unit src/worktree/debrisClassification.test.ts
  - **Plan**:
    1. `src/worktree/debrisClassification.ts`: new module exporting a classifier that takes a resolved path plus a registration answer and returns the destination disposition, reading for a `.git` entry with `lstat` — never resolving it — and treating an unreadable directory as not debris.
    2. `src/providers/WorktreeHost.ts`: replace `dispositionOf(isRegistered)` with a call to the classifier, keeping the existing bound that it runs only for a candidate the suffixing already skipped.
    3. `src/worktree/debrisClassification.test.ts`: cover a `.git` file, a `.git` directory, no `.git`, a registered path, and a directory whose read fails.
    4. `src/providers/WorktreeHost.actions.test.ts`: the probe answer reaches the reported disposition, so reverting the host to the registration proxy fails.
  - **Boundary**: no change to `suggestFreePath` or to which candidate is probed — the classification of the candidate is the defect, not its selection

- [x] 1_2 Issue and redeem an authorization bound to what was found — verified: pnpm exec vitest run 'src/worktree/debrisAuthorization.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#clearing-debris-happens-only-under-an-authorization-bound-to-what-was-found; design.md D2
  - **Acceptance**:
    - Outcome: A redemption whose directory holds an entry absent at issuance returns a re-prompt
    - Verify: unit src/worktree/debrisAuthorization.test.ts
  - **Plan**:
    1. `src/worktree/debrisAuthorization.ts`: a store in the shape of `worktreeFingerprint.ts` — issue / redeem / forget, spend-on-sight, one record per resolved path, TTL eviction — carrying the directory's entry names and its identity, importing `FINGERPRINT_TTL_MS` rather than redeclaring it.
    2. Same file: redemption compares the current entry set as a subset of the approved one, and compares the recorded identity exactly.
    3. `src/worktree/debrisAuthorization.test.ts`: an appeared entry re-prompts, a disappeared entry proceeds, a changed identity re-prompts, a replayed token re-prompts, an expired record re-prompts.
  - **Boundary**: `src/worktree/worktreeFingerprint.ts` is not modified — D2 records why removal's store is not generalized

- [x] 1_3 Remove the debris directory under the bounds, and report a partial removal — verified: pnpm exec vitest run 'src/worktree/clearDebris.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#a-create-never-reports-success-for-a-clearance-that-did-not-complete; design.md D3, D5; docs/design/worktree-create.md#22-recover-deletes-and-says-so
  - **Acceptance**:
    - Outcome: A clearance that leaves entries behind reports what remains and the create is not reported successful
    - Verify: unit src/worktree/clearDebris.test.ts
  - **Plan**:
    1. `src/worktree/clearDebris.ts`: re-stat the resolved path and compare its identity against the authorization immediately before removing, with no `await` between the comparison and the removal; refuse where a `.git` is present, where the identity differs, or where the directory is gone.
    2. Same file: after removal, `readdir` and report the remaining entries as a failure rather than reporting what was removed.
    3. `src/worktree/clearDebris.test.ts`: cover the identity change, the appeared `.git`, the vanished directory, a clean removal, and a removal that leaves entries.
  - **Boundary**: containment is `isPathInside` / `isResolvedPathInside` from `src/utils/pathBoundary.ts` — this module defines no containment predicate of its own

- [ ] 1_4 Declare the delete site to the I10 gate
  - **Deps**: 1_3
  - **Refs**: design.md D4; docs/design/worktree-actions.md#31-shared-rules
  - **Acceptance**:
    - Outcome: `pnpm run gate:fs-deletion` exits 0 with the delete present, and fails if a second module in scope deletes
    - Verify: command pnpm run gate:fs-deletion
  - **Plan**:
    1. `src/test/invariants/fsDeletionGate.ts`: add a stated single-entry allowlist naming the clearance module, asserted to be exactly that set in the manner of `EXPECTED_GAPS`, so an unexpected allowlisted file fails rather than inflating a count.
  - **Boundary**: `isRemovalPath`'s scope is not narrowed — the gate keeps covering `src/worktree/**` and `src/providers/WorktreeHost.ts`

- [ ] 1_5 Run the clearance inside the create, before git and after the rechecks
  - **Deps**: 1_4
  - **Refs**: specs/worktree-panel/spec.md#a-create-never-reports-success-for-a-clearance-that-did-not-complete; design.md D3, D5
  - **Acceptance**:
    - Outcome: A create against a free destination removes nothing, and one against debris clears before `git worktree add`
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts`: in the create body, where the intent is `mustMatchDebrisAuthorization`, redeem the authorization and run the clearance after the existing phase-2 rechecks and before `createWorktree`; a refused redemption or a failed clearance returns a failure and never reaches git.
    2. Same file: wire the authorization store through `MutationServiceDeps` beside `fingerprints`.
    3. `src/worktree/worktreeMutationService.test.ts`: a free-destination create performs no removal; a debris create clears then creates; a refused redemption creates nothing.
  - **Boundary**: the two-phase validation is not restructured — the clearance is inserted into it, and `git worktree remove` remains the only path that deletes a registered worktree

- [ ] 1_6 Offer recover in the create dialog
  - **Deps**: 1_5
  - **Refs**: specs/worktree-panel/spec.md#a-destination-holding-debris-is-offered-as-recover-not-silently-avoided; docs/design/worktree-create.md#20-branch-mode-and-destination-disposition-are-two-questions
  - **Acceptance**:
    - Outcome: A probe reporting debris offers recover, naming the path, and submits a `debris` disposition carrying the authorization
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts`: render the recover offer for a reported debris destination, stating the directory and what will be removed.
    2. `src/webview/worktree/WorktreeController.ts`: replace the hardcoded `disposition: { kind: "free" }` at the submit site with the draft's disposition, carrying the authorization where recover was accepted.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts`: the offer appears only for debris, composes with an existing-branch selection, and an unaccepted offer submits `free`.
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and are not edited
