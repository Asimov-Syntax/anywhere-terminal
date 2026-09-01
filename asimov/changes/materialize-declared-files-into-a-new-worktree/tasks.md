# Tasks: materialize-declared-files-into-a-new-worktree

Fully serial. 1_3 and 1_4 share `applyEntries.ts`; 1_5 needs every layer beneath it.

- [ ] 1_1 Mint the per-step result contract the wire has documented but never defined
  - **Deps**: none
  - **Refs**: design.md D8
  - **Acceptance**:
    - Outcome: A selection and a per-step result are both expressible on the wire
    - Verify: command pnpm run check-types
  - **Plan**:
    1. `src/types/messages.ts`: add `ProvisionStepOutcome`, `ProvisionStepResult` (including `details`) and `WorktreeProvisionResultMessage` exactly as D8 declares them, and register the new message in the extension→webview union and its type-name list.
    2. `src/types/messages.ts`: `WorktreeCreateRequestMessage` gains `provision?: ProvisionSelection`. Optional, because a create carrying none is every create made before this feature existed.
    3. `src/types/messages.contract.test.ts`: the new message appears in the union and round-trips. Verify is the type check because that file says outright that `check-types` is the judge and its runtime body is a placeholder — a passing unit run there would not fail on a wrong contract.
  - **Boundary**: no behavior — this task adds types and registrations only, and nothing reads them yet

- [ ] 1_2 Refuse an entry before anything opens a file descriptor for it
  - **Deps**: 1_1
  - **Refs**: design.md D4, D7; specs/worktree-panel/spec.md#{an-entry-that-would-write-outside-the-new-worktree-is-refused-not-adjusted, some-material-is-refused-however-a-repository-asks-for-it}
  - **Acceptance**:
    - Outcome: A refused entry yields the reason its own rule names
    - Verify: unit src/worktree/provisioning/entryGate.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/entryGate.ts`: prepare each root ONCE with `prepareResolvedRoot` and answer through `isResolvedPathInsideRoot` (`src/utils/resolvedPathBoundary.ts`), source against the main checkout and destination against the new worktree, separately. This module defines no containment predicate.
    2. `src/worktree/provisioning/entryGate.ts`: the material-class refusals, checked before mode is consulted so copy and link cannot diverge — lockfiles either way, `node_modules` as a link. A lockfile is `refused`, not `skipped`, per D8.
    3. `src/worktree/provisioning/entryGate.test.ts`: `../`, absolute, and symlinked-component escapes refused for source and for destination; a source resolving into the new worktree refused; lockfile refused as copy and as link; `node_modules` refused as link; each refusal carries the reason its rule names, distinguishable from the others.
  - **Boundary**: refuse, never adjust — no code path may return a path it modified to bring it inside a root

- [ ] 1_3 Walk a directory no-follow, bounded, replacing nothing
  - **Deps**: 1_2
  - **Refs**: design.md D5, D6, D9, D10; specs/worktree-panel/spec.md#materializing-never-replaces-anything-that-is-already-there
  - **Acceptance**:
    - Outcome: A directory copy replaces nothing that already existed, at any depth
    - Verify: unit src/worktree/provisioning/applyEntries.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts`: the recursive walk, dispatching on `lstat`. Files copy fd-to-fd — source opened `O_RDONLY | O_NOFOLLOW` and `fstat`-ed on that fd, destination opened `O_WRONLY | O_CREAT | O_EXCL` — not through `copyFile`, which cannot express no-follow on the source. Mode bits preserved, ownership never.
    2. `src/worktree/provisioning/applyEntries.ts`: directories created by non-recursive `mkdir`; on `EEXIST`, `lstat` the destination and descend only into a real directory — a file or a symlink there stops that subtree and is reported.
    3. `src/worktree/provisioning/applyEntries.ts`: a symlink is recreated only when its target resolves inside the main checkout from the SOURCE directory and inside the worktree from the DESTINATION directory (D6). Links are never traversed.
    4. `src/worktree/provisioning/applyEntries.ts`: the walk budget — node count, byte cap, and a wall-clock deadline from `afterDelay` (`src/worktree/deadline.ts`). Exceeding one stops that entry, reports `failed` naming the budget, and leaves the remaining entries to run.
    5. `src/worktree/provisioning/applyEntries.test.ts`: the falsifiers, each of which must fail against a walk written the obvious way — an existing top-level destination skipped; a directory copy into an existing directory holding one of the same filenames skips that file, copies its siblings, and names it in `details`; a source replaced by a symlink between `lstat` and open fails rather than copying through; a destination parent that is a symlink out of the worktree refused at the descent check; a source directory over a destination file reported for that subtree rather than `ENOTDIR` on its children; a source directory over a destination symlink-to-directory refused rather than followed; the D6 relocation construction (an in-repo relative link that resolves outside once moved) refused; an in-repo link at equal depth recreated as a symlink; a symlink loop terminating; a special file refused; a walk over the node budget and one over the deadline each reporting `failed` with the budget named while later entries still run; a walk failing partway leaving what it had already written.
  - **Boundary**: no deletion primitive may appear in this module — a partial copy is reported, never unwound (D9), and the I10 gate scans this path

