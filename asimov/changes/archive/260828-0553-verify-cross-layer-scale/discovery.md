# Discovery: verify-cross-layer-scale

## Context

`docs/DESIGN.md` § 8.4 states sixteen truthfulness invariants as "testable statements, not
aspirations". A survey finds **zero** references to them: no test title, comment, or module names
`I1`–`I16`. Coverage exists — much of it does — but it is coincidental rather than traceable, so
an invariant can lose its last covering test in a refactor and nothing says so.

The scale clauses are in better shape than the blueprint assumes. The second-surface rules are
exercised at the host (`WorktreeHost.test.ts:195,238,328,539`, `invalidation.test.ts:187`,
`presence.test.ts:545,939`); burst and stream collapse are covered at the watcher pool
(`fsWatcherPool.test.ts:119`) and the presence pusher (`presence.test.ts:330,344,363`), with the
per-repo floor at `rebuildGate.test.ts:52`. The process-table snapshot the presence doc records as
*not existing yet* now exists (`src/pty/processTableSnapshot.ts`), its one-read-per-rebuild bound
asserted at `presenceDeps.test.ts:92,106`.

What is genuinely absent is threefold. First, **composition**: every one of those tests proves one
layer. The invariants that carry the most risk — a resumed session landing idle without claiming a
completed turn, hook evidence vanishing on reload, a decoration stripped before it can reach any
comparison — are claims about a pipeline, and no test traverses one end to end. Second, **latency**:
nothing measures either published budget, and there is no bench of any kind in the repo. Third,
**traceability** itself.

Two corrections this discovery had to make against itself, both worth recording because they
change what the plan does:

**The render cap is implemented.** `MAX_WORKTREES_PER_REPO = 20` (`WorktreeView.ts:56`), the
`uncapped` set, and `renderShowAll` (`:618`) satisfy the accepted requirement, covered at
`WorktreeView.test.ts:217`. An initial pass read `renderShowAll` and `worktreeSignature` as dead
exports because five sources embed a literal `\x00` byte, which makes BSD `grep` classify them as
binary and skip them **printing nothing to stdout**. A verification mechanism a single byte can
silence is not one — which is why the audit is specified against `node:fs`, not a shell.

**WT-007.1 transitively depends on an in-flight task.** `docs/PLAN.md:358` gives WT-006.3's
`Depends On` as `WT-006.2, WT-004.3`; WT-006.2 is `in_progress`. The direct dependency list does
not show this, and an earlier reading of it missed the edge.

## Options

The fork is how "traceable, and fails when violated" is made real.

### Option A — A documentation table

A matrix mapping invariant → test → task. Cheapest, drifts on the first rename, and fails nothing
when coverage disappears — which is the half the acceptance clause asks for.

### Option B — Tag test titles, parse the declarations (Recommended)

Covering tests carry `[I<n>]` in their `it(...)` title; a meta-test parses the suite's own test
*declarations* — not raw text — and asserts the mapping is total both ways, rejecting `.skip` and
`.todo`. Traceability lives beside the assertion, survives file moves, and a deleted test fails
the check. Its known limit: it cannot tell that a test tagged `[I7]` actually asserts I7.

### Option C — Import-time registry

Each invariant is a symbol that covering tests register at runtime. Fully type-checked, but it
only sees tests that ran, so a suite filter or a skipped file silently satisfies it — the exact
failure mode the clause exists to prevent.

## Reuse — existing code to build on

| Need | Reuse |
|---|---|
| Burst / floor mechanics | `fsWatcherPool.ts` `DEBOUNCE_MS`, `rebuildGate.ts` `REBUILD_FLOOR_MS` |
| Cost spies | Command-runner and process-table stubs in `WorktreeHost.invalidation.test.ts`, `presenceDeps.test.ts` |
| Fixture builders | Pane/worktree harnesses in `WorktreeHost.presence.test.ts`, `presenceProjector.test.ts` |
| Production wiring | `createPresenceProjectorDeps` — the cost test must compose it, not a hand-built fake |
| Real-repo fixtures | `worktreeMutations.integration.test.ts` already builds temp git repos |

