# Review Round 2

- Date: 2026-08-28
- Cycle: 1
- Mode: verification
- Scope: requested range `9ce4fa5..HEAD`; remediation delta `d779c3bad9adb88eac338b51623cf1af939f95b2..fe792fa9880e6065d09035f7d30f13a1b747f628` plus every round-1 finding boundary
- Scope lock: passed — changes after round 1 are remediation, review metadata, and one behavior-neutral-intended table export; no new capability/design contract
- Head: `fe792fa9880e6065d09035f7d30f13a1b747f628` (clean before this round file)
- Reviewable lines: 7 (plus 288 changed test/support lines)
- Verification evidence: caller reports check-types clean, 235 files / 4,734 tests passing, both scale budgets passing, and only four baseline Biome findings outside touched files; review commands were not rerun
- Agents spawned: `asm-review-logic`, `asm-review-contracts`, `asm-review-performance`
- Agents skipped: data-security/frontend/reuse — remediation cone does not touch their production surfaces; reuse findings were verified by chair
- Verdict: REJECT
- Open counts: BLOCK 5, WARN 2, SUGGEST 1
- Fixed this round: 8 prior findings

## Open findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/coverage.test.ts:49`
- title: Declaration scanner still counts declarations embedded in literals
- evidence: Comment blanking fixes the round-1 comment case, but `withoutComments()` preserves string/template contents and `DECLARATION` still scans the entire transformed source as raw text. A targeted probe with `const fixture = 'it("[I1] fake declaration", () => {})'` returned both fake I1 and real I2 declarations. The new fixture escapes the embedded title quote, so it cannot match and does not test this boundary. Boundary inventory: line comments and block comments are now safe; ordinary strings, template literals, and regex literals remain affected.
- impact: Declaration-shaped fixture text can keep an invariant covered after its last executable tagged test is removed. B1 persists from round 1 through the same raw-text causal mechanism.
- suggestedFix: Parse TypeScript call expressions with the TypeScript compiler API and accept only executable `it`/`test` calls; add negative fixtures for ordinary strings, templates, regex literals, line comments, and block comments.
- status: open — persists from round 1
- triage: accepted round 1; remediation incomplete

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/providers/WorktreeHost.delegations.test.ts:499`
- title: I1, I10, I11, and I12 still rely on non-covering tags
- evidence: I1's new tags assert failure outcomes but not the successful-row→failed-scan retention transition; the actual retention tests at `src/worktree/presenceProjector.test.ts:243,254` remain untagged. I10 remains on the host's mocked delegation call and cannot see a direct filesystem removal inside/beside the mutation implementation. I11's new test reads `dataset.paneId` from the `.wt-hist` container, not the `.wt-srow` subagent rows, so adding pane identity to a row passes. I12's sole tag still asserts recovery to running without first asserting decay; if decay is deleted, it stays green, while the actual decay tests at lines 475-496 remain untagged. Boundary inventory searched: registry failure/retention, host→mutation→git removal, subagent model/DOM/activation, parent freshness decay, transcript publication, reported-path lookup. Affected: I1, I10, I11, I12. Verified safe after remediation: I5 and I16.
- impact: The registry remains green when four invariant clauses are broken or their actual covering tests are removed. B2 persists from round 1.
- suggestedFix: Tag the actual I1 retention transitions; put I10 on the Git/filesystem mutation boundary; assert pane identity on non-empty `.wt-srow` elements or the row model; tag I12's decay tests and keep recovery as supplementary coverage.
- status: open — persists from round 1
- triage: accepted round 1; the workflow note does not rebut or close the code evidence

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:924`
- title: I14 still does not make the agent become working after confirmation
- evidence: The new scenario seeds `publishedRow.activity = 'running'` before `assemble()` and before the initial removal request. It proves refusal for an already-working agent, not the accepted transition where a confirmation is shown while non-working and the agent becomes working before execution.
- impact: Code can snapshot a non-working blocker set at prompt time and fail to re-evaluate newly working agents while both I14 tests pass.
- suggestedFix: Start with a non-working row, open a real force confirmation, publish/rebuild the same row as working, then submit and assert re-prompt/refusal with no Git removal.
- status: open — persists from round 1
- triage: accepted round 1; remediation covers the steady state, not the required transition

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:990`
- title: I15 fixture still leaves registration and filesystem state in agreement
- evidence: `removeLeavesRegistration = true` skips the whole mock mutation block, leaving both `registered` and the linked directory present. The command's mocked exit 0 disagrees with the post-state, but the two rebuilt state sources still agree. The accepted remediation required moving exactly one of registration or filesystem state.
- impact: Reconciliation specifically for a Git-listing/filesystem mismatch can be deleted while this test remains green.
- suggestedFix: Remove the registration while retaining the directory, or delete the directory while retaining the registration, then assert the rebuilt observation names that exact mismatch as indeterminate.
- status: open — persists from round 1
- triage: accepted round 1; remediation models command/post-state disagreement, not the named state-source disagreement

### B9

- ID: B9
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.scale.test.ts:84`
- title: D2 repair tests the reported-session cache, not unchanged pane-key resolution
- evidence: The test calls `store.reportTurn`, so `reportedIdentity()` resolves through the window-lifetime `resolveReportedSession(sessionId)` cache and short-circuits `identify()`. D2's named cache is `PaneState.proven` keyed by unchanged `(paneId, ptyPid, cwd)` at `presenceProjector.ts:410-425`. Removing that guard does not affect the new test.
- impact: Inferred pane identity can re-run process/session resolution on every rebuild while B9's assertion stays green.
- suggestedFix: Resolve an ordinary pane successfully through the registry/process path, project again with unchanged pane facts, and assert the second projection does not invoke the pane resolution dependencies again.
- status: open — persists from round 1
- triage: accepted round 1; remediation measured a different cache

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/bench/scale.bench.ts:105`
- title: Benchmark still reimplements the canonical repository fixture builder
- evidence: The worktree count was corrected, but `buildFixtureRepo()` still duplicates temp-repository initialization, Git identity, commit, worktree creation, and teardown behavior from `src/worktree/worktreeMutations.integration.test.ts` rather than sharing it.
- impact: The integration fixture and benchmark can drift and silently measure different repository shapes.
- suggestedFix: Extract a runtime-neutral fixture helper and reuse it from both the integration test and plain Bun benchmark.
- status: open — persists from round 1
- triage: accepted round 1; not addressed by the off-by-one fix

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.ts:80`
- title: Exported activity universe is mutable
- evidence: `TURN_ACTIVITY` changed from module-private to an exported writable `Record`. Any importer can assign a different activity, and production projections read the same live object.
- impact: The behavior-neutral-intended export creates a new internal public mutation surface that can alter activity projection and destabilize I13 tests.
- suggestedFix: Export a runtime-frozen, readonly exhaustive mapping, for example `Object.freeze({...} satisfies Record<AgentTurnReport['state'], PaneActivity>)`.
- status: open — new within the B3 production impact cone
- triage: pending

