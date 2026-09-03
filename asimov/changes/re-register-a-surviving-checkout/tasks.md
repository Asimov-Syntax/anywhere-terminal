# Tasks: re-register-a-surviving-checkout

The submit half of the wire already carries adopt; the resolution half does not, and it is the first
thing here. Then a second detector, an executor, the form's action, and the guard git cannot supply.

## 0. Close the wire's resolution half

- [x] 1_0 Carry the branch tip on the resolved adopt mode — verified: bun test 'src/types/messages.contract.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-surviving-checkout-is-offered-as-adopt-not-skipped}; design.md D3
  - **Acceptance**:
    - Outcome: A resolved adopt mode carries the branch tip the submit mode requires
    - Verify: unit src/types/messages.contract.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — `ResolvedMode`'s `adopt` variant gains `expectedBranchOid: string`, so the form can build `WorktreeCreateMode.adopt` from a resolution without inventing the value.
    2. In the same file, document on that field that it is the BRANCH tip and not a directory HEAD, the distinction `WorktreeCreateMode.adopt` already records.
    3. `src/worktree/repoRefs.ts` — `WorktreeRef` gains `oid: string` and `readRepoRefs` asks `for-each-ref` for `--format=%(objectname) %(refname:short)`, splitting each line on the first space; a line with no space is dropped rather than read as a nameless ref.
    4. `src/providers/WorktreeHost.ts` — the existing adopt producer in `answerCreateProbe` fills the new field from the ref enumeration it already holds, and answers the free path instead of adopt when that enumeration carries no tip for the branch. Required here rather than in 1_4: a field the type demands and no producer supplies fails `check-types` for the whole tree.

## 1. Recognise it and build it

- [x] 1_1 Recognise a pruned checkout at an occupied destination as an adopt candidate — verified: bun test 'src/worktree/adoptProbe.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-surviving-checkout-is-offered-as-adopt-not-skipped}; design.md D1, D2, D3
  - **Acceptance**:
    - Outcome: An unregistered directory whose `.git` names a gone administrative directory answers adopt
    - Verify: unit src/worktree/adoptProbe.test.ts
  - **Plan**:
    1. `src/worktree/adoptProbe.ts` exports `probeAdopt(candidatePath, deps)` returning `{ kind: "adopt"; adoptPath: string } | { kind: "declined"; because: "notAPrunedCheckout" | "unreadable" }`, importing the `readGitLink` reader and its `GitLink` type from the reattach probe module rather than reimplementing the classification.
    2. In the same file, `probeAdopt` answers `adopt` only when the link reads as a file AND `deps.adminDirExists(link.gitdir)` is false; every other link kind and an unreadable read answer `declined`, never `adopt`.
    3. In the same file, take `adminDirExists` and `readGitLink` as injected dependencies with the shapes `ReattachProbeDeps` already declares, and never throw — a rejection answers `declined`.
  - **Boundary**: No new filesystem classification — the existing `.git` reader is the one reader of a `.git` entry.

- [x] 1_2 Reconstruct an administrative entry gitdir-first, and hand back its undo — verified: bun test 'src/worktree/adoptWorktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{adoption-re-registers-a-directory-without-changing-what-is-in-it, an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it}; design.md D4; docs/design/worktree-create.md#24-adopt-re-registers-a-surviving-checkout
  - **Acceptance**:
    - Outcome: A failed reconstruction leaves the destination as it found it
    - Verify: unit src/worktree/adoptWorktree.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutations.ts` gains `resetMixedIndex(runner, { worktreePath })` running `git -C <worktreePath> reset --mixed`, guarded by the same `readsAsFlag` refusal `repairWorktree` uses, returning a `MutationResult` through `settle`.
    2. `src/worktree/adoptWorktree.ts` exports `adoptWorktree(runner, { repoPath, commonDir, worktreePath, branch }, fsDeps)` performing design.md D4's steps in exactly that order, writing `gitdir` immediately after the `mkdir` and `<worktreePath>/.git` last.
    3. In the same file, mint the entry id from the worktree's basename via a non-recursive `mkdir` that retries the next `-2`, `-3` suffix on `EEXIST`, capped at 100 attempts, and return the id that succeeded.
    4. In the same file, record the entry directory's `dev`/`ino` at `{ bigint: true }` right after the `mkdir` and compare them again through `sameIdentity` from `src/utils/fileIdentity.ts` before writing `<worktreePath>/.git` and again before the undo removes anything; a moved identity refuses and removes nothing.
    5. In the same file, record `<worktreePath>/.git`'s bytes before overwriting them, and on any failure after the `mkdir` run the undo — remove the entry directory, restore those bytes — returning the underlying failure; where the undo itself fails, return an outcome naming the entry directory and the state `<worktreePath>/.git` was left in.
    6. In the same file, return `{ ok: true, id, undo }` on success so the caller can withdraw the registration after its own post-write checks, and write `commondir` as `../..`, `HEAD` as `ref: refs/heads/<branch>\n`, and `gitdir` as `<worktreePath>/.git\n`.
  - **Boundary**: Nothing inside the adopted working tree is created, modified or deleted; `<worktreePath>/.git` is the sole exception and is the adoption itself.

- [x] 1_3 Offer adopt in the create form, with both controls refused and the losses stated — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_0
  - **Refs**: specs/worktree-panel/spec.md#{adoption-states-what-it-cannot-restore-before-it-is-authorized, the-base-ref-is-refused-where-the-mode-cannot-apply-it, a-mode-that-fixes-its-own-target-refuses-the-destination-control}; design.md D6, D8
  - **Acceptance**:
    - Outcome: An adopt resolution submits an adopt create and names the directory, branch and losses
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreeViewTypes.ts` — `WorktreeBranchMode` gains `adopt`, so the refusal maps the dialog keys by mode have to answer for it rather than inherit an answer nobody wrote.
    2. `src/webview/worktree/WorktreeController.ts` — the resolved-mode carrier that today produces only `reattach` also produces `{ kind: "adopt", branch, adoptPath, expectedBranchOid }` from a resolution whose mode is `adopt`, taking the tip from the resolution rather than falling back to a `reuse` that would check the branch out somewhere else.
    3. `src/webview/worktree/WorktreeCreateDialog.ts` — an adopt resolution sets the draft's branch mode to `adopt` rather than to `new`, so the mode the form shows and the mode it submits are the one answer.
    4. In the same file, refuse the base ref control and the destination control for that mode with their stated reasons, and replace the stated action at the `adopt` entry that says a new worktree is created instead.
    5. In the same file, the destination the form states and submits for an adopt resolution is the directory being adopted, on the same rule a repair already follows, and the skipped candidate is never offered for clearing under it.
    6. In the same file, render the confirmation naming the directory, the branch, and design.md D8's five losses as a fixed list that is stated rather than derived from any probe result.
  - **Boundary**: No new wire message — `WorktreeCreateMode.adopt` already exists.

