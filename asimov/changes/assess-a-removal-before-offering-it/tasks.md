## 1. The evidence the assessment was missing

- [ ] 1_1 Give an external session an activity, and make an unreadable one live
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-refuses-when-it-cannot-establish-that-nothing-is-using-the-worktree}; docs/design/worktree-removal.md#22-three-classes-of-check-and-what-unproven-means-in-each; design.md D2
  - **Acceptance**:
    - Outcome: An external session that is not provably idle refuses the removal
    - Verify: unit src/worktree/worktreeBlockers.test.ts
  - **Plan**:
    1. Add `activity: PaneActivity | undefined` to `ExternalSessionFact` in `src/worktree/worktreeBlockers.ts`. Absent means live — an external session we cannot classify is not evidence of idleness.
    2. In `evaluateRemoval`, route a session whose activity is `running`, `waiting`, or `undefined` into the refusal branch, and keep a provably idle one in the confirmable evidence. Leave `{ ok: false }` on the whole `SourceRead` meaning unproven, which is a different answer from a record read with no activity.
    3. Supply the activity at every construction site of `ExternalSessionFact`, reading the registry rather than the presence projection's live-only filter — the filter answers what the panel should show, where a dead record is noise, and this asks whether anything is using the worktree, where an unclassifiable record is the point.
    4. Cover in `src/worktree/worktreeBlockers.test.ts`: running, waiting, undefined activity, provably idle, and an unreadable registry — five distinct outcomes, not one boolean.
  - **Boundary**: no change to the presence projection's own filter — this reads the registry for a second question, it does not repurpose the first

- [ ] 1_2 Let one check's class follow its evidence
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-refuses-when-it-cannot-establish-that-nothing-is-using-the-worktree}; docs/design/worktree-rpc.md#25-removal-assessment-and-branch-deletion; design.md D1
  - **Acceptance**:
    - Outcome: `externalAgents` is a refusal when the session is not provably idle, confirmable when it is
    - Verify: unit src/worktree/removalChecks.test.ts
  - **Plan**:
    1. In `src/worktree/removalChecks.ts`, let a `CATALOGUE` row's `cls` be either a constant or a function of the assessment. `externalAgents` becomes the only function; every other row keeps its constant.
    2. Keep `checksFor` emitting every catalogue id in every branch. The one-row-per-id table is what stops a UI rendering a shorter list for a worse outcome, and that property is not what this task changes.
    3. Cover in `src/worktree/removalChecks.test.ts` that `isRefusedByChecks` returns true for a not-provably-idle external session and false for an idle one, and that the emitted id list is identical across all three assessment kinds.
  - **Boundary**: no second check id for the two cases — one row, one id, a class that reads the evidence

- [ ] 1_3 Report a check that never applied as not applying
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-check-that-did-not-apply-is-distinguishable-from-one-that-passed}; docs/design/worktree-removal.md#22-three-classes-of-check-and-what-unproven-means-in-each
  - **Acceptance**:
    - Outcome: A check whose question does not arise reports `notApplicable`, never `passed`
    - Verify: unit src/worktree/removalChecks.test.ts
  - **Plan**:
    1. In `src/worktree/removalChecks.ts`, produce `notApplicable` from the sources that can answer "the question does not arise". `SourceRead<T>` already carries `{ ok: "notApplicable" }`, so the outcome has a source; the projection currently discards it.
    2. Cover in `src/worktree/removalChecks.test.ts` that `notApplicable` is emitted, and that neither `countOf` nor `failed` treats it as a failure or a reading.
  - **Boundary**: `notApplicable` only where a source says so — never as a default for a check this change did not compute

## 2. What the removal will actually delete

- [x] 2_1 Measure ignored material under one budget, or report that it could not be — verified: pnpm exec vitest run 'src/worktree/ignoredMaterial.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-reports-the-ignored-material-it-will-delete}; docs/design/worktree-removal.md#23-removal-reports-what-it-will-delete-not-what-git-tracks; design.md D3
  - **Acceptance**:
    - Outcome: An oversized ignored tree yields `unproven`, never a partial count presented as a total
    - Verify: unit src/worktree/ignoredMaterial.test.ts
  - **Plan**:
    1. Add `src/worktree/ignoredMaterial.ts` exporting the bounded measurement and the `IgnoredMaterial` type from design.md § Interfaces. Take the enumeration and the stat as injected dependencies — the enumeration as an async iterable so it can be cut off mid-listing — so the suite needs no disk. The provisioning adapter already reads this way; follow it rather than inventing a second seam shape.
    2. Apply ONE entry budget and ONE time budget across both phases — enumeration and sizing. An enormous listing must exhaust the entry cap before any stat runs.
    3. Return `{ kind: "unproven" }` for every terminating condition: budget reached, a directory that could not be read, or the enumeration throwing. A partial count is never returned as `measured`.
    4. Cover in `src/worktree/ignoredMaterial.test.ts`: a small measured tree, an entry-cap trip, a time-cap trip, an unreadable directory, and a throwing enumeration — each asserting `kind`, not a count.
  - **Boundary**: read-only — this measures and never deletes, moves, or writes anything