### S2

- ID: S2
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.scale.test.ts:76`
- title: One-pane-versus-ten assertion still creates only ten panes
- evidence: The test remains unchanged: `wireAtScale()` always creates ten panes and the case repeats prior count assertions.
- impact: It still supplies no evidence for its stated comparison.
- suggestedFix: Parameterize pane count and compare 1 versus 10, or remove/rename the redundant test.
- status: open — persists from round 1
- triage: accepted round 1; not addressed

## Fixed findings

### B3
- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/agentHooks/agents/claude.test.ts:108`
- title: I13 hardcoded state universe
- evidence: The reducer test now compares produced states against the production `TURN_ACTIVITY` keys, and the exhaustive record remains the projection's consumer.
- impact: The original mapped-but-unreachable state gap is closed; mutability of the new export is recorded separately as W3.
- suggestedFix: none for B3
- status: fixed
- triage: accepted round 1; verified fixed round 2

### B4
- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.crossLayer.test.ts:139`
- title: I7 used disablement rather than disposal
- evidence: The test now disposes the runtime, verifies inference resumes, and verifies the disposed endpoint cannot republish.
- impact: Actual runtime-disposal behavior is covered.
- suggestedFix: none
- status: fixed
- triage: accepted round 1; verified fixed round 2

### B5
- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/webview/integration/paneEvidenceReporting.test.ts:146`
- title: I9 bypassed the source boundary
- evidence: The source-boundary no-message assertion is now tagged I9, while the assembly test is narrowed to its real far-end claim and establishes a rendered-node premise.
- impact: Source suppression and render suppression are now covered at the layers that own them.
- suggestedFix: none
- status: fixed
- triage: accepted round 1; verified fixed round 2

