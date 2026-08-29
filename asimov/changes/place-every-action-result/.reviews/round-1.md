# Review round 1 — place-every-action-result

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: discovery
- **Head**: `320a4a9a` (working tree dirty in `docs/ui/worktree.html` and `skills-lock.json` — both outside the reviewed scope; `src/` clean)
- **Scope**: range `b9467406..HEAD` (2 commits; the implementation commit is `320a4a9a`)
- **Reviewable lines**: 190 (`src/webview/worktree/WorktreeView.ts`). Tests reviewed inline (Phase 2.5, 170 added in `WorktreeView.test.ts`). `asimov/**` and `docs/**` skipped per classification.
- **Verdict**: **BLOCK**
- **Counts**: 2 BLOCK · 4 WARN · 4 SUGGEST
- **Split over gating blockers**: 2 feature / 0 machinery

**Intent reconstruction**: no material divergence. The diff implements task `1_1` against the three ADDED requirements in `specs/worktree-panel/spec.md`, accepted at Gate 2 (`workflow.md`). The scope boundary ("never alters which worktrees are LISTED") is respected — `placeResults` reads the DOM and never calls `toggleCollapsed`, `uncapped.add`, `toggleIdleTail`, or `setQuery`.

## Agents

| Agent | Region / lens | Model |
|---|---|---|
| chair | full diff, all lenses + full-flow trace + 14 scratch probes + 3 mutations | opus-5[1m] |
| asm-review-logic | `render` restructure, `placeResults`, double-render, cursor, focus | opus[1M] |
| asm-review-frontend | DOM anchoring, `groupEndFor`, focus restoration, a11y, detached nodes | gpt-5.6-terra[1M] |
| asm-review-contracts | accepted-spec conformance, `nameFor` uniqueness, path-free rule | sonnet[1M] |
| asm-review-logic | test-strength / vacuity lens on the new `describe` block | gpt-5.6-terra[1M] |
| asm-review-reuse | duplication vs `renderedWorktreeIds` / `repoOf`, cohesion of the split | gpt-5.6-luna[1M] |

The test-strength lens returned a null report after 4 tool calls. Recorded as a **null result, not corroboration** — the chair ran the mutation batch itself and it produced W2 below.

Not spawned: data-security, performance — the diff touches no persistence, auth, network, or growth axis. Results are bounded upstream by `MAX_ORPHAN_NOTICES = 4` and by `handleMutationResult`'s one-per-(action, scope) replacement, so `placeResults`' O(results × worktrees) work has a structural cap.

---

## Full-flow trace (chair)

`setData` → `applyAt` signature check → `render` → `renderListingAndPlace` → `renderListing` (4 early exits | repo loop → `renderRepo` → `shownWorktrees` → cap/fold/collapse) → `placeResults` (DOM query → per-result anchor → insert) → scrollTop → `syncRovingTabindex` → focus restore → `armCeiling` → `renderedWorktreeIds`.

Verified sound on this trace:
- **No result can render twice.** `placeResults` loops results once and builds exactly one notice each; all three prior emission sites are deleted; `drawn` dedups by first `[data-worktree-id]` occurrence, and `worktreeTreeView.ts:241` is the only writer of that attribute (one per worktree row), so `groupEndFor` can never anchor inside a card or on an agent row. Holds across cap × fold × collapse × filter × expansion × multi-repo.
- **Anchoring is unchanged for every pre-existing case.** Chair probe: collapsed row with pill → after `.wt-presence`; expanded row → after `.wt-card` (`["wt-card", "wt-notice--error", "wt-row--idle"]`); idle row in an open tail → after the row; agentless row → after the row.
- **The four early exits still skip exactly what they skipped**: `scrollTop` restore, `syncRovingTabindex`, focus restoration. `restoreFocusTo` is captured at the same point the old `hadFocus` was (before `replaceChildren`) and is unconditionally reassigned at the top of every `renderListing`, so `drew === false` cannot leave a stale restore to fire later.
- **Insert order is preserved** for every anchor-sharing case. `cursors` is keyed by element identity, so a drawn row whose `groupEndFor` node *is* the repo anchor shares one cursor and stays in array order.
- **Orphan names cannot collide.** `WorktreeController.rescope` sets `orphanedLabel` from `departed.get(id) ?? worktreeId`, and `departed` stores `displayPath` — both unique per worktree by construction. The asymmetry (orphan unqualified, tree-resident qualified) is not a defect.
- **`displayPath` is the right qualifier**: absolute worktree path from `git worktree list` (`WorktreeDiscovery.ts:142`), unique across repositories. Chair probe confirms two same-label worktrees produce two different names.
- **`worktreeId` and `orphanedLabel` are structurally mutually exclusive** (`rescope` destructures `worktreeId` out exactly when it sets `orphanedLabel`), so `about = name ?? result.orphanedLabel` cannot leak a label onto a drawn row in production.
- Notices carry no `data-worktree-id`, are excluded from `navRows()`, and keep `role="alert"`/`role="status"` — `armCeiling` and the roving tabindex are unaffected.

