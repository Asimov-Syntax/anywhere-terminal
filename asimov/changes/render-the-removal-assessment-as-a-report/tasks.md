## 1. The report

- [x] 1_1 Present every check from the assessment's own list — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#the-removal-report-shows-every-check-it-ran-with-its-own-outcome; design.md D1, D4
  - **Acceptance**:
    - Outcome: A report where every check passed lists those checks with their outcomes
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: add a table mapping each check id to its wording, and replace `buildBlockerList`'s `if (failed(...))` chain with a walk of the assessment's `checks` array in the order the host sent them.
    2. Same file: each entry renders from the check's `outcome` — a passing, a failing, an unproven and a not-applicable form — with `count` rendered in its own element as it is today.
    3. Same file: checks with `cls === "proof"` render under their own heading, worded as what they would unlock rather than as a risk.
  - **Boundary**: no change to `src/worktree/removalChecks.ts`'s classification or to any message shape

- [x] 1_2 Choose the confirmation control from the classes the host sent — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-typed-confirmation-is-required-only-where-a-confirmable-risk-earned-one; design.md D2, D3
  - **Acceptance**:
    - Outcome: A removal whose only unproven check is a proof is offered with an ordinary confirmation
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: add one exported function over the checks returning `"refused" | "typed" | "ordinary"` — refused from `isRefusedByChecks`, typed when any `cls === "confirmable"` check has outcome `failed` or `unproven`, ordinary otherwise.
    2. Same file: mount a name-entry field that enables the destructive button only on an exact match with the worktree's name, for the typed case.
    3. Same file: delete the `!checks.some((c) => c.cls !== "proof" && c.outcome === "unproven")` guard around the force button, which the typed confirmation replaces.
    4. `src/webview/worktree/WorktreeRemoveDialog.test.ts` and `src/extension.worktreeAssembly.test.ts`: the inherited tests answer the confirmation by clicking it, which the typed case no longer accepts — enter the name first where the report earns one.
  - **Boundary**: the fingerprint the confirmation re-sends is unchanged — a typed confirmation authorizes the same set, not a wider one

- [x] 1_3 State what the removal leaves behind, per clause — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#a-removal-states-what-it-destroys-and-what-it-spares; design.md D5
  - **Acceptance**:
    - Outcome: The report states the branch is kept and that panes inside the worktree keep running
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: in `buildForceWarning`, keep each clause's own truth condition — the pane clause only where panes were counted, the branch clause only where a branch is named — and state them for the ordinary confirmation as well as the forced one.

- [x] 1_4 Fix round-1 B2 and W2 — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#the-removal-report-shows-every-check-it-ran-with-its-own-outcome; design.md D1; .reviews/round-1.md B2, W2
  - **Acceptance**:
    - Outcome: A refused dialog lists every check the assessment reported
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: render the reported check list in the refusal path too, keeping the refusal explanation and mounting no confirmation control.
    2. Same file: word the `idlePanes` failing sentence from the evidence the producer actually carries — panes whose working directory is the worktree — rather than claiming they are idle.
    3. `src/webview/worktree/WorktreeRemoveDialog.test.ts` and `src/webview/worktree/WorktreeView.test.ts`: replace the inherited assertions that a refused dialog has no `.wt-blockers`, and assert the pane wording against a running pane.
  - **Boundary**: no change to `src/worktree/worktreeBlockers.ts`'s pane selection or to any message shape — the wording is the defect, not the count

- [x] 1_5 Refuse on a refusal-class check nobody could evaluate — verified: pnpm exec vitest run 'src/worktree/removalChecks.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 1_4
  - **Refs**: specs/worktree-panel/spec.md#a-typed-confirmation-is-required-only-where-a-confirmable-risk-earned-one; design.md D2; .reviews/round-1.md W1
  - **Acceptance**:
    - Outcome: A report whose refusal-class check is unproven offers no confirmation control
    - Verify: unit src/worktree/removalChecks.test.ts
  - **Plan**:
    1. `src/worktree/removalChecks.ts`: `isRefusedByChecks` returns true for a `cls === "refusal"` check whose outcome is `failed` or `unproven`.
    2. `src/worktree/removalChecks.test.ts`: cover the unproven refusal alongside the failing one, and that a confirmable or proof unproven still does not refuse.
    3. `src/webview/worktree/WorktreeRemoveDialog.test.ts`: the round-1 test asserting an unreadable refusal check leaves the removal gated now asserts it refuses; keep the case that an unreadable CONFIRMABLE check is gated rather than refused.
  - **Boundary**: no change to the host's own refusal path — `assessment.kind` stays the host's decision, and no message shape moves

