# Review round 2 — fold-idle-worktrees

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: verification
- **Head**: c613d51f (tree clean for `src/`; `asimov/changes/active` and this folder's `round-1.md` dirty — the author's triage append — both outside the reviewed scope)
- **Scope**: range `dce86a1e..HEAD`, one commit. Fix diff + its behavioral impact cone (focus/tab-stop machinery, notice reach, cap affordance, persisted collapse set).
- **Reviewable lines**: 63 (WorktreeView.ts 39, worktreePanel.css 14, worktreeTreeView.ts 10). Tests reviewed inline (Phase 2.5, 74 added). `asimov/**` machinery skipped.
- **Verdict**: **BLOCK**
- **Counts**: 1 BLOCK · 4 WARN · 4 SUGGEST (+ 2 audit-backlog carried, 1 SUGGEST persisting)
- **Split over gating blockers**: 1 feature / 0 machinery

**Scope lock**: passed. The diff carries one remediation task (`1_2`), no new capability, no new or semantically changed contract, no new invariant owner. `specs/worktree-panel/spec.md` is byte-unchanged in this range.

## Agents

| Agent | Region / lens | Model |
|---|---|---|
| chair | full fix diff, all lenses + keyboard/notice flow trace + scratch probes | opus-5[1m] |
| asm-review-frontend | disclosure keyboard model, focus/tab-stop cone, a11y, notice reach | opus[1M] |
| asm-review-logic | guard placement, identity invariants, notice duplication, cap arithmetic | gpt-5.6-terra[1M] |
| asm-review-contracts | accepted-spec conformance, test integrity / vacuity hunt | sonnet[1M] |

`asm-review-logic` returned a null report ("no logic/complexity issues found") — recorded as a null result, not as corroboration.
Not spawned: data-security, performance, reuse — the cone touches no persistence, auth, network, growth axis, or new abstraction. Reuse checked inline by the chair.

---

## Round-1 fix verification

Each verified at the invariant level, against source and scratch probes (created and deleted in one command).

### [B1] Filter-time activation destroys the persisted fold — **fixed** (invariant closed)
The invariant is *"a render whose fold state came from the query must not write fold state."*
`toggleIdleTail` now returns before any write when `this.query` is non-empty, and it is the only
path that can reach `idleTailKey(...)`: the disclosure's click handler and `expandOrDescend`'s
`idleKey` branch both call it, and `toggleCollapsed` is only ever called with a `repoId`,
`worktreeId` or `rowId` read off a row that carries no `idleKey`. Chair probe (single- and
two-repo, tail seeded folded): `setQuery("spike")` → 4 tail rows shown; click `.wt-idle` →
rows unchanged; `setQuery("")` → `["live"]`. The fold survives. **The divergence was not moved**
— the shared `toggleKey` carries no query knowledge, and `toggleCollapsed` delegates to it
unchanged, so no pre-existing caller changed behavior. The duplication SUGGEST (round-1 S4)
closes with it.
Residual, reported below as **W5**: the guard closes the write path by making the control inert
rather than by removing it.

### [B2] `keyOf` collides between a repo header and its idle disclosure — **fixed** (invariant closed)
`keyOf` now branches on `dataset.idleKey` before the `??` chain and returns `idleTailKey(...)`.
`renderIdleDisclosure` (`worktreeTreeView.ts:798`) is the only writer of `dataset.idleKey`, and
`row.dataset.worktreeId` (`:241`) the only writer of the attribute the confidence ceiling reads,
so the two key spaces are disjoint: `.wt-repo`→`repoId`, `.wt-row`→`worktreeId`, `.wt-arow`→
`rowId`, `.wt-srow`→`subKey`, `.wt-idle`→`\0idle-tail:<repoId>`. The `\0` prefix cannot be
produced by any path-derived id, so no pair of rows returns the same key and the empty-string
fallback stays unreachable for every drawn row kind.
All five consumers agree on the namespaced form: `render()` restoration (`:755`),
`syncRovingTabindex` (`:1152`), `focusRow` (`:1215`), and both `expandOrDescend` lookups
(`:1272` builds the namespaced key; `:1283` builds `treeId ?? rowId`, which a `.wt-idle` row
carries neither of and therefore cannot reach).
**End-to-end keyboard trace on a two-repo tree** (chair probe, folded tail, 4 idle rows):
- ArrowRight on `.wt-idle` → tail opens (5 rows), `activeElement` is `wt-idle`, `[tabindex="0"]` is `["wt-idle"]`
- ArrowRight again → descends to `/wt/a` (`wt-row wt-row--idle wt-row--in-tail`)
- ArrowDown → `/wt/b`
- **ArrowLeft from a tail row → climbs to the disclosure** (`parentOf` scans back past the depth-2 siblings to the depth-1 `.wt-idle`)
- ArrowLeft again → closes the tail (1 row), focus retained on the disclosure
- **ArrowLeft again → climbs to the repo header** (`wt-repo`), the disclosure now reading `aria-expanded="false"` so the toggle branch is not entered
- **Focus restoration across a push**: after `setData` with a changed tree, `activeElement` is still `wt-idle` and the single tab stop is still `["wt-idle"]`

