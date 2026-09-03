## 1. Wait on the call, not on quiescence

- [x] 1_1 Convert every bare wait that precedes an asynchronous git or launch assertion — verified: pnpm exec vitest run src/extension.worktreeAssembly.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/NO-DELTA.md
  - **Boundary**: No production change, no weakened or removed assertion, and no conversion of a wait whose following assertion is negative — waiting cannot establish that nothing happened
  - **Acceptance**:
    - Outcome: Each converted test waits for the call its own assertion reads
    - Verify: command pnpm exec vitest run src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — replace each bare `settle()` that is immediately followed by an assertion reading `argv`, `launched`, or the DOM text a host response produces, with `settleUntil` naming that exact call. Assertions are unchanged. A wait followed by a negative assertion stays bare.
