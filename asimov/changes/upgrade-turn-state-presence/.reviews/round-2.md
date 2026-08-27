# Review Round 2: upgrade-turn-state-presence

**Date**: 2026-08-27
**Cycle**: 1
**Mode**: verification
**Scope**: commit `7c0126c5b055b888d492a72087b85d87c7afe803` only
**Head**: `7c0126c5b055b888d492a72087b85d87c7afe803`
**Tree state**: clean at review start; explicit commit scope
**Reviewable lines**: 323
**Agents spawned**: logic — reducer/expiry/boundary cone — `gpt-5.6-sol[1M]`; performance — identity/cache/order cone — `gpt-5.6-terra[1M]`; frontend — prompt/roster/render cone — `sonnet[1M]`
**Agents skipped**: data-security — B2 path boundary was covered in the performance identity cone; contracts — prompt and roster contracts were covered in the frontend cone and chair pass; reuse — no extraction or duplicated capability was introduced by the remediation
**Verdict**: **BLOCK**
**Open counts**: 1 BLOCK, 3 WARN, 0 SUGGEST; 10 round-1 findings fixed

## Scope lock and verification evidence

- Scope lock passed: `7c0126c` contains remediation for all twelve accepted round-1 findings plus task/review/analytics metadata. It introduces no new capability or semantically changed design/task contract.
- Round-1 author triage accepted all 12 findings and rebutted none. Each accepted finding and its behavioral impact cone was rechecked.
- `bun run asm change verify-status upgrade-turn-state-presence` reports remediation task 5_1 and all predecessor tasks at `[x]`, exit 0. The coordinator recorded `pnpm run check-types` exit 0, `biome check src/` exit 0 with pre-existing warnings only, and `pnpm run test:unit` at 4685 passing / 0 failing. No project verification command was run during this review.
- The author-provided rejection-cleanup reasoning is partly correct: attaching `.then(success, failure)` handles the rejection while the original awaited promise still rejects. Cleanup is not safe against an older evicted promise settling after a newer promise has been installed for the same key; that is W7.

## Cross-round disposition

| ID | Severity | Round-2 status | Evidence delta |
|---|---|---|---|
| B1 | BLOCK | fixed | The undeclared `this.seen` assignment is removed; recorded type check now exits 0 |
| B2 | BLOCK | fixed | Reported and vault-owned transcript paths are normalized and compared; mismatch falls back without opening the report's path |
| B3 | BLOCK | fixed for cached-lead invariant | `SubagentStart` no longer mutates `lead`; child-only start/stop returns to done. A distinct duplicate-prompt mutation is W8 |
| B4 | BLOCK | persists | The new scalar overflow counter loses child identity: duplicate/unknown stops can consume another child, and duplicate overflow starts add phantom work |
| B5 | BLOCK | fixed | `sessionBoundary` reaches `stamp`; only boundary running/waiting→idle transitions suppress `finishedAt`, while ordinary done still stamps it |
| B6 | BLOCK | fixed for original growth/miss invariant | Cache size is capped at 128 and misses/rejections are removed. Stale cleanup can evict a newer same-key entry, recorded as W7 |
| W1 | WARN | fixed | A fresh empty report produces `{kind:"ok", reported:true, rows:[]}`, so WorktreeHost no longer reattaches transcript history |
| W2 | WARN | fixed | Question/header content and bounded permission summaries populate the documented prompt shapes |
| W3 | WARN | persists, narrowed | Signature and section label now distinguish provenance, but live rows still use the unchanged history rail/colors/outcome styling and no accessible live state |
| W4 | WARN | fixed | Empty required session and child ids are rejected/ignored |
| W5 | WARN | fixed | Reported identity resolves first; inference runs only after absent/null/mismatched hook identity |
| W6 | WARN | fixed | Claude null publication calls `expireTurn`, immediately lapsing authority while retaining identity and cancelling the timer |

## Open findings

### B4

