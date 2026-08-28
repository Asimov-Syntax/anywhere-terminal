# Design: verify-cross-layer-scale

## Decisions

### D1: Traceability is a tag plus a declaration-parsing meta-test

Every test covering a `docs/DESIGN.md` § 8.4 invariant SHALL carry `[I<n>]` in its `it(...)`
title, and a meta-test SHALL fail when the mapping between the § 8.4 table and those tags is
incomplete in either direction.

A table in a doc records the mapping the day it is written and never again. Tagging puts the
citation on the assertion itself, so it moves with the test and disappears with it.

```ts
export interface InvariantRow {
  id: `I${number}`;
  statement: string;      // verbatim from DESIGN.md § 8.4
  owners: string[];       // every docs/PLAN.md task that introduced part of the behaviour
  stimulus: string;       // the change that must make the covering test go red
  status: "covered" | "uncovered" | "deferred";
  reason?: string;        // required for uncovered and deferred
}
```

`owners` is plural because an invariant like I12 was built across three tasks; a single owner
field would have forced a false attribution. `stimulus` is what makes a row reviewable — it states
what breaking the invariant looks like, so a reviewer can check the tagged test against it rather
than against the tag.

The meta-test asserts:

| # | Assertion | Catches |
|---|---|---|
| 1 | Registry ids and statements equal the § 8.4 table, both directions | An invariant added to the doc and never adopted; a statement edited under a test |
| 2 | Every entry in `owners` resolves to a task id in `docs/PLAN.md` | Traceability that cannot be followed |
| 3 | Every `covered` row has ≥1 `[I<n>]` tag on an **active** test declaration | An invariant losing its last test |
| 4 | Every `[I<n>]` tag resolves to a registry row | A tag pointing at nothing |
| 5 | The `deferred` id set equals `DEFERRED_BY_WT_006_2` exactly | A builder deferring an invariant it found hard |
| 6 | No row is left `uncovered` | The audit's backlog being abandoned rather than worked |

**Three properties the scan must have.** It reads through `node:fs`, never a shell grep — five
sources embed a literal `\x00` and BSD grep skips them as binary with no error on stdout, which is
how this change's own discovery first mis-read two wired call sites as dead. It matches `it(` /
`test(` **call sites**, not raw text, so a tag in a comment or a fixture string does not count. And
it rejects `.skip`, `.todo`, and `.failing`, so a disabled test cannot hold an invariant open.

**Revised after review round 3 — the scan parses, it does not lex.** The call-site property above
is the whole load-bearing claim, and three successive hand-written scanners each failed it in a way
their own fixtures certified as correct:

| Round | What counted as a test declaration but was not |
|---|---|
| 1 | A commented-out `it(...)` — and the regression fixture asserted it SHOULD count |
| 2 | An `it(...)` inside a string, template, or regex literal — the round-1 fixture escaped its embedded quote and so stepped around the case |
| 3 | `item(...)` read as `it` + modifier `em`; `testHelper(...)` as `test` + `Helper` — the left identifier boundary was guarded, the right one was not |
| 4 | An `it(...)` under `describe.skip`, and one calling a locally shadowed `it` — real call sites, correctly parsed, that never execute |
| 5 | `describe.skipIf(true)`, `describe.runIf(false)`, `it.skipIf(true)`, `describe["skip"]`, and a shadow declared as a function rather than a const |

Each fix was locally correct and the next probe found another way in, which is the signature of a
wrong mechanism rather than a wrong patch. So the scan SHALL use the TypeScript compiler API —
`ts.createSourceFile` and a walk over `CallExpression` nodes whose callee is the identifier `it` or
`test`, or a property-access chain rooted at one — rather than any character-level scan.
`typescript@5.9.3` is already a devDependency, so this adds no dependency. Comments, literals, and
identifier boundaries stop being cases the scanner has to remember: they are not call expressions,
and the parser already knows it.

The three negative fixtures the rounds produced stay as regression cases, because what they now
prove is that the mechanism does not need them.

**Revised again after review round 4 — the scan reads execution, not existence.** Rows 1-3 above
were all lexical and the parser retired them together. Row 4 is not: those call sites are real
calls to the real `it`, parsed correctly, and they still never run — so an entire invariant suite
could be disabled by one `.skip` on its `describe` while the registry stayed green. Parsing was
necessary and was never sufficient, because "a declaration exists" was never the property worth
checking. The scan SHALL therefore also:

