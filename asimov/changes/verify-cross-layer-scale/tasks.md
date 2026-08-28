## 1. Traceability

- [x] 1_1 Audit the truthfulness invariants and publish the registry and budget constants — verified: bun test 'src/test/invariants/coverage.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1, D2, D9
  - **Acceptance**:
    - Outcome: Every invariant has a registry row recording what the audit found
    - Verify: unit src/test/invariants/coverage.test.ts
  - **Plan**:
    1. Audit I1–I16 against the suite, reading files with `node:fs` — a shell grep skips the NUL-carrying sources (D1)
    2. Write src/test/invariants/registry.ts: one row per invariant with `owners`, `stimulus`, and the audit's status; freeze `DEFERRED_BY_WT_006_2`
    3. Write src/test/invariants/budgets.ts with the four published budgets and their citations
    4. Write src/test/invariants/coverage.test.ts with assertions 1, 2 and 5 — doc equality both ways, owner resolution, and the frozen deferred set

- [x] 1_2 Tag every covering test and enforce the mapping in both directions — verified: bun test 'src/test/invariants/coverage.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D1
  - **Acceptance**:
    - Outcome: Removing the last active test for a covered invariant fails the suite
    - Verify: unit src/test/invariants/coverage.test.ts
  - **Plan**:
    1. Add `[I<n>]` to the `it(...)` title of each test the audit named — titles only, no assertion changes
    2. Add assertions 3 and 4 to src/test/invariants/coverage.test.ts, matching `it(`/`test(` call sites and rejecting `.skip`, `.todo`, `.failing`
    3. Prove the scan rejects a tag in a comment and a tag on a skipped test
    4. Declare the title edits at verify time with `--test-change`

- [x] 1_3 Cover the single-layer invariants the audit found untested — verified: pnpm run test:unit && pnpm run check-types exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D1
  - **Acceptance**:
    - Outcome: Every uncovered invariant that one layer can prove now has a red-first test
    - Verify: command pnpm run test:unit
  - **Boundary**: cross-layer invariants belong to task 2_1 and stay uncovered here
  - **Plan**:
    1. Write a test per single-layer uncovered row, each demonstrated red against its `stimulus` before it passes
    2. Flip those rows to covered in src/test/invariants/registry.ts

## 2. Cross-layer composition

- [x] 2_1 Prove the invariants that no single layer can prove — verified: pnpm run test:unit && pnpm run check-types exit 0
  - **Deps**: 1_3
  - **Refs**: design.md D5, D9
  - **Acceptance**:
    - Outcome: Each cross-layer invariant fails when its pipeline is broken at any layer
    - Verify: command pnpm run test:unit
  - **Boundary**: no test may live in or modify src/agentHooks/install/ or AgentHookController.ts
  - **Plan**:
    1. Write src/extension.crossLayer.test.ts for the hook-pipeline scenarios (I6, I7), each traversing the production composition rather than a pair of unit seams
    1b. Add the host/webview scenarios (I9, I14, I15, tree-presence atomicity) to src/extension.worktreeAssembly.test.ts, which already stands up that composition — a second copy of it would be the duplication D5 is arguing against
    2. Demonstrate each red by breaking its pipeline at a different layer than the assertion reads
    3. Flip those rows to covered in src/test/invariants/registry.ts, and add assertion 6 to src/test/invariants/coverage.test.ts: no row is left uncovered

## 3. Bounds and cost

- [x] 3_1 Hold the presence cost envelope over production wiring — verified: bun test 'src/worktree/presenceProjector.scale.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: Presence at 10 panes and 10 worktrees reads the registry and process table once each
    - Verify: unit src/worktree/presenceProjector.scale.test.ts
  - **Plan**:
    1. In src/worktree/presenceProjector.scale.test.ts, compose the production `createPresenceProjectorDeps` so the spies sit at the real seam, not on a hand-built projector
    2. Assert each read count as exact equality, and that unchanged pane keys trigger no re-resolution

