# Review Round 4

- Date: 2026-08-28
- Cycle: 2
- Mode: discovery
- Scope: range `929a56f53fe9..4e6300ee903002856a34213af0c18825b4d1d8a9`
- Head: `4e6300ee903002856a34213af0c18825b4d1d8a9` (explicit commit range reviewed; working tree had out-of-scope analytics updates when the review began)
- Reviewable lines: 16 (plus 1,911 added test/support lines; docs and Asimov state/review artifacts skipped)
- Verification evidence: caller reports `pnpm run check-types` clean; 235 files / 4,737 tests passing; `pnpm run bench:scale` passing at presence 0.1 ms and model approximately 31 ms; four Biome findings reproduced on clean main and outside touched files. Review commands were not rerun. Targeted parser/regex scratch probes only.
- Agents spawned: `asm-review-contracts`, `asm-review-logic` ×2, `asm-review-performance`, `asm-review-frontend`, `asm-review-reuse`
- Agents skipped: `asm-review-data-security` — no persistence/auth/input boundary changed
- Verdict: REJECT
- Counts: BLOCK 4, WARN 2, SUGGEST 2

## Risk map and full-flow trace

- Invariant traceability: `docs/DESIGN.md` § 8.4 → `registry.ts` → AST declaration inventory → active/inert filtering → tagged tests. Highest risk is a green registry with no runner-executed proof.
- I10 enforcement: scoped production source inventory → destructive-fs detection → `[I10]` source assertion. Highest risk is a realistic import spelling bypassing the only source-level proof.
- Hook composition: loopback hook request → Claude reducer → extension status routing → pane evidence → projector → row. The I6 tagged flow replaces the extension routing step with a test-local copy.
- Scale: watcher event → trailing debounce → per-repo rebuild floor → Git listing → cached envelope/fan-out. Burst, stream, sibling-repo, forced-refresh, and per-repo counts are covered.
- Second surface: attachment/display edge → cached delivery; watcher/Git/registry/process/projection/timer counters remain flat. Covered.
- Render cap: tree input → `MAX_WORKTREES_PER_REPO` slice → visible Show-all affordance → uncapped rerender. The current test proves affordance and expansion, but not exact application of the published cap.

## Open findings

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-logic` + `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/sourceBytes.test.ts:59`; `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/webview/worktree/WorktreeView.test.ts:339`; `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/webview/worktree/WorktreeView.test.ts:366`
- title: I2, I3, and I10 still claim complete traceability through checks that miss their named failure
- evidence: I10's raw-text regex recognizes only literal qualifiers named `fs`, `fsp`, `fsPromises`, or `promises`. Targeted probes returned false for `import { rm } from "node:fs/promises"; rm(...)`, `import * as nodeFs from "node:fs"; nodeFs.rmSync(...)`, destructuring, and aliased named imports; these are realistic in-scope forms, and `src/worktree/hasGitRepo.ts` already uses a named `node:fs` import. I2's only tag is on a synthetic already-projected UI row and never drives the registry stimulus where a decorative/title-only signal incorrectly establishes `agentSource`. I3's changed tags cover the label and context-menu omission, while the executable direct-click proof that an external row resolves to preview rather than focus remains untagged at `WorktreeView.test.ts:1037`. Boundary inventory searched: spinner/title evidence → projected identity → rendered icon; external row label/context menu/direct activation; host delegation → mutation/Git → scoped production filesystem calls. Affected: I2 source identity proof, I3 direct activation traceability, I10 in-scope direct deletion. Verified safe now: I1, I5, I11, I12, I16 and the namespace spellings explicitly listed in the I10 fixture.
- impact: A title-only spinner can become identity evidence, an external row's direct activation proof can disappear, or worktree-removal production code can call an aliased/named destructive fs API while the registry remains green.
- suggestedFix: Tag and drive I2 at the production title-evidence/projector boundary; tag the existing I3 direct-activation test; replace I10's raw regex with TypeScript AST import/binding analysis for `node:fs` and `node:fs/promises`, including namespace, named, destructured, aliased, and optional-access forms, with negative fixtures.
- status: open — persists from rounds 1-3 for the same coverage-claim invariant; I1 is fixed, I2/I3 extend the affected-boundary inventory, and the I10 remediation is incomplete
- triage: B2 was accepted in cycle 1; new boundary evidence pending author triage

### B12

- ID: B12
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/sourceSources.ts:73`
- title: The AST scan still counts tests that the runner will not execute
- evidence: The TypeScript parser correctly excludes the three prior lexical classes — comments/literals and longer identifiers — and the retained negative fixtures would catch regressions to them. But `visit()` descends through disabled suite declarations without carrying ancestor state, while `isActive()` checks only the leaf `it`/`test` modifier. A targeted probe returned the nested tests from both `describe.skip(... it("[I6]"))` and `describe.todo(... test("[I7]"))` as active. A second probe showed a locally shadowed `it` or `test` binding also counts because the scan matches identifier spelling without binding resolution. No negative fixture covers either case.
- impact: Disabling a whole suite, or leaving a same-named local helper call, can keep an invariant marked covered after no Vitest declaration executes. The new parser closes the lexical B1 class but does not close D1's broader active-test requirement.
- suggestedFix: Track inert `describe`/`suite` ancestors when walking callbacks and reject declarations nested under `.skip`, `.todo`, `.failing`, or conditional disabled suites. Also bind `it`/`test` to the Vitest import or reject local shadow declarations. Add both cases to the negative fixtures.
- status: open — new mechanism; prior B1's lexical false positives are fixed
- triage: pending

