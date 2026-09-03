## 1. Wait on the repair the assertion reads

- [x] 1_1 Convert the reattach test's bare settle to a named condition — verified: pnpm exec vitest run src/extension.worktreeAssembly.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/NO-DELTA.md
  - **Boundary**: No production change, no weakened assertion, and no conversion of a wait that has not actually failed the gate
  - **Acceptance**:
    - Outcome: The reattach test waits for the git repair its own assertion reads
    - Verify: command pnpm exec vitest run src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — replace the bare `settle()` before `[7_3] submits the repair target when a reattach withdraws a standing override` with `settleUntil` naming the `worktree repair` call its assertion reads. The assertion itself is unchanged.