- [x] 3_2 Hold the burst and stream bounds on one joined path — verified: pnpm exec vitest run 'src/providers/WorktreeHost.scale.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: A burst and a paced stream each produce the documented rebuild count per repo
    - Verify: unit src/providers/WorktreeHost.scale.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.scale.test.ts, compose the real watcher pool, host, and rebuild gate under fake clocks
    2. Pace the stream above `DEBOUNCE_MS` and below `REBUILD_FLOOR_MS`, so it reaches the floor instead of being swallowed by the trailing debounce
    3. Assert all five counts from D3 as exact equality, including zero commands for sibling repos

- [x] 3_3 Prove a second surface adds no source-side work — verified: pnpm exec vitest run 'src/providers/WorktreeHost.secondSurface.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D4
  - **Acceptance**:
    - Outcome: A second surface leaves every source-side counter unchanged
    - Verify: unit src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.secondSurface.test.ts, snapshot every counter in D4 with one surface shown
    2. Attach and show a second surface, then assert each counter is unchanged and only the post count rose

- [x] 3_4 Measure the two published latency budgets outside the unit suite — verified: pnpm run bench:scale && pnpm run check-types && pnpm exec vitest run src/worktree/presenceProjector.scale.test.ts src/test/invariants exit 0
  - **Deps**: 3_1, 3_2
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: Both published latency budgets hold at their documented fixture sizes
    - Verify: command pnpm run bench:scale
  - **Boundary**: neither the documented bound nor the documented fixture size may move to make a run pass
  - **Plan**:
    1. Add src/test/bench/scale.bench.ts — presence at 10 panes × 10 worktrees, and a model rebuild over a real temporary repo with ten worktrees built from the existing integration fixtures
    2. Assert each measurement against src/test/invariants/budgets.ts and exit non-zero on breach
    3. Register the `bench:scale` script in package.json plus vitest.bench.config.ts, kept out of `test:unit` — the main config includes only `*.test.ts`, so exclusion is structural rather than a list that can drift

## 4. Registration and hygiene

- [x] 4_1 Publish the render cap as a value other documents can reference — verified: pnpm run test:unit && pnpm run check-types && pnpm exec vitest run src/test/invariants src/webview/worktree/WorktreeView.test.ts exit 0
  - **Deps**: 2_1, 4_2
  - **Refs**: design.md D6; specs/NO-DELTA.md
  - **Acceptance**:
    - Outcome: The cap has one definition, and a drift from the design registry fails the suite
    - Verify: command pnpm run test:unit
  - **Plan**:
    1. Export `MAX_WORKTREES_PER_REPO` from src/webview/worktree/WorktreeView.ts and tag its existing behavioural test
    2. Add its row to the cross-document consistency registry in docs/DESIGN.md, and repoint the stale `§ 15` sync-rule footers in docs/design/ at it
    3. Assert in src/test/invariants/coverage.test.ts that the registry row states the exported value

- [x] 4_2 Write NUL separators as escapes so the sources stop reading as binary — verified: pnpm run test:unit && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: design.md D7
  - **Acceptance**:
    - Outcome: No source this change owns holds a raw control byte, and behaviour is unchanged
    - Verify: command pnpm run test:unit
  - **Boundary**: src/agentHooks/install/managedEntryLedger.ts carries the same defect and is out of scope
  - **Plan**:
    1. Replace the literal NUL with the `"\0"` escape in src/webview/worktree/WorktreeView.ts, src/webview/vault/PreviewController.ts, src/vault/VaultService.ts, and src/vault/readers/cursorReader.test.ts
    2. Add src/test/invariants/sourceBytes.test.ts, an fs-based scan failing on any raw control byte outside the excluded path

## 5. Suite integrity

- [x] 5_1 Root-cause the assembly suite flake, then fix or quarantine it — verified: bash -c "for i in 1 2 3 4 5; do pnpm run test:unit || exit 1; done" && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: design.md D8, D9
  - **Acceptance**:
    - Outcome: Five consecutive full-suite runs pass
    - Verify: command bash -c "for i in 1 2 3 4 5; do pnpm run test:unit || exit 1; done"
  - **Boundary**: no retry flag, no widened timeout, and no lease on the peer-owned tree
  - **Plan**:
    1. Reproduce src/extension.worktreeAssembly.test.ts under repeated full-suite runs and record the failure shape
    2. Fix it where the cause is ours; otherwise skip the affected cases naming the reason, and add a Deferred entry to docs/PLAN.md

