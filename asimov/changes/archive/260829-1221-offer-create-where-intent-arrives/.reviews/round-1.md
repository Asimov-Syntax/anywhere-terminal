# Review round 1 — offer-create-where-intent-arrives

- Date: 2026-08-29
- Cycle: 1
- Mode: discovery
- Head: `3a5f632b7d3df559dd45c3e606fc07d499fa1b0a` (tree clean; `docs/ui/worktree.html` and `skills-lock.json` dirty but out of scope)
- Scope: range `0bb67ab9..3a5f632b`
- Reviewable lines: ~271 (src, non-test) + 391 test lines
- Agents spawned: asm-review-logic (opus[1M]), asm-review-frontend (gpt-5.6-terra[1M]), asm-review-contracts (sonnet[1M]), asm-review-performance (gpt-5.6-luna[1M]), asm-review-reuse (gpt-5.6-luna[1M]), plus chair self-review + full-flow trace
- Agents skipped: asm-review-data-security — no auth, persistence, secrets, or external input surface in the diff
- Verdict: BLOCK
- Counts: 2 BLOCK / 7 WARN / 5 SUGGEST
- Split over gating blockers: 2 feature / 0 machinery

## Findings

### B1 — A superseded create ask's late opening answer re-enables Create and reverts the derived destination
- Severity: BLOCK | Confidence: HIGH | Priority: P1 | Agent: asm-review-logic (chair corroborated the reachability)
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:682-691`; `src/webview/worktree/WorktreeCreateDialog.ts:567`, `:580-585`
- Evidence: `openCreateForRepo` replaces `pendingCreate` wholesale and cancels nothing, so a second create started while one is pending leaves the first ask's answers in flight. Those late answers hit `handleCreateDefaults` with `pendingCreate === null` (or their id already drained) and fall into the open-form branch at `:686-689`, calling `applyCreateDefaults`. The dialog's staleness guard is `if (next.answersBranch !== undefined && key !== askedFor) return;` (`WorktreeCreateDialog.ts:567`) — an OPENING ask carries no `branch`, so the host echoes none, `answersBranch` is `undefined`, and the guard never fires. The handler then does `repos[at] = { ...next, agents }`, `outstanding = false`, `syncDerived()` (`:580-585`). `outstanding` is one dialog-wide flag (`:409`) and it is the gate on the Create button (`:530`).
- Impact: after the user types a branch — which sets `outstanding = true` and disables Create pending the host's branch-specific destination — a late branch-less answer re-enables Create and, while `pathIsDerived`, rewrites `draft.path` back to the branch-less default. The user can submit a destination resolved for no branch. The new unscoped toolbar door makes this materially more likely than the old menu-only door: it waits for the slowest of N answers with no pending feedback of any kind, so a second click on a button that appears dead is the natural user response, and the seeded button (B2) invites a click before any tree exists.
- SuggestedFix: token the asks — carry an incrementing `askId` on `pendingCreate` and drop answers minted by a superseded ask; or route to `applyCreateDefaults` only when the answer carries an `answersBranch` (an opening answer has no business in an already-open form).
- Status: open | Triage: pending

### B2 — The toolbar "+" is present and inert from init until the first tree response
- Severity: BLOCK | Confidence: HIGH | Priority: P1 | Agent: chair + asm-review-contracts + asm-review-logic (three independent)
- Class: feature
- File: `src/webview/main.ts:1098`; `src/webview/worktree/WorktreeController.ts:505-509`, `:724`
- Evidence: `vaultPanel.setCreateWorktreeAvailable(msg.worktreeHasRepo === true)` seeds availability from `hasGitRepo(workspaceFolders, exists)` (`src/providers/WorktreeHost.ts:1650`), whose own doc calls it "deliberately looser than git's own answer". The only correcting call is `handleTreeResponse` (`WorktreeController.ts:724`), which fires only after the `requestWorktreeTree` round trip. `resolveInitialView` (`main.ts:1062`) picks the worktree body from that same field, so on an ordinary cold open the button is visible while `this.tree` is still `null`. `openCreateForRepo(undefined)` then computes `targets = (this.tree?.repos ?? []).map(...)` = `[]` and returns at `:508` — no message, no notice, no disabled state.
- Impact: on every cold open of the Worktree body in a git workspace there is a window — a git scan per repo, not a frame — in which the change's headline affordance is visible and clicking it does nothing. Permanently so when `.git` exists but git is unusable, since discovery then ships `repos: []`. This is the exact rule the accepted delta states: "SHALL NOT be presented while the Worktree body holds no repository to create in", "absent rather than present and inert" — violated by the line the diff added to satisfy it.
- SuggestedFix: drop the `main.ts:1098` seed and let `onCreateAvailability` be the only source of truth (accepting one frame of absence), or treat `tree === null` as unavailable and record the unscoped intent to open on the first tree that lands.
- Status: open | Triage: pending

### W1 — `pendingCreate.outstanding` is never reconciled against the arriving tree
- Severity: WARN | Confidence: HIGH | Priority: P1 | Agent: asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:505-517`, `:762-773`; `src/providers/WorktreeHost.ts:932-934`
- Evidence: `reconcile()` exists to bring tree-keyed collections onto the new tree and prunes `createDefaults` at `:769-773`. `pendingCreate.outstanding` is a second such collection introduced by this diff and `reconcile()` does not touch it. The host answers `requestWorktreeCreateDefaults` only while the repo is in its cache — `if (repo === undefined) { return; }` (`WorktreeHost.ts:932-934`): silence, not an error reply. There is no error variant on the `worktreeCreateDefaults` message at all.
- Impact: one repository that vanishes between the ask and the answers leaves `outstanding.size > 0` forever for that pending create. The dialog never opens and no notice is raised — the click is silently dead for all N repos, not just the missing one. Recovery is only a second click, which succeeds once the tree push that removed the repo has landed.
- SuggestedFix: in `reconcile(next)`, drop from `pendingCreate.outstanding` every id absent from `next.repos`, and complete the open when it drains to zero. Alternatively open on the cached answer immediately and let fresh replies land through `applyCreateDefaults`, which removes the "one silent repo blocks all N" property entirely.
- Status: open | Triage: pending

