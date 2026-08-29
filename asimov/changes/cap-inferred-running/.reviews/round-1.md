# Review round 1 — cap-inferred-running

- **Date**: 2026-08-29
- **Cycle**: 1
- **Round**: 1
- **Mode**: discovery
- **Scope**: commit range `21bd8d4a..31d56275` (explicit; overrides the working-tree default)
- **Head**: `31d562759522130efc9d4d3bef73864cced9e432` — working tree was dirty at review time, but only in files outside the reviewed range (`docs/ui/worktree.html`, `skills-lock.json`, analytics/cursor JSON, untracked `docs/ui/worktree-workbench.css`). The range was reviewed as committed.
- **Reviewable lines**: ~310 added/modified across 8 reviewable + behavioral files (`src/webview/worktree/{WorktreeView,worktreeTreeView,worktreeFormat,worktreeRenderSignature,WorktreeRemoveDialog}.ts`, `worktreePanel.css`, `src/test/invariants/registry.ts`). Test files (`WorktreeView.test.ts`, `worktreeFormat.test.ts`, `paneEvidenceReporting.test.ts`) reviewed inline per Phase 2.5. `docs/**` and `asimov/changes/**` skipped per classification — except that `docs/DESIGN.md` § 8.4 and `docs/PLAN.md` were read as the invariant contract this change registers against.
- **Master session id**: `5f2a59f2-f137-40a2-b797-dcd98fd208a5`
- **Verdict**: BLOCK
- **Counts**: 2 BLOCK · 5 WARN · 6 SUGGEST
- **Split over gating blockers**: 2 feature / 0 machinery
- **Session-id note**: re-review resumes this chair via the master session id above; it is resume context, never a change-id.

## Agents

| Assignment | Specialist | Model | Outcome |
|---|---|---|---|
| Timer lifecycle, clock threading, dispose ordering (`WorktreeView.ts`, `worktreeRenderSignature.ts`) | asm-review-logic | gpt-5.6-sol[1M] | 2 findings (first attempt on opus[1M] died on a transport error and was respawned) |
| Presentation surfaces, CSS shape guard, a11y (`worktreePanel.css`, `WorktreeView.test.ts`, `worktreeTreeView.ts`) | asm-review-frontend | gpt-5.6-terra[1M] | 4 findings |
| Spec conformance + `[I17]` registry (`spec.md`, `worktreeFormat.ts`, `registry.ts`, `WorktreeRemoveDialog.ts`) | asm-review-contracts | sonnet[1M] | 4 findings |
| Recompute / hot path / growth axes | asm-review-performance | gpt-5.6-luna[1M] | 2 findings (1 downgraded by the chair) |
| Reimplementation and duplication | asm-review-reuse | gpt-5.6-luna[1M] | 1 finding |
| Full-diff self-review + full-flow trace | chair | — | corroborated B1/B2, originated W1 |

Chair full-flow trace (discovery, mandatory): host push → `WorktreeController.push()` → `WorktreeView.setData` → `applyAt(now)` → `worktreeSignature(tree, presence, now)` [derives `presentedActivity` per row] → signature compare → `render()` [`replaceChildren()`, then `strongestActivity` / `groupPresenceByActivity` / `presentedActivity` / `renderAgentRow.now` / `renderSubagentSection`, each re-reading `this.now()`] → `armCeiling(now)` → `nextCeilingCrossing(now)` → `setTimeout` → `applyAt(this.now())`. Secondary flow: `WorktreeView.openRemoveDialog` → `openWorktreeRemoveDialog({ now: this.now() })` → `presentedActivity` + `renderAgentRow`.

Chair scratch probe (created and deleted in one command; the project's own suite was NOT run): a verbatim hand-port of the `[I17]` CSS shape guard from `WorktreeView.test.ts`, scored against four mutations of `worktreePanel.css`. Results — as shipped: green. `+ animation: wt-spin 0.9s linear infinite` on `.wt-state--running-unconfirmed`: **green**. `border: 3px double` → `1px double`: **green**. Both mutations together: **green**. Sanity mutation (unconfirmed made an exact copy of `idle`'s ring): correctly **red** in all four assertions.