### B13

- ID: B13
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-reuse`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.crossLayer.test.ts:49`
- title: I6's cross-layer proof replaces the production status-routing seam with a copy
- evidence: The test-local `route()` independently implements the structured-update → `reportTurn` and revoked-source → `expireTurn` branches owned by `src/extension.ts:416-430`. The I6 tagged scenario therefore traverses runtime → copied dispatch → store → projector, not the accepted D5 production composition. The assembly suite proves a generic working update reaches the real callback, but it does not send the resumed/cleared idle transition; production could begin dropping non-working structured states while the generic assembly test and every I6-tagged test remain green.
- impact: The exact cross-file integration regression WT-007.1 exists to catch can occur at the copied seam without failing the I6 proof.
- suggestedFix: Exercise the resumed/cleared transition through the real `activate()` callback in the assembly harness, or extract one production routing helper and have both `activate()` and the cross-layer harness call that same owner.
- status: open
- triage: pending

### B14

- ID: B14
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/coverage.test.ts:175`
- title: Render-cap verification never asserts that the published cap is actually applied
- evidence: The new consistency check proves only that the documentation contains the exported constant. The referenced behavioral test creates 34 rows, checks that a Show-all button exists, clicks it, and then expects 34 rows; it never asserts that exactly `MAX_WORKTREES_PER_REPO` rows render before the click. Changing the implementation from `visible.slice(0, MAX_WORKTREES_PER_REPO)` to `visible.slice(0, MAX_WORKTREES_PER_REPO + 1)` leaves the exported value, doc row, Show-all affordance, and post-click count unchanged, so both checks stay green while the published cap is violated.
- impact: A repository can exceed the documented render budget without any WT-007.1 verification failing.
- suggestedFix: Before clicking Show all, assert the rendered worktree-row count equals `MAX_WORKTREES_PER_REPO` and that the affordance reports the full total; after clicking, assert all rows render and the affordance disappears.
- status: open
- triage: pending

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/bench/scale.bench.ts:105`
- title: Benchmark still reimplements the canonical repository fixture builder
- evidence: The standalone benchmark retains its own repository initialization, Git identity, commit, worktree creation, and teardown rather than sharing the integration fixture.
- impact: Benchmark and integration repository shapes can drift.
- suggestedFix: Extract a runtime-neutral fixture helper in a later planned change and reuse it from both consumers.
- status: open — persists from rounds 1-3
- triage: accepted and deliberately not fixed; not user risk-accepted

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:876`
- title: Added assembly scenarios accumulate activated runtimes and loopback servers
- evidence: Each added scenario calls `assemble()`, which activates the extension and creates an `AgentHookRuntime`. `beforeEach()` resets captured references and modules but the file imports no `afterEach`, never calls extension deactivation, and never calls `runtime.dispose()`. `AgentHookRuntime.dispose()` is the path that closes its HTTP server.
- impact: The suite retains loopback listeners and extension-owned subscriptions across cases, creating resource growth and suite-order sensitivity in the verification file whose task includes repeated full-suite stability.
- suggestedFix: Retain the activation lifecycle owner per test and dispose/deactivate it in `afterEach`, including runtime/server and host/subscription cleanup, before resetting modules.
- status: open
- triage: pending

### S2

- ID: S2
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.scale.test.ts:95`
- title: One-pane-versus-ten assertion still creates only ten panes
- evidence: The test invokes the fixed ten-pane `wireAtScale()` fixture and repeats prior count assertions.
- impact: It supplies no evidence for its stated one-versus-ten comparison.
- suggestedFix: Parameterize pane count or remove/rename the redundant case in a later cleanup.
- status: open — persists from rounds 1-3
- triage: accepted and deliberately not fixed

### S3

- ID: S3
- severity: SUGGEST
- confidence: MEDIUM
- priority: P3
- agent: `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/sourceSources.ts:111`
- title: Retired hand-written comment lexer remains exported and untested
- evidence: `withoutComments()` has no importer, while D1 and the surrounding source state that the character-level declaration scanner was replaced. The shared invariant-source module now exposes both the parser mechanism and a dead lexer implementation.
- impact: Future source rules can accidentally reuse the mechanism this change deliberately retired, with no test protecting it.
- suggestedFix: Delete the unused export; use the TypeScript parser for future source-call analysis.
- status: open
- triage: pending

## Prior findings resolved or remaining resolved

