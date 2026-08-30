# Design: bound-the-lifetime-of-a-transcript-look

## Decisions

### D1: The bound is on the whole look, not on each syscall

One deadline covers a look end to end — the vault entry fetch, resolution, `stat`, and `read` — not
one deadline per filesystem call.

A look is a chain of awaits, and every link touches something that can stall: `deps.entry` reads the
vault, `resolve` calls `realpath` or scans the Codex sessions directory, then `stat`, then `read`.
Bounding each call separately would let a look that stalls a little at four links exceed any per-call
bound while never tripping one, and it would put the timeout in four places instead of the one place
that owns what a look means. The row's contract is "answer me within a bound", and the whole look is
what the row waits on.

### D2: Expiry is a third settlement class, not the existing rejection

`preview` today has two settlement paths: resolve (score progress, reschedule, return the line) and
reject (`misses += 1`, reschedule, `forget` — which clears the cached line). Expiry adds a third:
`misses += 1`, reschedule, **return the last known line unchanged**.

The distinction is the whole point of the task. A rejection is evidence the transcript cannot be
read, so retiring the line is honest. A timeout is the absence of evidence — the same state as "not
there yet" — and blanking a row because a volume was asleep replaces a slightly stale line with a
false one (DESIGN.md § 9 D33). Expiry does not touch `Target`: the registry entry in DESIGN.md § 12
already fixes a timeout as `unresolved`, and a fourth `Target` kind would contradict it.

### D3: A look mutates a draft; only a current attempt commits

`look` is rewritten to read and write an attempt-local **draft** of the five fields it owns —
`entry`, `target`, `stamp`, `line`, `progressed` — seeded from the `Held` at the moment the attempt
starts. `preview` copies the draft onto the `Held` only when the attempt is still the current one.
An abandoned attempt commits nothing.

The obvious cheaper fence — a generation counter checked in the two settlement handlers — does not
hold, and this is the correction that matters most in this design. `look` does not confine its
writes to its return value: it calls `forget` and `clearTarget` on ordinary **resolved** paths
(`sessionPreviewService.ts:187, :197, :224, :231`), and assigns `current.target` at `:194`. So an
attempt that expired at 5 s and had its miss scored can, thirty seconds later, discover the file is
gone and blank the very line the expiry promised to keep — before any settlement handler is reached
to notice its generation is stale. Fencing the handlers fences the bookkeeping and nothing else.

The generation counter stays, as the *commit* test rather than the scoring test: an attempt captures
`++current.generation` when it starts, expiry bumps it, and both settlement handlers commit their
draft and score only while it still matches. One check, one place, and the two properties the spec
demands — "SHALL NOT be recorded as a resolution" and "SHALL NOT retire the row's line" — become the
same rule instead of two.

```ts
const generation = ++current.generation;
const draft: LookDraft = { ...snapshot(current), progressed: false };
const scored = look(entryId, draft).then(
  (line) => {
    if (current.generation !== generation) return line;   // abandoned: commit nothing
    commit(current, draft);
    current.misses = draft.progressed ? 0 : current.misses + 1;
    schedule();
    return line;
  },
  () => {
    if (current.generation !== generation) return undefined;
    commit(current, draft);
    current.misses += 1;
    schedule();
    return forget(current);
  },
);
```

Draft-and-commit also makes two live attempts on one session harmless in principle — each owns its
draft, and the stale one's generation loses — which is why D4's single-attempt rule can be justified
on work grounds alone rather than as a correctness crutch.

### D4: The attempt registry owns the session, and eviction does not release it

A second map, keyed by entry id, holds an `Attempt` record for every look that has not settled —
abandoned ones included. The record carries the **owning `Held`** and the raced promise, not just a
promise. `preview` consults it in three places:

```ts
const running = outstanding.get(entryId);
const current = held.get(entryId) ?? running?.owner ?? freshHeld();
...
if (running) return running.shared;         // before expiry: share it. after: it resolves to the last line
if (outstanding.size >= cap) return current.line;
```

Adopting `running.owner` before building a fresh `Held` is what makes the bound survive eviction, and
holding only a promise there does not. `touch` drops the least recently asked entry whenever `held`
exceeds `cap` (`:133-142`), and `preview` rebuilds from scratch on the next ask (`:266-270`). With a
promise-only registry, a window with more rows than `cap` evicts a session whose look is stalled; the
next ask constructs a fresh `Held` with `generation` back at zero, no `line`, and no `inflight`; the
row that had a good line is answered `undefined`, the abandoned attempt's late writes land on an
orphan nobody will ever read, and the existing re-seat guard (`if (!held.has(entryId)) touch(...)`)
declines to restore it because a newer object already holds the key. Re-adoption removes all three at
once.

