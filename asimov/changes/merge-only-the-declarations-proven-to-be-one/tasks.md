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

- [x] 1_2 Report an exclusion that matched nothing — verified: pnpm exec vitest run 'src/worktree/provisioning/readProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 2_1 Group declarations that may name one destination, and say which one wins — verified: pnpm exec vitest run 'src/worktree/provisioning/readProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md#d3-a-contender-group-offered-in-full, design.md#d4-detecting-a-contender-is-allowed-to-be-wrong-in-one-direction, specs/worktree-panel/spec.md#declarations-that-may-name-one-destination-are-offered-together-favouring-the-repository-s-own
  - **Acceptance**:
    - Outcome: Foldable spellings travel as one group naming the native declaration as favoured
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. Add the contender relation to `ProvisionModel` in `src/types/messages.ts` as a list of groups, each naming its member ids and an OPTIONAL favoured id — ids only, so the wire carries no second copy of a path. `emptyModel` and `modelFromDraft` in `src/worktree/provisioning/providerKit.ts` answer the field too, so a reader never has to defend against its absence. Widening a required field reaches every literal that builds one: `src/webview/worktree/worktreeFixtures.ts`, `src/providers/WorktreeHost.actions.test.ts` and `src/worktree/provisioning/offerStore.test.ts` all construct models and answer the field with an empty list — collateral of the widening, not behaviour.
    2. In `src/worktree/provisioning/readProvisioning.ts`, build the groups after the merge from a generous detector: ASCII case folding unioned with Unicode case folding over the normalized spelling. Never use it to merge.
    3. Favour the native member only when there is exactly one; a group with none, or with several, carries no favoured id and is still a group, because WT-012.18 still needs the ordering. Groups are connected components, so three spellings of one name are one group, not three pairs.
    4. In `src/worktree/provisioning/offerStore.ts`, rewrite group member and favoured ids inside `remint()` alongside the entries it already remints — a group naming pre-remint ids points at ids nobody holds, which is silent and total.
    5. Assert group construction for native+inherited, inherited+inherited, native+native, and a three-member component (`Straße`/`STRASSE`/`strasse`).
    6. Assert redemption at the offer-store layer, not in `readProvisioning.test.ts` — that suite cannot see an id redeem, so asserting there would prove the wrong layer. The failure guarded is withholding a row, the alternative D3 rejected.
  - **Boundary**: the group is advisory ordering data only; no code path may merge, drop or reorder an entry on the strength of membership in this change

- [x] 2_2 Draw the pair so it reads as deliberate — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 3_1 Fail the suite if identity ever reads the filesystem again — verified: pnpm exec vitest run 'src/worktree/provisioning/oneOwner.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: design.md#obligation-ledger
  - **Acceptance**:
    - Outcome: An identity path that reaches a dep hook fails the suite
    - Verify: unit src/worktree/provisioning/oneOwner.test.ts
  - **Plan**:
    1. Extend `src/worktree/provisioning/oneOwner.test.ts` with a matcher over `readProvisioning.ts` asserting that the identity and exclusion helpers reach no dep hook — REACHABILITY, not naming. A helper that calls `inspect()` which calls `deps.realpath()` defeats a lexical match on the helper alone, and that is exactly the shape the seventh mechanism will have.
    2. Run it against two fixtures and confirm both fail: one that calls `deps.realpath` directly, and one that reaches it through a second helper.

## 4. Round-1 blockers

- [x] 4_1 Mint identity once per read, fold per segment, and group on every branch — verified: pnpm exec vitest run 'src/worktree/provisioning/readProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md#d7-a-row-s-identity-is-minted-once-per-read-not-once-per-adapter, design.md#d8-folding-is-generous-per-segment-and-lowercase-is-not-folding, design.md#d4-detecting-a-contender-is-allowed-to-be-wrong-in-one-direction
  - **Acceptance**:
    - Outcome: Every pair a supported filesystem folds shares a group whose members are distinct rows
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. Thread the id sequence through the read on the object that already carries the budget, in `src/worktree/provisioning/providerKit.ts`. Every adapter takes its ids from there instead of calling `ids()` for itself: `src/worktree/provisioning/asimovProvider.ts`, `src/worktree/provisioning/orcaProvider.ts`, `src/worktree/provisioning/vscodeTasksProvider.ts`, `src/worktree/provisioning/nativeProvider.ts`.
    2. In `src/worktree/provisioning/readProvisioning.ts`, build the fold key per path segment rather than over the whole path, and fold with `NFKC` plus lowercasing plus the multi-character expansions lowercasing cannot reach. `src/worktree/provisioning/entryGate.ts` computes the Win32 segment rule already — take the shared primitive from one owner rather than growing a second, since `src/worktree/provisioning/oneOwner.test.ts` is there to catch exactly that.
    3. Still in `src/worktree/provisioning/readProvisioning.ts`, compute the groups on every branch that returns a model, not only through `assemble` — a framework winner and a switched provider return their adapter's model directly and today carry an empty list.
    4. RED first, and prove it on this lane: `Straße`/`STRASSE`, `ﬀ`/`ff`, a dotted non-final segment, a framework-winner model, and a base row against a native row that both minted `i1`.
  - **Boundary**: the group stays advisory — no code path may merge, drop or reorder an entry on the strength of membership

