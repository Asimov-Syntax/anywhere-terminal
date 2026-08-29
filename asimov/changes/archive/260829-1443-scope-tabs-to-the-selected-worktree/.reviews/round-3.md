# Review round 3 — scope-tabs-to-the-selected-worktree

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: verification (fastlane)
- **Head**: `6571f8511efbb074bea46c57946b9b5e404e6bc3` (tree clean apart from two asimov analytics files; fix diff reviewed `77ebd25e..HEAD`, one commit `6571f851`)
- **Reviewable lines**: ~150 added/modified across reviewable files (tests, docs and asimov artifacts excluded)
- **Verdict**: APPROVE
- **Counts**: 0 BLOCK · 0 WARN · 7 SUGGEST · 4 audit-backlog
- **Scope lock**: PASSED. The diff since round-2's Head is remediation only — task `2_2` under the existing fix-round heading, plus a `design.md` D7 paragraph and a `workflow.md` correction. `WorktreeController.stageScopeCleared` and `TabBarScopePanel.setWorkbench` are new API, but neither holds durable state, a lock or serialization discipline, a process lifecycle, or an external contract: `stageScopeCleared` is `reportScopeCleared` minus its `push()`, and `setWorkbench` moves a join `main.ts` already owned. No new invariant owner, no handback.
- **Verify-gate evidence** (not re-run by review, per chair rules): `.build/verified.ndjson` records task `2_2` at `cmd: pnpm run check-types && pnpm run test:unit && pnpm run gate:fs-deletion`, `exit: 0`, scope covering all 15 touched files. `workflow.md` carries no Verify Gate Notes line for this fix round (round-1's fix round has one) — the ndjson entry is the only record; worth adding for symmetry, not gating.
- **Lint, re-derived by the chair rather than taken from the author's correction** (targeted probe, not the project's lint gate): `biome 2.5.10`, `biome check --max-diagnostics=200 src` at HEAD → **17 diagnostics across 7 files**. Intersected with `git diff --name-only 6cd31e8c..HEAD -- src` (sorted both sides): exactly **one** touched file, `src/webview/worktree/worktreePanel.css:539` `lint/style/noDescendingSpecificity` on `.wt-hist-label`, and `git log -L 539,539` blames it to `404d4c15` — pre-existing, not a line this change wrote. `WorktreeController.test.ts:1160` no longer produces a finding. The author's substantive claim is confirmed independently: `git log -L 47,56:src/webview/messaging/MessageRouter.ts` shows the out-of-order `WorktreeWorkbenchMessage` import was introduced by **`b20355f0`** — this change — and fixed by `6571f851`. The round-2 evidence gap is closed and the correction is honest.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | seam ordering, staging vs `handleTreeResponse` reconciliation, view selection edge | state machine, ordering, re-entrancy, error paths | gpt-5.6-terra[1M] (respawned; the first `opus[1M]` instance died on an API error before producing output) |
| asm-review-contracts | provider `init` narrowing, `TabBarScopePanel` / `stageScopeCleared` surface, D7 vs specs | contract surface | gpt-5.6-terra[1M] |
| asm-review-frontend | chip focus handoff, sticky chip CSS, render gating, notice a11y | rendering, a11y | sonnet[1M] |
| chair | full fix diff, impact cone, V0 static re-derivation, lint re-derivation, spec deltas | all | opus[1M] |

Two targeted probes, both read-only and self-cleaning: the biome intersection above, and a `git show 77ebd25e:… | biome check --stdin-file-path=…` comparison (inconclusive for organize-imports over stdin, so the `git log -L` blame was used instead).

---

## Verification of round-2's findings

| ID | Round-2 severity | Verdict this round |
|---|---|---|
| V0 | BLOCK | **CONFIRMED FIXED** |
| V1 | WARN | **CONFIRMED FIXED** (residual S7: re-entrancy, unreachable) |
| V2 | WARN | **CONFIRMED FIXED** |
| V3 | WARN | **CONFIRMED FIXED** (residual S2 on the error path) |
| V4 | WARN | **CONFIRMED FIXED** |
| V5 | WARN | **CONFIRMED FIXED, and strengthened past what round 1 asked for** |
| V6 | SUGGEST | **CONFIRMED FIXED** |
| V7 | SUGGEST | **CONFIRMED FIXED** |
| V8 | SUGGEST | **PARTIALLY FIXED** — the general case is closed; the hide-the-bar case is not (S1) |
| V9 | SUGGEST | **CONFIRMED FIXED** |

