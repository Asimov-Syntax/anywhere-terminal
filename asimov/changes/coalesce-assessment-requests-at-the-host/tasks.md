# Tasks: coalesce-assessment-requests-at-the-host

## 1. The bound

- [ ] 1_1 Admit at most one assessment run per surface and repository
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{an-assessment-the-user-moved-on-from-does-not-delay-what-they-do-next, asking-to-remove-again-replaces-the-question-rather-than-being-ignored}; design.md D1, design.md D2, design.md D3, design.md D6
  - **Acceptance**:
    - Outcome: Alternating and repeated assess requests from one surface enter the coordinator once
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, add two maps keyed by `` `${surfaceKey(surface)} ${repoId}` `` beside `liveOpening`: the latest unanswered assess request (`token`, `worktreeId`, `surface`) and whether a run for that pair is enqueued-or-running.
    2. In the `worktreeRemoveAssess` case, after the existing pre-flight gate, write the slot unconditionally and return without enqueuing when a run for that pair is already outstanding; otherwise set the flag and enqueue one run. Both writes are synchronous in the handler turn, before any `await` (design.md D6).
    3. Move the `assess(...)` call into that run: it reads the slot, clears it, and assesses the request it read, replying with THAT request's `token` and `worktreeId`.
    4. In the run's `finally`, clear the flag and — in the same synchronous block — re-enqueue when the slot has been written since, so a request that arrived mid-run is served.
    5. Sweep both maps for a surface in the existing detach path beside `surfaces.delete(surface)`.
    6. Add tests: two worktrees alternated behind a held `forceRebuild` enter the coordinator once and the single reply carries the LAST request's token and worktreeId; a request arriving mid-run produces exactly one further run; requests for two repositories from one surface do not share a slot.

- [ ] 1_2 Supersede a repeated ask in the panel instead of refusing it
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#asking-to-remove-again-replaces-the-question-rather-than-being-ignored; design.md D4
  - **Acceptance**:
    - Outcome: Asking to remove the same worktree twice posts two requests and shows the later answer
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeController.ts`, drop the same-worktree refusal from `beginAssess` so every ask mints a token and replaces `liveAssess`; `beginAssess` then returns `string`, and `askRemoval` and the `worktreeMenuActions` parameter lose their null branch.
    2. Add tests: a second ask for the same worktree posts a second `worktreeRemoveAssess`; the first reply opens nothing and the second opens the report; an ask after a reply that never arrived still opens a report.

- [ ] 1_3 Prove a mutation is not delayed by assessments admitted after it
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#an-assessment-the-user-moved-on-from-does-not-delay-what-they-do-next; design.md D1
  - **Acceptance**:
    - Outcome: A mutation runs before every assessment requested after it, however many were requested
    - Verify: unit src/providers/WorktreeHost.scale.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.scale.test.ts`, record coordinator entry order and assert a `worktreeRemove` delivered after one assess runs before any assess admitted after it, with a burst of alternating asks in between.
    2. Assert the same burst from two attached surfaces admits one run per surface and no more.

## 2. The answer survives

- [ ] 2_1 Report a delivery failure as a delivery failure, not a failed assessment
  - **Deps**: 1_1
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: A send failure never renders as a failed assessment
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, attach the rejection handler to the `assess(...)` promise rather than chaining it after the success handler, and route both arms through one reply helper that tolerates a throw from the send itself.
    2. Add a test whose surface `post` throws on the success reply and asserts no `unavailable` reply follows and nothing escapes the chain.

- [ ] 2_2 Deliver the assessment reply through the retrying critical sender
  - **Deps**: 2_1
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: A transient postMessage failure on the assessment reply is retried and the report still lands
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. Add optional `postCritical?(message: ExtensionToWebViewMessage): Promise<boolean>` to `WorktreeSurface` in `src/providers/WorktreeHost.ts`, and use it for the assessment reply only, falling back to `post` when a surface does not offer it.
    2. Implement it on both worktree surfaces — `src/providers/TerminalViewProvider.ts` and `src/providers/TerminalEditorProvider.ts` — as `safeSendWithRetry(..., 2, shouldAbort)`, reusing the existing sender rather than adding one.
    3. Pass a `shouldAbort` that reports whether the host's slot for that surface and repository has moved on, so a retry never delivers an answer to a replaced question.
    4. Add a test in `src/providers/TerminalViewProvider.worktree.test.ts` where `postMessage` resolves `false` once and then `true`, asserting the assessment reply is delivered.

## 3. The witness

- [ ] 3_1 Make the assembly walk prove the removal it is named for
  - **Deps**: none
  - **Acceptance**:
    - Outcome: The walk removes and recreates a registration, delivers the watcher event, and confirms
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. In `src/extension.worktreeAssembly.test.ts`, extend the `[3_4]` walk's fake to hold two registration generations at one path rather than flipping `lockedRow`, deliver the pending watcher event through the `deliver()` handle the walk already holds, and confirm the report so the removal path runs.
    2. Assert the report the dialog opened describes the replacement and that the confirmation acts on the replacement, not the predecessor.
    3. Re-run the existing barrier-bypass mutation and confirm the walk still fails without the barrier, so the strengthening did not weaken what round 6 adjudicated.
