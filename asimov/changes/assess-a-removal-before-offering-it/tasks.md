## 1. The evidence the assessment was missing

- [x] 1_1 Give an external session an activity, and make an unreadable one live — verified: pnpm exec vitest run 'src/worktree/worktreeBlockers.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-refuses-when-it-cannot-establish-that-nothing-is-using-the-worktree}; docs/design/worktree-removal.md#22-three-classes-of-check-and-what-unproven-means-in-each; design.md D2
  - **Acceptance**:
    - Outcome: An external session that is not provably idle refuses the removal
    - Verify: unit src/worktree/worktreeBlockers.test.ts
  - **Plan**:
    1. Add `activity: PaneActivity | undefined` to `ExternalSessionFact` in `src/worktree/worktreeBlockers.ts`, and carry the refusing ids on `RemovalRefusal` in `src/worktree/worktreeBlockers.ts`. Absent means live — an external session we cannot classify is not evidence of idleness.
    2. In `evaluateRemoval`, route a session whose activity is `running`, `waiting`, or `undefined` into the refusal branch, and keep a provably idle one in the confirmable evidence. Leave `{ ok: false }` on the whole `SourceRead` meaning unproven, which is a different answer from a record read with no activity.
    3. Supply the activity at the production construction site in `src/extension.ts`. The Claude session registry records no activity, so it supplies `undefined` — which is the honest value and refuses, rather than `presenceProjector.ts`'s hardcoded `"running"`, which refuses for a reason nobody measured.
    4. Cover in `src/worktree/worktreeBlockers.test.ts`: running, waiting, undefined activity, provably idle, and an unreadable registry — five distinct outcomes, not one boolean. Also cover that one external session is counted once, as `externalAgents` and never additionally as `busyAgents`.
    5. Add `src/extension.ts` to the edited paths for step 3.
  - **Boundary**: no change to the presence projection's own filter — this reads the registry for a second question, it does not repurpose the first

- [x] 1_2 Let one check's class follow its evidence — verified: pnpm exec vitest run 'src/worktree/removalChecks.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-refuses-when-it-cannot-establish-that-nothing-is-using-the-worktree}; docs/design/worktree-rpc.md#25-removal-assessment-and-branch-deletion; design.md D1
  - **Acceptance**:
    - Outcome: `externalAgents` is a refusal when the session is not provably idle, confirmable when it is
    - Verify: unit src/worktree/removalChecks.test.ts
  - **Plan**:
    1. In `src/worktree/removalChecks.ts`, let a `CATALOGUE` row's `cls` be either a constant or a function of the assessment. `externalAgents` becomes the only function; every other row keeps its constant.
    2. Emit `externalAgents` in the `refused` branch too, since it is now a refusal-class check there. That branch deliberately reports ONLY the refusal-class checks — it gathered no confirmable evidence, so reporting those as passed would claim a read that never happened — and this check joins that list rather than breaking the rule.
    3. Cover in `src/worktree/removalChecks.test.ts` that `isRefusedByChecks` returns true for a not-provably-idle external session and false for an idle one, and that the refused branch still reports no confirmable-class check as passed.
  - **Boundary**: no second check id for the two cases — one row, one id, a class that reads the evidence

- [x] 1_3 Report a check that never applied as not applying — verified: pnpm exec vitest run 'src/worktree/removalChecks.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-check-that-did-not-apply-is-distinguishable-from-one-that-passed}; docs/design/worktree-removal.md#22-three-classes-of-check-and-what-unproven-means-in-each
  - **Acceptance**:
    - Outcome: A check whose question does not arise reports `notApplicable`, never `passed`
    - Verify: unit src/worktree/removalChecks.test.ts
  - **Plan**:
    1. Carry the sources whose question did not arise on the confirmable evidence in `src/worktree/worktreeBlockers.ts`. `SourceRead<T>` already answers `{ ok: "notApplicable" }` — a worktree whose directory is authoritatively gone has no working tree, so `git status` is a read with no subject — but `evaluateRemoval` parses it as empty and the assessment keeps no trace, so `checksFor` cannot tell it from a clean tree.
    2. In `src/worktree/removalChecks.ts`, map every check fed by such a source to `notApplicable` instead of `passed`, keyed on the `source` the catalogue already records.
    3. Cover in `src/worktree/removalChecks.test.ts` that `notApplicable` is emitted, and that neither `countOf` nor `failed` treats it as a failure or a reading. Cover the source in `src/worktree/worktreeBlockers.test.ts`.
    4. `RemovalEvidence` gains a required field, so the `evidence()` fixture helpers in `src/worktree/worktreeFingerprint.test.ts` and `src/worktree/worktreeMutationService.test.ts` supply it. Both default it empty — those suites assert on other fields and a default of "every source applied" is the shape they already assumed.
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

