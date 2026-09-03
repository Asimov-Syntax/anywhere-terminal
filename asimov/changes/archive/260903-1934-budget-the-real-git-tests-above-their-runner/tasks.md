## 1. Give a real-git test longer than its runner allows one command

- [x] 1_1 Budget the two real-git tests above the runner's own bound — verified: pnpm exec vitest run src/worktree/deleteBranch.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/NO-DELTA.md
  - **Boundary**: No production change, no weakened assertion, no suite-wide timeout change, and no budget for a test that does not spawn real git
  - **Acceptance**:
    - Outcome: Each real-git test is budgeted above its runner's per-command bound
    - Verify: command pnpm exec vitest run src/worktree/deleteBranch.test.ts
  - **Plan**:
    1. `src/worktree/deleteBranch.test.ts` — give the two tests that spawn a real repository a 15000 ms budget, above `gitCommandRunner`'s own 10 s per-command bound. Assertions are unchanged.
