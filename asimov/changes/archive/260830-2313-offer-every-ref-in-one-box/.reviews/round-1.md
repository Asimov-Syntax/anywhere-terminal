# Review round 1 — offer-every-ref-in-one-box

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Lane: fastlane
- Head reviewed: `435bb79dac2521a9653d01f52bd87beed7a3c068` (working tree dirty in change analytics outside the explicit range; committed range content only was reviewed)
- Diff scope: `git diff 2e03cdd2..HEAD`
- Reviewable lines: 627 added/modified across 10 reviewable production files; 843 added/modified test lines reviewed inline; docs and change artifacts were used as approved context but skipped as review targets
- Verdict: **REJECT**
- Counts: 3 BLOCK · 3 WARN · 2 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-frontend | create dialog + shared shell | keyboard, focus, submit routes, ARIA | `opus[1M]` |
| asm-review-logic | host/controller/dialog/ref reader | async state, failures, repo transitions | `gpt-5.6-terra[1M]` |
| asm-review-contracts | message pair + draft translation | wire completeness and mode contracts | `sonnet[1M]` |
| asm-review-performance | host enumeration + dialog updates | repository/ref growth axes | `gpt-5.6-terra[1M]` |
| asm-review-reuse | reader, message wiring, list implementation | prior capability reuse and cohesion | `gpt-5.6-luna[1M]` |
| chair | full range | all lenses + full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-data-security` — the diff adds no auth, secret, persistence, destructive write, or external-data trust boundary; git invocation and message validation were covered by logic/contracts.

Verify gate evidence is the build's recorded `bun run asm change verify-status offer-every-ref-in-one-box`: tasks 1_1 through 3_1 are `[x]` with exit 0. No project verify command or test suite was run by the chair.

---

## Findings

### [B1] The new listbox has no production styling for its visible states

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:815-855`; missing consumers in `src/webview/worktree/worktreePanel.css`
- Status: accepted · Triage: Verified: `rg 'wt-branch-list|wt-branch-opt|wt-branch-held' src/webview/worktree/worktreePanel.css` finds nothing — the classes have no production selectors at all. The detached toggle is worse than reported: the shipped rule is `.wt-dialog .vault-segmented button`, and the toggle carries `vault-segmented` on the button ITSELF, so it takes container styling and no button styling. An unstyled `<ul>` in dialog flow with up to MAX_REFS rows is not a control. Fixing in `worktreePanel.css`; `docs/ui/` stays untouched.

**Evidence.** The dialog now renders `wt-branch-list`, `wt-branch-opt`, `is-active`, and `wt-branch-held`, and keyboard movement changes only `is-active`/`aria-selected`. The explicit range contains no change to the production stylesheet, and a repository search finds no selector for any of those classes. The only list resets in `worktreePanel.css` are for unrelated blocker lists. The detached replacement also places `vault-segmented` on the button itself, while the existing visual rules target `.vault-segmented button`.

**Impact.** In the shipped webview the popup is a browser-default `<ul>` in normal dialog flow, potentially hundreds of rows long; held rows have no disabled treatment; most importantly, a sighted keyboard user has no visible indication of which option Enter will commit. The core user-visible combobox is therefore not behaviorally usable even though its DOM/ARIA tests pass.

**Fix.** Add production styles in `src/webview/worktree/worktreePanel.css` for popup positioning/scroll bounds, option/reset layout, active/focus-visible state, held/disabled state, and badge treatment. Give the detached toggle a class/structure matched by its button styles. Keep the externally owned `docs/ui/*` files untouched.

---

