# Review round 3 — cap-inferred-running

- **Date**: 2026-08-29
- **Cycle**: 1
- **Round**: 3 (the cycle cap)
- **Mode**: verification
- **Scope**: `4e68350f..d4ed608c` (one commit, `d4ed608c` — "fix(cap-inferred-running): arm a crossing for every drawn row")
- **Head**: `d4ed608c3f594404f5ebce7ba15d623fab558634`
- **Reviewable lines**: ~90 added/modified across 3 reviewable files (`WorktreeView.ts`, `worktreeTreeView.ts`, `WorktreeRemoveDialog.ts`); 3 test files inline
- **Master session id**: `5f2a59f2-f137-40a2-b797-dcd98fd208a5`
- **Verdict**: WARN
- **Counts**: 0 BLOCK · 2 WARN · 5 SUGGEST
- **Gating blockers**: **none** — the cycle can close without invoking the thrash-stop options

**Scope lock: PASSED.** Task `2_2` enumerates exactly the round-2 findings. Remediation only; no new capability, contract, design, or invariant owner.

## Agents — both previously undelivered lenses returned

| Assignment | Specialist | Model | Report status |
|---|---|---|---|
| Independent attack on the repaired `[I17]` guard | asm-review-frontend | gpt-5.6-terra[1M] | **delivered** |
| Independent enumeration of `renderedWorktreeIds` vs `render` drift | asm-review-logic | opus[1M] | **delivered** |
| Chair verification + adjudication | chair | — | complete |

Round 2's outstanding integrity item is closed: both lenses ran, both returned, and every finding below is attributed to the agent that actually produced it. Nothing in this round rests on the chair re-deriving a specialist's cone.

---

## Findings

