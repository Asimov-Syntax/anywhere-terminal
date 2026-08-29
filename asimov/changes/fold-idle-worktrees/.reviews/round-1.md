# Review round 1 — fold-idle-worktrees

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: discovery
- **Head**: dce86a1e (tree clean for `src/`; `docs/ui/worktree.html` and `skills-lock.json` dirty, both outside the reviewed scope)
- **Scope**: range `c81d79f6..dce86a1e`
- **Reviewable lines**: ~233 (WorktreeView.ts 147, worktreeTreeView.ts 41, worktreePanel.css 35, WebviewState.ts 8, WorktreeController.ts 2). Tests reviewed inline (Phase 2.5). `asimov/**` machinery, `.gitignore`, `skills-lock.json`, `docs/**` skipped.
- **Verdict**: **BLOCK**
- **Counts**: 2 BLOCK · 4 WARN · 6 SUGGEST
- **Split over gating blockers**: 2 feature / 0 machinery

## Agents

| Agent | Region / lens | Model |
|---|---|---|
| chair | full diff, all lenses + full-flow trace | opus-5[1m] |
| asm-review-logic | idleness predicate, ordering vs cap, persistence seeding, prune | opus[1M] |
| asm-review-frontend | disclosure row keyboard model, a11y, focus, notices | gpt-5.6-terra[1M] |
| asm-review-contracts | accepted-spec conformance, test integrity, persisted-state surface | sonnet[1M] |
| asm-review-reuse | disclosure vs repo header / show-all, toggle + seeding duplication | gpt-5.6-luna[1M] |
| asm-review-performance | render recompute, growth axes, ceiling-scheduler interaction | gpt-5.6-luna[1M] |

None skipped. Data-security not spawned: no persistence, auth, network, or input-validation surface — the only new persisted field is a local webview-state string array.

---

## Findings

### B1 — Activating the disclosure while a filter is up silently destroys the persisted fold
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: chair + asm-review-logic (independently reproduced)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:415-432` (`toggleIdleTail`, `idleTailFolded`)
- **Evidence**: `idleTailFolded()` returns `false` whenever `this.query` is non-empty, so a filtered render draws the disclosure with `aria-expanded="true"`. `toggleIdleTail()` carries no matching guard: it flips `this.collapsed` against the *stored* state and persists unconditionally. Chair probe (created and deleted in one command), fixture `live` + four `spike-*` idle, tail seeded folded:
  - `setQuery("spike")` → disclosure renders `aria-expanded="true"`, four tail rows shown
  - click `.wt-idle` (or ArrowLeft on it) → `aria-expanded` still `"true"`, rows unchanged, **fold key deleted from `collapsed` and persisted**
  - `setQuery("")` → `["live","spike-a","spike-b","spike-c","spike-d"]` — the tail is permanently unfolded
- **Impact**: Violates the accepted requirement *"A search match inside the tail opens it — Revealing it this way SHALL NOT overwrite the fold state the user chose, so clearing the filter SHALL return the tail to that state."* The control gives no feedback while it silently rewrites persisted state, in the inverted direction; `aria-expanded` never responds to activation, which is also an assistive-tech lie. The workflow note "A filter reveals the tail at RENDER time only, never by writing the fold open" is correct about the render path and missed the interaction path.
- **Fix**: Return early from `toggleIdleTail` while `this.query` is non-empty, or render the disclosure non-interactive (no `aria-expanded`, no activation binding) while a query is active, since its state is not the user's to change in that mode. Add a test that filters, activates the disclosure, clears the filter, and asserts the tail is folded again.

### B2 — `keyOf` collides between a repo header and its idle disclosure; keyboard focus lands on the wrong row in every multi-repo workspace
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair + asm-review-logic (BLOCK) · asm-review-frontend (WARN, same evidence)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1145-1156` (`keyOf`) with `src/webview/worktree/worktreeTreeView.ts:794` (`row.dataset.idleKey = repoId`) and `:182` (`header.dataset.repoId = repo.repoId`)
- **Evidence**: The collapse key is namespaced (`NUL-prefixed idle-tail:<repoId>`) but the *navigation* key is not — the disclosure stores the raw `repoId` in `dataset.idleKey`, and `keyOf` falls through `worktreeId ?? repoId ?? idleKey`, so the repo header and the disclosure both return the same string. The header always precedes the disclosure in DOM order, so every `navRows().find(r => keyOf(r) === key)` resolves to the header. Chair probe, two repos, alpha with a folded tail, ArrowRight on `.wt-idle`:
  - tail opened (4 `.wt-row--in-tail` rendered) — correct
  - `document.activeElement.className` → `"wt-repo"` — focus jumped to the repo header
  - `[tabindex="0"]` → `["wt-repo"]` — the single tab stop moved with it
  Three call sites are affected: `expandOrDescend`'s post-toggle refocus (`:1253`), `render()`'s focus restoration (`:748`), and `syncRovingTabindex` (`:1137`).
