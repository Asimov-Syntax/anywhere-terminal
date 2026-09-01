## 1. The shared half

- [x] 1_1 Extract the reader's shared half and give it the caller's identity — verified: pnpm exec vitest run 'src/worktree/provisioning/providerKit.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: The kit stamps the calling provider, and the asimov suite passes unedited
    - Verify: unit src/worktree/provisioning/providerKit.test.ts
  - **Plan**:
    1. Create `src/worktree/provisioning/providerKit.ts` and move into it from `src/worktree/provisioning/asimovProvider.ts`: `DETAIL_MAX`, `bounded`, `MAX_MODEL_ROWS`, `MAX_SCAN`, `isAbsence`, `errnoOf`, `ids`, `Draft`, `problem`, `emitted`, `full`, `report`, `emptyModel`, `splitGlob`, `contained`, `refusal`, `scanNames` and `entriesFor`. Export each, and rename `AsimovProviderDeps` to `ProviderDeps`.
    2. In `src/worktree/provisioning/providerKit.ts`, add the `ProviderContext` interface design.md D2 names and take it as a parameter of `problem`, `refusal` and `entriesFor`, so the file stamped into a `ProvisionProblem` and the `source` stamped into a `ProvisionEntry` come from the caller. No moved function may reference `ASIMOV_PROVIDER_FILE`.
    3. In `src/worktree/provisioning/providerKit.ts`, add `openProviderFile(deps, repoRoot, relPath)` holding the prepare-root, prove-containment, then-open sequence currently inline at `src/worktree/provisioning/asimovProvider.ts:396-424`, returning `text`, `absent` or `problem`.
    4. In `src/worktree/provisioning/asimovProvider.ts`, delete the moved declarations, import them from the kit, pass its own `ProviderContext`, and read its file through `openProviderFile`. Keep `ASIMOV_PROVIDER_FILE`, `KNOWN_KEYS` and `readAsimovProvisioning`; re-export `AsimovProviderDeps` as a type alias of `ProviderDeps`.
    5. Update `src/worktree/provisioning/provisioningDeps.ts` to return `ProviderDeps`, keeping `MAX_PROVIDER_BYTES` and `createProvisioningDeps` where they are.
    6. Create `src/worktree/provisioning/providerKit.test.ts` calling the kit as a NON-asimov provider: an entry's `source` and a problem's `file` are the context's file; `openProviderFile` answers `absent` for a missing file, `problem` for one that resolves outside the root, and `problem` for one whose own path is a symlink out.
  - **Boundary**: behaviour-preserving for the asimov adapter — `src/worktree/provisioning/asimovProvider.test.ts` may not be edited by this task

- [x] 1_2 Count rows and scanned names separately, once per read — verified: pnpm exec vitest run 'src/worktree/provisioning/providerKit.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D9; design.md § Obligation ledger
  - **Acceptance**:
    - Outcome: Two non-matching globs cannot scan more names than one budget allows
    - Verify: unit src/worktree/provisioning/providerKit.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/providerKit.ts`, add the `ProviderBudget` interface and `newBudget()` design.md D9 names, holding a `rows` and a `scanned` count.
    2. In `src/worktree/provisioning/providerKit.ts`, make `scanNames` charge the passed budget's `scanned` account instead of allocating a counter per call, and stop at `MAX_SCAN` across every call sharing that budget.
    3. In `src/worktree/provisioning/providerKit.ts`, make `Draft` hold the same budget so `emitted`, `full` and `report` charge `rows` across every draft sharing it, and record the cap's reason exactly once per budget. A charged account only counts what every append goes through, so the kit owns the appends: add `addEntry`, `addPort` and `addSetup`, and update `src/worktree/provisioning/asimovProvider.ts` to append its ports and setup steps through them.
    4. Extend `src/worktree/provisioning/providerKit.test.ts`: two globs over directories of non-matching names stop at `MAX_SCAN` in total, not per glob, while emitting no rows; two drafts sharing one budget stop at the combined row cap; the reason is recorded once; a fresh budget starts empty.

## 2. The two new adapters

- [x] 2_1 Read orca's configuration pair into the model — verified: pnpm exec vitest run 'src/worktree/provisioning/orcaProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-repository-is-read-through-whichever-provisioning-file-it-already-keeps, a-source-is-reported-as-it-reads-not-as-it-would-resolve}; design.md D6, D7
  - **Acceptance**:
    - Outcome: An orca repo's shared directories link, its include list copies, its setup block is one step
    - Verify: unit src/worktree/provisioning/orcaProvider.test.ts
  - **Plan**:
    1. Add the `ProviderAdapter` interface design.md names to `src/worktree/provisioning/providerKit.ts`, so the first adapter to need it declares it once and 2_2 and 3_1 consume it. Then create `src/worktree/provisioning/orcaProvider.ts` exporting `ORCA_PROVIDER_FILES = ["orca.yaml", ".worktreeinclude"]` and a `ProviderAdapter` whose `read` returns `null` only when neither file is present, reading each through `openProviderFile`.
    2. In `src/worktree/provisioning/orcaProvider.ts`, map `worktree.sharedDirectories` to `entries[] { mode: "link" }` via the kit's `entriesFor` with an `orca.yaml` context, and `scripts.setup` to exactly ONE `setup[] { kind: "shell" }` carrying the block scalar verbatim with trailing whitespace trimmed, per design.md D7.
    3. In `src/worktree/provisioning/orcaProvider.ts`, read `.worktreeinclude` as lines, drop blanks and lines whose first non-space character is `#`, and map the rest to `entries[] { mode: "copy" }` with a `.worktreeinclude` context. An absent `.worktreeinclude` beside a present `orca.yaml` is not a problem, and neither is the reverse.
    4. In `src/worktree/provisioning/orcaProvider.ts`, add no problem for an `orca.yaml` key outside the two that map.
    5. Create `src/worktree/provisioning/orcaProvider.test.ts` covering: both files present; each alone; a multi-line `scripts.setup` containing an `if`/`fi` stays ONE step whose script still parses as one program; a `sharedDirectories` path that does not exist is still offered; unmapped keys produce no problem; each row's `source` is the file it came from; a path escaping the repo is refused; a provider file that is itself a symlink out is refused before it is read; a malformed `orca.yaml` names the file and does not throw.