---

## Findings

### [B1] `[I17]` is registered `covered` while the "rather than animating it" half has no test that can fail
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: chair (corroborated independently by asm-review-frontend and asm-review-contracts — three-way agreement)
- **Class**: feature
- **File**: `src/test/invariants/registry.ts:156-163`; tagged evidence at `src/webview/worktree/WorktreeView.test.ts:280` and `src/webview/worktree/worktreeFormat.test.ts:235`; CSS at `src/webview/worktree/worktreePanel.css:220-228`
- **Evidence**: The registry row's `statement` carries two obligations — "rather than animating it **or** calling it idle" — and its own `stimulus` names both: *"Keep animating an output-inferred run past the ceiling, **or** downgrade it to idle instead of presenting it as unconfirmed"*. Its `status` is `covered`.
  - Tagged test 1, `worktreeFormat.test.ts:235`, asserts only `presentedActivity(stale(), [], NOW) === "running-unconfirmed"`. That covers the *idle* half and says nothing about motion.
  - Tagged test 2, `WorktreeView.test.ts:280`, is the CSS shape guard. The chair probe above proves that adding `animation: wt-spin 0.9s linear infinite;` to `.wt-state--running-unconfirmed` leaves it **green in both passes**. In the `dropMotion: false` pass the animation string is kept in the key, but the two states are already distinct by border edges, so uniqueness still holds. In the `dropMotion: true` pass the guard *itself* deletes every `animation`/`transition` declaration (`if (dropMotion && /^(animation|transition)/.test(prop)) continue;`) rather than applying the real reduced-motion cascade — so it never notices that `@media (prefers-reduced-motion: reduce)` (`worktreePanel.css:272-280`) names only `.wt-state--running` and `.wt-state--waiting::after`. An animated unconfirmed state would therefore keep animating **even under reduced motion**, with the guard still green.
  - The one behavioural test that does exercise the rendered glyph (`WorktreeView.test.ts:441`, "stops animating a run that outlived its evidence") asserts only the class name and the `aria-label` — it is untagged and asserts nothing about animation either.
- **Impact**: `docs/DESIGN.md` § 8.4 is a build-time gate (`registry.ts` forbids `uncovered`/`deferred`, so a row may only enter the table with its covering test). `status: "covered"` here records coverage the suite cannot back: the first clause of the invariant's own stimulus ships green. Task `1_4`'s acceptance — "the truthfulness table carries the ceiling invariant **with a test that proves it**" — is half met, and the gate's guarantee for I17 is hollow. The CSS is correct today; nothing holds it there.
- **Fix**: Add an `[I17]`-tagged assertion that reads `.wt-state--running-unconfirmed`'s declarations from source and asserts no `animation`/`transition` in the base rule, while asserting `.wt-state--running` *does* carry one (so the pair, not just the absence, is pinned). Separately, make the guard model the reduced-motion **cascade** — apply the override block's `animation: none` to the states it names, rather than the guard deleting animation declarations for every state — so a state that animates with no override is caught as still-animating instead of being silently flattened. This is the guard's fourth escape of the same shape as the previous three (colour flattening hid an arc; `::after` halos hid an invisible state; `border: 0` read as ink): each time it dropped the dimension that carried the distinction.

**Status**: accepted
**Triage**: Verified independently: the reduced-motion block at `worktreePanel.css` names only `.wt-state--running` and `.wt-state--waiting::after`, so an animation on `.wt-state--running-unconfirmed` would survive the very cascade the state exists to be legible under — and the guard cannot see that, because its `dropMotion` pass deletes every `animation` declaration universally instead of applying the real media query. The guard admits the state; it does not prove it. Fixing the guard to model the actual cascade, and tagging a test that fails when the static state animates.

