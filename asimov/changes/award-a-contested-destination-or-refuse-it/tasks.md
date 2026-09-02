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
    3. Witness every row of D4's table in `src/worktree/provisioning/applyProvisioning.test.ts`, including the one where the volume keeps the two spellings apart — where the held member is refused too, since that reading cannot be told from the favoured member's object having been removed (superseded by 5_2). `src/worktree/provisioning/applyEntries.fake.ts` gains whatever the fake needs to hold two spellings that fold together.

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

- [x] 4_1 Establish absence before writing, and read it twice — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: design.md#d3-absence-is-observed-twice-and-only-enoent-establishes-it, design.md#d4-the-adjudication, .reviews/round-1.md#f001, .reviews/round-1.md#f002
  - **Acceptance**:
    - Outcome: A contest refuses unless every member's destination is proven absent at its own turn
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/applyProvisioning.ts`, replace the boolean reading with D3's four states, and take the second reading immediately before the favoured member's ordinary turn.
    2. Witness in `src/worktree/provisioning/applyProvisioning.test.ts` that an uncontested copy creating the favoured directory first refuses the contest instead of merging into it, and that an `lstat` failure that is not `ENOENT` refuses rather than authorizing the write. `src/worktree/provisioning/applyEntries.fake.ts` gains whatever the failing-`lstat` case needs.

- [x] 4_2 Answer in the order the answers were produced — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md#d5-one-orchestration-out-of-the-extension-entry-point, .reviews/round-1.md#f003
  - **Acceptance**:
    - Outcome: The steps come back in execution order, as the closure returned them
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyProvisioning.ts` returns results in the order they were produced, and `src/worktree/provisioning/applyProvisioning.test.ts` replaces the arrival-order assertion that codified the regression.

- [x] 4_3 Say who is contesting, and claim nothing about who created what — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: design.md#d4a-every-refusal-identifies-every-member-by-path-and-declaring-file, .reviews/round-1.md#f004
  - **Acceptance**:
    - Outcome: Every refusal names every member by path and declaring file, its own included
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. Each refusal in `src/worktree/provisioning/applyProvisioning.ts` identifies the whole contest — since `carry-a-contest-membership-once` that is the step's `contest` index against one membership per contest, not the membership repeated in the reason text — and the appeared-during-the-apply reason says creation cannot be attributed rather than naming a non-creator.
    2. `src/worktree/provisioning/applyProvisioning.test.ts` resolves the membership through the step's own index and asserts the refused member's own spelling and source are in it.

## 5. Round-2 blockers

- [x] 5_1 Claim a contested top-level destination exclusively, or refuse it — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_3
  - **Refs**: design.md#d3-absence-is-observed-twice-and-only-enoent-establishes-it, .reviews/round-2.md#f001
  - **Acceptance**:
    - Outcome: A contested favoured entry that finds its top-level destination already there refuses the contest
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts` reports a top-level destination that already existed distinctly from one this apply created, without changing what an uncontested entry does.
    2. `src/worktree/provisioning/applyProvisioning.ts` turns that answer into a refusal of the whole contest.
    3. `src/worktree/provisioning/applyProvisioning.test.ts` witnesses it with a fake that creates the destination between the second reading and the write, and `src/worktree/provisioning/applyEntries.test.ts` witnesses that an uncontested directory still merges.

- [x] 5_2 Refuse every held member once the favoured one has run — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: design.md#d4-the-adjudication, .reviews/round-2.md#f005
  - **Acceptance**:
    - Outcome: No held member is ever written after the favoured member ran, whatever its own destination reads
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyProvisioning.ts` settles every held member as a refusal, dropping the post-claim read that authorized the write.
    2. `src/worktree/provisioning/applyProvisioning.test.ts` replaces the witness that expected the second member to land on a non-folding volume with one asserting it is refused there too, naming both declarations.

- [x] 5_3 Name every member of a contest larger than a pair — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_2
  - **Refs**: design.md#d4a-every-refusal-identifies-every-member-by-path-and-declaring-file, .reviews/round-2.md#f004
  - **Acceptance**:
    - Outcome: Every refusal names every member of its contest, at any cardinality
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. Every deferred refusal in `src/worktree/provisioning/applyProvisioning.ts` points at the whole contest rather than the current member and the favoured one.
    2. `src/worktree/provisioning/applyProvisioning.test.ts` witnesses a three-member contest in which each refusal resolves to all three.

## 6. Round-3 blockers