- [x] 2_2 Name provisioned material only from the record of provisioning it — verified: pnpm exec vitest run 'src/worktree/ignoredMaterial.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{material-this-extension-provisioned-is-named-only-from-a-record-of-provisioning-it}; docs/design/worktree-apply.md#26-the-manifest-what-this-worktree-was-set-up-with; design.md D4
  - **Acceptance**:
    - Outcome: Provisioned material is named only from a manifest that parsed whole
    - Verify: unit src/worktree/ignoredMaterial.test.ts
  - **Plan**:
    1. In `src/worktree/ignoredMaterial.ts`, read the manifest at `.git/worktrees/<id>/anywhere-terminal-provision.json` through the injected reads and set `provisioned` only when it parses whole at a recognized `version`.
    2. Treat missing, unreadable, malformed, and unrecognized-version identically: omit `provisioned`. Its absence is how "we did not differentiate" is expressed — never a zero, which claims we looked and found none.
    3. Cover in `src/worktree/ignoredMaterial.test.ts`: a readable manifest, an absent one, a malformed one, and one at an unrecognized version, asserting `provisioned` is absent for the last three. Note in the test file that nothing writes a manifest yet — the apply path that would is unbuilt Phase 12 work — so the fallback is the branch that actually runs today.
  - **Boundary**: no provenance inferred from a path or a name — `.env.worktree` looking like ours is not evidence it is ours

- [ ] 2_3 Put ignored material on the assessment as a confirmable risk
  - **Deps**: 1_3, 2_2
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-reports-the-ignored-material-it-will-delete}; docs/design/worktree-rpc.md#25-removal-assessment-and-branch-deletion
  - **Acceptance**:
    - Outcome: The assessment carries an `ignored` check in the confirmable class
    - Verify: unit src/worktree/removalChecks.test.ts
  - **Plan**:
    1. Add `ignored` to `CATALOGUE` in `src/worktree/removalChecks.ts` as a confirmable-class check, and carry the measurement into the evidence in `src/worktree/worktreeBlockers.ts`.
    2. Map `{ kind: "unproven" }` to outcome `unproven` and `{ kind: "measured" }` to `failed` or `passed` by whether anything was found, attaching `count` only to a failed check — a count on an unproven check is a number nobody measured.
    3. Cover in `src/worktree/removalChecks.test.ts` that an unproven ignored check does not refuse the removal, and that `countOf` yields nothing for it.
  - **Boundary**: unproven here is confirmable, never refusing — a slow disk must not make a worktree unremovable

## 3. A confirmation authorizes only what it was shown

- [ ] 3_1 Re-evaluate before executing, and re-prompt only on a failure the user never saw
  - **Deps**: 2_3
  - **Refs**: specs/worktree-panel/spec.md#{a-confirmation-authorizes-only-the-risks-it-was-shown}; docs/design/worktree-removal.md#3-what-confirmation-actually-authorizes; design.md D5
  - **Acceptance**:
    - Outcome: A failure absent at confirmation time re-prompts; one the user already confirmed does not
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, re-evaluate the checks immediately before the destructive command and compare the result against the check set the fingerprint was bound to.
    2. Return `needsConfirm` when a check not failing at confirmation time is failing now. A check that was already failing, or that stops failing, never re-prompts — "did anything fail" would re-prompt forever on the dirty files the user just confirmed.
    3. Treat a refusal-class check appearing at re-evaluation as a refusal, not a re-prompt: there is no confirmation to ask for.
    4. Cover in `src/providers/WorktreeHost.actions.test.ts`: a newly failed confirmable check re-prompts, an already-confirmed one proceeds, a newly failed refusal-class check refuses, and a check that stops failing proceeds.
  - **Boundary**: no execution changes beyond the gate — `git worktree remove` itself, and everything after it, belongs to WT-013.4