- B1: fixed for its original lexical mechanism — the parser and retained fixtures exclude comments, strings/templates/regex literals, and longer identifiers. B12 records a distinct execution-context mechanism.
- B2/I1: fixed by tagging the activity-retention assertion. B2 remains open for the boundaries listed above.
- B3, B4, B5, B6, B7, B8, B9, B10, B11, W1, W3, S1: remain fixed as adjudicated in cycle 1.

## Triage — author, round 4

Every BLOCK was reproduced before triage; none is accepted on the chair's word alone.
Probes run: `declarationsIn` against `describe.skip` / `describe.todo` / a locally shadowed
`it` (all three returned `active: true`); the I10 regex against a named-import `rm(...)` call;
the render-cap test read at `WorktreeView.test.ts:217` (no pre-click count assertion exists).

| ID | Status | Triage |
|---|---|---|
| B2 | accepted | Reproduced. `DESTRUCTIVE` only matches `<namespace>.rm*(`; `import { rm } from "node:fs/promises"` then `rm(dir)` is invisible to it, and so is `import * as nodeFs`. I2's tag sits on an already-projected fixture row, and I3's real activation proof at `WorktreeView.test.ts:1037` carries no tag. Same defect class as B1 — the check is weaker than the claim it certifies. |
| B12 | accepted | Reproduced exactly as described. The round-3 parser fixed the *lexical* class and introduced an *execution-context* class: `declarationsIn` reads a call's own modifiers and never the enclosing suite, so `describe.skip` around an entire invariant suite leaves the registry green. This is the third distinct way D1 has been wrong; see the Notes entry — the lesson is that "a test exists" was never the property worth checking. |
| B13 | accepted | Reproduced. `route()` at `extension.crossLayer.test.ts:49` is a hand-mirror of `extension.ts:419-430`; the test cannot observe production routing changing. Fixing by driving I6 through the real activation harness in `extension.worktreeAssembly.test.ts` rather than by extracting a production helper — the harness already performs real activation, so it is both test-only and a strictly stronger proof than a shared seam would be. |
| B14 | accepted | Reproduced. The behavioural test asserts the button text and the post-click count of 34, never the pre-click count. Changing the slice to `MAX_WORKTREES_PER_REPO + 1` leaves it green, which is precisely the fifth acceptance clause going unverified. |
| W4 | accepted | Valid and worth fixing beyond its severity: the file has no `afterEach` disposing activation, so every `assemble()` leaves an `AgentHookRuntime` and its loopback HTTP server open. This is a live candidate for the pre-existing PTY_LOAD_FAILED order-instability recorded in the previous change's workflow.md Notes. |
| S3 | accepted | `withoutComments()` has no importer. It is the mechanism D1 removed; leaving it exported invites its reuse. Deleting. |
| S2 | accepted | Cheap to close properly — construct the one-pane fixture the title claims. Cycle 1 left it unfixed twice; that was the wrong call for something this small. |
| W2 | accepted, deferred to the user | Valid. A runtime-neutral fixture shared by a bun script and a vitest suite is a real extraction, not a trivial one, and it is the second time this has been deferred. Recording it as author-deferred rather than fixed or risk-accepted: the chair is right that "deliberately left unfixed" was never a status the process defines, and only the user can grant `risk-accepted`. |

No finding rebutted this round.

## Author addendum — two findings that reached me outside the chair's report

While round 4 was running, two review specialists messaged this session directly instead of
reporting to the chair. `asm-review-reuse`'s finding is B13 above, so it arrived by both routes.
`asm-review-frontend` sent four; two of them (I2, I3) are inside B2, and two are in neither B2 nor
any other block of this report. They are recorded here rather than dropped, with their origin
stated, because a finding that is true does not become false by losing its delivery path — and
letting one go because a report omitted it is the exact "green but unproven" failure this change
exists to prevent.

Both were reproduced before being accepted.

| ID | Source | Status | Triage |
|---|---|---|---|
| F1 | `asm-review-frontend`, direct message | accepted | The `[I9]` tag sat only on the "sends nothing for a spinner frame" half. The test proving the FINAL transition still reports, and that the title arrives stripped, was untagged at `paneEvidenceReporting.test.ts:158`. A regression dropping the last transition, or sending the decorated title, left every I9-tagged assertion green. Fixed in 7_2. |
| F2 | `asm-review-frontend`, direct message | accepted, adjusted | The `[I5]` tag counted rows and checked the label but never asserted that a historical row does not present as live. The specialist's suggested `dataset.live === "false"` does not hold: the renderer stamps `data-live` only on the live path, so the invariant is the ABSENCE of `"true"`, and asserting `"false"` fails against correct code. Fixed as absence, plus the `live: false` / `status: "running"` disagreement case tagged `[I5]` — that is where the two sources conflict and the invariant has teeth. |

Not treated as a process finding against the chair here, but recorded: two specialists bypassed
their nesting, and two of their findings did not survive the trip. The chair's report is the
adjudicated record, so anything that skips it skips triage as well.