## Key Findings

The watcher pool's debounce is **trailing and resettable** (`fsWatcherPool.ts:138`, test `:119`
"reset on each event"). A stream faster than 150 ms therefore produces no callback at all until it
stops. Any "sustained stream" test must pace above 150 ms and below the 1 s floor, or it asserts
one rebuild while never reaching the gate it claims to be testing.

## Gap Analysis

| Component | Have | Need | Gap |
|---|---|---|---|
| § 8.4 invariants | Coverage, untraced | Named coverage + a check that fails on loss | Tagging + parsing meta-test |
| Cross-layer composition | Per-layer units | End-to-end scenarios for I6, I7, I9, I14, I15, tree/presence atomicity | Whole task |
| Presence / model latency | — | < 50 ms @ 10×10; < 150 ms @ 1 repo × 10 | Whole measurement, out of the unit suite |
| Per-rebuild cost | Asserted on fakes | Same, over production wiring | Composition + citation |
| Burst / stream | Covered per layer | One joined path, cadence pinned above the debounce | Real fixture |
| Second surface | Covered piecemeal | One scenario, "no work" defined | Dedicated task |
| Render cap | Implemented, unpublished | Exported + in the § 10 registry | Registration only |
| Assembly suite | Intermittent `PTY_LOAD_FAILED` | Green or visibly quarantined | Root cause unknown |

---

# Round-5 handback: evidence for the D1 / D10 redesign

Written at the cycle-2 thrash stop, before any artifact was revised. Everything below was measured
in this worktree, not recalled. The `asm-oracle` consultation that produced items 3-6 was
user-requested; its full reasoning is condensed here because it does not survive the session.

## 1. The pattern the five rounds actually describe

| Round | D1 counted as a running test | Mechanism at the time |
|---|---|---|
| 1 | a commented-out `it(...)` | regex over raw text |
| 2 | `it(...)` inside a string / template / regex literal | comment-stripping lexer |
| 3 | `item(` as `it`+`em`; `testHelper(` as `test`+`Helper` | lexer with a left identifier boundary |
| 4 | `it(...)` under `describe.skip`; a locally shadowed `it` | TypeScript parse over `CallExpression` |
| 5 | `describe.skipIf(true)`, `describe.runIf(false)`, `it.skipIf(true)`, `describe["skip"]`, function-declaration shadow | parse + scope tracking + vitest-import binding |

D10 has the same shape over three rounds: regex → AST binding resolver → still missing assignment
aliases, element access, nested destructuring, and now producing **false positives** on a harmless
parameter named `rm`.

Both are attempts to decide **statically, by hand**, a question a tool already owns. That is the
defect. A sixth scanner is the same bet.

## 2. Probe results (run here, reproducible)

**"Which tests actually run" — `vitest list` excludes every disabled form.** A fixture with
`describe.skip`, `describe.skipIf(true)`, `describe.runIf(false)`, `it.skipIf(true)`, `it.skip`,
and one live test: `vitest list` returned the live test **only**; `vitest run` reported
`1 passed | 5 skipped`. No case enumeration on my side.

**"What does this identifier refer to" — the TypeScript checker resolves every round-5 bypass.**
`ts.createProgram` over the repo tsconfig, `getSymbolAtLocation` + `getAliasedSymbol`, following
variable initializers and binding elements, plus `getTypeAtLocation(obj).getProperty(literal)` for
element access:

| Expression | Result |
|---|---|
| `fs.rm(d)` | FLAG |
| `rm(d)` (named import) | FLAG |
| `wipe2(d)` (`import { rm as wipe2 }`) | FLAG |
| `wipe(d)` (`const wipe = fs.promises.rm`) | FLAG |
| `nested(d)` (nested destructuring) | FLAG |
| `fs.promises["rm"](d)` | FLAG |
| `rm(d)` where `rm` is a **parameter** | pass |
| `rm(d)` where `rm` is a **local const** | pass |

6/6 bypasses closed, 0 false positives — the two cases my hand-written resolver got wrong.

## 2b. The reporter probe — run after the oracle returned, because the failure channel was unverified

