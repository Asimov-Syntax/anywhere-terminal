# Asimov Review Round 3

- Date: 2026-08-30
- Cycle: 2
- Mode: discovery
- Scope: commit range `04f78aa4..426c4923cff46f62e5a03831d957c48925b2ddc0`
- Head: `426c4923cff46f62e5a03831d957c48925b2ddc0`
- Tree: dirty; working-tree changes in `asimov/changes/bound-the-lifetime-of-a-transcript-look/.analytics-cursor.json`, `asimov/changes/bound-the-lifetime-of-a-transcript-look/analytics.json`, `docs/PLAN.md`, and `docs/design/worktree-subsystem-debts.md`, plus the untracked prior `round-2.md`, were outside the explicit range and excluded
- Reviewable lines: 1479
- Size note: Large change — accuracy may decrease. 1326 counted lines are Asimov analytics/build metadata; the production diff is 153 changed lines.
- Agents spawned:
  - `asm-review-logic` — timeout, generation, and settlement interleavings — `gpt-5.6-sol[1M]`
  - `asm-review-performance` — outstanding filesystem work and deadline growth axes — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — amended D1-D6, task, and delta-spec compliance — `sonnet[1M]`
  - `asm-finder` — production caller and full-flow impact trace — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-data-security` — path containment, input authority, and filesystem trust boundaries are unchanged
  - `asm-review-frontend` — no frontend code changed
  - `asm-review-reuse` — no repository capability was reimplemented and no cohesive file was split
- Full-flow trace: `WorktreeHost` serializes projection; full and replay projections build window/external rows, enrich them through `sessionPreview`, resolve the opaque entry id through `VaultService`, take cache cold/hot paths through containment-checked resolution and bounded tail reads, fail soft on expiry, and publish the retained preview into the row render signature and tree view
- Data-scale pass: `held` grows by distinct session ids and is LRU-capped; unsettled filesystem work grows by distinct sessions asked across cadence ticks and is capped by `outstanding`; live deadlines grow by attempts started inside one timeout window and are cancelled when the look wins. No scale finding survived adjudication.
- Verification evidence: recorded task evidence in `.build/verified.ndjson` has exit 0 for tasks `1_1`, `1_2`, and `2_1`, ending at 5311 unit tests. The caller reports clean type check, I10 gate, baseline `biome check src`, and `verify-status` exit 0; review did not rerun project gates.
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST open; 1 prior BLOCK independently verified fixed
- Split: 1 feature, 0 machinery

## Findings

### B1-R3

- ID: B1-R3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (corroborated by chair scratch probe)
- Class: feature
- File: `src/worktree/sessionPreviewService.ts:356`
- Title: Expiry can be selected after the look has already committed
- Evidence: `scored` performs `commit`, scoring, scheduling, or `forget` before the race decides whether the look or deadline won. When the raw look and `deadline.elapsed` are resolved in one turn in that order, the raw look queues the `scored` mutation handler first; the deadline tag is already queued by the time that handler resolves `scored`; and the look side needs one additional `scored.then(...)` hop before reaching `Promise.race`. The mutation therefore runs, but the deadline tag reaches the race first and selects `expired`. A targeted promise-order probe reproduced `expired: true` with the commit already applied. The changed tests always await expiry before releasing the stalled read, so they cover only the ordering where generation is bumped before settlement.
- Impact: An attempt classified as expired can expose a newer line, retire the prior line when the read returns `null` or rejects, and be scored/scheduled once by settlement and again by expiry. That violates D2-D3 and both SHALLs that an abandoned attempt commit nothing and preserve the last known line. The accepted injectable `Deadline`/read contract admits this interleaving even though the default timer and filesystem sources commonly settle from separate event-loop callbacks.
- SuggestedFix: Make the raw look settle to an inert tagged result whose handlers do not mutate `Held`; race that result directly against the deadline; only after a non-expired result wins should `preview` commit and score it. Keep outstanding cleanup on that tagged unrejectable operation promise. Add a regression that resolves the stalled operation and deadline synchronously in that order, asserting the expired result keeps the old line and adds exactly one miss.
- Status: open
- Triage: pending
- Invariant: Once expiry wins, no observation or bookkeeping from that attempt may reach the retained session, and one attempt is classified exactly once.
- Boundary inventory: searched cold entry lookup, target resolution, stat, read returning text or `null`, rejection, ordinary success, expiry-before-settlement, same-turn settlement plus expiry, late settlement, same-session sharing, LRU eviction, global admission, and deadline cancellation. Affected: same-turn settlement plus expiry. Verified safe: expiry that completes its continuation before raw settlement; ordinary settlement whose tagged side reaches the race first; late resolve/reject after generation has already advanced; same-session and saturated admission paths.

## Prior findings

### B1-R1

- ID: B1-R1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-performance` (corroborated by chair)
- Class: feature
- File: `src/worktree/sessionPreviewService.ts:397`
- Title: Successful looks release the cap while their deadline timers remain live
- Evidence: The amended D5 exposes `Deadline.cancel()`, and the non-expired race branch calls it before returning the look's line. The regression at `src/worktree/sessionPreviewService.test.ts:543-581` completes six healthy sessions with `cap: 2` while every `elapsed` promise is deliberately prevented from firing; it ends with zero armed deadlines. Without cancellation the same sequential attempt-rate axis from B1-R1 would end with six live deadlines, so the test independently exercises the accepted finding rather than assuming the implementation is correct.
- Impact: Fixed — healthy and outright-rejected looks no longer retain timer handles for the remainder of the timeout window.
- SuggestedFix: None; retain the cancellable-deadline contract and regression.
- Status: fixed
- Triage: accepted in round 1; independently verified in cycle 2 round 3

