# Tasks: re-register-a-surviving-checkout

The wire already carries adopt end to end. What is missing is a second detector, an executor, the
form's action, and the guard git cannot supply.

## 1. Recognise it and build it

- [ ] 1_1 Recognise a pruned checkout at an occupied destination as an adopt candidate
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-surviving-checkout-is-offered-as-adopt-not-skipped}; design.md D1, D2, D3
  - **Acceptance**:
    - Outcome: An unregistered directory whose `.git` names a gone administrative directory answers adopt
    - Verify: unit src/worktree/adoptProbe.test.ts
  - **Plan**:
    1. `src/worktree/adoptProbe.ts` exports `probeAdopt(candidatePath, deps)` returning `{ kind: "adopt"; adoptPath: string } | { kind: "declined"; because: "notAPrunedCheckout" | "unreadable" }`, importing the `readGitLink` reader and its `GitLink` type from the reattach probe module rather than reimplementing the classification.
    2. In the same file, `probeAdopt` answers `adopt` only when `readGitLink` returns `kind: "file"` AND `deps.adminDirExists(link.gitdir)` is false; every other `GitLink` kind and an `unreadable` read answer `declined`, never `adopt`.
    3. `src/worktree/adoptProbe.ts` takes `adminDirExists` and `readGitLink` as injected dependencies with the same shapes `ReattachProbeDeps` already declares, and never throws — a rejection answers `declined`.
  - **Boundary**: No new filesystem classification — `readGitLink` is the one reader of a `.git` entry.

- [ ] 1_2 Reconstruct an administrative entry and undo it on any failure
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{adoption-re-registers-a-directory-without-changing-what-is-in-it, an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it}; design.md D4; docs/design/worktree-create.md#24-adopt-re-registers-a-surviving-checkout
  - **Acceptance**:
    - Outcome: A failure at any reconstruction step leaves no entry and the original `.git` bytes
    - Verify: unit src/worktree/adoptWorktree.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutations.ts` gains `resetMixedIndex(runner, { worktreePath })` running `git -C <worktreePath> reset --mixed`, guarded by the same `readsAsFlag` refusal `repairWorktree` uses, returning a `MutationResult` through `settle`.
    2. `src/worktree/adoptWorktree.ts` exports `adoptWorktree(runner, { repoPath, commonDir, worktreePath, branch }, fsDeps)` performing D4's six steps in order, with `<worktreePath>/.git` written last.
    3. In the same file, mint the entry id from the worktree's basename via a non-recursive `mkdir` that retries the next `-2`, `-3` suffix on `EEXIST`, capped at 100 attempts, and return the id that succeeded.
    4. In the same file, record `<worktreePath>/.git`'s bytes before overwriting them, and on any failure after the `mkdir` remove the entry directory and restore those bytes, returning the underlying failure rather than the undo's outcome.
    5. In the same file, write `commondir` as `../..`, `HEAD` as `ref: refs/heads/<branch>\n`, and `gitdir` as `<worktreePath>/.git\n`, and never write anything under `<worktreePath>` other than its `.git` entry.
  - **Boundary**: Nothing inside the adopted working tree is created, modified or deleted.

- [ ] 1_3 Offer adopt in the create form, with both controls refused and the losses stated
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{adoption-states-what-it-cannot-restore-before-it-is-authorized, the-base-ref-is-refused-where-the-mode-cannot-apply-it, a-mode-that-fixes-its-own-target-refuses-the-destination-control}; design.md D6, D8
  - **Acceptance**:
    - Outcome: An adopt resolution submits an adopt create and names the directory, branch and losses
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` builds a `{ kind: "adopt", branch, adoptPath, expectedBranchOid }` create mode from a resolution whose mode is `adopt`, instead of falling back to a fresh create.
    2. In the same file, disable the base ref control and the destination control for an adopt resolution with their stated reasons, replacing the message at line 2024 that says a new worktree is created instead.
    3. In the same file, render the confirmation naming the directory, the branch, and D8's five losses as a fixed list that is stated rather than derived from any probe result.
  - **Boundary**: No new wire message — `WorktreeCreateMode.adopt` already exists.

