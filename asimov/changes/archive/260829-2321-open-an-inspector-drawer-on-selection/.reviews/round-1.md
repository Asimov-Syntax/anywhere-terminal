# Review Round 1

- Date: 2026-08-30
- Cycle: 1
- Mode: discovery
- Change: open-an-inspector-drawer-on-selection
- Scope: range `a40956a2..15ed1f40e1283b80e371eab39cd9914aabafc503`
- Head: `15ed1f40e1283b80e371eab39cd9914aabafc503` (reviewed by explicit range; checkout was dirty in unrelated change analytics files)
- Reviewable lines: 1,183
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-frontend` — inspector/controller/view focus, ARIA, Escape, rollout — `opus[1M]`
  - `asm-review-logic` — selection, signatures, roster state, reentrancy — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — accepted D1-D12 and delta-spec obligations — `sonnet[1M]`
  - `asm-review-performance` — hot-path redraw and growth axes — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — action, renderer, activation, roster reuse seams — `gpt-5.6-luna[1M]`
- Support agent: `asm-finder` — full-flow caller and ownership map
- Agents skipped: `asm-review-data-security` — no new host protocol, data store, auth, secret, untrusted input, or persistence boundary
- Verification evidence: `bun run asm change verify-status open-an-inspector-drawer-on-selection` reports all seven tasks verified. The caller also reports type check, 5,268 unit tests, I10 fs-deletion, and Biome restored to the 5 error / 14 warning / 3 info baseline. Review did not rerun project gates.
- Verdict: REJECT
- Counts: 5 BLOCK / 3 WARN / 3 SUGGEST
- Blocking split: 5 feature / 0 machinery

## Findings

### B1

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-frontend
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeInspector.ts:178`
- Title: Agent and subagent focus is lost on every drawer redraw
- Evidence: Redraw restoration resolves only the nearest `data-focus`. The close control and action buttons receive that attribute, but the focusable agent rows created at lines 301-322 and subagent rows created at lines 323-337 never do. A targeted jsdom probe focused `.wt-arow`, changed the selected row title, and observed `document.activeElement === document.body` after `replaceChildren`. The changed tests cover only a focused action button.
- Impact: A presence push, roster arrival, model/title change, or confidence-ceiling tick can throw a keyboard user from an agent or delegation row to the top of the document, violating the accepted focus-survival requirement.
- SuggestedFix: Stamp stable focus keys on every returned agent row and every subagent row, using `rowId` and the existing parent/index subagent key, and cover redraws with each row kind focused.
- Invariant: Focus inside the drawer survives a redraw. Boundaries searched: close control, action buttons, agent rows, subagent rows. Affected: agent and subagent rows. Verified safe: close and action buttons.
- Status: accepted
- Triage: Confirmed at source: `data-focus` is stamped in `header()` and `actionButton()` only, and `renderAgentRow`/`renderSubagentSection` know nothing about it. Every agent row in the drawer is `focusable: true`, so the gap is exactly where the drawer put a tab stop. Fixed by stamping a key on each returned agent and subagent row.

### B2

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:409`
- Title: Closing after a search hides every row leaves focus on body
- Evidence: `focusWorktree()` falls back only to another navigable row. When the search query yields the `noMatch` empty state, `navRows()` is empty and `focusRow(undefined)` is a no-op. A targeted controller probe selected a worktree, applied an unmatched query, focused the drawer close button, closed it, and observed `BODY` with zero treeitems.
- Impact: The explicit accepted scenario says focus returns to the tree when the described row is filtered out. With an all-empty filter it instead leaves the worktree keyboard model entirely.
- SuggestedFix: Make the tree container a valid fallback tab stop while it has no navigable rows, or provide a focusable no-match control/row and direct close restoration there.
- Invariant: Closing from inside the drawer never drops focus to body. Boundaries searched: described row visible, removed with another row available, filtered with another row available, filtered with no rows. Affected: filtered with no rows. Verified safe: visible row and non-empty fallbacks.
- Status: accepted
- Triage: Confirmed: `focusWorktree` ends at `focusRow(target)` and `focusRow` returns early on `undefined`, so the no-match state has no fallback at all. The accepted requirement says focus comes back to the tree, and `<body>` is not the tree. Fixed by making the tree container itself a programmatic fallback stop.

### B3

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-logic
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeInspector.ts:170`
- Title: Launch capability changes never invalidate the drawer action bar
- Evidence: `handleLaunchTargets()` mutates `menuActions.launchAgentHere`/`resumeHere` and calls `push()`, but `draw()` returns when the selected worktree/row signature is unchanged. Action capability is a separate render input and is absent from that signature. A targeted controller probe opened the drawer before the async launch-target reply; “Start an Agent Here…” was absent both before and after a non-empty reply. The reverse transition can leave a stale button whose capability was deleted.
- Impact: The drawer can omit an available core action or retain an unavailable/inert one, contradicting the shared-menu truthfulness contract and the requirement that unsupported actions be absent.
- SuggestedFix: Add an explicit action-capability revision/invalidation input to the inspector and refresh it whenever `syncLaunchActions()` changes the action record; test both absent→present and present→absent transitions while open.
- Invariant: Every offered action reflects current capability. Boundaries searched: missing/main/repo-scoped static gates and dynamic launch capability transitions. Affected: dynamic launch transitions. Verified safe: static builder gates.
- Status: accepted
- Triage: Confirmed: `handleLaunchTargets` mutates the shared `menuActions` record and calls `push()`, but `push()` reaches the drawer only through `setData`, whose guard sees an unchanged worktree and unchanged rows. The capability is not in the signature and cannot be — it is not row data — so the fix is an explicit invalidation, not a wider key.