- [ ] 1_4 Link to the main checkout, or say the platform would not let you
  - **Deps**: 1_3
  - **Refs**: design.md D7; specs/worktree-panel/spec.md#a-link-the-platform-cannot-make-becomes-a-copy-that-says-so
  - **Acceptance**:
    - Outcome: A link the platform refuses arrives as a copy that says so
    - Verify: unit src/worktree/provisioning/applyEntries.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts`: a link entry becomes a relative symlink from the worktree to the main checkout, its target checked by D6's destination-side rule like any other.
    2. `src/worktree/provisioning/applyEntries.ts`: `EPERM`/`ENOSYS`/`UNKNOWN` from `symlink` falls back to the copy path from 1_3 and reports `degradedToCopy`; every other error reports `failed`.
    3. `src/worktree/provisioning/applyEntries.test.ts`: the symlink is relative and points at the main checkout; a platform refusing symlinks yields copied content and a `degradedToCopy` step; an unrelated symlink error yields `failed` and is not silently degraded.
  - **Boundary**: degradation is per entry and reported — no code path may report `linked` for an entry it copied

- [ ] 1_5 Provision the worktree the create just made, without ever costing it
  - **Deps**: 1_4
  - **Refs**: design.md D1, D2, D3; specs/worktree-panel/spec.md#{the-material-a-worktree-was-promised-is-actually-put-there, provisioning-never-costs-the-user-the-worktree}
  - **Acceptance**:
    - Outcome: A create materializes the selected entries and reports one step each
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: resolve `provision` against the surface-scoped offer store, filter the stored model's entries to the selected ids, and pass resolved entries on the create request. An offer the store no longer holds refuses the create with a stated reason (D3); an absent `provision` provisions nothing.
    2. `src/worktree/worktreeMutationService.ts`: call apply between `addToGitExclude` and `afterCreate`, inside its OWN `.catch()` modelled on `afterCreate`'s at `:905-910`, so no rejection can reach the create body's outer arm at `:920-925` and report a successful git create as an error.
    3. `src/providers/WorktreeHost.ts`: post `worktreeProvisionResult` to the originating surface after the create's own result.
    4. `src/providers/WorktreeHost.actions.test.ts` and `src/worktree/worktreeMutationService.test.ts`: an apply that REJECTS still yields `ok` with a `failed` step — a fake returning a failed result does not exercise the outer arm and is not the witness for this; selected entries only; copy ordered before link; apply runs before `afterCreate`; a stale offer id creates nothing; a create with no `provision` field still succeeds and provisions nothing.
  - **Boundary**: the service receives entry values, never ids and never a store handle — it must not become able to resolve an offer
