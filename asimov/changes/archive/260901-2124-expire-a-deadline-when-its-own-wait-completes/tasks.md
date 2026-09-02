# Tasks: expire-a-deadline-when-its-own-wait-completes

A deadline is built from two clocks that do not agree, so awaiting the wait it hands out and then
reading it can be told it has not passed yet.

- [x] 1_1 Settle a deadline by its own wait as well as by the clock — verified: pnpm exec vitest run 'src/worktree/deadline.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: design.md#two-hard-requirements-over-one-observable, design.md#d1--the-flag-is-set-in-the-timer-callback-not-in-a-then-on-elapsed
  - **Acceptance**:
    - Outcome: A deadline reads expired once its own wait has completed
    - Verify: unit src/worktree/deadline.test.ts
  - **Plan**:
    1. `src/worktree/deadline.ts` sets a flag inside the timer callback, before it resolves `elapsed`, and `expired` answers the disjunction of that flag and the existing wall-clock comparison.
    2. `src/worktree/deadline.test.ts` keeps its one-millisecond deadline and adds a witness over the shortest durations, so the margin the defect needs is the one under test.
  - **Boundary**: `expired` keeps answering synchronously from a getter — no caller may be required to await anything to read it, and no existing caller signature changes.

- [x] 2_1 Never turn a delay the timer cannot express into a long wait — verified: pnpm exec vitest run 'src/worktree/deadline.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-1.md#f001, .reviews/round-1.md#f002
  - **Acceptance**:
    - Outcome: An out-of-range delay expires at once, as it did before this change
    - Verify: unit src/worktree/deadline.test.ts
  - **Plan**:
    1. `src/worktree/deadline.ts` mirrors Node's own clamp at the top end — a delay above `2**31-1`, or non-finite, becomes the 1ms Node would have used, and the instant follows it — instead of clamping to `2**31-1` and waiting 24.8 days.
    2. `src/worktree/deadline.test.ts` captures the argument handed to `setTimeout` and asserts it for the negative, fractional, non-finite, maximum and overflow inputs, and fires the captured callback rather than only reading `expired`.
