# Worktree Subsystem — Recorded Debts

> Ref: [DESIGN.md](../DESIGN.md) § 8.5, § 8.7 — this doc EXPANDS them.

## 1. What this document is

Every item here was raised by a review round on a shipped change, adjudicated **valid and
non-gating**, and then deferred with a written reason. They are not new ideas. Each carries the
triage line that deferred it, because that line is what says how big the work actually is: a
finding deferred as *"needs a decision, not a patch"* is a design question, and a finding deferred
as *"repo-wide work"* is not fixable at one call site without making that site the odd one out.

The common shape: the fix was correct but its **blast radius exceeded the change that found it**.
Fixing containment in one resolver while three others keep the old rule makes the codebase less
consistent, not more. That is why these are planned as their own slices rather than folded into
whatever change next opens the file.

Scope boundary: this doc owns only the debts listed in § 2. It does not reopen any decision in
[worktree-panel-ui.md](worktree-panel-ui.md), [worktree-scope.md](worktree-scope.md), or
[worktree-agent-presence.md](worktree-agent-presence.md); where a debt touches one, it says so and
defers to that doc's contract.

## 2. The debts

### 2.1 Containment is lexical, and a symlink walks through it — SHIPPED (WT-011.1, WT-011.6)

Four vault path resolvers decide "is this candidate inside the root I control" with
`path.relative` plus a `..` / absolute test. That is a **string** comparison: a symlink inside the
root pointing outside it satisfies every one of those checks, so a candidate that lexically looks
contained can resolve to a file that is not.

No privilege is gained today — the caller already reads vault transcripts — but the rule is
inconsistent with the discipline the rest of the subsystem states in DESIGN.md § 8.5, where
webview-supplied paths refuse symlinked components outright.

**Why it was deferred**: *"lexical containment is the repo's established discipline in four other
resolvers and no privilege is gained. Fixing it here alone would make this the only path with a
different rule, which is worse than consistent. Backlogged as repo-wide work."*

**One rule, applied everywhere — but not the walker the repo already has.** `realpathTolerant`
looks like the answer and is not: it swallows *every* `realpath` error and rebuilds the unresolved
tail lexically. That is right for naming a worktree that may be missing, where refusing would erase
a row the user needs to see, and wrong for authorizing a read, where a dangling link that fails to
resolve would be rebuilt into a literal path and pass containment.

So the tolerance has to be narrower than the walker's, and narrow in a specific direction: a
resolver that hard-fails on a **missing** file would turn "no transcript yet" into an error, and a
transcript that has not been written is the normal early state of a session (see
[worktree-agent-presence.md](worktree-agent-presence.md) § on the retry ladder). Absence beneath a
parent that did resolve inside the root is tolerated; every other resolution failure is refused.

**Two consequences, two slices.** The resolvers that gate a transcript *read* are one problem, and
they shipped as WT-011.1. The comparisons that decide which worktree or repository a path belongs
to — raw workspace-folder and Git API paths, pane cwds, webview paths — carry the same lexical
error with a different consequence: misattribution, not an escaped read. They run on per-push paths
and have their own acceptance story, so they shipped separately as WT-011.6.

**What WT-011.6 shipped: the bounded side resolves, the unbounded side does not.** A read guard
resolves its candidate every time because the answer authorizes something. Attribution decides which
heading a row appears under, so it may cache — and must, since these comparisons run per presence
push and per git refresh. The rule that fell out is about *who produced the path*: a path that comes
from a bounded set the window owns — the panes it holds, the folders it has open, the repositories
the Git API lists, the root a tree is mounted on — is resolved ONCE where that set is produced, and
a path arriving per event is not resolved at all. `normalizeWorktreePath` already realpathed the
worktree ids, so only the candidate side was ever unresolved.

That cache is a shared `ResolvedPathMemo`, and sharing it is what made the lifetime the hard part
rather than the resolution. Four review rounds were spent there and all of them on the same
question: **when does a path stop being needed?** An entry records its claimants; a release drops
one claim and the entry goes when the set empties. A pane closing is not a structural filesystem
event — the directory did not move — it says one consumer stopped asking, which is why "invalidate"
and "release" had to become two different verbs. A consumer that reads its answers immediately
rather than standing on them (a removal assessment) takes its own claim and drops it in a `finally`,
because two passes through one claim release each other's paths mid-flight.

The webview half needed its own care: the resolved root travels as a SEPARATE field from the mounted
one, because `workspaceRoot` mounts the tree and is shown to the user — realpathing it in place would
display `/private/var/...` where the user typed `/var/...`. And the correction that carries it is
gated on a *delivered* init rather than on the webview announcing itself, since a resolution settling
inside the init retry window would otherwise reach a webview with no controller and be dropped.