- carry an enclosing `describe.skip` / `describe.todo` down to the declarations inside it;
- resolve `it` / `test` to the names the file imported from `vitest`, so a locally shadowed
  binding of the same name is not a test declaration.

All 235 test files in this repo import their runner explicitly, so requiring the import removes a
family of false positives at no cost to real coverage.

**Revised again after review round 5 — the runner reports execution; nothing decides it by hand.**
Round 4's scan resolved the vitest import and carried `describe.skip` downward, and round 5 walked
straight past it five more ways (table row 5). Five rounds, five mechanisms, five fixture sets that
each certified their own scanner as correct: the constant is not the bug, it is the question. Every
one of those scanners was trying to decide **statically** whether a test would run, and the runner
does not decide that statically either — `ctx.skip()` is called at runtime.

So D1 SHALL stop asking. Coverage SHALL be counted from a **Vitest reporter** reading the runner's
own verdict in `onTestRunEnd`: a tag counts only where `TestCase.result().state === "passed"` and
`TestCase.options.fails !== true`. The reporter observes what actually executed, so `skipIf`,
`runIf`, `only`, a dynamic `ctx.skip()`, and every future modifier are covered without being
enumerated. API surface: `vitest@4.0.18` `dist/chunks/reporters.d.*.d.ts` lines 103-133, 276-284,
929-950.

`options.fails` is why this is a reporter and not `vitest list`. An `it.fails(...)` **executes and
passes when its body fails** — a collection-time answer counts it as coverage. The repo has no such
test today, and that is precisely the class of case that has beaten this scanner five times running.

Rejected, with reasons: `vitest list` — answers collection, not execution. `expect.soft` in a final
test — no test has a global view of the tasks completed around it. A global-setup manifest — runs
before execution and cannot see a dynamic skip. `startVitest` from inside the measured suite —
a nested run, reentrant.

**Scope: the reporter is enabled only for the canonical full run (`pnpm run test:unit`).** Under
`vitest run one-file.test.ts` it would report I1-I16 uncovered because the developer deliberately
collected one file. `pnpm run test:unit` and CI stay authoritative. Restricting the check to CI
only would not be acceptable — a developer must be able to run it.

The character-level scanner and its five generations of negative fixtures are **deleted**, not kept
as regression cases. They only ever existed to answer "would this run?", which is now answered by
the thing that runs it. `sourceSources.ts` keeps only `tsFiles`. Registry assertions 1, 2, 5 and 6
are unaffected — they read documents, not execution. Assertions 3 and 4 are re-expressed over the
reporter's observed tags, and assertion 4 accordingly checks tags on tests that ran; a stray tag on
a test that never runs is invisible to it, and so is a test that never runs.

### D10: I10 rests on behaviour, guarded by a limited tripwire

A test cannot prove "the extension never deletes files directly" — it can only prove that the paths
it walks delegate to git. Round 3 was right that documenting the gap in the registry does not close
it while the row reads `covered`. Five revisions then tried to close it by construction and failed.
So I10 SHALL be carried by two things, each claiming only what it proves.

**1. Behaviour.** Passing `[I10]` host and real-git tests SHALL drive the shipped removal path
through `removeWorktree` and show that it invokes `git worktree remove`, including the nested and
already-deleted cases (`worktreeMutations.integration.test.ts`).

**2. A regression tripwire.** `pnpm run gate:fs-deletion` SHALL build one `ts.createProgram` from
this repo's `tsconfig.json` and report every identifier, property access or element access — outside
type syntax and outside a declaration's own name — in `src/worktree/**` plus
`src/providers/WorktreeHost.ts`, excluding tests and benches, whose TypeScript type carries an `rm`,
`rmSync`, `rmdir`, `rmdirSync`, `unlink` or `unlinkSync` symbol declared by `@types/node/fs`.

The scope is a stated list, and the rule claims no more than the list. An earlier wording said "no
module **reachable from the removal path**", which asserts call-graph reachability this change never
computes; it survived five review rounds unchallenged. Either build the call graph or claim the
list.

**The tripwire is unsound and SHALL say so.** It performs no reaching-definitions or value-flow
analysis, and it does not decide a destructive value obtained from a call, passed through `any`,
carried through an erased alias, or reached through a structurally typed parameter. It exists to
catch a contributor reaching for `fs.rmSync(dir)` because it is convenient, which is how this
invariant will actually be broken.

