# Review round 2 — offer-every-ref-in-one-box

- Date: 2026-08-31
- Cycle: 1
- Mode: verification
- Lane: fastlane
- Head reviewed: `f289f31f1728a92dd595ea4cb5b145a320b3f105` (working tree dirty in change analytics outside the explicit range; committed range content only was reviewed)
- Diff scope: `git diff 435bb79d..HEAD`
- Scope lock: passed — one remediation commit plus review/task/analytics metadata; no new capability, design obligation, or invariant owner outside the accepted round-1 fixes
- Reviewable lines: 241 added/modified across 4 reviewable production files; 185 added/modified test lines reviewed inline; review/task/analytics files were skipped as review targets
- Verdict: **BLOCK**
- Counts: 1 BLOCK · 2 WARN · 1 SUGGEST open; 6 prior findings fixed; 2 audit-backlog entries

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-frontend | dialog, shell, CSS, interaction tests | B1/B2/W1/W2/W3/S1/S2 impact cone | `opus[1M]` |
| asm-review-logic | derivation + dialog/reply lifecycle | B2/W1/W2 invariant verification | `sonnet[1M]` |
| asm-review-performance | scoped cache read + repo index | B3/W3 growth-axis verification | `gpt-5.6-terra[1M]` |
| chair | complete remediation range | cross-finding full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: contracts, data-security, and reuse — the remediation cone did not change the wire shape, trust boundary, persistence, or capability selection.

Verify gate evidence is the recorded `bun run asm change verify-status offer-every-ref-in-one-box`: task 4_1 is `[x]` with exit 0 and the earlier tasks remain recorded green. The chair ran no project verify command or test suite.

---

## Open findings

### [B4] Selecting create-new bypasses the held-branch submit guard

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:823-831, 937-959`; always-present route `src/webview/worktree/WorktreeCreateDialog.ts:73-84`
- Status: new · Triage: pending

**Invariant.** If the typed name exactly matches a branch held by a worktree in the current repository, no selection route may make that draft submittable.

**Evidence.** `orderChoices` always appends the create-new row, including after an exact held match. Typing that held name first derives `choice = existing(held)`, so the direct typed route is blocked. The user can then commit the create-new row; `commit()` sets `choice = { kind: "new" }` and `draft.branchMode = "new"` without changing the typed name. The remediated `heldBranch()` now returns a holder only when `choice.kind === "existing"`, so both `syncDerived()` and `submit()` see no holder and permit a `fresh` request for the already-held name.

The impact manifest's “`deriveChoice()` is the sole writer” premise is false on this route: explicit `commit()` is intentionally another writer. This also disproves the claimed equivalent mutant. Restoring the old current-list lookup changes behavior here because it finds the held exact ref even while `choice` is `new`.

**Boundary inventory.** Affected: pointer or keyboard commit of create-new after typing an exact held branch. Verified safe: direct typing of a held name; committing the held existing row; late refs while attached/detached; repository switch.

**Impact.** A branch another worktree holds can issue a create request, violating D5, the proposal's Must-not, task 2_2 Acceptance, and the caller's highest-risk invariant. Git may reject the operation later, but the accepted contract is that no request is issued.

**Fix.** Derive the holder independently of the selected mode, from the current repository's exact ref record only: `offeredRefs().find(r => r.name === draft.branchName.trim())?.heldBy`. Do not restore the stale `choice` fallback. Add a regression that types an exact held branch, commits the create-new row by keyboard and pointer, and proves every submit route emits no request.


- Status: accepted
- Triage: Confirmed, and it disproves the equivalence claim I recorded against round-1 W1's mutant. I argued that restoring the current-list lookup in `heldBranch()` could not change behaviour because `deriveChoice()` makes `choice` and the typed name agree. That is true on the typing route and false on this one: committing the create-new row deliberately sets `choice = { kind: "new" }` while leaving the typed name — an exact held branch — in the input. `heldBranch()` then returns `undefined` and `submit()` issues a `fresh` create for a branch another worktree holds, which is exactly what D5 and 2_2's Outcome forbid. The mutation was not unkillable; my test did not walk this route. Fixing by deriving the holder from the CURRENT repository's exact ref match on the typed name, independent of `choice`, and adding pointer and keyboard regressions on the create-new-after-typing route.
---

### [B1] Active styling still fails after the list scrolls

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:810-824`; `src/webview/worktree/worktreePanel.css:1049-1111`
- Status: persists from round 1 · Triage: accepted