### B4

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-reuse
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeInspector.ts:316`
- Title: Sessionless window rows become dead clicks under preview activation
- Evidence: The tree's `activationFor()` forces `focus` for a window row without `entryId`, because no preview can open. The inspector independently implements only external-vs-setting logic and therefore emits `preview` when the live setting is preview. `WorktreeController.activateAgent()` then sees no `entryId` and does nothing. A targeted probe confirmed the inspector emits `preview` for a window row with a pane and no session.
- Impact: The same row works in the tree but is inert in the drawer, violating the task's requirement to route activation exactly as the tree does and the proposal's no-inert-affordance rule.
- SuggestedFix: Extract the full activation decision, including the no-entry fallback, into one shared helper used by both surfaces; add the sessionless window-row case with `rowActivation: "preview"`.
- Invariant: Equivalent agent rows activate equivalently across tree and drawer. Boundaries searched: external, window with session, window without session. Affected: window without session under preview setting. Verified safe: external and session-backed rows.
- Status: accepted
- Triage: Confirmed: `WorktreeView.activationFor` returns `focus` for a window row with no `entryId`; the drawer applies `rowActivation()` unconditionally for non-external rows, and `activateAgent` then has neither a pane nor an entry to act on. Two copies of one decision is what D5 was supposed to prevent. Fixed by extracting the whole decision into one exported helper both surfaces call.

### B5

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeRenderSignature.ts:161`
- Title: Unrelated presence degradation rebuilds the scoped drawer
- Evidence: Each agent's `presentedActivity()` already keys only the degradation source that decides that row. `worktreeScopeSignature()` additionally appends the entire global `degradedSources` list, so an unrelated source changes the signature even when no selected row renders differently. A targeted probe used a hook-backed selected row and added only a registry degradation; the same action-button node was replaced.
- Impact: Unrelated presence health violates the accepted same-node guarantee and can amplify B1 by forcing avoidable focus loss. The signature is scoped by tree fields but not by presence degradation relevance.
- SuggestedFix: Remove the raw global degradation suffix and rely on each row's derived `presentedActivity`, or include only degradation entries that affect at least one selected row; add a same-node test for an unrelated source.
- Invariant: Unrelated updates preserve drawer node identity. Boundaries searched: unrelated repo fields/listing health, other-worktree rows, relevant degradation, unrelated degradation. Affected: unrelated degradation. Verified safe: unrelated repo/listing fields and other-worktree rows.
- Status: accepted
- Triage: Confirmed: the drawer renders no degradation notice of its own — `agents()` passes `degraded` only to `presentedActivity`, which already folds the relevant source into each row's key. The raw list suffix therefore moves the guard for changes the drawer cannot draw, which is the exact defect the scoped signature was introduced to remove. Fixed by dropping the suffix.

### W1