**What shipped, and the two things review added to it.** `isResolvedPathInside` lives beside
`isPathInside` in `src/utils/pathBoundary.ts`; the two share their boundary rules through a core
parameterized by its normalizer, because the one thing they must disagree about is case.
`isPathInside` folds Windows case, which is right for the worktree ids it compares and fatal for a
read guard — a case-sensitive directory makes `C:\vault\Store` and `C:\vault\store` two places.
And the root is resolved once per *operation* rather than per candidate: a listing pass, a scan
across project directories, a tie-break over several subagents. The candidate still resolves every
time, and containment is never cached — a file stamp is not an identity.

### 2.2 A window's "first row-drawing surface" has no single owner — SHIPPED (WT-011.2)

The promotion from *presence subscribed* to *rows drawn* is decided in more than one place, and at
least two boundaries where a window gains its first row-drawing surface do not reach the promotion.
The concept is real and load-bearing — it is what decides whether a window subscribes to presence
at all — but it is spelled out inline at each site rather than defined once.

**Why it was deferred**: raised as a WARN on a fix round whose subject was the subscription seam,
not the promotion rule. Correcting the rule means changing what every boundary agrees the concept
*means*, which is a contract change rather than a missed branch.

This is the one debt with no round file of its own; it was carried as a follow-up note.

**Boundary**: this task defines the concept and routes every existing boundary through it. It does
not change when a window subscribes — only which boundaries are recognised as reaching the same
state.

**What shipped.** The owned concept turned out to be narrower than "is any surface drawing rows",
which the host could already answer. It is the **conjunction**: rows are drawn *and* the envelope
already published was built without enrichment. That join is `enrichmentOwed()`, reconciled after
every change to the three inputs — a window's visibility, its declared level, and whether its
surface is displayed — with no rising-edge snapshot, because "is enrichment owed now" is the
question and "did this call change it" is not.

One boundary could not be closed by the trigger alone: a promotion arriving *during* a rebuild
joins a run that has already decided not to enrich, and a joining caller deliberately does not
invalidate that run — otherwise every polled scan would buy a second projection. So the run itself
carries the obligation, and schedules exactly one enriching follow-up when it would otherwise finish
owing one. It does so only when the pass was **otherwise clean**: an invalidated pass reruns anyway
and re-reads the predicate, and treating enrichment as invalidation would have stopped a clean pass
acknowledging the pane evidence it consumed, and downgraded a rerun that new evidence required to
be a full one.

### 2.3 The transcript read has no time bound — SHIPPED (WT-011.3)

The preview path issues `stat` and `read` against files on the user's disk with no timeout and no
cancellation. A slow or hung filesystem — a stalled network mount, a sleeping external volume —
blocks the look with no ceiling. The cadence gate limits how *often* a look starts, not how long
one may take, so a hung read holds its slot indefinitely.

Related but distinct: the cache cap bounds **memory**, not **work**. It caps how many entries are
held; it does not cap how much re-checking those entries provoke per cadence tick. A window with
many rows does bounded-size bookkeeping over an unbounded amount of I/O.

**What shipped.** A look now carries one deadline covering resolution and reading alike. Expiry is a
third settlement class beside success and failure: it scores a miss, takes the same retry ladder, and
hands the row back the line it last read. The attempt it abandons keeps running — nothing on this
path takes an `AbortSignal` — but writes through a draft only the winner of the race commits, so a
read that completes thirty seconds late cannot blank the line the deadline preserved. Reviews found
that mechanism twice from opposite directions: a generation fence on the settlement handlers alone
left `look`'s own `forget`/`clearTarget` calls unfenced, and committing inside the look's handler
still ran before the race had said who won. Outstanding work is bounded at one look per session and
`cap` in total, tracked outside the entry cache so eviction cannot release a stalled session; the
deadline a look outruns is cancelled, because `outstanding` releases the look and would never have
counted its timer.

That second half has two owners, and planning WT-011.3 separated them. The preview service owns how
many looks may be outstanding at once — and must, because its own eviction is what releases a session
whose look is still stalled, letting the next ask launch a second read against the same hung path.
The projector owns how many looks a single projection starts, because it enriches one worktree's rows
and awaits them before the next, so no service-side concurrency limit is ever reached. WT-011.3 takes
the first; WT-011.7 takes the second.

**What shipped for the second half (WT-011.7).** The projector carries an explicit per-projection
budget — 16 — spent across every drawn row at once rather than per worktree, so ten rows in one
worktree and ten spread across ten cost the same. Rows outside the budget are answered synchronously
from what the preview service already holds rather than skipped, so they keep drawing their last
line, and only the permitted rows are awaited.

