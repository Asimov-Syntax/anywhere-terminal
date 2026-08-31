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
