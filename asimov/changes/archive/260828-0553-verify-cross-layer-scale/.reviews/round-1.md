# Review Round 1

- Date: 2026-08-28
- Cycle: 1
- Mode: discovery
- Scope: range `main..HEAD`
- Head: `d779c3bad9adb88eac338b51623cf1af939f95b2` (clean)
- Reviewable lines: 13 (plus 1,132 changed test/support lines)
- Verification evidence: `bun run asm change verify-status verify-cross-layer-scale` recorded all tasks `[x]`, exit 0; review commands were not rerun
- Agents spawned: `asm-review-logic` ×2, `asm-review-contracts`, `asm-review-performance`, `asm-review-reuse`
- Agents skipped: `asm-review-data-security` (no persistence/auth/input boundary), `asm-review-frontend` (no changed production UI behavior; webview tests reviewed by chair/logic)
- Verdict: REJECT
- Counts: BLOCK 11, WARN 2, SUGGEST 2

## B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-contracts + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/coverage.test.ts:61`
- title: Commented-out tests count as active invariant coverage
- evidence: `DECLARATION` is a raw-text regex with no comment awareness. The regression fixture at lines 149-160 explicitly expects `// it("[I1] ...")` to be returned as active. A targeted scratch probe reproduced both the commented and real declarations as active.
- impact: Removing the last executable test while leaving its declaration commented out keeps the registry green, directly violating approved D1 assertion 3 and task 1_2's acceptance that losing the last active test fails the suite.
- suggestedFix: Parse TypeScript call expressions with the installed TypeScript tooling, or otherwise use a parser that excludes comments/string contexts; reverse the fixture expectation so the comment is absent.
- status: open
- triage: pending

## B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/agentHooks/agents/claude.test.ts:508`
- title: Several invariant tags are attached to assertions that do not prove the invariant
- evidence: The `[I16]` test only proves the reducer carries an untrusted path; the actual no-open/mismatch assertions at `src/worktree/presenceProjector.test.ts:1287-1323` are untagged. The same mechanism affects I11 (one-level/no-pane assertions untagged at `WorktreeView.test.ts:461-466`, tag only on activation), I12 (stale-parent decay untagged at `WorktreeHost.delegations.test.ts:475-496`, tag only on recovery), I10 (tag proves host delegation, not absence of direct deletion), I5 (fixture supplies `live:false` rather than proving transcript derivation), and I1 (degradation record asserted without proving an existing row survives). Boundary inventory searched: reducer, reported-session lookup, subagent rendering/activation, freshness decay, removal delegation, transcript rendering, and failed presence resolution. Affected: I1, I5, I10, I11, I12, I16; cross-layer I9/I14/I15 are recorded separately. Verified safe in this mechanism: I6's transition pair.
- impact: The actual behavioral assertions can be deleted or broken while a neighboring tagged test keeps the registry green; the registry therefore overstates full-clause coverage for multiple rows.
- suggestedFix: Put `[I<n>]` on every executable assertion that actually covers each clause, remove or narrow tags on adjacent facts, and add missing assertions where no real covering test exists.
- status: open
- triage: pending

## B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/agentHooks/agents/claude.test.ts:93`
- title: I13 hardcodes the state universe instead of checking the production mapping
- evidence: The new reachability assertion hardcodes `['done', 'waiting', 'working']`; the projector-side tagged test separately hardcodes the same three mapping cases. Neither derives the state set from the production activity mapping. Adding a newly mapped state that no hook event produces leaves both assertions green.
- impact: I13's exact failure mode—"a state no event can produce does not exist"—can regress without failing the test named for it.
- suggestedFix: Define or export one production turn-state-to-activity table and compare the reducer-produced set against its keys, while separately asserting the table is one-to-one/exhaustive.
- status: open
- triage: pending

## B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.crossLayer.test.ts:139`
- title: I7 exercises agent disablement, not runtime disposal/reload
- evidence: The scenario calls `setAgentEnabled('claude', false)`. Production reload runs controller/runtime disposal; `AgentHookRuntime.dispose()` additionally marks the runtime disposed and closes the server. A disposal-specific regression can leave the disable path intact.
- impact: Hook evidence can survive or be republished across an actual reload while the named I7 test remains green.
- suggestedFix: Drive `runtime.dispose()` (and replacement runtime/reload setup as needed), then assert the old pane projects from inference and cannot regain status from the disposed source.
- status: open
- triage: pending

