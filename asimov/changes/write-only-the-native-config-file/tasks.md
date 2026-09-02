## 1. What the model must say before anything can be written

- [ ] 1_1 Publish which of a provider's files are actually present
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-configuration-written-for-the-first-time-names-a-source-that-exists <!-- design.md D11 -->
  - **Acceptance**:
    - Outcome: every published provider names the subset of its files that exists
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. Add `present: readonly string[]` to `ProvisionProvider` in `src/types/messages.ts`, documented as the subset of `files` that exists, in read order, non-empty.
    2. In `src/worktree/provisioning/readProvisioning.ts`, fill `present` for both the chosen and the detected-inactive provider by keeping the per-file result `anyFilePresent` already computes rather than reducing it to a boolean.
    3. Add a case to `src/worktree/provisioning/readProvisioning.test.ts` for a repository carrying only `.worktreeinclude`, asserting `present` holds that file alone while `files` still holds both.

## 2. The write

- [ ] 1_2 Write the repository's own configuration, and nothing else
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{no-configuration-file-another-tool-defined-is-ever-written, a-configuration-that-cannot-be-edited-safely-is-refused-rather-than-rewritten, an-existing-configuration-keeps-the-formatting-and-comments-it-had} <!-- design.md D2, D3, D4, D5, D7, D9, D10 -->
  - **Acceptance**:
    - Outcome: a save records the divergence in `.vscode/worktree.json` and opens no other path for writing
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. Add `src/worktree/provisioning/writeNativeConfig.ts` exporting `NativeConfigDivergence`, `NativeConfigWrite`, `NativeConfigDeps` and `writeNativeConfig` per design.md § Interfaces.
    2. Resolve `<root>/.vscode` once, refuse with `outside` unless `isResolvedPathInside` from `src/utils/resolvedPathBoundary.ts` accepts it against the resolved root, and name that resolved directory in every operation that follows; `lstat` the target and refuse `outside` when it is a symlink.
    3. Run the whole transaction inside one `LockedFile.withLock` from `src/agentHooks/install/lockedJsonFile.ts`: `readText`, then the edit, then the commit.
    4. Build the new text with `modify` + `applyEdits` from `jsonc-parser` for `exclude`, `extends`, `copy` and `link` only, taking `FormattingOptions` from the file's first indented line and dominant line ending; refuse with `malformed` when `parseTree` reports errors or when a key this writer touches is present with the wrong shape.
    5. Skip an exclusion already present, a path already absent from `copy`/`link`, and an `extends` already naming the chosen file; commit nothing when nothing remains.
    6. Commit through `LockedFile`: `atomicReplace(text, modeOfExistingFile)` for an existing file, `stageReplacement(...).commit("create")` with `discard()` in a `finally` for a first write; map an unacquirable lock to `unavailable` and a commit that did not land to `unwritable`.
    7. Add `"writeNativeConfig.ts"` to `NOT_READ_PATH` in `src/worktree/provisioning/readOnly.test.ts`.
    8. Write `src/worktree/provisioning/writeNativeConfig.test.ts` covering every ledger row in design.md § Obligation ledger, including the arming step each row names.

- [ ] 1_3 Derive the divergence from the offer the host holds
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-choice-the-repository-s-own-configuration-can-express-is-recorded-there, choosing-a-different-source-changes-only-which-source-is-named} <!-- design.md D1, D6, D11 -->
  - **Acceptance**:
    - Outcome: an unticked entry diverges to the key its own declaring file owns
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/writeNativeConfig.ts`, export a pure `divergenceOf(model, kept, source)` mapping each unticked `model.entries` member to `exclude` when its `source` is not `.vscode/worktree.json` and to `drop` when it is.
    2. Set `extends` to `present[0]` of the named provider when `source` names a detected provider that is not the active one, and leave it unset otherwise.
    3. Take ports, setup steps and `model.excluded` no further; design.md D6 states the reason for each.

## 3. Carrying the choice

- [ ] 1_4 Carry a save request from the host wire to the write
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#{a-choice-the-repository-s-own-configuration-can-express-is-recorded-there, a-save-answers-for-the-form-that-is-still-open} <!-- design.md D1, D8, D9 -->
  - **Acceptance**:
    - Outcome: a stale offer id writes nothing
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Add `WorktreeProvisionSaveMessage` to `src/types/messages.ts` carrying `repoId`, `offerId`, `opening`, `switch` and the kept ids, with no path or text field, and register its type name beside `worktreeProvisionSwitch`.
    2. Add a `writeNativeConfig` option to the host options in `src/providers/WorktreeHost.ts` and wire it in `src/extension.ts` the way `readProvisioning` is wired.
    3. Handle the message in `src/providers/WorktreeHost.ts`: take `repo.mainPath` from `cache.read().repos`, resolve the model with `offers.lookup`, and return without writing when either is undefined.
    4. Enter the same latest-wins gate `worktreeProvisionSwitch` uses before the write starts, and re-check both it and the live opening before publishing.
    5. On success re-read with `readProvisioning` and publish a fresh offer; on a failure reason from design.md D9, publish it as a problem and leave Create enabled.
    6. Extend `src/providers/WorktreeHost.actions.test.ts` with the stale-offer case and both save-versus-switch interleavings.

- [ ] 1_5 Offer the save in the create dialog and post it
  - **Deps**: 1_4
  - **Refs**: specs/worktree-panel/spec.md#{a-choice-the-repository-s-own-configuration-can-express-is-recorded-there, a-choice-that-configuration-cannot-express-is-stated-not-silently-dropped} <!-- design.md D1, D6 -->
  - **Acceptance**:
    - Outcome: pressing Configure posts the kept ids and states what the save will not keep
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Add an `onProvisionSave` dep to the dialog deps in `src/webview/worktree/WorktreeCreateDialog.ts`, shaped like `onProvisionSwitch`: ids and the offer id, never a path.
    2. Render a `[Configure…]` control in the provisioning section that calls it with the currently ticked ids, and leave the control out when the section has no offer.
    3. Beside the control, state that ticked setup steps and port choices apply to this create only, per design.md D6.
    4. Supply `onProvisionSave` in `createDialogDeps` in `src/webview/worktree/WorktreeController.ts`, converting it into the opening-bound wire message the way `onProvisionSwitch` is converted.
    5. Extend `src/webview/worktree/WorktreeCreateDialog.test.ts` and the controller's own test so the posted message is asserted, not only the injected callback.
