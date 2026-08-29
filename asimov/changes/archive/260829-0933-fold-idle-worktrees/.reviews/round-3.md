# Review round 3 — fold-idle-worktrees

- **Date**: 2026-08-29
- **Cycle**: 2
- **Mode**: discovery
- **Head**: `0a597454` (tree dirty only in `asimov/changes/fold-idle-worktrees/analytics.json` and `.analytics-cursor.json` — machinery, outside the reviewed scope)
- **Scope**: range `dce86a1e..HEAD`. Spans this change's round-1 fix (`c613d51f`), the re-plan (`d91f1da8`, `b9467406`), this change's round-2 fix (`0a597454`), **and** the extracted sibling change `place-every-action-result` (`320a4a9a`, `e0230fa4`, `5eba0da7`, archived `9c9c3971`). The sibling was reviewed to APPROVE in its own cycle and is treated as **landed baseline**; only the integration seam with it was reviewed here.
- **Reviewable lines**: 222 production in range (`WorktreeView.ts` 207, `worktreePanel.css` 14, `worktreeTreeView.ts` 1). Of these, this change's own delta is 39+14+10 (round 1) and 23+2 (round 2); the remainder is the landed sibling. Tests reviewed inline (Phase 2.5): 373 added across the range. `asimov/**` and `docs/**` skipped per classification, read as artifacts.
- **Verdict**: **WARN**
- **Counts**: 0 BLOCK · 3 WARN · 5 SUGGEST (+ 4 audit-backlog)
- **Split over gating blockers**: no gating blockers. All three WARNs classify `feature`.

**Scope lock (discovery)**: the cycle-1 supersede routed correctly. The new invariant owner ("an action result is rendered somewhere, and says what it is about") was extracted into `place-every-action-result`, reviewed to APPROVE independently, and archived; the cap-clause conflict re-entered plan at Gate 2 and `workflow.md` records `[x] Gate 2: plan approved`. This round therefore scopes the seam, not the whole sibling. Prior `audit-backlog` entries are re-listed below, not re-reported.

## Agents

| Agent | Region / lens | Model |
|---|---|---|
| chair | full range, all lenses + full-flow trace + 10 scratch probes | opus-5[1m] |
| asm-review-frontend | a11y ladder, keyboard model, focus retention, rendering | opus[1M] |
| asm-review-logic | fold/cap/filter composition, persistence, placement seam | gpt-5.6-terra[1M] |
| asm-review-contracts | spec-delta conformance, cap semantics, vacuity hunt | sonnet[1M] |
| asm-review-reuse | row-kind taxonomy, depth model, duplication of a split | gpt-5.6-luna[1M] |

`asm-review-logic` returned a null report for the second cycle running — recorded as a null result, not as corroboration of anyone's verification.
Not spawned: data-security, performance — the diff touches no persistence beyond a namespaced key already reviewed, no auth, no network, and no growth axis beyond the carried A3.

---

## Round-2 fix verification

Each verified at the invariant level, against source and scratch probes (created and deleted in one command).

