# Review round 2 — cap-inferred-running

- **Date**: 2026-08-29
- **Cycle**: 1
- **Round**: 2
- **Mode**: verification
- **Scope**: `31d56275..4e68350f` (one commit, `4e68350f` — "fix(cap-inferred-running): prove the still shape, and read the clock once"), plus the round-1 findings verified at invariant level and the two rebuttals
- **Head**: `4e68350f957b293b43fb3250cfaff1fe967d431c` — working tree dirty only in files outside the reviewed range (`docs/ui/worktree.html`, `skills-lock.json`, analytics JSON, untracked `docs/ui/worktree-workbench.css`)
- **Reviewable lines**: ~200 added/modified across 4 reviewable files (`WorktreeView.ts`, `worktreeTreeView.ts`, `worktreeFormat.ts`, `WorktreeRemoveDialog.ts`); 3 test files reviewed inline
- **Master session id**: `5f2a59f2-f137-40a2-b797-dcd98fd208a5`
- **Verdict**: BLOCK
- **Counts**: 2 BLOCK · 3 WARN · 4 SUGGEST
- **Split over gating blockers**: 2 feature / 0 machinery

**Scope lock: PASSED.** The diff adds `tasks.md` task `2_1`, whose plan enumerates exactly the round-1 findings B1, B2, W1-W5, S2-S5. No new capability, no semantically changed contract or design, no new invariant owner — `shownWorktrees`/`renderedWorktreeIds` are derived helpers, not durable state, and `repaint()` is a re-routing of existing render calls. Remediation only; verification proceeds.

## Agents

| Assignment | Specialist | Model | Report status |
|---|---|---|---|
| Spec conformance of the fix diff + adjudication input on both rebuttals | asm-review-contracts | sonnet[1M] | **received and used** |
| Render/schedule rewiring, visibility drift, timer clamp, dispose (B2/W2/W4/W5 cone) | asm-review-logic | opus[1M] | **not accounted for** — see note |
| Repaired CSS guard, hint reachability, dialog copy (B1/W1/W3/S3/S5 cone) | asm-review-frontend | gpt-5.6-terra[1M] | **not accounted for** — see note |
| Independent chair verification + guard attack | chair | — | complete |

> **Attribution note.** An earlier draft of this file credited findings B3, W6, W7 and W8 to the logic and frontend specialists. Those two reports are not accounted for in the chair's working context, so those attributions could not be substantiated and have been corrected to `chair`. Every one of those four findings has since been **re-derived and verified by the chair directly against the code**, with the evidence quoted in each entry; none rests on a specialist claim. The contracts report is in hand and is cited where it is used. Treat the logic and frontend lenses as **not delivered** for this round: their cone — in particular an independent enumeration of the `renderedWorktreeIds` drift and an independent attack on the repaired guard — should be re-run before this cycle closes.

