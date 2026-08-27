# Design: surface-external-agent-rows

## Decisions

### D1: The registry reader returns an outcome, and a missing directory is not a failure

`listRunningClaudeSessions` returns `RunningSessionsOutcome`, never a bare array. `ENOENT` on
the registry directory resolves to `{ kind: "ok", sessions: [] }`; every other `readdir`
error resolves to `{ kind: "failed", reason }`. Per-file parse and read errors stay skipped.

A machine where Claude has never run has genuinely no sessions — reporting that as a
degradation would paint a permanent stale affordance on every window that never runs an
agent. A permissions or I/O error is the opposite: the honest answer is "unknown", and the
current `catch { return [] }` is exactly the silent clear
[worktree-agent-presence.md § 3.5](../../../docs/design/worktree-agent-presence.md) names.

The shape mirrors `DescendantsOutcome` (`src/pty/processTableSnapshot.ts`) rather than
inventing a second vocabulary for the same idea; a partial read is not modelled, because a
per-file skip already degrades to fewer rows and has always done so.

```ts
export type RunningSessionsOutcome =
  | { kind: "ok"; sessions: RunningClaudeSession[] }
  | { kind: "failed"; reason: string };
```

### D2: The snapshot exposes the INDEXED set, not the reader's raw array

`RunningSessionIndex` gains `all(): readonly RunningClaudeSession[]` — the live,
headless-filtered set `byPid`/`byCwd` are already built from — and `ResolutionSnapshot` gains
`sessions()`, which resolves the rebuild's single registry promise and, on `ok`, yields
`index.all()`.

The raw reader array still contains `sdk-cli` one-shots: the headless drop happens inside
`indexRunningSessions`, not inside the reader. Handing the external pass the reader's array
would put every hook-spawned `claude -p` on screen as an agent — the single largest source of
phantom rows the blueprint names. Routing both consumers through the index keeps one filter,
at one site, and keeps the "at most one registry read per rebuild" requirement intact: the
external pass costs no additional read.

```ts
export interface RunningSessionIndex {
  byPid(pids: ReadonlySet<number>): readonly RunningClaudeSession[];
  byCwd(cwd: string): readonly RunningClaudeSession[];
  /** Every live, non-headless session — the set the two lookups are built from. */
  all(): readonly RunningClaudeSession[];
}

export interface ResolutionSnapshot {
  resolve(pane: { paneId: string; ptyPid?: number; cwd?: string }): Promise<SessionLookup>;
  /** This rebuild's registry read, headless already dropped. */
  sessions(): Promise<RunningSessionsOutcome>;
}
```

### D3: Dedupe against every pane resolved this rebuild, not against the rows that survived

The pane pass resolves identity for **every** pane before attribution decides whether that pane
produces a row. Attribution then drops the panes with an unknown or unmatched cwd, but the
session ids they proved are still collected, and the external pass drops any session in that
set.

The projector currently `continue`s on an unknown or unattributable cwd *before* calling
`identify`, so ordering resolution after attribution would leave those panes unresolved. A
session belonging to a pane in this very window would then be labelled "other window" —
contradicting the blueprint's own rule that a registry session claimed by a pane is that
pane's row and never a second one. Resolution is memoized per `(paneId, ptyPid, cwd)` and
every shared read is already hoisted into the snapshot, so resolving the skipped panes costs
lookups against reads the rebuild has taken regardless.

### D4: A failed registry read replays the last indexed session list, not the last rows

On `{ kind: "failed" }` the projector re-projects the last successfully read session list
through the current worktree ids and appends a `registry` degradation. It caches the inputs,
never the rows.

The worktree set moves independently of the registry — a worktree can be added, removed or
renamed between a successful scan and a failed one — and cached rows would keep naming a
worktree the tree no longer has, which is precisely the "presence names a worktree the tree
does not contain" failure the envelope contract exists to prevent.

The retained list is **replaced** on each success, never accumulated, and per-row first-seen
state is evicted against it. Eviction runs on a successful read only: a failed read's empty
set must not evict, or the retention this decision exists for would clear the very state it
retains. A successful read that finds nothing evicts everything — that is the honest empty.

`degradedSources` already carries first-failure epochs through `failingSince`; `registry`
enters that map by the same path `panes` does, so the stickiness rule needs no new mechanism.

### D5: An external row's timestamps come from the registry, and its rows are ordered