- [x] 6_1 Report the rule that actually refused a contested entry — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_3
  - **Refs**: design.md#d4b-a-refusal-says-which-rule-refused-and-the-reason-string-is-not-a-channel, .reviews/round-3.md#f006
  - **Acceptance**:
    - Outcome: A contested entry refused by its own rule keeps that rule's reason
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts` reports a lost exclusive claim as its own outcome shape rather than as refusal text.
    2. `src/worktree/provisioning/applyProvisioning.ts` refuses the contest on that shape alone and passes every other refusal through unchanged.
    3. `src/worktree/provisioning/applyProvisioning.test.ts` witnesses a contested entry refused by the material rule keeping its own reason, and `src/worktree/provisioning/applyEntries.test.ts` covers the new shape.

- [x] 6_2 Name the contest in a contested entry's own refusal — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_1
  - **Refs**: design.md#d4a-every-refusal-identifies-every-member-by-path-and-declaring-file, design.md#d4b-a-refusal-says-which-rule-refused-and-the-reason-string-is-not-a-channel, .reviews/round-4.md#f009
  - **Acceptance**:
    - Outcome: A contested entry's own refusal carries its rule and every member of its contest
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyProvisioning.ts` decorates an ordinary refusal from a contested entry with the whole contest's membership instead of storing it unchanged.
    2. `src/worktree/provisioning/applyProvisioning.test.ts` asserts both the rule that fired and every member's path and declaring file in that row.

- [x] 7_1 Close round 5's three integration blockers — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-5.md#f007, .reviews/round-5.md#f008, .reviews/round-5.md#f011
  - **Acceptance**:
    - Outcome: Every contested step carries its contest, on the error path too, and no yielder is counted as arriving
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` excludes a selected yielder from the counts while its favoured member is also selected (F007).
    2. `src/worktree/provisioning/applyProvisioning.ts` exports one builder for "every entry failed for one reason" that recomputes the contests and attaches each member's index (F011).
    3. `src/extension.ts` builds the unreadable-root result through it, and stages its memberships like the ordinary path.
    4. `asimov/changes/award-a-contested-destination-or-refuse-it/design.md` D4a and the ledger describe the shipped representation — local reason, contest index, membership once — not the withdrawn per-reason expansion (F008).
    5. `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/worktree/provisioning/applyProvisioning.test.ts` witness each. The unreadable-root case is witnessed on the builder. (Corrected after round 6 F012: this step originally justified that by claiming `src/extension.worktreeAssembly.test.ts` has no harness that can make `prepareEntryGate` answer `null`. That was false — the neighbouring bring-over case creates the destination precisely because it otherwise does. Task 8_1 adds the missing call-site witness.)

- [x] 8_1 Arm the assembly bypass that F011 came through — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-6.md#f012
  - **Acceptance**:
    - Outcome: Reverting the unreadable-root wiring alone fails an assembly test
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` submits two contested declarations and deliberately does NOT create the destination, so `prepareEntryGate` answers `null` and the create takes the unreadable-root path — the same harness the neighbouring bring-over case uses in reverse.
    2. It asserts both failed rows resolve through ONE contest membership naming every member's path and declaring file, so the wiring is witnessed at the call site rather than only on the builder.
    3. Round 5's Plan step 5 claim that this file has no such harness is corrected in place — it was wrong, not merely optimistic.

## 9. Out-of-band handback — a member's refusal is not a destination reading

- [x] 9_1 Say which kind of refusal the entry gate produced — verified: pnpm exec vitest run 'src/worktree/provisioning/entryGate.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D3a
  - **Acceptance**:
    - Outcome: A refusal reports whether it observed the destination
    - Verify: unit src/worktree/provisioning/entryGate.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/entryGate.ts`, have a refusal carry whether it was reached before or after the filesystem was touched, keeping every existing reason string unchanged.
    2. Witness a name refusal and a material refusal reporting no observation, and a containment refusal reporting one.

- [x] 9_2 Refuse a member for what it is without refusing the contest — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_1
  - **Refs**: design.md D3a, .reviews/round-6.md
  - **Acceptance**:
    - Outcome: An admissible favoured member still claims a destination no reading found present
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/applyProvisioning.ts`, map a refusal that observed nothing to a member-scoped refusal and only a refusal that observed the destination to `inadmissible`.
    2. Witness the OOB-F016 shape: a native copy entry and an inherited link entry contesting one absent destination, where the inherited entry is refused by its own material rule and the native copy is still materialized.
    3. Witness that a containment refusal still refuses the whole contest, so the narrowing did not reopen what D3 closed.