### W2 — A scoped create opens a form whose repository picker holds only the repos that have already answered
- Severity: WARN | Confidence: HIGH | Priority: P2 | Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:651-676`, `:318-320`; `src/webview/worktree/WorktreeView.ts:428-436`
- Evidence: the dialog's picker is built once from `seed.repos = createRepos()` (`WorktreeController.ts:320`), and `createRepos()` skips every repo with no entry in `createDefaults` (`:653-657`). The scoped doors — header, unbranched CTA, row menu — ask exactly one repo (`:506`), so on a cold three-repo panel the form they open offers one option; the toolbar door offers three. After one toolbar create, the same header door offers three.
- Impact: contradicts the accepted ADDED requirement "Every create entry point opens the same offer" — "differing only in which repository the form opens on". They differ in which repositories the form OFFERS, and history-dependently. A user who opens from repo B's header cannot switch to repo A without cancelling.
- SuggestedFix: either ask every repo on every door and seed `initialRepoId` from the scoped one, or narrow the picker's contract so a scoped open is honestly single-repo. The existing test `[1_1] waits for every repository it asked before opening` already asserts `offered()`; the scoped counterpart is the missing assertion.
- Status: open | Triage: pending

### W3 — Every repo group header's treeitem name absorbs the nested button's label
- Severity: WARN | Confidence: HIGH | Priority: P2 | Agent: asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/worktreeTreeView.ts:205-240`, notably `:232-234`
- Evidence: `renderRepoHeader` builds a `role="treeitem"` with no `aria-label`, so its accessible name is computed from contents; it now contains `rowAction(ICON_PLUS, "Create worktree in ${repo.label}", ...)`, a `<button>` whose `aria-label` is its text alternative. Before this change the header held only spans and a `aria-hidden` chevron. The pre-existing in-row control (`onOpenFolder`) is a `dblclick` listener on the row, not a focusable child, so there is no precedent for an operable button inside a nav row.
- Impact: each header now announces "{label} {count} Create worktree in {label}". A separately operable button inside a `treeitem` also gives browse-mode assistive tech two overlapping interaction models over the same node. The `.vault-empty` div plus its button is likewise a non-`treeitem` child of `role="tree"` — that part matches the existing notice/"Show all" pattern.
- SuggestedFix: give the header an explicit `aria-label` (label + count) so its name does not absorb descendants, and consider `role="none"` plumbing or moving the control out of the treeitem's name computation.
- Status: open | Triage: pending