**The limits are asserted, not written down.** `gap-call-produced.ts`, `gap-any-cast.ts`,
`gap-erased-alias.ts` and `gap-structural-parameter.ts` SHALL each produce no finding, and the gate
SHALL fail when one of those four is missing or starts being caught. A stated limit that nothing
checks is exactly how the "reachable from the removal path" overclaim survived five rounds.
Alongside them, `flag-` fixtures assert the spellings the rule does see and `pass-` fixtures assert
what it must not fire on — an empty offender list is otherwise an absence rather than a result.

Green evidence therefore establishes exercised git delegation, plus the absence of a reference this
predicate recognises in the enumerated scope, and nothing stronger. The registry row for I10 states
the same standard, and the gate's own output reports the search rather than the property.

**Known limit, not solved:** nothing machine-checks that a test tagged `[I7]` asserts I7. The
`stimulus` field and the review round are the only checks, and the change carries the `re-review`
flag so that round is mandatory.

**A standalone gate, not the unit suite.** ~1 s of Program construction is acceptable once per gate
run and wrong in watch mode or a targeted unit run. Measured on this checkout: 918 files in the
Program, 29 in scope, median **0.901 s** over five fresh processes. Not Biome — it has no TypeScript
symbol-resolution seam. Not a new ESLint stack — same Program cost, plus a lint framework adopted
for one rule.

**Why the claim is this narrow — the history, for a reader who would otherwise widen it again.**
Four mechanisms were defeated: a regex (renamed and named imports), an AST binding walk (assigned
members, element access, nested destructuring), the checker over acquisition *shapes* (quoted keys,
destructuring assignment, `as any`, nested assignment), and the checker over reference *types*
(call results, structural typing). The first three failures were incomplete enumerations of how a
name comes to hold an fs member — an open-ended set, which is why every round found another member
of it. The fourth is different in kind: TypeScript's type identity is **structural**, so `fs` passed
to a parameter typed `{ rmSync(path: string): void }` resolves that member to the local declaration
rather than to `@types/node/fs`. The language does not preserve where a function came from, so no
type-based rule can decide "this value is `fs.rm`"; deciding it soundly needs a static analyzer, and
that is out of proportion to this task. Each widening chasing soundness also produced defects in the
opposite direction — round 7's W7 and round 9's W9 both rejected valid code, and a rule wrong in
both directions is the kind that gets switched off within a week. The defect was the claim, not the
mechanism.

### D2: Count in the suite; time in a bench

Per-rebuild **cost** budgets SHALL be asserted as exact equality in the unit suite. The two
wall-clock **latency** budgets SHALL live in a separate `pnpm run bench:scale` command and SHALL
NOT be asserted inside `test:unit`.

Median-of-five wall-clock assertions in a default suite are sensitive to JIT warm-up, GC, and CPU
contention, and five samples characterize none of those. Inflicting that on every run buys a
number nobody trusts.

The split also fixes a validity problem, not merely a flake one. The published model measurement is
*"unit bench over a fixture repo"* — stubbing git and the filesystem to make it fast would delete
the very work it measures. So the bench builds a **real temporary repo with ten worktrees**, reusing
the fixtures in `worktreeMutations.integration.test.ts`. The presence bench may stub, because its
published target explicitly excludes the memoized resolution.

Neither the documented bound nor the documented fixture size may move to make a run pass. An
earlier draft of this design said the fixture shrinks if the measurement flakes; that was wrong and
is deleted — it would have converted a failed budget into a passing non-measurement.

The deterministic envelopes that stay in the suite:

| Layer | Exact assertion |
|---|---|
| Presence | 1 registry read, 1 process-table read, no re-resolution for unchanged pane keys — over the production `createPresenceProjectorDeps` wiring, not a hand-built projector seam |
| Model | 1 `worktree list` per affected repo after baseline, 0 commands for sibling repos, prunable probes bounded at 8 |

### D3: Bounds are proven on one joined path, with the cadence pinned

The burst and stream bounds SHALL be exercised through the real watcher pool, host, and rebuild
gate composed together under fake clocks, and the stream's cadence SHALL be above `DEBOUNCE_MS`
and below `REBUILD_FLOOR_MS`.

The pool's debounce is trailing and resets on each event (`fsWatcherPool.ts:138`). A stream faster
than 150 ms therefore delivers **nothing** until it stops, so a test pacing at 10 ms would observe
one rebuild while never reaching the floor it claims to test — passing without exercising anything.
Pacing between the two bounds is what makes the assertion mean what it says.

Five facts, each an exact count: a burst inside 150 ms → exactly one rebuild for the affected repo;
a stream paced between the bounds → exactly one rebuild per floor window; sibling repos → zero
commands; a forced refresh → immediate, bypassing the floor; and the counts hold per repo, not in
aggregate.