- [x] 9_3 Refuse a group that claims priority twice — verified: pnpm exec vitest run 'src/worktree/provisioning/applyProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_2
  - **Refs**: design.md D3b, .reviews/round-6.md
  - **Acceptance**:
    - Outcome: A group with two native members writes nothing and names every member
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/providerKit.ts`, let a group record that more than one member is the repository's own rather than silently carrying no favoured member.
    1b. In `src/types/messages.ts`, give `ProvisionContenders` the field that records it, beside `favoured`.
    2. In `src/worktree/provisioning/applyProvisioning.ts`, refuse such a group entire instead of letting it fall through to the ordinary pass.
    3. Witness two native spellings plus one inherited: nothing is written, the inherited material is not at the destination, and the refusal names all three by path and declaring file.

## 10. Round-7 handback — the offer asks the apply's question

- [x] 10_1 Carry which members are the repository's own, instead of a winner — verified: pnpm exec vitest run 'src/worktree/provisioning/providerKit.test.ts' && pnpm run check-types && pnpm run test:unit --maxWorkers=4 exit 0
  - **Deps**: none
  - **Refs**: design.md D3c, specs/worktree-panel/spec.md#a-destination-more-than-one-of-the-repository-s-own-declarations-name-is-refused-entire, specs/worktree-panel/spec.md#a-declaration-that-will-yield-is-offered-as-yielding
  - **Acceptance**:
    - Outcome: The offer and the apply decide a contested group by one predicate over the selection each is looking at
    - Verify: unit src/worktree/provisioning/providerKit.test.ts
  - **Plan**:
    1. In `src/types/messages.ts`, replace `ProvisionContenders.favoured` and `priorityClaimedTwice` with the members list D3c names, so no pair of fields can contradict each other. The consumers below cannot compile without it and cannot be landed apart from it, which is why they are one task.
    2. In `src/worktree/provisioning/providerKit.ts`, have `contendersOf` fill it from the same `source` comparison it already makes, and stop computing a winner.
    3. In `src/worktree/provisioning/applyProvisioning.ts`, have `contestsOf` derive the favoured member and the refuse-entire case from it, keeping D3b's and D4's behaviour exactly as the round-7 witnesses pin it.
    4. In `src/worktree/provisioning/offerStore.ts`, translate the new list through `remint` as `members` already is, with the same drop-on-miss, so no group field can be dropped by being rebuilt one key at a time.
    5. In `src/webview/worktree/WorktreeCreateDialog.ts`, replace the winner-based `yieldsTo` with the predicate D3c's table states, read against the selection the dialog currently holds; give the undecidable group its own live note, distinct from the yielder's because no single counterpart rescues the row; and leave every row at the ordinary selected default.
    6. Update the witnesses in `src/worktree/provisioning/offerStore.test.ts`, `src/worktree/provisioning/readProvisioning.test.ts`, `src/worktree/provisioning/asimovProvider.test.ts` and `src/webview/worktree/WorktreeCreateDialog.test.ts` that name the replaced field, declaring the suite change.
    7. Witness in `src/worktree/provisioning/providerKit.test.ts` a group with one repository declaration, one with two, and one with none; and in `src/worktree/provisioning/offerStore.test.ts` that a two-declaration group survives an offer round trip naming the ids the offer issued, with no pre-remint id surviving — carrying the list through untranslated passes every members-only assertion and then reads as no repository declarations at all.

- [ ] 10_4 Record a member's own rule before the contest is settled
  - **Deps**: 10_1
  - **Refs**: design.md D4b, .reviews/round-7.md
  - **Acceptance**:
    - Outcome: A member refused for what it is reports that rule even when a sibling's reading refuses the contest
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/applyProvisioning.ts`, answer the members the gate refused for what they are before the contended reading decides the group, so a refusal that observed nothing cannot be overwritten by one that did.
    2. Witness the REASON on that member's step, not only its outcome kind, in a contest where a sibling reads non-absent, and pin the step order too — the reorder is observable through the key the webview compares provisioning state by.

- [ ] 10_5 Witness the favoured member refused by its own rule
  - **Deps**: 10_4
  - **Refs**: design.md D3a, .reviews/round-7.md
  - **Acceptance**:
    - Outcome: A contest whose favoured member is refused before any reading writes nothing and refuses every member
    - Verify: unit src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/applyProvisioning.test.ts`, witness D4 row 3 reached through the pre-pass rather than through the ordered pass, using one fixture that also covers a contest in which every member is refused by its own rule.

- [ ] 10_6 Walk the dialog through every selection of a group nothing can decide
  - **Deps**: 10_1
  - **Refs**: specs/worktree-panel/spec.md#a-declaration-that-will-yield-is-offered-as-yielding, design.md D3c
  - **Acceptance**:
    - Outcome: At every selection of a two-repository-declaration group, the notes and the count say what that selection would receive
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.test.ts`, drive one group of two repository declarations and one inherited declaration through each selection the spec's scenarios name — as offered, one repository declaration unselected, selected again, and only the inherited one left — asserting the note on every row and the summary count at each step.
    2. The last of those is the state that falsified the first draft of this plan: the inherited declaration alone is applied, so nothing may still be claiming it will be refused.