- [x] 1_6 Explain the refusal from the check that actually refused — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 1_5
  - **Refs**: specs/worktree-panel/spec.md#the-removal-report-shows-every-check-it-ran-with-its-own-outcome; design.md D1; .reviews/round-2.md W3
  - **Acceptance**:
    - Outcome: A refusal explains the check that refused it, in that check's own outcome
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: pick the refusing check — the first refusal-class check in host order whose outcome is `failed` or `unproven` — and select the refusal copy from its id and outcome, extending D1's keyed-by-check principle to the refusal box rather than keeping a chain of `failed(...)` tests.
    2. Same file: give `externalAgents` its own explanation instead of the local-agent copy, and give every `unproven` refusal wording that says the check could not be evaluated rather than asserting what it found.
    3. Same file: keep the local-agent chain — the vouched / unconfirmed / unread composition — for a `busyAgents` refusal that actually failed.
    4. `src/webview/worktree/WorktreeRemoveDialog.test.ts`: assert the sentence a user reads for each refusing check and outcome, not only that a control is absent.
  - **Boundary**: the refusal still mounts no confirmation control in any case — this task changes only what the refusal says

- [x] 1_7 Dispatch every refusal branch from the check that refused — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 1_6
  - **Refs**: specs/worktree-panel/spec.md#the-removal-report-shows-every-check-it-ran-with-its-own-outcome; design.md D1; .reviews/round-3.md W3
  - **Acceptance**:
    - Outcome: Two failing refusal checks name the one the host listed first
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: the `isMain` and `containsWorktrees` branches test the refusing check's id rather than `failed(checks, ...)`, so a second failing check cannot displace the first.
    2. `src/webview/worktree/WorktreeRemoveDialog.test.ts`: cover two simultaneous failures, and a report whose host order puts another refusal check ahead of `isMain`.
  - **Boundary**: the lock-override clause in the consequence box keeps its own `failed` test — it states a fact about the lock, not which check refused

## 2. The menu asks before it deletes (round-3 B1)

- [x] 2_1 Put the assess round trip on the wire — verified: pnpm run check-types && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: none
  - **Refs**: design.md D6, D8
  - **Acceptance**:
    - Outcome: The two assess messages exist and every caller names their fields
    - Verify: command pnpm run check-types
  - **Plan**:
    1. `src/types/messages.ts`: add `WorktreeRemoveAssessRequestMessage` and `WorktreeRemoveAssessmentMessage` as design.md § D8 declares them, and register the request in `WORKTREE_MESSAGE_TYPES` — it travels webview → extension.
    2. Same file: the assessment reuses `WorktreeRemoveAssessmentPayload`; do not define a second copy of it or of `RemovalCheck`.
    3. `src/providers/TerminalViewProvider.worktree.test.ts`: the routing test is driven from `WORKTREE_MESSAGE_TYPES` and requires one sample message per listed type — add the `worktreeRemoveAssess` sample so the new door is proven to reach a provider.
  - **Boundary**: types only — no handler, no render, no behaviour changes here

- [x] 2_2 The host answers a report and removes nothing — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D6, D7, D8; specs/worktree-panel/spec.md#a-removal-is-reported-before-anything-is-deleted
  - **Acceptance**:
    - Outcome: An assess request answers with the report and deletes nothing
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: handle `worktreeRemoveAssess` by calling the existing `assessRemoval` binding and posting `worktreeRemoveAssessment` to the asking surface. A target that will not resolve posts nothing.
    2. `src/worktree/worktreeMutationService.ts`: the report and its authority are produced HERE, as one new read-only capability, because `assessRemoval`, `checksFor`, `atRisk` and `fingerprints.issue` all already live together in this module. Deciding the fingerprint host-side would be a second copy of `atRisk`, which D7 forbids by construction rather than by review.
    3. `src/providers/WorktreeHost.ts`: declare that capability on `WorktreeActions` alongside `removeWorktree`, and `src/extension.ts`: wire it to the service, as every other mutation capability is wired.
    4. `src/providers/WorktreeHost.actions.test.ts`: the removal capability is never invoked for an assess; an unresolvable target posts nothing; the assessed arm carries the fingerprint the service issued and the unavailable arm carries none.
    5. `src/worktree/worktreeMutationService.test.ts`: D7's real witness. The host test stubs the capability, so it cannot prove the `atRisk` tie — assert here that a clean assessment issues no fingerprint, a risky one does, a refusal issues none, and that no git removal command is run.
  - **Boundary**: `assessRemoval` and `evaluateRemoval` are called, never reimplemented, and no check is added, removed or reclassified. This records the first D7 implementation; task 4_1 supersedes only its clean-assessment `null` fingerprint while retaining the read-only assess seam