### W4 — Arrow navigation now runs two full-tree tab-stop passes per keypress
- Severity: WARN | Confidence: HIGH | Priority: P2 | Agent: asm-review-performance
- Class: feature
- File: `src/webview/worktree/WorktreeView.ts:244-254`, `:1345-1350`, `:1414-1418`, `:79-89`
- Evidence: `focusRow()` runs `for (const other of this.navRows()) setRowTabStop(...)` at `:1416` and then calls `row.focus()`, which fires the `focusin` delegate that runs the identical loop at `:251`. `navRows()` is a whole-tree `querySelectorAll`, and `setRowTabStop` issues a further `.wt-rowaction` query per row. One arrow key therefore costs `2N + 2` DOM queries and `2(N + A)` `tabIndex` writes where before it cost one query and `N` writes. Worktree rows are capped at `MAX_WORKTREES_PER_REPO = 20` per repo but "Show all" removes that cap, and agent/subagent rows have no display cap.
- Impact: input-path work is not structurally bounded by the tree, and the unconditional rewrite sits against § 6.1's cost-floor rule ("a re-derivation in which no row crossed performs no DOM work at all"). No behavioral disagreement between the delegate, `focusRow`, and `render()`'s focus restoration was found — they agree on the target — so this is redundancy and discipline, not a defect.
- SuggestedFix: make `setRowTabStop` a no-op when the value is unchanged, and drop the `focusRow` loop now that the `focusin` pass covers every entry mode including the pointer press it was added for.
- Status: open | Triage: pending

### W5 — N unbranched repositories render N panel-scale empty-state blocks inline in the tree
- Severity: WARN | Confidence: MEDIUM | Priority: P3 | Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeView.ts:1044-1051`; `src/webview/vault/vaultPanel.css:286-294`
- Evidence: the CTA is appended per repository inside `renderRepo`. `.vault-empty` is a panel-scale block — `padding: 24px`, centered flex column, icon + 13px title + 240px body + button. In a five-repo workspace where three repos hold only their main checkout — an ordinary state right after cloning — the tree renders three of these interleaved between headers and single rows. Every unbranched test in `WorktreeView.test.ts:2900-3077` uses a single-repo tree, so the multi-repo composition is unasserted; the header door, meanwhile, exists only in the multi-repo case.
- Impact: the state the change adds is untested in exactly the tree shape the change's other new door targets, and the reused atom is sized for a whole panel rather than a repo section.
- SuggestedFix: add a two-unbranched-repo test asserting one state per repo and its scoping, and decide deliberately whether the inline per-repo form wants a compact variant.
- Status: open | Triage: pending

### W6 — `pendingCreate` survives `setVisible(false)` and `dispose()`
- Severity: WARN | Confidence: MEDIUM | Priority: P3 | Agent: asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:445-470`, `:747-749`
- Evidence: neither `setVisible` nor `dispose` clears `pendingCreate`, and the host applies no visibility gate to `requestWorktreeCreateDefaults` — it is dispatched through `handleAction` (`WorktreeHost.ts:1614-1616`), which checks only `actions`/`disposed`. The unscoped door widens this window because it waits for the slowest of N answers rather than one.
- Impact: the user clicks "+", switches the vault to the Sessions body while the host resolves, and the create dialog mounts over the panel unbidden, holding a focus trap on a body it does not act in.
- SuggestedFix: clear `pendingCreate` in `dispose()` and on `setVisible(false)`, or stamp a visibility epoch on it and ignore answers from an ended one.
- Status: open | Triage: pending

### W7 — The keyboard-reach requirement rests entirely on CSS that no test asserts
- Severity: WARN | Confidence: HIGH | Priority: P3 | Agent: chair + asm-review-frontend
- Class: feature
- File: `src/webview/worktree/worktreePanel.css:1113-1134`; `src/webview/worktree/WorktreeView.test.ts` ("arrows still move between rows while the control holds focus")
- Evidence: `.wt-rowaction` is `visibility: hidden` and revealed only by `.wt-repo:hover, .wt-repo:focus-within`. A `visibility: hidden` element is not focusable in a browser regardless of `tabIndex`, so the accepted requirement "reachable by keyboard, not by pointer hover alone" is delivered by the `:focus-within` rule alone. jsdom applies no CSS, so no test can observe it. The arrow test calls `action.focus()` while the header does NOT hold focus — a state in which that call would be a no-op in a real browser. It still fails without the `closest(NAV_ROWS)` fix, so it proves the resolution; it does not prove the scenario is reachable as staged. The Enter/Space tests honestly document that they dispatch the click jsdom will not synthesize.
- Impact: the requirement most likely to regress silently — a CSS refactor that changes the reveal rule, or drops `:focus-within` — is covered by nothing. The `stopPropagation` assertions themselves are sound: the button's own click listener fires in the target phase and `stopPropagation` prevents `bindActivation`'s bubbling listener from reaching `onToggle`; arrows are not stopped, so `this.element`'s `onKeyDown` still sees them.
- SuggestedFix: assert the CSS contract directly (parse `worktreePanel.css` and assert the `:focus-within` selector exists for `.wt-rowaction`), or move the reveal to a class the view toggles so it is observable in jsdom.
- Status: open | Triage: pending

