# Review Round 1: restore-view-affordances

**Date**: 2026-08-29
**Cycle**: 1
**Mode**: discovery
**Scope**: explicit range `1f3abc7d..688ef45426afcdee46caa55f5d0e259724931fd9`, interpreted through the `restore-view-affordances` change context
**Head**: `688ef45426afcdee46caa55f5d0e259724931fd9`
**Tree state**: dirty outside the explicit range (`docs/ui/worktree.html`, `skills-lock.json`, analytics/audit additions); excluded from review
**Reviewable lines**: 224 added/deleted lines across reviewable production and build-state files
**Agents spawned**: frontend — tooltip rendering/accessibility — `gpt-5.6-terra[1M]`; logic — delegated event lifecycle — `sonnet[1M]`; contracts — approved UI obligations — `gpt-5.6-luna[1M]`; reuse — shared tooltip extension — `gpt-5.6-luna[1M]`; finder support — construction/focus/disposal flow
**Agents skipped**: data-security — no data/auth/input boundary changed; performance — no persistence, unbounded collection, full-history recompute, or growth-axis hot path changed
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 1 WARN, 1 SUGGEST
**Blocking split**: 1 feature, 0 machinery

## Gate, scope, and verification evidence

- Gate 2 is approved. The task Acceptance fields and `specs/vault-panel/spec.md` / `specs/worktree-panel/spec.md` were treated as obligations.
- `bun run asm change verify-status restore-view-affordances` reports tasks 1_1 through 3_1 at `[x]`, exit 0. No project type-check, lint, or test suite was run during review.
- The explicit range contains the six `restore-view-affordances` implementation commits. Dirty working-tree files and the audit document were outside the range.
- Full-flow trace covered generated webview CSS → `VaultPanel.syncView()` hidden writers; stable list/tree roots → delegated events → singleton tooltip → subtree replacement/observer → webview-lifetime disposal; and discovery `inWorkspace` inputs → pill formatting → row rendering.
- Inline test review found no `.only`/`.skip`, missing async wait, fixture secret, or weakened assertion beyond the documented retargeting. The vault integration test covers hover but not the accepted keyboard-focus path.

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair` (corroborated by `asm-review-contracts` and `asm-review-frontend`)
- **Class**: feature
- **File:line**: `src/webview/vault/vaultListView.ts:50-53,95-102`
- **Title**: Keyboard focus cannot present the migrated abbreviated row content
- **Evidence**: A vault session's keyboard focus owner is `.vault-row` (`tabIndex = 0`), while its full title hint is assigned only to the non-focusable `.vault-row-title` child. `attachTooltipDelegate` handles `focusin` by applying `closest('[data-tip]')` to the focused event target, so focusing the row finds no hint and shows nothing. The added integration test hovers `.vault-row-title`; it never focuses the actual row. The same causal mechanism affects worktree agent rows (`worktreeTreeView.ts:301-320,358-383`) and subagent rows (`:484-524`): focus lands on the row, while abbreviated title/preview/model hints live on descendants; the subagent row's own generic focus-action hint does not expose the full abbreviated title.
- **Impact**: The approved vault-panel requirement explicitly requires a truncated session title to be presented when keyboard focus moves to the row. That accepted behavior is absent, so keyboard users still cannot retrieve the full content this change claims to restore.
- **SuggestedFix**: Put the primary/full content hint on each focus owner as well as any pointer-specific descendant, or make delegated focus resolution intentionally select the row's designated descendant hint. Add integration tests that focus the actual vault session row and affected agent/subagent rows, then assert the full content is presented.
- **Status**: accepted
- **Triage**: Accepted, with one narrowing the author verified in code. Confirmed affected: `.vault-row` (`vaultListView.ts:53`, `tabIndex = 0`, no `data-tip`) and the worktree agent row (`worktreeTreeView.ts:319`, `tabIndex = -1` roving focus, no `data-tip` on the row element). NOT affected, contrary to the evidence line: the worktree **subagent** row does own a `data-tip` (`worktreeTreeView.ts:494`) and the primary worktree row owns its branch/path/lock hint (`:142`), so both already present something on focus — the subagent row's hint is a generic focus-action line rather than its title, which is a content-quality gap, not the absent-hint defect B1 names. Fixing at both confirmed boundaries per the invariant inventory: the hint goes on the focus owner, and `closest()` still lets a nearer descendant hint win on hover.
- **Invariant inventory**: A keyboard-focus owner for abbreviated content must resolve the full content through the delegate. Boundaries searched: vault session rows, vault resume controls, vault group headers, worktree rows, worktree agent rows, worktree subagent rows, and nested title/preview/model elements. Verified safe: vault resume controls and group headers own `data-tip`; primary worktree rows own their branch/path/lock tooltip. Affected: vault session rows, worktree agent rows, and worktree subagent title content.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic` (corroborated by chair and `asm-review-frontend`)
- **Class**: feature
- **File:line**: `src/webview/ui/Tooltip.ts:221-239`
- **Title**: Internal pointer moves hide and re-delay the same delegated tooltip
- **Evidence**: Delegation uses bubbling `mouseover`/`mouseout`, but `onOut` decides only from `event.target`; it never compares `relatedTarget`. Moving from a hinted row to one of its children emits `mouseout` for the row, `hintFor(row) === currentTarget`, and `leave()` clears the tooltip. The following child `mouseover` resolves the same row through `closest()`, but must schedule a new 300 ms delay because `currentTarget` was cleared. The tests hover a descendant directly and do not exercise a parent-to-child transition.
- **Impact**: A tooltip that is already visible disappears during ordinary movement across a composed row and does not return until another dwell delay. Repeated movement across icons, labels, and marks can make the restored hint visibly unstable.
- **SuggestedFix**: Resolve `event.relatedTarget` in the out handler and keep the tooltip when source and destination map to the same hint owner. Add a transition test that shows a parent tooltip, moves into a child of that same hinted element, and asserts it remains visible without restarting the delay.
- **Status**: accepted
- **Triage**: Accepted; reproduced by reading the handler. `onOut` calls `hintFor(ev.target)` and never consults `relatedTarget`, and `leave()` nulls `currentTarget`, so the subsequent child `mouseover` cannot take the `target === currentTarget` early return and pays a fresh 300 ms delay. Composed rows are exactly the shape this change introduces, so the flicker is on the common path. Fixing with the suggested relatedTarget comparison plus the transition test.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: `asm-review-logic`
- **Class**: feature
- **File:line**: `src/webview/ui/Tooltip.ts:254-258`
- **Title**: Delegated tooltips omit the existing widget's press-to-hide behavior
- **Evidence**: `attachTooltip` hides its tooltip on `mousedown`, but `attachTooltipDelegate` registers only over/out, focus in/out, and keydown. A worktree row can remain both hovered and focused while activation or a context menu opens, so no blur, out event, or subtree mutation is guaranteed to clear the widget.
- **Impact**: The tooltip can remain over newly opened UI until the pointer leaves, diverging from the established per-element tooltip behavior.
- **SuggestedFix**: Add a delegated `mousedown` handler that hides when the active target belongs to the container, and cover activation/context-menu behavior with a focused test.
- **Status**: accepted
- **Triage**: Accepted as trivial and auto-fixed. The divergence is real and unintended: the delegate was meant to reuse `attachTooltip`'s behaviour, and press-to-hide was simply missed. One handler plus one test, in the file already being changed for W1.

## Specialist adjudication notes

- `asm-review-reuse` found no duplicate tooltip system or missed repository reuse; the implementation correctly extends the existing singleton widget.
- The frontend specialist independently found the keyboard-focus ownership mismatch and the internal-transition instability. Its additional worktree focus observation was folded into B1's invariant inventory because it has the same owner/descendant causal mechanism.
- The logic specialist's missing-mousedown observation remains a suggestion because the stale overlay depends on an activation path that does not also blur, leave, or rebuild.
- The `[hidden] { display: none !important; }` reset is after imported panel styles and no `hidden="until-found"` usage exists in the webview sources searched. The toolbar visibility flow satisfies the accepted contract.
- The `open` pill is emitted independently for every `inWorkspace` row and its pointer hint states that the worktree is open as a workspace folder; no defect was found in that flow.
