# Design: expire-a-deadline-when-its-own-wait-completes

## Context

`afterDelay(ms)` (`src/worktree/deadline.ts`) hands out two things about one deadline: `elapsed`, a
promise resolved by a `setTimeout(ms)`, and `expired`, a getter comparing `Date.now()` against an
instant computed as `Date.now() + ms` at construction.

Those are two clocks, and Node does not guarantee they agree. A timer may fire up to a millisecond
early against `Date.now()`, so `await d.elapsed; d.expired` can read `false` — the deadline denying
it has passed, in the one moment its own wait says it has. Reproduced 1 run in 25 at `414b0aef` on
an otherwise quiet machine (docs/PLAN.md WT-011.11), so it is not CPU contention.

The margin is one millisecond, so the SHORTEST deadlines hit it. Raising the existing test's `1` to
a comfortable number would hide the defect rather than fix it.

## Two hard requirements over one observable

`expired` is read by two callers with opposite needs, and both are accepted:

- `P1` — **synchronously true the instant it is due.** A deadline observable only through `elapsed`
  cannot be consulted by synchronous work: a `.then` watcher has not run at the first step of a loop
  starting in the same tick, so an already-spent deadline let that first step through (round-1 F002
  of WT-011.3). `afterDelay(0).expired` must be `true` with no microtask drained.
- `P2` — **true once the wait it handed out has completed.** A caller that awaits `elapsed` and then
  reads `expired` cannot be told it has not passed yet.

A construction satisfying both together: `expired` LATCHES the disjunction of the two clocks.

```
expired  ⇔  latched ∨ (latched := timer has fired ∨ Date.now() >= at)
```

`P1` is carried by the wall-clock arm, which is true the instant it is true and needs nothing to
have run. `P2` is carried by the fired flag, which the timer callback sets BEFORE resolving
`elapsed` — so it is already set for every continuation of that promise.

**The latch is not decoration.** The wall-clock arm is NOT monotone: `Date.now()` can step backwards
(NTP correction, a user setting the clock, a VM resuming from a snapshot), so a deadline that read
`true` while pending could read `false` on the next call — a plan attack refuted the first draft's
claim that both arms were monotone. Latching on read makes the observed SEQUENCE monotone, which is
the property callers actually depend on: `applyEntries.ts:314` reads `expired` repeatedly during one
walk and must never be told the budget came back.

`cancel()` clears neither arm nor the latch; it only stops a timer that has not fired.

### The supported `ms` domain

`at` is computed by arithmetic and `ms` is handed to a timer that normalizes differently, so an
input the two treat differently makes them disagree by far more than the millisecond this change is
about: Node clamps a negative, `NaN`, `Infinity`, or `> 2**31-1` delay to 1 ms while `at` says never
(or long hence). The plan attack left this `unresolved` because nothing stated the domain.

So the domain is stated and enforced in ONE place: `ms` is normalized to a finite integer in
`[0, 2**31-1]` — with a non-finite value normalized to `0`, the only answer that cannot silently
wait — and BOTH the instant and the timer are derived from that one normalized value. Two clocks
given the same number can still disagree by a scheduling margin, which is what the latch and the
flag cover; given different numbers they disagree by days.

### D1 — The flag is set in the timer callback, not in a `.then` on `elapsed`

Setting it inside the callback that resolves the promise puts it in the same job as the resolution,
strictly before any reaction to `elapsed` can run.

The first draft justified this by claiming a `.then` alternative would be registration-order unsafe.
That justification was **refuted** by the plan attack and is withdrawn: an internal `.then` attached
synchronously inside `afterDelay`, before the promise escapes, is necessarily first in registration
order, so it would be correct too. The callback is chosen because it needs no second promise
reaction and no extra microtask hop to establish the flag — not because the alternative is unsound.

## Obligation ledger

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| `P2` holds for every duration | ∀ ms ≥ 0: `await d.elapsed` ⇒ `d.expired` | Timer fires early against `Date.now()`; the wall-clock arm alone answers `false` | `deadline.test.ts` "stays expired after it has fired" KEEPS its 1 ms deadline, plus a loop over the shortest durations; arm-checked by reverting to the wall-clock arm alone | supported |
| `P1` holds with no microtask drained | `afterDelay(0).expired` is `true` synchronously, ASSUMING `Date.now()` has not stepped backwards between construction and the read | Flag-only implementation: the timer has not fired yet in the construction tick. (A backwards clock step inside that window also defeats it — the assumption is stated rather than defended, because no primitive here can carry it) | `deadline.test.ts` "[F002] is expired the instant it is due" — unchanged, and it fails against a flag-only build (plan attack confirmed) | supported under the stated assumption |
| The `ms` domain is stated and both clocks share it | `ms` normalized once to a finite integer in `[0, 2**31-1]`; instant and timer derive from that value | A `NaN`/`Infinity`/`2**31` input where `at` says never and Node clamps the timer to 1 ms | Normalization happens before either is computed; witness asserts `afterDelay(Number.NaN)` and `afterDelay(Infinity)` settle rather than diverging | supported |
| `expired` never retracts across reads | Once a read answers `true`, every later read answers `true` | Wall clock stepped backwards while pending, after a `true` read | The latch above; witness pins `Date.now()` forward, reads `true`, steps it back, reads again | supported |
| Only ONE production site reads the getter, and its outcome can flip | `orphanProofs.ts:100`, `sessionPreviewService.ts:236`, `ignoredMaterial.ts:137` consume `elapsed` only; the getter is read at `applyEntries.ts:253` and `:314` | A caller pairing `elapsed` with `expired` as a two-state discriminator | Plan attack traced all four; the three cited in the first draft never read `expired` at all — that row was written from the import list, not the reads | supported, and the first draft's row is **refuted** |
| The flip is below the resolution of any accepted requirement | A node completing inside the sub-ms window reports `failed` where it reported `copied` | An accepted requirement pinning the boundary to the wall clock | `applyEntries.ts:254` ALREADY aborts in-flight work on `elapsed`, so a copy in that window already failed; only an empty-directory `check(0)` at `:561` flips. No accepted requirement names which clock bounds the budget — see NO-DELTA.md | supported (rebuts the plan attack's NO-DELTA refutation) |
| The timer still cannot hold the host open | `unref` survives the change | Wrapping the callback drops the `unref` call | `unref?.()` is applied to the handle, not the callback, and is untouched | supported |
