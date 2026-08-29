# Review round 2 — place-every-action-result

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: verification
- **Head**: `e0230fa4` (working tree dirty only in `asimov/changes/place-every-action-result/.analytics-cursor.json` and `analytics.json` — tooling artifacts, outside the reviewed scope; `src/` clean)
- **Scope**: range `320a4a9a..HEAD` (round-1 `Head` → the fix commit `e0230fa4`)
- **Reviewable lines**: 52 added in `src/webview/worktree/WorktreeView.ts`. Tests reviewed inline (Phase 2.5, 67 added in `WorktreeView.test.ts`). `asimov/**` skipped per classification.
- **Verdict**: **WARN**
- **Counts**: 0 BLOCK · 4 WARN · 4 SUGGEST
- **Scope lock**: passed. The only non-`src` change is task `1_2`, a remediation task for the round-1 findings whose Refs resolve to already-accepted spec anchors, plus a workflow.md note. No new capability, no new invariant owner, no semantically changed contract. The cycle continues.
- **Verify gate** (cited, not re-run): `bun run asm change verify-status place-every-action-result` → `1_1 [x] exit 0`, `1_2 [x] exit 0 scope-unchanged`. Author reports 4812 passed / 235 files, type check clean, `gate:fs-deletion` ok, `biome check src` 17 findings set-identical to baseline.

## Agents

| Agent | Region / lens | Model |
|---|---|---|
| chair | full fix diff, all lenses + anchor-lifecycle trace + 2 scratch probe batches (1 instrumented, 1 mutation) | opus-5[1m] |
| asm-review-logic | anchor invariant, control flow, three-valued return, sibling invariants | opus[1M] |
| asm-review-logic | test-strength / vacuity lens on the five new tests | sonnet[1M] |
| asm-review-frontend | DOM anchoring, focus restoration, live regions, detached-node retention | gpt-5.6-terra[1M] |

The frontend lens returned "no issues found" after 5 tool calls. Recorded as a **null result, not corroboration** — the chair's own DOM probes stand on their own evidence.

Not spawned: data-security, performance, contracts, reuse. The cone is one file's render/placement path; no persistence, auth, network, growth axis, or contract surface moved. Reuse was folded into the chair pass (W3/W4 were the reuse findings and both are closed).

---

## Round-1 disposition

| ID | Round-1 severity | Status | Evidence |
|---|---|---|---|
| B1 | BLOCK | **fixed** | `repoAnchors.clear()` at `:702`, adjacent to `replaceChildren()` at `:703`, above all four early exits. Verified at the invariant level across every boundary: record (`:790`), clear (`:702`), read (`repoAnchorFor:1127`), insert (`placeResults:1104-1109`), all four exits (`loading`, `noFolder`, `gitMissing`, `noRepo`), `repaint()`, `applyAt()`, `dispose()`. Chair probe P1 confirms the **`noFolder`** exit — the one the new tests miss — also survives: notice count 1 after the empty-state render. |
| B2 | BLOCK | **fixed** | `before = childElementCount` captured immediately before `renderRepo`; nothing in the loop removes nodes, so `count > before` ⟺ this repo appended, and `lastElementChild` is then necessarily this repo's own last append. Every `renderRepo` branch walked: early return, multiRepo header, collapsed, degraded-with-zero-visible, single-repo, cap, folded tail, `noMatch` (outside the loop). Chair probe P2: with three repos and the middle one emptied, the notice lands last instead of inside r1's section. |
| W1 | WARN | **fixed** (narrower gap opens as V3) | Three new tests draw a tree first and meet stale anchors on the second render. Mutation-verified by the vacuity lens: reverting **both** B1 halves drops `marks(...)` from 1 to 0 in all three, which also proves the second `setData` really re-renders and the tests are not vacuous. |
| W2 | WARN | **fixed** (residue as V1; one half withdrawn — see below) | A positive naming assertion now exists. |
| W3 | WARN | **fixed** | One `[data-worktree-id]` scan left in the file (`:905`); `renderedWorktreeIds()` derives its Set from `renderedWorktreeRows()` keys — set-equivalent to the old accumulate loop. |
| W4 | WARN | **fixed** | `repoIdOf` deleted; `repoAnchorFor` uses `this.repoOf(info)?.repoId`. Semantically identical (both match by worktree id), identical cost. |
| S1 | SUGGEST | **fixed for its stated symptom; mechanism re-surfaces as V4** | The focus key is a local returned from `renderListing`, so focus restoration is immune to re-entry. The re-entrancy *mechanism* S1 named now shows a materially different and worse impact — see V4. |
| S2 | SUGGEST | **fixed** | Three layers collapsed to `render` + `renderListing`; the dead `if (!hadListing) return` is gone. |
| S3 | SUGGEST | **fixed** | `nameFor(result, info)` takes the caller's resolved `info`; the caller computes it with the identical expression the method used internally, and the `worktreeId === undefined` early return is retained — no re-scoping regression. |
| S4 | SUGGEST | **recorded decision, non-gating** | Author recorded the path-in-notice tension as a decision. Carried forward unchanged; not re-reported. |