## 2. Resolve it and run it

- [x] 1_4 Resolve adopt from the occupied candidate and withhold it where unverified — verified: bun test 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_0, 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-surviving-checkout-is-offered-as-adopt-not-skipped, adoption-is-offered-only-where-the-reconstruction-has-been-verified, the-base-ref-is-refused-where-the-mode-cannot-apply-it}; design.md D1, D2, D3, D6, D7
  - **Acceptance**:
    - Outcome: A resolution names adopt at the occupied candidate and carries the branch tip
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` calls `probeAdopt` on `occupiedCandidate.path` inside `answerCreateProbe`, only when the selection resolved to `reuse` and an `occupiedCandidate` is present, and never when it resolved to `fresh`.
    2. In the same file, the new occupied-candidate producer fills `expectedBranchOid` on the rule 1_0 established for the existing one, and a ref the enumeration attributed no tip to counts as no tip for both producers — an empty string is what a line the reader could not attribute leaves behind.
    3. In the same file, a selection carrying a live holder is never corroborated: the executor refuses that branch at the moment of the write, and a mode that will always be refused is not one to offer.
    4. In the same file, add an `adoptSupported` option defaulting to `process.platform !== "win32"`, and when it is false leave the mode as the selection resolved it and never take the corroborating read at all, so the resolution stands on the suffixed free path it already carries, with the reason stating the platform is not yet verified rather than that the reconstruction fails.
    5. In the same file, change `takesBase` to exclude `adopt`, and extend the `offerable` rule so an adopt resolution never records a debris candidate.
    6. `src/extension.ts` — supply `probeAdopt` to `createWorktreeHost`, built from the same `readGitLink` and `adminDirExists` the existing `corroborateRepair` already constructs. Without it the option is undefined in the shipped extension and adopt is dark however well the host is tested — the failure shape a past review round already caught for the provisioning offer.
  - **Boundary**: The prunable detector stays where it is — `probeReattach` keeps producing the listed case's adopt.

- [x] 1_5 Execute adopt behind the claim refusal, the re-probe and the post-write tip check — verified: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-branch-a-live-worktree-holds-is-never-adopted-onto, an-adoption-attaches-the-branch-at-the-tip-it-promised, an-adoption-re-establishes-what-it-was-offered-on, an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it}; design.md D5
  - **Acceptance**:
    - Outcome: Every guard refuses and withdraws the registration it had written
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` handles `request.mode.kind === "adopt"` before `validateCreatePath`, in the same position and for the same reason reattach leaves early at line 769, refusing a create that arrives carrying a debris disposition.
    2. In the same body, read `git worktree list --porcelain` and refuse when any non-prunable record names the selected branch, reporting the directory that holds it and offering no confirmation path.
    3. In the same body, re-run `probeAdopt` against `mode.adoptPath` and refuse on anything but `adopt`, so a registration restored during the user's pause is never overwritten.
    4. In the same body, call `adoptWorktree`, then read `git -C <adoptPath> rev-parse HEAD` and call the returned undo when it differs from `mode.expectedBranchOid`, reporting a refusal rather than a create.
    5. In the same body, re-read the listing after the reconstruction and require exactly one non-prunable record naming the branch at the adopted path; on two, call the undo and report a refusal.
    6. `src/extension.ts` supplies the four adoption dependencies — the re-probe built from the same readers the create probe already uses, the repository's common directory, the reconstruction, and the post-repair tip read. Without them the mode is dark in the shipped extension however well this module is tested, which is the failure shape a past review round already caught for the provisioning offer.
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
    3. In the same file, hash every path under the adopted directory EXCEPT its `.git` entry, with mtimes, before and after the adoption and assert equality, with a dirty tracked file and an untracked file present; assert separately that `.git` holds exactly the new `gitdir:` line.
    4. In the same file, assert that a second worktree taking the branch between the pre-read and the post-read leaves no entry at the adopted path and reports a refusal.
    5. In the same file, assert that an entry directory whose `gitdir` file exists is not removed by `git worktree prune --expire now`, which is what makes design.md D4's write order load-bearing.
