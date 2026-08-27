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

- [ ] 2_1 Prove the invariants that no single layer can prove
  - **Deps**: 1_3
  - **Refs**: design.md D5, D9
  - **Acceptance**:
    - Outcome: Each cross-layer invariant fails when its pipeline is broken at any layer
    - Verify: command pnpm run test:unit
  - **Boundary**: no test may live in or modify src/agentHooks/install/ or AgentHookController.ts
  - **Plan**:
    1. Write src/extension.crossLayer.test.ts covering the six scenarios in D5, each traversing the production composition rather than a pair of unit seams
    2. Demonstrate each red by breaking its pipeline at a different layer than the assertion reads
    3. Flip those rows to covered in src/test/invariants/registry.ts, and add assertion 6 to src/test/invariants/coverage.test.ts: no row is left uncovered

## 3. Bounds and cost

- [ ] 3_1 Hold the presence cost envelope over production wiring
  - **Deps**: 1_1
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: Presence at 10 panes and 10 worktrees reads the registry and process table once each
    - Verify: unit src/worktree/presenceProjector.scale.test.ts
  - **Plan**:
    1. In src/worktree/presenceProjector.scale.test.ts, compose the production `createPresenceProjectorDeps` so the spies sit at the real seam, not on a hand-built projector
    2. Assert each read count as exact equality, and that unchanged pane keys trigger no re-resolution

- [ ] 3_2 Hold the burst and stream bounds on one joined path
  - **Deps**: 1_1
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: A burst and a paced stream each produce the documented rebuild count per repo
    - Verify: unit src/providers/WorktreeHost.scale.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.scale.test.ts, compose the real watcher pool, host, and rebuild gate under fake clocks
    2. Pace the stream above `DEBOUNCE_MS` and below `REBUILD_FLOOR_MS`, so it reaches the floor instead of being swallowed by the trailing debounce
    3. Assert all five counts from D3 as exact equality, including zero commands for sibling repos

- [ ] 3_3 Prove a second surface adds no source-side work
  - **Deps**: 1_1
  - **Refs**: design.md D4
  - **Acceptance**:
    - Outcome: A second surface leaves every source-side counter unchanged
    - Verify: unit src/providers/WorktreeHost.secondSurface.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.secondSurface.test.ts, snapshot every counter in D4 with one surface shown
    2. Attach and show a second surface, then assert each counter is unchanged and only the post count rose

- [ ] 3_4 Measure the two published latency budgets outside the unit suite
  - **Deps**: 3_1, 3_2
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: Both published latency budgets hold at their documented fixture sizes
    - Verify: command pnpm run bench:scale
  - **Boundary**: neither the documented bound nor the documented fixture size may move to make a run pass
  - **Plan**:
    1. Add src/test/bench/scale.bench.ts — presence at 10 panes × 10 worktrees, and a model rebuild over a real temporary repo with ten worktrees built from the existing integration fixtures
    2. Assert each measurement against src/test/invariants/budgets.ts and exit non-zero on breach
    3. Register the `bench:scale` script in package.json, kept out of `test:unit`

## 4. Registration and hygiene

- [ ] 4_1 Publish the render cap as a value other documents can reference
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

- [ ] 5_1 Root-cause the assembly suite flake, then fix or quarantine it
  - **Deps**: none
  - **Refs**: design.md D8, D9
  - **Acceptance**:
    - Outcome: Five consecutive full-suite runs pass
    - Verify: command bash -c "for i in 1 2 3 4 5; do pnpm run test:unit || exit 1; done"
  - **Boundary**: no retry flag, no widened timeout, and no lease on the peer-owned tree
  - **Plan**:
    1. Reproduce src/extension.worktreeAssembly.test.ts under repeated full-suite runs and record the failure shape
    2. Fix it where the cause is ours; otherwise skip the affected cases naming the reason, and add a Deferred entry to docs/PLAN.md