**V0 — confirmed fixed, re-derived statically by the chair, not taken from the author's mutation claim.** All six `init` literals — `TerminalEditorProvider.ts:988`, `:1032`, `:1084` and `TerminalViewProvider.ts:1502`, `:1557`, `:1619` — are direct arguments to `safeSendWithRetry`, and both `safeSendWithRetry` signatures now read `message: ExtensionToWebViewMessage` (`TerminalEditorProvider.ts:1149`, `TerminalViewProvider.ts:1685`). `InitMessage.worktreeWorkbench` is required (`src/types/messages.ts:1151`), `InitMessage` is a member of the `ExtensionToWebViewMessage` discriminated union (`:1827`), and the literal's `type: "init"` selects that member, so contextual object-literal checking rejects the omission. No `init` reaches `safePostMessage` or a raw `webview.postMessage`; the only two raw `postMessage` calls per provider are the ones inside the two wrappers. No `as InitMessage` / `as ExtensionToWebViewMessage` cast at any init call site. Both providers' `safePostMessage` doc comments — the surfaces that asserted the guard was present when it was not — now say correctly that `init` does not come through them.

**V1 — confirmed fixed, both writers.** `select` (`WorktreeView.ts:411-421`) and `clearSelection` (`:394-402`) both announce before committing, with the throw uncaught. Two new tests in `WorktreeView.test.ts` pin both directions and both die on reversion: the first reads `view.selectedWorktree()` from inside the listener and asserts `null`; the second arms a throwing listener, calls `clearSelection`, and asserts the row is still marked. **On the caller's question — does the ordering create a non-throw path that announces without committing?** No. Nothing executes between the announce and the assignment; both guards (`workbench`, equality) run before the announce; the sole listener reaches the coordinator and then renders only the tab bar, which reads coordinator state and `tabLayouts` and never re-enters the view. The one hazard the inversion does create is silent lost-update under synchronous re-entrancy, which is unreachable today — recorded as S7 rather than dismissed, because the seam exists to stop exactly this kind of grep-dependent argument. **The third writer, `pruneStaleState` (`:729-733`), keeps the old order and was correctly left alone**: its announce reaches a coordinator whose scope `applyTree` already cleared, so `setScope(null)` early-returns without a store write and cannot throw. With the workbench off, `applyTree` returns before clearing and the announce does write — but the resulting divergence is unobservable (`scopedWorktreeId()` is `null` while off, and `resolved` is already `false`), and the persisted id surviving is exactly what "a persisted scope naming an absent worktree resolves to unscoped" permits.

**V2 — confirmed fixed, and the vacuous test is genuinely repaired.** `setWorkbench` joined `TabBarScopePanel` (`tabBarScopeWiring.ts:31`), the seam calls the panel then the coordinator then `renderIfMoved()` (`:125-132`), and `main.ts:818-825` returns early through the seam. The old test now does **two** pushes — so `resolved` is actually armed before the tree drops it — and drives `s.seam.setWorkbench(true)`, not `s.controller.setWorkbench(true)`; reverting `applyTree`'s `this.resolved = false` now fails it. The second test asserts one flip moves both `controller.isWorkbenchEnabled()` and the chip, so deleting `deps.panel()?.setWorkbench(enabled)` fails. On the ordering: the panel-first sequence is safe — `WorktreeController.setWorkbench` early-returns on an unchanged value and otherwise reaches only `view.refresh()` → `repaint()` → `render()`, which does not run `pruneStaleState` (that is reached only from `applyAt`, behind its signature gate) and so cannot re-enter `onSelectWorktree` while the coordinator still holds the old flag.

