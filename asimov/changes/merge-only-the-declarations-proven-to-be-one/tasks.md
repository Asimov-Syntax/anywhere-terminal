# Tasks: merge-only-the-declarations-proven-to-be-one

## 1. Identity stops guessing

- [ ] 1_1 Merge only spellings that are equal, and prove nothing is asked of the filesystem
  - **Deps**: none
  - **Refs**: design.md#d1-the-read-path-stops-trying-to-prove-it, specs/worktree-panel/spec.md#{a-repository-s-own-declaration-wins-the-path-it-shares, the-extension-never-asks-a-filesystem-which-spellings-are-one-file}
  - **Acceptance**:
    - Outcome: Only equal spellings merge, and no declared path reaches the filesystem
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/readProvisioning.ts`, drop the platform fold from `identityOf` so the key is the normalized spelling and nothing else; remove the now-unused `platformFoldsFilenameCase` import.
    2. Leave `platformFoldsFilenameCase` in `src/worktree/provisioning/providerKit.ts` — `entryGate.ts` still owns a legitimate use of it for the lockfile refusal, and deleting it would be a second change to a rule this task is not touching.
    3. Extend `src/worktree/provisioning/readProvisioning.test.ts` with an instrumented `ProviderDeps` that records every path handed to every hook, and assert the recorded list holds nothing that came from a declared path or an `exclude` spelling.
    4. Assert the declaration count is conserved across `entries` + `excluded` for the pairs the fold used to collapse: `İ`/`i̇`, `ẞ`/`ß`, `Ϗ`/`ϗ`, and `mixedcase`/`MixedCase`.
    5. Confirm the count assertion FAILS against the pre-change `toLowerCase` identity before committing — on Windows semantics it collapsed those pairs, and a test that passes either way proves nothing.
  - **Boundary**: no change to what a row displays or to its `source` — § 4.3 forbids rewriting either

- [ ] 1_2 Report an exclusion that matched nothing
  - **Deps**: 1_1
  - **Refs**: design.md#d5-exclude-matches-on-d1s-rule, specs/worktree-panel/spec.md#an-exclusion-matches-on-the-same-rule-the-merge-uses
  - **Acceptance**:
    - Outcome: An `exclude` that removed nothing is reported by name
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/readProvisioning.ts`, have `applyExclude` record which exclusion spellings matched at least one entry.
    2. Report each unmatched spelling through the existing problem channel, charged to the shared budget like every other problem, naming the path it did not match.
    3. Assert a differently-cased `exclude` leaves the entry offered AND produces the report — both halves, since either alone is the old silent behaviour with extra noise.

## 2. A pair that may be one destination

- [ ] 2_1 Group declarations that may name one destination, and say which one wins
  - **Deps**: 1_2
  - **Refs**: design.md#d3-a-contender-group-offered-in-full, design.md#d4-detecting-a-contender-is-allowed-to-be-wrong-in-one-direction, specs/worktree-panel/spec.md#declarations-that-may-name-one-destination-are-offered-together-favouring-the-repository-s-own
  - **Acceptance**:
    - Outcome: Foldable spellings travel as one group naming the native declaration as favoured
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. Add the contender relation to `ProvisionModel` in `src/types/messages.ts` as a list of groups, each naming its member ids and the favoured id — ids only, so the wire carries no second copy of a path.
    2. In `src/worktree/provisioning/readProvisioning.ts`, build the groups after the merge from a generous detector: ASCII case folding unioned with Unicode case folding over the normalized spelling. Never use it to merge.
    3. Favour the native member; a group with no native member has no favoured id and is still a group, because WT-012.18 still needs the ordering.
    4. Assert group construction for native+inherited, inherited+inherited and native+native.
    5. Assert both members receive offer ids and both appear in the offer — the failure this guards is withholding a row, which was the rejected alternative in D3.
  - **Boundary**: the group is advisory ordering data only; no code path may merge, drop or reorder an entry on the strength of membership in this change

- [ ] 2_2 Draw the pair so it reads as deliberate
  - **Deps**: 2_1
  - **Refs**: design.md#d6-reuse-the-row-that-is-already-drawn-but-not-offered
  - **Acceptance**:
    - Outcome: Both rows of a group are drawn, each keeping its own checkbox
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Carry the group through `bringRows` in `src/webview/worktree/WorktreeCreateDialog.ts` as a marker on the rows it names, keeping `checked` as it is — this is not `excluded`, which drops the checkbox.
    2. Render the note through the existing row-meta path rather than a new element, so `wt-brow` keeps one rendering owner.
    3. Assert both rows carry a checkbox, and that the section's summary counts both — a group is two offers until the filesystem says otherwise.
  - **Boundary**: no CSS file under `docs/ui/` is touched — both are owned by an external design pass

## 3. The gate that keeps it true

- [ ] 3_1 Fail the suite if identity ever reads the filesystem again
  - **Deps**: 2_1
  - **Refs**: design.md#obligation-ledger
  - **Acceptance**:
    - Outcome: An identity path that reaches a dep hook fails the suite
    - Verify: unit src/worktree/provisioning/oneOwner.test.ts
  - **Plan**:
    1. Extend `src/worktree/provisioning/oneOwner.test.ts` with a matcher over `readProvisioning.ts` asserting that the identity and exclusion helpers name no dep hook.
    2. Run the matcher against a fixture that reintroduces a `realpath` call and confirm it fails — six mechanisms died here, and the next one will arrive as an innocent-looking helper.