## 6. Review fixes (cycle 1)

- [x] 6_1 Make the verification prove what it names — round-1 blockers — verified: pnpm run test:unit && pnpm run check-types exit 0
  - **Deps**: 2_1, 3_4, 4_1
  - **Refs**: .reviews/round-1.md; design.md D1, D2, D3, D4, D5
  - **Acceptance**:
    - Outcome: Every accepted round-1 blocker's named failure makes a test go red
    - Verify: command pnpm run test:unit
  - **Boundary**: no test may live in or modify src/agentHooks/install/ or AgentHookController.ts; no bound and no published fixture size moves
  - **Plan**:
    1. B1: strip comments before the declaration scan, and invert the fixture that asserted a commented `it(` counts (src/test/invariants/coverage.test.ts, src/test/invariants/sourceSources.ts)
    2. B8, B7, B5, B6: repair the assertions that pass on empty or unstimulated input in src/extension.worktreeAssembly.test.ts
    3. B4: drive I7 through runtime disposal in src/extension.crossLayer.test.ts
    4. B3: export TURN_ACTIVITY from src/worktree/presenceProjector.ts and take I13's state universe from it, in src/agentHooks/agents/claude.test.ts and src/worktree/presenceProjector.test.ts
    5. B2, B5: retag against the assertions that actually prove each invariant, including src/webview/integration/paneEvidenceReporting.test.ts and src/worktree/presenceProjector.test.ts
    6. B9, B10, B11: complete the D2/D3/D4 inventories in src/worktree/presenceProjector.scale.test.ts, src/providers/WorktreeHost.scale.test.ts, src/providers/WorktreeHost.secondSurface.test.ts
    7. W1: build the published fixture size in src/test/bench/scale.bench.ts

- [x] 6_2 Parse the suite instead of lexing it, and close I10 with a source rule — round-3 blockers — verified: pnpm run test:unit && pnpm run check-types exit 0
  - **Deps**: 6_1
  - **Refs**: .reviews/round-3.md; design.md D1 (revised), D10
  - **Acceptance**:
    - Outcome: A non-test identifier cannot hold an invariant covered, and a direct fs deletion in the removal path fails the suite
    - Verify: command pnpm run test:unit
  - **Boundary**: no character-level scanner; the declaration scan goes through the TypeScript parser
  - **Plan**:
    1. Rewrite `declarationsIn` in src/test/invariants/sourceSources.ts over `ts.createSourceFile` and `CallExpression`, keeping all three rounds' negative fixtures in src/test/invariants/coverage.test.ts
    2. Tag I1's activity-retention assertion in src/worktree/presenceProjector.test.ts
    3. Add the D10 source rule to src/test/invariants/sourceBytes.test.ts and drop I10's admission comment from src/test/invariants/registry.ts

## 7. Review fixes (cycle 2)

- [x] 7_1 Check execution, not existence — round-4 blockers — verified: pnpm run test:unit && pnpm run check-types exit 0
  - **Deps**: 6_2
  - **Refs**: .reviews/round-4.md; design.md D1 (revised), D4, D10
  - **Acceptance**:
    - Outcome: A disabled suite, a named-import deletion, a routing change, and a render cap raised by one each make a test go red
    - Verify: command pnpm run test:unit
  - **Boundary**: no production behavior change — src/extension.ts routing stays as it is; I6 is proved through the existing activation harness, not through a new production seam
  - **Plan**:
    1. B12: propagate enclosing-suite inertness and resolve `it`/`test` to imported vitest bindings in src/test/invariants/sourceSources.ts, with `describe.skip`/`describe.todo`/shadowed-`it` fixtures in src/test/invariants/coverage.test.ts
    2. B2: read `node:fs` bindings through the TypeScript AST in src/test/invariants/sourceBytes.test.ts so named, aliased, and renamed-namespace deletions are caught
    3. B2: tag I2 at its title-evidence boundary and I3 at its direct activation test in src/webview/worktree/WorktreeView.test.ts
    4. B13: drive I6 through real activation in src/extension.worktreeAssembly.test.ts and drop the mirrored `route()` from src/extension.crossLayer.test.ts
    5. B14: assert the pre-click row count equals the exported cap in src/webview/worktree/WorktreeView.test.ts
    6. W4: dispose activation in an `afterEach` in src/extension.worktreeAssembly.test.ts
    7. S2: build the one-pane fixture in src/worktree/presenceProjector.scale.test.ts; S3: delete `withoutComments` from src/test/invariants/sourceSources.ts

