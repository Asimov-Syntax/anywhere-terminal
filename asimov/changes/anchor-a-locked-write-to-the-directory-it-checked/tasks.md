# Tasks: anchor-a-locked-write-to-the-directory-it-checked

## 1. What a locked write can decide about its own leaf

- [x] 1_1 Decide ownership at full precision, and refuse a link at the leaf — verified: bun test 'src/agentHooks/install/lockedJsonFile.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-locked-write-decides-ownership-on-identities-that-cannot-round, specs/worktree-panel/spec.md#a-write-that-edits-a-file-in-place-does-not-follow-a-link-at-its-name, specs/worktree-panel/spec.md#an-ordinary-save-is-unaffected; design.md D3, D5
  - **Acceptance**:
    - Outcome: two files differing only above 2^53 are not mistaken for one another
    - Verify: unit src/agentHooks/install/lockedJsonFile.test.ts
  - **Plan**:
    1. In `src/agentHooks/install/lockedJsonFile.ts`, capture every ownership identity `{ bigint: true }` — the temporary's in `stageReplacement` and the lock's in `releaseLock` — so both sides of each `sameIdentity` call are bigints.
    2. In `src/utils/regularFileRead.ts`, add a THIRD argument to `openRegularFile` carrying `noFollow`, leaving `openFile` in position two so existing callers are unchanged.
    3. Implement it as design.md D5 specifies — `O_NOFOLLOW` where the constants record defines it, and a pre-open `lstat` compared against the opened handle's identity where it does not.
    4. In `src/utils/regularFileRead.test.ts`, assert the default still reads through a symlink to an ordinary file, and that the option refuses one with the flag forced absent so the identity comparison alone carries it.
    5. In `src/agentHooks/install/lockedJsonFile.ts`, pass `noFollow` from `readText`, letting the errno reach the caller unchanged so `isNotFound` still answers absence.
    6. In `src/agentHooks/install/lockedJsonFile.test.ts`, add a witness whose injected identities differ only above 2^53, and one swapping the target through an injected `lstat` after the writer's observation.
    7. Arm-check by narrowing the identities back to `Number` and by dropping the identity comparison.
  - **Boundary**: do not add directory identity checks — design.md D2 cuts them to WT-012.21
