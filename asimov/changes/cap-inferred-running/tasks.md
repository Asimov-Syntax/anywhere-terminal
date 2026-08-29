## 1. The ceiling

- [x] 1_1 Derive activity confidence from the row's own clock — verified: pnpm exec vitest run 'src/webview/worktree/worktreeFormat.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{an-inferred-running-claim-stops-animating-once-it-outlives-its-evidence, only-an-output-inferred-running-claim-is-ever-unconfirmed, confidence-returns-with-evidence-and-the-clock-restarts-only-on-the-claim, strongest-state-wins-and-shape-carries-it, a-summary-counts-every-state-it-is-summarising}
  - **Acceptance**:
    - Outcome: an output-inferred run past the ceiling derives as unconfirmed, nothing else does
    - Verify: unit src/webview/worktree/worktreeFormat.test.ts
  - **Plan**:
    1. In `src/webview/worktree/worktreeFormat.ts`, export the ceiling constant and widen the presented vocabulary with the unconfirmed member, derived from activity, source and the unchanged-activity clock against a supplied `now`. A degraded deciding source still yields `unknown` — a source that failed cannot support a claim of running at all.
    2. Separate the two orders the one strength array currently serves: exact presented state, which the collapsed pill groups by and which must include the unconfirmed member, and aggregate rank, where confirmed and unconfirmed running share the running rank and the confirmed one wins.
    3. Thread the new clock argument through every existing caller in the same task — `src/webview/worktree/WorktreeView.ts` and `src/webview/worktree/WorktreeRemoveDialog.ts` — so the wave compiles on its own.
    4. Add the state's rule to `src/webview/worktree/worktreePanel.css` here too: the shape guard is keyed by the presented vocabulary, so a member with no rule does not compile. The rule only has to exist and be distinct; 1_2 owns whether it reads right, and owns the labels and hints.

- [x] 1_2 Give the unconfirmed claim a static shape and a hint that cannot go stale — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{strongest-state-wins-and-shape-carries-it, a-claim-that-outlived-its-evidence-says-how-long-and-on-what}
  - **Acceptance**:
    - Outcome: an unconfirmed row renders static and says how long and on what evidence
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Settle the unconfirmed shape in `src/webview/worktree/worktreePanel.css` — static, and distinct from both the animated running shape and every other state once motion is removed (1_1 added the rule so the guard would compile).
    2. In `src/webview/worktree/worktreeTreeView.ts`, draw it at each state-glyph call site and give it a hint through the delegated tooltip widget. The hint is written into an attribute at render and read at hover, so an exact elapsed figure decays between the two: phrase it as a lower bound that stays true however long it sits unread.
    3. Confirm the shape guard covers the new member rather than merely admitting it — including under reduced motion, where a static unconfirmed shape and a stopped running animation are most at risk of converging.

- [x] 1_3 Repaint the moment a claim crosses, and only then — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-claim-that-outlives-its-evidence-stops-animating-without-being-told, one-reading-of-the-clock-serves-the-whole-cycle, a-push-that-changed-nothing-changes-no-pixels}
  - **Acceptance**:
    - Outcome: a row crossing the ceiling repaints unprompted; a re-derivation that moves nothing does not
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. In `src/webview/worktree/worktreeRenderSignature.ts`, fold each row's derived confidence into the signature so a crossing invalidates the guard and a re-derivation without one does not.
    2. In `src/webview/worktree/WorktreeView.ts`, arm one deadline timer at the earliest crossing, re-arm it both on every push and after it fires, and clear it on disposal. No interval, and no timer when no row can cross.
    3. Read the clock once per cycle and use that one reading for the signature, the render and the next deadline, so a row cannot be drawn against one moment and scheduled against another.
    4. Cover the no-crossing case as well as the crossing one, since a guard that always repaints passes the first test and defeats the requirement.

- [x] 1_4 Register the invariant this task owns — verified: pnpm run test:unit && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#an-inferred-running-claim-stops-animating-once-it-outlives-its-evidence
  - **Acceptance**:
    - Outcome: the truthfulness table carries the ceiling invariant with a test that proves it
    - Verify: command pnpm run test:unit
  - **Plan**:
    1. Add the invariant to `docs/DESIGN.md` § 8.4 verbatim and remove its row from the planned-invariants table above § 8.5, since it is no longer planned.
    2. Add the matching row to `src/test/invariants/registry.ts` with this blueprint task as its owner and a covering stimulus, and tag the proving tests so the coverage reporter sees them run — the derivation half in `src/webview/worktree/worktreeFormat.test.ts` and the still-shape half in `src/webview/worktree/WorktreeView.test.ts`, since the invariant claims both.
    3. Verify with the whole suite, not the registry test alone: `src/test/invariants/coverageReporter.ts` skips its enforcement on a filtered run, so a targeted run cannot prove the tagged test executed.
