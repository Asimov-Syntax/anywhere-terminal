# Tasks: anchor-a-locked-write-to-the-directory-it-checked

## 1. What a locked write can decide about its own leaf

- [x] 1_1 Decide ownership at full precision, and refuse a link at the leaf — verified: bun test 'src/agentHooks/install/lockedJsonFile.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-locked-write-decides-ownership-on-identities-that-cannot-round; design.md D3, D5
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

- [x] 1_2 Name a lock left behind, on every outcome that took one — verified: bun test 'src/worktree/provisioning/writeNativeConfig.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-save-that-left-its-lock-behind-says-so-whatever-else-it-did, specs/worktree-panel/spec.md#an-ordinary-save-is-unaffected; design.md D4
  - **Acceptance**:
    - Outcome: a save that could not release its lock names it, and still says truthfully what it did to the file
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/writeNativeConfig.ts`, carry the leaked lock on BOTH arms of `NativeConfigWrite` rather than on the success variant, and fold it in for every outcome that took a lock — collecting during the operation, the shape `ClaudeHookInstaller.ts:91-117` uses.
    2. Let the type checker enumerate the consumers and fix each.
    3. In `src/providers/WorktreeHost.ts`, choose the wording from what actually happened — bytes landed, nothing to write, or a refusal keeping its own reason — and name the lock in all three.
    4. In `src/worktree/provisioning/writeNativeConfig.test.ts`, add a witness per outcome (landed, no-op, refused) asserting BOTH the lock path and the unchanged write verdict, one asserting an ordinary save is untouched, and one asserting a lock already unlinked by someone else is NOT reported.
    5. Witness the host wording for the three outcomes in `src/providers/WorktreeHost.actions.test.ts`.
    6. Arm-check each by reverting the field to the success variant and by dropping the `wrote` distinction.