Both blockers below share one owner: **`repoAnchors` records an anchor without verifying that the anchor belongs to the key it is stored under.** Two distinct mechanisms, two materially different impacts, so they are recorded as two findings.

---

## Findings

### B1 — Stale `repoAnchors` silently swallows a repo-scoped result on any early-exit render that follows a successful one
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: chair (probe) + asm-review-logic (BLOCK) + asm-review-frontend (WARN — chair escalates, see adjudication)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:780` (`repoAnchors.clear()`), `:706` (`replaceChildren()`), `:1104` (`at.after(notice)`), `:1121` (`repoAnchorFor`)
- **Evidence**: `this.repoAnchors.clear()` sits at line 780, **after** `renderListing`'s four early returns, but `placeResults()` runs on every path. On an early-exit render following a successful one, `repoAnchors` still holds nodes that `replaceChildren()` (line 706) has already detached. `repoAnchorFor` returns one, and `ChildNode.after()` on a parentless node is a spec no-op — the notice is built and thrown away. `cursors.set(anchor, notice)` then stores the orphaned notice, so every further result for that repository is dropped too. `toActionResult` puts `repoId` on **every** result ("the repo id rides along regardless"), so the `undefined → appendChild` escape is essentially never taken in production.
  Chair scratch probe (created and deleted in one command), counting occurrences of a unique error string in `element.textContent`:
  ```
  C before = 1   C after-gitMissing = 0
  D before = 1   D after-loading   = 0
  A first-render-noRepo count = 1     (empty map → appendChild fallback → survives)
  ```
  Reachable transitions after a successful render: a tree response with `gitAvailable === false && repos.length === 0` (gitMissing, `:723`), `repos.length === 0` (noRepo, `:727`), `loading && !tree` (`:713`), and `noFolder` (`:718`).
- **Impact**: Violates this change's own ADDED requirement *"Every action result the panel holds SHALL be rendered exactly once"* and its scenario *"A result outlives the listing entirely"* — on the very paths the `render` restructure was introduced to protect. A pending remove/prune failure is lost with no trace at exactly the moment it matters most (the repository just went away). This is a fourth instance of the invariant the change exists to close, reached through a fifth branch.
- **Fix**: Move `this.repoAnchors.clear()` to the top of `renderListing`, adjacent to `replaceChildren()`, so it can never outlive the DOM it describes. Additionally harden `placeResults` so an anchor that cannot accept an insert falls back to the append rather than to a silent no-op: `if (anchor === undefined || !this.element.contains(anchor)) { this.element.appendChild(notice); continue; }`. Add the regression test named in W1.

### B2 — A repository the filter emptied inherits the previous repository's anchor, so its notice is attributed to the wrong repository
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: chair (probe) + asm-review-contracts (BLOCK) + asm-review-logic (WARN) + asm-review-frontend (WARN)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:787-790` (anchor-capture loop) with `:910-912` (`renderRepo` early return)
- **Evidence**: `renderRepo` returns `0` **without appending anything** — no header, no rows — when `visible.length === 0 && !repo.degraded`, i.e. when an active filter matches nothing in that repository. The capture block then runs unconditionally:
  ```ts
  rendered += this.renderRepo(repo, multiRepo, now);
  const last = this.element.lastElementChild;
  if (last instanceof HTMLElement) { this.repoAnchors.set(repo.repoId, last); }
  ```
  `lastElementChild` is whatever the **previous** repository left behind, so repo B's id is mapped to repo A's last node. Chair probe, two repos, a `prune` failure scoped to `/r2/.git`, then `setQuery("alpha")`:
  ```
  E children = ["wt-repo :: r1", "wt-row :: alpha", "wt-notice--error :: Couldn't prune this worktree.E-MARK"]
  ```
  Only repo r1's header is drawn, and r2's failure sits under r1's rows. A repo-scoped notice carries **no name** at all — `nameFor` returns `undefined` when `result.worktreeId === undefined`, and `about` falls back to an `orphanedLabel` that is also absent — so nothing in the notice contradicts the placement. Single-repo variant: the borrowed anchor becomes the refreshing marker or a degradation notice, putting the result at the top of the panel.