- [x] 2_3 The confirmation carries only the authority it was handed — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D7; specs/worktree-panel/spec.md#a-confirmation-carries-only-the-authority-its-report-was-granted
  - **Acceptance**:
    - Outcome: A report with no fingerprint confirms unforced
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreeViewTypes.ts`: `WorktreeRemoveReport.fingerprint` becomes `string | null` — the panel's own type has to be able to HOLD "this report authorizes no force" before any control can honour it.
    2. `src/webview/worktree/WorktreeRemoveDialog.ts`: widen `onConfirm` to accept the nullable fingerprint and forward what the report carried, synthesising nothing.
    3. `src/webview/worktree/WorktreeView.ts` and `src/webview/worktree/WorktreeController.ts`: carry the nullable through to the posted message — `force: true` with the fingerprint where there is one, `force: false` with no fingerprint key where there is not. The whole thread lands in ONE task because a nullable that stops at the dialog leaves a tree that does not compile; 2_4 then owns only how the report is obtained.
    4. `src/webview/worktree/WorktreeRemoveDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts`: a null-fingerprint report confirms and hands back null; a fingerprint-carrying one hands back that fingerprint; the control chosen for a `notApplicable` report is the ordinary one; the confirm posts `force: false` with no fingerprint key for a null report.
  - **Boundary**: `confirmationFor` is not touched — D9 is that `notApplicable` already lands on ordinary, and a test pins it rather than a new branch. This records the behavior built under D7's first version; task 4_2 supersedes the null-fingerprint callback after the user's every-removal-confirms decision

- [x] 2_4 Remove Worktree opens the report — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 2_2, 2_3
  - **Refs**: design.md D6, D7, D8; specs/worktree-panel/spec.md#{a-report-that-could-not-be-produced-is-not-a-refusal, a-confirmation-carries-only-the-authority-its-report-was-granted}
  - **Acceptance**:
    - Outcome: Choosing Remove Worktree deletes nothing until the report is answered
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts`: the `removeWorktree` action posts `worktreeRemoveAssess` rather than an unforced `worktreeRemove`; handle the reply by opening the report, and route the `unavailable` arm to the retry surface the host's own `unavailable` already uses. The retry that surface offers re-asks rather than removing — otherwise an unreadable assessment is a second door onto the deletion B1 closed.
    1a. `src/webview/worktree/WorktreeView.ts`: `openRemoveReport(info, report)` — the view already fills `agentRows` and `degradedSources` from its own presence for the blocked-result path, and the controller must not copy those two lookups to open the same dialog.
    2. Same file: the confirm posts `force: true` with the fingerprint where the report carried one, and `force: false` with no fingerprint key where it did not.
    3. `src/webview/messaging/MessageRouter.ts` and `src/webview/worktree/worktreeMessageHandlers.ts`: route the new inbound message. Both: the router's switch is what turns a wire message into a handler call, and the delegation table is what production and the assembly test share.
    4. `src/webview/worktree/WorktreeController.test.ts`: choosing remove posts an assess and no removal; an all-passed report confirms to `force: false`; a failed-check report confirms to `force: true` with its fingerprint; an `unavailable` reply mounts no confirmation control.
    5. `src/extension.worktreeAssembly.test.ts`: carry the four existing menu-to-git walks onto the new entry point — the menu click is now an assess, so a walk that asserts git argv has to answer the report first. Only the EXISTING walks; 2_5 owns the new proofs, and this step exists because a task that leaves the suite red is not done.
  - **Boundary**: the existing blocked-result path stays — a removal blocked at execution time still reports and re-offers. Task 4_3 supersedes only this task's client-selected `force:false` / `force:true` request shape

