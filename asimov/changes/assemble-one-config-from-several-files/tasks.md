# Tasks: assemble-one-config-from-several-files

## 1. One owner, one seam

- [x] 1_1 Give the four inline keys a single reader — verified: pnpm exec vitest run 'src/worktree/provisioning/oneOwner.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md#d7-one-owner-for-the-four-inline-keys
  - **Acceptance**:
    - Outcome: A second module mapping `copy`/`link`/`setup`/`ports` fails the suite
    - Verify: unit src/worktree/provisioning/oneOwner.test.ts
  - **Plan**:
    1. Move the `copy`/`link`/`ports`/`setup` mapping out of `src/worktree/provisioning/asimovProvider.ts` into `src/worktree/provisioning/providerKit.ts` as one reader over an already-parsed record, taking its known-key set from the caller.
    2. In `src/worktree/provisioning/providerKit.ts`, source every row AND every problem from `draft.ctx` rather than a literal file name, so the reader stamps whoever called it.
    3. Rewrite `src/worktree/provisioning/asimovProvider.ts` to call it, leaving only what is true of that provider: its file, its keys, and its YAML parse.
    4. Extend `src/worktree/provisioning/oneOwner.test.ts` with a structural assertion that one module maps these keys, and run the matcher over a violating fixture so a typo cannot pass.
    5. Confirm the matcher fails against the pre-extraction source before committing — an extraction emits identical output, so a green suite proves nothing on its own.
  - **Boundary**: behaviour-preserving — the asimov suite is the regression half and must pass unedited