### [B2] "One reading of the clock serves the whole cycle" is not implemented; the comment asserting it is false and no test can observe it
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-logic + asm-review-contracts + asm-review-frontend + chair (four-way agreement)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:222-254` (`applyAt`), with the re-reads at `:732`, `:758`, `:778`, `:780`, `:798`
- **Evidence**: `applyAt(now)` computes `worktreeSignature(tree, presence, now)` and `armCeiling(now)` from one reading — but calls `this.render()`, which takes **no** `now` (`private render(): void` at `:567`). Its call chain re-reads `this.now()` five times: `strongestActivity(rows, …, this.now())` (`:732`), `groupPresenceByActivity(rows, …, this.now())` (`:758`), `presentedActivity(row, …, this.now())` (`:778`), `now: this.now()` for the agent row's hint (`:780` — a *second* call in the same object literal as `:778`, so a row's presented state and its own elapsed hint come from two different readings), and `renderSubagentSection(…, this.now())` (`:798`). In production `this.deps.now` is undefined, so every one of these is an independent `Date.now()`.
  The accepted spec's requirement *"One reading of the clock serves the whole cycle"* and its scenario *"WHEN the view re-presents its rows and schedules the next crossing THEN both used the same reading of the clock"* are therefore unmet, and `applyAt`'s own doc comment — *"ONE reading of the clock serves all three of the signature, what it renders, and the next deadline. Reading it again between them would let a row be drawn against one moment and scheduled against another"* — states the opposite of what the code does.
  No test can see this: every covering test injects `now: () => clock` where `clock` is a frozen variable, so all five re-reads return the same value by construction.
- **Impact**: Two concrete consequences. (a) The common case: the stored signature records a presented state the DOM never showed (signature says `running` at `now`, the row is drawn `running-unconfirmed` at `now+δ`), and the armed deadline then fires into a full `replaceChildren()` rebuild that changes no pixel — the exact draw/schedule divergence the requirement exists to forbid, and the guard's key stops describing what is on screen. (b) The severe case, surfaced by asm-review-logic: if the wall clock steps **backward** between `applyAt`'s reading and `render()`'s, the signature and the crossing walk (which share `now`) can both conclude "already crossed" — arming no timer — while `render()`, at the earlier reading, draws the animated `running` glyph. With no further push that row animates a withdrawn claim indefinitely. This change's entire purpose is to stop exactly that.
- **Fix**: `private render(now: number)`, threaded through `renderRepo` / `renderWorktree` / the agent-row loop into `strongestActivity`, `groupPresenceByActivity`, `presentedActivity`, `renderAgentRow`'s `now` option, and `renderSubagentSection`; entry points not reached from `applyAt` capture `this.now()` once at their own entry. Then pin it with a test whose injected clock **advances on every call** (e.g. `now: () => base + tick++`) and asserts the drawn state matches the signature — a frozen clock structurally cannot hold this line.

**Status**: accepted
**Triage**: Verified: `applyAt` computes one `now` and then calls `render()` with no argument; `this.now()` is re-read at :732, :758, :778, :780 and :798, and :778/:780 sit in the same object literal, so a row's presented state and its own elapsed hint already come from two moments. The comment on `applyAt` asserts the opposite. Threading `now` through the render path.

### [W1] The remove dialog says "An agent is mid-turn" directly above a row it has just drawn as unconfirmed
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair (the tally was also questioned by asm-review-contracts)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:181`, copy at `:216-231`, row render at `:239-249`
- **Evidence**: `confirmed = presented.filter(([, a]) => a !== "unknown").length` now counts a `running-unconfirmed` row as **confirmed**. With a single busy row that is output-inferred and past the ceiling, `confirmed === 1` and `unread === 0`, so the lead reads *"An agent is mid-turn in this worktree."* followed by *"Stop it first — there is no confirmation that removes a folder out from under a working agent."* Immediately below, `renderAgentRow(row, { activity, … })` draws that same row with the static unconfirmed glyph and the `~` marker whose hint says the claim is *"inferred from terminal output, not reported by the agent — the terminal is busy, which is not proof of a turn in progress."* One dialog asserts certainty and withdraws it in the same view.
- **Impact**: A user-visible truthfulness contradiction on a destructive-action surface, introduced by this diff, in a change whose whole premise is that presentation must not outrun evidence. Neither the accepted spec nor `worktree-activity-ceiling.md` covers this surface, so it was not considered.
- **Fix**: Do **not** shrink the refusal — keeping an unconfirmed row in the blocker set is the correct safe side of deleting a folder. Change only the certainty of the sentence: give `running-unconfirmed` its own bucket beside `confirmed`/`unread`, and when every confirmed-busy row is unconfirmed, lead with "An agent may be mid-turn in this worktree" (the wording `worktreeActivityLabel` already uses for the same state).

