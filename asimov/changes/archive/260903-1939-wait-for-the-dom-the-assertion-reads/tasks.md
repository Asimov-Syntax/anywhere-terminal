## 1. Wait on the rendering the assertion reads

- [x] 1_1 Convert every bare wait that precedes an assertion on host-rendered DOM — verified: pnpm exec vitest run src/extension.worktreeAssembly.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/NO-DELTA.md
  - **Boundary**: No production change, no weakened or removed assertion, and no conversion of a wait whose following assertion is that something did NOT change — waiting cannot establish that
  - **Acceptance**:
    - Outcome: Each converted test waits for the rendering its own assertion reads
    - Verify: command pnpm exec vitest run src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — replace each bare `settle()` immediately followed by an assertion on host-rendered DOM with `settleUntil` naming the last such observable the assertions read. Assertions are unchanged. Two sites whose assertions are sameness claims stay bare.
