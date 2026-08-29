## 1. Presented activity

- [x] 1_1 Derive a presented activity that separates unknown from idle — verified: bun test 'src/webview/worktree/worktreeFormat.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{strongest-state-wins-and-shape-carries-it, an-activity-no-source-could-determine-is-not-presented-as-idle, a-failed-worktree-listing-does-not-make-any-activity-unknown}
  - **Acceptance**:
    - Outcome: a row whose activity source failed reads unknown, not idle
    - Verify: unit src/webview/worktree/worktreeFormat.test.ts
  - **Plan**:
    1. In `src/webview/worktree/worktreeFormat.ts`, add a presented-activity type widening the wire activity with `unknown`, and a function deriving it from a row plus the presence degradation list — mapping `hook`→`hook`, `output`/`title`→`panes`, `registry`→`registry`, and treating `activitySource: "none"` as unknown outright.
    2. Extend `strongestActivity` to rank the presented values `waiting` > `running` > `unknown` > `idle` > `exited`, taking presence so it ranks what is shown rather than what was sent.
    3. Leave a repo's own `degraded` flag out of the derivation; only presence-source failures participate.
    4. In `src/webview/worktree/worktreeTreeView.ts`, widen `stateShape`'s parameter and the worktree-row option to the presented type, so the seam type-checks against the widened return. The glyph, aria label, and call sites are 1_2's.

- [ ] 1_2 Give unknown its own shape and stop running collapsing into idle without motion
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#strongest-state-wins-and-shape-carries-it
  - **Acceptance**:
    - Outcome: five state shapes render, each distinct with colour and motion removed
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. In `src/webview/worktree/worktreeTreeView.ts`, pass the derived value at each of `stateShape`'s three call sites and keep the aria label truthful for `unknown` (1_1 widened the signature).
    2. In `src/webview/worktree/WorktreeView.ts`, thread the presence degradation list to the row and group builders so the derivation reaches every glyph.
    3. In `src/webview/worktree/worktreePanel.css`, add an `unknown` shape distinct from `idle` at rest, and give `running` a static form that differs from `idle` in outline rather than only in colour, so the reduced-motion rule leaves them distinguishable. Leave room for a sixth member — WT-008.2 adds `running (unconfirmed)` to this vocabulary.

- [ ] 1_3 Review the vocabulary as rendered
  - **Deps**: 1_2
  - **Acceptance**:
    - Outcome: the five shapes read apart at sidebar width under both settings
    - Verify: manual open the Worktree view at sidebar width with reduced motion on and a high-contrast or monochrome theme, and confirm waiting, running, unknown, idle and exited are each identifiable without reading colour