- [ ] 1_2 Let an adapter answer with more than a model
  - **Deps**: 1_1
  - **Refs**: design.md#d1-read-answers-a-record-not-a-model
  - **Acceptance**:
    - Outcome: A declared base travels out of one read, from one open of the file
    - Verify: unit src/worktree/provisioning/providerKit.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/providerKit.ts`, widen `ProviderAdapter.read` to answer `AdapterRead | null` carrying the model plus an optional `extends` target and exclusion list.
    2. Update `src/worktree/provisioning/asimovProvider.ts`, `src/worktree/provisioning/orcaProvider.ts` and `src/worktree/provisioning/vscodeTasksProvider.ts` to the widened shape, each answering the model alone.
    3. Update `src/worktree/provisioning/readProvisioning.ts` to take the model from the record, leaving detection and the `providers[]` rows unchanged.
    4. Update `src/worktree/provisioning/orcaProvider.test.ts` and `src/worktree/provisioning/vscodeTasksProvider.test.ts`, which call `read()` and use its result as a model, to unwrap it — declare the suite change, the return type moved.
    5. Assert in `src/worktree/provisioning/providerKit.test.ts` that a declared `extends` target travels from one read, counting opens of the file.
  - **Boundary**: no detection or merge behaviour changes in this task — every existing assertion keeps its meaning, only the unwrapping moves

## 2. The native file and the merge

- [ ] 2_1 Read `.vscode/worktree.json` into a model
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-repository-can-build-on-a-source-instead-of-replacing-it, one-unreadable-part-never-discards-the-rest-of-a-configuration}
  - **Acceptance**:
    - Outcome: The native file's inline keys, `extends` target and exclusions are read from one open
    - Verify: unit src/worktree/provisioning/nativeProvider.test.ts
  - **Plan**:
    1. Create `src/worktree/provisioning/nativeProvider.ts` parsing the file with the installed JSONC parser on the terms § 3.4 states, reading the four inline keys through 1_1's reader and answering the `extends` target and exclusion list alongside the model.
    2. In `src/worktree/provisioning/nativeProvider.ts`, report an unread key and a malformed file as distinct problems, neither discarding the rest of the file.
    3. Create `src/worktree/provisioning/nativeProvider.test.ts` covering the four keys, an unread key, a malformed file, an absent file and an unreadable one.
    4. Add the new module to `src/worktree/provisioning/readOnly.test.ts`'s read-path list, whose completeness check fails until it is named.
  - **Boundary**: this task resolves no base and merges nothing — it reads one file

- [ ] 2_2 Assemble one model from the native file and the base it names
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{exactly-one-detected-source-supplies-the-offer, the-repository-s-own-declaration-wins-the-path-it-shares, a-path-the-repository-removed-is-shown-as-deliberate, setup-commands-from-two-sources-run-as-both-files-wrote-them}; design.md#{d2-extends-resolves-by-file-membership-not-by-provider-name, d3-the-native-rows-are-built-first-and-assembled-second, d4-active-marks-every-provider-that-contributed, d5-prefer-names-the-model-to-show-and-skips-the-native-file}
  - **Acceptance**:
    - Outcome: One merged list, each row keeping its source, native winning its path, setup unreordered
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. Put the native adapter at the front of `DETECTION_ORDER` in `src/worktree/provisioning/readProvisioning.ts`, resolving an `extends` target only among the framework adapters, only when the named file is itself present, and only inside the repository through the kit's existing containment check.
    2. In `src/worktree/provisioning/readProvisioning.ts`, build the native draft before the base draft on the one shared budget, then assemble in the order § 4.2 states, dedupe by path with the native entry winning its mode, and move excluded paths to `excluded` keeping their original source.
    3. In `src/worktree/provisioning/readProvisioning.ts`, report an exclusion that matches an inline entry without removing the row, and a base that resolves to nothing as its own problem while still offering the inline keys.
    4. In `src/worktree/provisioning/readProvisioning.ts`, mark the native file and the base it named active and every other detected file inactive; let a preferred FRAMEWORK answer alone while a preferred native takes its ordinary path, `extends` and all.
    5. Extend `src/worktree/provisioning/readProvisioning.test.ts` with the ledger's witnesses, including the starvation case, the documented zero-row case where the native file's own overlap falls past the cap, and a target naming the native file itself.
  - **Boundary**: no new containment implementation — `rg -n 'function isPathInside' src/` must find nothing outside the two modules that already define it

- [ ] 2_3 Report every failure state distinctly, and keep Create available
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#one-unreadable-part-never-discards-the-rest-of-a-configuration; design.md#{d9-every-problem-is-charged-to-the-budget-including-the-ones-on-an-early-return, d10-base-native-and-exclude-all-naming-one-path}
  - **Acceptance**:
    - Outcome: Malformed, unread key and missing target each report distinctly and keep the rest
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. Route the early-return problem paths in `src/worktree/provisioning/asimovProvider.ts` and `src/worktree/provisioning/nativeProvider.ts` through the charged reporter, so a problem raised before any row still spends the shared budget.
    2. Assert in `src/worktree/provisioning/readProvisioning.test.ts` that a native draft at the cap plus a malformed inherited file never exceeds the row bound.
    3. Assert in `src/worktree/provisioning/readProvisioning.test.ts` that a malformed file, an unread key and a missing `extends` target report as three distinct reasons, that none discards the rest of its file, and that a missing target still offers the inline keys.
    4. Assert in `src/webview/worktree/WorktreeCreateDialog.test.ts` that Create stays enabled in each of those states.
    5. Assert in `src/worktree/provisioning/readProvisioning.test.ts` the D10 state — one path declared by base and native and excluded — leaves the native row offered, reports the contradiction, and lists nothing in `excluded`.
  - **Boundary**: no new problem reason beyond the four the model already defines

## 3. What the user sees

- [ ] 3_1 Draw an excluded path as deliberate, and keep it out of the totals
  - **Deps**: 2_3
  - **Refs**: specs/worktree-panel/spec.md#a-path-the-repository-removed-is-shown-as-deliberate; design.md#d6-nothing-is-built-to-expand-because-there-is-nothing-collapsed
  - **Acceptance**:
    - Outcome: An excluded path is shown as deliberate, names its original file, and is not counted
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, render each excluded path as its own unselectable row marked deliberate, naming the file that originally declared it.
    2. In `src/webview/worktree/WorktreeCreateDialog.ts`, keep excluded paths out of the section's summary counts and out of the submitted selection.
    3. Extend `src/webview/worktree/WorktreeCreateDialog.test.ts` with a model carrying both offered and excluded paths, asserting the count and that no excluded id can be submitted.
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and may not be edited

- [ ] 3_2 Prove the merge fills the section through the shipped wiring
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#a-repository-can-build-on-a-source-instead-of-replacing-it
  - **Acceptance**:
    - Outcome: A real repository carrying both files draws one merged, attributed list in the dialog
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Extend `src/extension.worktreeAssembly.test.ts` with a walk writing a native file that extends a framework file, opening the create form, and asserting the merged rows, their source badges, the winning mode on a shared path, and the excluded row.
    2. In that walk, clear every provider file first — the suite's repository outlives a test, and a leftover decides detection silently.
  - **Boundary**: no fake may stand in for the host, the router or the dialog