- **ID**: B4
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/agents/claude.ts:344`
- **Title**: Overflow accounting still cannot identify which child started or stopped
- **Evidence**: `droppedWorking` is a scalar. Once it is positive, any `SubagentStop` whose id is absent from the displayed roster decrements it. An unknown stop or a duplicate stop for an already-removed roster child can therefore consume the count for a different displaced child and let the reducer publish `done` while that child still works. The inverse also fails: an overflow child's duplicate `SubagentStart` is absent from the roster and increments the scalar again, so one real stop leaves phantom overflow and the turn stuck `working`.
- **Impact**: The cap now fails in both directions: reordered/duplicate/unknown events can produce false completion or a permanently active turn. This violates the same round-1 invariant that every working child holds completion open and that duplicate delivery is idempotent.
- **SuggestedFix**: Preserve active-child identity across displayed and overflow membership so starts and stops are idempotent per id. If strict internal bounds prohibit remembering every overflow id, use a sticky unknown-overflow state that arbitrary stops cannot clear and reset it only at an authoritative lifecycle boundary.
- **Status**: persists from round 1
- **Triage**: accepted
- **Invariant inventory**: Any reported working child holds a done lead open, and duplicate child events are one lifecycle event. Boundaries rechecked: below-cap ids, cap+1, duplicate overflow start, duplicate retained-child stop, unknown stop while overflow exists, displaced-child stop, lead stop, session reset. Verified safe: below-cap membership, child-only lead restoration, exact displaced-child stop in the new happy-path test. Still affected: duplicate starts, duplicate stops, unknown stops, and reordered delivery once overflow exists.

### W3

- **ID**: W3
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-frontend` (corroborated by chair)
- **File:line**: `src/webview/worktree/worktreeTreeView.ts:448`
- **Title**: Live delegations still use history styling and semantics
- **Evidence**: The renderer adds `wt-hist-live`, but no CSS rule consumes that class. Live rows retain the same muted history rail, description color, opacity, and `wt-outcome--done` class as transcript rows; assistive semantics also remain unchanged. An empty reported roster has no live row, so it is still labelled `Past delegations` and then `No delegations found`, despite being a current reported roster rather than transcript history. The signature and non-empty label halves are fixed.
- **Impact**: Users still cannot visually or accessibly distinguish currently running delegated work from historical work, and an empty current roster is described as a statement about the past.
- **SuggestedFix**: Add actual live-row styling/status semantics using the panel's running vocabulary, choose the section label from reported provenance rather than `rows.some(live)`, and add WorktreeView DOM tests for non-empty and empty reported rosters.
- **Status**: persists from round 1, narrowed
- **Triage**: accepted

### W7

- **ID**: W7
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-performance` (corroborated by chair)
- **File:line**: `src/worktree/presenceDeps.ts:102`
- **Title**: Stale cache cleanup can discard a newer same-session promise
- **Evidence**: If in-flight promise P1 for session S is evicted at the 128-entry cap, a later lookup can install P2 for S. When P1 later resolves null or rejects, its handler unconditionally deletes S, removing P2. The `.then` rejection handler correctly prevents an unhandled rejection and the caller still observes P1's rejection; the defect is that cleanup is not scoped to the promise that installed the current map entry.
- **Impact**: Under concurrent cache churn, a valid newer hit loses deduplication and subsequent 150 ms projections repeat the session-path directory scan. The map remains structurally bounded and identity correctness is preserved.
- **SuggestedFix**: In both cleanup handlers, delete only when `reportedSessions.get(sessionId) === pending`.
- **Status**: new
- **Triage**: untriaged

### W8

- **ID**: W8
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/agents/claude.ts:325`
- **Title**: A duplicate child start can erase the current interactive prompt
- **Evidence**: `SubagentStart` calls `clearPerEvent()` before `upsertChild()` discovers that the child is already active and returns without changing the roster. A delayed duplicate arriving after a PermissionRequest or AskUserQuestion therefore republishes the same waiting state after deleting `interactivePrompt` and `toolName`.
- **Impact**: Duplicate or reordered delivery can leave a row waiting while removing the question or approval context the user must act on, contradicting the reducer's idempotency contract.
- **SuggestedFix**: Detect an already-active child before clearing per-event fields. Have `upsertChild()` return whether a real lifecycle transition occurred and publish nothing for a duplicate.
- **Status**: new
- **Triage**: untriaged