**V3 — confirmed fixed, twice over.** `deliver()` is wrapped in `try/finally` (`tabBarScopeWiring.ts:118-122`), and the queue is now drained *before* `deliver` runs, so a throw cannot leave anything queued at all. The new test throws from `deliver` and asserts the chip is gone, the persisted scope is gone, and the next tree produces exactly one notice. Residual S2 covers what the `finally` cannot make transactional.

**V4 — confirmed fixed on both paths.** With a panel: `panel.clearSelection()` announces first (V1's fix), which reaches `coordinator.select(null)` and renders once and records the signature; the following `coordinator.clear()` is inert on `setScope`'s equality guard and its `renderIfMoved()` finds nothing moved. The test asserts `renders === drawn + 1`. Without a panel: the new `bare()` fixture proves the post-clear signature is recorded, because a following `applyTree` draws nothing.

**V5 — confirmed fixed, and stronger than round 1 asked for.** The staged notice and the tree it is about now arrive in one `view.setData`. The test harness counts `setData` calls, so reverting to `reportScopeCleared` gives two and fails; a second test records, for every paint carrying the notice, how many `main` rows that paint drew, and asserts all zero. **On the caller's question — does staging before `deliver` interact badly with `handleTreeResponse`'s reconciliation?** Traced by the chair and by asm-review-logic independently, with the same answer: no.
- `repoId` filter: the staged `scope` result carries no `repoId`, so it cannot be dropped.
- `rescope`: the staged result names a worktree that has just left, so `worktreeId` is stripped and `orphanedLabel` is kept (`result.orphanedLabel ?? …` prefers the coordinator's own label). Text is unchanged — `buildActionNotice` reads `name ?? result.orphanedLabel` and `nameFor` returned that same label under the old order. Placement is unchanged too: with no drawn row and no `repoId`, `placeResults` appended it to the panel end before and after.
- Orphan cap: the staged result is appended last and carries `orphanedLabel` from birth, so it now participates in the `MAX_ORPHAN_NOTICES = 4` trim in the same pass and is the newest — it survives, and it can no longer transiently push the list to five the way the post-`deliver` order could. Strictly tighter.
- Dedup: `stageScopeCleared`'s filter stops matching once `rescope` has stripped `worktreeId`. Real, but **not a regression** — see S3 for the full trace of both orders reaching the same two notices.

**V6 — confirmed fixed.** `design.md` D7 now records that a restored scope marks no row and why the two specs together require it, and `tabBarScopeWiring.test.ts` pins it with `expect(s.controller.selectedWorktree()).toBeNull()` beside the chip assertion. asm-review-contracts independently checked the paragraph against `specs/worktree-panel/spec.md` and `specs/tab-bar-component/spec.md` and found no drift.

**V7 — confirmed fixed.** `onAttribution` calls `renderIfMoved()`. Safe in the one live path: `emitAttribution` runs inside `handleTreeResponse`, i.e. inside `deliver`, after `coordinator.applyTree` has already re-resolved, so the render it triggers reads settled coordinator state and `tabLayouts` and never the panel's mid-push DOM. It records the signature, which makes the outer `finally`'s call a no-op — that suppresses a redundant render, not a needed one, because nothing between the two moves a signature input.

**V9 — confirmed fixed.** `#4d4d4d` is opaque and the comment no longer claims opacity the value lacked. The sticky/stacking reasoning holds: the chip is inserted first in the reconciled child list and `position: sticky; z-index: 1` puts it above the auto-z-index `.tab-item` siblings that scroll under it.

---

## Findings

### S1 — SUGGEST · HIGH · P3 · agent: asm-review-frontend + chair · class: feature

**V8's focus handoff is inert in the one case where the clear also hides the tab bar**
`src/webview/TabBarUtils.ts:218` with `src/providers/webviewHtml.ts:127-145` and `TabBarUtils.ts:349-354`
Status: open · Triage: pending

**Evidence.** `#tab-bar` is `display: none` and is shown only by the `.visible` class, which `renderTabBar` adds when `terminals.size >= 2 || scope !== undefined`. While scoped, the second clause alone can be carrying it — `terminals` is the already-filtered set (`main.ts:367`). The clear drops the scope and re-renders with `scope === undefined` against the now-unfiltered set; if the surface holds 0 or 1 terminals in total, neither clause holds, `.visible` is removed, and the bar reverts to `display: none`. `tabBarEl.querySelector(".tab-add")?.focus()` then targets a control inside a non-rendered subtree, which the focusing steps make a no-op. Focus has already fallen to `<body>` when the old clear button left the DOM, and the new line does not recover it.

The new test cannot see this: the `surface()` fixture wires three panes, so `terminals.size >= 2` holds after the clear and the bar stays visible. jsdom also does not apply the webview stylesheet, so `display: none` is not in play there at all — the test would stay green even if the bar were hidden.

**Impact.** A keyboard user with a single terminal who scopes to its worktree and clears from the keyboard lands on `<body>` — the exact symptom V8 named, now behind a narrow but ordinary precondition. Reachability went **down**, not up, which is why this is held at SUGGEST rather than escalated: severity is stable across persistence, and an escalation needs an evidence delta in the other direction. It was never BLOCK-eligible — no data loss, no security boundary, no broken execution path.

**Fix.** In `renderTabBar`, when the handoff target is not focusable after the clear, move focus to a control that survives — the worktree panel's own row, or a documented stable target — rather than assuming `.tab-add` is always rendered. Whatever is chosen, drive the assertion from a fixture with a single tab, or the case stays invisible.

### S2 — SUGGEST · HIGH · P4 · agent: asm-review-logic + chair · class: feature

**A staged notice survives a throwing `deliver` in the controller, and an unrelated push before the next tree paints it beside the live row it contradicts**
`src/webview/tabBarScopeWiring.ts:111-122` with `src/webview/worktree/WorktreeController.ts:918-925` and `WorktreeView.ts:1261-1288`
Status: open · Triage: pending

**Evidence.** The drain now happens before `deliver()`, so the notice is already in `this.actionResults` when `handleTreeResponse` starts. If `handleTreeResponse` throws inside `reconcile` — before `this.tree = msg.tree` and before `push()` — the record is neither reconciled nor drawn, and it still carries its `worktreeId`. Any intervening `push()` before the next tree response (a mutation result, a dismiss, a visibility change) renders against the **old** tree, so `placeResults` finds a drawn row for that worktree and anchors "Scope cleared. main is no longer in this tree" directly beneath a live `main` row. Found independently by asm-review-logic and by the chair. The `finally` cannot reach it: it restores the seam's own state, not the controller's staging.

**Impact.** W2's invariant — the notice is never painted beside a row for the worktree it says is gone — violated through a mechanism W2 and V5 did not cover. **Strictly better than both prior rounds**, which is why it is SUGGEST and not a re-raised WARN: round-2's actual code left the notice queued to fire against an unrelated later tree beside a live row unconditionally, and round-2 V3's own suggested fix would have pushed it immediately against the old tree. This round narrows the same failure to a compound precondition (a throw inside `handleTreeResponse` **and** an unrelated push before the next tree), and it self-corrects on that next tree.

**Fix — and read the shape of it before acting.** Do not answer this with a fourth ordering patch; that is the pattern the invariant rule warns about. The durable form is a contradiction guard at the single place that renders: in `placeResults`, suppress (or defer) a `scope` result whose `worktreeId` is still among the drawn rows. One site, mechanism-independent, and it retires the whole class rather than the current instance. It is also entirely legitimate to leave this open and record it — nothing user-visible is durable, and the cycle's remaining budget is better spent than on another ordering move.

### S3 — SUGGEST · MEDIUM · P5 · agent: asm-review-logic (causal claim corrected by chair) · class: feature

**Repeated departure of the same worktree accumulates duplicate "Scope cleared" notices — pre-existing, not introduced by the staging change**
`src/webview/worktree/WorktreeController.ts:920`
Status: open · Triage: pending

**Evidence.** `stageScopeCleared` dedups on `r.action === "scope" && r.worktreeId === worktreeId`, and `reconcile`'s `rescope` strips `worktreeId` from any result whose worktree has left. So a second departure of the same worktree (leave → return → reselect → leave) finds no match and appends a second identical notice.

**Chair correction to the specialist's causal claim.** The report states the *new* order "makes the existing deduplication ineffective after reconciliation." Both orders reach two notices, for the same reason. Old order: at T1 `reportScopeCleared` appended after `reconcile`, so the record kept `worktreeId`; at T2 the worktree returned and `rescope` left it alone; at T3 `reconcile` ran **first** and stripped it, then the append found no match. New order: at T1 the stage ran before `reconcile`, so the record was stripped at T1; at T2 `rescope` returns a `worktreeId`-less result unchanged; at T3 the stage again finds no match. Two notices either way. Reported because it is real and sits in the code this diff rewrote, not because the diff caused it.

**Impact.** Bounded at four by `MAX_ORPHAN_NOTICES`, dismissable, and requiring a remove/recreate/reselect/remove cycle on one worktree.

**Fix.** If it is worth closing, dedup on an identity that survives `rescope` — e.g. keep the departed id under a field `rescope` does not strip — rather than on the rendered `worktreeId`.

### S4 — SUGGEST · HIGH · P5 · agent: asm-review-contracts · class: feature

**`TabBarScopePanel`'s own doc comment still inventories two methods; it now has three**
`src/webview/tabBarScopeWiring.ts:16-20`
Status: open · Triage: pending

The comment reads "Two methods, both of them things the TAB BAR asks of the panel"; `setWorkbench` was added at `:31`. The count is the load-bearing part of that sentence — it is what tells a reader the interface is small enough to enumerate — so it should say three or drop the number. Same class of defect as V0's false comments, at far lower stakes.

### S5 — SUGGEST · HIGH · P5 · agent: chair + asm-review-contracts · class: machinery

**`reportScopeCleared` joins `selectedWorktree()` as public controller API with no production caller, kept alive by its own test**
`src/webview/worktree/WorktreeController.ts:893` and `:907`
Status: open · Triage: pending

`grep -rn "reportScopeCleared" src/ | grep -v '\.test\.ts'` returns only the declaration and its own composition; the seam now calls `stageScopeCleared`. `selectedWorktree()` was already in this state (round-2 audit-backlog) and is now joined by a second. Two public methods on the controller whose only consumers are `WorktreeController.test.ts`. Round-2's triage kept `reportScopeCleared` deliberately, "as the public push-ing form for a standalone caller" — that is a defensible choice, but there is no such caller and the doc comment does not say it is a convenience form. Either name it as one or delete it; a test-only public method reads as a supported entry point to the next reader.

### S6 — SUGGEST · HIGH · P5 · agent: asm-review-contracts + chair · class: feature

**Impact manifest item 3 claims a supported surface configuration that cannot occur**
`src/webview/main.ts:818-825` with `asimov/changes/scope-tabs-to-the-selected-worktree/tasks.md` (task `2_2`)
Status: open · Triage: pending

`onWorktreeWorkbench` falls back to `worktreeController?.setWorkbench(msg.enabled)` when `tabBarScope` is null, and the manifest records this as "the controller-only path survives for a surface with no panel." Both objects are constructed synchronously inside the same `if (vaultHost)` block (`main.ts:1056-1087`), the seam first — so `tabBarScope === null && worktreeController !== null` has no steady state. The code is harmless defence; the claim that it preserves a real configuration is not, because it invites a future reader to rely on a path that does not exist. State it as defensive, or drop the branch.

### S7 — SUGGEST · MEDIUM · P5 · agent: chair · class: feature

**The V1 inversion turns a re-entrant `select` from a benign overwrite into a silent lost update — unreachable today, and resting on the same grep V7 was raised to retire**
`src/webview/worktree/WorktreeView.ts:411-421`
Status: open · Triage: pending

**Evidence.** With the announce first, a listener that synchronously calls back into `select(otherId)` completes the inner selection — announce, commit `otherId` — and then the outer frame overwrites `this.selectedWorktreeId` with the original id. The view ends marking the first worktree while the coordinator's scope holds the second, and nothing throws, so nothing surfaces it. Under the old order the outer commit happened first and the inner one won, leaving the two surfaces in agreement.

It is unreachable today: the sole listener is the seam, whose `renderIfMoved()` reaches `renderTabBar`, which binds handlers and invokes none. That is precisely the shape round-2 V7 was accepted for ("correct only by an unstated reachability argument", "the seam exists to make these joins provable, so this one should not rest on a grep"). Recorded for consistency with that ruling, not because a defect is reachable.

**Fix.** A re-entrancy guard in `select` (ignore or defer a nested call), or a comment at `:411` recording that the announce must not re-enter and why the seam cannot. The cheap version is the comment.

## Also found

Nothing overflowed the detail budget.

## Audit backlog

Non-gating. Carried into the next discovery round.

- **Carried from rounds 1 and 2** — `docs/design/worktree-scope.md:238`, row "Presence degraded for the pane source", still reads "Last attribution stands; scope is not recomputed from an empty result" — which D7 and § 3.4 both reject. Re-confirmed present at HEAD; `workflow.md`'s "Blueprint sync complete" gate is still unchecked, so the fix is still owed at sync.
- **Carried from round 2** — `WorktreeView.clearSelection()` reaches `repaint()`, which no-ops when `this.disposed`; a clear on a disposed view still announces and still mutates. Unchanged this round except that the announce now runs first. Not reachable from the chip.
- **Carried from round 2** — `TerminalEditorProvider.postRowActivation()` and its sidebar twin post two messages each while the name and the shared comment describe one. Both providers are symmetric, so this is naming, not contract divergence.
- `workflow.md` records a Verify Gate note for the round-1 fix round but none for this one; `.build/verified.ndjson` task `2_2` is the only record that the gate ran (`exit: 0`).

## Support review (Phase 2.5)

- No `.only` / `.skip` / `xit` introduced. No PII or secrets in fixtures. All new assertions synchronous by construction.
- The `surface()` harness gained a `view.setData` wrapper that counts panel rebuilds and snapshots the notices drawn at each one. That is what makes V5's "one paint" claim assertable at all rather than inferable, and it is the right instrument: reverting `stageScopeCleared` to `reportScopeCleared` produces two `setData` calls and fails.
- Every round-2 fix that can be tested has a test that dies on its reversion: V1 both directions, V2 both halves, V3, V4 on both the panel and no-panel paths, V5 as a paint count plus a per-paint row count, V6 as a negative assertion. V0 is compile-time and was re-derived statically above; V7 is inert by construction; V9 is CSS. The author's claim of 9/9 plus 6/6 is consistent with what the tests actually assert.
- The one coverage gap found: the V8 test's fixture has three tabs, so it cannot reach the branch S1 names, and jsdom would not surface it even if it did.
- The new `bare()` fixture is a genuine addition — it is the only place the no-panel surface is exercised through the seam's public shape.

## Not findings (checked, clean)

- Staging before `deliver` does not lose, misplace, or mistext the notice under `reconcile` — repo filter, `rescope`, and the orphan cap all traced above, all benign or tighter than the old order.
- `pruneStaleState`'s unchanged commit-then-announce order is not the V1 defect in a third place: on every path where its announce could write persistence, the coordinator's scope is already `null` and `setScope` early-returns.
- The panel-before-coordinator order in `seam.setWorkbench` opens no observable window: `WorktreeController.setWorkbench` reaches only `view.refresh()` → `repaint()` → `render()`, which does not run `pruneStaleState` and cannot re-enter the seam.
- `renderIfMoved()` in `onAttribution` does not suppress a needed render — it records the signature mid-`deliver`, and nothing between that point and the outer `finally` moves a signature input.
- `.tab-add` is reconciled rather than recreated by `renderTabBar`, so the V8 handoff target is a stable node; and no path leaves the chip in place while focus is stolen, because a throwing `clearSelection` or `coordinator.clear()` propagates out of `onClear` before the focus line.
- `TabBarScopePanel` is structurally checked where it matters: `main.ts:1066` supplies `() => worktreeController` to a `panel: () => TabBarScopePanel | null` field, so a renamed or drifted controller method fails assignability there despite the absent `implements` clause.
- `MessageRouter.ts`'s import reorder is this change's own lint debt, paid — confirmed by blame, not by the author's note.