## 2. Resolve it and run it

- [ ] 1_4 Resolve adopt from the occupied candidate and withhold it where unverified
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-surviving-checkout-is-offered-as-adopt-not-skipped, adoption-is-offered-only-where-the-reconstruction-has-been-verified, the-base-ref-is-refused-where-the-mode-cannot-apply-it}; design.md D1, D2, D3, D6, D7
  - **Acceptance**:
    - Outcome: A resolution names adopt at the occupied candidate and carries the branch tip
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` calls `probeAdopt` on `occupiedCandidate.path` inside `answerCreateProbe`, only when the selection resolved to `reuse` and an `occupiedCandidate` is present, and never when it resolved to `fresh`.
    2. In the same file, fill `expectedBranchOid` for both adopt producers from the ref enumeration `answerCreateProbe` already holds, and fall back to the free path when the enumeration carries no tip for the branch.
    3. In the same file, add an `adoptSupported` option defaulting to `process.platform !== "win32"`, and when it is false answer the suffixed fresh path instead of adopt with the reason stating the platform is not yet verified.
    4. In the same file, change `takesBase` to exclude `adopt`, and extend the `offerable` rule so an adopt resolution never records a debris candidate.
  - **Boundary**: The prunable detector stays where it is — `probeReattach` keeps producing case A's adopt.

- [ ] 1_5 Execute adopt behind the branch-claim refusal and the tip re-check
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-branch-a-live-worktree-holds-is-never-adopted-onto, an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it}; design.md D5
  - **Acceptance**:
    - Outcome: A claimed branch refuses before any write, and a claim found after the write undoes it
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` handles `request.mode.kind === "adopt"` before `validateCreatePath`, in the same position and for the same reason reattach leaves early at line 769, refusing a create that arrives carrying a debris disposition.
    2. In the same body, read `git worktree list --porcelain` and refuse when any non-prunable record names the selected branch, reporting the directory that holds it and offering no confirmation path.
    3. In the same body, re-read the branch tip and refuse when it differs from `mode.expectedBranchOid`, then call `adoptWorktree`.
    4. In the same body, re-read the listing after the reconstruction and require exactly one non-prunable record naming the branch at the adopted path; on two, undo the adoption and report it as refused rather than as a create.
    5. `src/worktree/createPath.ts` — remove the `adopt` case from `sourceOf`'s throw only if adopt now reaches it; otherwise leave `sourceOf` alone and record in the commit that adopt never becomes a `git worktree add`.
  - **Boundary**: No `git worktree add` and no `--force` on the adopt path.

## 3. Prove it against a real repository

- [ ] 1_6 Prove an adopted checkout is a worktree again, with its content untouched
  - **Deps**: 1_3, 1_4, 1_5
  - **Refs**: specs/worktree-panel/spec.md#{adoption-re-registers-a-directory-without-changing-what-is-in-it, a-branch-a-live-worktree-holds-is-never-adopted-onto}; design.md D4, D5
  - **Acceptance**:
    - Outcome: The adopted directory lists, holds its branch, survives a prune and commits back
    - Verify: command pnpm exec vitest run src/worktree/adoptWorktree.integration.test.ts
  - **Plan**:
    1. `src/worktree/adoptWorktree.integration.test.ts` builds a real repository in a temp directory, adds a worktree, deletes its administrative entry, runs `git worktree prune`, and adopts the surviving directory.
    2. In the same file, assert the adopted path appears in `git worktree list --porcelain` on its branch, is absent from the prunable set after a second `git worktree prune`, and accepts a commit that lands in the repository.
    3. In the same file, hash every file under the adopted directory with its mtime before and after the adoption and assert equality, with a dirty tracked file and an untracked file present.
    4. In the same file, assert that a second worktree taking the branch between the pre-read and the write leaves no entry at the adopted path and reports a refusal.