### [B3] The cap affordance contradicted an unmodified base requirement — **fixed** (contract closed)
The delta requirement is renamed **"The display cap is resolved before the idle fold"** and its body now
defers explicitly: *"What the capping affordance itself states is unchanged and remains owned by
[A capped listing says it is capped]"*. The overreaching clause is gone. `renderShowAll(visible.length)`
with `Show all ${total} worktrees` is **byte-identical to `dce86a1e`** (verified with
`git show dce86a1e:src/webview/worktree/worktreeTreeView.ts`), so the base requirement is satisfied by
the same code that satisfied it before the cycle. The new title is true of its own body and both
scenarios; the delta's `## MODIFIED` section correctly still lists only *"Present the supplied worktree
tree"*, because nothing else is now amended. `docs/design/worktree-panel-ui.md` § 8 no longer conflicts.
Every `tasks.md` 1_3 Ref resolves to a heading that exists. Round-2 **S8** (stale "Show all" wording in a
test name, `MAX_WORKTREES_PER_REPO`'s comment and the CSS comment) closes with the revert — all three now
read correctly again, and the pre-existing assertion `expect(showAll?.textContent).toBe("Show all 34
worktrees")` is back at `WorktreeView.test.ts:1057`.

### [W5] The query guard left the disclosure inert — **fixed** (invariant closed, with one test cost)
`folds = tail.length >= IDLE_FOLD_THRESHOLD && !this.query` removes the disclosure entirely while a
filter is up, so no row carrying `aria-expanded` exists for `expandOrDescend` to consume ArrowLeft on.
Chair probe (single repo, `setQuery("spike")`): DOM is
`["wt-row wt-row--idle|L1|spike-a", … ×4]` — no `.wt-idle`, no `.wt-row--in-tail`, all at depth 1.
ArrowLeft from `spike-b` reaches `parentOf`, which correctly finds no shallower row single-repo and
leaves focus put — the row is navigable, not inert. Chair probe, **multi-repo filtered**:
`["wt-repo|L1|other1","wt-row wt-row--idle|L2|zzz"]` — the revealed row is depth 1 against a depth-0
header, so ArrowLeft climbs out. The trap is genuinely gone.
Fold-state persistence across the reveal holds (chair probe P6): open the tail → 4 `.wt-row--in-tail`
rows; `setQuery("a")` → one flat row, no disclosure; `setQuery("")` → the tail is open again, all four
`--in-tail` rows back. `toggleIdleTail` never runs, so nothing is spent.
**Cost**, reported below as **W2**: the guard this fix makes unreachable was the subject of round-1 B1,
and its only test is now vacuous.

### [W8] `aria-level` partial and one off multi-repo — **fixed** (ladder correct, coverage incomplete)
One `stampLevels(multiRepo)` pass over `navRows()`, and both per-element writes in `worktreeTreeView.ts`
are gone. Chair probe, multi-repo, tail open, live worktree expanded:
`["wt-repo|L1","wt-row|L2","wt-arow|L3","wt-idle|L2","wt-row--in-tail|L3" ×4]` — every navigable kind
stamped, disclosure a child of the header rather than its sibling, tail rows children of the disclosure.
Single-repo: `["wt-row|L1","wt-idle|L1","wt-row--in-tail|L2"]`, offset correctly withheld.
The offset can never be declared without a level-1 row: `renderRepo`'s early return (`visible.length === 0
&& !repo.degraded`) fires *before* the header append, so a repo that draws anything always draws its
header first. Chair probe with the second repo filtered away entirely: `["wt-repo|L1|repo1","wt-row|L2|
live"]` — header present. With all repos filtered away, `navRows()` is empty and only `noMatch` draws.
`aria-level="0"` is unreachable, since `depthOf` returns 0 only for `.wt-repo`, which exists only when
the offset is 1.
**Coverage gap**, reported below as **W3**: the ladder test pins only the four kinds this change touched.

### [W6 + W7] Notice reach — **closed in `place-every-action-result`** (seam verified here)
Nothing in 1_3 claims these and nothing in it addresses them; they closed in the extracted change. The
seam is verified rather than the mechanism:
- **Folded idle worktree** (chair probe P1): a failed remove on `/wt/c` while the tail is folded renders
  `wt-notice--error` at the end of the repo section reading *"Couldn't remove this worktree. **c** boom"*
  — named, exactly once. W6's condition is gone.
- **Cap-excluded idle worktree** (chair probe P2): 16 agent-holders + 10 agentless, cap 20. 16 rows drawn,
  `Show all 26 worktrees`, `4 idle worktrees`, and a result on the cap-excluded `/wt/idle-9` renders,
  named `idle-9`, after the cap affordance. W7's condition is gone — this is the exact fixture that was
  absent from the DOM entirely in round 2.
- **Filter-revealed idle worktree**: the row is drawn, so `renderedWorktreeRows()` finds it and the result
  anchors to the row itself, not the repo. No branch of the fold can hide a result any more, because
  `placeResults` asks the DOM what was drawn rather than re-deciding what should have been.
- **`stampLevels` before `placeResults`**: safe. Every branch of `buildActionNotice` returns
  `renderNotice(...)`, which builds a `div.wt-notice` whose only element children are `span` and `button`.
  Nothing it inserts matches the `navRows()` selector, so nothing lands unstamped in the ladder or in the
  arrow-key set. Verified by reading every branch and by the probes above.

### Round-2 suggestions
- **S7** — the predicted regression **occurred**. Escalated to **W2** with a stated evidence delta.
- **S8** — **fixed** by B3's revert (see above).
- **S9** — **not addressed**; carried as **S3**.
- **S10** — **fixed**. The context-menu test now dispatches `contextmenu` on the idle row and the
  assertion is genuinely row-scoped: `worktreeTreeView.ts:306` attaches the listener per row (not
  delegated at `document`), `renderWorktree` wires `onContextMenu` for idle rows too, `mount()` supplies
  `noopActions()` so `this.menu` exists, and `afterEach` clears `document.body`. Falsifiable.

---

## Findings

### W1 — The disclosure retains focus on the keyboard path only; a pointer toggle moves it to a different row
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-frontend + chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:699-712` (`renderListing`'s focus capture), `:1272-1282` (`syncRovingTabindex`), `:1344-1353` (`focusRow`); `src/webview/worktree/worktreeTreeView.ts:58-66` (`bindActivation`)
- **Evidence**: `focusedKey` is written in exactly two places — `syncRovingTabindex` and `focusRow` — and there is no `focusin`/`focus` listener on `this.element` (grep confirms). `bindActivation` binds a bare `click` with no `mousedown` handling, and `renderIdleDisclosure` gives the row `tabIndex = -1`, which Chromium (the webview engine) focuses on click. So a pointer toggle runs `toggleIdleTail → toggleKey → repaint → render` with the disclosure focused but `focusedKey` still holding whatever the last *arrow* landing was — or, with no prior arrowing, `keyOf(rows[0])`, which `syncRovingTabindex` assigns unconditionally on the first render. `renderListing` then computes `restoreFocusTo = this.focusedKey` (the stale key, because `this.element.contains(document.activeElement)` is true), and `render` focuses that row and moves the single tab stop to it. If Chromium did *not* focus the row, `activeElement` would be `<body>`, `restoreFocusTo` would be `null`, and the tab stop would still be reassigned to `rows[0]` by `syncRovingTabindex` — so the disclosure loses the stop on both branches.
- **Impact**: The accepted clause reads *"retain focus across the re-render its toggling causes"* without restricting to a device; its scenario is keyboard-scoped, and the keyboard path is correct because `expandOrDescend` calls `focusRow` first. A mouse user who folds or unfolds the tail has focus and the tab stop yanked to the top of the tree. jsdom does not focus on `HTMLElement.click()`, which is why `WorktreeView.test.ts:2378` and `:2458` are green while a real webview diverges — the defect is invisible to this suite by construction.
- **Note**: the mechanism is **pre-existing and systemic** — `.wt-repo` and `.wt-row` pointer toggles have the same behaviour and are unchanged code. What is new is a row kind that carries an explicit focus-retention clause. Reported against that clause, not against the pre-existing rows.
- **Fix**: add a `focusin` delegate beside the existing `keydown` one, setting `focusedKey` from `closest(".wt-repo, .wt-idle, .wt-row, .wt-arow, .wt-srow")`, so the roving stop and the restore key follow the last focused row regardless of device. That closes the disclosure's clause and the pre-existing rows in one place. Cover it with a test that focuses the row before clicking, since jsdom will not do it for you.

### W2 — The `[B1]` test is now vacuous: W5's fix removed the only coverage of `toggleIdleTail`'s query guard
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2458-2468` (`"[B1] a filter reveals the tail without letting a click on it spend the fold"`), against `src/webview/worktree/WorktreeView.ts:845-855` (`toggleIdleTail`)
- **Evidence**: The test body is `view.setQuery("spike"); … view.element.querySelector<HTMLElement>(".wt-idle")?.click(); view.setQuery(""); expect(branchesInOrder(view)).toEqual(["live"]);`. After the same commit's W5 fix, `folds` is false whenever `this.query` is set, so **no `.wt-idle` exists at that moment** — chair probe P3 confirms the filtered DOM holds four `.wt-row` elements and nothing else. The optional call is a silent no-op, and the comment directly above it (*"The disclosure reads open because the query revealed it — activating it here must not write that transient state over the fold the user actually chose"*) is now false of the code it annotates. Mutation check: deleting `if (this.query) { return; }` from `toggleIdleTail` leaves this test green, because nothing reaches `toggleIdleTail` at all. This is round-2 **S7**'s predicted failure, realised by this round's own fix — the stated evidence delta for the escalation from SUGGEST.
- **Impact**: Round-1 B1 was a BLOCK — a filter-time activation spending the user's persisted fold. Its regression guard now has zero coverage, and the guard itself is unreachable through any rendered control. If a future change re-renders a disclosure under a filter (undoing W5, which is the natural way to satisfy "reveal the tail" with a visible group header), nothing in the suite catches the re-opened write path. Two independent protections were collapsed into one, silently.
- **Fix**: two assertions, not one rewrite. (a) Add `expect(disclosure(view)).toBeNull()` before the click, so the test states the invariant it now actually proves — a filter draws no disclosure, therefore no control exists to spend the fold — and fails loudly if one returns. (b) Keep the guard covered by driving it directly rather than through a DOM control that no longer exists, or drop the guard and its comment if it is agreed to be unreachable. Do not leave a `?.click()` on a selector the production code guarantees is null.

### W3 — The ladder test pins only the four row kinds this change touched, which is the failure its own task named
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2498-2529` (`"[W8] declares the whole level ladder, single-repo and multi-repo alike"`), against `src/webview/worktree/WorktreeView.ts:1312-1327` (`depthOf`)
- **Evidence**: The multi-repo half pins exactly `.wt-repo`→`"1"`, `.wt-idle`→`"2"`, `.wt-row`→`"2"`, `.wt-row--in-tail`→`"3"`. `.wt-arow` and `.wt-srow` — the two kinds that carried no `aria-level` before this change and gained one from it — are pinned nowhere. The single-repo half asserts only `levels.every(l => l !== null)` and `new Set(levels)).toEqual(new Set(["1","2"]))`. Mutation check (by enumeration, deterministic): make `depthOf` return `1` for `.wt-arow`. Single-repo becomes `wt-row 1, wt-arow 1, wt-idle 1, in-tail 2` → set is still `{"1","2"}`, every value still non-null: **green**. Multi-repo becomes `wt-repo 1, wt-row 2, wt-arow 2, wt-idle 2, in-tail 3` → all four pinned assertions unchanged: **green**. Separately, no fixture in this test renders a `.wt-srow` at all, and a grep of the whole file finds `aria-level` asserted only at `:2505` and `:2526-2529` — subagent levels are never stamped under assertion anywhere in the suite.
- **Impact**: Task 1_3's Plan step 4 states the requirement in as many words: *"Assert the complete level ladder in both single- and multi-repo trees — asserting only the kinds this change touched is how the partial ladder got here."* The ladder shipped correct (verified by chair probe P8), but its guard reproduces the exact shape of the defect it was written to close: the kinds that were previously implicit remain the kinds nothing pins.
- **Fix**: pin the full ladder as one value, not as a set — e.g. assert the ordered `[className, level]` pairs, or add `expect(multi.view.element.querySelector(".wt-arow")?.getAttribute("aria-level")).toBe("3")` plus a fixture carrying an expanded subagent roster so `.wt-srow` is stamped and pinned at `"4"`. The single-repo half needs the same treatment; a `Set` of two values cannot distinguish a ladder from a two-valued constant.

### S1 — `role="tree"` holds tab-focusable non-`treeitem` children, so "one tab stop for the whole tree" is not true
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-frontend
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:809-816` (`renderShowAll`), `:720-739` (`renderNotice` action/dismiss buttons); consumed at `WorktreeView.ts:984-991` and `:1099-1127`
- **Evidence**: `renderShowAll` returns a bare `<button>` (default `tabIndex 0`) appended directly into the `role="tree"` element, and `renderNotice`'s `wt-link`/`wt-dismiss` buttons are the same — now inserted *between* rows by `placeResults` rather than only at a section end. None are in `navRows()`; none are `aria-hidden` (unlike `.wt-presence` and `.wt-agents`, which are both hidden and `tabIndex -1`). The comment at `WorktreeView.ts:1271` states "One tab stop for the whole tree".
- **Impact**: Tab does not leave the tree after the roving row. More materially, a screen-reader user arrowing the tree never encounters the cap affordance, which the accepted requirement *"Present the supplied worktree tree"* relies on for reachability (*"directly, or through a disclosure or capping affordance that reveals it"*). It stays Tab-reachable, so this is degraded rather than broken.
- **Note**: pre-existing and unchanged by this diff; reported because this change's own reachability requirement now leans on that affordance.
- **Fix**: host the cap button and the notices outside the `role="tree"` element, or give each a `treeitem` host that `navRows()`/`depthOf` recognise. At minimum correct the `syncRovingTabindex` comment so the documented model matches the DOM.

### S2 — The new level ladder is declared without `aria-posinset` / `aria-setsize`
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4
- **Agent**: asm-review-frontend
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1304-1309` (`stampLevels`)
- **Evidence**: Every navigable row is a flat DOM sibling of `.wt-tree` (or of a `role="none"` `.wt-card`, which re-parents to the tree). With `aria-level` now declared 1–4 but no `aria-posinset`/`aria-setsize`, AT derives set position from DOM order across the whole flattened list while the level says the rows are nested.
- **Impact**: a worktree that is item 2 of 3 under its repository announces as e.g. "level 2, 7 of 41". The level half is a real improvement over the two-kinds-only state; the position half now contradicts it.
- **Fix**: in the same pass, carry a per-level counter over `navRows()` in order — reset a level's counter whenever a shallower row is passed — and stamp `aria-posinset` and the sibling-group `aria-setsize` alongside `aria-level`.

### S3 — The local `twoRepoTree` still shadows the imported fixture of the same name *(persists from round 2, S9)*
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5
- **Agent**: asm-review-contracts + chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2430` vs the `./worktreeFixtures` import ending at `:30`
- **Evidence**: `function twoRepoTree(branches: string[])` inside `describe("the idle tail")` shadows the no-arg `twoRepoTree` imported from `./worktreeFixtures` and used at `:185`, `:226`, `:1592`, with a different arity and a different shape (the shared one carries a degraded second repo). The `[W8]` test then inlines a third, differently-built two-repo literal rather than reusing either. The sibling change's describe block adds no further collision — it uses its own `repo()`/`treeOf()` helpers.
- **Impact**: unchanged from round 2 — a future test in this block calling `twoRepoTree()` silently gets the local one. Now compounded by a third inline variant of the same fixture.
- **Fix**: rename the local helper (`twoRepoIdleTree`) and have the `[W8]` test use it instead of its inline literal.

### S4 — The row-kind taxonomy is stated in four production places plus the tests
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4
- **Agent**: asm-review-reuse (rated WARN; chair downgrades — see adjudication)
- **Class**: machinery
- **File**: `src/webview/worktree/WorktreeView.ts:1268` (`navRows` selector), `:1290` (`keyOf` dataset chain), `:1316` (`depthOf` class chain); `src/webview/worktree/worktreeTreeView.ts:789` (builder classes); restated at `WorktreeView.test.ts:2504`
- **Evidence**: adding `.wt-idle` required a coordinated edit to the builder, the selector, the key chain and the depth chain; `stampLevels` consumes `depthOf` and adds no fifth representation. The test's `levelsOf` helper hardcodes the same selector as `navRows`.
- **Impact**: the coupling is real but the change performed the coordination correctly and completely — no defect. The one live consequence is that the test's copy of the selector can drift from `navRows()`, so a future kind added to production but not to `levelsOf` would leave the ladder assertion silently narrower than it reads. That interacts with W3.
- **Fix**: if it is ever consolidated, have the builders emit one `data-row-kind` attribute and keep a single descriptor mapping kind → navigation key → depth, with `navRows`/`keyOf`/`depthOf` reading it and CSS classes left to styling. Cheaper interim: export the selector from `WorktreeView.ts` and have the test import it rather than restate it.

### S5 — "Show all N worktrees" states the filter-surviving count, not the repository's unconditional total
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5
- **Agent**: asm-review-contracts
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:986` — **unchanged code**, byte-identical to `dce86a1e`
- **Evidence**: `renderShowAll(visible.length, …)` where `visible = repo.worktrees.filter((w) => this.matches(w))`. Under an active query the affordance therefore states the matching count, while the base requirement says *"an affordance stating the full count"*.
- **Impact**: an ambiguity in the base requirement's own text, not a regression, and not introduced or touched by this change — the B3 revert restored precisely this expression. Recorded so the next revision of the cap requirement can settle "full count" against a filter; it does not gate this change.
- **Fix**: none here. Resolve when the cap-owning requirement is next opened.

---

## Audit backlog (non-gating)

- **A1** *(carried, round 1)* — Over-seeding when the cap consumes the entire tail (`WorktreeView.ts` `pruneStaleState`): `idleCount` is computed over all of a repo's worktrees while `folds` is computed over the filtered and capped `shown`, so a repo can be marked seeded and its tail key added to `collapsed` on a render that never draws a disclosure. Chair probe P5 confirms the outcome stays correct — first encounter under an active filter seeds `["/repo/.git"]`, and clearing the filter shows the tail folded, which is the required default. Benign and one-directional.
- **A2** *(carried, round 1 — now smaller)* — `.wt-row--in-tail` shares depth 2 with `.wt-arow` in `depthOf`. Still inert: an in-tail row is idle by construction, so `renderWorktree` returns before any `.wt-arow` or `.wt-card` exists, and the two never coexist in one subtree. Round 2's addendum — that `aria-level="2"` encoded the same coupling in a second place — **no longer applies**: the per-element write is gone and `stampLevels` derives the level from `depthOf`, so the coupling is back to one site.
- **A3** *(carried, round 1)* — the idle partition materialises every matching worktree before the cap. Bounded by one repository's worktree count, which the cap already assumes fits in memory.
- **A4** *(new)* — `toggleIdleTail`'s `if (this.query) { return; }` is now unreachable through any rendered control, since W5's fix means no disclosure exists while a query is up. Confirmed independently by asm-review-logic and asm-review-reuse. Kept as documented defence rather than removed; recorded so it is not mistaken for live coverage. Interacts with **W2**.

## Regression check — no previously closed finding reintroduced

- **Confidence-ceiling scheduler (prior change).** Intact. `renderedWorktreeIds()` now delegates to `renderedWorktreeRows()`, and `new Set(map.keys())` is set-identical to the old accumulation. `worktreeTreeView.ts:240` remains the **only** writer of `data-worktree-id` in `src/webview/` (grep confirms; the only other reference is the reader at `WorktreeView.ts:913`), and `renderNotice` writes no dataset, so `placeResults`' insertions add nothing to `drawn`. A folded row is still absent from the set and still holds no crossing candidate. Under a filter, idle rows now enter `drawn` where they previously did not — harmless, because idleness *is* zero agent rows, so they contribute no `stateStartedAt` and cannot move `nextCeilingCrossing`. `armCeiling` still runs after `render`, which still runs `renderListing` then `placeResults` in one pass.
- **`orphanedLabel` / notice-reach invariant (prior change round-3 B1, this change round-1 W1, round-2 W6+W7).** Closed at the owner level in `place-every-action-result`, not patched at another branch. Both open boundaries verified shut by chair probe against this change's own display rules — see the W6+W7 entry above. The inventory stopped expanding.
- **Round-1 B1's persistence path.** Still closed: `toggleKey` is the single writer, `toggleIdleTail` the single guarded caller. But its *coverage* regressed — see **W2**.
- **Round-1 B2's key collision.** Still closed and not relocated. `keyOf` branches on `dataset.idleKey` first; `renderIdleDisclosure` is its only writer; all consumers (`syncRovingTabindex`, `focusRow`, `render`'s restore, both `expandOrDescend` lookups) go through `keyOf` or re-namespace before comparing. A grep for `idleKey` across non-test sources finds no raw comparison against a `keyOf` result.
- **Round-2 W4/B3's cap arithmetic.** Reverted to the baseline expression; the pre-existing assertion at `WorktreeView.test.ts:1057` guards it again.
- **Vacuous assertions.** Every assertion added or edited in the range was walked, concentrating on the five behaviours the author did **not** mutate. Falsifiable: the `contextmenu` dispatch (row-scoped listener, `noopActions()` supplied, `afterEach` clears the body); the `.wt-presence` next-sibling pair with its positive control (a mutation that appended a pill for a rowless worktree flips it); the `{drawn, hidden}` pair; `[B2]`'s focus and tab-stop assertions; the sibling block's ordinal and label-collision assertions. **Not** falsifiable: `[B1]`'s `?.click()` (→ **W2**) and the `.wt-arow`/`.wt-srow` halves of the ladder (→ **W3**).

## Accepted risk

None.

## Notes

- Verify-gate evidence not re-run per chair rules: full suite 4815 passed / 235 files, type check clean, `gate:fs-deletion` ok, `biome check src` 17 findings set-identical to the pre-change baseline on a detached worktree — as reported by the author and recorded in `workflow.md` § Notes.
- Chair probes were vitest scratch files under `src/webview/worktree/`, each created and deleted in the same command; none survives.
- `workflow.md` § Notes carries the `Blueprint: / Lane: / Planned at:` block twice — an artefact of the re-plan appending rather than replacing. Cosmetic; worth tidying before archive.
- `asimov/changes/active` remains listed in `.gitignore` while tracked (round-1 note, unchanged).
- `asm-review-logic` returned a null report for the second consecutive cycle on this change. Recorded, not treated as corroboration.

---

## Author triage — cycle 2 round 1

Accepted: all three. Rebutted: none. No blockers, so the cycle exits at re-verify.

**[W1] Focus retention is keyboard-only** — accepted. `focusedKey` has no `focusin`
writer, so a pointer toggle re-renders against a stale key. Pre-existing and systemic
across every row kind, but this change is what added an explicit focus-retention clause
to a requirement, so it is this change's to close. A `focusin` delegate closes it for all
kinds at once rather than patching the one row that happens to have the clause.

**[W2] The `[B1]` test went vacuous when W5 landed** — accepted, and I called this exact
regression one turn before the report arrived without acting on it, which is worse than
not having seen it. W5 removed the disclosure under a filter, so the test's
`querySelector(".wt-idle")?.click()` is a no-op and its comment describes code that can
no longer run. The B1 scenario is now unreachable by construction, so the test is
rewritten to assert the contract that IS reachable — a filter must not disturb the fold
state either way — across both a folded and a user-opened tail. The guard itself stays,
documented unreachable: it is the thing that would catch a future change re-rendering a
disclosure under a filter, which is precisely how B1 happened.

**[W3] The ladder test pins only the kinds this change touched** — accepted, and the
sharpest of the three: my own Plan step 4 said "asserting only the kinds this change
touched is how the partial ladder got here", and then I did that. The chair's mutation —
`depthOf` returning 1 for `.wt-arow` — is green on both halves, and no fixture in the
test renders a `.wt-srow` at all. Pinning the full ladder including agent and subagent
rows.

### Suggestions
- audit-backlog — `role="tree"` holds tab-focusable non-`treeitem` children, so "one tab
  stop" is untrue and an arrow user cannot reach the cap affordance. Pre-existing, real,
  and larger than this change: it needs the tree's focus contract reopened, not a patch.
- audit-backlog — `aria-level` without `aria-posinset`/`aria-setsize`. Same owner as above.
- accepted — the local `twoRepoTree` shadows the imported fixture; folded into W3's rewrite.
- audit-backlog — the row-kind taxonomy is stated in four production places plus the
  test's copy of the `navRows` selector. W3's fix reduces the live risk; unifying the
  taxonomy is its own change.
- noted — "Show all N" states the filter-surviving count. Unchanged code, byte-identical
  to `dce86a1e`; recorded for the cap requirement's next revision, not this one.

**A4 accepted into the backlog**: `toggleIdleTail`'s query guard is unreachable through
any rendered control. Kept deliberately, same standard the sibling change applied to its
detached-anchor guard: an unreachable guard against a silent, previously-shipped failure
earns its place if it says so.