- [x] 2_2 Read tasks declared to run when a worktree is created — verified: pnpm exec vitest run 'src/worktree/provisioning/vscodeTasksProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-repository-is-read-through-whichever-provisioning-file-it-already-keeps, a-task-file-is-read-on-the-terms-its-own-format-defines}; design.md D1, D4
  - **Acceptance**:
    - Outcome: A process task's command is quoted; only a shell task's runs as shell text
    - Verify: unit src/worktree/provisioning/vscodeTasksProvider.test.ts
  - **Plan**:
    1. Add `jsonc-parser` at its exact current version to `dependencies` in `package.json` and install it. An install failing as missing, unknown or misnamed is a STOP, not a retry under another name.
    2. Create `src/worktree/provisioning/vscodeTasksProvider.ts` exporting `VSCODE_TASKS_FILE = ".vscode/tasks.json"` and a `ProviderAdapter` reading through `openProviderFile`, returning `null` when the file is absent and a `malformed` problem when `jsonc-parser`'s tolerant `parse` reports errors.
    3. In `src/worktree/provisioning/vscodeTasksProvider.ts`, select entries of `tasks[]` whose `runOptions.runOn` is the string `worktreeCreated`, in file order, and build each `script` per design.md D4: `command` verbatim only when `type` is exactly `"shell"`, otherwise `command` as a single-quoted word; `args` elements always single-quoted.
    4. In `src/worktree/provisioning/vscodeTasksProvider.ts`, record a `problems[] { reason: "unsubstituted" }` naming the task's `label` when the built script contains a `${` token or the entry declares `options.cwd`, and still offer the step.
    5. Create `src/worktree/provisioning/vscodeTasksProvider.test.ts` covering: line comments, block comments and a trailing comma parse; an unmarked task is not offered; file order is preserved; a `type: "process"` entry whose command names an executable followed by `; touch` becomes ONE quoted word; the same command under `type: "shell"` stays verbatim; an absent `type` is quoted; an `args` element containing `'`, `;` and `$(id)` becomes one literal word; `${workspaceFolder}` and `options.cwd` are each reported and still offered; a file that is not JSON at all is `malformed`; the task file as a symlink out is refused before it is read.

## 3. Detection and the choice it leaves open

- [x] 3_1 Choose one source by a fixed order and record the rest — verified: pnpm exec vitest run 'src/worktree/provisioning/readProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1, 2_2
  - **Refs**: specs/worktree-panel/spec.md#{exactly-one-detected-source-supplies-the-offer, a-present-source-answers-even-when-its-answer-is-nothing}; design.md D3, D8, D9
  - **Acceptance**:
    - Outcome: The first source whose file is present supplies the rows; later ones are listed inactive
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. Change `ProvisionProvider.file: string` to `files: readonly string[]` in `src/types/messages.ts` per design.md D8, and update every construction site the type check names, including the shared fixtures in `src/webview/worktree/worktreeFixtures.ts`.
    2. Create `src/worktree/provisioning/readProvisioning.ts` exporting `DETECTION_ORDER` as a module constant holding the asimov, orca and tasks adapters in that order, and `readProvisioning(deps, repoRoot, prefer?)`.
    3. In `src/worktree/provisioning/readProvisioning.ts`, take the first adapter whose `read` is non-null as the model, append every later adapter whose files are present to `providers[]` with `active: false`, and pass one `newBudget()` to every adapter it calls.
    4. In `src/worktree/provisioning/readProvisioning.ts`, honour `prefer` by trying that adapter first and leaving the rest of the order intact; an unknown or absent `prefer` falls back to the plain order.
    5. In `src/worktree/provisioning/asimovProvider.ts`, wrap `readAsimovProvisioning` as a `ProviderAdapter` returning `null` only when `asimov/worktree.yaml` is absent, so a present-but-empty and a present-but-unreadable file are both hits per design.md D3.
    6. Change `src/extension.ts`'s `readProvisioning` binding to call `readProvisioning(createProvisioningDeps(), mainWorktree)` instead of `readAsimovProvisioning`.
    7. Create `src/worktree/provisioning/readProvisioning.test.ts` covering: each source alone; all three present yields the asimov rows and two inactive providers; a comment-only `asimov/worktree.yaml` beside a populated `orca.yaml` yields an EMPTY section and orca inactive; an unreadable first source reports and stops; the active id is unchanged when the fake reverses enumeration order; `prefer` selects a later source; one budget's scan account spans two sources; an orca provider row names both files.