- [x] 2_5 Prove it through the shipped wiring — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 2_4
  - **Refs**: design.md D6, D7
  - **Acceptance**:
    - Outcome: The assembled extension reports before removing and removes on confirmation
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts`: walk a clean worktree from the menu action to the report, assert nothing was removed before the confirm, then that the confirm removes it.
    2. Same file: walk a worktree with a failed confirmable check and assert the typed confirmation is what authorizes the forced removal.
  - **Boundary**: no production behaviour is added here — this task proves what 2_1 to 2_4 built, through the real assembly

## 3. The report answers for the worktree it named (round-4 B3, W4, W5)

- [x] 3_1 Assess behind the same barrier a mutation takes — verified: bun test 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 2_5
  - **Refs**: design.md D10; specs/worktree-panel/spec.md#a-report-describes-the-worktree-the-confirmation-will-act-on
  - **Acceptance**:
    - Outcome: The assessment resolves its target only after the forced rebuild has released
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts`: `assessRemovalReport` runs its assessment inside `coordinator.run(target.repoId, …)` — `resolve` is `deps.resolve(target)`, the body is the existing assess-and-classify, and `missing` returns the `unavailable` arm D12 names rather than `null`. Nothing calls `deps.report`; `withTarget` is not used and is what would publish.
    2. `src/worktree/worktreeMutationService.test.ts`: hold `forceRebuild` unresolved and assert neither `resolve` nor the assessment has run — an assertion on the finished order would also pass if the barrier were removed and the calls merely happened to land that way. Then: a target that vanishes across the barrier answers `unavailable` rather than `null`; a registration replaced across the barrier is assessed as the replacement and mints the replacement's token.
  - **Boundary**: the coordinator's own contract is not touched — no opt-out flag for the post-attempt rebuild, because that `finally` is load-bearing for every mutation that shares it (D10)

- [x] 3_2 The host stops swallowing an assessment that failed — verified: bun test 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D12; specs/worktree-panel/spec.md#an-assessment-that-fails-outright-is-reported-not-swallowed
  - **Acceptance**:
    - Outcome: A rejected assessment reaches the retry surface instead of leaving the action unanswered
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: the `worktreeRemoveAssess` catch posts the `unavailable` arm rather than nothing, re-checking surface liveness the same way the success leg does. Correct the comment above the handler: the ground it gives for avoiding `perform` is half wrong, and D10 is what it should cite.
    2. `src/providers/WorktreeHost.actions.test.ts`: a rejecting assessment capability produces exactly one `unavailable` reply; a rejection after the surface detached posts nothing.
  - **Boundary**: no new arm on the wire — D12 chose to name what failed inside the existing `unreadable` list precisely so `WorktreeRemoveAssessmentMessage` does not grow a third case