## B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:859`
- title: I9 bypasses the webview title-reporting boundary and observes the wrong message direction
- evidence: The test mutates an already-published host-side `publishedRow`, then explicitly calls `forceRebuild`. Its `outbound` counter is webview-to-host traffic, but this stimulus never enters through xterm/`paneEvidenceReporter`; the existing source-boundary assertion at `src/webview/integration/paneEvidenceReporting.test.ts:146-155` is untagged. The test cannot prove "no host message" or "no rebuild" because it bypasses the source and forces a rebuild itself.
- impact: Spinner frames may be sent to the host and trigger rebuilds/posts while the tagged cross-layer test stays green.
- suggestedFix: Stimulate a real title change through the webview reporter/factory composition, then assert webview-to-host messages, rebuild count, host-to-surface posts, identity, and rendered node all remain unchanged for frame-only movement.
- status: open
- triage: pending

## B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic + asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:882`
- title: I14 never exercises an agent becoming working after confirmation
- evidence: The composed scenario changes only `dirtyPaths` from one file to two. Approved D5 and the invariant also require that an agent which becomes working after the prompt is never force-removable.
- impact: A regression that force-removes a worktree after its agent becomes working passes the only tagged I14 composed test.
- suggestedFix: Publish a working agent row after the confirmation is shown, confirm, and assert no forced remove runs and the changed blocker set is re-presented.
- status: open
- triage: pending

## B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:110`
- title: I15 timeout fixture produces agreement, not git/filesystem disagreement
- evidence: The mock removes the registration and recursively deletes the directory before returning `timedOut: true` at line 129. After rebuild, both sources agree the worktree is gone; assertions at lines 927-932 pass on the unconditional timeout wording and list count.
- impact: The reconciliation branch that detects partial application or git/filesystem disagreement can be broken or removed while the tagged cross-layer I15 test remains green.
- suggestedFix: Model a partial outcome by moving exactly one source (registration or directory), then assert the rebuilt result names that disagreement as indeterminate; retain a separate timeout/rebuild assertion if desired.
- status: open
- triage: pending

## B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:941`
- title: Atomicity assertion is vacuous when presence is empty
- evidence: The test proves only that an envelope exists, then checks that presence keys are a subset of tree ids. It never asserts either set is non-empty or that the seeded linked worktree appears in both. `named = []` passes.
- impact: Dropping all presence rows satisfies the atomicity test, so the test does not establish that paired tree/presence evidence was produced.
- suggestedFix: Select an envelope containing the seeded worktree, assert non-empty tree and presence keys and the expected id in both, then perform the subset assertion.
- status: open
- triage: pending

## B9

- ID: B9
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.scale.test.ts:56`
- title: D2's unchanged-pane no-re-resolution envelope is not tested
- evidence: Approved D2 and task 3_1 require exact process/registry reads and no re-resolution for unchanged pane keys. The suite returns a `sessionMtime` spy but never supplies resolvable sessions, performs an unchanged-key comparison, or asserts resolution calls stay flat.
- impact: Pane/session resolution can regress to per-rebuild work while every new scale test passes.
- suggestedFix: Use resolvable sessions, project twice with unchanged `(paneId,cwd,ptyPid)`, and assert the session-resolution dependencies do not rise on the second projection.
- status: open
- triage: pending

## B10

- ID: B10
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/providers/WorktreeHost.scale.test.ts:141`
- title: D3's joined-path suite omits forced refresh and independent affected repos
- evidence: The file tests burst collapse, an untouched sibling, and a paced stream. Approved D3 requires five exact facts, including forced refresh bypassing the floor immediately and counts holding independently for multiple affected repositories.
- impact: Composition regressions that delay force refresh or aggregate two active repositories into one gate pass the new joined-path suite.
- suggestedFix: Add a force request inside an active floor window and a two-affected-repo scenario, asserting immediate and exact per-repo list counts.
- status: open
- triage: pending

## B11

- ID: B11
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/providers/WorktreeHost.secondSurface.test.ts:93`
- title: D4's second-surface test instruments only half the required source counters
- evidence: `sourceCost()` records watchers, git invocations, and projection calls. Approved D4 also names registry reads, process-table reads, and polling timers; the projector is stubbed and timer creation is not counted.
- impact: A second surface can add a source read or an extra 5-second poll while the claimed D4 scenario stays green.
- suggestedFix: Instrument every D4 counter, including the real projector dependencies and clock timer creation, and compare the complete snapshot before/after the second surface.
- status: open
- triage: pending

## W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/bench/scale.bench.ts:115`
- title: The model benchmark reports ten worktrees but constructs eleven
- evidence: A Git repository already has its main worktree; the loop adds `WORKTREES = 10` linked worktrees. `buildWorktreeTree` therefore measures 11 rows while `MODEL_REBUILD.fixture` and output say `1 repo × 10 worktrees`.
- impact: The recorded number is not measured at the published fixture size, making comparisons and future budget interpretation inaccurate.
- suggestedFix: Create nine linked worktrees plus main, or explicitly change the published metric and fixture everywhere through planning rather than relabeling the current run.
- status: open
- triage: pending