**Status**: accepted
**Triage**: Verified: `confirmed` counts every non-`unknown` row, so one busy unconfirmed row yields `confirmed === 1, unread === 0` and prints the flat certainty sentence directly above the `~` hint that denies it. The refusal is right and stays; only the certainty of the sentence changes. Not spec-pinned at sentence level — the accepted scenario requires the blocker be named and no confirm control offered, both unchanged.

### [W2] A crossing on a row nobody can see forces a full DOM teardown that changes nothing
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-performance + asm-review-logic + chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:285-303` (`nextCeilingCrossing`), with `src/webview/worktree/worktreeRenderSignature.ts:74-115` and `WorktreeView.ts:568-573`
- **Evidence**: `nextCeilingCrossing` walks `Object.values(this.data.presence?.rowsByWorktreeId ?? {})` with no reference to the search query (`matches`), collapsed repos, `MAX_WORKTREES_PER_REPO`/`uncapped`, or whether the row's worktree is in the current tree at all. `render()` opens with `this.element.replaceChildren()`. So a hidden output-inferred row crossing the ceiling arms a timer, busts the signature (which also walks all presence rows), and rebuilds the entire tree — scroll and focus are restored by key, but text selection and any transient DOM state are not.
- **Impact**: A new class of self-scheduled, zero-visible-change full repaint, with no data push behind it. The pre-existing signature already covered hidden rows, but before this change only an actual data change could trigger the rebuild; now the view schedules them for itself. Sits against the requirement that a re-presentation changing nothing performs no DOM work — the letter of its scenario ("no row has crossed") is met, its purpose is not.
- **Fix**: At minimum skip crossings for worktrees absent from `this.data.tree`. Better: restrict deadline candidates to rows the current query/collapse/cap state can actually draw, and re-derive on the state changes that alter visibility.

**Status**: accepted
**Triage**: Verified: `nextCeilingCrossing` walks all of `rowsByWorktreeId` with no reference to the query, collapsed repos or the display cap, and `render()` opens with `replaceChildren()`. This is a new class of self-scheduled zero-change repaint that the change introduces, and the accepted requirement says a re-presentation changing nothing performs no DOM work. Scoping the crossing walk to rows that are actually rendered.

### [W3] The unconfirmed hint — a required part of the statement — is reachable only by pointer
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-frontend (chair verified the delegation)
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:421-427`; delegation at `src/webview/ui/Tooltip.ts:216` and `:269`
- **Evidence**: The `~` marker is a non-focusable `<span class="wt-confidence">` appended inside `.wt-atitle`, which itself already carries `data-tip = titleText` (`worktreeTreeView.ts:417`). The delegated tooltip resolves `node.closest('[data-tip]')` from the event target and is bound to both `mouseover` and `focusin`. On `focusin` the target is the focusable row (`.wt-arow`), so `closest` never reaches the marker — a keyboard user gets the title tip, never the hint. The accepted requirement is *"WHEN a row presented as `running (unconfirmed)` is inspected THEN it states how long the activity has stood unchanged and that it was inferred from terminal output rather than reported."* The glyph's `aria-label` carries only the state name, not the elapsed figure or the evidence.
- **Impact**: For keyboard and screen-reader users the required statement is unreachable; they learn the state but not why or for how long. The same pattern predates this change for the `unknown` marker, but here it is the sole delivery mechanism for a newly accepted requirement.
- **Fix**: Fold `unconfirmedHint(...)` into the agent row's own `data-tip` (or an `aria-describedby` target on the row) when the presented state is `running-unconfirmed`, so the focus owner carries it.

**Status**: accepted
**Triage**: Verified: `Tooltip` resolves `closest('[data-tip]')`, which walks upward from the focused `.wt-arow` and can never reach a descendant span. The requirement makes the elapsed figure and the evidence mandatory parts of the statement, so pointer-only delivery does not satisfy it.

