# Asimov Review Round 1

- Date: 2026-08-30
- Cycle: 1
- Mode: discovery
- Scope: commit range `04f78aa4..54d834a8bd57ee104e9a7c60c61d8bf88e3fe2bf`
- Head: `54d834a8bd57ee104e9a7c60c61d8bf88e3fe2bf`
- Tree: dirty; unrelated working-tree changes in `asimov/changes/bound-the-lifetime-of-a-transcript-look/.analytics-cursor.json`, `asimov/changes/bound-the-lifetime-of-a-transcript-look/analytics.json`, `docs/PLAN.md`, and `docs/design/worktree-subsystem-debts.md` were outside the explicit range and excluded
- Reviewable lines: 1338
- Size note: Large change — accuracy may decrease (most counted lines are Asimov analytics/build metadata; production diff is 128 changed lines)
- Agents spawned:
  - `asm-review-logic` — timeout, generation, and settlement races — `gpt-5.6-sol[1M]`
  - `asm-review-performance` — outstanding-work and growth bounds — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — accepted D1-D6 and delta-spec compliance — `sonnet[1M]`
  - `asm-finder` — production caller and full-flow impact trace — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-data-security` — path containment and filesystem trust boundaries are unchanged
  - `asm-review-frontend` — no frontend code changed
  - `asm-review-reuse` — no repository capability was reimplemented or split
- Verification evidence: `bun run asm change verify-status bound-the-lifetime-of-a-transcript-look` records tasks `1_1` and `1_2` exit 0; the final task record reports 5310 passing unit tests
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST
- Split: 1 feature, 0 machinery

## Findings

### B1-R1

- ID: B1-R1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-performance (corroborated by chair)
- Class: feature
- File: `src/worktree/sessionPreviewService.ts:379`
- Title: Successful looks release the cap while their deadline timers remain live
- Evidence: Every attempt creates `wait(lookTimeoutMs)` in the race, but a fast `scored` settlement removes the attempt from `outstanding` at lines 371-375 while the losing deadline promise remains pending until its timeout. The next session can therefore start immediately. Because `previewFromVault` awaits one worktree before starting the next, each healthy group frees the service slots before the following group, so one projection can leave one live timer/promise-race closure per row rather than at most `cap`. Across repeated or large projections, the growth axis is successful attempts started within the five-second timeout window; neither `held` nor `outstanding` bounds it. This contradicts accepted D5's claim that the deliberately pending losing sides are bounded by D4's attempt cap.
- Invariant: Live losing sides created by transcript attempts must be structurally bounded. Boundary inventory searched: cache hot path, cache cold path, successful settlement, rejection settlement, expiry, forever-pending filesystem work, LRU eviction, global cap, per-worktree projection sequencing. Affected boundary: successful/rejected settlement leaves the timer side pending after releasing the registry slot. Verified safe: expired filesystem operations remain one per session and at most `cap`; `held` and `outstanding` owner maps remain structurally capped; same-session and saturated hot paths start no filesystem work.
- Impact: Large or rapidly repeated projections can retain thousands of timer handles and Promise-race closures despite the change's stated lifecycle bound, creating event-loop and memory pressure proportional to rows/attempt rate rather than the configured cap.
- SuggestedFix: Make the deadline cancellable/clearable when `scored` settles, or retain a separately bounded deadline ownership slot until its timer settles, so live deadline machinery is bounded by `cap`. Add a test that completes more than `cap` healthy distinct sessions before the timeout and asserts live deadlines never exceed the structural limit.
- Status: open
- Triage: pending

---

## Author triage (round 1)

### [B1-R1] Successful looks release the cap while their deadline timers remain live

**Status**: accepted

**Triage**: Confirmed against the code rather than taken on the report. `outstanding.delete` is
driven by `scored` (`sessionPreviewService.ts:371-375`), while the losing `wait(lookTimeoutMs)` timer
stays armed for its full duration. A healthy projection therefore leaves one pending timer and race
closure per row, bounded by nothing — the growth axis is looks *started* within one timeout window,
which neither `held` nor `outstanding` measures.

This falsifies design.md D5's own closing sentence, "Both are bounded: one timer and one operation
per attempt, and attempts per session bounded by D4". The timer half was never bounded by D4, because
the slot is released before the timer settles.

**Not remediable in this cycle.** Every fix that keeps the current behaviour changes a shared
interface: the deadline has to become cancellable, so `wait(ms): Promise<void>` gains a cancel
handle. That is a changed D#, which the design lifecycle's remediation boundary routes back to
`asimov-plan` rather than landing as a fix commit.

The one fix that needs no interface change — holding the `outstanding` slot until the deadline
settles too — was considered and rejected: it would pin a healthy session's slot for the full five
seconds after its look completed, making the effective cadence 5 s and starving rows past `cap` on
any window larger than the cap. Worse behaviour bought to avoid an artifact edit.

Handing back. Fix carried into plan: `wait` returns `{ elapsed, cancel }`, `preview` cancels the
deadline when `scored` wins, and the reviewer's requested test — more than `cap` healthy sessions
completed inside one timeout window, asserting live deadlines stay bounded — is added.
