# Tasks: materialize-declared-files-into-a-new-worktree

Fully serial. 1_3 and 1_4 share `applyEntries.ts`; 1_5 needs every layer beneath it.

- [ ] 1_1 Mint the per-step result contract the wire has documented but never defined
  - **Deps**: none
  - **Refs**: design.md D8
  - **Acceptance**:
    - Outcome: A provisioning selection and a per-step result can both be expressed on the wire
    - Verify: unit src/types/messages.contract.test.ts
  - **Plan**:
    1. `src/types/messages.ts`: add `ProvisionStepOutcome`, `ProvisionStepResult` and `WorktreeProvisionResultMessage` exactly as D8 declares them, and register the new message in the extension→webview union and its type-name list.
    2. `src/types/messages.ts`: `WorktreeCreateRequestMessage` gains `provision?: ProvisionSelection`. Optional, because a create carrying none is every create made before this feature existed.
    3. `src/types/messages.contract.test.ts`: the new message round-trips and appears in the union; `ProvisionSelection` still carries no field capable of naming a path or command text.
  - **Boundary**: no behavior — this task adds types and registrations only, and nothing reads them yet

- [ ] 1_2 Refuse an entry before anything opens a file descriptor for it
  - **Deps**: 1_1
  - **Refs**: design.md D4, D7; specs/worktree-panel/spec.md#{an-entry-that-would-write-outside-the-new-worktree-is-refused-not-adjusted, some-material-is-refused-however-a-repository-asks-for-it}
  - **Acceptance**:
    - Outcome: A refused entry yields its reason and touches no file
    - Verify: unit src/worktree/provisioning/entryGate.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/entryGate.ts`: given an entry, the main-checkout root and the new worktree root, answer either the two resolved absolute paths or a refusal reason. Containment comes from `isResolvedPathInside` (`src/utils/resolvedPathBoundary.ts`) against the two roots SEPARATELY. This module defines no containment predicate.
    2. `src/worktree/provisioning/entryGate.ts`: the material-class refusals, checked before mode is consulted so copy and link cannot diverge — lockfiles either way, `node_modules` as a link.
    3. `src/worktree/provisioning/entryGate.test.ts`: `../`, absolute, and symlinked-component escapes each refused for source and for destination; a source resolving into the new worktree refused; lockfile refused as copy and as link; `node_modules` refused as link; and a refusal performs no write through the injected deps.
  - **Boundary**: refuse, never adjust — no code path may return a path it modified to bring it inside a root

- [ ] 1_3 Copy an entry without following, replacing, or dereferencing anything
  - **Deps**: 1_2
  - **Refs**: design.md D5, D6, D9; specs/worktree-panel/spec.md#materializing-never-replaces-anything-that-is-already-there
  - **Acceptance**:
    - Outcome: A directory copy replaces nothing that already existed, at any depth
    - Verify: unit src/worktree/provisioning/applyEntries.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts`: the recursive copy, dispatching on `lstat` — file, directory, symlink, or refuse. Mode bits preserved, ownership never.
    2. `src/worktree/provisioning/applyEntries.ts`: creation through the exclusive primitives only (`COPYFILE_EXCL`, non-recursive `mkdir`, `symlink`), with `EEXIST` recorded as a skip and the walk continuing to siblings.
    3. `src/worktree/provisioning/applyEntries.test.ts`: an existing top-level destination is skipped; a directory copy into an existing directory holding one of the same filenames skips exactly that file and copies its siblings; an in-repo symlink arrives as a symlink; an out-of-repo symlink is refused; a symlink loop terminates; a special file is refused; a walk failing partway reports `failed` and leaves what it had already written.
  - **Boundary**: no deletion primitive may appear in this module — a partial copy is reported, never unwound (D9), and the I10 gate scans this path

- [ ] 1_4 Link to the main checkout, or say the platform would not let you
  - **Deps**: 1_3
  - **Refs**: design.md D7; specs/worktree-panel/spec.md#a-link-the-platform-cannot-make-becomes-a-copy-that-says-so
  - **Acceptance**:
    - Outcome: A link the platform refuses arrives as a copy that says so
    - Verify: unit src/worktree/provisioning/applyEntries.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts`: a link entry becomes a relative symlink from the worktree to the main checkout.
    2. `src/worktree/provisioning/applyEntries.ts`: `EPERM`/`ENOSYS`/`UNKNOWN` from `symlink` falls back to the copy path from 1_3 and reports `degradedToCopy`; every other error reports `failed`.
    3. `src/worktree/provisioning/applyEntries.test.ts`: the symlink is relative and points at the main checkout; a platform refusing symlinks yields copied content and a `degradedToCopy` step; an unrelated symlink error yields `failed` and is not silently degraded.
  - **Boundary**: degradation is per entry and reported — no code path may report `linked` for an entry it copied

- [ ] 1_5 Provision the worktree the create just made, and report what happened
  - **Deps**: 1_4
  - **Refs**: design.md D1, D2, D3; specs/worktree-panel/spec.md#{the-material-a-worktree-was-promised-is-actually-put-there, provisioning-never-costs-the-user-the-worktree}
  - **Acceptance**:
    - Outcome: A create materializes the selected entries and reports one step each
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: resolve `provision` against the surface-scoped offer store, filter the stored model's entries to the selected ids, and pass resolved entries on the create request. An offer the store no longer holds refuses the create with a stated reason (D3); an absent `provision` provisions nothing.
    2. `src/worktree/worktreeMutationService.ts`: call the apply step between `addToGitExclude` and `afterCreate`, and carry its per-entry results out on the create outcome. It never changes whether the create succeeded.
    3. `src/providers/WorktreeHost.ts`: post `worktreeProvisionResult` to the originating surface after the create's own result.
    4. `src/providers/WorktreeHost.actions.test.ts` and `src/worktree/worktreeMutationService.test.ts`: selected entries only; ordering copy-before-link; apply runs before `afterCreate`; an entry failure leaves the create `ok` with earlier entries present; a stale offer id creates nothing; a create with no `provision` field still succeeds and provisions nothing.
  - **Boundary**: the service receives entry values, never ids and never a store handle — it must not become able to resolve an offer