**Evidence delta and severity change.** Round 1's complete absence of production styling is fixed: the popup, options, active state, held state, badge, and detached toggle now have scoped selectors. The remaining reach is narrower, so BLOCK is downgraded to WARN. The popup is now bounded to `220px` with `overflow-y: auto`, but `setActive()` only changes classes/ARIA and never scrolls the active descendant into view. Once navigation passes the visible rows, Enter targets an off-screen option. Separately, `.wt-branch-opt[data-kind="new"]` has the same specificity as `.wt-branch-opt.is-active` and appears later, overriding the active-selection foreground with link color; in common light themes this produces near-indistinguishable foreground/background values.

**Impact.** Sighted keyboard users again lose the visible “what Enter will take” state for rows beyond the scroll fold, and the create-new row can be illegible while active. The problem no longer affects the entire control, but it preserves B1's core keyboard-visibility failure on repositories with more than roughly a dozen matching refs.

**Fix.** In `setActive`, scroll the active option with `scrollIntoView({ block: "nearest" })` using a safe feature guard for jsdom. Make the create-new color apply only while inactive, or place the active rule later. Add a focused scrolling assertion rather than a DOM-only active-class assertion.


- Status: accepted
- Triage: Confirmed on both halves. `setActive` moves `aria-activedescendant` and the class but never scrolls, and the popup is `max-height: 220px; overflow-y: auto` — so past roughly a dozen rows the active option is off-screen and Enter commits something the user cannot see. The create-new colour rule is declared after `.is-active`, at equal specificity, so it wins on order. Both are in `4_1`'s own accepted contract; fixing here.
---

### [W2] Closed/reopened reply ownership is still not enforced

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-logic + asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:365-408, 1194-1212`; `src/webview/worktree/WorktreeController.ts:996-998`; shell paths `src/webview/worktree/worktreeDialogShell.ts:86-96, 115-119`
- Status: persists from round 1 · Triage: accepted

**Evidence.** The defensive `closed` flag is written only by `disposeAll`. Escape and scrim dismissal explicitly bypass `disposeAll`: the shell invokes `onDismiss` and its own `dispose()`, while the dialog's `onDismiss` only releases the tooltip and calls `onCancel`. The new test closes with Escape, so it does not exercise the new guard; its query remains null because the shell already removed the DOM, whether or not the stale closure mutates.

The cross-opening half is also unchanged. Reopening replaces `applyRefs` with the new form's callback, but old and new replies carry only the same `repoId`. An old read resolving after the rebind is therefore delivered into the new form. Clearing `repoRefs` before requesting does not prevent that reply from repopulating it, and the new opening's read supersedes it only if that newer read later succeeds.

**Impact.** The declared close contract remains false, and a reopened form can display/guard against the predecessor opening's list. This remains WARN because the list is discovery-only and git is the mutation backstop.

**Fix.** Set `closed` on the shared Escape/scrim `onDismiss` path. Separately, add refs-only request supersession — a host-side latest generation per surface+repo is sufficient and does not require widening all three channels. Verify with two deferred reads: close opening 1, open opening 2, resolve opening 1 and prove opening 2 stays unchanged, then resolve opening 2 and prove it applies. A generation scheme across defaults/provisioning is not required by this finding; broadening lifecycle ownership across all three would be a separate handback.


- Status: accepted
- Triage: Confirmed, and the second half is the part that matters. `closed` is set only in `disposeAll`, which Escape and scrim dismissal never reach, so my replacement test passed on the DOM being gone rather than on the guard — the same "assertion that cannot fail" I corrected in round 1 and reintroduced one layer up. Setting `closed` on the dismissal path makes the guard real; refs-only supersession (a per-surface, per-repo generation on the request, answered replies below it dropped) closes the reopen case. Scoped to refs, per the chair's own note — broadening lifecycle ownership across defaults and provisioning is a separate design question and is NOT taken here.
---

### [S3] The popup remains coupled to the dialog scroll container

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/worktreePanel.css:894-903, 1046-1064`
- Status: new · Triage: pending

**Evidence.** `.wt-dialog` is a max-height vertical scroll container. The absolutely positioned popup remains a descendant of that scroller, so short viewports can clip it or require scrolling the whole dialog to reach its bottom.

