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

- [x] 1_6 Prove an adopted checkout is a worktree again, with its content untouched — verified: pnpm exec vitest run src/worktree/adoptWorktree.integration.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
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
    5. In the same file, assert that an entry directory whose `gitdir` file names a path that EXISTS is not removed by `git worktree prune --expire now`, and that one with no `gitdir` file is — the pair is what makes design.md D4's write order load-bearing.
    6. `src/worktree/adoptWorktree.ts` and `src/extension.ts` — git's administrative worktree-entry parent directory is created if it is not there before the entry's own exclusive `mkdir`, and that `mkdir` treats only a collision as a name to retry, reporting any other failure as itself. Found by this task against a real repository: `git worktree prune` removes that parent once it is empty, so the first adoption in a repository with one forgotten checkout failed with a message about names being unavailable.

## 4. Close review round 1

- [x] 2_1 Accept only git's own gitfile as the authority to overwrite one — verified: pnpm exec vitest run src/worktree/reattachProbe.test.ts src/worktree/adoptProbe.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 1_6
  - **Refs**: design.md D1; `.reviews/round-1.md` F007
  - **Acceptance**:
    - Outcome: A `.git` file git itself rejects is `unreadable`, never a link adopt may act on
    - Verify: command pnpm exec vitest run src/worktree/reattachProbe.test.ts src/worktree/adoptProbe.test.ts
  - **Plan**:
    1. `src/worktree/reattachProbe.ts` — `readGitLink` accepts only git's own gitfile grammar: the file begins with `gitdir: ` and the rest, with trailing whitespace removed, is the path. Anything else is `unreadable`. The parser is shared with reattach, so the narrowing applies at both boundaries (F007).
    2. `src/worktree/reattachProbe.test.ts` — a file whose `gitdir:` line is not the first thing in it is `unreadable`, and the reattach classification refuses with it.
    3. `src/worktree/adoptProbe.test.ts` — the same file declines adoption rather than authorizing a write over it.

