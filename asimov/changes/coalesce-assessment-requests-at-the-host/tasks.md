# Tasks: coalesce-assessment-requests-at-the-host

## 1. The bound

- [ ] 1_1 Serve assessments from one lane per repository
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{an-assessment-the-user-moved-on-from-does-not-delay-what-they-do-next, asking-to-remove-again-always-asks-again}; design.md D1, design.md D2, design.md D3, design.md D6
  - **Acceptance**:
    - Outcome: A repository holds at most one queued assessment, however many are asked for
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, add a lane per `repoId` beside `liveOpening`: pending requests (`token`, `worktreeId`, `surface`) keyed by `surfaceKey(surface)`, a rotation order over those keys, and whether a lane job is enqueued-or-running.
    2. In the `worktreeRemoveAssess` case, after the existing pre-flight gate, write the pending entry and join the rotation unconditionally, then return without enqueuing when a lane job for that repository is already outstanding; otherwise mark it outstanding and enqueue one. Both writes are synchronous in the handler turn, before any `await` (design.md D6).
    3. Move the `assess(...)` call into that lane job: it walks the rotation for the first pending request whose surface is still attached, deletes that pending entry, advances the rotation past it, and assesses that request — replying with THAT request's `token` and `worktreeId`.
    4. In the lane job's `finally`, clear the outstanding flag and — in the same synchronous block — re-enqueue when any pending request remains.
    5. Delete a surface's pending entry and rotation position in the existing detach path beside `surfaces.delete(surface)`.
    6. Add tests: alternating two worktrees behind a held `forceRebuild` enters the coordinator once and the single reply carries the last request's token and worktreeId; a request arriving mid-job produces exactly one further job; `N` attach-ask-detach cycles leave at most one queued job; two surfaces asking continuously are each served rather than one starving.

- [ ] 1_2 Supersede a repeated ask in the panel instead of refusing it
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#asking-to-remove-again-always-asks-again; design.md D4
  - **Acceptance**:
    - Outcome: Asking to remove the same worktree twice posts two requests and shows the later answer
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeController.ts`, drop the same-worktree refusal from `beginAssess` so every ask mints a token and replaces `liveAssess`; `beginAssess` then returns `string`, and `askRemoval` and the `worktreeMenuActions` parameter lose their null branch.
    2. Add tests: a second ask for the same worktree posts a second `worktreeRemoveAssess`; the first reply opens nothing and the second opens the report; an ask after a reply that never arrived still opens a report.

- [ ] 1_3 Hold the lane bound against a mutation and a request burst
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#an-assessment-the-user-moved-on-from-does-not-delay-what-they-do-next; design.md D1
  - **Acceptance**:
    - Outcome: A burst of asks across surfaces and repositories queues one assessment per repository
    - Verify: unit src/providers/WorktreeHost.scale.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.scale.test.ts`, drive a burst of alternating asks from two attached surfaces across two repositories and assert the coordinator holds one assessment per repository at a time, whatever the burst size. This is the assertion the revert has to fail — the queue is already FIFO, so ordering alone would pass with the lane removed.
    2. Assert as a secondary property that a `worktreeRemove` delivered after one ask runs before every assessment admitted after it.

## 2. The witness

- [ ] 2_1 Make the assembly walk prove the removal it is named for
  - **Deps**: none
  - **Acceptance**:
    - Outcome: The walk removes and recreates a registration, delivers the watcher event, and confirms
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. In `src/extension.worktreeAssembly.test.ts`, give the `[3_4]` walk's fake two registration generations at one path — it has the removal, watcher `deliver()` and confirmation hooks already, and lacks only generation identity and a remove-then-recreate transition — rather than flipping `lockedRow`.
    2. Deliver the pending watcher event through the `deliver()` handle the walk already holds, and confirm the report so the removal path runs.
    3. Assert the report the dialog opened describes the replacement and that the confirmation acts on the replacement, not the predecessor.
    4. Reproduce the existing barrier-bypass mutation and report the result in the commit body. The Verify cannot observe it — the suite passes whether or not the falsifier still bites — so it is mutation evidence this task owes, not something its Acceptance covers.
