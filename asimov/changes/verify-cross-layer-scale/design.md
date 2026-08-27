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

**Known limit, not solved:** nothing machine-checks that a test tagged `[I7]` asserts I7. The
`stimulus` field and the review round are the only checks, and the change carries the `re-review`
flag so that round is mandatory.

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
| I6 | Resume/clear hook event → turn report carrying a session boundary → presence lands idle **without** a completed turn |
| I7 | Runtime disposal on reload → hook evidence gone → projection falls back to inference rather than retaining status |
| I9 | Decorative frame stripped at the webview boundary → no host message, no identity change, no rebuild, no render |
| I14 | Blocker set shown → blockers change before execution → re-prompt; an agent that became working is not force-removable |
| I15 | Mutation failure or timeout → forced rebuild → git/filesystem disagreement surfaces as indeterminate |
| — | Tree/presence atomicity: no surface receives presence naming a worktree absent from the paired tree |

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

### D9: The peer-owned tree is a change-wide boundary, and WT-007.1 stays open because of it

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

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `coverage.test.ts` scan | Grows with the suite — parses every `src/**/*.test.ts` per run | ≈230 files, one pass per run, no per-test cost; parsing is a regex over call sites, not a TS program |
| Tag semantics | A test tagged for an invariant it does not assert | Not machine-checkable. `stimulus` gives the reviewer the check, and `re-review` makes that round mandatory (D1) |
| `bench:scale` | Wall-clock, so machine-dependent | Out of `test:unit`, so it never flakes a normal run; run and recorded at the Verify Gate. Bound and fixture size are frozen (D2) |
| Bench fixture repo | Real git + 10 worktrees is slow and leaves temp dirs | Reuses `worktreeMutations.integration.test.ts` fixtures, which already handle teardown |
| Cross-layer tests (D5) | Composing production wiring can pull in the peer-owned tree | I7's seam is `AgentHookRuntime` / `PaneEvidenceStore`, both outside the boundary; if a scenario cannot avoid it, defer that row (D9) |
| Registry ↔ doc equality | A legitimate § 8.4 edit fails the suite | Intended. The failure names both texts |
| `WorktreeView.ts` NUL edit | Silent behaviour change if mistyped | Byte-identical or wrong; the collapse-persistence tests cover the join, and D7 adds a byte scan |
| Blueprint status | WT-007.1 left `in_progress` looks like an unfinished change | Stated in proposal § Completion constraint and carried into Blueprint Sync (D9) |
