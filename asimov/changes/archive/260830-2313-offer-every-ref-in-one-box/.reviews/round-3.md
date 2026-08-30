# Review round 3 — offer-every-ref-in-one-box

- Date: 2026-08-31
- Cycle: 1
- Mode: verification
- Lane: fastlane
- Head reviewed: `193cd1431ab381c0211c40c3ddec411381b14fb7` (working tree dirty only in another change's analytics; committed fix commit only was reviewed)
- Diff scope: `git show 193cd143`
- Scope lock: passed — the token contract/design amendment directly remediates accepted W2; all other production changes remediate B4, B1, and S3. No non-remediation capability or invariant owner was added.
- Reviewable lines: 73 added/modified across 5 reviewable production files; 160 added/modified test lines reviewed inline; change artifacts and prior review metadata were context/skipped targets
- Verdict: **WARN**
- Counts: 0 BLOCK · 1 WARN · 1 SUGGEST open; 3 round-2 findings fixed; 6 earlier findings remain fixed; 2 audit-backlog entries
- Cycle cap: round 3 of 3

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-contracts | refs request/answer token | wire completeness and opening identity | `opus[1M]` |
| asm-review-frontend | held guard, popup, dismissal | interaction, styling, accessibility | `gpt-5.6-terra[1M]` |
| asm-review-logic | token and dialog lifecycle | races, ordering, state transitions | `sonnet[1M]` |
| chair | full remediation commit | cross-finding flow and test validity | `gpt-5.6-sol[1M]` |

Skipped: data-security, performance, and reuse — the round-3 impact cone adds no new trust, persistence, growth, or capability-reuse question.

Verify gate evidence is the recorded `bun run asm change verify-status offer-every-ref-in-one-box`: task 4_2 is `[x]` with exit 0 and all earlier tasks remain recorded green. The chair ran no project verify command or test suite.

---

## Open findings

### [W4] The token widening makes two cleanup regressions vacuous

- Severity: WARN · Confidence: HIGH · Priority: P3
- Agent: asm-review-contracts + chair
- Class: feature
- File: `src/webview/worktree/WorktreeController.test.ts:1364-1396`
- Status: new · Triage: pending

**Evidence.** `ready()` mounts and delivers a tree but never calls `openCreate()`, so `refsToken` remains `0`. Both changed tests now inject `worktreeRefs` with `token: 1`; `handleRefs()` drops those messages before `repoRefs.set()`.

1. “opening a form drops the previous form's list” starts with an empty map, drops the fixture, opens, then asserts the map is empty. Removing `repoRefs.clear()` from `openCreateForRepo()` would not fail it.
2. “forgets the list for a repository that has left the workspace” also drops the fixture before reconcile. Removing the repo-departure cleanup loop would not fail it.

These are the same assertion-that-cannot-fail class corrected in rounds 1 and 2.

**Impact.** Two accepted regressions — clear stale lists on a new opening and prune departed repositories — have lost their protection. The production token behavior is correct, but future regressions in those cleanup boundaries can pass the suite.

**Fix.** In the clear-on-open case: open once, deliver matching token 1 and assert the map contains the entry, then open again and assert it is cleared. In the departure case: open once, deliver matching token 1 for repo B, assert it is present, then reconcile to a single-repo tree and assert it is removed. The pre-assertions make both tests mutation-capable.

---

### [S3] Popup height still does not derive the space below the input

- Severity: SUGGEST · Confidence: HIGH · Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/worktreePanel.css:1060`
- Status: persists from round 2 · Triage: accepted

**Evidence.** In `max-height`, `100%` resolves against the positioned `.wt-field--combo` containing block, not against the popup's viewport position. `calc(100vh - 100% - 48px)` subtracts the combo field's height and a constant while ignoring the input's actual distance from the viewport top. It therefore remains near `220px` through most short viewports and can still extend beyond the dialog/viewport bottom.

**Impact.** The short-window clipping S3 targeted can still occur. This remains non-gating.

**Fix.** Measure the available height below the input and expose it as a CSS custom property, or use a placement/container design that owns that distance. Keep the list's internal scrolling and minimum usable height.

---

## Fixed round-2 findings

### [B4] Selecting create-new bypasses the held-branch submit guard

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:828-843`; tests `src/webview/worktree/WorktreeCreateDialog.test.ts:1584-1623`
- Status: fixed · Triage: accepted

**Evidence.** `heldBranch()` now matches the typed name against `offeredRefs()` from the current repository, independent of `choice`. The pointer test dispatches the real `mousedown` commit event; the keyboard test reaches and commits create-new after the exact held name. Both would enable/submit against the previous choice-based guard.

**Impact.** Typed, pointer, keyboard, create-new, repository-switch, late-answer, and detached routes now preserve D5's no-request invariant.

**Suggested fix.** None.

### [B1] Active styling still fails after the list scrolls

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:881-884`; `src/webview/worktree/worktreePanel.css:1115-1121`
- Status: fixed · Triage: accepted

**Evidence.** Every active descendant is scrolled with guarded `scrollIntoView({ block: "nearest" })`. Active foreground rules are re-declared after create-new styling, so equal-specificity source order no longer makes the active row illegible.

**Impact.** Keyboard selection stays visible and the active create-new/held states retain selection contrast.

**Suggested fix.** None.

### [W2] Closed/reopened reply ownership is still not enforced

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-logic + asm-review-frontend + chair
- Class: feature
- File: `src/types/messages.ts:1045-1057, 2144-2150`; `src/webview/worktree/WorktreeController.ts:273-286, 698-715, 998-1015`; `src/providers/WorktreeHost.ts:1281-1287`; `src/webview/worktree/WorktreeCreateDialog.ts:370-378`
- Status: fixed · Triage: accepted

**Evidence.** A token is minted once per opening, attached to every repository request, echoed by the host on the requesting surface, and compared before any cache mutation or callback. The stale-token regression proves a predecessor answer cannot seed or render in its successor. Escape and scrim now set `closed` on the actual `onDismiss` path; cancel, submit, and replacement use `disposeAll`.

**Ruling on the untested defensive assignment.** Acceptable. Post-dismiss mutation of the detached DOM is intentionally unobservable, so a DOM assertion would be unable to fail. Code inspection proves every exit sets `closed`; the observable cross-opening ownership invariant has a mutation-capable token test. No generation widening beyond the refs pair is required.

**Impact.** Failed successor reads can no longer leave the predecessor opening's list in the new form, and every closed form's refs applier is inert.

**Suggested fix.** None.

---

## Earlier fixed findings carried forward

### [B2] Current-repository mode is not re-derived on every route
- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Agent: asm-review-frontend + chair · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts`
- Status: fixed · Triage: accepted
- Evidence/impact: current-repository choice derivation remains centralized on all leased routes; no regression in 193cd143.
- Suggested fix: none.

### [B3] Every ref request re-snapshots the entire workspace
- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Agent: asm-review-performance · Class: feature
- File: `src/worktree/WorktreeCache.ts`; `src/providers/WorktreeHost.ts`
- Status: fixed · Triage: accepted
- Evidence/impact: refs still use the scoped single-repository cache read; untouched by 193cd143.
- Suggested fix: none.

### [W1] A repo switch can retain a hold from the previous repository
- Severity: WARN · Confidence: HIGH · Priority: P2 · Agent: asm-review-frontend · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts`
- Status: fixed · Triage: accepted
- Evidence/impact: the held guard reads only the current repository's offered refs; no standing-choice fallback was restored.
- Suggested fix: none.

### [W3] Ref delivery linearly scans the repository list once per repository
- Severity: WARN · Confidence: HIGH · Priority: P3 · Agent: asm-review-performance · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts`
- Status: fixed · Triage: accepted
- Evidence/impact: indexed repository lookup remains unchanged.
- Suggested fix: none.

### [S1] The partial-list notice is not associated with the combobox
- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4 · Agent: asm-review-frontend · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts`
- Status: fixed · Triage: accepted
- Evidence/impact: `aria-describedby` remains present.
- Suggested fix: none.

### [S2] Enter on a held option is a silent no-op
- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4 · Agent: asm-review-frontend · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts`
- Status: fixed · Triage: accepted
- Evidence/impact: keyboard refusal still renders the owning-directory explanation.
- Suggested fix: none.

---

## Audit backlog

- **[A1] Capped full DOM rebuild per keystroke** — `WorktreeCreateDialog.ts:73-85, 838-879` — up to 500 option nodes rebuilt per input; structurally capped and non-gating.
- **[A2] Deferred callbacks retain shipped linear/lifecycle patterns** — `WorktreeCreateDialog.ts` defaults/provisioning callbacks still retain their pre-existing lookup and lifecycle shape; outside the refs-only amendment and non-gating.

---

## Author triage (round 3)

### [W4] The token widening makes two cleanup regressions vacuous

- Status: accepted
- Triage: Confirmed. `ready()` never opens, so `refsToken` stayed 0 and both setup deliveries were dropped on the token before anything was stored — each test then passed on an empty map for a reason it did not name. Fixed by opening first, asserting the entry EXISTS, and only then asserting it is cleared or pruned. Both are now mutation-capable: removing `repoRefs.clear()` fails the first, removing `repoRefs.delete(repoId)` fails the second. This is the third time in this change that a guard was covered by an assertion that could not fail; the pattern is that a test written after a gate was added never checks that its own setup got past the gate.

### [S3] Popup height still does not derive space below the input

- Status: accepted
- Triage: Confirmed, and the round-2 rule was worse than the fixed height it replaced — `calc(100vh - 100% - 48px)` resolves `100%` against the FIELD's height, so it read as a measurement without being one, and the comment claimed something untrue. The element is the only thing that knows its own position, so `openList` publishes `--wt-branch-room` from `getBoundingClientRect()` and the stylesheet consumes it, falling back to the old flat ceiling for any path that never measured. Covered and mutation-proven.
