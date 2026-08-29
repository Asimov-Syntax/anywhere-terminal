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

- [x] 1_2 Give unknown its own shape and stop running collapsing into idle without motion — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

## 2. Review round 1

- [x] 2_1 Thread the presented state to every surface that draws it — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{an-activity-no-source-could-determine-is-not-presented-as-idle, strongest-state-wins-and-shape-carries-it}
  - **Acceptance**:
    - Outcome: no surface draws a row no source could read as idle
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Move the `activitySource` → degraded-source table out of `src/providers/WorktreeHost.ts` into `src/worktree/presenceTypes.ts`, keeping its `satisfies Record<…>` exhaustiveness check, and read it from `src/webview/worktree/worktreeFormat.ts` instead of the local switch (W4).
    2. In `worktreeFormat.ts`, group the collapsed pill on the presented state over the presented precedence, and make `strongestActivity`'s degradation parameter required (B1, S1).
    3. In `src/webview/worktree/WorktreeView.ts`, pass the degradation list to the pill and into the remove dialog's deps (B1, W1).
    4. In `src/webview/worktree/WorktreeRemoveDialog.ts`, draw each busy row with its presented state; keep the filter inclusive (W1).
    5. In `src/webview/worktree/worktreeTreeView.ts`, key the `~` confidence marker off the presented state and give the worktree row's phrasing a named helper (W3, S2).
    6. In `src/webview/worktree/WorktreeView.test.ts`, normalize the shape rules a second time with `animation` stripped and read the reduced-motion override, so the guard fails on the pre-change ring (W2).

## 3. Review round 2

- [x] 3_1 Say exactly how much of the busy list is confirmed — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#an-activity-no-source-could-determine-is-not-presented-as-idle
  - **Acceptance**:
    - Outcome: the refusal's certainty matches the rows listed under it
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeRemoveDialog.ts`, partition the busy rows into confirmed and unreadable and phrase all four cases — all confirmed, all unreadable, mixed, and none listed (N1, N3). Make the two optional presented-state defaults required (N2).
    2. In `src/webview/worktree/worktreeTreeView.ts`, name the failing source in the `unknown` tooltip rather than the row's own label, matching the stale affordance, and drop the now-required default (N7, N2).
    3. In `src/webview/worktree/WorktreeView.test.ts`, pin the certainty branch's own string, and read `::after` and the dropped fill declarations so deleting a state's fill fails the shape guard (N1, N8).
