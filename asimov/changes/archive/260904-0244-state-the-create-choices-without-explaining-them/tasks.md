## 1. Say it once

- [x] 1_1 Shorten the host's suggestion text to the part the row cannot show itself — verified: pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{every-initialization-suggestion-is-explicit-and-explained}
  - **Boundary**: The `suggestion` field stays PRESENT on every row it is present on today — its presence is what keeps a suggested row unchecked (`src/types/messages.ts:857-863`); no change to which rows are suggested, to the workspace scan that finds them, or to any provisioning behaviour
  - **Acceptance**:
    - Outcome: A suggested row's text adds only what the row does not already show
    - Verify: command pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/suggestProvisioning.ts` — the three templates at the root-env, workspace-env and lockfile sites. The row already renders `source` and the subject, so the path is on screen twice before the sentence repeats it a third time; what survives is the secrets warning, and for setup nothing beyond what the row already names.
    2. `src/worktree/provisioning/suggestProvisioning.test.ts` — the witnesses that assert the current sentences, and one that fails if `suggestion` becomes absent rather than short.
    3. `src/extension.worktreeAssembly.test.ts` — the assembly witness reading the secrets warning off the rendered row, which pinned the sentence's casing rather than its presence.

- [x] 1_2 Render a suggestion as a hint beside the row, not a paragraph under it — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{every-initialization-suggestion-is-explicit-and-explained}
  - **Boundary**: No change to the live notes — `wt-brow-yield`, `wt-brow-contested`, and the contender note each describe a relationship between rows that a row cannot show on its own; no change to selection, grouping or exclusion
  - **Acceptance**:
    - Outcome: A suggested row reads as one line
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — the `row.suggestion` branch in the row renderer, which appends a wrapping note into the meta line.
    2. `src/webview/worktree/worktreePanel.css` — `wt-brow-suggested`, so the hint sits on the row's line rather than wrapping under it.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` — the witnesses reading that note's text, plus one that the warning is still reachable rather than only visible.

## 2. Two controls that explain themselves

- [x] 2_1 Keep what the save action does not cover, without a paragraph carrying it — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{the-provisioning-save-action-names-what-it-persists}
  - **Boundary**: What the save persists does not change; the accessible description survives — round-1 F014 required it because a screen reader announcing the button alone hears the half of the sentence that sounds complete
  - **Acceptance**:
    - Outcome: The save action still announces what it does not persist
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — the save button and its `saveNote`/`aria-describedby` pair.
    2. `src/webview/worktree/worktreePanel.css` — `wt-bring-save-note`.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` — the existing F014 witness, read as "the description is announced" rather than "this sentence is on screen".

- [x] 2_2 Give the setup gate's order its own line — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-setup-gate-states-the-resulting-order-as-its-own-line}
  - **Boundary**: No change to which step gates the agent, to the recommendation's default, or to the three states the note distinguishes
  - **Acceptance**:
    - Outcome: The wait note renders on its own line, not continuing the checkbox label
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreePanel.css` — `wt-wait-note`, which is appended after the label inside `waitField` and currently runs straight on from it.
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts` — the note's three states, asserted as a separate element from the label.