### Chair correction — one half of W2's accepted fix is withdrawn

Round 1 (chair) asked for "a test for the `nameFor` orphan branch (`result.orphanedLabel` on a worktree absent from the tree)". That branch — `WorktreeView.ts:1153-1154`, `if (!info) return result.orphanedLabel` — **cannot return a string in production**. `WorktreeController.rescope` (`:765-781`) destructures `worktreeId` out in the same expression that sets `orphanedLabel`, so the two are mutually exclusive on every result the controller pushes; the only other route (`present === undefined && this.tree === null`) leaves the result with a `worktreeId` and **no** `orphanedLabel`, so the branch still returns `undefined`. The reachable orphan-naming route is `about = name ?? result.orphanedLabel` in `buildActionNotice:1172`, which the pre-existing test at `WorktreeView.test.ts:2081` already covers. Not writing that test was correct. This half of W2 is withdrawn as a chair error and is **not** carried as a gap anywhere in this round.

---

## Chair verification evidence

Two scratch probe batches, each created and deleted in the same command.

**Probe batch 1** (against the real module):

```
P1 after-first=1
P1 after-noFolder=1 kids=["vault-empty::No folder open…","wt-notice wt-notice--error::Couldn't prune this wo…"]
P2 kids=["wt-repo::r1","wt-row::alpha-one","wt-repo::r3","wt-row::alpha-three","wt-notice wt-notice--error::…"]
P3 element-node contains() calls=12 false=6 marksA=1 marksB=1
P4 notice.textContent="Couldn't remove this worktree. zebranamed-failure"
```

- **P1** — the `noFolder` exit, uncovered by the suite, is safe: the repo-scoped result survives a `noFolder` render that follows a successful one.
- **P2** — with the fix, the filter-emptied middle repo's notice is the **last** child, after r3's row.
- **P3** — `this.element.contains()` was called 12 times on element nodes across six renders (2 pushes, 2 `setQuery`, a `loading` push, a restore push) and returned false exactly 6 times. Six renders × one focus-capture call (`contains(document.activeElement)` where `activeElement` is `<body>`) accounts for all six falses, so the **anchor guard returned true on every call and never rejected an anchor**. This is the empirical half of the answer to the author's question about the redundancy.
- **P4** — `"zebra"` reaches the notice through exactly one route: `about = name`. The worktree id `/repo/.git:zebra` is not in the rendered text, and `buildActionNotice` uses `info` only for the Force-remove action. The new naming assertion is therefore non-vacuous **with respect to the name being present** — but see V1 for what it still cannot tell apart.

**Probe batch 2** (mutated copy of `WorktreeView.ts` with the `childElementCount > before` guard removed, module + probe deleted in the same command):

```
3-repo MUTATED kids=["wt-repo::r1","wt-row::alpha-one","wt-notice--error::…","wt-repo::r3","wt-row::alpha-three"]   → noticeAt=2, r3RowAt=4
2-repo MUTATED kids=["wt-repo::r1","wt-row::alpha-one","wt-notice--error::…"]                                        → noticeAt=2 == last index
```

This settles the author's question 3 in both directions. Pre-fix, the three-repo fixture puts the notice at index 2 with r3's row at index 4, so `expect(noticeAt).toBeGreaterThan(r3RowAt)` fails — the rewrite is a genuine strengthening. Pre-fix, the **two**-repo fixture puts the notice at the last index, which is exactly where the fixed code appends it — so the old fixture provably could not discriminate. The author's stated reason for rewriting rather than relaxing is correct.