### [W1] A folded tail suppresses its worktrees' action-result notices — **partially fixed**
The folded branch now emits them, exactly once (chair probe: one occurrence of the error string;
`resultsFor(undefined, repoId)` cannot double-render because it requires `!r.worktreeId`, and the
lead loop `continue`s on precisely the rows the folded branch covers). No `[data-worktree-id]`
element is added — `renderNotice` writes none — so the prior change's confidence-ceiling
scheduler is untouched and round-1's "a folded row is absent from `drawn`" claim still holds.
Two boundaries of the same invariant remain open: **W6** (the notice names no worktree) and
**W7** (a cap-excluded idle row's notice still renders nowhere). See the invariant note under W7.

### [W2] `.wt-idle` has no `:focus-visible` — **fixed**
`worktreePanel.css:739-743` adds `outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px`,
matching every other navigable row kind.

### [W3] Two vacuous assertions — **fixed**
`{drawn, hidden}` is pinned to both numbers; the presence clause now asserts
`.wt-presence` on the row's **next sibling** with a positive control (`withAgent`) alongside the
negative. `parentElement` was indeed the wrong scope — for an unexpanded row it is the whole
view and would have matched the other row's pill. Both clauses are falsifiable.

### [W4] The cap affordance reports the total — **code fixed, contract not** → see **B3**
`renderShowAll(visible.length - shown.length)` is the true excluded count on every path:
uncapped → `shown.length === visible.length` and the affordance is not rendered at all; filtered →
both terms are post-filter; collapsed repo → `renderRepo` returns before either. The `if` guard
makes `excluded >= 1` always, and the singular/plural branch is correct (chair probe: 21
worktrees → `"Show 1 more worktree"`; 34 → `"Show 14 more worktrees"`). The defect is not the
arithmetic; it is that the string now contradicts an accepted requirement this change never
modified.

### Round-1 suggestions
- `aria-level` — **partially addressed, and the partial address is itself a defect**: see **W8**.
- `forced-colors: active` opacity reset — **fixed and correctly scoped.** Same specificity (0,1,0) as the base rule and later in source order, so it wins; the following `.wt-row--idle:hover, :focus-visible` rule is (0,2,0) and also sets `opacity: 1`, so it cannot re-dim. The corrected comment matches the behavior.
- Multi-repo coverage — **added** (`[B2]` test), and it is the coverage that would have caught B2.
- `renderShowAll`'s doc comment — **reattached.**
- `toggleIdleTail` duplication — **fixed** via `toggleKey`.
- Context-menu half of round-1 S3 — **not addressed**; carried as **S10**.

---

## Findings

### B3 — The cap affordance now contradicts an accepted base requirement the change never modified
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: chair + asm-review-contracts (independently reached; contracts rated WARN, chair escalates — see adjudication)
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:813-821` (`renderShowAll`) against `asimov/specs/worktree-panel/spec.md:116-118` and `asimov/changes/fold-idle-worktrees/specs/worktree-panel/spec.md:1-6`
- **Evidence**: The applied base spec carries **Requirement: A capped listing says it is capped** — *"WHEN a repository holds more worktrees than the view renders at once, it SHALL render an affordance **stating the full count** and revealing the remainder on request, rather than truncating silently."* This change's ADDED requirement says *"The capping affordance SHALL report only what the cap excludes."* The two are directly contradictory, and the delta spec's `## MODIFIED Requirements` section lists **only** *"Present the supplied worktree tree"* — the capped-listing requirement is not amended, not removed, not mentioned. W4's fix changed the button from `Show all 34 worktrees` (the full count, satisfying the base requirement) to `Show 14 more worktrees` (the remainder, violating it). `docs/design/worktree-panel-ui.md` § 8 likewise still reads *"cap with a 'show all' affordance"*. The test that guarded the base requirement (`WorktreeView.test.ts:1041`, `"caps a large repo with a Show all affordance rather than truncating silently"`) had its assertion rewritten to the new string, so no test asserts the base contract any more.
- **Impact**: On `asm change apply`, the delta merges into a spec set that will then hold two mutually contradictory requirements about the same affordance, with the shipped code violating one of them and no test guarding it. The author's triage reasoned *"The clause is this change's own ADDED requirement, so meeting it is remediation inside the accepted contract: no handback."* That reasoning is sound for the ADDED clause and incomplete: an added clause cannot silently repeal an unmodified one. This is the answer to the author's question 3 — the string change was **not** legitimately inside the accepted contract.
- **Fix**: Artifact handback, not a code revert. Add *"A capped listing says it is capped"* to the delta's `## MODIFIED Requirements` with wording that states what the cap excludes, re-approve at Gate 2, and update `docs/design/worktree-panel-ui.md` § 8 to match. Then rename the test at `:1041` so it names the contract it now asserts. If Gate 2 declines the amendment, revert `renderShowAll` and correct the ADDED clause instead — but do not leave the two texts in conflict.

### W5 — The B1 guard leaves an inert disclosure: activation does nothing, and ArrowLeft can no longer climb out of it
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair + asm-review-frontend (independently reproduced)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:799-806` (`toggleIdleTail`) with `:1268-1274` (`expandOrDescend`)
- **Evidence**: While `this.query` is set, `idleTailFolded` returns `false`, so the row still renders `role="treeitem"`, `aria-expanded="true"`, a pointer cursor, a hover background and a rotatable chevron, and activation is still bound. Click, Enter and ArrowLeft all reach `toggleIdleTail`, which returns immediately — no repaint, no state change, no message. ArrowLeft is the sharper case: because the row reads open, `forward !== isOpen` holds and `expandOrDescend` enters the toggle branch and `return`s, so it never falls through to `parentOf`. Chair probe, two-repo tree, `setQuery("spike")`: `aria-expanded` is `"true"`; three consecutive ArrowLeft presses leave `activeElement.className === "wt-idle"` every time; Enter leaves `aria-expanded` at `"true"`. The user cannot reach the repo header from the disclosure while a filter is up.
- **Impact**: Round-1 B1's persistence defect is closed, but the half of its impact statement reading *"`aria-expanded` never responds to activation, which is also an assistive-tech lie"* is not — the control still announces itself as an operable disclosure and still does nothing when operated. Round-1's Fix text offered this exact option ("return early from `toggleIdleTail`"), so this is not a rejected fix; it is the cost of the option chosen, and the second option it offered ("render the disclosure non-interactive while a query is active") would have closed both halves. The swallowed ArrowLeft is new behavior, not a round-1 residue.
- **Fix**: While `this.query` is non-empty, render the tail summary as a non-interactive line — no `aria-expanded`, no `role="treeitem"` toggle affordance, no activation binding — since the tail rows are individually navigable anyway. Minimum acceptable: let ArrowLeft fall through to `parentOf` instead of being consumed by the toggle branch.

### W6 — A folded tail's notices name no worktree — the `orphanedLabel` defect, reintroduced through a third route
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair + asm-review-frontend
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:916-924` (folded branch) with `:1062-1068` (`buildActionNotice`)
- **Evidence**: `buildActionNotice` derives its self-identification solely from `result.orphanedLabel`, which `WorktreeController.rescope` (`WorktreeController.ts:780`) sets **only** for a worktree absent from the tree. A folded worktree is present, so `orphanedLabel` is `undefined` and `withAbout` prefixes nothing. The `info` argument is used only to wire the "Force remove…" dialog, never to label the text. Chair probe, folded tail with two failed removes on `/wt/c` and `/wt/d`, full rendered text: `"live4 idle worktreesCouldn't remove this worktree.could not removeCouldn't remove this worktree.also failed"` — two notices, indistinguishable, each pointing at "this worktree" with no row on screen to point at. The new `[W1]` test asserts only that the raw git error string appears, so it passes either way.
- **Impact**: This is the condition `orphanedLabel` exists to prevent — a notice with no row above it to say what it is about — restated by the fix for W1, which was itself a recurrence of the prior change's round-3 B1. With several tail rows carrying results the user cannot tell which worktree failed.
- **Fix**: Give `buildActionNotice` an explicit "about" override and pass the tail worktree's branch label from the folded branch, so `withAbout` prefixes it the way an orphaned result is prefixed. Extend the `[W1]` test to assert the branch is named.

### W7 — A cap-excluded idle worktree's notice still renders nowhere, and this change made that the systematic case
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-frontend + chair (probe)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:908-944` (`renderRepo`) with `:762-773` (`shownWorktrees`)
- **Evidence**: `tail = shown.filter(isIdle)` and `shown = ordered.slice(0, MAX_WORKTREES_PER_REPO)`, where `ordered` deliberately puts idle worktrees **last**. Above the cap the excluded rows are therefore exactly the idle ones — and the folded branch's own comment names the case that falls off first: *"a newly created worktree is agentless by construction, so it lands in the tail."* A result for such a worktree is emitted by no branch: not the lead loop (row not in `shown`), not the folded/unfolded tail loops (`tail ⊆ shown`), and not the repo-scoped sweep, which requires `!r.worktreeId` — and `rescope` will not clear `worktreeId`, because the worktree *is* in the tree. Chair probe, 18 agent-holders + 6 idle at cap 20: 20 rows drawn, `"Show 4 more worktrees"`, and an `error` result on the cap-excluded `/wt/I5` is **absent from the DOM entirely**.
- **Impact**: The same silence round-1 W1 set out to break, on the path this change's own idle-last ordering now steers newly created worktrees onto. The folded branch's comment asserts coverage the code does not have.
- **Fix**: Move the reach guarantee to one owner instead of one branch: after the cap's affordance, sweep every `actionResult` whose `worktreeId` matched no rendered row and emit it repo-scoped with the branch label as its "about" prefix (which also closes W6). Assert it with a cap-and-notice test.
- **Invariant note** (master.md Phase 3.1): the invariant is *"an action result is rendered somewhere, and says what it is about."* Boundary categories searched: lead loop, unfolded tail loop, folded tail loop, repo-scoped sweep, cap-excluded set, controller `rescope`, `MAX_ORPHAN_NOTICES` trim. Affected: folded tail (fixed this round), cap-excluded set (W7, open), notice attribution (W6, open). Verified safe: the unfolded tail loop, the lead loop, the repo-scoped sweep, and the controller's tree-absent path. The inventory has now expanded across three rounds and two changes — prior change round-3 B1 (`orphanedLabel` introduced), this change round-1 W1 (folded branch), this round W6+W7. **Patch-level fixing of this invariant has failed.** Recommend giving notice reach a single owner in the view rather than a branch-by-branch patch; if that owner does not fit inside this change's accepted plan, extract it.

### W8 — The added `aria-level` set is partial and, on a multi-repo tree, one level off
- **Severity**: WARN · **Confidence**: MEDIUM · **Priority**: P3
- **Agent**: asm-review-frontend + chair (probe)
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:796` (`.wt-idle` → `1`) and `:237` (`.wt-row--in-tail` → `2`)
- **Evidence**: Chair probe, two-repo tree with the tail open, every `navRows` element:
  `[["wt-repo","treeitem",null],["wt-row","treeitem",null],["wt-idle","treeitem","1"],["wt-row wt-row--in-tail","treeitem","2"] ×4]`.
  No other treeitem carries a level — `renderRepoHeader`, plain `renderWorktreeRow`, `renderAgentRow` and the subagent rows all omit it. In a flat `role="tree"` an omitted level computes to 1, so the repo header is level 1 and the disclosure now **declares** level 1: the disclosure is announced as the header's sibling rather than its child, and the tail rows as siblings of the plain worktree rows. The view's own model disagrees: `depthOf` gives repo 0, plain row and disclosure 1, tail row 2, so a 1-based level is `depth + 1` whenever a header is drawn. On a single-repo tree the values are internally consistent but the plain worktree rows (same depth as the disclosure) still carry none.
- **Impact**: Round-1 S1 recorded the flat tree as the established shape and rated it SUGGEST; the change has since declared structure for two row kinds only, which is a changed contract and the evidence delta that carries this above SUGGEST. Mixing explicit and implicit levels in one flat tree is less predictable across assistive technologies than declaring none — the partial set can misannounce the ownership the added comment says it establishes.
- **Fix**: Set `aria-level` on every treeitem the view renders from the one depth model (`depthOf(row) + (multiRepo ? 1 : 0)`), or drop both attributes. None is more coherent than these two.

### S7 — The `[B1]` test's `?.click()` is unguarded, so a future render regression would make it pass silently
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-contracts
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2451`
- **Evidence**: `view.element.querySelector<HTMLElement>(".wt-idle")?.click();` with no preceding non-null assertion. The test is **not** vacuous today — removing the `if (this.query) return` guard does break its final assertion (verified by both the chair and contracts by tracing the mutation) — but if the disclosure ever stops rendering while a filter is active, the optional call no-ops and the test goes green without exercising the guard it is named for. It also never asserts that the filter revealed the tail, though the neighbouring pre-existing test at `:2347` does.
- **Fix**: `expect(disclosure(view)).not.toBeNull()` before the click, matching the pattern the `[W1]` test already uses.

### S8 — Stale "Show all" wording left in a test name and two comments
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5
- **Agent**: asm-review-contracts + chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:1041`; `src/webview/worktree/WorktreeView.ts:59`; `src/webview/worktree/worktreePanel.css:748`
- **Evidence**: The test still reads `"caps a large repo with a Show all affordance rather than truncating silently"` while asserting `"Show 14 more worktrees"`; `MAX_WORKTREES_PER_REPO`'s comment still says *"before the cap offers \"Show all\" (§ 8)"*; the CSS comment still says *"\"Show all\" cap rather than silent truncation."* `renderShowAll`'s own doc comment was updated in the same diff, so the drift is inconsistent within the change.
- **Fix**: Update all three alongside B3's resolution — the wording that survives Gate 2 is the wording they should carry.

### S9 — The new local `twoRepoTree` shadows the imported fixture of the same name
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5
- **Agent**: chair (reuse lens)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2416` vs the import at `:28`
- **Evidence**: `twoRepoTree` is imported from `./worktreeFixtures` and used at `:184`, `:225`, `:1593` with no arguments. The new `function twoRepoTree(branches: string[])` inside `describe("the idle tail")` shadows that binding for the whole block, with a different arity and a different shape (the shared one carries a degraded second repo). Any future test in that describe calling `twoRepoTree()` gets the local one.
- **Fix**: Rename to something local and specific — `twoRepoIdleTree` — or extend the shared fixture and use it.

### S10 — Round-1 S3's context-menu half is still uncovered *(persists from round 1)*
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts` (`"keeps an agentless worktree's row duties — menu and keyboard reach"`)
- **Evidence**: The multi-repo half of round-1 S3 was taken and closed B2. The other half was not: the test still asserts only `role="treeitem"` and an ArrowDown, and no test in `describe("the idle tail")` dispatches a `contextmenu` event, despite the accepted requirement naming the context menu explicitly (*"keyboard traversal, activation, and its context menu SHALL be unchanged"*). The test's own title claims the menu.
- **Fix**: Dispatch `contextmenu` on an idle row and assert the menu handler runs.

---

## Audit backlog (carried from round 1, unchanged, non-gating)

- **A1** — Over-seeding when the cap consumes the entire tail (`WorktreeView.ts` `pruneStaleState`). Benign and one-directional; a comment, not a fix. Not addressed this round.
- **A2** — `.wt-row--in-tail` shares depth 2 with `.wt-arow` (`depthOf`). Inert while tail rows hold no agent rows. Not addressed this round. Note the new `aria-level="2"` on `.wt-row--in-tail` now encodes the same coupling in a second place — if the tail's membership rule ever changes, both need to move together.
- **A3** *(new, from round-1 S6, reclassified by the author)* — the idle partition materialises every matching worktree before the cap. Bounded by one repository's worktree count, which the cap already assumes fits in memory.

## Regression check — no previously closed finding reintroduced

- **Confidence-ceiling scheduler (prior change).** Intact. `renderedWorktreeIds()` reads `[data-worktree-id]`, and `renderWorktreeRow` (`worktreeTreeView.ts:241`) remains the only writer of that attribute — grep confirms. `renderNotice` writes no dataset, so the new folded-branch notices add nothing to `drawn`. A folded row is still absent from the set, and still holds no crossing candidate.
- **`orphanedLabel` (prior change, round-3 B1).** Its own mechanism is untouched — `rescope` and `MAX_ORPHAN_NOTICES` are unchanged. But the *invariant* it was introduced for has two open boundaries again: W6 and W7. Recorded as an inventory expansion, not as a reintroduction of the mechanism.
- **Round-1 B1's persistence path.** Closed and cannot re-diverge: one writer (`toggleKey`), one guard, one caller of the guarded path.
- **Round-1 B2's key collision.** Closed and not relocated: the namespace is checked first and `dataset.idleKey` has exactly one writer.
- **Vacuous assertions.** All five new/edited assertion sites checked, including the three the author did not mutate. `[B2]`'s focus/tab-stop assertions, the `{drawn, hidden}` pair, and the `.wt-presence` sibling pair with its positive control are all falsifiable. `[W1]`'s single assertion is falsifiable but under-specified (W6). `[B1]`'s is falsifiable today but unguarded (S7). No vacuous assertion found.

## Accepted risk

None.

## Notes

- `asm-review-logic` returned no findings. Its null result is recorded, not treated as corroboration of the chair's or the other specialists' verifications.
- Verify-gate evidence not re-run per chair rules: full suite 4797 passed / 235 files, type check clean, `gate:fs-deletion` ok, `biome check src` 17 findings byte-identical to the pre-change baseline, as reported by the author and recorded in `workflow.md` § Notes.
- `asimov/changes/active` remains listed in `.gitignore` while tracked (round-1 note, unchanged).

---

## Author triage — round 2

**[B3] W4's fix repeals an unmodified base requirement** — Status: **accepted**
Triage: verified. `asimov/specs/worktree-panel/spec.md:116` reads "an affordance stating
the full count"; my ADDED clause reads "SHALL report only what the cap excludes"; my
delta's `## MODIFIED` section lists only "Present the supplied worktree tree". So the
base requirement is contradicted without being amended, and `docs/design/
worktree-panel-ui.md:509` still says "show all". My round-1 triage was right that the
added clause is mine to meet and wrong that meeting it could repeal a clause I never
opened. Artifact handback, not a code revert — the two clauses have to be reconciled at
Gate 2, and either outcome is a spec edit first.

**[W5] The guard makes the disclosure inert rather than non-interactive** — Status: **accepted**
Triage: verified by reading `expandOrDescend` — the toggle branch consumes ArrowLeft and
returns before `parentOf`, so under a filter a keyboard user cannot climb out of the
disclosure at all. Round 1 offered the non-interactive option and I took the other half.

**[W6 + W7] Notice reach** — Status: **accepted, escalated**
Triage: W7 verified by reading — `resultsFor(info.id)` is called only for rows in `shown`
or in the tail, so a cap-excluded worktree's result reaches no branch. Pre-existing, but
idle-last ordering makes it systematic for precisely the row the W1 fix comment names: a
newly created worktree is agentless by construction, sorts last, and is therefore the
first thing the cap sheds. The chair is right that this is the third round on one
invariant across two changes, and that a fourth branch-level patch is the wrong move.
Giving notice reach a single owner mints an invariant owner, so it is a handback too.

**[W8] `aria-level` is partial and one off multi-repo** — Status: **accepted**
Triage: verified — `.wt-repo` and plain `.wt-row` declare none, so a disclosure declaring
level 1 announces as the header's sibling. In-contract fix.

Rebutted: none.

**Thrash stop declared.** "An action result is rendered somewhere, and says what it is
about" has now survived two fix attempts (prior change round-3 B1 → this change round-1
W1 → round-2 W6/W7). Stopping rather than opening a third patch round, per the chair
rules and the build skill's thrash-stop condition. Options put to the user.

**User decision (thrash stop):** hand back to `asimov-plan`. The cap clauses are
reconciled in the spec delta and Gate 2 is re-earned; notice reach is scaffolded as its
own change with a single owner, which this change depends on. Not folded into this
change's tasks — it mints an invariant owner.