### S1 — Arrow and Home/End from the new empty-state CTA teleport focus into the tree
- Severity: SUGGEST | Confidence: HIGH | Priority: P4 | Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeView.ts:1425-1450`; `src/webview/vault/renderAtoms.ts:627-633`
- Evidence: `.wt-empty-action` sits inside the `role="tree"` element but outside `NAV_ROWS`, so `closest(NAV_ROWS)` is null, `index` is `-1`, and ArrowDown/ArrowUp/Home/End still `preventDefault()` and `focusRow(rows[0])`.
- Impact: after tabbing to "Create worktree", an arrow key moves focus into the tree instead of doing nothing. Pre-existing behaviour shared with "Show all" and notice Retry buttons; this diff adds a new instance rather than a new mechanism, which is why it is not gating.
- SuggestedFix: return early when the key target has no owning `NAV_ROWS` row, which fixes all four controls at once.
- Status: open | Triage: pending

### S2 — `pendingCreate` and `frozenCreateOffer` are consumed before a door that can still refuse to open
- Severity: SUGGEST | Confidence: HIGH | Priority: P4 | Agent: asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:696-698`; `src/webview/worktree/WorktreeView.ts:428-432`
- Evidence: `handleCreateDefaults` nulls `pendingCreate` and stamps `frozenCreateOffer` before calling `openCreateDialog`, which returns silently when `createRepos()` is empty — reachable when `reconcile()` dropped the answers between the last reply and the open.
- Impact: no dialog, no notice, and a `frozenCreateOffer` left standing for a form that never opened.
- SuggestedFix: have `openCreateDialog` report whether it opened; stamp `frozenCreateOffer` only on a true return and surface a notice otherwise.
- Status: open | Triage: pending

### S3 — The shared `emptyState` atom hard-codes a worktree-prefixed class
- Severity: SUGGEST | Confidence: MEDIUM | Priority: P4 | Agent: asm-review-reuse
- Class: feature
- File: `src/webview/vault/renderAtoms.ts:630`; `src/webview/worktree/worktreePanel.css:1148`
- Evidence: `emptyState` is shared by `vaultListView.ts:319` and `links/SubagentPreviewPopup.ts:153`, but the new action branch assigns `wt-empty-action`, a class defined only in the worktree stylesheet while the shared empty-state styles live in `vaultPanel.css:286`.
- Impact: a non-worktree caller supplying an action gets an unstyled control; a change to the worktree class silently affects shared callers.
- SuggestedFix: give the shared stylesheet a generic empty-state action class, or let the caller supply the class.
- Status: open | Triage: pending

### S4 — `repoAnchors` for an unbranched repo points at the empty-state block
- Severity: SUGGEST | Confidence: HIGH | Priority: P5 | Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeView.ts:834-840`, `:1044-1051`
- Evidence: `repoAnchors.set(repo.repoId, this.element.lastElementChild)` now records the `.vault-empty` block for an unbranched repo, since the CTA is appended after the rows.
- Impact: a repo-scoped action notice with no drawn row lands after the CTA rather than beside the repository's rows. Still with its repository, so cosmetic.
- SuggestedFix: record the anchor before the CTA append, or accept and note it.
- Status: open | Triage: pending

### S5 — The unscoped door posts one host request per repository and never consults `createDefaults`
- Severity: SUGGEST | Confidence: HIGH | Priority: P5 | Agent: asm-review-performance
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:514-516`; `src/providers/WorktreeHost.ts:931-954`
- Evidence: `openCreateForRepo` posts `R` independent requests regardless of cached answers; each host reply scans that repo's worktrees and performs repeated filesystem existence checks through `suggestFreePath`.
- Impact: `R` webview-host round trips and `R` filesystem probes per toolbar click, on a cold path. Re-asking is correct — free-path resolution moves under the panel — so this is cost, not correctness. It is the coupling in W1 that makes it matter.
- SuggestedFix: batch the defaults request across repositories, keeping host-side resolution authoritative.
- Status: open | Triage: pending

