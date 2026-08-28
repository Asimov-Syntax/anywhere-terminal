# Review Round 5

- Date: 2026-08-28
- Cycle: 2
- Mode: verification
- Scope: range `4e6300ee903002856a34213af0c18825b4d1d8a9..c4ba679bfeb7e46da00a0e7bea91e9e344d81d23` plus every round-4 finding boundary and the I5/I9 author addendum
- Scope lock: passed — remediation, review metadata, and two additional invariant-tag boundaries inside B2's accepted coverage-claim cone; no production capability or contract change
- Head: `c4ba679bfeb7e46da00a0e7bea91e9e344d81d23` (clean)
- Reviewable lines: 0 (plus 465 added test/support lines; Asimov review/change metadata skipped)
- Verification evidence: caller reports `pnpm run check-types` clean; 234 files / 4,737 tests passing; `pnpm run bench:scale` passing at presence 0.1 ms and model 31.8 ms; Biome findings byte-identical to clean main when measured with one binary/config. Review commands were not rerun. Targeted scratch probes confirmed installed Vitest exposes `skipIf`/`runIf` and that the scanner marks their disabled declarations active.
- Agents spawned: `asm-review-contracts`, `asm-review-logic`, `asm-review-frontend`
- Agents skipped: data-security/performance/reuse — remediation cone did not require those lenses; S2 was verified inline
- Verdict: BLOCK
- Open counts: BLOCK 2, WARN 2, SUGGEST 0
- Fixed this round: B13, B14, S2, S3; B2/I3; addendum F1/I9 and F2/I5

## Open findings

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-contracts` + `asm-review-frontend`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/sourceBytes.test.ts:113`; `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/webview/worktree/WorktreeView.test.ts:344`
- title: I2 and I10 still certify corrected outputs without covering the violating source boundary
- evidence: I2's strengthened renderer test pins its DOM target and now distinguishes the terminal SVG, tooltip, and accent correctly, but it still starts from `singleRepoPresence()`, whose synthetic `main-shell` row already declares `agentSource: "none"`. It never drives title/spinner evidence through production identity resolution, so the registry stimulus — title-only evidence incorrectly establishing a brand identity — cannot make the tagged test red. I10's AST scan resolves direct imports, import aliases, namespaces, promises aliases, and one flat destructure, but does not propagate bindings through `const wipe = fs.promises.rm`, assignment/nested destructuring, or string-literal element access such as `fs.promises["rm"](dir)`; those calls reach neither `direct` nor the property-access branch. Its binding sets are also global rather than lexical, so a harmless parameter/local that shadows an imported `rm` is falsely reported. Boundary inventory searched: title evidence → projected `agentSource` → rendered icon; fs import → namespace/direct/destructured/assigned binding → lexical shadow → identifier/property/element call. Affected: I2 production identity classification; I10 assignment aliases and element access. Verified safe this round: I3 direct activation, direct/named/aliased import calls, namespace calls, `fs.promises` property calls, and flat object destructuring.
- impact: A title-only spinner can still become a branded identity, or in-scope removal code can invoke a destructively aliased/element-accessed fs function, while every I2/I10 tag remains green. The false-positive shadow handling can also reject harmless code and pressure maintainers to weaken the rule.
- suggestedFix: Build the I2 tagged row from production pane/title evidence through the identity/projector seam before rendering it. For I10, track lexical bindings and alias propagation, including namespace-property assignment, assignment/nested destructuring, element access, and optional chains; add fixtures for each bypass and for harmless parameter/local shadowing.
- status: open — persists from rounds 1-4; I3 is fixed, I2/I10 remediation incomplete
- triage: accepted in prior rounds; current evidence pending author triage

### B12

