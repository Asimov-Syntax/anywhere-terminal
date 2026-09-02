# Tasks: say-which-lock-a-save-left-behind

## 1. What a release knows, and what the user is told

- [x] 1_1 Answer what the release did, and stop naming a lock nobody can vouch for — verified: bun test 'src/agentHooks/install/lockedJsonFile.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#no-lock-is-offered-to-the-user-as-a-file-to-delete; design.md D2, D3, D6
  - **Acceptance**:
    - Outcome: a lock whose name now identifies a different file is never shown to the user
    - Verify: unit src/agentHooks/install/lockedJsonFile.test.ts
  - **Plan**:
    1. In `src/agentHooks/install/lockedJsonFile.ts`, replace `releaseLock`'s boolean with the disposition table in design.md D3, mapping each reachable exit to exactly one value — including the `ENOENT` with `nlink > 0n` arm the first table omitted.
    2. Widen `withLock`'s `onLockReleaseFailed` to pass the disposition alongside the path.
    3. Extract one identity predicate into `src/utils/fileIdentity.ts`, used by both `src/utils/regularFileRead.ts` and this file, literally, so neither caller's error handling changes.
    4. In `src/agentHooks/install/ClaudeHookInstaller.ts`, stop collecting paths for dispositions it cannot vouch for, so `AgentHookController.formatWarning` cannot join them into the user's warning.
    5. In `src/agentHooks/install/lockedJsonFile.test.ts`, add one witness per row of D3's table against a real filesystem, including a DIFFERENT live lock substituted at the name.
    6. In `src/agentHooks/install/ClaudeHookInstaller.test.ts`, witness that a mismatch still warns but names no path, and that a genuine stuck unlink keeps today's behaviour.
    7. Arm-check each by collapsing its row into the neighbouring disposition.
  - **Boundary**: no age-based or staleness-based lock reclamation, and no repair of a substituted name

- [ ] 1_2 Carry a lock the user may hit out of the write
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#no-lock-is-offered-to-the-user-as-a-file-to-delete; design.md D3, D5
  - **Acceptance**:
    - Outcome: the write reports that a lock may still be in the way, naming no path
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/writeNativeConfig.ts`, carry a boolean-shaped "may still be locked" on both arms of `NativeConfigWrite`, set for `stuck` and `movedAway` only.
    2. Witness the three outcomes — landed, no-op, refused — each carrying it only for those dispositions, and an ordinary save carrying nothing.
    3. Arm-check by setting it for every non-`released` disposition.

- [ ] 1_3 Say it in the panel, without calling a written file unsaved
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#a-save-that-wrote-is-never-presented-as-unsaved, specs/worktree-panel/spec.md#a-lock-left-behind-survives-a-failed-refresh; design.md D4, D5
  - **Acceptance**:
    - Outcome: a written-but-locked save reads as written in the summary and in the detail
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Add `locked` to `ProvisionProblem.reason` in `src/types/messages.ts`.
    2. Take the consumer inventory BY HAND — `p.reason === "unsaved"` is not exhaustive, so the type checker will not find them: `WorktreeCreateDialog.ts:723-735` (summary) and `:740-757` (detail), `readProvisioning.ts:218-239` (the one semantic reason check), and `messages.contract.test.ts:258-271`.
    3. In `src/webview/worktree/WorktreeCreateDialog.ts`, give the summary its own arm for `locked` rather than folding it into either existing answer.
    4. In `src/providers/WorktreeHost.ts`, build the problem from the write's own outcome before the reread, so a rejected reread cannot swallow it.
    5. Witness the summary on a POPULATED model — an empty one returns counts before problems are inspected — plus a rejected reread at the host, and the wire shape in the contract test.
    6. Arm-check by folding `locked` back into the all-`unsaved` answer and by moving delivery inside the reread's success path.
  - **Boundary**: `media/webview.js` is a build artifact and untracked — do not edit it