- **Impact**: A display decision (the filter) governs how a result is reported, which the ADDED requirement forbids in the same breath it forbids the result being dropped. The user reads a prune failure as belonging to a repository that did not fail, and the method's own doc comment ("so a repo-scoped result still lands with its repository") asserts a guarantee the code does not have. In a panel whose design principle is truthfulness this is a false claim, not a cosmetic misplacement — hence BLOCK rather than the WARN two specialists assigned.
- **Fix**: Record the anchor only when the repository actually appended something: capture `const before = this.element.childElementCount` before the `renderRepo` call and set the anchor only if the count grew. Leaving it unset makes `repoAnchorFor` return `undefined` and the notice appends at the end — the documented honest fallback. Better still, have `renderRepo` return the node it ended on, so the anchor cannot be sourced from outside the repository at all.

### W1 — The "result outlives the listing entirely" test never exercises the path that breaks
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2564-2573`
- **Evidence**: The test mounts fresh, pushes `repos: []` once, and holds a **worktree-scoped** result (`failure("/gone/wt", ...)`, no `repoId`). `repoIdOf` finds nothing in an empty tree, `repoAnchorFor` returns `undefined`, and the notice takes the `appendChild` fallback — which works. It never reaches `repoAnchors`, never runs a second render, and therefore cannot observe B1. Chair probe "A" confirms a repo-scoped result also survives on a *first* render into `noRepo`; the defect is strictly cross-render. The scenario the test is named for — *"the panel holds a result and the tree cannot be listed"* — is the one production case where results are most likely to be repo-scoped, because `rescope` re-scopes a worktree-scoped result the moment its row leaves the tree.
- **Impact**: The single test guarding the change's headline scenario passes against a broken implementation. This is how B1 reached the verify gate with 4807 tests green.
- **Fix**: Rewrite as two pushes — a successful listing holding a **repo-scoped** result, then a push whose tree cannot be listed — and assert the notice is still present after the second. Repeat for `gitMissing`, `loading`, and `noFolder`; all four fail today.

### W2 — Requirement 2 is asserted by exactly one test, and only in its "the two differ" form
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair (mutation)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2510-2573` (cap, fold, filter, collapsed-repo, unlisted-tree, travelling)
- **Evidence**: Chair mutation batch against the new `describe` block, each mutation applied to a copy and reverted in the same command:
  | Mutation | Tests failing |
  |---|---|
  | `row ? undefined : this.nameFor(result)` → `undefined` (naming removed entirely) | 1 — *"tells two undrawn failures apart…"* |
  | → `this.nameFor(result)` (name applied to drawn rows too) | 1 — *"does not repeat the branch…"* |
  | `repoAnchors.set(...)` → no-op | 1 — *"lands a repo-scoped result inside its own repository's section"* |
  Every one of the five placement tests passes with **no name on any notice**. They assert only that a unique error string occurs once in `element.textContent`; none asserts that the notice for an undrawn row names its worktree, which is the whole of the second ADDED requirement for exactly those rows. A regression that drops the name on the cap and fold paths while keeping it on the collapsed-repo path is invisible to this suite. The three mutations the author reports checking are genuinely caught — the gap is in the assertions that were never mutated because the behaviour they should assert was never asserted.
- **Impact**: Half of the change's contract — placement — is well covered; the other half — naming — rests on a single differential assertion. Given this invariant has now failed four times, that is the wrong side of the change to leave thin.
- **Fix**: Add a positive naming assertion to each of the cap, fold, and filter tests (`expect(notice.textContent).toContain("<branch>")`), and add a test for the `nameFor` orphan branch (`result.orphanedLabel` on a worktree absent from the tree) — the pre-existing test at `:2081` covers the re-scoped `ok` case but not the new `placeResults` route.