`cap` is reused as the concurrency limit rather than adding a second knob: it already answers "how
many sessions is this service willing to be busy with", and a limit above the number of retained
entries would bound nothing useful. At the default of 256 the ceiling is far above any real window,
so the limit binds only in the pathological case it exists for.

A look that never settles therefore parks its session on its last known line and stops provoking
work. `cap` permanently hung sessions would starve new ones — accepted deliberately: the alternative,
retrying into a hang, is the unbounded behavior being removed, and a machine with 256 simultaneously
wedged transcripts has a problem this service cannot answer.

### D5: The clock is a dependency, and the deadline is a floor

`SessionPreviewDeps` gains `lookTimeoutMs?: number` (default 5000) and `wait?(ms): Promise<void>`
(default an unref'd `setTimeout`, so a pending timer never holds the extension host's event loop
open). Every other input this service touches is already injected — `entry`, `read`, `stat`, `now`,
`recheckMs`, `cap` — and a test proving "answered after the deadline" must resolve the deadline
itself rather than wait five real seconds.

The spec says the row is answered *at the first opportunity after* the deadline elapses, not *within*
it: `setTimeout` schedules a minimum delay, and a busy extension-host event loop can only make it
later. Promising a wall-clock ceiling would be a contract this mechanism cannot keep.

Whichever side loses the race is left pending rather than cancelled — neither `fs.stat` nor the tail
reader takes an `AbortSignal` on this path. A won look leaves one unref'd timer firing into a settled
race; an expired look leaves the filesystem operation running, committing nothing under D3. Both are
bounded: one timer and one operation per attempt, and attempts per session bounded by D4.

### D6: Registry cleanup rides the scored promise, never a bare `finally` on the raw look

The `outstanding` entry is deleted from a `.then` on the **scored** promise — the one whose two
handlers D3 defines, which therefore never rejects — and not from `rawLook.finally(...)`.

`finally` returns a *new* promise that adopts the original's rejection. Hanging cleanup off the raw
look and discarding the result would leave that derived rejection unobserved, so a transcript read
that throws after its deadline surfaces as an unhandled rejection in the extension host — a crash
report for the one failure mode this change exists to make quiet. The scored promise settles exactly
when the raw look does, which is the timing cleanup needs.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `look` | An abandoned attempt blanks the line expiry promised to keep, via `forget`/`clearTarget` on its own resolved paths | D3 draft-and-commit; unit test stalls a `stat`, expires it, then lets it discover a deleted file and asserts the row still shows its last line |
| `preview` settlement | Expiry and settlement both score one look, double-advancing the backoff ladder | D3's generation is the commit test; unit test asserts one miss for one hung look across both settlements |
| `touch` eviction | Eviction resets `generation`, strands the line, and licenses a second operation against the same hung path | D4 re-adopts `running.owner` before building a fresh `Held`; unit test drives more distinct ids than `cap` through stalled reads and asserts the outstanding count stays at `cap` and the evicted row keeps its line |
| Outstanding filesystem operations | Growth axis: distinct sessions asked for × cadence ticks. Unbounded today | D4 bounds concurrent attempts at `cap` (default 256) and at one per session |
| `held` map | Growth axis: distinct session ids asked for. Already bounded by `cap` via `touch` | unchanged — eviction still runs; D4 makes it lose nothing |
| Raw look rejecting after its deadline | Unhandled rejection in the extension host | D6 — cleanup rides the scored promise, which never rejects |
| Extension host shutdown | A pending deadline timer keeps the process alive | `unref()` on the default timer (D5) |
| Total looks per projection tick | `previewFromVault` awaits one worktree's rows before starting the next (`presenceProjector.ts:477-487`), so `cap` gates concurrency but not the count per projection | Out of scope — a fan-out decision the projector owns; relocated to blueprint task WT-011.7, which depends on this change |
| Filesystem | Mutable resource outliving the request | n/a — read-only; no handle held, nothing written, no lock taken |
| `held` / `outstanding` maps | Two racing writers corrupt state | n/a — single-threaded per extension-host window; the only interleaving is between awaits, which is what D3 and D4 govern |