- [x] 2_2 Prove a surviving checkout belongs to this repository before it is offered — verified: pnpm exec vitest run src/worktree/adoptProbe.test.ts src/providers/WorktreeHost.actions.test.ts src/worktree/worktreeMutationService.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{a-surviving-checkout-is-offered-as-adopt-not-skipped}; design.md D1; `.reviews/round-1.md` F002, F003, F010
  - **Acceptance**:
    - Outcome: Adopt is declined unless the stale gitdir is an entry of this repository
    - Verify: command pnpm exec vitest run src/worktree/adoptProbe.test.ts src/providers/WorktreeHost.actions.test.ts src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/adoptProbe.ts` — `probeAdopt` takes the repository's common directory and declines unless the parsed stale gitdir is an entry beneath it (F002).
    2. `src/providers/WorktreeHost.ts` and `src/worktree/worktreeMutationService.ts` — the adopt corroboration is asked with the common directory it must prove against, taken from the repository identity both already hold rather than read again from git (F010).
    3. `src/extension.ts` — the production adapters treat only `ENOENT`/`ENOTDIR` as absence; any other read failure is an unreadable refusal, for `adminDirExists` and for the undo's `readFile` (F003).
    4. `src/worktree/adoptProbe.test.ts`, `src/providers/WorktreeHost.actions.test.ts`, `src/worktree/worktreeMutationService.test.ts` — a stale gitdir under another repository declines at the probe, is not offered by the host, and is refused by the mutation.

- [x] 2_3 Run an adoption only on the resolution the host published — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 2_2
  - **Refs**: design.md D1, D3; `.reviews/round-1.md` F001
  - **Acceptance**:
    - Outcome: A repair submission that differs from the published answer is refused out loud
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — the `Opening` record carries the repair mode this opening's latest answer published, set beside `debrisCandidate` and withdrawn with it.
    2. `src/providers/WorktreeHost.ts` — an inbound `worktreeCreate` naming `adopt` or `reattach` runs only when its path, branch, target and expected oid equal that record, and is refused with a stated reason otherwise (F001).
    3. `src/providers/WorktreeHost.actions.test.ts` — a substituted path, branch or tip refuses and says so, and the legitimate submission still runs.
    4. `src/extension.worktreeAssembly.test.ts` — the assembled repair submits the resolution the host published rather than a hand-built one, which is what the rule now requires of the panel.

- [x] 2_4 Make the reconstruction non-destructive under substitution and leave nothing behind — verified: pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/adoptWorktree.integration.test.ts src/worktree/worktreeMutationService.test.ts src/worktree/adoptProbe.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 2_3
  - **Refs**: specs/worktree-panel/spec.md#{an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it, an-adoption-re-establishes-what-it-was-offered-on}; design.md D4, D5; `.reviews/round-1.md` F004, F005, F006, F011
  - **Acceptance**:
    - Outcome: A failed reconstruction leaves no entry and reports whatever it could not remove
    - Verify: command pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/adoptWorktree.integration.test.ts src/worktree/worktreeMutationService.test.ts src/worktree/adoptProbe.test.ts
  - **Plan**:
    1. `src/worktree/adoptProbe.ts` and `src/worktree/worktreeMutationService.ts` — the adopt verdict carries the stale gitdir it proved absent, and the reconstruction is given that exact path rather than parsing the link a second time.
    2. `src/worktree/adoptWorktree.ts` — the three entry files are created exclusively, so a directory substituted after the `mkdir` is never truncated; an entry this adoption cannot prove it owns is reported as residue rather than as a clean withdrawal (F004, F005).
    3. `src/worktree/adoptWorktree.ts` — the final `<wt>/.git` write is conditional: the link must still hold the bytes the adoption was offered on and the stale administrative directory must still be absent, both read immediately before it (F006).
    4. `src/worktree/adoptWorktree.ts` — a failure to create the entry says which failure it was; only the loop running out of candidates reports that no name was available (F011).
    5. `src/worktree/adoptWorktree.test.ts`, `src/worktree/worktreeMutationService.test.ts` and `src/providers/WorktreeHost.actions.test.ts` — a substituted entry, a post-`mkdir` identity failure, a restored registration and a restored link each leave the destination as found and report what was left.
    6. `src/worktree/adoptWorktree.integration.test.ts` — against a real repository, the adoption still lists and commits, and a link replaced between the probe and the write is not overwritten.
    7. `src/extension.ts` — the production filesystem supplies the exclusive create and the directory-existence read the reconstruction now asks for.

- [x] 2_5 Put the tip guard back in front of the index, and keep a resolved mode across a late refs reply — verified: pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/worktreeMutationService.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 2_4
  - **Refs**: design.md D4, D6; `.reviews/round-1.md` F008, F009
  - **Acceptance**:
    - Outcome: A moved branch refuses before the index is rebuilt, and a refs reply never demotes a resolved mode
    - Verify: command pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/worktreeMutationService.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/worktree/adoptWorktree.ts` — the reconstruction is given the tip it promised and reads `HEAD` from inside the worktree after `repair` and before `reset --mixed`, which is the order design.md D4 states; a mismatch undoes and refuses there (F009).
    2. `src/worktree/worktreeMutationService.ts` and `src/extension.ts` — the tip guard has one owner, so the service's separate post-success read is retired with its dependency.
    3. `src/webview/worktree/WorktreeCreateDialog.ts` — a refs reply that arrives after a resolution does not replace the branch mode that resolution set, while the typed branch is still the one it answered (F008).
    4. `src/worktree/adoptWorktree.test.ts`, `src/worktree/worktreeMutationService.test.ts` and `src/webview/worktree/WorktreeCreateDialog.test.ts` — a moved tip leaves no entry and no index rebuild, and a late refs reply leaves the destination control refused.

