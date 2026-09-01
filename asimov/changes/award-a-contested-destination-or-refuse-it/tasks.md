# Tasks: award-a-contested-destination-or-refuse-it

## 1. One orchestration that can be tested

- [x] 1_1 Move the apply's ordering and iteration out of the extension entry point — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: design.md#d5-one-orchestration-out-of-the-extension-entry-point, specs/worktree-panel/spec.md#the-material-a-worktree-was-promised-is-actually-put-there
  - **Acceptance**:
    - Outcome: The same models produce the same steps in the same order, from a function a test can call
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. Add `src/worktree/provisioning/applyProvisioning.ts` holding the copy-before-link ordering and the per-entry loop that `src/extension.ts` runs inline today, calling `applyEntry` unchanged. The lambda in `src/extension.ts` keeps building roots, budget and deps and calls it.
    2. Add `src/worktree/provisioning/applyProvisioning.test.ts` with the ordering witness the closure never had, reusing the fake in `src/worktree/provisioning/applyEntries.fake.ts`.
    3. List the new module on the mutating side of `src/worktree/provisioning/readOnly.test.ts`.

## 2. The contested destination

- [x] 2_1 Award a contested destination to the repository's own declaration — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d1-contested-groups-are-recomputed-from-the-selected-entries-not-carried-on-the-wire, design.md#d2-the-favoured-member-claims-first-copy-before-link-yields-inside-the-group-only, design.md#d3-what-was-already-there-is-observed-before-anything-is-written, design.md#d4-the-adjudication, specs/worktree-panel/spec.md#a-destination-two-declarations-may-both-name-is-held-by-the-repository-s-own
  - **Acceptance**:
    - Outcome: The favoured declaration's material and mode hold a contested destination
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. Recompute the contested groups over the selected entries in `src/worktree/provisioning/applyProvisioning.ts`, take the D3 reading before the ordered pass, and hold every non-favoured member out of its own pass.
    2. Settle each held member against D4's table after the ordered pass ends.
    3. Witness all four rows in `src/worktree/provisioning/applyProvisioning.test.ts`, including the one where the volume keeps the two spellings apart and both land. `src/worktree/provisioning/applyEntries.fake.ts` gains whatever the fake needs to hold two spellings that fold together.

- [x] 2_2 Refuse a collision this apply cannot attribute to its own write — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: design.md#d4-the-adjudication, specs/worktree-panel/spec.md#a-collision-the-extension-cannot-attribute-to-its-own-write-is-refused
  - **Acceptance**:
    - Outcome: An unattributable collision refuses both declarations by name and writes nothing
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. Both refusal rows in `src/worktree/provisioning/applyProvisioning.ts` name the favoured declaration's path and declaring file alongside the refused member's own.
    2. Witness in `src/worktree/provisioning/applyProvisioning.test.ts` that a pre-existing directory destination stops the loser's walk instead of merging into it, and that the fake records no write for either declaration.

## 3. The link that would point at itself

- [x] 3_1 Refuse a recreated symlink whose target folds onto its own name — verified: pnpm exec vitest run 'src/worktree/provisioning/applyEntries.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: design.md#d6-a-recreated-symlink-that-folds-onto-its-own-name-is-refused, specs/worktree-panel/spec.md#a-symlink-that-would-resolve-to-itself-is-never-created
  - **Acceptance**:
    - Outcome: A symlink that would resolve to itself is refused with that reason
    - Verify: unit src/worktree/provisioning/applyEntries.test.ts
  - **Plan**:
    1. In `copyLink` in `src/worktree/provisioning/applyEntries.ts`, refuse when the target resolved against the link's own directory is exactly the link's own destination.
    2. Witness both directions in `src/worktree/provisioning/applyEntries.test.ts`, including that a case-distinct in-repo link is still recreated — refusing on the folding key would destroy material to prevent a loop the volume cannot have.

## 4. Round-1 blockers

- [ ] 4_1 Establish absence before writing, and read it twice
  - **Deps**: 2_2
  - **Refs**: design.md#d3-absence-is-observed-twice-and-only-enoent-establishes-it, design.md#d4-the-adjudication, .reviews/round-1.md#f001, .reviews/round-1.md#f002
  - **Acceptance**:
    - Outcome: A contest refuses unless every member's destination is proven absent at its own turn
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/applyProvisioning.ts`, replace the boolean reading with D3's four states, and take the second reading immediately before the favoured member's ordinary turn.
    2. Witness in `src/worktree/provisioning/applyProvisioning.test.ts` that an uncontested copy creating the favoured directory first refuses the contest instead of merging into it, and that an `lstat` failure that is not `ENOENT` refuses rather than authorizing the write. `src/worktree/provisioning/applyEntries.fake.ts` gains whatever the failing-`lstat` case needs.

- [ ] 4_2 Answer in the order the answers were produced
  - **Deps**: 4_1
  - **Refs**: design.md#d5-one-orchestration-out-of-the-extension-entry-point, .reviews/round-1.md#f003
  - **Acceptance**:
    - Outcome: The steps come back in execution order, as the closure returned them
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyProvisioning.ts` returns results in the order they were produced, and `src/worktree/provisioning/applyProvisioning.test.ts` replaces the arrival-order assertion that codified the regression.

- [ ] 4_3 Say who is contesting, and claim nothing about who created what
  - **Deps**: 4_2
  - **Refs**: design.md#d4a-every-refusal-names-every-member-by-path-and-declaring-file, .reviews/round-1.md#f004
  - **Acceptance**:
    - Outcome: Every refusal names every member by path and declaring file, its own included
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. Each refusal reason in `src/worktree/provisioning/applyProvisioning.ts` names the whole contest, and the appeared-during-the-apply reason says creation cannot be attributed rather than naming a non-creator.
    2. `src/worktree/provisioning/applyProvisioning.test.ts` asserts the refused member's own spelling and source appear in its own row.