- **Impact**: Violates the accepted requirement *"The idle disclosure is a first-class row of the tree … and retain focus across the re-render its toggling causes."* After toggling the tail, the user's next ArrowLeft collapses the whole repository instead of re-folding the tail; a keyboard user parked on the disclosure is bounced to the header on every push. Every new idle-tail test uses a single-repo fixture, where no header is rendered — which is exactly why `"gives the disclosure its own keyboard identity"` passes while this is broken.
- **Fix**: Namespace the navigation key as the collapse key already is — set `dataset.idleKey = idleTailKey(repoId)` and re-derive the repoId in `toggleIdleTail`, or have `keyOf` return a prefixed value when `idleKey` is present. Add a two-repo keyboard test that arrows onto a disclosure, opens and closes it, and asserts focus and the tab stop stay on it.

### W1 — A folded tail suppresses its worktrees' action-result notices
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair + asm-review-frontend + asm-review-logic
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:895-918` (`renderRepo`)
- **Evidence**: The `shown` loop `continue`s past every idle worktree when `folds` is true, which skips `renderWorktreeWithNotices` — and the tail loop that carries notices runs only under `if (!folded)`. So a result whose `worktreeId` names a folded tail row is rendered nowhere. Chair probe: a folded tail plus `actionResults: [{ action: "create", worktreeId: "/r/wt/d", outcome: "error", error: "boom" }]` renders exactly `"live4 idle worktrees"` — the error text is absent from the DOM. Reachable without any tail interaction: a worktree created from the panel toolbar has no agents, so it is idle by construction and joins the tail; once a push lands that puts it in the tree, `WorktreeController.rescope` stops orphaning its result and re-scopes it to that (folded) row.
- **Impact**: Base spec *"A mutation that fails leaves the panel showing reality"* requires the failure text be surfaced, and *"A launch that fails after a create says the worktree was made"* requires that specific report. An undismissed notice can appear (repo-scoped, via `orphanedLabel`) and then vanish on the next push once the row exists inside the fold. This is the same class of defect the `orphanedLabel` mechanism was added for in round-3 B1 of the prior review — a notice with nowhere to render — reintroduced through a different cause. Not rated BLOCK because the first push usually shows the notice repo-scoped, so "the user was told nothing at all" is not airtight.
- **Fix**: Render tail worktrees' notices immediately after the disclosure even while folded, or fold-bust the tail for any repaint in which a tail worktree carries an unread `actionResult`.

### W2 — The idle disclosure has no `:focus-visible` style, unlike every other navigable row
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/worktreePanel.css:715-730` (`.wt-idle`)
- **Evidence**: `.wt-repo:focus-visible` (`:60`), `.wt-row:focus-visible` (`:101`), `.wt-presence:focus-visible` (`:307`), `.wt-agents:focus-visible` (`:357`), `.wt-arow:focus-visible` (`:378`), `.wt-srow:focus-visible` (`:544`) and the new `.wt-row--idle:focus-visible` (`:710`) all define `outline: 1px solid var(--vscode-focusBorder)`. `.wt-idle` defines only `:hover`.
- **Impact**: The one row a keyboard user must land on to reach the tail falls back to the UA default ring, which is not themed with `--vscode-focusBorder` and reads as inconsistent with every other row in the tree. Directly against the accepted requirement that the disclosure "take part in the single tab stop" as a first-class row.
- **Fix**: Add `.wt-idle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }` alongside the existing rules.