- [x] 3_3 A reply is honoured only while it answers the live request — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 3_1, 3_2
  - **Refs**: design.md D11; specs/worktree-panel/spec.md#a-report-is-shown-only-while-it-still-answers-what-the-user-asked
  - **Acceptance**:
    - Outcome: An assessment answered after the user moved on opens nothing
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts`: `worktreeRemoveAssess` carries a token and `worktreeRemoveAssessment` echoes it, per D11's block.
    2. `src/providers/WorktreeHost.ts` and `src/providers/WorktreeHost.actions.test.ts`: echo the token unchanged on every arm, including the two D12 answers. The host neither mints nor interprets it. The pre-flight gate answers `unavailable` too rather than returning silently — D12 says a request the host takes up never exits silently, and it is that silence the duplicate drop below would otherwise dead-end on. (SUPERSEDED as rationale, not as built behaviour: the drop in step 3 is gone, so the pre-flight answer no longer has a dead-end to prevent. It is retained because a request that is served still deserves an answer, and the round-6 chair ruled it valid D12 conformance in its own right.)
    3. `src/webview/worktree/WorktreeController.ts`: mint the token where the assess is posted and hold at most one live; drop a reply whose token is not it; drop a duplicate request while one is outstanding for the same worktree (D10's backlog control). **SUPERSEDED — this clause no longer describes the shipped panel.** Round-6 B5 refuted the drop and `coalesce-assessment-requests-at-the-host` deleted it; the controller now always asks again, and the bound is one job per repository on the host. Steps 1, 2 and 4 stand as built, as does this step's live-token guard, which is what this task's Acceptance is about. Recorded here rather than rewritten: this task is `[x]` and its Acceptance — an assessment answered after the user moved on opens nothing — remains true and remains witnessed.
    4. `src/webview/worktree/WorktreeView.ts`: the blocked-notice *Force remove…* opener tells the controller it opened a dialog, so the live token is cleared on that path too; render Retry only where the result still carries a `worktreeId`.
    5. `src/webview/worktree/WorktreeController.test.ts` and `src/webview/worktree/WorktreeView.test.ts`: the two falsifiers the id-only draft failed — reply 1 of two requests for the SAME worktree opens nothing, and a reply landing after the view's own opener leaves that dialog standing — plus a reply for a different worktree, a re-scoped `unavailable` rendering no Retry, the ordinary path still opening its report, and — as originally written — a suppressed duplicate request. That last witness was REPLACED, not deleted, by `coalesce-assessment-requests-at-the-host`: three tests now assert the opposite behaviour it asserted, because the behaviour itself was refuted.
  - **Boundary**: the token orders answers and authorizes nothing — removal authority stays D7's fingerprint, force is host-derived, and a stale-token reply is discarded rather than trusted for any part of itself

- [x] 3_4 Prove the replacement cannot be deleted under its predecessor's report — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 3_1, 3_2, 3_3
  - **Refs**: design.md D10, D11
  - **Acceptance**:
    - Outcome: The assembled extension assesses the registration the barrier resolved, not the one the cache held
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts`: give the assembly a controllable watcher — it has none today, and its own comment says so — so a rebuild can be deferred deliberately.
    2. Same file: walk a remove-and-recreate at the same path with that rebuild deferred, and assert the walk actually happened before asserting the outcome: the predecessor was registered, the replacement exists, the deferred event was pending, and a confirmation control was mounted. A bare "no forced removal" passes with no watcher, no token, and no dialog.
  - **Boundary**: no production behaviour is added here — this task proves what 3_1 to 3_3 built, through the real assembly

## 4. Every removal confirms (round-1 B1 user decision)