The oracle settled *what to read*. It did not settle *how the gate fails*: a Vitest reporter is an
observer, and nothing about `onTestRunEnd` obviously fails a run. Five rounds died on unverified
mechanisms, so this one was measured before it entered the design.

A reporter setting `process.exitCode = 7` in `onTestRunEnd`, over a fixture of seven declarations:

| Declaration | `result().state` | `options.mode` | `options.fails` | Counts as coverage |
|---|---|---|---|---|
| plain `it` under a live `describe` | `passed` | `run` | `undefined` | **yes** |
| under `describe.skip` | `skipped` | `skip` | — | no |
| under `describe.skipIf(true)` | `skipped` | `skip` | — | no |
| under `describe.runIf(false)` | `skipped` | `skip` | — | no |
| `it.skipIf(true)` | `skipped` | `skip` | — | no |
| `it.fails(...)` with a failing body | `passed` | `run` | **`true`** | **no** — the trap |
| `it(...)` calling `ctx.skip()` at runtime | `skipped` | `run` | — | no |

Vitest reported `2 passed | 5 skipped`, and the process exited **7**. Both halves hold: the runner
distinguishes every disabled form without being asked about any of them, and a reporter can fail
the run.

The last row is the one no scanner could ever have reached — `mode` is still `run`, and the skip
happens during execution. Five generations of static scanner were trying to answer a question that
is not decidable before the test runs.

## 3. D1 SHALL use a Vitest reporter, NOT `vitest list`

`vitest list` answers *collection*, not *execution*. It cannot see:

- `TestCase.result()` — `passed` / `failed` / `skipped`, including a dynamic `ctx.skip()`
- `TestCase.options.mode` — `run` / `only` / `skip` / `todo`
- `TestCase.options.fails` — an `it.fails(...)` **executes and passes when its body fails**, so
  `list` would count it as coverage. The repo has no such test today; that is exactly the class of
  case that has beaten this scanner five times.

API surface: `node_modules/.pnpm/vitest@4.0.18_*/node_modules/vitest/dist/chunks/reporters.d.CWXNI2jG.d.ts`
lines 103-133, 276-284, 929-950. Count a tag only where the final state is `passed` and
`options.fails !== true`, read in `onTestRunEnd`.

**Enable the reporter only for the canonical full run** (`pnpm run test:unit`). Concrete failure
mode otherwise: `vitest run one-file.test.ts` would report I1-I16 missing because the developer
deliberately collected one file.

Rejected alternatives, with reasons: `expect.soft` (a test has no global view of completed tasks);
a global-setup manifest (runs before execution, cannot see dynamic skips); `startVitest` from
inside the measured suite (nested run, reentrancy); `vitest list` alone (collection only).

Accepted consequence: a bare `vitest run` no longer fails on missing coverage. `pnpm run test:unit`
and CI remain authoritative. Making the check CI-only would NOT be acceptable.

## 4. D10 SHALL be a standalone TypeScript Program gate

Measured over five fresh Node processes against this checkout's `tsconfig.json`:

- total **0.851-1.052 s**, median **0.901 s**
- 918 files in the Program; 29 in-scope production files; 938 call expressions
- Program creation + checker init ≈ 0.78-0.97 s; the rule traversal itself ≈ 75-80 ms

Warm filesystem on this machine; budget 1-2 s on ordinary CI. Acceptable for a gate, wrong for
watch mode or targeted unit runs. Not Biome (no TypeScript symbol-resolution seam); not a new
ESLint stack (same Program cost, and adding a lint framework for one rule is worse engineering).

**Simplify from alias propagation to symbol acquisition.** Do not follow `wipe = fs.promises.rm`
to its call site. Reject where the destructive symbol is *acquired or referenced*: named import,
`fs.rm`, `fs.promises.rm`, `fs.promises["rm"]`, destructuring from an fs namespace, or assignment
of such a member to a variable. The checker resolves the originating symbol; harmless lexical
shadows resolve elsewhere. **Fail closed** on non-literal access such as `fs.promises[key]` —
dynamic member access on an fs namespace makes the policy unauditable in this narrow scope.