### W3 — Two of the new/edited assertions are vacuous
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: chair + asm-review-logic + asm-review-contracts (corroborated three ways)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeController.test.ts:137-141`; `src/webview/worktree/WorktreeView.test.ts` (`"draws an agentless worktree as one dim line with no presence block"`)
- **Evidence**:
  - `expect(drawn + hidden).toBe(6)` passes for `drawn=2, hidden=4` **and** for `drawn=6, hidden=0` — `hidden` defaults to `0` when `.wt-idle-label` is absent. Delete the whole fold and the test still passes. The assertion it replaced (`branches.length === 6`) was falsifiable; this one is a conservation identity. The `--test-change` rationale calls it "the reachability the spec actually requires", which overstates it.
  - `expect(idle?.querySelector(".wt-glyph .wt-state")).toBeNull()` is tautological: `renderWorktreeRow` (`worktreeTreeView.ts:258-265`) emits `.wt-state` only when `opts.activity` is truthy, and `strongestActivity([], …)` returns `undefined` for *any* agentless worktree (`worktreeFormat.ts:247-259`) — with or without `idle`. The "no presence block" clause of that requirement therefore has no live assertion behind it; the sibling `wt-row--idle` and `dataset.worktreeId` assertions in the same test are real.
- **Impact**: The stated mutation pass caught nine injected mutations but these two clauses would survive removal of the feature they claim to prove. Given the demonstrated vacuity failure mode this session, they should not be left standing.
- **Fix**: Assert both terms separately (`drawn` is 2 **and** `hidden` is 4). For the dim-line test, assert the absence of the presence pill element that `renderPresencePill` emits, and pair it with a control case that has agents, so the assertion can fail.

### W4 — The capping affordance reports the total, not what the cap excludes, and the new test asserts the total
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-contracts
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:808+` (`renderShowAll`); test at `src/webview/worktree/WorktreeView.test.ts` (`"counts only what the cap admitted…"`)
- **Evidence**: The accepted delta spec says *"The capping affordance SHALL report only what the cap excludes."* `renderShowAll(total)` is called with `visible.length` and renders the full matching count, not `visible.length - MAX_WORKTREES_PER_REPO`. The new test asserts `.wt-showall` text contains `String(agentHolders.length + idle.length)` — the total — while its own inline comment claims the excluded rows are "the cap's to report".
- **Impact**: `renderShowAll` predates this change so this is not a regression, but the change accepted a spec clause its code does not meet and shipped a test that reads as proving it. The half of that requirement the change *does* meet (the disclosure counting only admitted rows) is correctly implemented and tested.
- **Fix**: Either change `renderShowAll` to state the excluded remainder, or correct the spec clause to describe the affordance the panel actually offers. Do not leave the test comment asserting a contract neither side implements.

