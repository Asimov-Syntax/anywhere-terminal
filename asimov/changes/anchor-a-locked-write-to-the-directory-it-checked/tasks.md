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

- [x] 1_2 Report a save whose lock could not be released — verified: bun test 'src/worktree/provisioning/writeNativeConfig.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-save-whose-lock-could-not-be-released-says-so, specs/worktree-panel/spec.md#an-ordinary-save-is-unaffected; design.md D4
  - **Acceptance**:
    - Outcome: a save that wrote but could not release its lock reports that, not ordinary success
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/writeNativeConfig.ts`, add one outcome to the result vocabulary for a write that landed with the lock unreleased, and pass an `onLockReleaseFailed` that selects it — collecting during the operation and rewriting the returned outcome afterwards, the shape `ClaudeHookInstaller.ts:91-117` already uses.
    2. Let the type checker enumerate the consumers of that result and fix each.
    3. In `src/providers/WorktreeHost.ts`, give the new outcome a message that says the write landed and the file may stay locked, and witness it in `src/providers/WorktreeHost.actions.test.ts` — the suite that already owns the refusal messages.
    4. In `src/worktree/provisioning/writeNativeConfig.test.ts`, add a witness forcing release failure and asserting the distinct outcome, and one asserting an ordinary save still reports success unchanged.
    5. Arm-check by reverting the callback so the outcome falls back to success.