### D4: "A second surface adds no work" is defined before it is asserted

Attaching or showing a second surface SHALL leave watcher subscriptions, git invocations, registry
reads, process-table reads, projections, and polling timers **unchanged**. Cached fan-out and the
post itself MAY increase.

Literal "no work" is false — the second surface must receive and render something. Stating the
boundary is what makes the clause testable instead of rhetorical, and it is asserted in one
scenario rather than inferred from six separate tests that each cover one seam.

### D5: Cross-layer invariants are proven by composition, not by a pair of unit tests

An invariant that spans layers SHALL be covered by a test that traverses the production
composition end to end. Tagging one unit test at each end of a pipeline does not cover it.

This is what the blueprint means by "cross-layer verification cannot live inside any single feature
task", and it is the half a per-layer suite structurally cannot reach. The scenarios:

| Invariant | Composed scenario |
|---|---|
| I2 | Raw pane evidence → real reporter → store → identity classification → projected row → rendered agent cell, with an unproven identity reaching the DOM undecorated |
| I6 | Resume/clear hook event → turn report carrying a session boundary → presence lands idle **without** a completed turn |
| I7 | Runtime disposal on reload → hook evidence gone → projection falls back to inference rather than retaining status |
| I9 | Decorative frame stripped at the webview boundary → no host message, no identity change, no rebuild, no render |
| I14 | Blocker set shown → blockers change before execution → re-prompt; an agent that became working is not force-removable |
| I15 | Mutation failure or timeout → forced rebuild → git/filesystem disagreement surfaces as indeterminate |
| — | Tree/presence atomicity: no surface receives presence naming a worktree absent from the paired tree |

**Revised after review round 4 — "the production composition" excludes a mirror of it.** I6 and I7
were first proved against a lighter harness that could not run `activate()`, so it re-implemented
the `onStatus` routing branch by hand and said so in its header. A mirrored seam cannot fail when
the original changes, which is the single thing a cross-layer test exists to do: production could
begin dropping non-working structured states with every I6-tagged test still green. The routing is
reachable only by standing up the extension, so both invariants SHALL be proved in the assembly
harness that does. The lighter harness is retired rather than kept alongside — standing up this
composition twice is the duplication these invariants argue against.

`finishedAt` and `activitySource` are dropped at the host→webview contract, so the assembly
harness captures the real projector's own answer on its way past rather than reading the DOM.

**Added after review round 5 — I2 is composed, and it does not need the extension.** I2 says an
unproven identity renders undecorated, and it was proved at the render end alone, against a
hand-built row. That proves the renderer honours `agentSource`; it proves nothing about what
production puts in that field. The composition SHALL be: the real `createPaneEvidenceStore`, a pane
under a minimal worktree with **no launch proof** and a session lookup returning `absent`, the real
`createPaneEvidenceReporter` routed into `store.report`, raw evidence such as `⠋ claude` reported
through it, the real `createPresenceProjector` over `store.panes()` and `store.explainActivityFor()`,
an assertion that the projected row is specifically `{ agent: "claude", agentSource: "title" }` —
which is what proves the test traversed production classification rather than being handed
`"none"` — and only then the real `renderAgentRow`, asserting `.wt-aicon` carries the terminal glyph
with no brand tooltip and no accent.

Seams: `paneEvidenceReporter.ts:31-68` · `PaneEvidenceStore.ts:377-403` · `agentIdentity.ts:106-113`
· `presenceProjector.ts:669-715` · `worktreeFormat.ts:178-184` · `worktreeTreeView.ts:339-357`.

Standing up `activate()` for this one adds setup without strengthening the invariant —
`paneEvidenceReporting.test.ts:73-118` already proves TerminalFactory reaches the reporter, so the
composition starts at the store.

### D6: The render cap exists — register it, do not rebuild it

`MAX_WORKTREES_PER_REPO = 20` (`WorktreeView.ts:56`), the `uncapped` set, and `renderShowAll`
(`:618`) already satisfy `worktree-panel` § "A capped listing says it is capped", covered at
`WorktreeView.test.ts:217`. The gap is that the value is module-private and absent from
`docs/DESIGN.md` § 10, so nothing detects a drift. Export it, register it, tag the existing test,
and re-run that test as part of the task's own verification. No new cap behaviour.

The same task fixes the stale `§ 15` registry pointers in the design docs' sync-rule footers; the
registry has been § 10 since it moved, and a traceability change that leaves dangling cross-refs
is arguing against itself.

