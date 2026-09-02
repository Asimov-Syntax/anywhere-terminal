# Tasks: stabilize-git-exclude-concurrency-test

Make the inherited concurrency witness assert the no-loss contract without inventing FIFO lock acquisition.

## 1. Stable concurrency witness

- [x] 1_1 Accept either serialized append order — verified: bun test 'src/worktree/gitExclude.test.ts' && pnpm run check-types && pnpm exec vitest run --maxWorkers=4 > /tmp/stabilize-git-exclude-recorded.log 2>&1 exit 0
  - **Deps**: none
  - **Refs**: specs/NO-DELTA.md
  - **Acceptance**:
    - Outcome: Concurrent git-exclude additions preserve both rules regardless of lock acquisition order
    - Verify: unit src/worktree/gitExclude.test.ts
  - **Plan**:
    1. `src/worktree/gitExclude.test.ts`: preserve the prefix and exact appended entries, but compare the concurrent additions without ordering them.
