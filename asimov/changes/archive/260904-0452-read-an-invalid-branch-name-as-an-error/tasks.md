## 1. Ask git, and say what it said

- [x] 1_1 Answer whether git takes the branch name, beside the base verdict — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-branch-name-git-will-not-take-is-refused-on-the-field}
  - **Boundary**: The acceptability rules are NOT reimplemented — `branchNameIsValid`
    (`src/worktree/worktreeMutations.ts:252`) already asks git, and its own comment records why a
    validator that is merely close is worse than none. An unaskable git is `undefined`, never a
    refusal: the create then proceeds and git refuses it directly, exactly as today. No change to
    what the create itself does, to the modes the probe classifies, or to the base verdict.
  - **Acceptance**:
    - Outcome: A probe for a fresh branch git refuses carries the refusal in its answer
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — `WorktreeCreateResolutionMessage` gains an optional branch verdict
       beside `baseValid`, in the same `BaseVerdict` shape and for the same reason: absent means
       nobody could be asked, which is not a refusal.
    2. `src/providers/WorktreeHost.ts` — an injected capability declared beside `resolveBase`
       (`:441`), a resolver beside `resolveBaseVerdict` (`:2390`), the `await` beside `baseValid`
       (`:2335`), and the spread beside it in the posted answer (`:2380`). Asked only where the mode
       creates a branch, on the rule `takesBase` already follows.
    3. `src/extension.ts` — the production wiring beside `resolveBase` (`:1244`), delegating to
       `branchNameIsValid` rather than to a second reading of git's rules.
    4. `src/providers/WorktreeHost.actions.test.ts` — the probe witnesses: refused, accepted, not
       asked for a mode that creates no branch, and unaskable answering nothing.
    5. `src/types/messages.contract.test.ts` — the wire witnesses, positive and `@ts-expect-error`.

- [x] 1_2 State git's refusal on the branch field, ahead of any pending check — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-branch-name-git-will-not-take-is-refused-on-the-field}, specs/worktree-panel/spec.md#{a-disabled-create-action-states-what-it-is-waiting-for}
  - **Boundary**: No new prose on the disabled action — the refusal is a FIELD error, which the form
    already renders (`nameError`, `is-invalid`, `aria-invalid` at
    `src/webview/worktree/WorktreeCreateDialog.ts:2894-2899`), and the user has said this form
    explains too much. The refusal for a branch checked out elsewhere keeps its precedence; a verdict
    for a name the user has typed past is dropped like every other stale answer.
  - **Acceptance**:
    - Outcome: A refused branch name marks the field invalid and states the refusal, and Create is not offered
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` — no edit needed, confirmed at build:
       `handleCreateResolution` (`:1387`) forwards the whole message, so the new field rides it with
       no second channel and no controller witness of its own.
    2. `src/webview/worktree/WorktreeCreateDialog.ts` — `deps.validateBranch` (`:212`) is the seam
       the form already computes `error` through (`:2888-2893`) and nothing has ever supplied. It is
       answered from the held resolution for the name on screen, so a verdict for a name the user has
       typed past does not speak. `blockedBy` needs no new arm: `error` is already read first.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` — the field states the refusal, Create is
       not offered, the refusal clears when the name is edited into an accepted one, a stale verdict
       does not speak, and a checked-out-elsewhere refusal still wins.
    4. `src/webview/worktree/WorktreeController.test.ts` — untouched, for the reason in step 1.