### [B2] Current-repository mode is not re-derived on every route

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:503-508, 525-530, 1047-1051, 1154-1158`
- Status: accepted · Triage: Verified: the `repoSelect` change handler sets `draft.repoId`, rebuilds the agents and after-options, and calls `syncDerived()` — it never touches `choice` or `branchMode`. `heldBranch()` reads `offeredRefs()` live, which is why 2_2's repo-switch case passes; the MODE is a separate fact and nothing re-derives it. A branch that exists in A and not in B crosses the wire as `existing` after a switch. Real, and D4's single-source claim is exactly what it breaks. The detached-exit and late-answer halves are the same missing derivation and are fixed with it.

**Invariant.** For the current repository and typed name, an exact offered ref must submit as `existing`, a name absent from that repository must submit as `new`, and detached mode must restore the mode implied by the current offer when it is turned off.

**Boundary inventory.** Affected: repository switch; a ref answer arriving while detached; turning detached back off. Verified safe: direct typing while attached; explicit row commit; a same-repository answer arriving while attached; the held-ref submit guard itself.

**Evidence.** The repository-change handler updates only `draft.repoId`, agents, and after-options before `syncDerived`; neither it nor `syncDerived` recalculates `choice` or `draft.branchMode`. A branch that exists in repo A therefore remains `existing` after switching to repo B where it is absent, and submits as `reuse`. Separately, `bindRefs` updates `choice` only when `draft.branchMode !== "detached"`; if refs arrive while detached, the toggle later restores `choiceMode(choice)` from the pre-answer choice, so an existing branch can submit as `new`. `bindRefs` also only upgrades to existing and never resets to new when no exact ref is present.

**Impact.** The dialog emits a wire operation different from the current repository state. A valid create then fails in the host/git layer (`reuse` for a missing ref or `fresh` for an existing ref), violating D4's single-source mode contract on normal multi-repository and late-answer routes.

**Fix.** Centralize a two-way `deriveChoice(currentRepo, typed)` operation and call it on input, repository change, every refs application, and when detached is turned off. While detached, update `choice` but leave the wire mode detached; on exit, restore the freshly derived choice. Add repo A existing → repo B absent/existing and detached-late-answer regressions.

---

### [B3] Every ref request re-snapshots the entire workspace

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-performance
- Class: feature
- File: `src/providers/WorktreeHost.ts:1259-1265`; sender `src/webview/worktree/WorktreeController.ts:700-705`
- Status: accepted · Triage: Verified, with one correction to the premise: the growth axis is NOT new. `case "requestWorktreeCreateDefaults"` already does `cache.read().repos.find(...)`, and opening the dialog already posted one of those per repository — so `R × O(R + W)` predates this change. What this change did is DOUBLE it. That is still my regression to carry, and the fix is cheap: a scoped single-repository read on the cache, used by the refs handler. I am not changing the create-defaults handler in the same breath — that is a pre-existing cost in a handler no task here leased, and it is recorded rather than quietly widened into this diff.

**Invariant.** One repository-scoped request must not copy or recompute every repository and worktree in the workspace.

**Growth axis.** Let `R` be repositories in the workspace and `W` total worktrees. One dialog open sends `R` ref requests. Each request calls `cache.read()`, whose implementation rebuilds the whole `WorktreeTree`, shallow-copies every repository, and copies every worktree array before `.find(repoId)`. The new path therefore adds `R × O(R + W)` snapshot/copy work and transient allocation before the bounded git reads. Neither `R` nor `W` is structurally capped.

**Impact.** Large multi-repository workspaces pay an uncapped quadratic/full-snapshot cost on a user-visible dialog open. The 500-ref cap bounds branches per repository but does not bound this workspace axis.

**Fix.** Add a cache API that returns a safely scoped snapshot for one `repoId` without assembling the full tree, or take one workspace snapshot per opening and service all repository reads from it. Preserve D2 by passing the selected repo's already-held worktree list to `readRepoRefs`.

---

### [W1] A repo switch can retain a hold from the previous repository

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:790-798`
- Status: accepted · Triage: Verified: `offeredRefs().find(...)?.heldBy ?? (choice...)` conflates "the current repo has this ref and it is free" with "the current repo does not have this ref". 2_2's repo-switch case walks free→held, which the live `offeredRefs()` lookup catches; the reverse, held→free, falls through to the stale selection and keeps naming a directory in the other repository. Subsumed by B2's fix — deriving `choice` against the current repo removes the stale branch entirely — but it gets its own case.

**Evidence.** `offeredRefs().find(... )?.heldBy ?? staleChoiceHeldBy` cannot distinguish “the current repo has no matching ref” from “the current repo has the matching ref and it is free.” If repo A's exact ref is held, then the user switches to repo B where the same exact ref is free, the current lookup yields `undefined` and the nullish fallback returns repo A's holder.

**Impact.** Create stays disabled and the error names a directory from another repository. The added repo-switch test covers only the opposite free → held direction.

**Fix.** Branch on whether the current-repository ref record exists. If it exists, return its `heldBy` even when that value is undefined; consult `choice` only when the current repository has no record, or preferably eliminate the stale fallback through the centralized derivation in B2.