### W3 — `placeResults` restates `renderedWorktreeIds`' DOM scan, the restatement the file's own comment says drifted twice
- **Severity**: WARN · **Confidence**: MEDIUM · **Priority**: P3
- **Agent**: asm-review-reuse + chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1084-1090` against `:896-905`
- **Evidence**: Both run `this.element.querySelectorAll<HTMLElement>("[data-worktree-id]")`, read `el.dataset.worktreeId`, and iterate the same rows; the only difference is `Set<string>` vs `Map<string, HTMLElement>`. `renderedWorktreeIds`' own doc comment records that *"the previous version restated the render's own predicate, and the restatement drifted twice"* — and the fix for that drift is now itself restated.
- **Impact**: A future change to the selector or to which rows carry the attribute can update one scan and not the other, so `armCeiling` would schedule confidence crossings for a different rendered population than the one receiving notices.
- **Fix**: Keep one `renderedWorktreeElements(): Map<string, HTMLElement>` and derive `renderedWorktreeIds` from its keys.

### W4 — `repoIdOf` reimplements the existing `repoOf` lookup
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-reuse
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1126-1133` against `:234-237`
- **Evidence**: `repoOf(info)` already scans `this.data.tree?.repos` for the repository holding a worktree and returns it. `repoIdOf(worktreeId)` is the same traversal returning only the id, and `repoAnchorFor` calls it only on a path where `info` is already resolved.
- **Impact**: Two implementations of one repository-resolution capability, free to drift as tree ownership rules change.
- **Fix**: `this.repoOf(info)?.repoId` in `repoAnchorFor`; delete `repoIdOf`.

### S1 — `restoreFocusTo` as an instance field is re-entrancy-fragile where the local it replaced was not
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:691-697, 705`
- **Evidence**: The old `hadFocus` was a local, immune to a nested render. The field is overwritten by a nested `renderListing` (`:705`) and nulled by a nested `renderListingAndPlace` (`:693`). The synchronous re-entry surface is `requestSubagents` → `this.deps.onRequestSubagents?.(row)` (`:534`), called from inside `renderWorktree` (`:1037`): a host or test wiring that answers synchronously with `setData` would let the inner render consume the field and the outer render skip its focus restoration. No production caller does this today.
- **Impact**: A latent keyboard-focus loss that depends on host wiring rather than on view code.
- **Fix**: Have `renderListing` **return** the key (or `null`) and pass it to the restore step — the new structure with the old locality.

### S2 — `render`'s three-layer split has no separate responsibility, and its guard is dead structure
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-logic + asm-review-reuse (merged)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:671-699`
- **Evidence**: `render` reads `scrollTop`, calls `renderListingAndPlace`, then `const hadListing = ...; if (!hadListing) { return; }` as its last statement — both branches return void. `renderListingAndPlace` forwards to `renderListing`, calls `placeResults`, and does the restoration.
- **Impact**: Reads as if something is guarded when nothing is, and invites the next statement to be appended below the guard where it will be silently skipped on the empty-state paths — the exact shape of the bug this change removes.
- **Fix**: Collapse to two methods: `render` owns the transaction (scroll capture, listing, placement, restoration) and `renderListing` owns the tree.

### S3 — `nameFor` re-runs the `infoFor` traversal its caller already did
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-reuse
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1155` with `:1095`
- **Evidence**: `placeResults` resolves `info` at `:1095`, then calls `nameFor(result)` at `:1097`, which immediately calls `this.infoFor(...)` again.
- **Fix**: Pass the resolved `info` into `nameFor`, keeping the orphan fallback for `undefined`.

### S4 — A qualified name puts an absolute filesystem path into visible panel text
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4
- **Agent**: asm-review-contracts + chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1167` against `asimov/specs/worktree-panel/spec.md:8-10`
- **Evidence**: `nameFor` renders `` `${label} — ${info.displayPath}` `` when a label is shared. The project requirement reads *"No **row** in the tree SHALL display a filesystem path as row content. A worktree's path SHALL remain reachable through the row's tooltip and through an explicit copy action."* A notice is not a row — it carries no `data-worktree-id` and is not produced by `renderWorktree` — so on a literal reading this is **not a violation**, and the pre-existing `orphanedLabel` path already renders a raw absolute path in a notice (`WorktreeView.test.ts:2093`). It nonetheless sits in tension with the requirement's evident intent.
- **Impact**: None functional. Flagged so the tension is a recorded decision rather than an accident, since the change introduces paths into a surface that previously showed them only for departed worktrees.
- **Fix**: None required. If the tension is unwanted, qualify with the repository label (`repo.label`) before falling back to `displayPath`, which separates the common cross-repository collision without a path.

---

## Author questions, answered