- [x] 4_2 Say how many rows a group holds, not that it holds two — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md#d3-a-contender-group-offered-in-full
  - **Acceptance**:
    - Outcome: A three-spelling group is not summarised as a pair
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Derive the summary clause from each group's member count in `src/webview/worktree/WorktreeCreateDialog.ts`; the counts before it are rows OFFERED and stay as they are.
    2. Assert it against the three-member fixture the suite already builds, which is the case that was never asserted.
  - **Boundary**: no CSS file under `docs/ui/` is touched — both are owned by an external design pass

- [x] 4_3 Catch a filesystem reach in any callable shape, not only a top-level function — verified: pnpm exec vitest run 'src/worktree/provisioning/oneOwner.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md#obligation-ledger
  - **Acceptance**:
    - Outcome: An identity helper written as an arrow function reaching a dep hook fails the suite
    - Verify: unit src/worktree/provisioning/oneOwner.test.ts
  - **Plan**:
    1. Walk the TypeScript AST in `src/worktree/provisioning/oneOwner.test.ts` instead of matching `function` at the left margin — arrow functions, methods and imported helpers are ordinary shapes and the gate must see all of them. `src/test/invariants/fsDeletionGate.ts` already drives a TypeScript Program for the same kind of check; reuse it rather than growing a second traversal.
    2. Prove RED on each shape the current gate misses, not only on the one it catches.

## 5. Round-3 blockers

- [x] 5_1 Uppercase last, and gate the fold against the whole case-varying range — verified: pnpm exec vitest run 'src/worktree/provisioning/readProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: design.md#d9-the-fold-key-uppercases-last-and-the-union-was-wrong
  - **Acceptance**:
    - Outcome: Every pair reachable through Unicode casing shares one fold key
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/readProvisioning.ts`, replace the character stage of `foldable` with `NFKC` → `toLowerCase` → `foldWin32Name` → `toUpperCase` → `NFKC`, still per segment. Delete the explicit expansion list — it is what the uppercase step replaces, and leaving it would hide which stage is doing the work.
    2. Gate it over the whole range rather than another curated list: scan every code point below `U+30000` whose case differs from itself and assert the key is equal for the character, its lowercase and its uppercase. A curated list is what let round 3's class through twice.
    3. Assert both load-bearing orderings so neither is tidied away later: dropping the final `NFKC` must fail, and so must uppercasing before lowercasing.
    4. Keep the direct witnesses that were verified against the real volume: `σ`/`ς`, `ß`/`ss`, `ᾳ`/`αι`, and the round-1 three.
  - **Boundary**: no `Intl.Collator` and no new dependency — D9 rejects both, and grouping stays key equality rather than a relation

- [x] 5_2 Give every exported model constructor the same contender semantics — verified: pnpm exec vitest run 'src/worktree/provisioning/asimovProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: design.md#d3-a-contender-group-offered-in-full
  - **Acceptance**:
    - Outcome: A directly-read model groups its foldable spellings like the offered one
    - Verify: unit src/worktree/provisioning/asimovProvider.test.ts
  - **Plan**:
    1. `readAsimovProvisioning` in `src/worktree/provisioning/asimovProvider.ts` returns `modelFromDraft()`, whose `contenders` is always empty. Only tests call it today, so this is a trap for the next caller rather than a live defect — finalize contenders there too rather than leaving two meanings of `ProvisionModel`.
    2. Put the finalization where both callers reach it instead of copying it, so `oneOwner.test.ts` has nothing new to catch: `foldSegment` and the grouping move from `src/worktree/provisioning/readProvisioning.ts` into `src/worktree/provisioning/providerKit.ts`, and `modelFromDraft` fills the field so every adapter's model carries it. `src/worktree/provisioning/readProvisioning.test.ts` and `src/worktree/provisioning/oneOwner.test.ts` follow the move.

- [x] 5_3 Make the identity gate refuse what it cannot see — verified: pnpm exec vitest run 'src/worktree/provisioning/oneOwner.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: design.md#obligation-ledger
  - **Acceptance**:
    - Outcome: An identity helper imported from another module fails the gate
    - Verify: unit src/worktree/provisioning/oneOwner.test.ts
  - **Plan**:
    1. The walk in `src/worktree/provisioning/oneOwner.test.ts` parses one file and indexes callables by unqualified name, so an imported helper calling `realpathSync` is never traversed. Two rewrites have each closed the shapes the previous round named and left a wider one, so stop chasing shapes: assert a closed boundary instead. Every name the identity closure reaches must be either a local callable or an import from a declared pure module, and anything else fails.
    2. Prove RED with an imported helper that reaches the filesystem — the shape neither previous version could see.
    3. `src/worktree/provisioning/readProvisioning.ts` keeps the imports 5_2 left behind: `path` and `ProvisionContenders` are unused there now, and the lint gate is a count. `src/worktree/provisioning/providerKit.ts` and `src/worktree/provisioning/readProvisioning.test.ts` carry the same residue (one signature the formatter joins, one import the mover split in two), and so does `src/worktree/provisioning/asimovProvider.test.ts`.