### S1 — The expanded disclosure does not expose ownership of its tail rows to assistive technology
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-frontend
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:783-806`
- **Evidence**: The disclosure carries `role="treeitem"` and `aria-expanded`, but its tail rows are flat siblings with no `role="group"` container, no `aria-level`, and no `aria-owns`. The keyboard model knows the hierarchy (via `depthOf`), the accessibility tree does not.
- **Impact**: A screen reader announces an expanded "4 idle worktrees" treeitem and then announces the following worktree rows as peers, not as its children. Note the whole tree is flat today, so this is the established shape rather than something the change broke — recording it because the accepted spec makes this row's first-class status explicit.
- **Fix**: Wrap revealed tail rows in a `role="group"` owned by the disclosure, or add `aria-level` consistently across the row kinds.

### S2 — `opacity: 0.72` dims text contrast and stays active under forced colors
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P3
- **Agent**: asm-review-frontend
- **Class**: feature
- **File**: `src/webview/worktree/worktreePanel.css:706-712`
- **Evidence**: `.wt-row--idle { opacity: 0.72 }` composites the whole row including branch text and badges. `forced-colors: active` does not reset CSS opacity, so the high-contrast case the comment says the choice was made for is not actually covered by it.
- **Impact**: In light and high-contrast themes where the base foreground is already muted, effective text contrast can fall below a readable threshold — for rows that remain fully interactive.
- **Fix**: Add a `@media (forced-colors: active) { .wt-row--idle { opacity: 1 } }` override with a non-colour distinction retained, and check the composited contrast in the light theme.

### S3 — The idle-tail tests are single-repo only, and the "row duties" test never exercises the menu
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: chair + asm-review-frontend
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts` (`describe("the idle tail")`)
- **Evidence**: Every fixture in the new suite builds `repos: [ … ]` with exactly one repo, so no test can produce a repo header — which is what hides B2. `"keeps an agentless worktree's row duties — menu and keyboard reach"` asserts `role="treeitem"` and an ArrowDown, and never invokes `onContextMenu`, despite the requirement text naming the context menu explicitly.
- **Fix**: Add a two-repo case to the suite (it also covers B2's fix), and dispatch a `contextmenu` event on an idle row asserting the menu handler runs.

### S4 — `toggleIdleTail` is a third copy of the set-toggle/persist/repaint body
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-reuse
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:415-424` vs `toggleCollapsed` at `:488-496`
- **Evidence**: Identical membership toggle, `persistCollapsed`, and `repaint` sequence; only the key derivation differs. Both write the same set.
- **Impact**: A future change to collapse persistence ordering or repaint behaviour can update one path and miss the other — and B1 is precisely that shape of divergence (one path gained a query guard, the other did not).
- **Fix**: Extract the shared toggle-persist-repaint operation and have both call it, keeping `toggleCollapsed`'s behaviour as the source.

### S5 — `renderShowAll`'s doc comment was orphaned onto `renderIdleDisclosure`
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:777-782`
- **Evidence**: `/** Cap with an affordance rather than truncating silently (§ 8). */` now sits directly above the new `renderIdleDisclosure` JSDoc block, and `renderShowAll` at `:808` has no doc comment. The new function was inserted between the old comment and the function it described.
- **Fix**: Move the cap comment back onto `renderShowAll`.

### S6 — The idle partition materialises every matching worktree before the cap
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5
- **Agent**: asm-review-performance
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:762-766` (`shownWorktrees`)
- **Evidence**: For `M` matching worktrees, `visible` scans all `M`, then two further full `isIdle` passes build an `ordered` array of all `M` before `slice(0, 20)`. `pruneStaleState` adds another `M`-item idle-count scan per signature-changing push. Post-admission cost is ~5 `isIdle` calls per drawn row with `K ≤ 20`.
- **Impact**: The growth axis is worktrees-per-repo, and the render cap is 20, so the work is linear in a quantity a user creates by hand. Not a scale defect — recorded because `setQuery` repaints per keystroke and now does the extra partition each time. The full teardown and per-keystroke repaint both predate this change.
- **Fix**: Optional — classify and count in one pass while retaining only the first 20 in active-then-idle order.

### A1 — Over-seeding when the cap consumes the entire tail
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5 · **Status**: audit-backlog (non-gating)
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:565-582` (`pruneStaleState`)
- **Evidence**: `idleCount` is computed from `repo.worktrees` (unfiltered, uncapped) while `folds` is computed from `shown` (filtered, capped). With 21 agent-holders and 4 idle at cap 20, the partition pushes all 4 idle past the cap, `tail.length === 0`, no disclosure is drawn — yet the repo is marked seeded and the fold key persisted. The divergence is one-directional (`idleCount >= tail.length`), so under-seeding is impossible and a disclosure can never be drawn for an unseeded repo. Consequence is benign: the marker and the fold key are written together, so whenever the disclosure eventually is drawn (Show all, or the repo shrinking) it appears folded, which is the intended default. The uncapped `idleCount` is in fact what makes "Show all" safe, since `repaint()` does not prune.
- **Fix**: None required — add a comment saying the two computations are deliberately different, so it does not read as an oversight.

### A2 — Latent depth collision: an in-tail worktree row shares depth 2 with `.wt-arow`
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5 · **Status**: audit-backlog (non-gating)
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1158-1172` (`depthOf`)
- **Evidence**: `.wt-row--in-tail` returns 2, the same as `.wt-arow`. Inert today because an in-tail row is `isIdle` and therefore has zero agent rows, so no `.wt-arow` can ever follow one.
- **Impact**: If the tail ever admits a row with agents, `parentOf` would skip the worktree row and ArrowRight would refuse to descend into it.
- **Fix**: None now. Note the coupling next to `depthOf` so the invariant is visible if the tail's membership rule changes.

---

## Verified safe (full-flow trace, no finding)

Recorded so a later round does not re-litigate these.

- **The idleness predicate.** `isIdle` reads `this.data`, `isIdleIn` the incoming envelope, and `pruneStaleState` is only ever called with `this.data` after `setData` assigned it, so the two cannot disagree within a render. Null presence or any `degradedSources` entry ⇒ `idleCount === 0` for every repo ⇒ no seeding, no tail, no folding. Degrade-after-fold un-folds every row while `collapsed` retains the tail key; recovery restores the fold (chair probe confirms 5 rows drawn under degradation). **No path folds an unreadable worktree away.**
- **Cap vs fold, full matrix.** Repo collapsed (multi-repo) → `renderRepo` returns before `shownWorktrees`, neither affordance exists. Filter active → `shown` is post-filter and `shown.length < visible.length` compares post-filter sets. Uncapped → `ordered` returned whole, no "Show all". Capped with a tail past the threshold → disclosure says 4, "Show all" says 24, the 4 excluded are the cap's alone. **The two counts never overlap.** (Presentational note for the design owner, not a defect: while capped *and* folded the user sees "4 idle worktrees" and "Show all 24", and the 4 cap-excluded idle rows are only implied by arithmetic.)
- **Both change detections.** `idleSeeded`: the snapshot precedes the add loop; anything added is a `repoId` that joins `liveIds` in the same iteration, so the post-loop prune can never remove it and an add/delete pair cannot cancel. `collapsed`: rebuilt into a local and compared against the pre-loop snapshot; membership order can differ and produce a *spurious* persist of identical content, never a skipped one. No wrong comparison, no skipped write.
- **Prune-only-on-signature-move.** Seeding cannot be missed by `repaint()`: `folds` is bounded by the `idleCount` the last prune saw. "Show all" is the sharpest case and is safe precisely because `idleCount` ignores the cap. Seeding cannot be duplicated (`Set.add` idempotent, write change-gated).
- **Prior change not regressed — confidence ceiling.** `renderedWorktreeIds()` reads `[data-worktree-id]` from the DOM and `renderWorktreeRow` is the only writer of that attribute, so a folded row is absent from `drawn`. A folded row is `isIdle`, i.e. its `rowsByWorktreeId` entry is empty or absent, so it could contribute no crossing candidate even if it were drawn. The author's claim holds. The partition strictly *improves* prior behaviour: the cap now sheds agentless worktrees first, so fewer crossing-capable rows fall past `MAX_WORKTREES_PER_REPO`.
- **Persisted-state surface.** `worktreeIdleTailSeeded` is purely additive and its only consumer reads it as `?? []`. Repo-wide grep finds no other reader, validator, migrator, or size-bounder of `worktreeCollapsed`, so the `NUL-prefixed idle-tail:<repoId>` key riding inside that array collides with nothing.
- **Modified pre-existing test — `WorktreeController.state.test.ts`.** Not weakened. The original exact-empty assertion would necessarily fail post-change for reasons unrelated to what it proved (expansion-by-omission on worktree keys); the narrowed form keeps that claim and adds a positive check that the namespaced idle-tail key is seeded.
- **Modified pre-existing test — `WorktreeView.test.ts` `mount()` default.** Supplying `getInitialIdleSeeded: () => [REPO_ID]` for the whole file is legitimate and correctly rationalised: it leaves the tail presented-and-open so tests about other contracts see their original picture. The cost, recorded rather than flagged, is that the fold's interaction with the rest of the panel's contracts is exercised nowhere outside the new suite.
- **Verify gate evidence.** `bun run asm change verify-status fold-idle-worktrees` records task 1_1 `[x] exit 0 scope-unchanged`, assertions +29, with the three test-change rationales attached. Lint parity (17 findings, byte-identical to pre-change HEAD) is recorded in `workflow.md` § Notes. Not re-run here.

## Accepted risk

None.

## Notes

- `asimov/changes/active` is listed in `.gitignore` but is a tracked file and received content in this range. `.gitignore` does not untrack; if the intent is for it to be untracked it needs `git rm --cached`. Machinery, non-gating, not counted as a finding.

---

## Author triage — round 1

Each finding verified against source before a status was assigned; none accepted on the
report's word alone.

**[B1] Filter-time activation destroys the persisted fold** — Status: **accepted**
Triage: reproduced. `idleTailFolded` guards on `this.query`; `toggleIdleTail` does not, so it
flips and persists the *stored* state while the rendered state is the query's. The workflow
note ("a filter reveals at RENDER time only, never by writing the fold open") describes
exactly the invariant the interaction path breaks. Fixing via the shared toggle helper the
duplication SUGGEST asks for, so the guard cannot diverge again.

**[B2] `keyOf` collides between a repo header and its idle disclosure** — Status: **accepted**
Triage: reproduced. The *collapse* key is namespaced; the *navigation* key is not.
`dataset.idleKey = repoId` is byte-identical to the header's `dataset.repoId`, and `keyOf`
reaches `repoId` first. My own note claimed the namespace prevents collision — it does, for
persistence only. Two key spaces, one namespaced: that is the defect.

**[W1] A folded tail suppresses its worktrees' action-result notices** — Status: **accepted**
Triage: reproduced. Same class as the defect I fixed during the build (tail rows losing
notices), reintroduced through the *folded* branch rather than the unfolded one. Fixing the
loop so a notice is emitted for a tail row whether or not the tail is drawn.

**[W2] `.wt-idle` has no `:focus-visible` rule** — Status: **accepted**
Triage: confirmed. `.wt-row--idle:focus-visible` exists but only resets opacity; it is not a
focus ring, and `.wt-idle` has none at all. Every other navigable row kind defines one.

**[W3] Two assertions are still vacuous** — Status: **accepted**
Triage: both confirmed. `drawn + hidden` passes for `6 + 0`; `.wt-glyph .wt-state` is null for
any agentless worktree since `strongestActivity([], …)` is `undefined`, so the "no presence
block" clause had nothing behind it — `.wt-presence` is the element that clause is about.
This is the third vacuous-assertion finding against me this session; both are being pinned to
the specific numbers and the specific element rather than to a sum and a side effect.

**[W4] The cap affordance reports the total, not the excluded remainder** — Status: **accepted**
Triage: confirmed — `Show all ${total} worktrees` against a requirement reading "SHALL report
only what the cap excludes". The clause is this change's own ADDED requirement, so meeting it
is remediation inside the accepted contract, not a spec change: no handback. The label becomes
the excluded count. Its pre-existing assertion moves with it — declared, not weakened.

### Suggestions
- **accepted** — `role="group"` + `aria-level` so the tail's ownership reaches AT.
- **accepted** — reset `opacity` under `forced-colors: active`. My CSS comment claimed opacity
  "must survive a high-contrast theme"; opacity dims contrast there rather than surviving it.
  The comment was wrong and is corrected with the rule.
- **accepted** — multi-repo idle-tail coverage. This single gap hid B2 entirely; a blocker that
  only a fixture shape concealed is worth more than the assertion it would have carried.
- **accepted** — `toggleIdleTail` duplication. Folded into B1's fix rather than treated
  separately: the divergence and the duplication are one defect.
- **accepted** — `renderShowAll`'s orphaned doc comment reattached.
- **audit-backlog** — partition materialises matching worktrees before the cap. Bounded by the
  worktree count of one repository, which the cap already assumes fits in memory.

### Audit backlog (chair's, carried unchanged)
- Over-seeding when the cap consumes the entire tail — comment, not a fix.
- `.wt-row--in-tail` shares depth 2 with `.wt-arow`, inert while tail rows hold no agent rows.

Rebutted: none.