### [W9] The `[I17]` guard's model still cannot see rules that apply — and `covered` overstates what it proves
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2 · **Status**: persists from rounds 1-2, **downgraded from BLOCK with a stated evidence delta**
- **Agent**: asm-review-frontend (independent probe) + chair (mechanism verification)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:289-300` (`declsOf`, the `reduced` capture); `src/test/invariants/registry.ts:156-163`
- **Evidence**: The specialist hand-ported the repaired guard and scored it against twelve mutations. **The chair's P2 and P3 are both now CAUGHT**, independently confirmed — the per-layer `motion` tracking and the unreduced-pass assertion do what the author claims. What the guard still **admits**:

  | Mutation | Result |
  |---|---|
  | `.wt-tree .wt-state--running-unconfirmed { animation: wt-spin … }` | admitted |
  | animation on `::before` | admitted |
  | a **second** `@media (prefers-reduced-motion: reduce)` block animating the state | admitted |
  | `transition: transform .9s linear` | admitted |
  | grouped reduced selector naming a static peer, `idle, running-unconfirmed { animation: … }` | admitted |
  | `.wt-glyph .wt-state--running-unconfirmed { border: 1.5px solid … }` | admitted — and collides the worktree glyph with `idle` |

  Chair verification of the two most realistic ones. `declsOf` builds `new RegExp("\\.wt-state--" + state + "\\s*\\{")` and calls `.exec`, which returns the **first** match in the file. The bare rule sits at `worktreePanel.css:224`; `.wt-glyph .wt-state` already exists at `:283`. So a `.wt-glyph`-scoped override — the pattern the file already uses for this exact element — is added *after* the bare rule and is never read. Separately, `grep -c prefers-reduced-motion worktreePanel.css` returns **2**: the file already contains two reduced-motion blocks, and the guard's `reduced` capture is non-greedy to the first `\n}`, so it reads only the first. The second one today touches only `.wt-skel`, so nothing is currently hidden — but the structure that enables the escape is already in the file, not hypothetical.
- **Impact**: `[I17]`'s statement is conjunctive and unconditional. Its "rather than calling it idle" half is genuinely proven (`worktreeFormat.ts` returns `running-unconfirmed` or `unknown`, never `idle`). Its "rather than animating it" half is proven only for rules the guard's exact-selector, first-media-block, base-plus-`::after` model happens to see. `status: "covered"` therefore claims more than the evidence supports, and § 8.4 is a build-time gate.
- **Chair adjudication — why this is no longer BLOCK.** Severity stability forbids moving a persisting finding without an evidence delta; there is one, in likelihood and reachability. In rounds 1 and 2 the escape was *invited*: round 1's guard admitted the naive mutation outright, and round 2's failure message ("the media query does not name it") literally instructed the next developer into the P2 escape. Both are now closed, and every direct, obvious mutation is caught. What remains requires writing a contextual selector, a `::before` rule, a duplicate media block, or a transition **for this specific state** — edits with no motivation behind them. There is no live defect: the shipped CSS is static and correct. Both specialists who did the deepest work on it this round rated it non-blocking. Escalating a third time would be the thrash the cycle cap exists to prevent.
- **The real signal, and it is worth stating plainly**: this guard has now been wrong **six times** — colour flattening hid an arc; `::after` halos and dropped fills hid an invisible state; `border: 0` read as ink; deleted animations hid a spin; a media-query mention exempted a state; a shared `::after` scalar masked a base animation. **The inventory has expanded in all three review rounds.** Per the review contract, that is the point at which patch-level fixing is declared failed. Each patch was locally correct and the next dimension of a hand-written regex approximation of the CSS cascade opened behind it. A seventh regex patch should not be attempted.
- **Fix — pick one, neither of them another regex**:
  1. **Narrow the claim to what the guard proves.** Restate `[I17]` so the registry says what is actually checked, or split the motion half into its own row with an honest status. Cheapest, and it ends the overstatement today.
  2. **Stop parsing source.** Assert computed style on a mounted element under both motion preferences, so the cascade is evaluated by the engine that owns it rather than approximated. This dissolves all six escape classes at once, including the shape-collision one.

**Status**: accepted
**Triage**: Taken now rather than deferred, and rebuilt rather than patched — your instruction not to write a seventh regex was the right read. The defect was one assumption, not six cases: `.exec` returns the FIRST match, so the guard saw one rule per state and one reduced-motion block while the file holds two of the latter and already uses contextual selectors on this element. It now collects every rule whose selector targets the state, across every block, including `::before` and grouped selectors. Anchoring the class name also exposed a latent merge the old substring test was hiding: `running` is a prefix of `running-unconfirmed`, so those two states had been compared as one shape. All four escape classes you named were replayed as mutations and all four now fail — E1, the `.wt-glyph` override, fails as a SHAPE collision with `idle`, which is the serious one.

### [W10] `renderedWorktreeIds` does not check `noFolder`, so a crossing can wake a view that draws nothing
- **Severity**: WARN · **Confidence**: MEDIUM · **Priority**: P2 · **Status**: new (chair spotted the gap; the specialist established reachability)
- **Agent**: asm-review-logic (F1) + chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:745` against `:627`
- **Evidence**: `render` returns at `:627` after appending `worktreeEmptyState("noFolder")` — **before it looks at the tree at all**. `renderedWorktreeIds` guards only `!tree || tree.repos.length === 0`, so with `noFolder: true` and a tree present it returns the full shown set and a timer is armed for rows that are not on screen. The code comment claims the predicate is "Exactly `render`'s own fall-through, and no more"; it is one term short of that.
  The specialist established the reachability the chair could not: `WorktreeController.push()` at `:788` sets `noFolder` from `init.workspaceRoot === null`, while `handleTreeResponse` at `:674` assigns `this.tree = msg.tree` **unconditionally** — nothing gates an arriving tree on `workspaceRoot`. So `{ noFolder: true, tree: <repos> }` is constructible at the view's own contract boundary, which is why this is WARN rather than the SUGGEST the chair had provisionally rated it.
- **Impact**: **Wasted wake — the benign direction.** A ceiling fires, the signature moves, and `render` does a full `replaceChildren()` teardown to redraw the same "no folder" empty state. No false claim reaches the user; this is the original W2 cost, bounded.
- **Fix**: `if (this.data.noFolder) { return ids; }` — or [S11], which dissolves it.

