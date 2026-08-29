# Review Round 2

- Date: 2026-08-30
- Cycle: 1
- Mode: verification
- Change: open-an-inspector-drawer-on-selection
- Scope: range `15ed1f40e1283b80e371eab39cd9914aabafc503..87398bcade692d65df85ca8e5d10c5c1317fe19c`
- Head: `87398bcade692d65df85ca8e5d10c5c1317fe19c` (reviewed by explicit range; checkout dirty only in unrelated change analytics files)
- Scope lock: passed — one remediation commit, tests, review/build metadata, and one extraction of the already-owned activation decision; no new capability, contract, design delta, or invariant owner
- Reviewable lines: 179
- Agents spawned:
  - `asm-review-frontend` — B1/B2/W1 focus, keyboard, ARIA impact cone — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — B3/B4/W3/S1 state, error, and reentrancy cone — `sonnet[1M]`
  - `asm-review-performance` — B5/W2/S1 hot-path and rebuttal adjudication — `gpt-5.6-luna[1M]`
- Agents skipped: data-security, contracts, reuse — the fix cone introduced no host/data/auth/schema contract, and the accepted extraction/adapter removals were directly verifiable in the focused lenses
- Verification evidence: `bun run asm change verify-status open-an-inspector-drawer-on-selection` exits 0 with all eight tasks verified. Caller reports type check clean, 5,281/5,281 unit tests, I10 gate passing, and Biome restored to the recorded 5 error / 14 warning / 3 info baseline. Review did not rerun project gates.
- Verdict: BLOCK
- Counts: 1 BLOCK / 2 WARN / 0 SUGGEST

## Prior finding disposition

| ID | Severity | Status | Verification |
|---|---|---|---|
| B1 | BLOCK | fixed | Namespaced focus keys restore close/action/agent/subagent; targeted probes restored both row kinds |
| B2 | BLOCK | fixed | Inspector close with no navigable rows focuses the programmatic `.wt-tree` stop; broader redraw cone has new B6 |
| B3 | BLOCK | fixed | Explicit invalidation updates launch action on both capability edges; controller probe passed |
| B4 | BLOCK | fixed | One shared three-clause activation helper; external/sessionless/session-backed probes passed |
| B5 | BLOCK | fixed | Raw degradation suffix removed; relevant source moves the key and unrelated source does not |
| W1 | WARN | persists | Direct-child validity is fixed, but agent and history remain separate peer items in the outer Agents list |
| W2 | WARN | rejected | Rebuttal sustained: finite workspace collection, no time/history growth, and an index adds equivalent envelope maintenance |
| W3 | WARN | fixed | `RosterRequests.flush` now restores untried rows and makes the failed key askable; caller-level retry gap is new W4 |
| S1 | SUGGEST | rejected | Rebuttal sustained: production bridge is asynchronous and host stale-token validation bounds artificial interleavings |
| S2 | SUGGEST | fixed | One controller roster request adapter serves both surfaces |
| S3 | SUGGEST | fixed | Unused `openOn()` removed |

## Findings

### B6

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-frontend
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:862`
- Title: An ordinary tree redraw that becomes empty still drops focus to body
- Evidence: B2 made the tree container focusable and uses it from `focusWorktree()`, which fixes the inspector-close boundary. General `render()` restoration still focuses only a resolved navigation row and uses optional chaining. If a focused row is detached and the new render has no navigation rows, the call does nothing; early skeleton/no-folder/no-repo paths return before restoration as well. A targeted controller probe focused a worktree row, applied an all-empty query, and observed `document.activeElement === document.body`. The remediation impact manifest explicitly included focused-row removal/filter/collapse boundaries, but the fix diff does not change this restoration path.
- Impact: Host pushes or view changes that empty the rendered tree can eject keyboard focus from the worktree region even though the new programmatic tree fallback now exists. The broader focus-survival obligation remains incomplete.
- SuggestedFix: When `restoreFocusTo` was held and no row resolves after `syncRovingTabindex`, focus `this.element`; route early empty-state returns through the same restoration decision. Add focused-tree redraw cases for an empty query result and a transition to an empty tree, while retaining the existing non-empty roving fallback cases.
- Invariant: A redraw that began with focus inside the tree leaves focus inside the tree. Boundaries verified safe: saved row survives; saved row leaves while another navigation row remains; inspector close with no rows. Affected: render becomes empty and early empty-state renders.
- Status: accepted
- Triage: Confirmed at source: `render` restores through `rows.find(...)?.focus()`, which is a no-op when the render left no rows, and the four empty-state exits in `renderListing` return `undefined` so restoration is skipped entirely. B2 rescued the inspector's close path and left the tree's own path — the wider cone the manifest named — still landing on `<body>`. Fixed by computing "focus was inside" once in `render`, handing it to `renderListing`, and focusing the tree's programmatic stop on every path that ends with no row to return to.

### W1

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-frontend, chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeInspector.ts:358`
- Title: Delegation history is still a peer agent item rather than owned by its agent
- Evidence: The structural invalidity is removed, but the outer `role="list"` labelled “Agents in …” now contains two sibling `role="listitem"` elements per agent: the agent row, followed by an unlabelled history wrapper. A targeted DOM trace for one agent produced two outer items: `Agent A` and `Past delegations … reviewer`. No ARIA relationship identifies the latter as the first item's history.
- Impact: Assistive technology can announce twice the true agent count and cannot reliably associate a delegation history with its owner. The accepted W1 impact is only structurally, not semantically, repaired.
- SuggestedFix: Use one outer listitem per agent and place both the focusable agent row and its nested delegation section inside it; label the nested history from the owning agent. Adjust the inner row role as needed so the outer Agents list counts agents, not histories.
- Status: accepted
- Triage: Sustained and correct: the round-1 fix bought valid direct-child roles at the price of two listitems per agent, so the list now overstates the agent count and the history is a peer of the row it belongs to. Fixed properly — one `listitem` per agent holding both, and the history is a labelled `group` naming its agent rather than a second list.

### W4

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-logic
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeInspector.ts:207`
- Title: A throwing roster send leaves restored requests stranded behind the inspector guard
- Evidence: `RosterRequests.flush` correctly restores untried rows and clears the failed key, fixing W3 inside the helper. `WorktreeInspector.draw()` commits `this.signature = next` before calling the potentially throwing `flush()` at line 240. If it throws, identical `setData()` and `refresh()` calls return at the signature guard before `agents()` can re-want the failed row or `flush()` can send restored pending rows. A targeted probe with rows a/b/c, a callback throwing on a, then identical `setData` and `refresh`, recorded only `calls=["a"]`.
- Impact: In a quiescent drawer, the failed row and every untried row can still remain on “Reading…” indefinitely; the helper's recovery state is unreachable until selected-worktree data changes for another reason.
- SuggestedFix: Do not commit the drawer signature until roster dispatch completes, or invalidate it when `flush` throws so the next push retries. Add an inspector-level throwing-callback test rather than testing the helper alone. Verify the shared tree caller has an equivalent retry path when its render guard was committed before dispatch.
- Invariant: A failed roster dispatch does not make owed requests unreachable from either surface. Boundaries verified safe: helper non-throwing reentrancy, helper failure at first/middle positions, later explicit `want`. Affected: surface render guard after a throw.
- Status: accepted
- Triage: Confirmed: `draw` assigns `this.signature` before `flush`, so a throwing send leaves the drawer believing the DOM matches data whose requests never went out — `RosterRequests` correctly re-queues them and nothing ever asks again. Fixed by dropping the signature when dispatch throws, which is the same invalidation B3 introduced.

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
