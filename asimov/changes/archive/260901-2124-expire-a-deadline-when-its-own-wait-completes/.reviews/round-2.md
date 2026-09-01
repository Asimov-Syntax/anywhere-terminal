# Review Round 2

- Date: 2026-09-02
- Cycle: 1
- Round: 2
- Mode: verification
- Review profile: fastlane
- Scope: range `657435695d8f16f7a61badc464bcc89d33e1fa47..36f091afe3f377e1c7c84bf654bae9b1439ff033`
- Head: `36f091afe3f377e1c7c84bf654bae9b1439ff033` (working tree dirty only because review accounting updated `analytics.json`; review content was taken from the committed remediation range)
- Reviewable lines: 25
- Scope lock: passed — task 2_1, the NO-DELTA correction, and the workflow follow-up record remediation/triage context; they add no capability, accepted contract/design change, or invariant owner
- Intent context: no `proposal.md`; accepted Gate-2 `design.md` / `tasks.md`, round 1 and its author triage, the caller brief, and project blueprint supplied the obligations
- Agents spawned:
  - asm-review-logic — deadline normalization, callback latch, caller cone, and F001/F002 witnesses — gpt-5.6-sol[1M]
  - asm-review-contracts — accepted obligations, scope lock, and caller-hardening disposition — gpt-5.6-terra[1M]
- Agents skipped: asm-review-data-security (no data/auth/input boundary); asm-review-frontend (no frontend diff); asm-review-performance (no collection growth or recompute axis); asm-review-reuse (no reimplemented repository capability)
- Recorded verification: `bun run asm change verify-status expire-a-deadline-when-its-own-wait-completes` reports task `2_1` exit 0 with the focused suite expanded by eight assertions. The caller additionally recorded check-types clean, Biome at the 3 errors / 14 warnings / 1 info baseline, 6,712 unit tests across 280 files passing, and the fs-deletion gate passing. Review did not rerun project verification commands.
- Chair probe: with `Date.now()` pinned and `setTimeout` captured, the current primitive passed `2_147_483_647`, `1`, `0`, `0`, and `2` for inputs `2_147_483_647`, `2_147_483_648`, `Infinity`, `-1`, and `2.7`; manually firing every callback resolved `elapsed` and made `expired` true.
- Verdict: APPROVE
- Counts: BLOCK 0 | WARN 0 | SUGGEST 0

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/deadline.ts:60`
- title: An ignored-material check can turn a backward clock step into a 24.8-day wait
- evidence: Fixed. Finite values above `2_147_483_647` now normalize to `1` before both `at` and `setTimeout` are created. The chair probe captured `1` for `2_147_483_648`, then fired the callback and observed `elapsed` resolve with `expired === true`. Therefore the dynamic `ignoredMaterial` `left` path, its stalled-`lstat` race, and removal-assessment completion can no longer enter the 24.8-day saturation introduced at round 1. Fixed production delays 60,000/2,000/5,000 remain below the boundary and unchanged.
- impact: The change-introduced regression is removed; an unexpressible ignored-material delay fails soft promptly instead of holding removal assessment for weeks.
- suggestedFix: None; remediation complete.
- status: fixed
- triage: The accepted changed-code mechanism is closed at every affected boundary. A caller-side cap or monotonic clock is not required for this remediation. It would address a distinct, pre-existing issue: a smaller backward step can still inflate `left` while keeping it below the timer ceiling (for example, a 10,000ms step yields `left = 11,500`). That broader elapsed-budget correction is properly recorded as a follow-up; a monotonic elapsed clock is the complete fix, while a cap only at the per-entry race would not cover all budget accounting sites.
- invariant: An unexpressible delay produced by the ignored-material remaining-budget calculation must not be stretched into a long wait by `afterDelay`.
- boundary inventory:
  - affected and now safe: post-enumeration over-range remaining-budget calculation; per-entry stalled `lstat`; removal assessment completion
  - unchanged and safe: ordinary positive integer `left <= 1,500`; `left <= 0` exits before creating a deadline; fixed production delays 60,000/2,000/5,000
  - separate follow-up: representable but inflated `left > 1,500` after a smaller backward wall-clock step

### F002

- ID: F002
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/deadline.test.ts:109`
- title: The normalization witness never checks the timer arm or the upper clamp
- evidence: Fixed. `delayFor()` captures the exact argument handed to `setTimeout` for ordinary, maximum, fractional, negative, non-finite, and overflow inputs. The overflow assertion fails if saturation returns and fails if only `at` is normalized while raw `ms` reaches the timer. The separate overflow wait observes the callback arm through `elapsed` and verifies `expired` after it fires. The chair probe independently captured the same boundary values and manually fired the callbacks.
- impact: The focused suite now detects both prior blind spots: an incorrect upper clamp and divergence between the instant and timer arms.
- suggestedFix: None; remediation complete.
- status: fixed
- triage: Both accepted witness gaps are closed. No existing assertion was removed, relaxed, or retargeted.

## Verification adjudication

- F001: fixed. The finite overflow path is `1ms` for both arms, so the 24.8-day regression cannot reach the ignored-material race or removal-assessment completion.
- F002: fixed. Timer arguments and the callback/elapsed arm are now observed.
- Caller-side cap: not required in this change. It would not be merely duplicate protection against the primitive; it would partially address representable budget inflation after smaller backward steps, which predates this change and is outside F001's changed causal mechanism.
- Monotonic elapsed budget: not required by WT-011.11 or task 2_1 and correctly deferred. It is the coherent follow-up if the caller's broader 1,500ms invariant is to hold across every backward clock adjustment.
- NO-DELTA: the corrected opening now matches the round-1 adjudication — one user-visible tie-breaker can change, but no accepted external requirement assigns it to the wall clock.

## Audit backlog

None.