- [x] 7_2 Two invariant tags that name more than their test proves — round-4, specialist-direct — verified: pnpm run test:unit && pnpm run check-types exit 0
  - **Deps**: 7_1
  - **Refs**: .reviews/round-4.md § Triage — findings F1 and F2
  - **Acceptance**:
    - Outcome: The [I5] and [I9] tags sit on assertions that fail when their invariant is violated
    - Verify: command pnpm run test:unit
  - **Boundary**: tags and assertions only; no production change, no fixture reshaping
  - **Plan**:
    1. I9: tag the spinner-stopping test and assert the posted title arrives undecorated (src/webview/integration/paneEvidenceReporting.test.ts)
    2. I5: assert historical subagent rows carry live=false rather than only counting them (src/webview/worktree/WorktreeView.test.ts)

## 8. Designed fix (round-5 handback)

- [x] 8_1 Count coverage from the runner's verdict, and delete the scanner — verified: pnpm run test:unit && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_2
  - **Refs**: design.md D1 (revised after round 5); discovery.md § "Round-5 handback" 2b, 3
  - **Acceptance**:
    - Outcome: An invariant losing its last running tagged test makes `pnpm run test:unit` exit non-zero
    - Verify: command pnpm run test:unit
  - **Boundary**: no static decision about whether a test runs; the reporter reads `result()` and never re-derives it. The reporter attaches from the `test:unit` script, not from vitest.config.mts, so a targeted `vitest run <file>` is unaffected
  - **Plan**:
    1. Add src/test/invariants/coverageReporter.ts — `onTestRunEnd`, counting a `[I<n>]` tag only where `result().state === "passed"` and `options.fails !== true`, reporting missing and unknown ids and setting a non-zero `process.exitCode`
    2. Attach it in package.json on `test:unit` only (`--reporter=default --reporter=./src/test/invariants/coverageReporter.ts`)
    3. Delete `Declaration`, `declarationsIn`, `isActive` and all five rounds' negative fixtures from src/test/invariants/sourceSources.ts and src/test/invariants/coverage.test.ts, leaving `tsFiles` and registry assertions 1, 2, 5, 6
    4. Red-demo before ticking: untag one covered invariant, confirm a non-zero exit, restore
    5. Declare the fixture deletion at `verify-task` — rounds 1-5 assert properties of a scanner that no longer exists

- [x] 8_2 Resolve the destructive symbol with the checker, in a standalone gate — verified: pnpm run gate:fs-deletion && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_1
  - **Refs**: design.md D10 (revised after round 5); discovery.md § "Round-5 handback" 2, 4
  - **Acceptance**:
    - Outcome: The gate exits non-zero on any destructive-symbol acquisition inside the removal scope
    - Verify: command pnpm run gate:fs-deletion
  - **Boundary**: no alias chasing — acquisition is the rejected event; no Program construction inside `test:unit`
  - **Plan**:
    1. Add src/test/invariants/fsDeletionGate.ts building one `ts.createProgram` from tsconfig.json, rejecting acquisition of a destructive `node:fs` symbol in `src/worktree/**` + src/providers/WorktreeHost.ts, and failing closed on non-literal member access
    2. Check in src/test/invariants/fixtures/fsDeletion/ with the six bypasses plus the two lexical shadows, asserted through the same Program so the gate proves it can see
    3. Add the `gate:fs-deletion` script to package.json and register it under asimov/project.md § Commands, so every future Verify Gate runs it
    4. Remove the `destructiveCalls` resolver and its cases from src/test/invariants/sourceBytes.test.ts, leaving the D7 byte scan
    5. Declare the move at `verify-task` — the same eight spellings are asserted, by the checker rather than by hand