- [x] 4_1 Enforce the report fingerprint at the host boundary — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' 'src/providers/WorktreeHost.actions.test.ts' 'src/providers/WorktreeHost.scale.test.ts' 'src/extension.worktreeMutations.test.ts' && pnpm run check-types && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 3_4
  - **Refs**: specs/worktree-panel/spec.md#{a-removal-is-reported-before-anything-is-deleted, a-confirmation-carries-only-the-authority-its-report-was-granted}; design.md D7
  - **Acceptance**:
    - Outcome: A fingerprint-free request for a published target cannot reach git
    - Verify: command pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' 'src/providers/WorktreeHost.actions.test.ts' 'src/providers/WorktreeHost.scale.test.ts' 'src/extension.worktreeMutations.test.ts' && pnpm run check-types
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts`: issue a fingerprint for every confirmable assessment, including all-passed and `notApplicable`; treat an absent fingerprint as unconfirmed intent that returns the blocked report and never reaches git; after a present fingerprint re-assesses and redeems, derive the Git force mode from the fresh evidence with the existing `atRisk` definition.
    2. `src/providers/WorktreeHost.ts` and `src/extension.ts`: narrow the mutation capability to the optional fingerprint and carry it through the production host. A direct fingerprint-free request for a host-published target still delegates so the service returns blocked or unavailable assessment state rather than executing; an unknown id with no repository remains the existing silent fail-closed pre-flight.
    3. `src/types/messages.ts`: make the client `force` field transitional and optional for this task; the host no longer reads it, and task 4_2 removes it after the webview has moved. Require every readable non-refused assessment to carry a fingerprint.
    4. `src/worktree/worktreeMutationService.test.ts`, `src/providers/WorktreeHost.actions.test.ts`, `src/providers/WorktreeHost.scale.test.ts`, and `src/extension.worktreeMutations.test.ts`: reverse the direct-unforced fallthrough, prove a clean fingerprint redeems to ordinary Git and a risky one to forced Git, and keep refusal, unavailable, expiry, mismatch and one-shot spend fail-closed.
  - **Boundary**: no check, `atRisk` predicate, fingerprint digest/subset/TTL/spend rule, observation barrier, branch-delete contract, or Git argv rule is reimplemented or widened

- [x] 4_2 Require authority before the dialog can confirm — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' 'src/webview/worktree/WorktreeRemoveDialog.test.ts' 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run check-types && pnpm exec vitest run exit 0
  - **Deps**: 4_1
  - **Refs**: specs/worktree-panel/spec.md#a-confirmation-carries-only-the-authority-its-report-was-granted; design.md D7
  - **Acceptance**:
    - Outcome: A mounted removal confirmation always returns a non-null report fingerprint
    - Verify: command pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' 'src/webview/worktree/WorktreeRemoveDialog.test.ts' 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types
  - **Plan**:
    1. `src/webview/worktree/worktreeViewTypes.ts`, `src/webview/worktree/WorktreeRemoveDialog.ts`, and `src/webview/worktree/WorktreeView.ts`: narrow the confirmation callback to a string fingerprint. A refusal or unavailable result still presents no executable control, and a malformed confirmable report with no authority fails closed rather than recreating the old unforced request.
    2. `src/webview/worktree/WorktreeController.ts`: accept only that non-null authority from the view; keep the transitional `force` field for one task, where the host already ignores it under 4_1.
    3. `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeRemoveDialog.test.ts`, and `src/webview/worktree/WorktreeView.test.ts`: replace the clean-null callback assertions and prove a confirmable report cannot mount an executable control without authority.
  - **Boundary**: the dialog still chooses ordinary versus typed from check classes; that UI threshold is not Git's force mode and neither predicate is re-derived here

- [x] 4_3 Remove the webview's force choice — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' 'src/providers/WorktreeHost.actions.test.ts' 'src/providers/WorktreeHost.scale.test.ts' 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run check-types && pnpm exec vitest run --maxWorkers=1 exit 0
  - **Deps**: 4_2
  - **Refs**: specs/worktree-panel/spec.md#a-confirmation-carries-only-the-authority-its-report-was-granted; design.md D7
  - **Acceptance**:
    - Outcome: A confirmed removal request carries its fingerprint and no force choice
    - Verify: command pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' 'src/providers/WorktreeHost.actions.test.ts' 'src/providers/WorktreeHost.scale.test.ts' 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types
  - **Plan**:
    1. `src/types/messages.ts` and `src/providers/TerminalViewProvider.worktree.test.ts`: delete the transitional `force` field from `worktreeRemove` and its routed sample, leaving only `worktreeId` and the optional report fingerprint.
    2. `src/providers/WorktreeHost.actions.test.ts` and `src/providers/WorktreeHost.scale.test.ts`: remove every remaining raw-message `force` literal so deleting the field is proven across the host's typed callers rather than assumed from task 4_1.
    3. `src/webview/worktree/WorktreeController.ts`: forward the report fingerprint unchanged and delete the present-to-forced branch. The panel has no field from which it can choose Git's mode.
    4. `src/webview/worktree/WorktreeController.test.ts`: prove the posted request contains the fingerprint and no force choice.
  - **Boundary**: host/service behavior was established in 4_1; this task removes the dead client vocabulary rather than adding a second force decision

- [ ] 4_4 Prove both shipped entry doors stop at the report
  - **Deps**: 4_3
  - **Refs**: specs/worktree-panel/spec.md#a-removal-is-reported-before-anything-is-deleted; design.md D6, D7
  - **Acceptance**:
    - Outcome: Neither shipped removal entry door reaches git before a report callback
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts`: keep the existing clean menu walk, require its report to carry authority, and prove its confirmation still invokes ordinary `git worktree remove` rather than `--force`.
    2. Same file: drive a raw fingerprint-free `worktreeRemove` for the published row through the assembled extension seam, assert it runs no removal and renders the blocked notice, open the report from that notice's action, then answer its dialog and assert exactly one removal runs.
    3. Same file: keep the failed-confirmable walk and prove the same callback reaches `--force`; mutation-check the two load-bearing negatives — restoring the clean fallthrough or mapping fingerprint presence directly to force must fail this file.
  - **Boundary**: no production behaviour is added here; this is the menu-to-git and direct-message-to-git witness round-1 B1 was missing