- [x] 2_3 Put ignored material on the assessment as a confirmable risk — verified: pnpm exec vitest run 'src/worktree/removalChecks.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3, 2_2
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-reports-the-ignored-material-it-will-delete}; docs/design/worktree-rpc.md#25-removal-assessment-and-branch-deletion
  - **Acceptance**:
    - Outcome: The assessment carries an `ignored` check in the confirmable class
    - Verify: unit src/worktree/removalChecks.test.ts
  - **Plan**:
    1. Add `ignored` to `CATALOGUE` in `src/worktree/removalChecks.ts` as a confirmable-class check, and carry the measurement into the evidence in `src/worktree/worktreeBlockers.ts`.
    2. Map `{ kind: "unproven" }` to outcome `unproven` and `{ kind: "measured" }` to `failed` or `passed` by whether anything was found, attaching `count` only to a failed check — a count on an unproven check is a number nobody measured.
    3. Cover in `src/worktree/removalChecks.test.ts` that an unproven ignored check does not refuse the removal, and that `countOf` yields nothing for it. Cover the new evidence field in `src/worktree/worktreeBlockers.test.ts`.
    4. Give the measurement a producer. `removalFacts` in `src/providers/WorktreeHost.ts` is the seam the other two unheld evidence sources already come through; it gains an `ignored` reader, supplied in `src/extension.ts` from a disk adapter exported by `src/worktree/ignoredMaterial.ts` and covered in `src/worktree/ignoredMaterial.test.ts`. An assessment whose one production producer supplies nothing carries a check that is permanently unproven — the benign-fallback failure this design forbids.
    5. Fixtures in `src/providers/WorktreeHost.actions.test.ts` supply the reader where they supply the other two, and the `evidence()` helpers in `src/worktree/worktreeFingerprint.test.ts` and `src/worktree/worktreeMutationService.test.ts` gain the new required field.
  - **Boundary**: unproven here is confirmable, never refusing — a slow disk must not make a worktree unremovable

## 3. A confirmation authorizes only what it was shown

- [x] 3_1 Re-evaluate before executing, and re-prompt only on a failure the user never saw — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: specs/worktree-panel/spec.md#{a-confirmation-authorizes-only-the-risks-it-was-shown}; docs/design/worktree-removal.md#3-what-confirmation-actually-authorizes; design.md D5
  - **Acceptance**:
    - Outcome: A failure absent at confirmation time re-prompts; one the user already confirmed does not
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    0. **Verify path corrected while building.** The Plan below located the re-evaluation in `src/providers/WorktreeHost.ts`; it shipped in `src/worktree/worktreeMutationService.ts`, and the host merely delegates through a stub in `WorktreeHost.actions.test.ts`, which therefore cannot observe this Outcome. The Outcome is unchanged — only the suite named to check it, moved to the one that can.
    1. `removeWorktree` in `src/worktree/worktreeMutationService.ts` already re-assesses on EVERY removal and redeems against the fresh evidence, and a re-evaluated refusal already returns `blocked` with a null fingerprint. What is missing is the newest evidence field: `atRisk` and `isIdentityPreservingSubset` were written before `ignored` existed, so ignored material appearing between confirmation and execution is a newly-failing confirmable check that proceeds unconfirmed.
    2. The comparison itself lives in `src/worktree/worktreeFingerprint.ts`. Return `needsConfirm` when a check not failing at confirmation time is failing now. A check that was already failing, or that stops failing, never re-prompts — "did anything fail" would re-prompt forever on the dirty files the user just confirmed.
    3. Treat a refusal-class check appearing at re-evaluation as a refusal, not a re-prompt: there is no confirmation to ask for.
    4. Cover in `src/worktree/worktreeFingerprint.test.ts` and `src/worktree/worktreeMutationService.test.ts`: a newly failed confirmable check re-prompts, an already-confirmed one proceeds, a newly failed refusal-class check refuses, and a check that stops failing proceeds.
  - **Boundary**: no execution changes beyond the gate — `git worktree remove` itself, and everything after it, belongs to WT-013.4

## 4. Round-1 review fixes

- [x] 4_1 Measure what the removal actually deletes, and confirm it against what the user saw — verified: pnpm exec vitest run src/worktree/ignoredMaterial.test.ts src/worktree/worktreeFingerprint.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#{a-confirmation-authorizes-only-the-risks-it-was-shown}; specs/worktree-panel/spec.md#{a-removal-reports-the-ignored-material-it-will-delete}; design.md D3
  - **Acceptance**:
    - Outcome: The walk enumerates ignored FILES under its own deadline, and an unproven reading never authorizes a measured failure
    - Verify: command pnpm exec vitest run src/worktree/ignoredMaterial.test.ts src/worktree/worktreeFingerprint.test.ts
  - **Plan**:
    1. Findings B3 and W1: `git status --porcelain --ignored=matching` reports an ignored DIRECTORY as one entry, verified against git 2.50.1; stat-ing it sizes the inode. Swap `src/worktree/ignoredMaterial.ts` to `git ls-files --others --ignored --exclude-standard -z`, which enumerates every ignored file recursively and NUL-delimits them, so the C-quoting W1 names never arises.
    2. Finding B4: give the enumeration the walk's own budget as the runner's `timeoutMs`, and re-check the deadline after each stat, not only before it.
    3. Finding B1: in `src/worktree/worktreeFingerprint.ts`, an approved `unproven` reading covers a current `unproven` or a measured zero, never a measured failure. Cover it in `src/worktree/worktreeFingerprint.test.ts`.
    4. Finding S1: `fsp.lstat` in `src/extension.ts`: the removal deletes the symlink, not its target.
    5. Correct the false sentence about `--ignored` in `asimov/changes/assess-a-removal-before-offering-it/design.md` D3.
  - **Boundary**: B2 is NOT fixed here — it is handed back to `asimov-plan`