**Chair guard attack** (scratch probe, created and deleted in one command; the project's suite was NOT run). A verbatim hand-port of the *repaired* `[I17]` guard at HEAD, scored against mutated CSS:

| Probe | Result |
|---|---|
| P0 as shipped | green |
| P1 `+ animation: wt-spin …` on `.wt-state--running-unconfirmed` (the author's own mutation check) | **red** — "still animates under prefers-reduced-motion" |
| P2 same animation **plus** naming the state in the `@media (prefers-reduced-motion: reduce)` block | **green** |
| P3 base animates, with an `::after` the media query does name | **green** |

P1 confirms the repair is real for the mutation the author tested. P2 and P3 are new escapes.

---

## Findings

### [B1] Persists from round 1 — the guard proves nothing animates *under reduced motion*, not that the unconfirmed state is static
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1 · **Status**: persists from round 1 (same invariant, same causal mechanism — the guard admitting an animated static state — so this appends to B1 rather than opening a new id)
- **Agent**: chair (probes P2/P3) + asm-review-contracts (Q3, independently)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.test.ts:388-397` and `:457-470`; `src/test/invariants/registry.ts:156-163`
- **Evidence**: The new assertion runs only inside `if (dropMotion)`, so what it proves is *"after the reduced-motion cascade is applied, every state resolves to `animation: none`"*. Probe P2: give `.wt-state--running-unconfirmed` a `wt-spin` animation **and** add `.wt-state--running-unconfirmed { animation: none; }` to the `@media (prefers-reduced-motion: reduce)` block — the guard is **green**, and the state spins for every user who has not asked for reduced motion, which is the default. The guard's own failure message — *"still animates under prefers-reduced-motion — the media query does not name it"* — names that edit as the fix, so it does not merely permit the escape, it recommends it.
  Confirmed by grep across the repo: **no assertion anywhere** pins `.wt-state--running-unconfirmed` as static at default motion preference. The shape key excludes motion by design ("motion is not shape"), and the `dropMotion: false` pass now discards every `animation*` declaration too (`if (/^animation/.test(prop)) { … continue; }` runs in both passes), so that pass checks motion not at all.
  Probe P3, a second and independent hole: `motion` is a single scalar declared once per `shapeOf` call and written last-wins across **both** the base and `::after` layers, so an `::after` animation the media query does name overwrites a base animation it does not — masking it. The shape key deliberately keeps the two layers apart, with a comment explaining that an `::after` "must not mask a base collision"; the new `motion` scalar does not follow that discipline.
  asm-review-frontend adds, independently: `/^transition/` is skipped unconditionally in both passes, so motion expressed as a transition is invisible to the assertion; `declsOf`'s regex cannot see a grouped selector, so `.wt-state--running, .wt-state--running-unconfirmed { animation: none }` in the media query would read as *not named* (fails closed — safe, but it means the guard's model of the cascade is textual, not structural); and `::before` is not modelled at all.
- **Impact**: The invariant reads "degrades an unconfirmed `running` rather than **animating it**", unconditionally, and the accepted spec says the state's "shape is static where the confirmed one animates" with no qualifier. `[I17]` remains `status: "covered"` while the animating half is still provable only for the reduced-motion minority. This is the guard's fourth escape of the same family: each repair closed the dimension that had just been walked past and left the next one open (colour flattening → `::after`/fills → `border: 0` → deleted animations → *animations restored by the media query*).
- **Chair adjudication**: asm-review-contracts independently reached the same residual gap (its Q3: "Not unconditionally... the registry statement is unconditional; the test that backs `covered` is conditional") and rated it WARN. I hold BLOCK. Severity stability applies — B1 was BLOCK in round 1, persistence does not change severity, and there is no evidence delta that narrows the impact: the animating half of a registered `covered` invariant is still unproven for the default motion preference, which is the majority case. The specialist's own evidence — that the base rule carries no `animation` today "by the shape of today's CSS, not by anything the guard checks in the `dropMotion: false` pass" — supports the higher rating rather than the lower.
- **Fix**: Assert staticness where it is actually claimed, not only under the media query. Two lines, both source-text: (1) in the `dropMotion: false` pass, assert `.wt-state--running-unconfirmed`'s effective `motion` is `none` **before** any override — and, to keep the pair honest rather than just the absence, assert `.wt-state--running`'s is not; (2) track `motion` per layer, exactly as `kept` already is, so an `::after` cannot write over a base fact. Then change the failure message so it no longer proposes the media query as the remedy.

**Status**: accepted
**Triage**: Both escapes reproduced and closed. P3 was one shared `motion` value across the base and `::after` layers, so an `::after` the media query names cancelled a base animation on a different element — now tracked per layer. P2 was the deeper one and the contracts agent stated the residual correctly: the registry claim is unconditional, so a state that stops only because the media query names it still spins for every viewer who never asked for reduced motion. The guard now asserts `running-unconfirmed` carries no animation in the UNREDUCED pass as well. Both of your probes were re-run as mutations against the repaired guard and both now fail it.

### [B3] The W2 fix drops every ceiling crossing while git is unavailable — a visible row animates a withdrawn claim indefinitely
- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1 · **Status**: new, introduced by the W2 fix (admissible: it is the fix diff itself)
- **Agent**: chair (derived and verified directly; the logic lens was not delivered — see the attribution note)
- **Class**: feature
- **File**: `src/webview/worktree/WorktreeView.ts:712-726` (`renderedWorktreeIds`) against `:604-635` (`render`)
- **Evidence**: The two disagree about what is on screen.
  - `renderedWorktreeIds()` bails whenever git is unavailable: `if (!tree || !tree.gitAvailable || tree.repos.length === 0) { return ids; }` — returning an **empty** set.
  - `render(now)` bails on that condition only when the tree is *also* empty: `if (tree && !tree.gitAvailable && tree.repos.length === 0) { … return; }`. With `gitAvailable === false` and `repos.length > 0` it renders the "Git is unavailable. Showing the last known worktrees." notice and then **draws every repo and worktree** — deliberately, per the comment three lines above it: *"an unusable git with a last good listing is a stale tree, not an empty one, and hiding it behind this state was what made the cache's retention invisible."*

  So in that state `nextCeilingCrossing` skips every worktree id, `soonest` stays `undefined`, and **no ceiling timer is ever armed** — while the rows are fully drawn and live. Presence is independent of the git listing (it comes from panes and hooks), so those rows keep updating and keep crossing the ceiling. A row that crosses re-presents only if some *other* data change happens to move the signature.
  Reachability confirmed directly: `src/worktree/WorktreeCache.ts:287` returns `{ repos: marked, unreadable: {...}, gitAvailable: false }` — a retained listing with repos present and the flag down, which is exactly the state `render` draws and `renderedWorktreeIds` refuses to.
  A second boundary of the same drift, failing the opposite way: `render` returns early on `noFolder` before touching the tree, while `renderedWorktreeIds` does not check `noFolder` at all — so `noFolder === true` with a non-empty tree arms a timer for rows nobody draws, resurrecting W2. Reachability is doubtful (`noFolder` is `workspaceRoot === null`, which normally implies no tree), so this half is MEDIUM confidence; the git-unavailable half is not.
  The remaining branches were checked and are consistent: `loading && !tree` (both empty), `repo.degraded` with `visible.length === 0`, the collapsed early return, and the cap — `renderRepo`'s `shown` is now genuinely `shownWorktrees(repo, multiRepo)`, so the repo-level rule has exactly one owner as claimed. The drift is entirely at the tree level, above where `shownWorktrees` was made authoritative.
- **Impact**: Precisely the failure the whole change exists to prevent — an output-inferred `running` row animating past the ceiling with nothing to stop it — reintroduced in a first-class, UI-supported degraded state that has its own notice and its own past bug-fix comment. It is invisible to the current tests, which all use `gitAvailable: true`.
- **Contracts divergence**: asm-review-contracts marked W2 **FIXED**, calling `renderedWorktreeIds()`/`shownWorktrees()` a "single source of truth for the collapse/filter/cap rule". That is true at the repo level and not at the tree level; the specialist did not compare the two functions' early-return chains. Evidence decides it — the two conditions are quoted above.
- **Fix**: Give the tree-level visibility rule one owner too, the way `shownWorktrees` owns the repo-level one. Extract the early-return chain from `render` into a predicate both call (`private drawsRows(): boolean`), or have `renderedWorktreeIds` mirror it exactly: bail on `loading && !tree`, on `noFolder`, on `!tree`, on `tree.repos.length === 0`, and on `!tree.gitAvailable && tree.repos.length === 0` — not on `!tree.gitAvailable` alone. Add a regression test with `gitAvailable: false` and a non-empty tree asserting a timer is armed.

**Status**: accepted
**Triage**: Verified independently and it is mine — the W2 fix introduced it. `WorktreeCache.ts:287` does return retained repos with `gitAvailable: false`, and `render` draws them: the only `gitAvailable` early-return is guarded by `repos.length === 0`, after which the flag produces a notice and the repo loop runs. `renderedWorktreeIds` mirrored an early return `render` does not have, so during a git outage every drawn row would animate a withdrawn claim for the length of the outage. Exactly the failure the change exists to end, reintroduced by the fix that scoped the walk. The guard now matches the real fall-through and a test pins that a drawn row can always cross.

### [W6] W5 persists at the `repaint()` boundary — a post-dispose interaction still plants a timer
- **Severity**: WARN · **Confidence**: MEDIUM · **Priority**: P3 · **Status**: persists from round 1 (same invariant — a discarded view accepting work — same mechanism)
- **Agent**: chair (derived and verified directly)
- **File**: `src/webview/worktree/WorktreeView.ts:274-278` (`repaint`), `:428-438` (`dispose`), callers at `:348`, `:466`, `:503`, `:773`
- **Evidence**: The `disposed` flag is checked in `setData` only. `repaint()` — a new entry point the fix itself introduced — calls `render(now)` and `armCeiling(now)` with no guard, and its four callers are DOM listeners (`setQuery`, `toggleCollapsed`, row expand, the show-all button). `dispose()` does not clear `this.element` or remove those listeners, so a click on a still-rendered row after disposal reaches `armCeiling` and installs a live timer on a discarded view — the exact leak W5 was raised for, through a door the fix opened. Round 1's suggested fix named `setData`/`applyAt`/`armCeiling`; only the first was guarded.
- **Impact**: Same as W5 — a disposed view kept alive and repainting on a schedule. Confidence is MEDIUM because a post-dispose click requires the host to leave the element interactive after disposal, which is not proven here.
- **Fix**: Move the guard down to `armCeiling` (and/or `repaint`), where every path converges, rather than leaving it on one caller.

**Status**: accepted
**Triage**: Verified: `repaint()` bypassed the `setData` check entirely, and every interaction handler stays bound to DOM after `dispose()`. The flag now sits in `armCeiling`, which is the single place a timer is created.

### [W7] The new `vouched === 0` branch drops the unreadable rows from the sentence
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3 · **Status**: new, introduced by the W1 fix
- **Agent**: chair (derived and verified directly)
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:228-234`
- **Evidence**: The branch chain is guarded by a comment that states the rule it must not break: *"Four cases, because a list can be part confirmed and part unreadable, and one sentence for the whole list would misdescribe whichever part it is not about."* The new `else if (vouched === 0)` branch is inserted **above** the `unread` cases and returns a sentence that never mentions them. Truth table for a refused removal with rows present:

  | confirmed | vouched | unread | sentence | accurate? |
  |---|---|---|---|---|
  | 0 | 0 | n | "…nothing can currently confirm it." | yes |
  | >0 | 0 | **0** | "…the activity here has outlived what can confirm it." | yes — this is the case the fix targeted |
  | >0 | 0 | **>0** | same sentence | **no — the unreadable rows are not mentioned at all** |
  | >0 | >0 | 0 | "An agent is mid-turn in this worktree." | yes |
  | >0 | >0 | >0 | "…and another/others here cannot be read at all." | yes |

  So one unconfirmed row plus two `unknown` rows now says nothing about the two the panel cannot read. Before the fix that combination said "An agent is mid-turn in this worktree, and others here cannot be read at all" — which named the unreadable part but overstated the first. The fix corrected the overstatement and lost the clause.
- **Impact**: A destructive-action dialog under-describes its own blocker list. Lower severity than W1 because the refusal itself is unchanged and correct — only the explanation is incomplete, and it errs toward saying less rather than claiming more.
- **Fix**: Compose the two clauses instead of branching between them: pick the certainty clause from `vouched`, then append the `unread` clause when `unread > 0`, so the five cases are two independent decisions rather than one ordered chain.

**Status**: accepted
**Triage**: Verified against the branch chain: with `confirmed > 0`, `vouched === 0` and `unread > 0`, my new branch swallowed the clause the previous chain used to carry. Softening the certainty is not a licence to drop what was already being said — the unreadable rows keep their clause in all three arities.

### [W8] W3 persists — the required statement is still unreachable by keyboard while the worktree is collapsed
- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2 · **Status**: persists from round 1 (same invariant — the hint reachable only by pointer — at a sibling boundary)
- **Agent**: chair (re-verified directly: `worktreeTreeView.ts:222` sets the worktree row's tip to `worktreeTooltip(info)` and nothing appends to it; `renderPresencePill` sets `tabIndex = -1` and `aria-hidden="true"`; `navRows()` at `WorktreeView.ts:967` selects `.wt-repo, .wt-row, .wt-arow, .wt-srow` and never the pill)
- **File**: `src/webview/worktree/worktreeTreeView.ts:499` (composed row tip) against `:184` (`row.dataset.tip = worktreeTooltip(info)`); focus model at `src/webview/worktree/WorktreeView.ts:963-980`
- **Evidence**: The fix reaches the **expanded** agent row and is correct there — the composed `data-tip` lands on the focusable `.wt-arow`, nothing later overwrites it, and `Tooltip`'s `focusin` resolves it. But a **collapsed** worktree shows the unconfirmed state on the worktree row's glyph, and that row's tip is `worktreeTooltip(info)`, which carries neither the elapsed figure nor the terminal-output qualification. The collapsed presence pill that also carries the state is `tabIndex = -1`, `aria-hidden = "true"`, and excluded from the roving tabindex. So a keyboard user who focuses a collapsed worktree presenting `running-unconfirmed` sees the state and can reach no part of the required statement without first expanding the worktree.
- **Impact**: The accepted requirement is that a row presented as `running (unconfirmed)` states "how long the activity has stood unchanged and that it was inferred from terminal output rather than reported" when inspected. On the collapsed surface that statement is still pointer-only in practice — and collapsed is the default state for a worktree the user has not opened.
- **Fix**: When a worktree row's strongest presented state is `running-unconfirmed`, extend its own `data-tip` with the qualification (and a pointer to expand for the per-row elapsed figure), rather than leaving the statement to a surface the keyboard cannot reach.

**Status**: accepted
**Triage**: Verified all three legs: `renderWorktreeRow` set the tip to `worktreeTooltip(info)` with nothing appended, `renderPresencePill` sets `tabIndex = -1` and `aria-hidden`, and `navRows()` never selects the pill. A first-seen worktree is collapsed unless it is in the workspace, so this is the common case, not an edge one — the glyph was qualified and the qualification unreachable. The worktree row now carries it.

### [S6] Narrowed and still open — the `double`-under-3px hole (rebuttal partly accepted)
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4 · **Status**: rejection PARTLY SOUND; the finding is narrowed, not withdrawn
- **Agent**: chair + asm-review-contracts (its Q5 reaches the same split verdict independently)
- **File**: `src/webview/worktree/WorktreeView.test.ts:389-397`
- **Chair adjudication of the rebuttal**: The rebuttal makes two claims and they are separable.
  - *"Including border width in the shape key would make the key finer and therefore weaker, admitting two states that differ only by a width nobody can see."* — **SOUND, and accepted.** This is correct reasoning about a distinctness key: a finer key admits more, and width is a poor carrier of shape. Round 1's suggested fix said "include width in the edge key", and I withdraw that half.
  - *"That is a rendering fact no source-text guard can reach without a layout engine."* — **not sound as a reason to do nothing.** It is true of rendering facts in general and false of this one: `border-style: double` needing `>= 3px` to paint two lines is a single fixed threshold, and the check is pure source text. It does not need the shape key at all — a standalone assertion ("any edge whose style is `double` must declare a width of at least 3px") closes it while leaving the key exactly as coarse as the rebuttal correctly wants it. The two positions were treated as one, which is why the fix looked like it had to weaken the key.
  Probes M2/M4 from round 1 remain green at HEAD: `border: 1px double` still passes while collapsing the unconfirmed ring toward `idle`'s. Non-gating — the shipped 3px is correct; nothing holds it there.
- **Fix**: The standalone assertion above, as a separate `expect`, not a change to the key.

**Status**: accepted
**Triage**: Rebuttal partly overruled and I accept the narrowing. My defence holds for arbitrary rendering facts but not for one static threshold, which a targeted assertion closes without widening the shape key. Deferred to a follow-up rather than taken now: it is not gating, and this task's lease is already carrying eight fixes. Recorded in workflow.md Notes.

### [S8] The membership assertion does not pin either order against the `PresentedActivity` union
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4 · **Status**: S4 fixed as reported; residual
- **Agent**: asm-review-contracts (its finding 2) + chair
- **File**: `src/webview/worktree/worktreeFormat.test.ts:227-235`
- **Evidence**: `expect([...PRESENTED_ORDER].sort()).toEqual([...PRESENTED_STRENGTH].sort())` compares the two arrays to each other and to nothing else. It closes the reported risk — a member added to one and forgotten in the other — but a seventh `PresentedActivity` member added to *neither* passes: both loops are `for (const activity of ARRAY) { if (presented.includes(activity)) … }`, so the member is silently dropped from the pill and can never win a worktree row. The `Record<PresentedActivity, string>` in the shape guard forces a new member to acquire a CSS rule, but nothing forces it into these two arrays.
- **Fix**: Assert the sorted arrays equal a `Record<PresentedActivity, true>`'s sorted keys, so the union drives both.

**Status**: accepted
**Triage**: Correct, and the failure mode is real: two arrays that agree can both be missing the same member. Now pinned against a `Record<PresentedActivity, true>`, so adding a member to the union fails to compile until it is listed in both.

### [S9] `confidenceHint`'s optional `now` reopens the crack S2 closed
- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4 · **Status**: new
- **Agent**: asm-review-contracts (its finding 3)
- **File**: `src/webview/worktree/worktreeTreeView.ts:479` (`confidenceHint(row, activity, now?: number)`), defaulting internally via `unchangedFor(row, now ?? Date.now())`
- **Evidence**: B2's premise is that one reading of the clock serves a cycle, and S2's fix removed exactly this defaulting from the dialog. The newly *exported* `confidenceHint` reintroduces it: a caller that omits `now` silently resolves its own. Both current callers supply it (`renderAgentRow` passes `opts.now`, which the dialog and the view now always set), so this is latent, not live — but it is a public seam shaped to permit the defect the round just fixed.
- **Fix**: Make `now` required, and let the one caller that has no clock pass `Date.now()` explicitly at the boundary.

---

**Status**: accepted
**Triage**: Correct — an optional clock defaulting to `Date.now()` is the same crack S2 closed in the dialog. `now` is now required on `confidenceHint`.

### [S10] The S1 rejection's stated evidence is inaccurate, though its conclusion holds
- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5 · **Status**: new
- **Agent**: asm-review-contracts (its finding 4)
- **File**: `src/webview/worktree/WorktreeView.ts:313-320`, `:700-726`
- **Evidence**: The rebuttal argues that "threading `now` for B2 removed some repetition incidentally". It did not net-remove work. This same fix diff **added** `renderedWorktreeIds()`/`shownWorktrees()`, a new O(worktrees) walk that runs on every `applyAt` regardless of whether the render fires, and `nextCeilingCrossing`'s per-row `presentedActivity` calls likewise run unconditionally. The chair's round-2 note that the change is "roughly net-neutral" is closer but still generous: the inner loop shrank while a new outer walk appeared.
- **Impact**: None on the decision — the axis (open terminal panes, tens of rows, four degraded-source kinds) is unchanged and bounded, so memoisation still buys nothing measurable and the rejection stands. This corrects the record so a later round does not rely on a cost claim that is not true.
- **Fix**: Restate the rejection's evidence as "added a new O(rows + worktrees) walk that is still cheap on this axis" rather than as a wash.

---

**Status**: accepted
**Triage**: The correction is right and I withdraw the claim: the diff ADDED an O(worktrees) walk on every `applyAt`, it did not remove work. My S1 rationale overstated. The conclusion is unchanged and S1 stays closed — the axis is open panes and the walk is cheap on it — but the record now says what actually happened rather than implying a wash.

## Fixed and verified

Each verified at the invariant level, not at the quoted line.

- **[B2] FIXED.** `grep 'this\.now()'` over `WorktreeView.ts` at HEAD returns exactly four sites — `setData:229`, `repaint:275`, the timer callback `:297`, and `openRemoveDialog:417`. None is inside the render chain; `render(now)` → `renderRepo(…, now)` → `renderWorktree(…, now)` carries the single reading to `strongestActivity`, `groupPresenceByActivity`, `presentedActivity`, `renderAgentRow.now` and `renderSubagentSection`. The two calls that shared one object literal are now one `now`. The new test at `WorktreeView.test.ts:548` uses an **advancing** clock (`NOW + ticks++ * CONFIRMATION_CEILING_MS`) — a frozen clock structurally could not hold this line, and this one can: any second read inside the render lands a full ceiling later and would draw the withdrawn glyph.
- **[W2] FIXED as reported** — the hidden-row case is closed and pinned (`"arms no crossing for a row the render does not draw"`, filtered query → timer count 0), and `renderRepo`'s `shown` now genuinely delegates to `shownWorktrees`, so the collapse-and-cap rule has one owner. See **[B3]** for the tree-level boundary the fix did not reach.
- **[W3] FIXED for the expanded agent row; PERSISTS for the collapsed worktree row — see [W8].** (asm-review-contracts marked W3 fully FIXED, having checked only the agent-row surface.) On the agent row the hint is composed into the row's own `data-tip` last — `[titleText, row.preview, confidenceTip].filter(Boolean).join("\n")` — which is what `Tooltip`'s `closest('[data-tip]')` resolves to on `focusin`, since focus lands on the row and `closest` walks upward. The author's first attempt set it on the marker and was silently overwritten by the composition below; the test caught it, and the code now carries a comment recording why the ordering matters.
- **[W4] FIXED.** `Math.min(Math.max(0, at - now), MAX_TIMEOUT_MS)` clamps correctly and in the right order. A year-out `stateStartedAt` now arms ~24.8 days, wakes once, re-derives and arms the remainder — bounded, not a loop. The test is well constructed: it counts *clock reads* across a second of fake time rather than timers, because the loop re-arms and the timer count stays 1 either way.
- **[W5] FIXED for `setData`** — see **[W6]** for the `repaint()` boundary. (asm-review-contracts marked W5 fully FIXED, having checked only the `setData` entry point.)
- **[S2] FIXED.** One `const now = deps.now ?? Date.now()` per dialog paint, flowing into both `presentedActivity` and `renderAgentRow`.
- **[S3] FIXED.** One `confidenceMarker(tip)` builder and one `confidenceHint` selector; the branch order reproduces the original `running-unconfirmed` → `unknown` → `isFallbackActivity` semantics for every state and source.
- **[S4] FIXED as reported** — see **[S8]** for the residual.
- **[S5] FIXED.** "at least N" replaces "over N", with the exact-ceiling case pinned (`unconfirmedHint(CONFIRMATION_CEILING_MS)` contains "at least 5 minutes" and not "over").
- **[W1] FIXED for the case it targeted** — the pure-unconfirmed list no longer asserts a turn is in progress, and the refusal is unchanged. See **[W7]** for the mixed case.

## Rebuttals adjudicated

- **S1 (memoise `presentedActivity`) — rejection SOUND, closed.** The rejection is correct and I would have reached it again. The growth axis is open terminal panes; the pre-existing signature walk builds a ~19-field delimited string per row in the same cycle and dominates the derivation cost by an order. The fix diff adds one new per-cycle walk (`renderedWorktreeIds`, O(repos × worktrees)) while shrinking `nextCeilingCrossing`'s inner loop to drawn worktrees only. Per asm-review-contracts this is a net **addition**, not a wash — see [S10]; the conclusion is unaffected because the axis is bounded. Memoising would add state to buy nothing measurable. Closed; not to be re-raised.
- **S6 (`double` under 3px) — rejection PARTLY SOUND.** The defence of the coarse key is accepted and round 1's "include width in the key" half is withdrawn. The claim that no source-text guard can reach the fact is not accepted: it is one fixed threshold, checkable in one `expect` that never touches the key. Re-listed above as a narrowed SUGGEST, non-gating.

## Carried forward

- **Known-and-accepted, still honoured**: timer suspension while the surface is hidden is out of scope; `unknown` outranking `running (unconfirmed)` is accepted; `running (unconfirmed)` in spec prose is a state name; the `noDescendingSpecificity` biome finding is pre-existing.
- **Audit backlog**: none.
- **Accepted risk**: none.

## Verified correct (no finding)

- `repaint()` renders unconditionally without touching `this.signature`, and that is correct rather than a leak: the signature describes DATA, and query/collapse/expand/cap are not data. A later `applyAt` comparing equal and skipping the render is right, because the DOM already reflects the current interaction state. The pre-fix code had the same property — `setQuery` called `render()` directly — so nothing regressed.
- All four `repaint()` callers match the manifest exactly (`setQuery`, `toggleCollapsed`, row expand, show-all), and each now re-arms the ceiling where it previously did not, which is required: changing what is drawn changes what can cross.
- `shownWorktrees` is genuinely the sole owner of the repo-level collapse-and-cap rule; `renderRepo`'s early returns (`visible.length === 0 && !repo.degraded`, and collapsed) agree with it in every combination checked.
- The derivation rule, the rank/vocabulary split, the wire surface, and the D27 narrowing of WT-004.0 are unchanged by this commit and remain as verified in round 1.