### D7: Literal NUL bytes leave the sources this change owns

A `\x00` used as a join separator SHALL be written as the escape `"\0"`.

Runtime-identical, and the files stop reading as binary to every grep-based tool — the review
agents and D1's audit included. Verified by an fs-based byte scan over the owned files, not by one
behavioural test standing in for four.

### D8: The assembly flake is root-caused before it is contained

`src/extension.worktreeAssembly.test.ts` SHALL be reproduced under a specified number of repeated
full-suite runs and diagnosed. A cause in our own code is fixed; a cause outside it is quarantined
by an explicit skip naming the reason, plus a `docs/PLAN.md` Deferred entry.

Neither a retry flag nor a widened timeout is acceptable: this change's subject is verification
that fails when reality does, and a retry converts an intermittent failure into a silent one. If
the root cause lands in the peer-owned tree, it is deferred rather than leased.

### D9: The peer-owned tree is a change-wide boundary

No task SHALL lease or modify `src/agentHooks/AgentHookController.ts` or
`src/agentHooks/install/**`. Invariants whose covering test would have to live there are recorded
`deferred` against the frozen `DEFERRED_BY_WT_006_2` set, and **WT-007.1 is not set to `done` by
this change**.

`docs/PLAN.md:358` gives WT-006.3's `Depends On` as `WT-006.2, WT-004.3`, and WT-006.2 is
`in_progress` in another session — so WT-007.1 depends on it transitively, while its acceptance
says *every* invariant. Marking the blueprint task `done` with rows still deferred would assert a
completeness this change cannot have. Freezing the deferred set is what stops `deferred` from
becoming a builder's escape hatch: adding a row means editing a named constant, which is a visible
plan change rather than a free-form reason.

**Revised at the Verify Gate — the second clause is withdrawn; the boundary is not.** The lease
boundary above stands unchanged: no task leased or modified the peer-owned tree. What does not
stand is the conclusion that WT-007.1 must stay `in_progress`. That rested on "with rows still
deferred", and `DEFERRED_BY_WT_006_2` is **empty** — the audit found every § 8.4 invariant
reachable from outside that tree, so nothing was deferred and the premise is false. WT-006.2 is
not among WT-007.1's four declared dependencies, all of which are `done`, and the blueprint
already marks WT-006.3 `done` under the same transitive dependency it cites here.

The completeness worry is real and is answered by a check rather than by a status: `coverage.test.ts`
compares the registry against § 8.4 as an ordered array in both directions, and the reporter fails a
`covered` row with no passing tagged test. A § 8.4 invariant arriving from WT-006.2 therefore turns
the suite red until it is covered. Holding WT-007.1 open would assert an incompleteness that does
not exist — the defect class this whole change was built to catch, and one this section committed
by predicting the audit's outcome before running it.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `coverage.test.ts` scan | Grows with the suite — parses every `src/**/*.test.ts` per run | ≈235 files, one `ts.createSourceFile` per file per run, no per-test cost. Measured at ~1.0 s for the two scanning assertions combined. The original entry here said "a regex over call sites, not a TS program"; rounds 3 and 4 made that false in both halves |
| Tag semantics | A test tagged for an invariant it does not assert | Not machine-checkable. `stimulus` gives the reviewer the check, and `re-review` makes that round mandatory (D1) |
| `bench:scale` | Wall-clock, so machine-dependent | Out of `test:unit`, so it never flakes a normal run; run and recorded at the Verify Gate. Bound and fixture size are frozen (D2) |
| Bench fixture repo | Real git + 10 worktrees is slow and leaves temp dirs | Builds and tears down its own repo. This row claimed reuse of `worktreeMutations.integration.test.ts` fixtures and that was never true — the bench is a bun script and cannot import a vitest fixture. Carried as round-2 W2, deferred twice, still open |
| Cross-layer tests (D5) | Composing production wiring can pull in the peer-owned tree | I7's seam is `AgentHookRuntime` / `PaneEvidenceStore`, both outside the boundary; if a scenario cannot avoid it, defer that row (D9) |
| Registry ↔ doc equality | A legitimate § 8.4 edit fails the suite | Intended. The failure names both texts |
| `WorktreeView.ts` NUL edit | Silent behaviour change if mistyped | Byte-identical or wrong; the collapse-persistence tests cover the join, and D7 adds a byte scan |
| Blueprint status | WT-007.1 left `in_progress` looks like an unfinished change | Stated in proposal § Completion constraint and carried into Blueprint Sync (D9) |