### [W4] An out-of-range future `stateStartedAt` arms a `setTimeout` that overflows and re-arms in a tight loop
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:265-275` (`armCeiling`), reached via `:288-301`
- **Evidence**: A future `stateStartedAt` is deliberately `confirmed` (`isUnconfirmed` requires `now - stateStartedAt >= CEILING`, and a negative age fails it), so `presentedActivity` returns `"running"` and `nextCeilingCrossing` accepts the row, returning `stateStartedAt + CONFIRMATION_CEILING_MS`. `armCeiling` passes `Math.max(0, at - now)` straight to `setTimeout` with no upper bound. A delay above `2_147_483_647` ms (~24.8 days) overflows the 32-bit timer and fires almost immediately; the callback re-derives the same still-future crossing and arms the same overflowing delay again. The signature is unchanged each time, so no DOM work happens — but the loop never terminates.
- **Impact**: A webview busy-loop with no self-recovery, pegging CPU until the panel is disposed. Reachability is remote (it needs `stateStartedAt` more than ~24.8 days ahead of the view's own `Date.now()`, and both normally come from the same machine — a restored cache written under a badly wrong clock is the plausible path), which is why this is WARN rather than BLOCK. `worktree-activity-ceiling.md` § 5 contemplates a future timestamp for the *derivation* and handles it; it does not contemplate the timer.
- **Fix**: `const delay = Math.min(2_147_483_647, Math.max(1, Math.ceil(at - now)));` — a capped wake that lands before the real crossing performs no DOM work and simply schedules the remainder.

**Status**: accepted
**Triage**: Verified: a future `stateStartedAt` is correctly presented as confirmed `running`, which is exactly what makes it an accepted crossing candidate, and `at - now` then reaches `setTimeout` unbounded. Above ~24.8 days it overflows, fires immediately, re-derives the same crossing and re-arms — a tight loop. Cheap to bound.

### [W5] `dispose()` clears the timer but nothing prevents a later `setData` from planting a new one
- **Severity**: WARN · **Confidence**: MEDIUM · **Priority**: P3
- **Agent**: asm-review-logic + chair
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:390-394` (`dispose`), `:218-221` (`setData`); caller at `src/webview/worktree/WorktreeController.ts:699-701` and `:780-789`
- **Evidence**: `dispose()` clears `ceilingTimer` and tears down dialogs, menu and tooltips, but sets no terminal `disposed` flag. `setData` unconditionally runs `applyAt` → `armCeiling`. `WorktreeController.dispose()` calls `this.view.dispose()` and nothing else; a host message arriving afterwards still reaches `push()` → `view.setData(...)`.
- **Impact**: Before this change, a post-dispose `setData` merely wrote into a detached element — harmless and collectable. Now it installs a live `setTimeout` that keeps the disposed view and its detached DOM alive and repainting on a schedule. The reachability of a post-dispose push is not proven here, which is why confidence is MEDIUM; the leak class is new either way.
- **Fix**: Set a `disposed` flag in `dispose()` and return early from `setData`/`applyAt`/`armCeiling` when it is set.

**Status**: accepted
**Triage**: Verified: the pre-change failure mode was a harmless write to a detached element; the change makes a post-`dispose` `setData` install a live timer that keeps repainting a discarded view. Adding a terminal flag.

