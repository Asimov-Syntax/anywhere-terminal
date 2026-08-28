# Review Round 6

- Date: 2026-08-28
- Cycle: 3
- Mode: discovery
- Scope: range `9d9641d7..47b0310cba9c17c6fed70bc41bfa6c707a5fc2ef`
- Head: `47b0310cba9c17c6fed70bc41bfa6c707a5fc2ef` (reviewed commit range; working tree also contains dirty Asimov analytics files outside the requested range)
- Reviewable lines: 12 (plus 1,039 changed test/support lines; 53 skipped Markdown lines)
- Verification evidence: caller reports check-types clean; 234 files / 4,733 tests passing; `gate:fs-deletion` passing over 29 scoped modules with 7 bypass spellings; scale bench passing at 0.1 ms presence / 30.8 ms model; `verify-status` exit 0; lint finding set identical to clean main under Biome 2.4.5. Review commands were not rerun. Targeted scratch probes created and deleted in one command showed four destructive-symbol acquisitions that still pass `fsDeletionGate.ts`.
- Agents spawned: `asm-review-contracts` (D10 gate, `gpt-5.6-sol[1M]`); `asm-review-logic` (D1 reporter, `gpt-5.6-terra[1M]`); `asm-review-logic` (W4 lifecycle, `sonnet[1M]`); `asm-review-frontend` (I2 composition, `gpt-5.6-terra[1M]`); `asm-review-reuse` (shared fixture, `gpt-5.6-luna[1M]`); `asm-review-performance` (gate scaling, `gpt-5.6-luna[1M]`)
- Agents skipped: `asm-review-data-security` (no persistence, auth, secret, or input-validation boundary in the range)
- Verdict: BLOCK
- Counts: BLOCK 1, WARN 2, SUGGEST 0

## Risk map

- D1 command-level invariant gate: `pnpm run test:unit` → Vitest execution verdicts → partial-run guard → registry comparison → process exit.
- D10 source gate: Asimov project command → Bun → tsconfig Program/checker → enumerated scope → destructive-symbol acquisition scan → flag/pass fixtures → process exit.
- I2 composed identity path: raw title evidence → reporter → pane store → process/session fallbacks → identity classification → projected row → DOM rendering.
- W4 lifecycle: same-module `activate`/`deactivate` singleton ownership → controller/runtime disposal → SessionManager flush/disposal → context subscriptions → socket refusal.
- Shared real-repo fixture: temporary root → git initialization/worktree population → benchmark and mutation-suite consumers → forced cleanup.

## Open findings

### B15