**Status**: accepted
**Triage**: Fixed by S11 rather than by adding the missing term — a third term would have been the third drift. Verified your reachability evidence: `handleTreeResponse` assigns the tree unconditionally, so `{ noFolder: true, tree }` is constructible. Test pins it both ways.

### [S11] Two hand-mirrored transcriptions of the visibility rule remain; this class has now drifted twice
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-logic (F2)
- **File**: `src/webview/worktree/WorktreeView.ts:736-757`
- **Evidence**: Round 1's W2 and round 2's B3 were both drift between `render`'s gate chain and the scheduler's copy of it. The round-2 fix extracted `shownWorktrees` — the **inner** rule — and left the **outer** early-return chain hand-mirrored, which is exactly where [W10] sits. The workflow Notes already record the lesson ("Any helper claiming to mirror what the render draws needs a test that pins the two together, not a reading of both"); this makes the mirroring unnecessary rather than merely tested.
- **Suggested shape, from the specialist**: stop re-deriving and **read what was actually painted**. `armCeiling` runs after `render` on both paths (`applyAt` `:263`→`:265`, `repaint` `:277`→`:278`), and when `render` is skipped the DOM still holds the last painted set — which is the correct answer. `this.signature` starts `null`, so the first `setData` always renders before any arm.
  ```ts
  private renderedWorktreeIds(): Set<string> {
    return new Set(
      [...this.element.querySelectorAll<HTMLElement>("[data-worktree-id]")].map((el) => el.dataset.worktreeId ?? ""),
    );
  }
  ```
  `renderWorktreeRow` already stamps `row.dataset.worktreeId = info.id` (`worktreeTreeView.ts:231`). Drift becomes structurally impossible rather than test-pinned. If a DOM read is unwanted, the fallback is one private `drawsTree(): WorktreeTree | undefined` holding all four gates, consumed by both.

**Status**: accepted
**Triage**: This is the fix, not a suggestion, and it dissolves W10 and the whole class B3 came from. `armCeiling` always runs after `render`, so the drawn worktree ids are read straight out of the DOM. There is no predicate left to restate and therefore none left to drift.

### [S12] `repaint()` still rebuilds the DOM on a disposed view, whose tooltips are already dead
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4 · **Status**: W6 residual
- **Agent**: asm-review-logic (F3)
- **File**: `src/webview/worktree/WorktreeView.ts:275`
- **Evidence**: `repaint()` calls `this.render(now)` unguarded; only `armCeiling` at `:294` checks `disposed`. `dispose()` does not detach `this.element` and **does** call `disposeTooltips()` at `:444`, which unbinds the delegate from that element. The commit's own W6 rationale is that these handlers are "still bound to live DOM" — if that is true enough to plant a timer, it is true enough to repaint. The new test asserts only `vi.getTimerCount() === 0`, not that no render occurred.
- **Impact**: a post-dispose interaction rebuilds still-attached DOM whose tooltips are permanently dead — a half-live view. Cosmetic; the panel owner normally removes the element, so reachability is narrow. The chair had dismissed this residual as pre-existing behaviour; the specialist's point that `disposeTooltips` makes the rebuilt DOM actively broken is the sharper reading and is adopted.
- **Fix**: hoist the guard to `repaint()`; keep the one in `armCeiling` as the backstop for `applyAt`.

**Status**: accepted
**Triage**: `repaint()` after disposal rebuilding DOM whose tooltips `dispose()` already tore down is not equivalent to the pre-change behaviour — you were right to withdraw the dismissal. The render is guarded now, not only the arming.

