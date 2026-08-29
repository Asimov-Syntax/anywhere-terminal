# Review Round 3

- Date: 2026-08-30
- Cycle: 1
- Mode: verification
- Change: open-an-inspector-drawer-on-selection
- Scope: range `87398bcade692d65df85ca8e5d10c5c1317fe19c..16f7499c1de10befcbf59f0112918280ee11cf6f`
- Head: `16f7499c1de10befcbf59f0112918280ee11cf6f` (reviewed by explicit range; checkout dirty only in unrelated change analytics files)
- Scope lock: passed — one remediation commit, focused tests, and review/build metadata; no new capability, contract, design delta, or invariant owner
- Reviewable lines: 101
- Agents spawned:
  - `asm-review-frontend` — B6/W1 focus, keyboard, and ARIA impact cone — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — W4 shared roster retry/error impact cone — `sonnet[1M]`
- Agents skipped: data-security, contracts, performance, reuse — the final cone is confined to webview focus/ARIA and one shared dispatch error path
- Verification evidence: `bun run asm change verify-status open-an-inspector-drawer-on-selection` exits 0 with all nine tasks verified. Caller reports type check clean, 5,287/5,287 unit tests, I10 gate passing, and Biome at the recorded 5 error / 14 warning / 3 info baseline. Review did not rerun project gates.
- Verdict: WARN
- Counts: 0 BLOCK / 1 WARN / 0 SUGGEST
- Cycle note: round 3 is cycle 1's final round. Any further code remediation is reviewed in a new user-initiated cycle 2 discovery round.

## Prior finding disposition

| ID | Severity | Status | Verification |
|---|---|---|---|
| B1 | BLOCK | fixed | Namespaced drawer focus keys remain intact |
| B2 | BLOCK | fixed | Inspector-close fallback remains intact |
| B3 | BLOCK | fixed | Capability invalidation remains intact |
| B4 | BLOCK | fixed | Shared activation decision remains intact |
| B5 | BLOCK | fixed | Scoped degradation key remains intact |
| B6 | BLOCK | fixed | Ordinary, empty, and early-return tree renders restore inside focus and never steal outside focus |
| W1 | WARN | fixed | One outer listitem per agent owns a keyboard-operable button row and labelled history group |
| W2 | WARN | rejected | Round-2 rebuttal remains sustained |
| W3 | WARN | fixed | Helper-level throw recovery remains intact |
| W4 | WARN | persists | Inspector retry fixed; equivalent WorktreeView render-signature boundary remains open |
| S1 | SUGGEST | rejected | Round-2 rebuttal remains sustained |
| S2 | SUGGEST | fixed | Shared roster adapter remains intact |
| S3 | SUGGEST | fixed | Unused public seam remains removed |

## Findings

### W4

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-frontend, asm-review-logic
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:363`
- Title: Tree-side roster dispatch still strands retry state and focus behind the render guard
- Evidence: The inspector now catches a throwing `rosters.flush`, clears its signature, and retries successfully on an identical push. `WorktreeView.applyAt()` still commits `this.signature = stateKey` before `render()`. `render()` detaches the focused DOM, then calls `flushRosterRequests()` at line 853 before any B6 restoration path. If the shared callback throws, the exception skips focus restoration and the committed state key makes the next identical `setData()` skip `render()` and `flush()` entirely. A targeted expanded-row probe threw on the first request, retried the identical envelope, and recorded only `calls=["a"]`; the restored pending request was never sent.
- Impact: The same failure W4 identified can still leave tree-surface histories on “Reading…” indefinitely, and a focused tree user is also left on `<body>` on that error path. The inspector boundary is fixed; the sibling caller named by W4's invariant is not.
- SuggestedFix: Apply the inspector's invalidation discipline to `WorktreeView`: if render/roster dispatch throws after the state key was committed, clear the tree signature before rethrowing so an identical push retries. Ensure focus restoration runs on the throwing path, either before dispatch or in a finally that respects `focusWasInside`. Add a tree-level throwing-dispatch test covering both retry and retained focus.
- Invariant: A failed roster dispatch does not make owed requests or held focus unreachable from either surface. Boundaries verified safe: helper recovery, inspector caller retry, normal tree dispatch, ordinary/empty tree focus restoration. Affected: tree caller dispatch failure.
- Status: accepted
- Triage: accepted and fixed in the same cycle. Non-blocking (WARN) and the fix is the pattern already reviewed twice — B3's and the inspector's own W4 invalidation — applied to `applyAt`, so it was auto-fixed under the loop's trivial-WARN rule rather than deferred to a cycle 2. Two mechanisms: `applyAt` drops its signature when `render` throws, and focus restoration moved ahead of `flushRosterRequests` — the only step of a render that reaches the host, therefore the only one that can throw. Both discrimination-checked.

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