- ID: B15
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:79`
- title: I10 gate still passes destructive `node:fs` acquisitions
- evidence: The gate recognizes only `ImportSpecifier`, `PropertyAccessExpression`, `ElementAccessExpression`, and declaration `BindingElement` forms. Four targeted scratch files placed in `src/worktree/` each made the gate exit 0: `const { "rm": wipe } = fs.promises`, `({ rm: wipe } = fs.promises)`, `(fs.promises as any).rm`, and `const p: any = fs.promises; const wipe = p.rm`. The first two are acquisition syntax the visitor never resolves; the last two erase the property symbol, so `getSymbolAtLocation`/`isFsBearing` returns no destructive member and the rule fails open. Boundary inventory searched: named/renamed import; namespace/direct/promises property; string-literal element access; non-literal element access; declaration/nested destructuring; direct member assignment; lexical parameter/local shadows; quoted binding keys; destructuring assignments; type-erasing casts and namespace aliases. Affected: quoted-key destructuring, destructuring assignment, and type-erased fs-bearing expressions. Verified safe: the seven checked-in `flag-*` spellings, the two `pass-*` shadows, and direct property assignment.
- impact: In-scope worktree-removal code can acquire `rm` and then delete files directly while `pnpm run gate:fs-deletion` and the Verify Gate remain green. That violates task 8_2's accepted outcome (“non-zero on any destructive-symbol acquisition”), D10's fail-closed rule, and I10's deletion-safety invariant.
- suggestedFix: Extend acquisition detection to destructuring assignment and literal/quoted binding keys, and fail closed when an fs-bearing expression is type-erased or assigned to an `any`-typed alias. Add one `flag-*` fixture for every affected boundary and preserve pass fixtures for harmless shadows/casts that are not fs-derived.
- status: open — new in cycle 3 discovery; the round-5 checker fixed the named boundaries but remains incomplete through a different acquisition mechanism
- triage: pending author triage

### W5

- ID: W5
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:33`
- title: D10 scope classification is platform-dependent
- evidence: `path.relative()` returns platform-native separators, but `isRemovalPath()` and `FIXTURES` compare only forward-slash strings (`src/worktree/`, `/bench/`, `src/test/invariants/fixtures/fsDeletion/`). On Windows neither production modules nor fixtures match; the gate reaches its vacuity check with zero scoped/proven files rather than running the accepted rule.
- impact: The newly registered project gate cannot be used to verify I10 on Windows and will fail every Verify Gate there without inspecting the intended scope.
- suggestedFix: Normalize relative paths to `/` once before every scope/fixture comparison, or classify resolved paths by path segments using platform-aware APIs.
- status: open — new
- triage: pending author triage

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:332`
- title: A throwing `deactivate()` skips the remaining harness cleanup
- evidence: `afterEach` awaits `teardown?.()` before initializing/using the subscription failure collection. If production deactivation ever throws, control exits the hook before `teardown` is cleared and before `subscriptions.splice(0)` disposes the VS Code registrations. Current `deactivate()` catches its known owner failures, so this is dormant today; it becomes reachable precisely when a future lifecycle regression adds an uncaught failure.
- impact: The test that detects a deactivation regression can leave listeners and registrations alive, contaminating later cases and reintroducing suite-order failures while obscuring which resources leaked.
- suggestedFix: Collect a `deactivate()` error into the same failure list, clear `teardown` in `finally`, always dispose all subscriptions, then fail once with the collected teardown errors.
- status: open — new; prior W4 is fixed because production deactivation is now exercised
- triage: pending author triage

## Prior finding adjudication

- B2: fixed for the round-5 I2 and listed I10 boundaries. I2 now traverses real title classification and asserts `agentSource: "title"` before rendering. B15 is a new checker-mechanism defect, not persistence of the retired hand-written resolver.
- B12: fixed. Coverage is read from Vitest's final execution verdict; the static active-test scanner is deleted.
- W4: fixed. Every assembled case captures and invokes the same-module production `deactivate()` before disposing context subscriptions, and the endpoint-closing case makes that path falsifiable. W6 concerns cleanup after a future thrown deactivation, a different mechanism.
- W2: fixed. Bench and mutation integration suite share `src/test/fixtures/repoFixture.ts`.
- No prior `audit-backlog` or user-granted `risk-accepted` entries require carry-forward.

## Specialist adjudication

- The D10 specialist graded the destructuring-assignment bypass WARN. The chair raises the merged acquisition finding to BLOCK because the accepted task outcome is explicitly “any destructive-symbol acquisition,” the scratch probes prove a green bypass inside the enforced scope, and the violated invariant protects worktree files from direct deletion. This is the same impact class that made prior I10 misses blocking, with new mechanism evidence.
- The lifecycle specialist's W6 is accepted. The current production implementation catches known disposal failures, so it is warning-level harness resilience rather than a present leak.
- Coverage-reporter logic, I2 frontend composition, shared-fixture reuse, and gate performance specialists found no additional issues.

---

## Triage — author, round 6

All three accepted, none rebutted. B15 was reproduced before triage; W5 and W6 are structural and
were confirmed by reading.

| ID | Status | Rationale |
|---|---|---|
| B15 | **accepted** | Reproduced. Four probe fixtures placed under the gate's own fixture directory; the gate reported all four as blind spots and exited 1. Quoted-key destructuring fails because `(propertyName ?? name).getText()` returns `"rm"` with its quotes, so `getProperty` misses. Destructuring assignment is an `ObjectLiteralExpression`, not a binding pattern, and the visitor never looks at it. Both `any` forms erase the property symbol, and the visitor treats "no symbol" as "not fs" — the opposite of the fail-closed rule D10 states in the same file. |
| W5 | **accepted** | `path.relative` returns native separators; every scope and fixture predicate compares against `/`-joined literals. On Windows `scoped` and `proven` both reach 0, which my own vacuity check turns into a loud exit 1 — so it fails safe rather than passing silently, but the gate is unusable there and `asimov/project.md` now names it as a required command. |
| W6 | **accepted** | `await teardown?.()` sits above both the `teardown = undefined` reset and the disposal loop. A throwing deactivate skips disposal entirely and leaves the stale `teardown` set for the next case — the leak this teardown exists to close, reopened by the failure path of the fix for it. |

### The pattern in B15, stated plainly

This is the second mechanism to fail the same way, not a defect in the checker approach. The
checker resolved every spelling that reaches it; four spellings never reached it, because the
visitor still enumerates AST shapes BY HAND — binding element, property access, element access —
and that enumeration is the same hand-written surface that failed five times as a scanner.

The fail-open on `any` is worse than the two missed shapes, and it is mine: D10 says "fail closed
on non-literal access", the file says so in a comment, and the code then treats an unresolved
symbol as a pass. The rule contradicted its own stated policy inside the same function.

Not a fourth thrash-stop trigger: B15 is a new defect in a new mechanism, not B2 or B12 surviving
a fix. The cycle-3 counter stands at round 1 of 3.