Whose turn it is, is a queue over row IDENTITY holding exactly the ids being drawn now. Two earlier
mechanisms failed and the reason is worth keeping: an index into a list whose membership changes is
not a position in any stable order, and a queue that REMEMBERS absent identities cannot be made fair
either — it must be bounded, a bounded queue must eventually forget one, and a forgotten id is
indistinguishable from an arrival when it returns. Both attempts at fairness across absence starved
one population to feed the other. So the promise is narrower than first written and now says so:
fairness is guaranteed for a row drawn on EVERY projection, structurally — nothing is ever inserted
ahead of an id already queued, so the count ahead of it never grows — and a row that stops being drawn
re-enters as an arrival.

Retention is narrower too. An exact declared set could not survive the look timeout, because an
abandoned look keeps its entry in `outstanding` carrying its pre-stall line and the ordinary ask path
seats it back. So the cache cap is the retention rule again, and what keeps an excluded row's line is
that the synchronous read TOUCHES what it returns: every drawn row is touched every projection, so the
LRU's victims are rows the window has stopped drawing. Past `cap` drawn rows a line can be lost, and
the row re-looks.

The queue needs an owner for the FALLING edge, which nothing had: it is reconciled only by an enriched
projection, and that is exactly what stops arriving when the last row-drawing surface goes away. The
host now settles both directions where it already settled the rising one, and the projector samples a
generation before the first await of a projection so a pass that started before the edge cannot
rebuild the queue from rows nobody is drawing.

**What shipped for the reopen half (WT-011.10).** The host records an envelope as enriched from what
was REQUESTED, not from whether preview enrichment completed, so a pass whose preview half the fence
skipped used to suppress the replacement pass on reopen. Rather than widen `WorktreePresence` with a
"how complete is this" field every consumer would see and one would use, the host keeps an explicit
obligation beside it: when the row-drawing falling edge fires *while a projection is in flight*, that
projection is exactly the one the fence will cut short, and the obligation is recorded. The owed
predicate reads it alongside the envelope's own enrichment.

Where that obligation is discharged took three attempts and only the third is correct. Clearing it
where the envelope's enrichment is RECORDED fails because the cut-short projection publishes *after*
the edge and wipes what the edge just recorded. Clearing it where a RUN starts fails worse: projection
is single-flight, so a surface reopening mid-run joins the run in flight and never reaches a run-level
clear — the joined pass then completes clean, finds the obligation still standing, dirties itself, and
does so again on every following pass, so the loop never exits and nothing is ever published. The unit
is the **pass**: each iteration clears at its own start and only when it is going to enrich. An edge
landing before an iteration is what that iteration's enrichment answers; an edge landing during it
re-records, and the loop spends that on exactly one more pass. A run whose projection *rejects* puts
back what its passes cleared, because a thrown pass leaves the envelope still marked enriched and an
un-restored obligation would read as satisfied.

The falling edge only ever records; it never requests. The rise spends the obligation through the one
path that already asks for projections — which is what keeps the reconcile a state settle rather than
an edge check (clearing the envelope's enrichment there instead fires on every mutation while nothing
draws, and moved 19 existing cases).

**Why it was deferred**: *"Performance-only, on a path already gated by the recheck interval, and a
timeout on `stat`/`read` is a new failure-surface decision rather than remediation."*

That triage is the whole point: choosing what a timed-out read **means** is a design question. It
has to fail in a direction. The direction is *fail soft*: a look that times out is a look that
achieved nothing — the same state as "not there yet" — so it feeds the existing retry ladder and
backs off, rather than being recorded as a resolution or as an error the user sees. A transcript
that is slow today is usually readable tomorrow, and a row that blanks on a slow disk would be a
worse lie than a row that keeps its last known line.

### 2.4 A row can draw the same sentence twice — SHIPPED (WT-011.4)

A row's tooltip joins its title, its preview, and its confidence caveat. For a session whose only
message *is* its title — a one-message session, which is every session at its first render — the
preview repeats the title verbatim, and the row shows the same sentence on two lines.

**Why it was deferred**: *"Real, and a row drawing the same sentence twice is worth fixing — but
'suppress the preview when it equals the title' is a new rule about what a row shows, which
neither the spec nor D3 carries. It needs a decision, not a patch."*

**What shipped.** One pure `presentedPreview` in the view's format layer decides it, and both the
second line and the row's hover text read from it. Planning found two further answers to the same
question already on the books and retired them: `worktree-panel` still required decorative frames to
be stripped from a preview, a rule `source-the-agent-row-preview` reversed in code and in the UI doc
without withdrawing it, and its neighbouring scenario made a marker-only preview render as no line at
all — which the newer presence contract explicitly forbids. Three rules for what a preview shows are
now one.

The decision this task must make and record: **the preview is suppressed when it adds nothing.**
"Adds nothing" is exact equality after the same normalization the title already receives — not
fuzzy similarity, not a prefix test. A near-match that is not an exact match still tells the user
something the title did not, and a heuristic that hides it would be a second, worse lie in place of
a redundancy. Owned by [worktree-panel-ui.md](worktree-panel-ui.md) § 3.3, which specifies the row's
preview line; this doc records only that the suppression rule exists and where it lives.