- [x] 2_6 Apply the absence rule at the other boundary that reads the same directory — verified: pnpm exec vitest run src/worktree/reattachProbe.test.ts src/worktree/adoptProbe.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 2_5
  - **Refs**: `.reviews/round-1.md` F003
  - **Acceptance**:
    - Outcome: Neither probe's administrative-directory read reports absence for a failure that is not one
    - Verify: command pnpm exec vitest run src/worktree/reattachProbe.test.ts src/worktree/adoptProbe.test.ts
  - **Plan**:
    1. `src/extension.ts` — the reattach corroboration's `adminDirExists` uses the same errno rule the adopt one does; the two readers of one directory cannot disagree about what a failed read means. Found by the fix-delta audit: F003 named the adopt adapter, and the reattach adapter beside it reports the same false absence — which now reaches adopt, because a reattach that finds the directory gone REPORTS adopt.
    2. `src/worktree/reattachProbe.ts` — `probeReattach` answers rather than throws when that read fails, on the rule the rest of the module already follows.
    3. `src/worktree/reattachProbe.test.ts` — an unreadable administrative directory declines rather than being reported as a forgotten checkout.

## 5. Close review round 2

- [x] 3_1 Touch the worktree's link only while it is the one this adoption proved, or wrote — verified: pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/adoptWorktree.integration.test.ts src/worktree/adoptProbe.test.ts src/worktree/reattachProbe.test.ts src/worktree/worktreeMutationService.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 2_6
  - **Refs**: specs/worktree-panel/spec.md#{an-adoption-re-establishes-what-it-was-offered-on, an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it}; design.md D4, D5; `.reviews/round-2.md` F003, F005, F006
  - **Acceptance**:
    - Outcome: A refused adoption never writes over a link it did not install, and reports what it left
    - Verify: command pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/adoptWorktree.integration.test.ts src/worktree/adoptProbe.test.ts src/worktree/reattachProbe.test.ts src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/reattachProbe.ts` and `src/worktree/adoptProbe.ts` — a classified `.git` file carries the exact text it held beside the gitdir it resolves to, and the adopt verdict carries those bytes: proving which administrative directory was corroborated does not prove the link that names it is still the same link (F006).
    2. `src/worktree/worktreeMutationService.ts` — the reconstruction is given the corroborated bytes.
    3. `src/worktree/adoptWorktree.ts` — the link is read before the `mkdir` and must equal those bytes; a read that fails, or bytes that differ, refuses before anything is created (F003, F006).
    4. `src/worktree/adoptWorktree.ts` — undo leaves the link alone until this adoption has installed its own, and afterwards restores only while the bytes on disk are still the ones it wrote; anything else is reported as residue (F005).
    5. `src/extension.ts` — a gitdir path that exists but is not a directory is unreadable rather than absent (F003).
    6. `src/worktree/adoptWorktree.test.ts` — the fake's own store is what the assertions read, so a link the undo overwrites is visible; a substituted link, an unreadable link and a failure before the final write each leave the destination as found.
    7. `src/worktree/adoptWorktree.integration.test.ts` — against a real repository, a link replaced during a failing adoption keeps the replacement.
    8. `src/worktree/reattachProbe.test.ts`, `src/worktree/adoptProbe.test.ts`, `src/worktree/worktreeMutationService.test.ts` and `src/providers/WorktreeHost.actions.test.ts` — the bytes travel unchanged from the read to the request.

## 6. Close review round 3 — bind the link's writes to the object that was proved

- [x] 4_1 Hold one handle on the worktree's link, and write only through it — verified: pnpm exec vitest run src/worktree/adoptWorktree.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D9, D4; specs/worktree-panel/spec.md#{an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it, an-undo-restores-only-the-git-entry-the-adoption-itself-replaced, an-adoption-that-cannot-establish-the-git-entry-says-so-rather-than-reporting-a-clean-failure}; `.reviews/round-3.md` F005, F006, F012; `src/utils/regularFileRead.ts`; `src/utils/fileIdentity.ts`
  - **Acceptance**:
    - Outcome: A `.git` entry another writer replaced keeps its bytes through the adoption and its undo
    - Verify: command pnpm exec vitest run src/worktree/adoptWorktree.test.ts
  - **Plan**:
    1. `src/worktree/adoptWorktree.ts` — `AdoptFs` gains `openLink` returning a handle with `identity`, `readAt`, `truncate`, `writeAt` and `close`; the link's `readFile`/`writeFile`/`removeFile` retire with the pathname writes they served.
    2. `src/worktree/adoptWorktree.ts` — the handle opens before the `mkdir` and is NOT closed in a `finally`: it is carried on the result, closed by `undo()` as its last act, and by a new `release()` on the ok result. D5's post-write withdrawals run at the caller, so a handle closed on return would leave them `EBADF` (oracle finding 1).
    3. `src/worktree/adoptWorktree.ts` — both proofs read at an explicit position 0, never sequentially: `FileHandle.readFile` reads from the current offset, so a second sequential read returns zero bytes and would refuse every ordinary adoption (oracle finding 6).
    4. `src/worktree/adoptWorktree.ts` — the claim is `truncate(0)` then a write looped to completion; a fulfilled SHORT write is a failure, not an established link (oracle finding 4). Path-vs-handle identity is compared immediately before and after it.
    5. `src/worktree/adoptWorktree.ts` — a failed or short claim write re-writes `staleLink` through the same handle; a failed recovery reports a residue naming the directory and the unknown content.
    6. `src/worktree/adoptWorktree.ts` — the undo owns the link when it RESOLVES to the entry this adoption created, not when its bytes match: `git worktree repair` rewrites our own link into relative form under `worktree.useRelativePaths`, and every D5 undo runs after repair (oracle finding 3).
    7. `src/worktree/reattachProbe.ts` — the `gitdir:` grammar is exported as a parser over the bytes, so the undo's ownership test and the detector cannot hold two opinions about what a link says; `readGitLink` is expressed in terms of it.
    8. `src/extension.ts` — `nodeAdoptFs.openLink` opens `O_RDWR` with `O_NOFOLLOW` where defined, degrading as `src/utils/regularFileRead.ts` already does, and refuses a handle whose `fstat` is not a regular file.
    9. `src/worktree/worktreeMutationService.ts` — the residue's link state stops being a boolean, so the third outcome is representable at all; 4_2 owns its wording and its tests.
    10. `src/worktree/adoptWorktree.integration.test.ts` — the real-filesystem adapter moves with `AdoptFs`; 4_2 owns the new cases it grows.
    11. `src/worktree/worktreeMutationService.test.ts` — its adopt fakes move with the result and residue shapes; 4_2 owns the cases that assert the three messages.
    12. `src/worktree/adoptWorktree.test.ts` — the fake models an inode table: paths map to inode objects with their own identity and bytes, a handle captures one inode at open, and every operation through it still reaches the captured inode after the path has been replaced. Cases: a different-inode replacement survives the claim write AND the undo, asserted on the old inode as well as the path so a write to the detached inode is visible; a same-inode in-place rewrite, asserting the documented parity rather than a guarantee; a repair that normalizes to a relative link, asserting the undo still restores; a short write; a truncate-then-reject with a recovery that succeeds and one that fails; a `close()`d handle rejecting, so the deferred-undo path is armed. Each guard arm-checked by reverting it.

- [x] 4_2 Report a link the adoption could not establish, and release the handle the caller accepts — verified: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/adoptWorktree.integration.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 4_1
  - **Refs**: design.md D9; specs/worktree-panel/spec.md#an-adoption-that-cannot-establish-the-git-entry-says-so-rather-than-reporting-a-clean-failure; `.reviews/round-3.md` F012
  - **Acceptance**:
    - Outcome: The reported failure names which of the three states the `.git` entry was left in
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/adoptWorktree.integration.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` — `residueNote` renders the third state; a residue with no entry left behind still reports, because an unknown link is not a clean withdrawal.
    2. `src/worktree/worktreeMutationService.ts` — the success return calls `release()`; today it returns without disposing anything the reconstruction handed back.
    3. `src/worktree/worktreeMutationService.test.ts` — each of the three states produces its own message, and an accepted adoption releases.
    4. `src/worktree/adoptWorktree.integration.test.ts` — against a real repository: a link replaced during a failing adoption keeps the replacement and the outcome says so rather than claiming a restore; and an adoption in a repository with `worktree.useRelativePaths` set still withdraws cleanly when the branch claim is taken after the write.

