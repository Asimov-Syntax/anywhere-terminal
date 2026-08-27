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