| Field | Value |
|---|---|
| `rowId` | `external:<agent>:<sessionId>` |
| `agent` / `agentSource` | `claude` / `registry` |
| `activity` / `activitySource` | `running` / `registry` |
| `pid` | the registry pid |
| `startedAt` | registry `startedAt`, else when this projection first saw the session |
| `stateStartedAt` | same as `startedAt` — the process has been running since it started |
| `lastActivityAt` | same as `startedAt` |
| `finishedAt` | never set — a live process has not finished |

`lastActivityAt` is the launch time and **not** the scan time. Stamping the scan would make
every external row's ordering key move every 5 seconds, re-sorting the listing and re-rendering
the webview on a poll that found nothing new — and would claim evidence of activity the
registry never gave. The registry proves the process is alive, not that it did anything.

External rows are appended **sorted by `rowId`**. The reader's output order follows `readdir`
and `Map` insertion, while `worktreeRenderSignature` is row-order sensitive — an unsorted
append lets the same set of sessions produce a different signature between polls and do DOM
work for nothing.

### D6: The poll runs an EXTERNAL-ONLY projection

`project(worktreeIds, { external: true })` skips the pane pass entirely and replays the window
rows, ranks and pane degradation the last full projection produced, running only the registry
read and the external pass. It falls back to a full projection when `worktreeIds` differs from
the set those rows were attributed against, so a replay can never name a worktree the tree does
not hold.

Which mode a scan runs is decided by D11, not by whether a debounce timer happens to be armed.

A full projection every 5 seconds is not what the blueprint prices the scan at — it prices a
`readdir`, a JSON parse per entry and a `kill(0)`. A full pass also re-resolves every pane that
has no proven identity, because negative resolutions are deliberately not cached, so a window
holding one plain shell would shell out to `ps` every five seconds forever.

### D7: A failed registry read makes pane identity inconclusive, and says which source failed

`SessionLookup`'s failed arm carries `source: PresenceDegradation["source"]`. A failed process
table reports `panes`, as today; a failed registry read reports `registry` and no longer
resolves to `absent`.

Without this, the typed outcome buys nothing for window rows: `presenceDeps` would index an
empty set on failure, `resolveClaudeSession` would find nothing, and the projector would read
that as a **conclusive** absence and clear the identity of every pane it had proven — the exact
silent downgrade `agentIdentity.ts` was built to prevent, arriving through a different door.

The retained session list from D4 is deliberately **not** replayed into pane resolution.
Resolving a pane against a list a failed read did not produce would manufacture identity
evidence; retaining the identity the pane last proved is the accepted rule, and it is both
cheaper and honest.

### D8: A successful projection re-ranks the cached tree in place

`WorktreeCache` gains `reorder(rank)`, which re-runs `orderWorktrees` over each stored group's
worktrees. `WorktreeHost` calls it after a projection commits its result and before the
envelope is published — no git read.

Worktree order is baked into the cache at `assembleRepo` time, using the rank the projector
held *then*. Presence-only work — a pane change, and now every external poll — updates
`projector.rank()` but never reaches the cached order, so a worktree that just gained a live
external agent would not move until some unrelated git rebuild happened to re-assemble it.

*When* it re-ranks is decided by D12: on every commit is correct but wasteful, and the obvious
cheap guard is wrong.

### D11: Evidence is retired by the consumer that applied it, never by the producer

The rule both D6 and D8 need, stated once. State that exists to make work happen — pane
evidence waiting for a projection, a ranking waiting for the cache — is a **monotonic
generation** owned by its producer plus an **applied marker** owned by the consumer. Work is
outstanding while `generation !== applied`. The consumer captures the generation it is about to
act on **before** it reads its input, and advances `applied` to that captured value only when
the work completed and was not invalidated.

A boolean cannot express this. It answers "is there evidence" where the question is "has THIS
pass seen the evidence", so evidence arriving after a pass read its input is indistinguishable
from evidence that arrived before, and the pass clears a flag it never honoured
(.reviews/round-3.md B1). Capturing before rather than after is deliberate: the failure it
chooses is one redundant pass, against a lost pane transition that persists until unrelated
evidence happens to arrive.

Applied to pane evidence: `WorktreeHost` counts pane events into `paneEvidence`, each full
projection captures that counter before calling `project()` and, on a clean uninvalidated
completion, raises `paneEvidenceApplied` to the captured value. The scan runs the full pass
while the two differ and the external-only pass otherwise. The 150 ms cap keeps its latency
role and loses its bookkeeping one — cancelling it no longer destroys the evidence.

### D12: The cache acknowledges a rank revision, and the projector does not decide for it

`PresenceProjector` exposes `rankRevision(): number`, incremented whenever a projection's
ranking differs from the one it replaces. `WorktreeHost` holds `appliedRankRevision` — the
revision the cached ORDER was built from — advanced at exactly one site, immediately after
`cache.reorder(...)`, and initialized to the projector's revision at construction. `commit()`
re-ranks when the two differ.