- Severity: WARN
- Confidence: MEDIUM
- Priority: P2
- Agent: asm-review-frontend
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeInspector.ts:323`
- Title: Delegation lists are not validly owned by the outer agent list
- Evidence: `.wt-iagents` is `role="list"`; each agent is a `listitem`, but each delegation `role="list"` is appended as a sibling rather than nested in the agent listitem. Pending/failed/empty sections can also contain only a note div and no listitem.
- Impact: Assistive technology can report incorrect item counts or lose the visual association between an agent and its delegation history.
- SuggestedFix: Nest the delegation list inside the owning agent listitem, or represent each agent+history as a labelled group and remove the invalid outer list ownership.
- Status: accepted
- Triage: Confirmed: `.wt-iagents` is `role="list"` and each delegation section is a `role="list"` sibling of an agent `listitem`, which is not a valid child of a list; the empty/pending/failed sections are additionally lists with no `listitem` at all. Fixed by wrapping each history in its own `listitem` and by declaring the list role only when there are rows to list.

### W2

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-performance
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeInspector.ts:138`
- Title: Every hot-path update scans the entire worktree tree before the scoped guard
- Evidence: `setData()` and timer `refresh()` call `draw()`, and `info()` walks every repository and worktree to locate the selected id before the scoped signature can suppress DOM work. The cost grows with total repositories/worktrees, not just the selected worktree's bounded live rows.
- Impact: Every presence push pays O(total worktrees) lookup work while the drawer is open, despite the selected-scope hot-path goal.
- SuggestedFix: Maintain an id-indexed lookup with the envelope/controller, or pass the selected `WorktreeInfo` directly so preparation is proportional to the selected worktree and its rows.
- Status: rejected
- Triage: The walk is O(worktrees in the workspace) — tens, not a growth axis — with no allocation, and it runs once per push. The same push already builds a signature over every drawn row and every degradation, which dominates it. An id-indexed map is a second structure to rebuild or invalidate on every envelope, which is more work per push than the scan it replaces and one more thing that can go stale. `asimov/project.md` § Data-scale defaults asks for bounds on collections that grow per user or per unit time; a workspace's worktree list is neither.

### W3

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeRosterRequests.ts:51`
- Title: A throwing roster send permanently suppresses every unsent queued row
- Evidence: `flush()` swaps all pending rows out before iterating. If one `send()` throws, the failed and remaining rows are no longer pending but remain in `asked`, so later `want()` calls cannot retry them. Batching makes this affect rows whose callbacks were never attempted.
- Impact: Several agent histories can remain on “Reading…” forever after one callback failure.
- SuggestedFix: On failure, restore the failed and remaining entries to pending or clear their asked keys before rethrowing; add a multi-row throwing-callback test.
- Status: accepted
- Triage: Confirmed: `flush` swaps `pending` out before the first `send`, and `want` has already written every key into `asked`, so a throwing callback strands the rows behind it on "Reading…" permanently. Fixed by returning the unsent rows to `pending` before the throw propagates.

### S1

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-logic; downgraded by chair because the host rejects stale expected-entry tokens
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeRosterRequests.ts:53`
- Title: Reentrant reconciliation cannot cancel a row already captured by flush
- Evidence: `flush()` iterates a local snapshot. A synchronous first send can cause reconciliation to delete a later key from `asked`, but the outer loop still sends that stale row. Host `requestDelegations()` safely rejects a stale row/session token, limiting the current impact to obsolete duplicate work.
- Impact: The helper's stated reentrancy property is incomplete and can emit avoidable stale requests.
- SuggestedFix: Iterate key/row entries and check the key is still asked immediately before each send.
- Status: rejected
- Triage: The window's own `reconcile` runs from the tree render, not from a roster answer, so the interleaving described needs a host that answers synchronously AND drops the row in the same turn. The chair's own downgrade note carries the reason it is harmless when it does happen: the host rejects a stale row/session token. Adding a liveness check inside `flush` would require the helper to hold a second copy of what is live, which is the coupling `reconcile` exists to avoid.

### S2

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse; downgraded by chair because no current behavior differs
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:492`
- Title: Tree and inspector duplicate the roster protocol adapter
- Evidence: The callbacks at lines 456-460 and 492-496 repeat the same entry guard and `requestWorktreeSubagents` message construction.
- Impact: A later protocol or eligibility change can update one surface while the shared request set still sends through two differing adapters.
- SuggestedFix: Pass one private `requestSubagents(row)` controller method to both surfaces.
- Status: accepted
- Triage: Two copies of the same entry guard and message shape. Routed through one private controller method.

### S3

- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P5
- Agent: asm-review-contracts
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeInspector.ts:90`
- Title: `openOn()` expands the documented interface without a caller
- Evidence: The public getter is absent from design.md's accepted interface block and has no production or test caller.
- Impact: It adds an unnecessary public seam to a class whose state ownership was explicitly constrained.
- SuggestedFix: Remove it, or document it only when a real caller is introduced.
- Status: accepted
- Triage: `openOn()` has no caller. Removed.

## Accepted risk

### AR1

- Status: risk-accepted
- Granted by: user review brief and accepted design D9 Risk Map
- Risk: The capture-phase `SubagentPreviewPopup` is already closed before the drawer's bubble listener checks `overlayOpen`, so one Escape can dismiss both popup and drawer.
- Owner: future cross-webview overlay/Escape ownership change
- Expiry: none stated
- Reactivation trigger: any change to capture-phase preview dismissal, the `overlayOpen` protocol, or controller Escape ownership

## Audit backlog

None.