## 5. I2 — the composition that drives real evidence (no extension standup)

1. real `createPaneEvidenceStore`
2. a pane under a minimal worktree, **no launch proof**, session lookup returning `absent`
3. real `createPaneEvidenceReporter`, its messages routed to `store.report`
4. report raw evidence, e.g. `⠋ claude`
5. real `createPresenceProjector` over `store.panes()` / `store.explainActivityFor()`
6. assert the projected row is specifically `{ agent: "claude", agentSource: "title" }` — this is
   the proof the test traversed production classification instead of being handed `"none"`
7. pass that row to the real `renderAgentRow`; assert `.wt-aicon` holds the terminal glyph with no
   brand tooltip and no accent

Seams: `src/webview/terminal/paneEvidenceReporter.ts:31-68` · `src/session/PaneEvidenceStore.ts:377-403`
· `src/worktree/agentIdentity.ts:106-113` · `src/worktree/presenceProjector.ts:669-715`
· `src/webview/worktree/worktreeFormat.ts:178-184` · `src/webview/worktree/worktreeTreeView.ts:339-357`

`src/webview/integration/paneEvidenceReporting.test.ts:73-118` already proves TerminalFactory calls
the reporter, so pulling `activate()` into I2 adds setup without strengthening the invariant.

## 6. W4 — and the trap in it

Teardown: `await deactivate()` from **the same dynamic-import instance that supplied `activate()`**,
then dispose `context.subscriptions`, then surface unexpected disposal failures instead of
swallowing them. Drop the direct `captured.runtime?.dispose()` — controller disposal owns it and is
idempotent.

**The trap:** `beforeEach` calls `vi.resetModules()`. Re-importing `deactivate` after the reset
yields a different module instance holding different `_activeAgentHookController` state. Capture
`deactivate` alongside `activate` inside `assemble()`.

This may reduce `PTY_LOAD_FAILED` but does not establish its cause; D8 still owns that.

## 7. Honesty defects found here, not by review

- `design.md` D10 says "no module **reachable from the removal path**" while the implementation
  enumerates two directories. That claims call-graph reachability the code never computes. Survived
  all five rounds. Fix the wording, or build a real call graph — not both claims at once.
- The Risk Map row asserting the bench "reuses `worktreeMutations.integration.test.ts` fixtures"
  was never true: the bench runs under bun and cannot import a vitest fixture. Corrected in
  `aa031e0`; it is also why W2 is a real defect rather than tidiness.

## 8. W2 — the two fixtures, and why the extraction is safe

`src/worktree/worktreeMutations.integration.test.ts:26-35` and `src/test/bench/scale.bench.ts:106-114`
are near-identical: `realpathSync(mkdtempSync(...))`, `git init -q -b main`, `user.email` /
`user.name`, write `README.md`, `add .`, `commit -qm init`. They differ in the tmp prefix, the
bench's extra linked worktrees, and lifecycle (`beforeEach`/`afterEach` vs a caller-owned handle).

Extract a **runtime-neutral** module — no `vitest` import — exporting a repo fixture both consume.
That constraint is the whole reason the original reuse claim was false.

It will call `fs.rmSync` for teardown and therefore must live outside D10's scope
(`src/worktree/**` + `WorktreeHost.ts`); a home under `src/test/` satisfies that.

**No overlap with the peer session.** `huybuidac/worktree-phase6` changes 39 files — all
`src/agentHooks/AgentHookController*`, `src/agentHooks/install/**`, `src/extension.ts`, and two
`docs/research/` notes. Intersection with this change's 54 files is exactly one file,
`asimov/changes/active` (the CLI's active-change pointer, add/add, scratch state). A `git grep` for
`initRepo` / `makeRepo` / `"init"` under `src/` on that branch returns nothing, so the extraction
does not rebuild something they are building.

Related near-miss: B13 offered "extract a production routing helper from `src/extension.ts`" as an
alternative fix. That is the one production file the peer session is editing, and it is editing the
hook-installation ownership model that the `onStatus` branch sits in. The harness move avoided a
real collision, not a hypothetical one.