**Anchor lifecycle, boundaries verified safe**: record · clear · read · insert · `loading && !tree` · `noFolder` · `gitMissing` · `noRepo` · `repaint()` · `applyAt()` · `dispose()` (map dies with the instance) · notice inserts (`appendChild` / `after()` are additive and never detach) · `groupEndFor` (reads only; a second call for a same-row result returns the same node because an inserted notice is not `.wt-presence`, so `cursors` ordering holds). One boundary is **not** safe: synchronous re-entry — V4.

---

## Findings

### V1 — The new positive naming assertion is substring-strength: it cannot tell the branch label from the raw worktree id
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-logic (vacuity lens) — chair downgraded from the specialist's BLOCK, see adjudication
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2633-2645` ("names the worktree a hidden result concerns, not merely a different string")
- **Evidence**: The fixture's worktree id is built by the shared helper as `` `${repoId}:${branch}` `` = `/repo/.git:zebra`, which **contains** the asserted substring. Specialist mutation, run against a scratch copy: replacing `nameFor`'s body with `return info.id` — discarding `branchLabel()` and the entire shared-label qualification the method exists for — leaves `expect(notice).toContain("zebra")` green. The chair's own probe P4 confirms the id is not in the rendered text *today*, so this is a strength gap in the assertion, not a live leak.
- **Impact**: The assertion added to close round-1 W2 is one notch weaker than its name claims. A regression that surfaced the internal id in place of the friendly label — which would also collide with the project's path-free requirement, the same tension recorded as round-1 S4 — passes this suite. It is the identical *shape* of fault W2 named: an assertion that a wrong implementation also satisfies.
- **Fix**: Add the negative half alongside the positive one: `expect(notice).not.toContain(REPO2)` (or `not.toContain("/repo/.git")`). Two lines, and it makes the id-leak mutation fail.
- **Adjudication**: The specialist filed this as BLOCK. Downgraded to WARN on two grounds. (1) Phase 2.5 caps support-file findings at WARN — a test-only defect is not a must-fix production defect. (2) The mutation is not a reachable production regression: no code path constructs a name from `info.id`, so the finding is about future falsifiability, not present behavior. The evidence itself is accepted in full.

### V2 — The three-repo fixture separates the two outcomes it was rewritten for, but not "appended honestly" from "attributed to the *following* repo"
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-logic (vacuity lens) + chair (independently, before reading the specialist report)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2607-2631`
- **Evidence**: r3 is the last repository in the tree, so "append at the absolute end" and "anchor to r3's section end" are the **same DOM index** — precisely the collapse the rewrite was meant to escape, moved one repository along. Specialist mutation: adding a fallback to `repoAnchorFor` that walks *forward* to the next repository's anchor when the emptied repo has none leaves the test green. Chair probe P2 shows the same positional coincidence in the passing fixture (`noticeAt` = last index = immediately after r3's row).
- **Impact**: The test's name asserts non-attribution to a wrong repository; it proves non-attribution only to the **preceding** one. That is the mechanism B2 actually had, so the test does guard the real defect and the rewrite is a genuine strengthening (chair probe batch 2). But the invariant the name states is broader than what the fixture can observe — the round-1 W1 fault pattern, at reduced scale.
- **Fix**: Add a fourth repository after r3 whose branch matches the filter (`repo("/r4/.git", "r4", ["alpha-four"])`). Then appending lands after r4's row while any anchor-borrowing lands before it, and the fixture separates all three outcomes.