## 7. Close review round 4 — the undo's order, and the object's one name

- [x] 5_1 Put the link back before the entry goes, and refuse an object with a second name — verified: pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/adoptWorktree.integration.test.ts && pnpm run check-types && UV_THREADPOOL_SIZE=16 pnpm exec vitest run --maxWorkers=6 --reporter=default --reporter=./src/test/invariants/coverageReporter.ts exit 0
  - **Deps**: 4_2
  - **Refs**: design.md D9, D4; specs/worktree-panel/spec.md#{an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it, an-undo-restores-only-the-git-entry-the-adoption-itself-replaced}; `.reviews/round-4.md` F005, F013, F014; `src/agentHooks/install/lockedJsonFile.ts`
  - **Acceptance**:
    - Outcome: No instant of a withdrawal leaves the checkout's `.git` naming a directory that is gone
    - Verify: command pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/adoptWorktree.integration.test.ts
  - **Plan**:
    1. `src/worktree/adoptWorktree.ts` — the undo restores the link first and removes the entry after, so an interrupted withdrawal is never a checkout pointing at nothing (F005).
    2. `src/worktree/adoptWorktree.ts` — the restore's identity proof is taken again AFTER the write; a divergence reports `leftAsFound` rather than a restore that went to a detached object (F005).
    3. `src/worktree/adoptWorktree.ts` — `LinkHandle.identity` carries `nlink`; a pinned object with more than one name is refused at the open and again before the claim (F013).
    4. `src/extension.ts` and `src/worktree/adoptWorktree.integration.test.ts` — the real adapter reports `nlink` from the `fstat` it already takes, and a real hard link to `<wt>/.git` is refused with the alias's bytes intact.
    5. `src/worktree/adoptWorktree.test.ts` — the opening-read case drives the HANDLE's `readAt`, not the retired `readFile`, and asserts nothing was created, spawned or written (F014); plus the replacement-between-the-restore's-samples case and a multiply-linked inode. Each guard arm-checked.
    6. `src/worktree/adoptWorktree.ts` — the duplicated undo comment left by 4_1 goes.