## Adjudication notes

- The contracts specialist proposed a warning that B1-R1's regression is sequential rather than concurrent. It was not admitted: B1-R1's growth axis is successful attempts started inside one timeout window after each prior attempt releases `outstanding`, so sequential completion is a direct reproduction. The never-resolving `elapsed` promises make the final `armed === 0` assertion fail immediately if cancellation is removed; concurrent overlap is not required to verify this defect.
- The performance specialist found no surviving growth or bound defect.

---

## Author triage (round 3)

### [B1-R3] Expiry can be selected after the look has already committed

**Status**: accepted

**Triage**: Reproduced independently before accepting, with a standalone probe of the exact promise
shape rather than a reading of the code. Resolving the raw look and the deadline in one synchronous
tick selects the expiry branch in **both** orders — including look-first — because `scored.then(tag)`
is two microtask hops from the look settling while `elapsed.then(tag)` is one. `Promise.race` picks
whichever array promise settles first, not whichever underlying event fired first, so hop count
decides it and call order does not.

The consequence is narrower than the report's worst case but real: `commit` and the success scoring
have already run inside `scored`'s handler, and the expiry branch then runs `generation += 1;
misses += 1; schedule()` on top. A healthy read is scored as a miss and lands on the backoff ladder
instead of the cadence. The returned line is the freshly committed one, so this is the inverse of
D2/D3's dangerous direction — a committed look mis-scored as abandoned, not an abandoned look
committing.

Latent under shipped wiring: `src/extension.ts:672` passes no `wait`, and Node drains the microtask
queue between macrotask phases, so a real `setTimeout` and a real `fs` completion cannot settle in
one tick against each other. But `wait` and `Deadline` are exported and overridable, which makes
"whichever event fires first wins" an undocumented constraint on a public contract rather than a
guarantee. Accepted on that basis.

Taking the chair's fix over the cheaper one. Equalizing the hop counts makes the race pick correctly,
but leaves the shape "commit, then ask who won". Making the look inert and committing only in the
non-expired branch removes the class rather than the instance, and is what D3's constraint — only a
current attempt commits — should have been resting on all along.

The generation fence stays. It is redundant once commit is structurally confined to the race winner,
and deliberately so: it is a second, independent guard on the exact property this round showed can
fall to promise plumbing, it costs one comparison, and removing it would change accepted design D3
for no behavioural gain.