- [x] 8_3 Prove I2 through production classification, not at the render end alone — verified: pnpm exec vitest run 'src/webview/integration/paneEvidenceReporting.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_2
  - **Refs**: design.md D5 (I2 composition, added after round 5); discovery.md § "Round-5 handback" 5
  - **Acceptance**:
    - Outcome: A pane with no launch proof renders an undecorated agent cell through production classification
    - Verify: unit src/webview/integration/paneEvidenceReporting.test.ts
  - **Boundary**: no `activate()` standup — the composition starts at the real store
  - **Plan**:
    1. Compose the real store, reporter, projector, and `renderAgentRow` in src/webview/integration/paneEvidenceReporting.test.ts, asserting `{ agent: "claude", agentSource: "title" }` before render
    2. Move the `[I2]` tag off the hand-built row assertion in src/webview/worktree/WorktreeView.test.ts, leaving that test as the renderer's own unit
    3. Declare the tag move at `verify-task` — the render-end test keeps its assertion and loses a tag it overstated

- [x] 8_4 Tear activation down through `deactivate`, not around it — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_3
  - **Refs**: .reviews/round-5.md § W4; discovery.md § "Round-5 handback" 6
  - **Acceptance**:
    - Outcome: Every assembly case tears down through production deactivation, and a throwing disposal fails the test
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Boundary**: teardown only; no production change, and no claim that this fixes `PTY_LOAD_FAILED` — D8 owns that
  - **Plan**:
    1. Capture `deactivate` alongside `activate` inside `assemble()` in src/extension.worktreeAssembly.test.ts — `beforeEach` calls `vi.resetModules()`, so a later import yields a different module instance with different controller state
    2. `await deactivate()` in `afterEach`, then dispose `context.subscriptions`, surfacing unexpected failures; drop the direct `captured.runtime?.dispose()`

- [x] 8_5 One repo fixture, shared by the bench and the integration suite — verified: pnpm run bench:scale && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_4
  - **Refs**: .reviews/round-5.md § W2; discovery.md § "Round-5 handback" 8
  - **Acceptance**:
    - Outcome: The bench and the mutation integration suite build their temp repo from one module
    - Verify: command pnpm run bench:scale
  - **Boundary**: runtime-neutral — the shared module imports nothing from vitest, and lives outside D10's scope because it calls `fs.rmSync`
  - **Plan**:
    1. Add src/test/fixtures/repoFixture.ts with a caller-owned handle: `realpathSync(mkdtempSync(...))`, `git init -q -b main`, identity config, `README.md`, `add .`, `commit -qm init`, optional linked worktrees, and a `dispose()`
    2. Consume it from src/test/bench/scale.bench.ts and from src/worktree/worktreeMutations.integration.test.ts, keeping each side's own lifecycle
    3. Declare the replacement at `verify-task` — the same repo shape is built, from one place

## 9. Review fixes (cycle 3)

- [x] 9_1 Stop enumerating AST shapes by hand, and honour the fail-closed rule — round-6 findings — verified: pnpm run gate:fs-deletion && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_5
  - **Refs**: .reviews/round-6.md; design.md D10 (revised after round 5)
  - **Acceptance**:
    - Outcome: The gate exits non-zero on a quoted-key, assignment-destructured, or type-erased fs acquisition
    - Verify: command pnpm run gate:fs-deletion
  - **Boundary**: no alias chasing; an unresolved symbol on an fs-derived expression is a rejection, never a pass
  - **Plan**:
    1. B15: read a binding key through its literal text, cover destructuring assignment, and reject a destructive member reached through `any` in src/test/invariants/fsDeletionGate.ts
    2. B15: keep the four reproduction cases as checked-in fixtures in src/test/invariants/fixtures/fsDeletion/
    3. W5: normalise the relative path to `/` before scope classification in src/test/invariants/fsDeletionGate.ts
    4. W6: dispose subscriptions in a `finally` and report the deactivation error alongside them in src/extension.worktreeAssembly.test.ts