### [S1] `presentedActivity` is derived up to four times per visible row per push
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-performance (**downgraded from BLOCK by the chair**)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:285-303`, `src/webview/worktree/worktreeRenderSignature.ts:102`, `WorktreeView.ts:732/758/778`
- **Evidence**: One `setData` derives the state once in the signature walk and once in the crossing walk for every row, plus once more via `strongestActivity`/`groupPresenceByActivity` and once per rendered agent row. Each derivation scans `degradedSources`.
- **Chair adjudication**: the specialist rated this BLOCK on an unbounded growth axis. The axis is real but the impact is not proportionate: the named axis is open terminal panes per worktree (bounded by what one human runs, tens), `degradedSources` is a closed set of four source kinds, and the **pre-existing** signature walk already builds a ~19-field delimited string per row in the same cycle — an order more work than the new pass. No datastore, no per-history recompute, no duplicate accumulation. Recorded, not gating.
- **Fix**: If addressed, do it while threading `now` for [B2]: derive one `Map<rowId, PresentedActivity>` per cycle and hand it to the signature, the crossing walk, and the render.

**Status**: rejected
**Triage**: The chair already downgraded this from the performance agent's BLOCK for the right reason: the growth axis is open terminal panes, and the pre-existing signature walk builds a ~19-field string per row in the same cycle. Threading `now` for [B2] removes some of the repetition incidentally; deliberate memoisation would add state to buy nothing measurable.

### [S2] The remove dialog resolves `Date.now()` twice for one paint
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-contracts
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:180` vs `:241`
- **Evidence**: `presentedActivity(row, degraded, deps.now ?? Date.now())` decides the state, then `renderAgentRow(row, { activity, now: deps.now }, …)` passes the *raw* possibly-undefined value, which `worktreeTreeView.ts:425` defaults again with its own `?? Date.now()`. So "is this row unconfirmed" and "how long has it been" can come from two readings. The only production caller (`WorktreeView.openRemoveDialog`, `WorktreeView.ts:381`) always supplies `now`, so this is latent rather than live — but it is the same crack as [B2] in a second file.
- **Fix**: `const at = deps.now ?? Date.now();` once, passed to both.

**Status**: accepted
**Triage**: Trivial and adjacent to the [B2] fix — one resolution per paint, same discipline.

