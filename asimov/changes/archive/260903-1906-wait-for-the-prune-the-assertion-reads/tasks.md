## 1. Wait on the call the assertion reads

- [x] 1_1 Convert the prune test's bare settle to a named condition — verified: pnpm exec vitest run src/extension.worktreeAssembly.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/NO-DELTA.md
  - **Boundary**: No production change, no weakened assertion, and no conversion of a wait that has not actually failed the gate
  - **Acceptance**:
    - Outcome: Each converted test waits for the git call its own assertion reads
    - Verify: command pnpm exec vitest run src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — replace the bare `settle()` after the prune confirmation, and the one after the occupied-override create, with `settleUntil` naming the git call each assertion reads. The assertions themselves are unchanged.
    2. `asimov/changes/wait-for-the-prune-the-assertion-reads/workflow.md` — record that the file still holds other bare `settle()` waits, so the remainder is visible rather than implied to be done.