**A cache write must not acknowledge it.** The marker is cache-WIDE and only `reorder` is a
cache-wide operation: `applyRepo` establishes order for one repository, rebuilds are serialized
per scope rather than globally, and `merge` deliberately retains the stored worktree array for a
degraded listing — so `applyBuild` does not re-order every group either. A repo-B rebuild
acknowledging a revision that repo A never applied leaves A ordered by the old rank with no
mismatch left to notice, which is B3 again through a second door. Assembly needs no
acknowledgement: while the marker matches, the groups being assembled read the same live rank,
and while it does not, the mismatch survives until one global reorder. The cost is a redundant
reorder after a rebuild that already happened to order things correctly.

`ranksMoved()`, the round-2 fix this replaces, asked whether a projection differed from the
projector's *previous projection* — a question about the producer's history, not about the
consumer's state. A projection the host discarded on the tree-version guard still advanced that
history, so its identical rerun reported "nothing moved" against a cache assembled from the
older rank, and every later unchanged poll agreed (.reviews/round-3.md B3).

## Architecture

```
                    +-- every 5 s, only while some surface is showing
                    |        (external-only: no pane pass, no `ps`)
                    v
WorktreeHost -- requestProjection --> project(worktreeIds, {external?})
     |                                        |
     |                          full pass ----+---- external-only pass
     |                                |                    |
     |                     resolve EVERY pane        replay last window
     |                          |        |             rows + ranks
     |                    claimed ids   attribute           |
     |                          |        |                  |
     |                          v        v                  v
     |                      +--- external pass <-- snapshot.sessions() ---+
     |                      |        ok -> rows(scope:"external"), sorted |
     |                      |    failed -> replay last indexed list       |
     |                      |              + registry degradation         |
     |                      v                                            |
     +-- reorder if rankRevision != applied --> commit --> broadcast -----+

  paneEvidence  ++ on each pane event          rankRevision ++ on a moved ranking
  paneEvidenceApplied  <- captured value,      appliedRankRevision <- captured value,
     on a clean uninvalidated FULL pass           on reorder / cache assembly
```

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `WorktreeHost` scheduling | Two counters and two markers is more state than a boolean, and a marker advanced on the wrong edge fails silently | Every edge is a named test: evidence during a pass, an invalidated pass, a rejected pass, and the return to external-only once applied (task 6_1) |
| `listRunningClaudeSessions` | Two providers and `presenceDeps` unwrap the array today; a silent `.length === 0` on the new object would erase resolution everywhere | The return type changes, so every call site is a type error until updated — task 1_1 owns all three, and its Verify runs the type check, not only the reader's own suite |
| Headless one-shots | The reader's raw array carries `sdk-cli` runs; only the index drops them | D2 — the external pass consumes `index.all()`, so the filter has one site |
| Window pane identity during a registry failure | An empty index reads as a conclusive "no agent" and clears every proven pane row | D7 — the failure is typed through to `SessionLookup`, and the projector retains what it proved |
| External row set | Grows with live Claude sessions **machine-wide**, not with this window | Headless-filtered and liveness-probed at index build; attribution drops every session outside this window's worktrees, so what survives is bounded by the worktree count (§ 7) |
| 5 s poll cost | A full projection re-resolves uncached negatives and shells out to `ps` every 5 s | D6 — external-only pass; the pane pass and the process table are not touched |
| 5 s poll vs the 150 ms pane cap | Both firing near each other runs two projections back to back, and two publications | The poll joins an in-flight run without marking it dirty, and cancels a pending cap — the poll's own projection already covers those pane changes |
| Poll lifecycle | A timer armed per surface outlives the last surface that was showing, or the host itself | The timer is driven by `some(visible && displayed)` over all attached surfaces, reconciled on visibility, on displayed, on attachment disposal, and cleared in `dispose()`; `state.showing` is not the predicate — it stays false after a post that failed |
| Sticky rows on failure | Replaying a stale session list can show an agent that has since exited | Bounded by the spec's own rule — retention is the required behaviour, and the `registry` degradation is what tells the user the rows are not fresh |
| First-seen state for external rows | Evicting against a failed read's empty set would clear the state D4 exists to retain | D4 — eviction runs on a successful read only |
| Row order | `readdir` order reaching a row-order-sensitive render signature causes DOM work per poll | D5 — external rows sorted by `rowId` before append |
| Worktree ordering | Presence-only projections never reach the cached order | D8 — `cache.reorder(rank)` after a projection commits, before publication |