## Author claims adjudicated

- **`isUnbranched` placement — the author is right.** Every exclusion they claim holds. A collapsed repo returns at `WorktreeView.ts:1000` before the check; a filtered-to-nothing repo returns 0 at `:972`; `degraded === undefined` excludes both degraded shapes. The CTA cannot render twice for one repository, cannot co-render with `noMatch` (reaching the CTA implies `visible.length >= 1`, so `rendered >= 1` and `renderListing:843` never fires), and cannot render for a repo whose rows are folded (`folds` needs `tail.length >= 4`; an unbranched repo has one worktree). The unexamined case is composition across repositories — W5.
- **`stopPropagation` — the author is right, and the test passes for the right reason on the question it asks.** The button's target-phase click listener runs before `bindActivation`'s bubbling one, and `stopPropagation` prevents `onToggle`. Arrows are not stopped, so `this.element`'s `onKeyDown` still receives them. What the test cannot prove is browser key-to-click synthesis and `visibility` focusability — W7.
- **The `btn.tabIndex = -1` equivalence judgement holds.** `syncRovingTabindex` runs synchronously inside every populated `render()`, `.wt-repo` is a `NAV_ROWS` member, and `setRowTabStop` rewrites every `.wt-rowaction` inside it. The construction-time value is unobservable. Not a test gap.
- **The `focusin` write — no behavioral disagreement found.** The delegate, `focusRow`, and `render()`'s restoration all resolve to the same row; a re-render while a `.wt-rowaction` holds focus restores focus to its owning header, which keeps `:focus-within` true and the control visible. The cost and the § 6.1 tension are real — W4.

---

## Triage (author, before any fix edit)

| ID | Status | Rationale |
|----|--------|-----------|
| B1 | accepted | Verified. `openCreateForRepo` replaces `pendingCreate` and cancels nothing (`WorktreeController.ts:505-517`); the superseded ask's answers then take the open-form branch at `:683-691`. The dialog guard at `WorktreeCreateDialog.ts:566` compares `answersBranch`, and an opening ask carries no branch — `WorktreeHost.ts:964` echoes `branch` only when the request had one, and `openCreateForRepo` posts none. So the guard cannot fire. Taking the chair's second option: an answer reaches an open form only when it carries the branch that form asked about. The dialog always sends one (`WorktreeCreateDialog.ts:421`, even empty), so this is a property of the wire, not a heuristic. |
| B2 | accepted | Verified. `main.ts` seeds availability from `msg.worktreeHasRepo`, which `resolveInitialView` also uses to open the Worktree body — so the button is visible while `this.tree` is null and `openCreateForRepo(undefined)` returns at `:508` with no message and no notice. It is the rule the line was added to satisfy, violated. Dropping the seed. |
| W1 | accepted | Verified. `reconcile()` prunes `createDefaults` (`:769-773`) and not `outstanding`. Reconciling it, and opening if that empties the set. |
| W2 | accepted | The strongest finding. My own accepted requirement says the doors differ only in which repository the form opens on, and a cold scoped door offers one repository where the toolbar offers three. Every door now asks every repository; the scoped ones differ only by `initialRepoId`. |
| W3 | accepted | `role="treeitem"` names from contents, so every header absorbed the button's label. |
| W4 | accepted | `focusRow` writes the stops, then `row.focus()` fires the delegate which writes them again. |
| W5 | accepted | Every unbranched test uses a single-repo tree — the multi-repo shape is the only one the header door exists in, and it is unasserted. |
| W6 | accepted | A create resolved after the panel left the Worktree body mounts a dialog over a body it does not act in. |
| W7 | accepted | The keyboard-reach requirement rests on `:focus-within`, which jsdom does not apply, and my arrow test focuses the control while its header does not hold focus — a no-op in a browser. Fixing the staged scenario and asserting the rule where it lives. |
| S1 | audit-backlog | Real, and not this change's: `.wt-empty-action` shares the mechanism with "Show all" and notice Retry, both pre-existing, both inside `role="tree"` and outside `NAV_ROWS`. A new instance of an existing defect. Recorded rather than fixed here, because fixing it means deciding what arrows do for every non-row control in the tree — a contract this change does not own. |
| S2 | accepted | Trivial: do not consume the frozen offer for a form that did not open. |
| S3 | accepted | Trivial: the shared atom should not hard-code a worktree-prefixed class. |