### V3 — The `noFolder` early exit has no regression test, though the accepted plan named all four
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: chair + asm-review-logic (both lenses, independently)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2580-2605` against `src/webview/worktree/WorktreeView.ts:716` and `asimov/changes/place-every-action-result/tasks.md` task `1_2` plan step 6
- **Evidence**: The new `it.each` covers `gitMissing` and `noRepo`; a separate `it` covers `loading`. Nothing pushes a tree and then a `noFolder` render. Task `1_2`'s own plan step 6 says "**each of the four** early-exit renders". The one existing test that sets `noFolder: true` after a tree (`WorktreeView.test.ts:909`) asserts row and timer counts only — it never asserts a result notice survives. The exit is reachable in production: `WorktreeController.push()` derives `noFolder` from `deps.init.workspaceRoot === null`, i.e. the user closes the folder while a result is showing.
- **Impact**: Behavior is safe today — chair probe P1 proves the notice survives, and the fix mechanism (`clear()` above all four exits) is uniform — so this is a coverage gap, not a live defect. But it is the same gap round-1 W1 was about: the scenario the requirement names, with one branch of it unguarded. A future change that special-cased `noFolder` would not be caught.
- **Fix**: Extend the `it.each` table with a `noFolder` case — the flag rides on `setData`, so the case needs its own shape (`{ tree: <same tree>, noFolder: true }`) rather than an empty-tree entry.

### V4 — A synchronous `setData` re-entry places every action notice twice, and the new doc comment claims a protection the code does not have
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1044` (`requestSubagents(row)`) with `:531` (`deps.onRequestSubagents?.(row)`) with `:674` (`placeResults`) and the comment at `:687-692`
- **Evidence**: `renderWorktree` calls `this.requestSubagents(row)` → `this.deps.onRequestSubagents?.(row)` **inside** `renderListing`'s repo loop. A dep that answers synchronously with `setData` re-enters `applyAt` → `render` → `renderListing`, which `replaceChildren()`s the DOM the outer loop is mid-way through building, runs its own `placeResults`, and returns; the outer loop then resumes appending into a partly-detached tree and runs `placeResults` a **second** time. Specialist scratch test with `onRequestSubagents = () => view.setData(...)` and one expanded agent row: `{ fired: 1, dup: 2, children: 6 }` against `{ dup: 1, children: 3 }` for a single render — the same notice rendered twice and the repo section duplicated. `repoAnchors` is still instance state and `placeResults` is still unguarded. The comment introduced by this diff at `:686-691` states "`setData` can re-enter synchronously, and a field would hand a predecessor's key to the render that outlives it" — true for the focus key it justifies, but it reads as though the hazard has been handled, and the change's headline invariant (exactly once) is the part it does not cover.
- **Impact**: Duplicate and potentially contradictory action notices plus a duplicated repository section — a direct violation of *"Every action result the panel holds SHALL be rendered exactly once"*. Not reachable through shipped wiring: `WorktreeController.ts:390` answers `onRequestSubagents` with `postMessage`, which is async, and `requestedRosters.add(key)` before the dep call bounds any nesting to one level rather than unbounded recursion. That unreachability is why this is WARN and not BLOCK.
- **Fix**: Preferred — thread `repoAnchors` as a local from `renderListing` into `placeResults` (it is already returning one value; a small result object makes the field's lifetime unrepresentable-wrong, and removes the last piece of render state parked on the instance). Alternative — a `rendering` re-entry guard in `render()` that defers a nested call. Minimum — delete the re-entrancy clause from the `:687-692` comment, because it currently documents a hazard the code does not handle.
- **Relation to round-1 S1**: same causal mechanism, materially different impact, so a new finding rather than an append. S1's stated symptom (focus loss) **is** fixed by the local. The escalation from SUGGEST to WARN carries a stated evidence delta: round 1 assessed the mechanism as "a latent keyboard-focus loss"; the executed scratch test shows the same mechanism duplicates placement, which is the invariant this change exists to hold.

### S1 — The `!this.element.contains(anchor)` half of the B1 fix is unreachable; keep it, but say so
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-logic + chair (probe P3)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:1100-1105`
- **Evidence**: With `clear()` at `:702`, the only writer is `:790` in the same call, after `replaceChildren`; nothing between that write and the read detaches a node; anchors are always direct children of `this.element` (`renderWorktree` appends the `.wt-card` itself); `groupEndFor` anchors come from a scan of the live element and are attached by construction. Neither the specialist nor the chair could construct a reachable state — including V4's re-entrant one — where the guard fires. Chair probe P3 measures it: the guard was consulted on every anchor across six renders and returned true every time. The two halves are therefore **behaviorally equivalent**, which is why neither is individually falsifiable — that is a property of the code, not a gap in the suite, and the evidence the author recorded in `workflow.md` ("removing BOTH fails all three early-exit tests") is the strongest evidence obtainable.
- **Impact**: The redundancy is **not wrong** — but the reason given for it is incomplete, and the two halves are not interchangeable. `clear()` does one thing the guard cannot: it drops references to detached DOM, so the map never pins a departed repository's subtree for the life of the view. The guard does one thing `clear()` cannot: it converts a whole *class* of future regression from a silent drop into a worse-but-honest append. Both are worth keeping for those reasons. The risk is the comment at `:1100-1102`, which reads as if the detached case occurs — a future reader may relax `:702` on the strength of it, and get tail-appended notices with no test failure.
- **Fix**: Reword to say it is a backstop for a state the clear at `:702` already excludes, and name the memory reason for the clear. Optionally make the branch assertable — a dev-only warn on the fallback — so the day it fires is visible rather than absorbed.

### S2 — The three-valued return is correct today; the residual risk is that a bare `return` in the success region type-checks as "no tree drawn"
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:687-797` with `:673-684`
- **Evidence**: `renderListing`'s success return is provably `string | null`: `restoreFocusTo` is initialized from `this.focusedKey`, whose only writers are `focusRow:1321` (`keyOf` → `string`) and `syncRovingTabindex:1261` (`string | null`). Every early exit returns the `undefined` literal. The single consumer discriminates with `=== undefined`, and the skips are byte-identical to the old `drew === false` path — `scrollTop`, `syncRovingTabindex`, focus restore, no more and no less. It is also strictly better than the field it replaced, which was assigned at the top of `renderListing` and never cleared on an early exit. So: legible, not a trap. The residual is that the union encodes two independent facts — *did we draw* and *what key to restore* — in one value, so a future bare `return;` inside the success region type-checks and silently means "no tree drawn", skipping scroll and tabindex restoration. That is the same shape as the structure round-1 S2 removed.
- **Fix**: None required. If it is ever revisited, a small result (`{ drew: false } | { drew: true; focusKey: string | null }`) makes the two facts independent again — and would fold in V4's fix, since `repoAnchors` could ride along in it.

### S3 — The new test fixtures re-declare `gitMissingTree()` and `noRepoTree()`, which the file already imports, and need an `as` cast to do it
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:2584-2585` against `src/webview/worktree/worktreeFixtures.ts:122-124, 142-144`
- **Evidence**: The two `it.each` table entries are byte-identical to `gitMissingTree()` and `noRepoTree()`, both already in this file's import list. The literals then need `emptyTree as WorktreeTree` at the call site — the cast exists only because the shape is being asserted by hand instead of produced by the typed helper.
- **Impact**: A third copy of two fixtures whose whole purpose is to be the one definition of those states, and a cast that would hide a future required field on `WorktreeTree` in exactly this test.
- **Fix**: `it.each([["gitMissing", gitMissingTree()], ["noRepo", noRepoTree()]])` and drop the cast.

### S4 — The "ONE scan" comment describes deduplicated code as a deduplicated scan
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:901-902`
- **Evidence**: `renderedWorktreeRows()` is invoked twice per cycle at different times — from `placeResults:1090`, and from `armCeiling` → `nextCeilingCrossing:351` → `renderedWorktreeIds:898`, which runs **after** `placeResults` has mutated the DOM. What the diff deduplicated is the implementation, not the scan.
- **Impact**: None behaviorally — notices carry no `data-worktree-id` (`worktreeTreeView.ts:241` is the only writer, one node per worktree row), so the post-`placeResults` scan sees the same set. But the comment is the reason a reader would not check the second call site, and the safety of that second scan rests on a property of `renderNotice` stated nowhere near it.
- **Fix**: "One implementation feeds both", plus a clause noting the post-placement scan is stable because only the worktree row carries the attribute.

---

## Author questions, answered

1. **Did the anchor fixes close B1 and B2 at the invariant level, or move them?** Closed. Both were verified against the full boundary inventory, not the quoted lines — see the lifecycle table above. The one boundary that is *not* safe is synchronous re-entry (V4), and it is a different mechanism from either blocker: it corrupts placement by running the whole render twice, not by mis-keying or outliving an anchor. B2's guard is total across every `renderRepo` branch, including the degraded-with-zero-visible case that skips the early return.
2. **Is the three-valued return legible or a trap, and do the early exits still skip exactly what they skipped?** Legible, and yes — proven, not assumed: the success return cannot be `undefined` because `focusedKey`'s only two writers produce `string | null`, and the skip set is byte-identical to the old `drew === false` path. It is strictly better than the field. See S2 for the one residual.
3. **Is the filter-attribution rewrite a strengthening, and does the new fixture separate the two outcomes?** Yes and yes, with direct evidence in probe batch 2: pre-fix, the three-repo fixture fails the new assertion (notice at index 2, r3's row at index 4), and the old two-repo fixture put the notice at the last index — the same place the fixed code appends it, so it provably could not discriminate. The limitation is narrower than you framed it: the fixture separates "filed under r1" from "appended", but not "appended" from "filed under r3" (V2).
4. **Vacuity in the five new tests.** Three faults found. V1: the naming assertion is substring-strength and cannot distinguish the branch label from the raw worktree id, because the fixture's id contains the label. V2: the filter fixture's discrimination stops one repository short. V3: `noFolder` is uncovered although the plan named four exits. Tests 1-3 are otherwise sound — mutation-verified that the second `setData` really re-renders, so they are not vacuous against the original defect. On `renderedWorktreeRows` being shared: no assertion now passes for the wrong reason. The two call sites use the same selector at the same points in the cycle they used independently before, and notices carry no `data-worktree-id`, so the populations were never coupled — only the code was.
5. **Sibling invariants.** No regression. `renderedWorktreeIds` is set-equivalent to the old accumulate loop, `armCeiling` still sees exactly the drawn rows and cannot be armed for an undrawn one, and `orphanedLabel` re-scoping is untouched — `nameFor`'s caller computes `info` with the identical expression the method used internally and the `worktreeId === undefined` early return is retained. `repoOf` and the deleted `repoIdOf` matched by worktree id identically.
6. **Is the B1 redundancy wrong?** No — but not for the reason recorded. The two halves are behaviorally *equivalent*, which is why neither is individually falsifiable; that is a property of the code, not a hole in the suite, so "removing both fails all three tests" is the strongest evidence that exists and recording it was right. They are still not interchangeable: `clear()` alone drops references to detached DOM (the map would otherwise pin a departed repository's subtree for the life of the view), and the guard alone converts a class of future regression from a silent drop into an honest append. Keep both; fix the comment (S1).

## Test / support review (Phase 2.5)

No `.only`, no `.skip`, no unawaited async. The `it.each` table is a pure fixture with no shared mutable state between cases. Fixtures carry no PII or secrets. The three early-exit tests correctly assert the notice count **before** the second push as well as after, so a first-render failure cannot be mistaken for a second-render pass. `marks()` still counts occurrences in `element.textContent` — presence and uniqueness, not position — and the filter test correctly uses child indices instead, which is what makes it able to observe B2 at all. Support findings this round: V1, V2, V3, S3 — all WARN or SUGGEST per the Phase 2.5 ceiling.

## Note carried to the sibling

`fold-idle-worktrees` W6/W7 were blocked on B1 and B2. Both are now closed, and the cap-excluded and folded-tail cases route through the fixed anchor path, so that dependency is released.

---

## Author triage — round 2

All four WARNs accepted; none rebutted. No blockers, so the cycle exits at re-verify.

**[V1] The positive naming assertion is substring-strength** — accepted. The id
`/repo/.git:zebra` contains the asserted substring, so `nameFor` returning `info.id`
would keep it green. Exactly the family W2 was: an assertion that reads like the
requirement and does not pin it.

**[V2] The three-repo fixture stops one repository short** — accepted, and it is the
same defect I introduced when I built the fixture: I fixed the two-repo case where
"appended" and "filed under r1" collide, and left the mirror collision at the other end.
Adding r4.

**[V3] `noFolder` untested though the plan named four exits** — accepted. My own Plan
step 6 said four; I wrote three.

**[V4] A synchronous `setData` re-entry places every notice twice** — accepted as the
comment fix. The hazard is unreachable through shipped wiring, but the comment this diff
added cites synchronous re-entry as the reason to move the focus key off the instance
while `repoAnchors` stays instance state and `placeResults` stays unguarded — it claims
coverage the code does not have, which is worse than saying nothing.

**Chair's answer on the redundancy, accepted with the correction.** I recorded the two
halves as belt-and-braces whose individual unfalsifiability was a suite gap. It is not:
they are behaviourally equivalent given `clear()` at the top, so no test could separate
them. They are still both worth keeping for different reasons — `clear()` stops the map
pinning a departed repository's subtree, the guard turns a future regression from a
silent drop into an honest append. The comment is being rewritten to say that instead of
implying the detached case occurs.

**Chair's correction to its own round 1, accepted**: the `nameFor` orphan branch cannot
return a string in production, so not testing it was right.

### Suggestions
- accepted — reuse `gitMissingTree()`/`noRepoTree()` instead of byte-identical literals,
  which also removes the `as WorktreeTree` cast that only existed to paper over them.
- audit-backlog — the "ONE scan" comment overstates: the implementation is shared, the
  scan still runs twice per cycle. Reworded rather than restructured; sharing the result
  across `placeResults` and `armCeiling` would couple them to a single DOM moment, which
  is a bigger change than the comment's accuracy warrants.
- audit-backlog — a future bare `return;` in the success region type-checks as "no tree
  drawn". Real, but the alternative encodings cost more legibility than they buy.