- [x] 4_2 Count a session once, in the window that holds it — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-refuses-when-it-cannot-establish-that-nothing-is-using-the-worktree}; design.md D6
  - **Acceptance**:
    - Outcome: A registry session this window already holds as a pane does not additionally refuse the removal
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. Publish the window pass's claimed-session set as a read on `PresenceProjector` in `src/worktree/presenceProjector.ts`. It is already built there so an external row is never a second row for a pane's own session; this exposes it rather than rebuilding it. Empty before the first pass, which leaves today's refusing behaviour intact.
    2. In `src/extension.ts`, drop registry sessions whose entry id is in that set before they become `ExternalSessionFact`s. The session is then counted once, as the idle pane it is.
    3. Cover in `src/worktree/presenceProjector.test.ts` that the set names a pane's own session and is empty before any projection.
    4. `PresenceProjector` gains a member, so the hand-built projector fakes in `src/providers/WorktreeHost.actions.test.ts`, `src/providers/WorktreeHost.delegations.test.ts` `src/providers/WorktreeHost.presence.test.ts` and `src/providers/WorktreeHost.test.ts` supply it empty — those suites assert on rows, and an empty claimed set is the shape they already assumed.
    5. Regression from 2_3, found while diagnosing the assembly failures and NOT the cause of them: the ignored walk was awaited SERIALLY alongside the other three reads in `src/providers/WorktreeHost.ts`, adding a fourth suspension point to the window round-9 B8 closed. No test caught it — the four reads are independent, so they are taken together and the assessment now spans one suspension point instead of four, narrower than before this change.
    6. The assembly test `src/extension.worktreeAssembly.test.ts` fakes the git process boundary and the projector; its reply table gains the ignored listing, and its projector fake DELEGATES `claimedSessionIds` to the real one rather than stubbing it — a stub returning nothing would make the assembly test agree with the very bug B2 names.
  - **Boundary**: the projection's own filter is unchanged — this reads the fact it already computes, it does not repurpose the pass that computes it

- [x] 4_3 Put the enumeration back under the walk's one budget — verified: pnpm exec vitest run 'src/worktree/ignoredMaterial.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: Enumeration and sizing share ONE time budget, as D3 approved — the walk's total, not a budget per phase
    - Verify: unit src/worktree/ignoredMaterial.test.ts
  - **Plan**:
    1. Round-2 SUPERSEDED. Fixing B4 I gave git its own full `MAX_IGNORED_MS` and then wrote design.md and the module doc to say the bound was one budget per phase — a change to what D3 decided, not the enforcement of it that accepting B4 authorized. `tasks.md` 2_3 step 2 and D3's own opening still said ONE budget across both, so the change also left the artifacts contradicting each other.
    2. `measureIgnoredMaterial` owns the deadline: `ignoredEntries` takes the milliseconds still left in the walk's budget, and the adapter in `src/worktree/ignoredMaterial.ts` passes exactly that to the runner. The sizing then continues against the same absolute deadline, so the total is bounded by `MAX_IGNORED_MS` and not by twice it.
    3. Restore the single-budget wording in `asimov/changes/assess-a-removal-before-offering-it/design.md` D3, keeping only the factual correction about what `git status --ignored` names — that was a wrong fact, not a decision.
    4. Cover in `src/worktree/ignoredMaterial.test.ts` that the enumeration receives the REMAINING budget, and that time already spent walking is not handed back to it.
  - **Boundary**: no change to what D3 decided — this restores it

- [x] 4_4 Let the walk's deadline actually reach git — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_3
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: The deadline the walk computes reaches the git process in production, and a spent budget never starts one
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Cycle-2 B4. `src/extension.ts` injects `run: (args, cwd) => runner.run(args, cwd)` — a two-parameter wrapper that silently DROPS the third. Every deadline 4_1 and 4_3 computed was discarded at the production boundary while the unit test, which asserts against its own injected fake, stayed green. Forward the options.
    2. `execFile` treats a timeout of `0` as no timeout at all, so flooring a spent budget at zero disables the very bound it was meant to express. `measureIgnoredMaterial` in `src/worktree/ignoredMaterial.ts` returns `unproven` before it asks for entries at all, and `diskIgnoredDeps` refuses to start git on a spent budget.
    3. Cover it where it broke: `src/extension.worktreeAssembly.test.ts` fakes the real git boundary, so its recorder gains the per-call options and asserts the ignored listing carries a deadline. A unit test against an injected fake could not have caught this and did not.
  - **Boundary**: no change to D3 — this makes the approved bound reach the process it was always meant to bound
