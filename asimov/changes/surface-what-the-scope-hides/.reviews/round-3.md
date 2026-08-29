# Review round 3 — surface-what-the-scope-hides

- Date: 2026-08-30
- Cycle: 1
- Mode: verification (cycle 1's third and final round)
- Scope: `ca0ebeaf..7842258a` (round-2 Head → HEAD), plus the files carrying prior findings
- Head: `7842258a2dc0a561e5aab46dc3a98798a3c36369` (working tree dirty in change analytics only; `src/` clean)
- Reviewable lines: 29 (src, non-test)
- Verdict: **BLOCK** — 1 blocking, 1 warning, 0 suggestions
- Split (gating blockers): 1 feature / 0 machinery
- Verify gate cited, not re-run: `.build/verified.ndjson` task `3_1` records `pnpm run check-types && pnpm run test:unit` exit 0.

## Scope lock

Passed. One commit; `src/` confined to the three files named in the accepted findings plus their tests; `tasks.md` gains only remediation task `3_1`; the rest is task-completion metadata. No new capability, no new contract, no new invariant owner declared.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-frontend | region identity key, idempotency, a11y | rendering, a11y | opus[1M] |
| asm-review-logic | leaf-branch rekeying | logic, edge cases | gpt-5.6-terra[1M] |
| chair | full fix diff, impact cone, scratch probe | all | opus[1M] |

## Prior findings — carried forward

| # | Round-2 severity | Round-3 status |
|---|---|---|
| W3 | WARN | **fixed** for its accepted scope (the count). Residual presentation gap is pre-existing → audit backlog |
| W6 | WARN | **fixed** on its own invariant — element and focus survive a redraw. The fix introduced B3 |
| W7 | WARN | **fixed** on the seam side. The `main.ts` line remains structurally untestable → audit backlog |
| S2 | SUGGEST | **fixed in code**; its test does not discriminate → folded into W8 |
| S-early-return | SUGGEST | **fixed** — `syncEmptyScope()` now precedes the `!tabBarEl` guard |
| S3 | SUGGEST | **rejected** — rebuttal accepted, see below |
| S1 | audit-backlog | closed as a consequence of W6's fix, per author triage. Focus is no longer taken away; it is still never given. Left in backlog |

### W3 — fixed (accepted scope)
`buildTabBarData`'s leaf branch now derives `const paneId = layout.sessionId` and uses it for `inScope` and `tabIsWaiting`. Chair and logic independently walked all seven leaf states; the only behaviour that moves is the intended one — a collapsed tab whose live leaf is hidden and waiting now counts `1` where it counted `0`. Ordinary leaves are unaffected because `sessionId === tabId`. The new `TabBar.test.ts` case discriminates: pre-fix, `inScope(scope, "collapsed")` is `true` (the dead id carries no attribution), so `!inScope(...)` is `false` and the count never fires — the test's expected `1` fails against `0`.

### S3 — rejected
The rebuttal addresses the evidence: one of the two draws is required (it is what shows the pane just made active), and eliminating the other needs render coalescing across `main.ts`'s eleven `updateTabBar` call sites — a mechanism this change does not own and would have to introduce for a non-gating finding. Accepted; recorded rejected with that reason. One nit, not reopened: the rebuttal calls the required draw "the second", but chronologically `switchTab`'s draw is first and `renderIfMoved`'s is second. The substance is unaffected.

## Findings

### B3 — BLOCK / HIGH / P1 / feature — new, introduced by the W6 fix
- agent: chair + asm-review-frontend (independently reached; chair confirmed empirically)
- class: feature
- file: `src/webview/emptyScopeRegion.ts:65-70`, with `src/webview/main.ts:482-492`
- title: The region's idempotency key omits the worktree id, so a standing region's offers act on the previously scoped worktree
- evidence: the key is `` `${deps.label}\u0002${deps.onLaunchAgent === undefined ? "" : "launch"}` `` and a match returns early, leaving the standing element in place. What the element carries is the worktree **id**, captured in closures built in `showEmptyScope`: `onOpenTerminal` posts `{type: "worktreeOpenTerminal", worktreeId: worktree.id}`, and `onLaunchAgent` is `launchOfferFor(worktree.id)`, which re-resolves `infoOf(worktreeId)` from that captured id. The id is never in the key, and labels are not unique: `labelsOf` (`tabBarScope.ts:41-49`) walks `tree.repos` — `WorktreeTree.repos` is `WorktreeRepo[]`, "workspace-folder order, deduped by `repoId`" (`src/worktree/types.ts:56-58`) — labelling each worktree `wt.branch ?? wt.displayPath`. Git forbids one branch in two worktrees of the *same* repo, but nothing stops repo A and repo B in a multi-root workspace from each having a worktree on `main`; `WorktreeCreateDialog.ts:231` branches on `repos.length > 1`, so multi-repo is a first-class state. `WorktreeView.select` (`:410-421`) emits `onSelectWorktree(B)` directly with **no intervening `null`**, so the region is never torn down between A and B. Chair scratch probe (created and deleted in one command): mounting with `label: "main"` and `onOpenTerminal` pushing `"repo-A/main"`, then remounting with the same label and `onOpenTerminal` pushing `"repo-B/main"`, then clicking the offer, yields `["repo-A/main"]`.
- impact: with A (repo1/`main`, empty) scoped and then B (repo2/`main`, also empty) selected, the region's buttons still target A. The heading reads "Nothing running in main", true of both, so there is no visual or accessible tell — the accessible name is correct while the action behind it is not. Pressing "Open a terminal" creates a terminal in **A**, which the B scope then hides, so the button reads as inert and the user presses it again, silently accumulating terminals in the wrong repository. "Launch an agent" opens the launch dialog for A's `WorktreeInfo` while the surface is scoped to B. This directly violates the ADDED spec scenario "The terminal offer opens in the scoped worktree — THEN the terminal opened is one whose working directory is the scoped worktree" (`specs/tab-bar-component/spec.md:92-95`), and reinstates the exact class of defect design.md D4 rejected `createTab` for: "`createTab` carries no worktree identity and would open in the wrong directory". Pre-fix this was correct — the unconditional rebuild rebuilt the closures; the idempotency introduced it.
- suggestedFix: key on the thing the closures actually capture. Add `id: string` to `EmptyScopeRegionDeps`, pass `worktree.id` from `showEmptyScope`, and put the id first in the identity string. Cover it at the `emptyScopeRegion` level — mount `{id: "wt-a", label: "main", onOpenTerminal: spyA}`, remount `{id: "wt-b", label: "main", onOpenTerminal: spyB}`, click, assert `spyB` fired — and at the seam, where the two ids actually diverge.
- status: open
- triage: pending

### W8 — WARN / HIGH / P3 / machinery — new
- agent: asm-review-frontend + chair
- class: machinery
- file: `src/webview/emptyScopeRegion.test.ts:164-172`, `src/webview/tabBarScopeWiring.test.ts:155-159`
- title: The round-3 regression net does not cover the axis the fix moved
- evidence: discrimination checked against reconstructed round-2 code rather than taken from the manifest. Of the six new tests, two fail pre-fix — "keeps the element, and the focus, when nothing about the region moved" and the wiring "keeps the standing region, and its focus, across a redraw that changes nothing"; both sit on the focus axis. The other four pass against round-2 code. Two of those are legitimate strengthenings that W7 asked for (the container assertions moved from a dep spy to the real `#terminal-container`), but two are gaps: (i) "touches nothing when the container is detached" sets up **no standing region** — `surface()` resets `document.body`, then `container.remove()`, then mounts — so round-2's leading unconditional `?.remove()` matches nothing and both codepaths behave identically; the one behaviour S2 was about, *standing region plus detached container*, is unprotected. (ii) "replaces the element when the offers it makes change" passes pre-fix because pre-fix always replaced; it guards against over-aggressive caching in the new code, which is worth keeping, but it is not evidence for W6. Nothing touches the id axis at all: the wiring harness's `showEmptyScope` stub drops `worktree.id` and installs no-op callbacks (`{label: worktree.label, onOpenTerminal: () => {}, onClear: () => {}}`), so two same-label worktrees are literally identical inputs and no assertion in that file could observe B3.
- impact: S2 can be reintroduced with the suite green, and B3 shipped with the suite green. Task `3_1`'s Plan step 5 names "a changed label replacing it" — the one variation the label-based key already handles — while the variation that breaks it, same label and different worktree, is neither planned nor tested.
- suggestedFix: mount before detaching in the S2 test so it fails against round-2 code; have the harness stub record the target (`onOpenTerminal: () => out.opened.push(worktree.id)`) and add a wiring test that selects two same-label worktrees in different repos and asserts the click posts the second one's id.
- status: open
- triage: pending

## Audit backlog

- **Collapsed leaf is absent from the presented bar when its live leaf is IN scope.** `buildTabBarData`'s leaf branch still gates presentation on `store.terminals.get(tabId)`, so for `tabLayouts["A"] = leaf{"B"}` with only `terminals[B]` alive, the tab is never added to `tabs`. The seam's `firstPresentedPane` correctly returns `B`, removes the region and can activate the terminal — so the user sees a live terminal, a scope chip, and no tab for it. Unchanged pre-existing code, explicitly carved out of W3 in rounds 1 and 2; recorded, not gating. `resolveTabDisplayPane` already encodes the fallback rule this branch needs.
- **The `tabBarScope?.syncEmptyScope()` line in `main.ts` remains unreachable from any test**, since the bootstrap is not importable under vitest — the limit design.md D3 already records for that file. Declared by the author, not claimed closed. The seam side is now asserted end to end.
- **S1 (round 1): the region is never given focus.** Its inverse is fixed; the original stands.

## Chair note — cycle 1 is exhausted

This is round 3, the cycle's maximum. Two things are worth recording for whoever picks this up.

The blockers the change was reviewed for are genuinely closed: B1, B2 and the W-set of rounds 1 and 2 each verified boundary by boundary, not on the manifest's word. Each round's remediation, however, has introduced one new defect in the same component — round 2's funnel produced the rebuild churn (W6), and round 3's idempotency produced the wrong-target offers (B3). The empty-scope region's mount has, over three rounds, accreted element lifecycle, an identity/caching discipline, and container visibility ownership. That is the shape the lifecycle calls a new invariant owner. Recommend extracting `emptyScopeRegion`'s mount into its own change, reviewed to APPROVE independently, so this change's next discovery scopes the integration seam rather than the whole surface.

The next user-initiated review starts **cycle 2, round 1, in discovery mode**, carrying the three audit-backlog entries forward re-listed rather than re-reported.

## Support review (Phase 2.5)

- No `.only` / `.skip` in the changed test files; assertions synchronous.
- `mountEmptyScopeRegion` and `EmptyScopeRegionDeps` have exactly two production reference sites, both in `main.ts`'s `showEmptyScope`. No caller was missed by the deps change.
- The a11y state on the idempotent path is internally consistent — heading text and `aria-label` both derive from `deps.label`, which is in the key, so the element can never carry a name that disagrees with its key. That is precisely why B3 is silent: the name is right and only the action is wrong.
- One residual noted and not blocked on: with a region standing over a detached container, a label change is not applied until the container is reattached. Strictly better than the blank surface it replaced.

---

## Author triage — round 3

| # | Status | Rationale |
|---|---|---|
| B3 | accepted | Confirmed in the code, and introduced by my own round-2 fix: `emptyScopeRegion.ts:65` keys on label plus launch presence, while the element's behaviour is the worktree id its closures captured, and `WorktreeView.ts:419` emits a selection with no intervening `null` so the element is never torn down between two worktrees. Two repos in a multi-root workspace can both carry a `main` worktree. The key becomes what the closures capture, id first. |
| W8 | accepted | Correct, and checked against reconstructed round-2 code rather than asserted. Two of six tests do not discriminate: the detached-container case sets up no standing region, so both codepaths behave identically; and "replaces when the offers change" passes pre-fix because pre-fix always replaced. Both are rewritten, and the id axis — which nothing touched — is covered. |
| Backlog: collapsed leaf absent from the bar | carried | Pre-existing `terminals.get(tabId)` gating, carved out of W3 in all three rounds. Not this change's. |
| Backlog: `syncEmptyScope()` unreachable from tests | carried | The D3 limit on `main.ts`, declared and not claimed closed. |
| Backlog: S1 focus never given | carried | Its inverse is fixed; the original stands. |

**Thrash stop.** Round 3 is the cycle cap and it closed with a blocker, so the three options were put to the user rather than auto-chosen under fastlane. The user chose the bounded extension round: one stated hypothesis — key the region on what its closures capture — with no scope growth. The chair's recommendation to extract the mount as its own change is recorded here and not taken; it remains the right move if this component produces another defect.

