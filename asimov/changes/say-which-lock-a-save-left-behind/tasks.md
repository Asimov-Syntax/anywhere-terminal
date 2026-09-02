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

- [x] 1_2 Carry a lock the user may hit out of the write — verified: bun test 'src/worktree/provisioning/writeNativeConfig.test.ts' && pnpm run check-types && pnpm exec biome check src/utils/fileIdentity.ts src/utils/regularFileRead.ts src/agentHooks/install src/worktree/provisioning && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#no-lock-is-offered-to-the-user-as-a-file-to-delete; design.md D3, D5
  - **Acceptance**:
    - Outcome: the write reports that a lock may still be in the way, naming no path
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/writeNativeConfig.ts`, carry a boolean-shaped "may still be locked" on both arms of `NativeConfigWrite`, set for `stuck` and `movedAway` only.
    2. Witness the three outcomes — landed, no-op, refused — each carrying it only for those dispositions, and an ordinary save carrying nothing.
    3. Arm-check by setting it for every non-`released` disposition.

- [x] 1_3 Say it in the panel, without calling a written file unsaved — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types && pnpm exec biome check src/utils/fileIdentity.ts src/utils/regularFileRead.ts src/agentHooks/install src/worktree/provisioning src/types src/webview/worktree/WorktreeCreateDialog.ts src/webview/worktree/WorktreeCreateDialog.test.ts src/providers/WorktreeHost.ts src/providers/WorktreeHost.actions.test.ts && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#a-save-that-wrote-is-never-presented-as-unsaved, specs/worktree-panel/spec.md#a-lock-left-behind-survives-a-failed-refresh; design.md D4, D5
  - **Acceptance**:
    - Outcome: a written-but-locked save reads as written in the summary and in the detail
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Add `locked` to `ProvisionProblem.reason` in `src/types/messages.ts`.
    2. Take the consumer inventory BY HAND — `p.reason === "unsaved"` is not exhaustive, so the type checker will not find them: `WorktreeCreateDialog.ts:723-735` (summary) and `:740-757` (detail), `readProvisioning.ts:218-239` (the one semantic reason check), and `src/types/messages.contract.test.ts:258-271`, whose invented-reason example literally uses the string `locked` and stops being invalid.
    3. In `src/webview/worktree/WorktreeCreateDialog.ts`, give the summary its own arm for `locked` rather than folding it into either existing answer.
    4. In `src/providers/WorktreeHost.ts`, build the problem from the write's own outcome before the reread, so a rejected reread cannot swallow it.
    5. Witness the summary on a POPULATED model — an empty one returns counts before problems are inspected — plus a rejected reread at the host, and the wire shape in the contract test.
    6. Arm-check by folding `locked` back into the all-`unsaved` answer and by moving delivery inside the reread's success path.
  - **Boundary**: `media/webview.js` is a build artifact and untracked — do not edit it

- [x] 2_1 Stop naming a lock in the installer's warning, on every arm — verified: pnpm exec vitest run src/agentHooks/install/ClaudeHookInstaller.test.ts src/agentHooks/AgentHookController.test.ts src/cursor/CursorHookInstaller.test.ts && pnpm run check-types && pnpm exec biome check src/agentHooks/install/ClaudeHookInstaller.ts src/agentHooks/AgentHookController.ts src/cursor/CursorHookInstaller.ts src/utils/fileIdentity.ts && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#no-lock-is-offered-to-the-user-as-a-file-to-delete; design.md D1, D2, D6; .reviews/round-1.md F001, F003
  - **Acceptance**:
    - Outcome: no warning names a lock pathname, on any release arm
    - Verify: command pnpm exec vitest run src/agentHooks/install/ClaudeHookInstaller.test.ts src/agentHooks/AgentHookController.test.ts src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. In `src/agentHooks/install/ClaudeHookInstaller.ts`, at line 107 — drop `locked.lockPath` from the `lock-unavailable` failure's `affected`, keeping the configuration path. This process never held that lock.
    2. `src/agentHooks/install/ClaudeHookInstaller.ts:109-113` — the `stuck` arm stops pushing `lockPath` into `unresolved`. `unreleased` alone already drives the outcome, so `unresolved` gains nothing from this callback and the local array goes with it.
    3. Adopt `sameIdentity` from `src/utils/fileIdentity.ts` at `src/agentHooks/install/ClaudeHookInstaller.ts:377-379` (F003). Do NOT convert the installer's existing stat captures to `{ bigint: true }` — that is separate ownership work and would widen this task.
    4. Witness each arm in `src/agentHooks/install/ClaudeHookInstaller.test.ts` and `src/agentHooks/AgentHookController.test.ts`: a `lock-unavailable` outcome, and a `stuck` release, neither carrying the lock path; and `AgentHookController.formatWarning` still firing on a mismatch while naming no path.
    5. The invariant has a SECOND boundary the review did not list, found by grepping for the shape rather than the quoted line: `src/cursor/CursorHookInstaller.ts` puts the lock path into `unresolved` on its release-failure arms (`:178`, `:237`) and into `unresolvedConfigPaths(true)` for `lock-unavailable` (`:243`), reaching the same `formatWarning`. Close it there too — `appendUnresolved` loses its only caller.
    6. `unresolved` was doing DOUBLE DUTY — a user-facing path list AND the internal "something is unresolved" signal — so emptying it silently disarms three consumers. In `src/agentHooks/AgentHookController.ts` a lock-release failure then reaches `{ success: true, reason: "" }`, so no warning fires at all (`:239`, `:266`), and uninstall GRANTS the authority D5 and D9 say to withhold; in `src/cursor/CursorHookInstaller.ts:117` the Windows install path reads it as a clean cleanup and reports `unsupported-platform` over a stuck lock. Make the residue signal the REASON, keeping the path check as an OR so no existing behaviour moves.
    7. Arm-check by putting each path back and confirming the witness fails, and by emptying `unresolved` WITHOUT the reason arm to confirm the warning-still-fires witness catches it.
  - **Boundary**: no `{ bigint: true }` conversion of either installer's pre-existing stat captures; the authority RULE stated in D5 and D9 is unchanged — only the signal it reads

- [x] 2_2 Say what the save actually did, on a panel that has contents — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts && pnpm run check-types && pnpm exec biome check src/types/messages.ts src/types/messages.contract.test.ts src/providers/WorktreeHost.ts src/providers/WorktreeHost.actions.test.ts src/webview/worktree/WorktreeCreateDialog.ts src/webview/worktree/WorktreeCreateDialog.test.ts src/worktree/provisioning/providerKit.ts && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#a-save-that-wrote-is-never-presented-as-unsaved; design.md D4, D5; .reviews/round-1.md F002
  - **Acceptance**:
    - Outcome: each of the three writer outcomes gets its own summary on a model that carries contents
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts
  - **Plan**:
    1. In `src/types/messages.ts` — split `ProvisionProblem` into the discriminated union in design.md D4; the `locked` member REQUIRES `writeOutcome`. Replace the `locked` comment that claims the file was written.
    2. The read side produces problems through a factory typed on the whole union — `src/worktree/provisioning/providerKit.ts` at line 253 takes `ProvisionProblem["reason"]`. It never produces `locked`, so narrow it to the non-lock reasons rather than making it satisfy a member it cannot.
    3. In `src/providers/WorktreeHost.ts`, at line 2531 — stop collapsing with `written.ok && written.wrote`; pass the writer's own three-way answer into `leftLocked`.
    4. In `src/webview/worktree/WorktreeCreateDialog.ts` — move the save-outcome check AHEAD of the content-count return at `src/webview/worktree/WorktreeCreateDialog.ts:723-725`, which is what hid the summary. Use D4's exact strings.
    5. In `src/types/messages.contract.test.ts` — the outcome-less locked object must now FAIL to compile; assert that rather than its key count at `:327`.
    6. Witness every row of D4's summary table on a POPULATED model in `src/webview/worktree/WorktreeCreateDialog.test.ts`, plus refusal precedence and the failed reread from 1_3 in `src/providers/WorktreeHost.actions.test.ts`.
    7. Arm-check by restoring the early return and by collapsing the three outcomes back to a boolean.
  - **Boundary**: `media/webview.js` is a build artifact and untracked — do not edit it

- [x] 3_1 Report the save that just happened, not the one before it — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types && pnpm exec biome check src/providers/WorktreeHost.ts src/providers/WorktreeHost.actions.test.ts src/webview/worktree/WorktreeCreateDialog.ts src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#a-save-that-wrote-is-never-presented-as-unsaved; design.md D4, D5; .reviews/round-2.md F004, F005
  - **Acceptance**:
    - Outcome: the panel's save answer describes the latest attempt only
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts` — a failed reread falls back to the model already published, which carries the PREVIOUS save's appended problems, so `refusedSave` and `leftLocked` stack reports about one file. Remember the problems the save path appended for a surface and drop exactly those from the fallback before appending the new ones. Identity, not reason or filename: `refusedSave` maps a `malformed` refusal onto the same reason a READ produces, so a reason filter would eat genuine read problems.
    2. In `src/webview/worktree/WorktreeCreateDialog.ts` — restore the guard that task 2_2 dropped. The old `every((p) => p.reason === "locked")` said the lock answer applies only when a lock is the ONLY kind of problem; the rewrite's `filter`/`some` lets a lock mask a `malformed` or `unreadable` alongside it. Fall through to the existing answers when a non-lock problem is present, so nothing else about the precedence moves.
    3. Witness two saves through the failed-reread fallback for `written → unchanged` and `refused → written`, asserting ONE lock problem and the latest outcome.
    4. Witness a read problem beside a lock, asserting the read failure is not masked.
    5. Arm-check by restoring the append and by removing the non-lock guard.
  - **Boundary**: genuine read problems are preserved — the fix removes only what the save path itself added