## Fixed findings

### B1
- **Status**: fixed
- **Evidence**: The undeclared assignment is gone and the coordinator's corrected type-check evidence is exit 0.

### B2
- **Status**: fixed
- **Evidence**: Matching normalized paths grant identity; mismatch returns undefined and the sole caller enters heuristic fallback. The reported path remains comparison-only.

### B3
- **Status**: fixed for its round-1 cached-lead invariant
- **Evidence**: Child start no longer promotes `lead`; `effectiveState()` alone overlays working and a child-only stop restores done.

### B5
- **Status**: fixed
- **Evidence**: Boundary and ordinary completion tests prove the suppression is narrow.

### B6
- **Status**: fixed for its original invariant
- **Evidence**: The retained map is capped at 128; null and rejection are not durable cache entries. W7 is a narrower concurrent-cleanup defect, not renewed unbounded growth or permanent absence.

### W1
- **Status**: fixed
- **Evidence**: Empty reported rosters are explicit and engage WorktreeHost's reported guard.

### W2
- **Status**: fixed
- **Evidence**: Prompt fields are structurally bounded and populate the accepted question/approval shapes without retaining options or unrelated tool input.

### W4
- **Status**: fixed
- **Evidence**: Empty session ids reject the payload; empty child ids make no roster claim.

### W5
- **Status**: fixed
- **Evidence**: A resolved matching report skips inference; null and mismatch still execute it.

### W6
- **Status**: fixed
- **Evidence**: Revocation ages the report exactly to the stale boundary, retains identity, cancels the deadline, and announces only a real authority change.

---

## Triage (author, round 2)

All four checked against the code before a status was set.

### B4 — Overflow accounting cannot identify which child started or stopped
**Status:** accepted
**Triage:** Confirmed, and my round-1 fix was the wrong shape rather than an
incomplete one. A scalar cannot answer "which child", so all three of the
reviewer's paths are real: an unknown-id stop decrements it, a duplicate stop for
an already-removed roster child decrements it, and a repeated start for a
displaced child increments it again because the id was never retained. Round 3
keeps identity — a bounded overflow set of ids — and falls back to a sticky
unknown-overflow flag only when that set is itself full, cleared only at a
session boundary. Arbitrary stops can then clear nothing they did not create.

### W3 — Live delegations still carry history styling and semantics
**Status:** accepted
**Triage:** Confirmed. I fixed the signature and the non-empty label and stopped
there, which left the finding half-closed: `wt-hist-live` had no CSS behind it,
so nothing about a live row looked different, and an empty REPORTED roster still
read "Past delegations" because I derived the label from the rows rather than
from provenance. Round 3 derives the label from `reported`, gives the live rail
and status glyph real styling, and adds the DOM tests the reviewer asked for.

### W7 — Stale cache cleanup can discard a newer same-session promise
**Status:** accepted
**Triage:** Confirmed by reading the handler: it captures `sessionId` and deletes
unconditionally, so a settled P1 removes a live P2 installed after P1 was
evicted. Bounded and identity-safe as the reviewer says — the cost is repeated
directory scans on the projection path. Compare-and-delete is the whole fix.

### W8 — A duplicate child start can erase the current interactive prompt
**Status:** accepted
**Triage:** Confirmed. `clearPerEvent()` runs before `upsertChild()` discovers the
child is already tracked, so a delayed duplicate republishes `waiting` with the
question or approval stripped — the row keeps asking while losing what it asked.
An event that changes nothing should publish nothing; round 3 makes the roster
mutation report whether it was a real transition and returns false when it was
not. I am NOT changing what a genuine `SubagentStart` does to the prompt: § 4.4's
"never inherited across events" covers that, and revisiting it is a design
question rather than a fix.

**Summary:** 1 BLOCK accepted, 3 WARN accepted, 0 rebutted. Ten round-1 findings
confirmed closed by the reviewer. This is round 3 of cycle 1 — the last before
the thrash stop — so B4 is being re-fixed by changing the representation rather
than by patching the arithmetic that failed.
