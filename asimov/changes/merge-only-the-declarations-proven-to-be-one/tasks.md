# Tasks: merge-only-the-declarations-proven-to-be-one

## 1. Identity stops guessing

- [x] 1_1 Merge only spellings that are equal, and prove nothing is asked of the filesystem — verified: pnpm exec vitest run 'src/worktree/provisioning/readProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md#d1-the-read-path-stops-trying-to-prove-it, specs/worktree-panel/spec.md#{two-declarations-are-one-path-only-when-they-are-spelled-alike, the-extension-never-asks-a-filesystem-which-spellings-are-one-file}
  - **Acceptance**:
    - Outcome: Only equal spellings merge, and no declared path reaches the filesystem
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/readProvisioning.ts`, drop the platform fold from `identityOf` so the key is the normalized spelling and nothing else; remove the now-unused `platformFoldsFilenameCase` import.
    2. Rename `platformFoldsFilenameCase` in `src/worktree/provisioning/providerKit.ts` to name what its ONE remaining caller actually asks it — `entryGate.ts` lowercases unconditionally and uses this flag only for Win32 trailing dots, spaces and `::$DATA`, so "folds filename case" stops being true the moment this task lands. Update its one caller in `src/worktree/provisioning/entryGate.ts`. Behaviour unchanged; the name and its comment are the change.
    3. Extend `src/worktree/provisioning/readProvisioning.test.ts` with an instrumented `ProviderDeps` that records every path handed to every hook, and assert the recorded list holds nothing that came from a declared path or an `exclude` spelling.
    4. Assert the declaration count is conserved across `entries` + `excluded` for the pairs the fold used to collapse: `İ`/`i̇`, `ẞ`/`ß`, `Ϗ`/`ϗ`, `mixedcase`/`MixedCase` and `foo`/`foo.`.
    5. The RED step must INJECT Win32 semantics: the old fold only fired when `path.sep === "\\"`, so on this darwin lane the count assertion passes against the pre-change code and proves nothing. Drive the identity through an injected platform flag, and confirm the assertion fails with that flag set before committing.
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
    1. Add the contender relation to `ProvisionModel` in `src/types/messages.ts` as a list of groups, each naming its member ids and an OPTIONAL favoured id — ids only, so the wire carries no second copy of a path.
    2. In `src/worktree/provisioning/readProvisioning.ts`, build the groups after the merge from a generous detector: ASCII case folding unioned with Unicode case folding over the normalized spelling. Never use it to merge.
    3. Favour the native member only when there is exactly one; a group with none, or with several, carries no favoured id and is still a group, because WT-012.18 still needs the ordering. Groups are connected components, so three spellings of one name are one group, not three pairs.
    4. In `src/worktree/provisioning/offerStore.ts`, rewrite group member and favoured ids inside `remint()` alongside the entries it already remints — a group naming pre-remint ids points at ids nobody holds, which is silent and total.
    5. Assert group construction for native+inherited, inherited+inherited, native+native, and a three-member component (`Straße`/`STRASSE`/`strasse`).
    6. Assert redemption at the offer-store layer, not in `readProvisioning.test.ts` — that suite cannot see an id redeem, so asserting there would prove the wrong layer. The failure guarded is withholding a row, the alternative D3 rejected.
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
    3. Assert both rows carry a checkbox. `bringSummary` says what the section WILL do and composes its count before anything is applied, so for a group it must not promise both — say what is offered, not what will land.
  - **Boundary**: no CSS file under `docs/ui/` is touched — both are owned by an external design pass

## 3. The gate that keeps it true

- [ ] 3_1 Fail the suite if identity ever reads the filesystem again
  - **Deps**: 2_1
  - **Refs**: design.md#obligation-ledger
  - **Acceptance**:
    - Outcome: An identity path that reaches a dep hook fails the suite
    - Verify: unit src/worktree/provisioning/oneOwner.test.ts
  - **Plan**:
    1. Extend `src/worktree/provisioning/oneOwner.test.ts` with a matcher over `readProvisioning.ts` asserting that the identity and exclusion helpers reach no dep hook — REACHABILITY, not naming. A helper that calls `inspect()` which calls `deps.realpath()` defeats a lexical match on the helper alone, and that is exactly the shape the seventh mechanism will have.
    2. Run it against two fixtures and confirm both fail: one that calls `deps.realpath` directly, and one that reaches it through a second helper.
