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

- [ ] 1_3 State what the removal leaves behind, per clause
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#a-removal-states-what-it-destroys-and-what-it-spares; design.md D5
  - **Acceptance**:
    - Outcome: The report states the branch is kept and that panes inside the worktree keep running
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeRemoveDialog.ts`: in `buildForceWarning`, keep each clause's own truth condition — the pane clause only where panes were counted, the branch clause only where a branch is named — and state them for the ordinary confirmation as well as the forced one.
