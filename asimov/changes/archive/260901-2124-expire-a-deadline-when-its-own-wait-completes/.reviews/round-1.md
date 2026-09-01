# Review Round 1

- Date: 2026-09-02
- Cycle: 1
- Round: 1
- Mode: discovery
- Review profile: fastlane
- Scope: range `65743569~1..HEAD`
- Head: `657435695d8f16f7a61badc464bcc89d33e1fa47` (working tree dirty only because review accounting updated `analytics.json`; review content was taken from the committed range)
- Reviewable lines: 31
- Escalation flags: none declared
- Intent context: no `proposal.md`; accepted Gate-2 `design.md` / `tasks.md`, the caller brief, project blueprint, and accepted specs supplied the obligations
- Agents spawned:
  - asm-review-logic — deadline callback ordering, latch, cancellation, numeric boundaries, and deterministic witnesses — gpt-5.6-sol[1M]
  - asm-review-logic — production caller values, ignored-material remaining budget, and provisioning result flow — gpt-5.6-terra[1M]
  - asm-review-contracts — accepted P1/P2/domain obligations and NO-DELTA adjudication — sonnet[1M]
- Support agent: asm-finder — all deadline callers and the provisioning result flow — agent default model
- Agents skipped: asm-review-data-security (no data/auth/input boundary); asm-review-frontend (no frontend diff); asm-review-performance (no collection growth or recompute axis); asm-review-reuse (no new helper or duplicated capability)
- Recorded verification: `bun run asm change verify-status expire-a-deadline-when-its-own-wait-completes` reports task `1_1` scope unchanged and exit 0. The build record carries the focused deadline test plus type-check and full unit-suite exit 0; the caller additionally recorded the Biome baseline and fs-deletion gate. Review did not rerun project verification commands.
- Chair probes: a targeted Node timer-normalization probe established the changed production boundary used by F001: a computed delay of `2_147_483_648` gives the old raw timer `1ms`, while the new normalized delay gives the timer `2_147_483_647ms`.
- Verdict: BLOCK
- Counts: BLOCK 1 | WARN 1 | SUGGEST 0
- Blocking split: 1 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/deadline.ts:45`
- title: An ignored-material check can turn a backward clock step into a 24.8-day wait
- evidence: `measureIgnoredMaterial()` computes `left = 1_500 - (deps.now() - startedAt)` and guards only `left > 0` before `afterDelay(left)` (`ignoredMaterial.ts:107-150`); production binds that clock to `Date.now()` (`ignoredMaterial.ts:267`). A backwards step of `2_147_482_148ms` makes `left` exactly `2_147_483_648`. Before this commit, Node normalized that raw over-range timer to `1ms`; the changed `Math.trunc`/clamp turns it into `2_147_483_647ms`, so a stalled `lstat` wins nearly 25 days before the deadline. This environment is in scope: the accepted design itself names backwards wall-clock steps and VM snapshot resume as the reason expiry must latch. The accepted worktree-panel contract requires ignored-material measurement to be bounded by a maximum elapsed time (`asimov/specs/worktree-panel/spec.md:1210`).
- impact: Opening removal assessment after such a clock correction can hang the user-visible ignored-material check, and therefore the removal flow waiting on it, for almost 25 days instead of failing soft as `unproven: budget`.
- suggestedFix: Keep the primitive's accepted normalization, but bound this caller's remaining relative budget before minting the deadline — for example, cap positive `left` to `MAX_IGNORED_MS`; preferably derive elapsed budget from a monotonic clock so a backwards wall-clock step cannot increase it. Add a backward-step witness at this caller boundary.
- status: accepted
- triage: Open gating blocker. The fixed 60s/2s/5s callers are unaffected; this is the sole dynamic production delay and the clamp changes its over-range behavior from Node's 1ms fallback to the maximum supported wait.
- invariant: A removal assessment's ignored-material measurement never waits longer than its 1,500ms budget, including when the wall clock moves backwards.
- boundary inventory:
  - affected: post-enumeration remaining-budget calculation; per-entry stalled `lstat`; removal assessment completion
  - verified safe: ordinary positive integer `left <= 1_500`; `left <= 0` exits before creating a deadline; fixed production delays 60,000/2,000/5,000
  - not safe: a backwards wall-clock step makes `left > 2**31-1`, which the changed primitive stretches to its maximum delay

### F002

- ID: F002
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/deadline.test.ts:109`
- title: The normalization witness never checks the timer arm or the upper clamp
- evidence: The test creates deadlines for `NaN`, `Infinity`, and `-1`, immediately reads `expired`, and cancels. It neither captures the delay passed to `setTimeout` nor awaits/fires `elapsed`, and it omits the explicitly accepted `2**31` overflow defeater. An implementation that normalizes only `at` but still passes raw `ms` to `setTimeout` would pass every new normalization assertion while recreating the two-clock divergence; an incorrect upper clamp also remains green. F001 is the concrete production impact of that omitted upper boundary.
- impact: The exact one-normalization-for-both-clocks obligation can regress with a green focused suite, including the over-range behavior that now reaches the ignored-material caller.
- suggestedFix: Capture and assert the timer delay for negative, non-finite, fractional, maximum, and overflow inputs, and fire the captured callback before awaiting `elapsed`. Include `2_147_483_648` and verify the expected `2_147_483_647` timer argument rather than only the synchronous getter.
- status: accepted
- triage: Non-gating test coverage defect. The implementation currently feeds the normalized value to both arms; the warning is that the accepted domain invariant is not witnessed by the changed tests.