### B8
- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:1012`
- title: Atomicity passed with empty presence
- evidence: The test now requires at least one envelope containing the seeded worktree in both tree and presence before the subset assertion can pass.
- impact: Empty presence no longer satisfies the scenario.
- suggestedFix: none
- status: fixed
- triage: accepted round 1; verified fixed round 2

### B10
- ID: B10
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/providers/WorktreeHost.scale.test.ts:192`
- title: D3 omitted forced refresh and two affected repos
- evidence: Added cases arm the floor before forcing an immediate rebuild and assert exact independent counts when two repositories are affected.
- impact: All five D3 facts are now represented on the joined path.
- suggestedFix: none
- status: fixed
- triage: accepted round 1; verified fixed round 2

### B11
- ID: B11
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/providers/WorktreeHost.secondSurface.test.ts:126`
- title: D4 instrumented only half its counters
- evidence: The test now composes production projector wiring, instruments all six counters, proves each moved for the first surface, and requires all remain flat for the second.
- impact: The full D4 source-cost inventory is covered.
- suggestedFix: none
- status: fixed
- triage: accepted round 1; verified fixed round 2

### W1
- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/bench/scale.bench.ts:118`
- title: Benchmark constructed eleven worktrees
- evidence: The fixture now adds nine linked worktrees plus main, matching the published total of ten without changing the bound.
- impact: The benchmark fixture count now matches its label.
- suggestedFix: none
- status: fixed
- triage: accepted round 1; verified fixed round 2

### S1
- ID: S1
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/sourceSources.ts:14`
- title: Recursive source walker was duplicated
- evidence: Both invariant tests now import the shared `tsFiles()` helper.
- impact: Source-discovery rules no longer have two copies.
- suggestedFix: none
- status: fixed
- triage: accepted round 1; verified fixed round 2


---

## Triage — author, round 2

All eight findings accepted, none rebutted. Every persisting blocker was verified against the
code before triage, and each was right.

| # | Status | Triage |
|---|---|---|
| B1 | accepted | Comments were blanked but string, template and regex CONTENTS were still scanned — and my new fixture dodged it by escaping the embedded quote, which is the same self-certifying defect round 1 found, one layer in. Replaced the regex-over-transformed-text with a single-pass scanner that tracks comment/string/template/regex state and only reports call sites reached as code. The fixture now carries all three literal forms and asserts their exclusion. |
| B2 | accepted | I1's tags asserted failed outcomes rather than retention; tagged the two projector tests that prove a proven row survives a failed read. I11 read `.wt-hist`, the container that never carried a paneId; it reads every `.wt-srow` now. I12 tagged recovery without decay; the two decay tests are tagged. I10 tagged onto the integration tests where real git does the deleting, and its real limit is written into the registry: nothing here would notice an `fs.rm` added elsewhere — that needs a lint rule over the source, not a test, and it is not in this change. |
| B6 | accepted | The row was running before assembly, so the first assessment refused and the transition the name promised never happened. The dialog now opens on a confirmable removal, the agent starts working underneath it, and the confirmation is then refused — walked through to the refusal copy and the absent retry. |
| B7 | accepted | The flag skipped the whole simulated mutation, so both sources stayed put and only the exit code disagreed. It moves exactly one now: the directory goes, the registration stays. |
| B9 | accepted | Correct and specific — `reportTurn` routes through `resolveReportedSession` and never reaches `identify()`, so deleting the pane-key guard did not fail the test. Rewritten against `PaneState.proven` with a resolvable running session, and red-demonstrated by deleting that guard. |
| W3 | accepted | `TURN_ACTIVITY` is `Readonly` and `Object.freeze`d. |
| W2 | accepted, not fixed | The bench's repo builder still duplicates the integration fixture. Non-blocking, and extracting a runtime-neutral fixture shared by a bun script and a vitest suite is a change of its own shape — recorded rather than rushed into a round-2 fix. |
| S2 | accepted, not fixed | Same call: the "one pane or ten" test is redundant rather than wrong. |