### 2.5 A preview outlives the entry it described — SHIPPED (WT-011.5)

When a vault entry disappears, the preview service clears the cached line but keeps the entry's
resolved target. A row can therefore keep presenting a line sourced from a transcript whose vault
entry no longer exists.

**Why it was deferred**: the fix hands the projector's live entry-id set to the service, which
moves ownership the change's D2 assigned. *"That is a design change, not remediation, so it belongs
in a change of its own."*

**The ownership question this task settles**: who knows an entry is gone? Two candidate owners —
the projector pushing its live set down, or the service treating a failed re-resolve as a deletion.
The second is preferred and is what this doc records: the service already re-resolves on the
ordinary cadence and already distinguishes "not there yet" (`unresolved`, retried) from "never
will be" (`uncovered`). A vault entry that has vanished is neither — it is a *third* outcome, and
naming it in the service keeps the knowledge where the syscall already happens, with no new
cross-layer push and no second definition of "live" to keep in sync.

The distinction that must not blur: **a transcript that is temporarily unresponsive is not a
deleted entry.** § 2.3 grants the kept line to a look that *times out*, not to one that fails: a
read that fails outright already retires the line, and `worktree-agent-presence` § "An agent row's
preview line says what its session last did" requires exactly that. This debt adds a third case
either side of that pair — the entry itself is gone — and retires the line permanently rather than
on the retry ladder.

**What planning found, and what it cost**: the service could not ask that question at all. `getEntry`
returned `null` for a deleted entry *and* for a reader that failed — `codexReader.ts` said so in its
own comment, `// query-error → unresolved (caller treats null as unknown-entry)` — so a mechanism
built on `null` would have retired a live session's line on a transient SQLite error, which is the
exact confusion this debt exists to end. A conclusive `found | absent | unknown` answer was a change
to the vault readers' contract and a separate invariant owner, so it shipped first as WT-011.8.

**What shipped.** The service consumes `VaultEntryLookup` directly: `absent` — reachable only from an
enumeration that completed without the session — retires the line into a third `gone` target that
makes no syscall of any kind, and every inconclusive answer is `unknown`. `gone` is not final:
the store is re-consulted on its own interval, an order of magnitude slower than the freshness check
beside it, so a session that comes back previews again. That interval is the gap between two
lookups and not a wall-clock bound on the stale line — the service is pull-based, and a row nothing
asks about is a row nothing re-confirms.

The half that took a review round is the one that looks like a detail: an `unknown` must change
**nothing**. Blanking the line on an inconclusive answer is the same thing the user sees as retiring
it, and letting the look carry on into its ordinary freshness work is worse than it appears —
an inconclusive answer deliberately does not stamp the confirmation time, so the row stays
permanently due, and one unchanged `stat` there resets the retry ladder and puts the next store
lookup back on the freshness cadence. The bound is only a bound while the inconclusive path stays
inert.

## 3. Deferred again, with reasons

These were reviewed in this pass and deliberately **not** planned:

| Debt | Why not now |
|---|---|
| Render-signature fields are joined unescaped | The separator is `U+0001`. Git refnames forbid control characters, and no real filesystem path carries one, so the collision needs an input that cannot occur through any supported path. Recorded as a latent correctness note on the signature's owner, not scheduled — escaping every field costs a hot-path allocation per row to close a hole nothing can reach |
| `ContinueDialog` and the worktree dialogs keep parallel modal lifecycles | A behaviour-preserving refactor across a boundary neither this phase nor any planned task opens. Belongs to a refactor change with its own admission test, not to a hardening phase |
| Launch and prune dialogs are not tracked for disposal | Same shell as the row above and fixed by the same consolidation; planning it separately would produce two changes editing one seam |
| Depth collision between an in-tail worktree row and an agent row | Raised before WT-010's rail composition landed. The level ladder it describes was rewritten by the rail work; re-verify against the shipped tree before planning, rather than planning against a structure that no longer exists |
| Keyboard teleport from a non-row control inside the tree | Same reason — the roving-tabindex set moved with the rail composition and the inspector drawer |

## 4. What "done" looks like

This phase is finished when the subsystem holds **one** rule per concept, not when a list is
emptied:

- one containment rule, applied at every vault resolver
- one definition of a window's first row-drawing surface
- one bounded, fail-soft transcript look
- one statement of what a row shows when the preview repeats the title
- one owner of "this entry is gone"

Each is independently shippable and independently rejectable. None changes what the worktree
panel presents when everything is healthy — which is the property that makes the whole phase
reviewable as hardening rather than as feature work.