**Impact.** On short editor windows, branch traversal can become awkward despite the list's own scroll bound.

**Fix.** Bound the popup to available dialog space or flip it above the input when necessary. This is conditional and does not gate the change.


- Status: accepted
- Triage: Non-blocking and cheap enough to take with B1, since both are the same rule block: bound the popup to the space actually below the input rather than a fixed 220px, so a short editor window clips less. Not flipping it above the input — that is a placement engine, and this list lives in a dialog whose own height is already constrained.
---

## Fixed prior findings

### [B2] Current-repository mode is not re-derived on every route

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:524-534, 551-563, 842-848, 1098-1105, 1200-1209`
- Status: fixed · Triage: accepted

**Evidence.** `deriveChoice()` is two-way and is invoked for input, repository change, every refs application, and detached-off. Explicit row commit remains an intentional direct writer. The tested switch and detached boundaries now encode the current repository's mode.

**Impact.** The stale `fresh`/`reuse` translation named in round 1 is removed. B4 is a different mechanism: the explicit create-new selection can intentionally differ from exact-name derivation and must not own the held guard.

**Suggested fix.** None for B2.

### [B3] Every ref request re-snapshots the entire workspace

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-performance
- Class: feature
- File: `src/worktree/WorktreeCache.ts:60-74, 247-264`; `src/providers/WorktreeHost.ts:1259-1268`
- Status: fixed · Triage: accepted

**Evidence.** `readRepo()` performs a direct `Map.get` and copies only the requested repository's worktree array. `read()` shares the same `copyRepo()` helper, preserving whole-tree semantics. The refs handler is the sole production caller.

**Impact.** The additional round-1 `R × O(R + W)` snapshot cycle introduced by refs is removed; the explicitly deferred create-defaults cost remains outside this remediation.

**Suggested fix.** None. The `cache.read().find` mutant is behaviorally equivalent by design; semantic tests plus structural inspection of `Map.get` are appropriate for this performance contract.

### [W1] A repo switch can retain a hold from the previous repository

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:823-848`
- Status: fixed · Triage: accepted

**Evidence.** Repository changes now re-derive `choice` from the current repository. The old cross-repository stale holder is removed.

**Impact.** Held-to-free repository switches no longer retain another repository's owner. The old fallback mutant is not equivalent because B4's explicit create-new selection is a valid state where `choice` and the current exact ref deliberately differ.

**Suggested fix.** None for W1; fix B4 with a current-repository exact lookup and no stale fallback.

### [W3] Ref delivery linearly scans the repository list once per repository

- Severity: WARN · Confidence: HIGH · Priority: P3
- Agent: asm-review-performance
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1190-1202`
- Status: fixed · Triage: accepted

**Evidence.** `repoAt` is built once and provides stable O(1) lookup for the fixed opening repository set. Replacing records does not change indices.

**Impact.** Ref delivery is O(R) total rather than O(R²).

**Suggested fix.** None.

### [S1] The partial-list notice is not associated with the combobox

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:430-435`
- Status: fixed · Triage: accepted

**Evidence.** The combobox now references `wt-branch-partial` through `aria-describedby`; the note is empty/hidden when the list is complete.

**Impact.** The incomplete-list qualification reaches assistive technology.

**Suggested fix.** None.

### [S2] Enter on a held option is a silent no-op

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:937-948`
- Status: fixed · Triage: accepted

**Evidence.** Refused keyboard commit now renders the existing branch-and-owner explanation. Round 1 required that the refusal be announced or rendered; it did not require converting a valid typed prefix into an invalid input, and the active disabled option already carries its owner in its accessible name.

**Impact.** The action is no longer a silent no-op for the accepted finding's contract.

**Suggested fix.** None.

---

## Audit backlog

- **[A1] Capped full DOM rebuild per keystroke** — `WorktreeCreateDialog.ts:73-85, 827-868` — `orderChoices` and `renderList` rebuild up to `MAX_REFS` option nodes on every input. Structurally capped at 500 and outside this remediation cone; non-gating.
- **[A2] Deferred callbacks retain shipped linear/lifecycle patterns** — `WorktreeCreateDialog.ts:1167-1189` — `bindDefaults` and `bindProvisioning` still use linear repository lookup and do not consult `closed`. These predate the refs fixes and need their own ownership/performance decision; non-gating.