## W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-reuse
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/bench/scale.bench.ts:105`
- title: Benchmark reimplements the canonical real-repository fixture builder
- evidence: `buildFixtureRepo()` repeats temp repo initialization, Git identity, initial commit, and worktree creation from `src/worktree/worktreeMutations.integration.test.ts:23-56`, despite D2 naming reuse of those fixtures.
- impact: Setup can drift between the integration fixture and benchmark, changing what the latency number measures.
- suggestedFix: Extract/parameterize the existing integration fixture builder with teardown and reuse it from the standalone benchmark.
- status: open
- triage: pending

## S1

- ID: S1
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-reuse
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/coverage.test.ts:35`
- title: Recursive TypeScript source walker is duplicated
- evidence: The same recursive `readdirSync` plus `.ts` filter exists in `src/test/invariants/sourceBytes.test.ts:34-44`.
- impact: Source-discovery rules can drift between the two invariant audits.
- suggestedFix: Extract a shared invariant-test file walker while keeping each audit's filtering local.
- status: open
- triage: pending

## S2

- ID: S2
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.scale.test.ts:73`
- title: The one-pane-versus-ten assertion never creates a one-pane case
- evidence: The test titled "whether one pane or ten" calls `wireAtScale()` once, which always creates ten panes, and repeats the same count assertions as the preceding tests.
- impact: The assertion adds no evidence for its stated comparison and can mislead future reviewers about fixture coverage.
- suggestedFix: Parameterize the harness by pane count and compare 1 versus 10, or remove/rename the redundant case.
- status: open
- triage: pending


---

## Triage — author, round 1

Every finding accepted. Nothing rebutted. The round is correct that this change's own
product — verification — does not verify what it claims in eleven places, and B1 is the
worst of them because it is in the file whose only job is to keep the others honest.

| # | Status | Triage |
|---|---|---|
| B1 | accepted | Confirmed by reading the fixture: it expects `["[I1] a tag in a comment is not coverage", "[I2] a real one"]`, so the commented declaration IS counted. The test title states the opposite of what it asserts. D1 names comment-immunity as one of the scan's three required properties; it has none of it. |
| B2 | accepted | D1 recorded "nothing machine-checks that a test tagged [I7] asserts I7" as a known limit and made the review round the check. The round did the check and it failed. Retag against the real covering assertions. |
| B3 | accepted | Both sides hardcode the same three states, so a mapped-but-unreachable state changes neither. The universe must come from the production table. |
| B4 | accepted | `setAgentEnabled(false)` is entitlement revocation, not disposal. I7 says "across a window reload"; disposal is what a reload is. |
| B5 | accepted | Correct on both counts: the test mutates an already-published host row and counts webview→host traffic, so it never stimulates the webview boundary I9 names. |
| B6 | accepted | D5's I14 row has two clauses. Only the blocker-set-changed clause is covered; "an agent that became working is not force-removable" is not. |
| B7 | accepted | Narrowed, and the narrowing matters: the timeout leg IS genuinely covered and was red-demonstrated. What is missing is I15's second clause — a state git and the filesystem disagree about. The fixture moves both sources together, so that clause has no test. |
| B8 | accepted | An empty `rowsByWorktreeId` satisfies the subset assertion. The test must prove both halves are populated before the subset relation means anything. |
| B9 | accepted | D2's third condition. Asserting the first two and not the third is the same defect class as B8. |
| B10 | accepted | D3 enumerates five facts; three are asserted. |
| B11 | accepted | D4 enumerates six counters; three are instrumented, and the projector is stubbed so a seventh cannot be seen. |
| W1 | accepted | `git init` makes the main worktree, then the loop adds ten — eleven, against a published fixture of ten. Fixing the fixture, not the bound (D2 forbids moving either; this moves neither, it makes the fixture match what is published). |
| W2 (reuse) | accepted | Fold into W1's fix. |
| S1 | accepted | Extract the source walker shared with sourceBytes.test.ts. |
| S2 | accepted | Fold into B9's fix. |
