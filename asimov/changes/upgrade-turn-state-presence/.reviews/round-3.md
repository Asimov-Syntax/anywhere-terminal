# Review Round 3: upgrade-turn-state-presence

**Date**: 2026-08-27
**Cycle**: 1
**Mode**: verification
**Scope**: commit `1f3a6de45a99345056125f12da03ff6cd48561e4` only
**Head**: `1f3a6de45a99345056125f12da03ff6cd48561e4`
**Tree state**: dirty at review start (`.analytics-cursor.json`, `analytics.json`); explicit commit scope was unaffected
**Reviewable lines**: 141
**Agents spawned**: logic — bounded overflow and duplicate-event cone — `gpt-5.6-sol[1M]`; frontend — live roster rendering/accessibility cone — `gpt-5.6-terra[1M]`; performance — cache cleanup cone — `sonnet[1M]`
**Agents skipped**: data-security — no data/security boundary remained in this fix cone; contracts — accepted reducer/render contracts were verified by logic/frontend plus chair; reuse — no extraction or duplicated capability was introduced
**Verdict**: **WARN**
**Open counts**: 0 BLOCK, 1 WARN, 1 SUGGEST; 2 round-2 findings fixed

## Scope lock and verification evidence

- Scope lock passed: `1f3a6de` contains remediation for B4, W3, W7, and W8 plus task/review/analytics metadata. It introduces no unrelated capability or changed design/task contract.
- Round-2 author triage accepted all four findings and rebutted none. Each accepted invariant and the author's impact manifest were rechecked.
- `bun run asm change verify-status upgrade-turn-state-presence` reports remediation task 5_2 and every predecessor task at `[x]`, exit 0. The coordinator recorded check-types exit 0, `biome check src/` exit 0 with pre-existing warnings only, and `test:unit` at 4691 passing / 0 failing. No project verification command was run during this review.
- The intermittent `PTY_LOAD_FAILED` assembly-test behavior is outside the remediation cone and no changed production or test file in `1f3a6de` reaches the menu/pty paths named by those cases. It remains a recorded verification caveat, not a finding attributed to this commit.
- This is cycle 1's third and final round. No blocker survives, so the blocker thrash stop is not required. There is no round 4 in this cycle; another user-initiated review would begin cycle 2 in discovery mode.

## Cross-round disposition

| ID | Round-2 severity | Round-3 status | Evidence delta |
|---|---|---|---|
| B4 | BLOCK | fixed | Displayed and overflow children retain ids; stops delete only the named id; unknown/duplicate stops clear nothing; identity overflow becomes sticky and cannot falsely complete |
| W3 | WARN | persists, downgraded to SUGGEST | Visible styling, provenance label, live glyph, and signature behavior are fixed. Only assistive status remains absent, materially narrowing impact and reach |
| W7 | WARN | fixed | Null/rejection cleanup compare-and-deletes the exact promise that installed the current entry; the eviction/replacement race is covered |
| W8 | WARN | persists, narrowed | Duplicate starts for ids retained in the Map/Set publish nothing and preserve prompts. After identity itself overflows, duplicate unseen starts still return true and clear prompts |

## Open findings

### W8

- **ID**: W8
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/agents/claude.ts:386`
- **Title**: Sticky identity overflow still republishes duplicate starts as transitions
- **Evidence**: Once 32 children occupy `roster` and 32 occupy `overflow`, the next unretained id sets `overflowUnknown`. A repeated `SubagentStart` for that same unretained child again reaches the full-overflow branch, writes the already-true flag, and returns `true`. `apply()` then calls `clearPerEvent()`, deleting a waiting row's prompt even though no retained state changed. The new duplicate-start test covers an id retained in `overflow`, not this double-cap-plus-one boundary.
- **Impact**: Duplicate delivery remains non-idempotent after identity itself overflows and can strip an active question from a row that remains waiting. B4's activity/completion invariant is safe because the sticky flag cannot be cleared.
- **SuggestedFix**: In the full-overflow branch, return `true` only for the transition from `overflowUnknown === false` to `true`; once it is already true, return `false`. Add a double-cap-plus-one waiting-prompt test that repeats the unretained child's start.
- **Status**: persists from round 2, narrowed
- **Triage**: accepted

### W3

- **ID**: W3
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-frontend` (corroborated by chair)
- **File:line**: `src/webview/worktree/worktreeTreeView.ts:499`
- **Title**: Running delegated work still has no accessible status
- **Evidence**: The visible label, rail, color, and live glyph are now distinct and empty reported rosters use current vocabulary. The glyph remains `aria-hidden`, while the `treeitem` receives only `data-live="true"`; neither its accessible name nor a described status includes “running.”
- **Impact**: Screen-reader users hear the delegated task text but cannot distinguish current running work from completed transcript history. Visual users now receive the intended distinction, which narrows the round-2 impact enough to downgrade severity.
- **SuggestedFix**: Give running subagent rows an accessible name or description containing the task and “running,” and add a focused DOM assertion.
- **Status**: persists from round 2, downgraded with evidence delta
- **Triage**: accepted

## Fixed findings

### B4
- **Status**: fixed
- **Evidence**: The bounded representation retains up to 32 displayed ids and 32 overflow ids plus a sticky unknown flag. Known stops settle only their own id; unknown and repeated stops are no-ops; repeated starts for retained overflow ids are no-ops; SessionStart resets every container. At identity overflow, the flag can over-report working until boundary/staleness but cannot falsely complete, matching the conservative bounded fix round 2 requested.
- **Invariant inventory**: Any reported working child holds a done lead open. Boundaries verified safe: below-cap membership, displayed→overflow boundary, duplicate displayed/overflow starts, duplicate/unknown stops, retained overflow stop, double-cap identity overflow, all later stops while unknown, lead stop, session reset, and structural memory bound. The remaining duplicate-prompt effect after identity overflow is W8, not a completion failure.

### W7
- **Status**: fixed
- **Evidence**: Cleanup captures `settled` and deletes only when the map still holds that exact promise. Null and rejection preserve retry behavior; an evicted P1 settling after P2 cannot remove P2; the cache remains capped at 128.