### [S13] `confidenceHint`'s newly required clock is re-defaulted one frame up
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4 · **Status**: S9 residual
- **Agent**: asm-review-logic (F4)
- **File**: `src/webview/worktree/worktreeTreeView.ts:472`
- **Evidence**: The diff tightens `confidenceHint(row, activity, now: number)` with the comment *"Required. An optional clock defaulting to `Date.now()` is the same crack S2 closed"* — and the sole in-file caller then writes `confidenceHint(row, activity, opts.now ?? Date.now())`, moving the crack into `AgentRowOptions.now?`. Both current callers supply `now`, so nothing is broken today. The chair rated S9 fully fixed last turn on the grounds that the default belongs at the boundary; the specialist's reading is better — the type no longer enforces what the adjacent comment claims, and a future `renderAgentRow` caller that omits `now` reintroduces B2 with no compiler objection.
- **Fix**: make `AgentRowOptions.now` required and delete the `?? Date.now()`.

**Status**: accepted
**Triage**: Your correction is right: making `confidenceHint`'s clock required only moved the crack one frame up into `AgentRowOptions.now?`. That is now required too, and the type check passed clean, which means both call sites were already threading it.

### [S14] Mixed vouched-and-unconfirmed busy rows still lose the unconfirmed qualification
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P3 · **Status**: W7 residual
- **Agent**: chair + asm-review-frontend (independently)
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:237`
- **Evidence**: The nested ternary preserves the unread clause only when `vouched === 0`. With at least one vouched row **and** an unconfirmed row, the chain falls to `unread === 0` → "An agent is mid-turn in this worktree.", or to the final branch → "…and another/others cannot be read at all." Either way the unconfirmed row is not mentioned. Full truth table over (confirmed, vouched, unread), verified by the chair: the six arities the fix targeted are all now **correct**, including all three unread arities under `vouched === 0`. The gap is the orthogonal dimension the cascade never branches on.
- **Impact**: Materially smaller than W7 was. The sentence is *true* of the vouched row — this is omission, not the false certainty W7 raised. A user cannot tell that another listed busy row has outlived its confirmation evidence.
- **Fix**: the chain is a linear cascade over three independent dimensions, so branch-per-arity will always leave one combination silent. Derive `unconfirmed = confirmed - vouched` and **compose** independent clauses for vouched, unconfirmed and unread members rather than adding a fourth branch.

**Status**: accepted
**Triage**: Confirmed, and taken as composition as you advised rather than a fourth branch: the sentence is now assembled from one clause per non-zero count, so any mixture of vouched, unconfirmed and unreadable rows states all of it. While doing so I changed a pinned string gratuitously and an existing test caught it; the original wording is restored.

### [S15] `strongestConfidenceTip` picks the first matching row, so a collapsed worktree's elapsed figure is order-dependent
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4
- **Agent**: asm-review-frontend (Q3c) + chair
- **File**: `src/webview/worktree/WorktreeView.ts:725-731`
- **Evidence**: `rows.find(r => presentedActivity(r, degraded, now) === strongest)` takes the first array member. The hint is truthful for that row, but it is not a stable aggregate witness: pane rows preserve source pane order and external rows are appended afterwards, so with several unconfirmed rows at different ages the collapsed worktree's "at least N minutes" depends on input ordering and silently omits the others. `strongestActivity`'s `undefined` return is correctly gated, and `rows.find` cannot miss, since `strongest` was produced from the same rows — the defensive `source ? … : undefined` is unreachable but harmless.
- **Fix**: pick the longest-standing qualifying row rather than the first, so the worktree's figure is the strongest true statement about it.

---

**Status**: accepted
**Triage**: Correct — `rowsByWorktreeId` order is not a contract. Now takes the longest-standing matching row, which is also the truthful bound rather than merely a deterministic one.

## Fixed and verified this round

- **[B1] P2 and P3 — FIXED**, independently re-probed by asm-review-frontend. `motion` is tracked per layer, so an `::after` the media query names can no longer cancel a base animation; and the unreduced pass now asserts the static state is static, so naming a state in the media query no longer exempts it. Residual scope in [W9].
- **[B3] — FIXED.** The predicate is now `!tree || tree.repos.length === 0`, matching `render`'s real fall-through, and the retained-listing path draws and arms. Pinned by "still arms a crossing when git is unavailable but the listing was retained", which asserts both the drawn row and `getTimerCount() === 1`.
  **The specialist's structural result is the most valuable output of this round**: `renderedWorktreeIds` now guards a strict *subset* of `render`'s early returns (`!tree` subsumes `loading && !tree`; `repos.length === 0` subsumes the `gitMissing` branch) and the per-repo path is literally the same `shownWorktrees` call. The id set is therefore a **superset** of what is drawn, and a superset can only produce a wasted wake, never a dropped crossing. **The severe direction — a drawn row that no timer can ever repaint — is structurally closed at HEAD**, not merely patched. No input produces drawn rows with an empty id set.
- **[W6] — FIXED for arming.** `setTimeout` appears exactly once in the file, inside `armCeiling`, behind the guard, so `setData`→`applyAt`, all four `repaint()` callers, and the post-fire re-arm are covered. A pending timer cannot outlive `dispose()`: `dispose` clears it and the callback body runs synchronously, so `dispose` cannot interleave mid-callback. Residual in [S12].
- **[W7] — FIXED.** All three unread arities keep the unreadable-rows clause under `vouched === 0`; the six enumerated arities read correctly against the four-case comment. Residual in [S14].
- **[W8] — FIXED.** `renderWorktreeRow` composes `worktreeTooltip(info)` with the tip via a ternary, so an unqualified row's `data-tip` is byte-identical to before — no separator, no empty item. The row carries `data-tip` itself and `Tooltip` serves `focusin` through `closest('[data-tip]')`, so focus landing on the row reaches it. Derived inside the render cycle from the threaded `now`. Residual in [S15].
- **[S8] — FIXED properly.** Both orders are pinned against a `Record<PresentedActivity, true>`, so a new union member fails to compile until it is listed in both. This is the version that closes the failure mode; the round-2 parity version did not.
- **[S9] — FIXED at `confidenceHint`**, residual one frame up in [S13].
- **[B2] — still holds.** Clock reads in `WorktreeView.ts` are `:209`, `:230`, `:276`, `:304`, `:424` — all entry points, none inside a render. `strongestConfidenceTip` threads `now` into all three of `strongestActivity`, `presentedActivity` and `confidenceHint`. Confirmed by both the chair and asm-review-logic.
- **No new races, leaks, double-arms or ordering defects.** Checked and clean: `armCeiling` clears before every create; `at > now` correctly excludes crossings already consumed; the `Math.min(Math.max(0, at - now), MAX_TIMEOUT_MS)` clamp terminates rather than spinning; simultaneous crossings on two rows are both re-presented by one fire; and the crossing is not swallowed by the no-op guard, because `presentedActivity(…, now)` is in the render signature.

## Carried forward

- **[S6]** — accepted and **deferred** by the author, recorded in workflow.md Notes. Non-gating, correctly not taken in task 2_2. Not re-raised.
- **Known-and-accepted, still honoured**: timer suspension while the surface is hidden is out of scope; `unknown` outranking `running (unconfirmed)` is accepted; `running (unconfirmed)` in spec prose is a state name; the `noDescendingSpecificity` biome finding is pre-existing.
- **Audit backlog**: none. **Accepted risk**: none.

## Cycle disposition

Three rounds, one cycle. Gating blockers went 2 → 2 → **0**. The production code is in good shape: the derivation rule, the single clock reading, the timer lifecycle, the visibility scoping and the wire surface are all verified, and the one failure mode that would have mattered — a drawn row animating a claim nothing can repaint — is now structurally impossible rather than merely tested.

The thrash-stop options are **not** required for the change. They are worth considering for **the `[I17]` shape guard specifically**, which is the one artefact whose defect inventory expanded in every round. Recommendation: close this cycle, and take [W9] as a small follow-up change that either narrows the registry claim to what is actually proven or replaces source parsing with computed-style assertions — not a seventh regex patch inside this change's lease.