1. **Did the `render` restructure change anything else?** No, apart from the two blockers. The four early exits still skip `scrollTop` restore, `syncRovingTabindex`, and focus restoration exactly as before, and the focus key is captured at the same point in the same order. The only latent difference is S1's re-entrancy surface, which no production caller reaches.
2. **Double-rendering.** Cannot occur. `placeResults` loops results once and builds one notice each; all three prior emission sites are gone; `data-worktree-id` has exactly one writer, one node per worktree. Verified across cap × fold × collapse × filter × expansion × multi-repo. Zero-rendering *can* occur — see B1.
3. **Anchoring.** Preserved for every pre-existing case, verified by probe: expanded → after `.wt-card`; collapsed with agents → after `.wt-presence`; in-tail and agentless → after the row. The uncovered case that does move is B2's.
4. **Naming.** Qualification is sufficient for tree-resident worktrees (`displayPath` is a unique absolute path) and orphans cannot collide (`departed` stores `displayPath`; the fallback is the `worktreeId`). `displayPath` is the right qualifier for uniqueness; see S4 on the path-free question. `orphanedLabel` cannot leak onto a drawn row — `rescope` makes `worktreeId` and `orphanedLabel` mutually exclusive.
5. **`repoAnchors`.** Both suspicions are real: cross-render staleness (B1, which also retains detached nodes indefinitely across early-exit renders) and within-render mis-keying (B2).
6. **Vacuity.** The six mutations you ran do hold — the chair reproduced three of them. The gap is in what was never asserted at all: naming for undrawn rows (W2), and a scenario test that misses its own path (W1).

## Test / support review (Phase 2.5)

No `.only`, no `.skip`, no unawaited async, no shared mutable state between the new tests. Fixtures carry no PII or secrets. `marks()` counting occurrences in `element.textContent` proves presence and uniqueness but not position — position is asserted only by *"lands a repo-scoped result inside its own repository's section"*, which is why B2 escaped. `rowFor` correctly asserts the negative (row absent) alongside each placement assertion, and *"does not repeat the branch…"* correctly asserts the notice exists before asserting what it omits.

---

## Author triage — round 1

All findings verified against source before acceptance. Rebutted: none.

**[B1] Stale `repoAnchors` swallows a repo-scoped result after an early exit** — **accepted**
Confirmed by reading: `replaceChildren()` at `:706`, the four `return false` at `:712`,
`:718`, `:725`, `:729`, and `repoAnchors.clear()` at `:780` — after every one of them,
while `placeResults()` runs on all paths. This is the invariant this change exists to
close, reopened through a fifth branch, by the change itself. The lesson the design was
built on — a reporting decision must not sit behind a drawing decision — I then violated
with the anchor bookkeeping, which is a drawing artifact I let placement depend on.
Taking both halves of the fix: clear beside `replaceChildren`, AND refuse to trust an
anchor that is not still in the tree. `after()` on a detached node being a silent no-op
is exactly the failure mode that must never be reachable here.

**[B2] A filter-emptied repository inherits the previous one's anchor** — **accepted**
Confirmed: `renderRepo` can append nothing and the capture block runs regardless, so
`lastElementChild` is the previous repository's. Two specialists said WARN and the chair
escalated; the chair is right — a repo-scoped notice carries no name, so nothing on
screen contradicts the false attribution. Recording only when the child count actually
grew.

**[W1] The "outlives the listing" test never exercises the path that breaks** — **accepted**
This is the finding I most want to keep: the test passed a 4807-test gate while B1 sat
under it, because a worktree-scoped result on a FIRST render takes the `appendChild`
fallback and never touches `repoAnchors`. A scenario name matching the requirement is not
coverage of it.

**[W2] Requirement 2 is asserted only in its "the two differ" form** — **accepted**
All five placement tests pass with no name on any notice. My six mutations did hold — the
chair reproduced three — but they only probed code I had written, never the assertion I
had not. Adding positive assertions that the name is present and is the right one.

**[W3] `placeResults` restates `renderedWorktreeIds`' DOM scan** — **accepted**
**[W4] `repoIdOf` reimplements `repoOf`** — **accepted**
Both also reached me directly from the reuse specialist, with line-level evidence, and
both are confirmed. W4 is plain duplication — `repoAnchorFor` already holds `info`.

### Suggestions — all accepted
- `restoreFocusTo` as a field is re-entrancy-fragile where the local was not; return the key.
- Collapse the three-layer render split; `if (!hadListing) return` is dead structure.
- `nameFor` re-runs the traversal its caller already did; pass `info` in.
- Qualified names put a path into panel text. Recorded as a decision, not a violation: the
  path-free rule is scoped to rows, and `orphanedLabel` already did this.

### Note carried to the sibling
`fold-idle-worktrees` W6/W7 do not close until B1 and B2 are fixed — its cap-excluded and
folded-tail cases route through this same anchor path.