## Full-flow trace

- `afterDelay()` normalizes once, derives `at`, schedules an unref'd callback, sets `fired` before resolving `elapsed`, latches `expired` from `fired || Date.now() >= at`, and lets `cancel()` clear only the timer handle. The callback ordering satisfies P2; the wall arm satisfies P1; cancellation cannot create or retract expiry.
- Provisioning creates one fixed 60-second deadline, reads `expired` before and between nodes, and registers `elapsed.then(abort)` for signal-aware in-flight copies. A timeout becomes a per-entry `failed` result, remains attached to the successful worktree create, and reaches the webview as a warning. The empty-directory `check(0)` boundary can flip from copied to failed, but accepted provisioning specs name no clock tie-breaker and still receive one outcome per entry.
- Orphan proof uses fixed 2,000ms and only races `elapsed`; session preview uses production-default 5,000ms and only races `elapsed`. Their cleanup paths cancel the same way and their values are unchanged by normalization.
- Ignored-material measurement is the only production caller deriving a delay dynamically. Its production clock is `Date.now()`, so a backwards step can grow `left`; F001 is the changed over-range path. No cache, persistence, auth, or hot/cold data path participates.

## Adjudication notes

- The NO-DELTA conclusion is sustained. The provisioning flip is user-visible, so the artifact's blanket phrase “no externally verifiable behavior changes” is too broad, but no accepted requirement assigns this sub-millisecond timeout edge to the wall clock. The accepted contract still gets every outcome and preserves the created worktree; no spec delta is owed for that tie-breaker.
- The latch is sound. It can become true only from `fired` or the normalized wall threshold, and keeping a deadline expired after an observed due instant is the required behavior when `Date.now()` moves backwards. `cancel()` still only prevents an unfired callback; it neither clears nor invents expiry.
- The deterministic early-edge witness currently proves the defect schedule and fails against the old implementation. Its separate guard reads before `fire()`, so it would not independently detect a future helper that advanced the mocked clock during `fire()`; in the delivered helper `fire()` cannot do that, so this is not a finding. A direct post-fire assertion on the mocked wall time would make the guard stronger.
- The contracts specialist proposed a separate warning because the accepted ledger mentions a loop over several shortest durations. It is not retained: after normalization, the P2 ordering mechanism is duration-independent, the 1ms witness exercises the early margin, and a finite duration loop would not prove the universal claim. The absent loop is not a concrete changed-code defect.

## Audit backlog

None.

## Author triage

- **F001 — accepted, fixed.** Correct and mine: the saturating clamp was a REGRESSION this change
  introduced. Before it, `afterDelay(2_147_483_648)` got Node's own 1 ms and failed soft; after it,
  the caller waited 24.8 days. Fixed in the primitive rather than at the caller: the top end now
  mirrors Node's clamp, so an inexpressible delay expires at once and never waits longer than asked.
  Two witnesses, both arm-checked — the second times out under the old clamp, which is the 24.8-day
  wait made observable.
  - Not taken: the chair's second suggestion to cap `left` at the `ignoredMaterial` call site too,
    and to move elapsed budgets onto a monotonic clock. The first is defence in depth against a bug
    the primitive no longer has; the second is a real improvement and a different change — a
    backwards clock step still makes `left` itself wrong, which no fix inside `afterDelay` can
    reach. Recorded as a follow-up rather than smuggled into this change.
- **F002 — accepted, fixed.** The chair is right that the old test could not see the defect it
  claimed to guard: it never captured the timer argument, so an implementation normalizing only `at`
  would have passed it. `delayFor()` now captures the argument and asserts it across negative,
  fractional, non-finite, maximum and overflow inputs, and the over-range case fires the callback
  and awaits `elapsed`. Arm-checked against exactly that implementation.
- **NO-DELTA** — the chair sustains the rebuttal, and its correction is taken: the file's opening
  sentence was too broad, since the provisioning flip IS user-visible. Reworded to claim what is
  actually true — that no accepted requirement assigns that boundary to the wall clock.
- **Early-edge guard** — the chair's caveat is recorded: it checks before `fire()`, so it would not
  catch a future helper that advanced the clock during firing. Left as delivered, per its judgement
  that the guard is currently valid.
