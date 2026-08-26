# Review Round 1

- resume: a37f214138c522ac0 — round-1 chair; re-review resumes this id so round-1 context stays intact

- Date: 2026-08-26
- Scope: working tree
- Reviewable lines: 1247 (99 implementation; 1148 generated workflow JSON)
- Large change: yes — accuracy may decrease; generated workflow JSON accounts for most counted lines
- Agents spawned:
  - asm-review-logic — host display state machine — gpt-5.6-sol[1M]
  - asm-review-contracts — provider attachment contract — gpt-5.6-terra[1M]
  - asm-review-frontend — render coverage proof — sonnet[1M]
  - asm-review-performance — render delivery hot path — gpt-5.6-terra[1M]
- Agents skipped:
  - asm-review-data-security — no runtime data/auth/input boundary change
  - asm-review-reuse — no material reimplementation or split candidate
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 1 | SUGGEST 0

## Findings

### B1

- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeRenderSignature.test.ts:167
- title: Routing fields are wrongly excluded from the render key
- evidence: `WorktreeView.setData` stores new data but returns without rebuilding DOM when the signature is unchanged (`WorktreeView.ts:171-178`). Existing agent/subagent DOM listeners close over the row objects supplied during the prior render (`WorktreeView.ts:536-552`, `worktreeTreeView.ts:411`, `worktreeTreeView.ts:474`). The new allow-list skips `WorktreeAgentRow.viewId` and `WorktreeSubagentRow.entryId`. Independent scratch reproductions changed only each excluded field, called `setData`, then clicked the existing row; callbacks observed the old `viewId` and old subagent `entryId`. This refutes the claim that these fields are irrelevant merely because no text renderer reads them.
- impact: When presence wiring/actions use these routing fields, a no-op render can focus the old surface or resolve the old subagent/session after the wire data changed—the exact stale-data failure the coverage proof is intended to prevent.
- suggestedFix: Key every field captured by DOM interaction callbacks, including `WorktreeAgentRow.viewId` and `WorktreeSubagentRow.entryId`, or change callbacks to resolve the latest row from `this.data` by stable identity instead of closing over old wire objects. Add interaction tests that update only each routing field before activation.
- status: fixed (task 4_1)
- triage: Accepted, but on narrower grounds than the finding states. The mechanism is real and I confirmed it — listeners do close over row objects, so a no-op render leaves stale wire values reachable at interaction time. The consequence is not: no code path reads either field today. WorktreeContextMenu.ts:97 reads the AGENT row's entryId, which is already keyed; the other entryId hits in main.ts / TerminalFactory.ts / SubagentPreviewPopup.ts are the terminal subagent-preview subsystem taking entryId off a message, not off a WorktreeSubagentRow. viewId has zero readers under src/webview/. So this is not a live defect and the finding's evidence overstates it. It is still a must-fix, because the allow-list is a trap aimed squarely at the work this test exists to protect: WT-004.1 focuses a pane (viewId) and WT-004.3 adds the subagent lazy read on expansion (entryId), and both would then be stale with the test still green. Taking the cheaper of the two suggested fixes: key both fields and delete the two allow-list entries. Resolving rows by identity is the better long-term shape but is a refactor of the interaction layer this change does not own.

### B2

- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-frontend + asm-review-performance
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeRenderSignature.test.ts:158
- title: The structural walk does not cover nested unreadable fields
- evidence: `FULL_TREE.unreadable` is an inline `{ count, reasons }` object without its own coverage entry. `perturb()` changes only `Object.entries(value)[0]`, so the WorktreeTree case always mutates `count` and never independently mutates `reasons`. A scratch mutation added optional `unreadable.detail` to the wire type while leaving the signature unchanged; both `tsc --noEmit` and the coverage suite passed. Likewise, removing `reasons` from the key would stay masked by the simultaneous `count` change. This violates approved D5's explicit nested-shape obligation.
- impact: A rendered nested field can be added to the wire type or dropped from the signature without failing the build, allowing stale notices despite the claimed construction proof.
- suggestedFix: Model the unreadable shape as a named type and add a dedicated Required fixture/coverage entry, or recursively walk every nested object's keys so each leaf is perturbed independently. Add the survived mutation as a regression test.
- status: fixed (task 4_1)
- triage: Confirmed by reading my own walk: perturb() takes entries[0] only, so for `unreadable` it moves `count` and never `reasons` independently. That is a genuine hole in the proof D5 is supposed to give, and it sits in the one shape whose fields are inline rather than named — exactly where it is least visible. Fixing by giving the nested shape its own Required fixture and coverage entry, which matches the existing structure rather than adding recursion.

### W1

- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:148
- title: Display rise is consumed before delivery succeeds
- evidence: `reconcileShowing` sets `state.showing = true` before `postTo`. `postTo` can skip when `surface.isReady()` is false or catch a thrown `surface.post()`. Either path records the rising edge as handled, so a later repeated `setDisplayed(true)` returns early and the display edge has no request behind it to repair delivery.
- impact: A re-shown surface can miss the required cache delivery and remain stale until an unrelated rebuild or explicit request.
- suggestedFix: Record display-edge service only after a successful post, or retain a pending-delivery state and retry when readiness changes. Add not-ready and throwing-post re-show tests.
- status: fixed (task 4_1)
- triage: Real and reachable. `state.showing` is assigned before postTo, and postTo returns silently when the surface is not ready and swallows a throwing post, so a consumed edge can leave a re-shown surface stale with no retry — a repeated setDisplayed(true) returns early on the dedup. Accepting as should-fix rather than deferring: the whole point of D3 is that the moment the user can see the panel again is the moment it is current, and this is the one path where that silently does not happen. Fix: postTo reports whether it delivered, and the rising edge is recorded only when delivery happened or none was owed (the serveOnRise-false and not-yet-built paths).

## Verification

- `pnpm run check-types`: passed
- Focused changed suites: 5 files, 65 tests passed
- `pnpm run test:unit`: 181 files, 3347 tests passed
- No changed tests contain `.only` or `.skip`
- Independent allow-list audit: `pid` is unused by current rendering/interactions; `live` is currently the literal `false`; `viewId` and subagent `entryId` are not safe exclusions because DOM callbacks retain old row objects