## 8. Close review round 5 — one rule for the withdrawal, one home for the link count

- [ ] 6_1 Remove the entry only when nothing points at it, and count names inside the write
  - **Deps**: 5_1
  - **Refs**: design.md D4, D9; specs/worktree-panel/spec.md#{an-adoption-that-does-not-complete-leaves-the-destination-as-it-found-it, an-undo-restores-only-the-git-entry-the-adoption-itself-replaced}; `.reviews/round-5.md` F005, F013
  - **Acceptance**:
    - Outcome: A withdrawal never removes an administrative entry the visible `.git` still names
    - Verify: command pnpm exec vitest run src/worktree/adoptWorktree.test.ts src/worktree/adoptWorktree.integration.test.ts
  - **Plan**:
    1. `src/worktree/adoptWorktree.ts` — the undo settles the link, then reads `<wt>/.git` by pathname and removes the entry only where what it names does not resolve to it; the retained entry is reported (F005).
    2. `src/worktree/adoptWorktree.ts` — the `nlink` refusal moves inside the write, so the claim, the failed-claim recovery and the undo's restore all inherit it (F013).
    3. `src/worktree/adoptWorktree.test.ts` — a replacement whose link names THIS adoption's entry, asserting the entry survives and is named; an alias appearing after a successful claim, asserting neither the recovery nor the undo rewrites it. Each guard arm-checked.
    4. `src/worktree/adoptWorktree.integration.test.ts` — against a real repository, a hard link created during a failing adoption keeps its bytes through the undo.