- [ ] 3_2 Answer a switch with a fresh offer, latest choice winning
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#a-source-that-did-not-supply-the-offer-stays-visible-and-selectable; design.md D5
  - **Acceptance**:
    - Outcome: Two switches answered out of order leave the later choice on screen
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Add `WorktreeProvisionSwitchMessage` to `src/types/messages.ts` with the fields design.md D5 names — `repoId`, `opening`, `switch`, `provider` — and list `worktreeProvisionSwitch` in `WORKTREE_MESSAGE_TYPES`.
    2. In `src/providers/WorktreeHost.ts`, add a guard for that payload beside `isKnownProvision`, refusing a `provider` that is not one of the ids this host put in the model it last offered for that opening.
    3. In `src/providers/WorktreeHost.ts`, track the highest `switch` seen per `(surface, repo, opening)` and re-resolve with `prefer` set to the named provider without consulting the `provisionReading` marker, publishing the resulting offer only when the resolving request still holds the highest sequence.
    4. Extend `src/providers/WorktreeHost.actions.test.ts`: a switch posts a fresh offer with a different offer id and the other source's rows; two switches whose reads resolve in reverse order leave the later provider's offer published; a switch for an undetected provider is refused with no read; a switch after the opening is retired publishes nothing; a switch submits and creates nothing.
  - **Boundary**: no message may carry a path, a command, or a model from the webview

- [ ] 3_3 Draw the sources that did not win, and post the switch
  - **Deps**: 3_2
  - **Refs**: specs/worktree-panel/spec.md#a-source-that-did-not-supply-the-offer-stays-visible-and-selectable; design.md D5, D8
  - **Acceptance**:
    - Outcome: An inactive provider draws one row that posts a switch and submits nothing
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, render one row per `model.providers` entry with `active: false`, naming its `files`, with a control calling a new `onProvisionSwitch` dep carrying the provider id.
    2. In `src/webview/worktree/WorktreeCreateDialog.ts`, mint the increasing `switch` sequence per dialog and pass it through that dep.
    3. In `src/webview/worktree/WorktreeController.ts`, post `worktreeProvisionSwitch` from that dep, carrying the opening the form was composed in.
    4. Extend `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts`: an inactive provider draws exactly one row naming both of an orca pair's files; an active provider draws none; taking it posts the message with an increasing sequence and submits nothing; a redrawn offer replaces the rows rather than appending.

- [ ] 3_4 Prove the section fills from a real repository through the shipped wiring
  - **Deps**: 3_3
  - **Refs**: specs/worktree-panel/spec.md#{a-repository-is-read-through-whichever-provisioning-file-it-already-keeps, a-source-that-did-not-supply-the-offer-stays-visible-and-selectable}
  - **Acceptance**:
    - Outcome: An orca-only repo draws its rows in the real dialog, and a switch redraws them
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Extend `src/extension.worktreeAssembly.test.ts` with a walk that writes `orca.yaml` and `.worktreeinclude` into the assembly's real repository, opens the create form, and asserts the bring-box rows and their source badges.
    2. Extend `src/extension.worktreeAssembly.test.ts` with a second walk where the repository carries both `asimov/worktree.yaml` and `orca.yaml`: assert the asimov rows plus exactly one inactive-provider row, then take the switch and assert the orca rows replace them with no create issued.
  - **Boundary**: no fake may stand in for the host, the router or the dialog — this task exists because module tests cannot see the entry point

- [x] 3_5 Prove the read path holds no way to run or write anything — verified: pnpm exec vitest run 'src/worktree/provisioning/readOnly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md § Obligation ledger
  - **Acceptance**:
    - Outcome: A forbidden import in a read-path module fails the suite
    - Verify: unit src/worktree/provisioning/readOnly.test.ts
  - **Plan**:
    1. Create `src/worktree/provisioning/readOnly.test.ts` reading the sources of `providerKit.ts`, `asimovProvider.ts`, `orcaProvider.ts`, `vscodeTasksProvider.ts` and `readProvisioning.ts` and asserting none imports `node:child_process`, `node:worker_threads`, or a write, rename, unlink or rmdir member of `node:fs`.
    2. In `src/worktree/provisioning/readOnly.test.ts`, assert the check is not vacuous by running the same matcher over a fixture string containing each forbidden import and observing it match.