### [S3] Three near-identical confidence-marker blocks
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4
- **Agent**: asm-review-reuse
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:421-449` (markers built at `:423`, `:429`, `:442`)
- **Evidence**: The new `running-unconfirmed` branch repeats the existing `unknown` and `isFallbackActivity` branches verbatim — create `span.wt-confidence`, set `"~"`, set `dataset.tip`, append — differing only in the tip string. The diff introduced the third copy.
- **Fix**: `const confidenceMarker = (tip: string): HTMLElement => …`; each branch computes only its tip. This is also where [W3]'s fix would land once.

**Status**: accepted
**Triage**: Also raised out of band by the reuse specialist as WARN/MEDIUM/P3; the chair's SUGGEST is the severity I am acting on. Extracting the marker builder is a few lines and removes a three-way drift risk in markup this change just touched. Folded into the [W3] fix, which rewrites those call sites anyway.

### [S4] `PRESENTED_ORDER` and `PRESENTED_STRENGTH` are byte-identical with nothing enforcing membership
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-contracts + asm-review-reuse
- **Class**: feature
- **File**: `src/webview/worktree/worktreeFormat.ts:203-244`
- **Evidence**: The split is justified — they answer different questions and are allowed to diverge in *order* — but neither is a `Record<PresentedActivity, …>`, so a future seventh member added to one and forgotten in the other fails silently: both loops are `for (const activity of ARRAY) { if (presented.includes(activity)) … }`, so a missing member is a set of rows that vanishes from the pill or never wins the glyph. The `Record<PresentedActivity, string>` exhaustiveness trick in `WorktreeView.test.ts:415` guards the CSS-rule side only.
- **Fix**: Assert `new Set(PRESENTED_ORDER)` equals `new Set(PRESENTED_STRENGTH)` and that both cover every `PresentedActivity` member, leaving order free.

**Status**: accepted
**Triage**: The two arrays answer genuinely different questions and the design says they may diverge — which is exactly why identical contents are a trap: a future member added to one and not the other is silently dropped from the pill or misranked. Adding the membership assertion, not merging the arrays.

### [S5] `unconfirmedHint` says "over N minutes" at exactly N minutes
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5
- **Agent**: asm-review-frontend
- **Class**: feature
- **File**: `src/webview/worktree/worktreeTreeView.ts:102-105`
- **Evidence**: `Math.floor(300_000 / 60_000) === 5` yields "Unchanged for over 5 minutes" when the elapsed time is exactly five minutes — and the deadline timer fires at exactly that instant. Same at 119 minutes and at 120 ("over 2 hours"). The accepted requirement it serves is only that a hint must not *understate* when read later, which holds; the word "over" is momentarily false at write time.
- **Fix**: "at least N minutes", or floor to a strictly lower whole unit before saying "over".

**Status**: accepted
**Triage**: A truthfulness change should not overstate by a hair at precisely the moment its own timer fires. One-line fix.

### [S6] The shape guard drops border width and does not know `double` renders as solid below 3px
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: chair + asm-review-frontend
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:389-397` (`shapeOf`'s `kept.set("edges", …)`)
- **Evidence**: The shape key records each painted edge's **style** only; width is used solely to decide zero/non-zero paint and is then discarded. `.wt-state--running-unconfirmed`'s entire distinction from `.wt-state--idle` is the word `double` vs `solid`. CSS renders `border-style: double` as a single solid line whenever the width is under 3px, so `border: 1px double` would collapse the unconfirmed ring toward `idle`'s while the guard stays green — chair probe mutations M2 and M4 both green. The shipped 3px is correct; the guard does not hold it there. The guard also models only `::after` (not `::before`) and keeps `box-shadow`/`outline`/`transform` as opaque strings rather than resolving whether they paint.
- **Fix**: Include width in the edge key, and treat `double` under 3px as `solid` when building it.

---

**Status**: rejected
**Triage**: Out of scope for the [B1] repair as scoped. `double` collapsing to solid below 3px is a rendering fact no source-text guard can reach without a layout engine, and the guard's job is to prove the states are declared distinct under the real cascade. Recording it as a known limit of the guard rather than pretending the fix covers it.

## Audit backlog

_None — this is a discovery round; everything found is in scope._

## Accepted risk

_None recorded._

## Known-and-accepted, not re-raised

Carried in from the change's Notes and honoured by every reviewer:
- Suspending the deadline timer while the surface is hidden is deliberately out of scope (visibility lives in `WorktreeController`, not the view).
- `unknown` outranking `running (unconfirmed)` is an accepted contract decision.
- `running (unconfirmed)` in spec prose is a user-visible state name, not embedded implementation.
- The `noDescendingSpecificity` biome finding in `worktreePanel.css` reproduces at base `21bd8d4a` and only shifted line 514 → 522.

## Verified correct (no finding)

Recorded so a later round does not re-litigate them:
- The derivation rule itself — `activity === "running" && activitySource === "output" && stateStartedAt !== undefined && now - stateStartedAt >= CEILING` — matches `worktree-activity-ceiling.md` § 2 exactly, including the absent-clock and future-clock exemptions and the choice of `stateStartedAt` over `lastActivityAt`.
- `unknown` wins over the ceiling, and clearing the degradation lands straight on `running-unconfirmed` with no paused measurement.
- The clock restarts on an activity change and not on a source change; a hook expiry grants no grace period (`worktreeFormat.test.ts` "restarts on a change of activity but not on a change of source").
- `groupPresenceByActivity` groups on `PRESENTED_ORDER`, so an unconfirmed row is counted under its own state and never dropped from the collapsed pill.
- Ranking: unconfirmed sits directly below `running`, so a worktree with any confirmed run reads `running` in either array order, and one waiting agent still outranks an unconfirmed run.
- Timer lifecycle basics: `armCeiling` clears before it sets, so at most one timer is live; it re-arms after firing, so a second crossing behind the first is still drawn; the exact-equality case (`now === stateStartedAt + CEILING`) presents as crossed and needs no further timer; the absolute deadline does not drift under repeated pushes, so a burst of pushes cannot starve a crossing.
- An unchanged signature performs no DOM work — `applyAt` skips both `pruneStaleState` and `render`.
- Wire surface unchanged: no message shape, no `activity` value, no `activitySource` value moved. `ageTimestamp` still reads the raw `row.activity`, which is correct — it chooses which clock to read, not what to claim.
- Documentation integrity: the `[I17]` `statement` matches `docs/DESIGN.md` § 8.4 byte-for-byte; the planned-invariants table lost exactly one row and its prose count was corrected from three to two; D27's narrowing of WT-004.0 is recorded as a narrowing in both `docs/DESIGN.md` § 9 and `docs/PLAN.md` rather than claimed as satisfaction.