- ID: B12
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/sourceSources.ts:38`
- title: Conditional and element-access disabled tests still count as active coverage
- evidence: The repaired scanner correctly handles direct `.skip`/`.todo` suites and the new `const it` shadow fixture. It does not recognize Vitest's installed `skipIf`/`runIf` modifiers because `INERT` omits them, and `chainOf()` does not resolve string-literal element access. Targeted probes returned active declarations for `describe.skipIf(true)(..., () => it("[I1]"))`, `describe.runIf(false)(...)`, and `it.skipIf(true)("[I4]", ...)`; runtime inspection confirmed all four conditional APIs exist in Vitest 4.0.18. `describe["skip"](...)` is another disabled-suite form the property-only chain misses. Shadow handling also remains incomplete for function-declaration and function-hoisted `var` bindings because `scopeDeclarations()` returns at a nested scope before recording its declaration in the containing scope. Repository search found no current tagged test with a runner-name rebinding or aliased runner import, so the implemented shadow check is not over-broad against today's legitimate tagged corpus; the remaining problem is false active coverage.
- impact: A conditionally or element-access disabled invariant suite, or a shadowed runner form not covered by the single fixture, can retain the last `[I#]` tag while no proof executes.
- suggestedFix: Treat `skipIf` and `runIf` conservatively as non-covering unless execution can be proven, recognize string-literal element-access chains, and correctly record function/hoisted declarations in their containing lexical scope. Add negative fixtures for `describe.skipIf(true)`, `describe.runIf(false)`, `it.skipIf(true)`, `describe["skip"]`, and a function-declaration shadow.
- status: open — persists from round 4; direct skip/todo and const-shadow boundaries fixed, conditional/element/function-shadow boundaries remain
- triage: accepted round 4; remediation incomplete

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:317`
- title: Assembly teardown still bypasses the production lifecycle owners
- evidence: The new `afterEach` closes `captured.runtime` and disposes `context.subscriptions`, which fixes the loopback server and registered-disposable portion of W4. It never calls `deactivate()`. Production deliberately keeps `_activeAgentHookController` and `_activeSessionManager` outside `context.subscriptions`; only `deactivate()` invokes `AgentHookController.dispose()` (including `revokeAll()` and controller bookkeeping), flushes and disposes `SessionManager`, and enforces controller-before-PTY ordering. Disposing the raw runtime leaves its controller believing it still owns that runtime. The subscription loop also catches every disposal error silently rather than distinguishing idempotent double-disposal from a real teardown failure.
- impact: The assembly suite still does not release or exercise all lifecycle state created by `activate()`, so singleton/controller/session resources and teardown defects can survive between cases or be hidden — the same suite-order sensitivity W4 covers.
- suggestedFix: Await the exported `deactivate()` in `afterEach` so the production owners and ordering perform teardown; then dispose context subscriptions as the host would, and do not silently swallow unexpected disposal errors.
- status: open — persists from round 4; runtime/server and context-subscription cleanup fixed, controller/session-manager lifecycle incomplete
- triage: accepted round 4; remediation incomplete

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/bench/scale.bench.ts:105`
- title: Benchmark still reimplements the canonical repository fixture builder
- evidence: No remediation touched the benchmark fixture; repository initialization, Git identity, commit, worktree creation, and teardown remain independently implemented from `worktreeMutations.integration.test.ts`.
- impact: Benchmark and integration repository shapes can drift.
- suggestedFix: Extract a runtime-neutral fixture helper and reuse it from both consumers, or ask the user to grant an explicit risk acceptance with owner, expiry, and reactivation trigger.
- status: open — persists from rounds 1-4
- triage: author-deferred is not a review status and is non-gating only if the user grants `risk-accepted`; no such grant exists

## Fixed findings

### B13

- status: fixed
- evidence: `extension.crossLayer.test.ts` and its copied router are deleted. I6/I7 now send loopback hook requests through real `activate()` routing, real pane evidence, and the real projector captured before the test-only published-row merge. The prior routing mutation is reported to fail both I6 tests.

### B14

- status: fixed
- evidence: The cap test now asserts exactly `MAX_WORKTREES_PER_REPO` rows before expansion, all 34 after expansion, and removal of the Show-all affordance.

### S2

- status: fixed
- evidence: The scale comparison builds explicit one-pane and ten-pane fixtures, verifies both fixture sizes, and compares their process-table and registry-read counts.

### S3

- status: fixed
- evidence: The unused `withoutComments()` lexer is deleted.

### B2/I3

- status: fixed
- evidence: The direct external-row activation test is tagged `[I3]` and checks both focus and preview settings resolve to preview.

### Addendum F1 / I9

- status: fixed
- evidence: The spinner-stopping transition is tagged `[I9]` and asserts the emitted title is stripped and undecorated.

### Addendum F2 / I5

- status: fixed
- evidence: Historical subagent rows assert absence of the live marker, and the conflicting `status: "running", live: false` case is tagged `[I5]`.

## Specialist conflict adjudication

- The logic specialist's stale-`captured.projection` concern was refuted: `mutationBindings().forceRebuild()` awaits `gate.request()`, `rebuild()` awaits `requestProjection()`, and the projector mock writes `captured.projection` before that promise resolves. The following fixed-count `settle()` is unnecessary for this value but cannot make the read stale.
- The logic specialist's lifecycle finding is accepted as W4 above: raw runtime plus `context.subscriptions` is not the complete `activate()` owner graph.

## Triage — author, round 5

All four findings accepted; none rebutted. B12 and B2 are accepted as *incompletely remediated*
rather than as new defects — the round-4 fixes closed the boundaries they named and the reviewer
found further ones, which is the fifth consecutive round in which a hand-written analyzer of mine
lost to a spelling I had not enumerated.

| ID | Status | Triage |
|---|---|---|
| B12 | accepted | Correct. `INERT` omits `skipIf`/`runIf`, `chainOf()` cannot read `describe["skip"]`, and `scopeDeclarations()` returns before recording a function declaration in its containing scope. Not patching a sixth scanner — see the thrash stop below. |
| B2 | accepted | Both halves correct. I10: the resolver misses assignment aliases, element access, and nested destructuring, and its binding sets are global rather than lexical so a harmless parameter named `rm` is falsely reported. I2: the tagged test renders a decision it was handed — `singleRepoPresence()` already declares `agentSource: "none"` — so the registry stimulus cannot make it red. |
| W4 | accepted | Correct and worse than the severity suggests. `AgentHookController` and `SessionManager` deliberately live outside `context.subscriptions` (`src/extension.ts:1412-1415`); only `deactivate()` (`src/extension.ts:1436-1477`) enforces controller-before-SessionManager ordering. Disposing the raw runtime leaves its controller believing it still owns it, and the `catch {}` hides disposal failures. |
| W2 | accepted, **user decided: fix** | The chair is right that "author-deferred" is not a review status. Put to the user, who chose the real fix over a risk acceptance. |

### Thrash stop — declared, and resolved as option 1

Trigger: I10 has survived two designed fix attempts (round 3 introduced the source rule as a
regex; round 4 replaced it with an AST binding resolver; round 5 shows both incomplete), and D1's
scanner has now failed in five consecutive rounds through five different mechanisms.

Presented to the user with the three permitted options. The user chose **option 1 — hand back to
`asimov-plan` for a designed fix** and additionally approved narrowing the blueprint acceptance
clause (see workflow.md Notes). No blocker was risk-accepted; no extension round was taken.

The diagnosis behind the handback: every failed mechanism was an attempt to decide **statically,
by hand**, a question some existing tool already owns — "which tests actually execute" (vitest) and
"what does this identifier refer to" (the TypeScript checker). The fix is to stop answering those
questions myself, not to answer them more carefully a sixth time.
