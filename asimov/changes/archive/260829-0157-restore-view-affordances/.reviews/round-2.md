# Review Round 2: restore-view-affordances

**Date**: 2026-08-29
**Cycle**: 1
**Mode**: verification
**Scope**: commit `03501c1cd5c07bc708b6e574884be3d11b78626b` only, interpreted through the `restore-view-affordances` change context and round-1 gate set
**Head**: `03501c1cd5c07bc708b6e574884be3d11b78626b`
**Tree state**: dirty outside the explicit commit (`docs/ui/worktree.html`, `skills-lock.json`, analytics/audit additions); excluded from review
**Reviewable lines**: 30 added/deleted lines across remediation production and build-state files
**Agents spawned**: logic — delegated tooltip lifecycle impact cone — `gpt-5.6-terra[1M]`; frontend — focus ownership and nested hint rendering — `sonnet[1M]`
**Agents skipped**: contracts — accepted obligations were directly verified by the frontend and chair against the two focus-owner boundaries; reuse — no helper boundary changed beyond the accepted handler remediation; data-security/performance — no intersecting cone
**Verdict**: **APPROVE**
**Counts**: 0 BLOCK, 0 WARN, 0 SUGGEST

## Scope lock and verification evidence

- Scope lock passed. Commit `03501c1c` is parented directly on round 1's recorded Head `688ef45426afcdee46caa55f5d0e259724931fd9` and contains only B1/W1/S1 remediation, additive tests, task 4_1 metadata, and the committed round-1 artifact. It adds no capability, changed contract, or new invariant owner.
- Gate 2 remains approved. Round-1 triage accepted all three findings, narrowed B1's absent-hint boundaries to `.vault-row` and `.wt-arow`, and granted no risk acceptance.
- `bun run asm change verify-status restore-view-affordances` reports task 4_1 `[x]`, exit 0, with additive focus-owner, same-owner transition, and press-to-hide tests. The chair ran no project type-check, lint, or test command.
- Impact cone traced at both delegate consumers: `VaultPanel.listEl` and `WorktreeView.element`; focus owners and their nearest nested hint owners; same-owner, nested-owner, distinct-owner, outside-container, focus, pointer, press, replacement, and disposal paths.
- The coordinator's statement that round 1 recorded Head `1f3abc7d` was stale; the persisted source of truth records `688ef454`, which is also the exact parent of this fix commit.

## Prior findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair` (verified by `asm-review-frontend` and `asm-review-logic`)
- **Class**: feature
- **File:line**: `src/webview/vault/vaultListView.ts:95-116`; `src/webview/worktree/worktreeTreeView.ts:363-408`
- **Title**: Keyboard focus cannot present the migrated abbreviated row content
- **Evidence**: `.vault-row` now owns a nonempty composed hint built from the displayed title fallback plus cwd, and `.wt-arow` now owns a nonempty composed hint built from `agentRowTitle()` plus preview. `agentRowTitle()` structurally falls back to `(untitled)`. The delegate's self-first `closest()` resolution means focus on the row gets the row hint while pointer hover on title, cwd, icon, preview, confidence, or model keeps the nearer descendant hint. Empty vault descendant hints remain guarded.
- **Impact**: The two confirmed absent-hint focus boundaries now present their full content through the shared widget and `aria-describedby` path.
- **SuggestedFix**: Completed as accepted; retain the focus-on-real-row integration tests.
- **Status**: fixed
- **Triage**: Fixed in `03501c1c`. The author's round-1 narrowing is sustained: primary worktree and subagent rows were not absent-hint boundaries and required no remediation under B1.
- **Invariant inventory**: Focus-owner boundaries searched: vault session row, vault resume control, vault group header, primary worktree row, worktree agent row, worktree subagent row, and nested title/cwd/icon/preview/model/confidence owners. Verified safe after fix: every focus owner resolves a nonempty hint; nearer pointer-specific descendants continue to shadow only on pointer entry.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic` (verified by chair and `asm-review-frontend`)
- **Class**: feature
- **File:line**: `src/webview/ui/Tooltip.ts:234-246`
- **Title**: Internal pointer moves hide and re-delay the same delegated tooltip
- **Evidence**: `onOut` now resolves `relatedTarget` through the same `hintFor()` function and keeps the current tooltip only when both event endpoints map to the exact same hint owner. Moving into a nested owner, another row, a bare container descendant, or outside the container still leaves/switches normally. The fix is independent of subtree depth and therefore covers both shallow vault rows and deeply composed worktree rows.
- **Impact**: Ordinary movement inside one hinted row no longer hides the widget or restarts its delay, while transitions between distinct hints remain correct.
- **SuggestedFix**: Completed as accepted; retain the same-owner parent-to-child transition test.
- **Status**: fixed
- **Triage**: Fixed in `03501c1c`; no persistence in either delegated consumer's impact cone.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: `asm-review-logic` (verified by chair and `asm-review-frontend`)
- **Class**: feature
- **File:line**: `src/webview/ui/Tooltip.ts:247-251,266-280`
- **Title**: Delegated tooltips omit the existing widget's press-to-hide behavior
- **Evidence**: The delegate now registers and disposes a `mousedown` handler that calls the shared `leave()` path for a press on a hinted target, clearing timer, current target, widget visibility, and this delegate's described owner. The focused test shows the active tooltip before press and absence immediately after.
- **Impact**: A tooltip no longer remains over UI opened by activation or context-menu interaction.
- **SuggestedFix**: Completed as accepted; retain the press-to-hide test.
- **Status**: fixed
- **Triage**: Fixed in `03501c1c`. One logic specialist proposed requiring the pressed owner to equal `currentTarget`; rejected because no accepted invariant requires retaining the singleton tooltip when the user presses another hinted target, and the proposed impact was speculative rather than a demonstrated broken user path.

## Specialist adjudication notes

- Both specialists agreed B1 and W1 are fixed across both call sites and that nearest descendant hints continue to win correctly.
- The frontend specialist found S1 fixed and no new finding.
- The logic specialist's proposed WARN on the broader `mousedown` dismissal was not sustained: dismissing the one global tooltip on a press elsewhere in the delegated surface is valid behavior, normal pointer/focus transitions reconcile the next owner, and no stale visible widget or accepted-contract violation was demonstrated.
- No new finding was found inside the behavioral impact cone. No audit-backlog or accepted-risk entry applies.