---

### [W2] Late ref replies are applied to a closed or reopened dialog

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:996-998`; binding `src/webview/worktree/WorktreeController.ts:409-411`
- Status: accepted · Triage: Verified on both halves, and the TEST half is the one that turned out to matter — plus one correction to my own first reading. I originally called the production half "the shipped pattern"; that was too quick. `applyRefs` genuinely is never nulled, so I strengthened the test to open a real dialog, close it, and only then deliver — and it FAILED, which is what a live defect looks like. I then added the guard (the form goes inert on dispose, since the controller learns a close only through the view) and found the mutation could not be killed: after dispose the list is out of the DOM, a reopening rebinds before any reply can be misrouted, and a reply landing in between mutates a closure with nothing left to render. So the write is real and currently unobservable. The guard stays, commented as defensive rather than measured; the unfalsifiable dialog test was DELETED rather than kept as an assertion that cannot fail; the controller test keeps the real open/close cycle and now claims only what it can show. The un-nulled callback on the two shipped channels is recorded, not re-architected inside a fix round.

**Evidence.** `handleRefs` unconditionally invokes the single mutable `applyRefs` callback. Opening assigns it, but no dialog close path clears it, and the request/reply pair has no opening generation. The test called “a list that outlived its dialog” never opens then closes a dialog; it only verifies the initial null callback. A delayed answer can mutate the disposed dialog closure, or, after a reopen overwrites the callback, populate the new form with the predecessor opening's list.

**Impact.** The task's explicit closed-dialog drop contract is false. A reopened form can display and guard against a listing from the prior opening; if the current read fails, that stale listing can remain the only answer shown.

**Fix.** Correlate requests/replies with a per-opening generation (or make the host suppress superseded reads), and unregister `applyRefs` on disposal with an ownership guard so an old disposer cannot clear a newer callback.

---

### [W3] Ref delivery linearly scans the repository list once per repository

- Severity: WARN · Confidence: HIGH · Priority: P3
- Agent: asm-review-performance (downgraded from BLOCK by chair)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1142-1148`
- Status: accepted · Triage: Verified: `repos.findIndex` per reply, R replies, `O(R²)` identity comparisons. Also the shipped shape — `bindDefaults` and `bindProvisioning` both do it. Trivial to fix in `bindRefs` and worth doing; the other two are noted, not touched.

**Evidence.** The controller requests one list for each of `R` repositories. Every `bindRefs` callback performs `repos.findIndex`, producing `R × O(R)` identity comparisons during delivery. The repository axis is uncapped.

**Impact.** Dialog initialization adds avoidable quadratic webview work in large workspaces.

**Severity adjudication.** Unlike B3, this boundary does not rebuild or copy repository/worktree collections; each step is a shallow identity scan and one record replacement, and the existing create lifecycle already carries similar per-repository callbacks. The uncapped repeated scan remains a defect, but the evidence supports WARN rather than a gating BLOCK.

**Fix.** Build a `Map<repoId, index>` or map of repo records once when the dialog opens and use O(1) lookup for refs, defaults, and provisioning updates.

---

### [S1] The partial-list notice is not associated with the combobox

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:429-432, 919-923`
- Status: accepted · Triage: Verified: `#wt-branch-partial` has an id and nothing references it. One attribute.

**Evidence.** `partialNote` has an id, but the combobox never references it with `aria-describedby`. A screen-reader user interacting with the control is not told that the branch list is capped unless they separately browse adjacent content.

**Impact.** The incomplete-list qualification is visually stated but not reliably attached to the control for assistive technology.

**Fix.** Add/remove `aria-describedby="wt-branch-partial"` with the note's visible state, or include the notice in an appropriate live/described region.

---

### [S2] Enter on a held option is a silent no-op

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:887-892`
- Status: accepted · Triage: Verified: `commit()` returns silently for a held row. The explanation already exists — `heldBranch()` produces "…is checked out in <dir>" — it just is not reached when the refusal comes from the keyboard rather than from the typed name.

**Evidence.** `commit` immediately returns for a held option without updating the existing error/live state, moving the active option, or otherwise acknowledging the refused action.

**Impact.** A keyboard user cannot distinguish the intended refusal from a dropped keypress, although the option text does contain the holder reason.

**Fix.** On refused commit, announce or render the same “checked out in <owner>” reason used by `syncDerived`, without selecting the option.
