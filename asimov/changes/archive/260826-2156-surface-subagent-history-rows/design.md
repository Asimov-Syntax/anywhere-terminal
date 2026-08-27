# Design: surface-subagent-history-rows

## Decisions

### D1: The request names a row and the session the view believed it had; the host reads neither on faith

`RequestWorktreeSubagentsMessage` carries `{ rowId, entryId }`, as
[worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.1 already specifies. The host finds
`rowId` in the projection it last published, compares that row's OWN entry id against the one
the request carried, and reads only on equality.

The webview's entry id is an expected-version token, never an argument: the read always uses the
host's own value, so a forged id cannot reach a transcript. It is not redundant either — a
surface whose last envelope delivery was skipped or threw still shows the previous session's row
under the same stable `rowId`, and a row-id-only request would resolve that click against the
NEW session and read the wrong transcript.

### D2: The roster is published on the row, through the envelope that already carries presence

No response message. The host records the roster against the row and re-publishes the
tree+presence envelope, which is how every other presence fact reaches the view.

A second delivery channel would let a recipient hold a roster for a row its current presence
does not contain — the exact representability problem
[worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.2 solved by pairing tree and
presence in one message. It also has nowhere to put the parent-freshness decay D11 requires,
because that decay is a fact about the parent row at publication time.

**This deviates from an accepted blueprint** and is synced back, not ignored:
[worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 3 currently specifies a
`worktreeSubagentsResponse { rowId, subagents, error? }` keyed by `rowId` in the webview, and a
§ 6 edge case answering a row with no entry id with "an empty list, no error". That edge case is
the honesty defect this change exists to avoid — an empty list is the claim "this session
delegated nothing" — so the deviation replaces both, and § 3 and § 6 are updated at blueprint
sync.

### D3: The host owns the roster cache, keyed by row AND entry id

`WorktreeHost` holds the rosters and the in-flight reads, both keyed by the composite
`(rowId, entryId)`, and applies them to the projection at publish time. A roster is kept while
its row is present with the SAME entry id, and dropped otherwise.

Composite keys, not `rowId` alone: a slow read for session A completing after a fast read for
session B stored its roster would evict B's result under the shared key, and the next expansion
would read B again. Applying a roster copies the row rather than mutating it — the rows a replay
hands back are the projector's own retained objects, and writing through them would leave a
roster inside the projector's replay state.

Cache and eviction move only after `commit()` has passed its tree-version check, so a refused
commit changes neither. Disposal clears both maps and makes a late completion a no-op.

Keyed by row alone, a pane that ended one session and started another would keep the first
session's delegations under the second. Held in the projector instead, it would have to survive
that module's two projection modes and its replay path; applied at publish, it is correct in
both without either knowing about it. Eviction runs against the rows actually published, so a
closed pane takes its roster with it.

### D4: The roster is a typed outcome on the row, not an array that means three things

```ts
export type DelegationRoster =
  | { kind: "ok"; rows: WorktreeSubagentRow[]; incomplete?: boolean }
  | { kind: "failed"; reason: string };
```

`WorktreeAgentRow.subagents?: WorktreeSubagentRow[]` becomes
`WorktreeAgentRow.delegations?: DelegationRoster`, `partial` becoming `incomplete` to name what
it means here. Absent means never read; `ok` with no rows
means read and none found; `failed` carries the reason.

One optional array cannot separate "not asked yet", "asked, none" and "could not read", and
collapsing the third into the second is what makes a view state something it does not know. The
shape follows `RunningSessionsOutcome`, which the presence layer already uses for exactly this
distinction.

### D5: Incompleteness is whatever the READER admits it dropped, and completeness is never claimed

The roster is incomplete when the detail it was mapped from reports source omission
(`partial`), reports it is pageable at a limit that is already the maximum (`truncated`), or
declares more delegations than it handed over (`stats.subagentCount` exceeding the rows mapped).

The original form of this decision claimed those three signals COVERED source omission. Round 1
B5 disproved it: OpenCode's direct-child query is capped at `CHILD_LIMIT = 100`
(`opencodeReader.ts:51`, applied at `:698`) with no overflow probe, while every sibling bounded
query in that same read has one. A session with more than 100 direct delegations lost the older
ones with nothing to say so, and the third signal could not see it because
`subagentCount` counted only `subtask` parts (`:545`) — which are themselves head+tail windowed,
so it was already the smaller number.

The correction is not a fourth signal in the mapper. It is that **each signal is a report the
reader owes, and a bound with no probe behind it is a reader defect** — the mapper cannot infer
what a query silently truncated. Two obligations follow, and they belong to the reader:

- every bounded query whose overflow would drop delegations carries a probe, and overflow is
  reported as source omission through `partial`, exactly as the message and part windows
  already do;
- `subagentCount` is the count the source declares, not the count one window survived —
  `Math.max` over the delegation evidence available, matching `detail.ts:854`
  (`Math.max(spawnCalls, totalStubs)`), rather than a single incrementing counter.

None of the three signals proves completeness, and the corrected version does not either. An
equal count is still consistent with a reader that undercounted, so "complete" remains only the
absence of evidence of omission, and the section never says "this is everything".

### D6: Rows come from BOTH delegation item kinds, and the READER owes one item per delegation

The read is `VaultService.getDetail(entryId, MAX_DETAIL_LIMIT)`; rows are its timeline items of
kind `subagentSession` **and** kind `subagent`, mapped to `WorktreeSubagentRow` with
`live: false` hard-coded, `name` from the item's declared agent falling back to its title,
`status` passed through with an absent value becoming `unknown`, and an `entryId` retained for
drill-down only where the item has one.

Both kinds, because a delegation whose child transcript was never matched is recorded as the
plain `subagent` step rather than a `subagentSession`: it is a delegation that happened, with no
transcript to open. Taking only the richer kind would silently drop exactly the delegations
whose evidence is thinnest.

**The one-item-per-delegation guarantee is the reader's, not an assumption the mapper may
make.** The original form of this decision asserted "a timeline carries one item per delegation,
so the two kinds cannot double-count one call". Round 1 B2 disproved it for OpenCode:
`opencodeReader.ts:544-551` pushes a `subagent` step for every `subtask` part and `:759-761`
pushes a `subagentSession` stub for every child session row, uncorrelated, so a delegation that
did both appears twice. Claude's reader already upholds the guarantee — `detail.ts:785-797` is
an if/else, and a matched stub is pushed INSTEAD of the plain step.

So OpenCode's reader is brought up to the contract Claude's already meets, rather than the
mapper learning to de-duplicate. Three reasons, in order of weight:

1. **The mapper cannot do it correctly.** Measured against a real store, the two sources are not
   two views of one list: part rows are head+tail windowed and the child query is not, so a
   session with four `cf-review-master` delegations surfaced four child stubs and one surviving
   `subtask` part. A mapper de-duplicating by name would collapse the four real delegations into
   one; the reader knows which of its own windows dropped what.
2. **The duplicate is already visible elsewhere.** `getDetail` is the shared vault detail
   contract, and the preview overlay renders the same timeline. The duplicate row is a
   pre-existing defect in the preview, not one this feature introduces — fixing it at the reader
   fixes both, and fixing it at the mapper leaves the preview wrong.
3. **The correlation already exists to reuse.** `matchStub` (`detail.ts:878`) matches a stub to
   a spawn call by description and then by agent type. OpenCode has no id linking a `subtask`
   part to a child session — verified against a real store, where a subtask part's `data` carries
   only `type, prompt, description, agent, model, command` — so the same description-then-agent
   correlation is the available one, and reusing its shape keeps the two readers answering the
   same way.

A `subtask` part that correlates to a child session yields the `subagentSession` item alone; one
that does not still yields its `subagent` step, which is the unmatched-delegation case both
readers must keep.

Nesting stays one level: a child's own delegations are not read.
[worktree-agent-presence.md](../../../docs/design/worktree-agent-presence.md) § 3.6 makes this a
claim about structure — the roster reports what THIS session delegated, and a deeper tree would
report structure the view cannot support.

### D7: A transcript's recorded status is passed through the mapping, and judged at publication

The mapper reports what the transcript recorded — a delegation whose record says `running` maps
to `running` — because suppressing it there would discard the only outcome information the
source has. Whether that status may still be published is D11's question, not the mapper's.

### D11: A child's `running` does not outlive its parent's freshness

At publication, a delegation reporting `running` is republished as `unknown` unless its parent
row is itself `running` or `waiting` AND no degraded source covers that row's evidence.

[worktree-agent-presence.md](../../../docs/design/worktree-agent-presence.md) § 3.6 makes this a
rule rather than a nicety: "a stale parent cannot have provably-working children, and letting
one child keep a `running` status after its parent went unknown is how a roster starts
describing work that ended long ago". The existing rendering inherits only the parent's AGE, so
without this the ellipsis survives a parent that has gone stale, exited, or lost its evidence
source. It is applied in the same pass that publishes the parent, which is what makes the two
incapable of disagreeing.

### D8: One read in flight per row, and a re-expansion does not re-read

A row with a roster already recorded for its current entry id is not read again, and a second
request for a row whose read is in flight joins it rather than starting a second.

Expansion is a user action that repeats — collapse and re-expand is one click each way — and
the transcript is the largest file this feature touches. The freshness cost is accepted: this
is history, and § 3.6 already states that a subagent started seconds ago may not be on disk.

### D9: The disclosure is offered by the presence of a session, not by children already held

An agent row offers its expand affordance when it carries an entry id. The old rule — offer it
when the row already has children — cannot work once the children are fetched on expansion:
there would be nothing to click to cause the fetch.

A row with no resolved session offers nothing, which is also the honest state: with no session
there is no roster to ask for, and no claim is made about whether it delegated.

### D10: An expanded row always renders its section, in one of four states

Reading | none | the rows | could not read. The section renderer exists
([worktree-panel-ui.md](../../../docs/design/worktree-panel-ui.md) § 3.4) but assumes rows;
these three additional states are what a lazy read makes reachable, and each maps to exactly one
`DelegationRoster` state — absent while the read is in flight, `ok` with no rows, `ok` with rows,
and `failed` with its reason. An incomplete roster (D5) renders the rows plus a note that older
delegations are not readable.

### D12: This change carries its own routing, and `wire-worktree-navigation-actions` replaces it

Round 1 B1: neither provider forwards `requestWorktreeSubagents`
(`TerminalViewProvider.ts:1284-1291`, `TerminalEditorProvider.ts:641-647` enumerate
`requestWorktreeTree` and `worktreeViewVisibility` only), so nothing this change built is
reachable in any surface.

The durable fix — replacing both hand-kept enumerations with a membership test derived from the
message union, plus a compile-time exhaustiveness check — is owned by
`wire-worktree-navigation-actions` task 1_1, because that change adds seven more types to the
same two switches and the enumeration is what loses them. It is not duplicated here.

This change still carries the two-case forward itself. A feature that ships inert until an
unrelated change lands is not a shipped feature, and the round that found this is a REJECT on
this change, not on that one. The overlap is safe in one direction only: the other change
DELETES both enumerations wholesale, so it must expect to find three cases where its plan
described two, and it removes them all either way.

### D13: The section's empty state is a claim, so it is made only when the reader made it

Round 1 B3: `worktreeTreeView.ts` returns on `roster.rows.length === 0` before reaching the
incompleteness note, so `{kind: "ok", rows: [], incomplete: true}` renders a bare "No delegations
found" — the strongest claim in the four states, at the one moment the reader has said it does
not know.

An empty roster carrying `incomplete` is not the empty state. It says the read found nothing it
could still see, which is what "could not be read" means for a roster with no rows. This is D10
applied where its four states meet rather than a fifth state: the branch order becomes a test of
the CLAIM (does this roster assert it is whole?) before a test of the count.

### D14: The view's asked-set is reconciled against what was published, like every other cache here

Round 1 B4: `requestedRosters` is a permanent set while the host evicts rosters against the rows
it publishes (D3). The two disagree the moment a row leaves and returns under the same
`(rowId, entryId)`: the host has dropped its roster, the view will not ask again, and the row
sits on "Reading…" with nothing coming. A row that loses its `entryId` keeps an expanded section
and loses the disclosure that would collapse it (D9), and the set grows without bound as
sessions churn.

One rule fixes all three, and it is the rule D3 already uses at the other end: keyed state is
reconciled against the identities actually present, not accumulated. The view prunes both its
asked-set and its expanded-rows set against the `(rowId, entryId)` pairs the current presence
carries, on the same pass that already prunes expansion state for rows that vanished.

## Architecture

```
webview expand ──> requestWorktreeSubagents {rowId, entryId}
                        |
WorktreeHost: rowId --> published row --> row.entryId === request.entryId ?
                        |                            |
                     no / no row / none          getDetail(entryId, MAX_DETAIL_LIMIT)
                        |                            |
                     nothing published    ok  -> subagentSession + subagent items -> rows
                                          |      incomplete if partial | truncated | count > rows
                                          null/throw -> {kind:"failed", reason}
                        |                            |
                        +--> rosters.set(rowId\0entryId, roster) --+
                                             |
             commit (after the tree-version check):
               row -> {...row, delegations: roster for (rowId, entryId)}
               child "running" -> "unknown" unless parent live and undegraded   [D11]
               evict rosters whose (rowId, entryId) was not published
                                             |
                                      envelope ──> every showing surface
```

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `WorktreeAgentRow.subagents` → `delegations` | The webview, its fixtures and the row tests all read the old field; a missed site renders nothing with no type error if the field is merely optional | The field is REMOVED rather than deprecated, so every reader is a type error until moved (task 1_1's Verify runs the type check) |
| Roster cache | A roster surviving its row, or its session, states delegation history for the wrong session | Keyed by row AND entry id, evicted against the rows actually published (D3) |
| Transcript read | A large transcript read on every expansion, on the publish path | One read per row per entry id, joined while in flight, never on a routine update (D8) |
