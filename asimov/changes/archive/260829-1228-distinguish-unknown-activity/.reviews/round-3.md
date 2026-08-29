# Review round 3 — distinguish-unknown-activity

- **Date**: 2026-08-29
- **Cycle**: 1 (final round of the cycle)
- **Mode**: verification
- **Head**: `713531366842d5fbe3c54f776f954ab276741617`
- **Scope**: `3ee55fae..HEAD` — one commit, `71353136`, remediating round-2 N1, N2, N3, N7, N8. Working tree dirty only OUTSIDE the reviewed set (`asimov/changes/active`, the change's own `analytics.json` / `.analytics-cursor.json`, `docs/ui/worktree.html`, `skills-lock.json`, untracked `asimov/.analytics-open/` and `docs/ui/worktree-workbench.css` — both `docs/**`, skipped at Phase 0). The range was reviewed at the recorded Head, not the tree.
- **Reviewable lines**: 31 added (non-test: `WorktreeRemoveDialog.ts` 20, `worktreeTreeView.ts` 11). Tests: 133 added (`WorktreeView.test.ts` 131, `paneEvidenceReporting.test.ts` 2) — the CSS shape guard was routed to a specialist lens rather than Phase 2.5 alone, because it is the standing evidence for parked manual task 1_3.
- **Verdict**: **WARN**
- **Counts**: 0 BLOCK · 2 WARN · 5 SUGGEST · 3 round-2 findings fixed · 2 persist in part · 1 persists · 3 audit-backlog carried
- **Agents spawned**: 3 — asm-review-logic (`opus[1M]`, remove-dialog copy partition), asm-review-frontend (`gpt-5.6-terra[1M]`, shape guard + tooltip), asm-review-contracts (`sonnet[1m]`, required-option API surface). Plus chair self-review and an independent 12-case counterfactual probe against the shape guard.
- **Agents skipped**: asm-review-data-security, asm-review-performance, asm-review-reuse — the cone is unchanged from rounds 1-2 (pure presentation derivation inside the webview; no persistence, auth, input validation, or growth axis), and this commit adds no helper, split, or second implementation of an existing capability.

## Scope lock

Passed. The diff since round 2 is one remediation commit plus asimov metadata. `tasks.md` gained `## 3. Review round 2` with task `3_1`, whose `Refs` point at the spec anchor the change already owned (`specs/worktree-panel/spec.md#an-activity-no-source-could-determine-is-not-presented-as-idle`) and whose Plan enumerates the five accepted fixes. No new capability, no semantically changed contract or design, no new invariant owner. This is round 3 of a maximum of 3; the cycle closes here.

## Verification of round-2 findings

| ID | Status | Verification |
|---|---|---|
| **N1** | **fixed** | `busy.some(...)` is gone. `presented = busy.map((row) => [row, presentedActivity(row, degraded)] as const)` is computed once at `WorktreeRemoveDialog.ts:176` and `confirmed` counts the non-`unknown` half. The branch chain covers `n === 0`, `confirmed === 0`, `confirmed === n`, and `0 < confirmed < n` — exhaustive and non-overlapping, since `presented` is a 1:1 map of `busy` and `0 ≤ confirmed ≤ n`. The wire/presented asymmetry does not break the partition: the wire filter decides *membership*, `presentedActivity` decides *the claim per member*. The same `presented` array feeds both the copy chain and the render loop, and `presentedActivity` is pure with `degraded` captured once at `:169`, so the sentence and the dots cannot re-derive different values. **Coverage**: all four branch strings are now pinned — `WorktreeView.test.ts:1266` (hedged, `toContain`), `:1287`, `:1308-1309`, `:1324-1325` (`toBe`). The certainty branch round 2 named as unasserted is now pinned. |
| **N2** | **persists in part** | `AgentRowOptions.activity` is required and `opts.activity ?? row.activity` is gone; all four call sites supply it (`WorktreeView.ts:706`, `WorktreeRemoveDialog.ts:233`, `paneEvidenceReporting.test.ts:373`, and no others — `renderAgentRow` has no importer outside `src/webview/worktree` and that one test). Not a breaking public surface. **But N2 named two defaults**, and the second is untouched: `WorktreeRemoveDialogDeps.degradedSources` is still `degradedSources?:` at `:28` with `?? []` at `:169`. Re-filed as **M4**. |
| **N3** | **persists in part** | The lead is fixed — the empty case now gets the weakest claim, in past tense, and is pinned at `WorktreeView.test.ts:1324`. The unconditional trailing directive is not. Re-filed as **M1**. |
| **N7** | **fixed** | `ACTIVITY_EVIDENCE[row.activitySource]` replaces `row.activitySource`, and the `unknown` arm now names `panes` for an `output` or `title` row — the same token the stale affordance uses. `failing === undefined` is exactly equivalent to the previous `row.activitySource === "none"` guard: `presenceTypes.ts:31-37` maps only `none` to `undefined`, checked by `satisfies Record<WorktreeAgentRow["activitySource"], …>`. The branch cannot be reached with a defined, healthy source: `presentedActivity` (`worktreeFormat.ts:151-155`) returns `unknown` only when `deciding === undefined` or `deciding` is in `degradedSources`. Reached independently by chair and asm-review-frontend. |
| **N8** | **persists** | The guard is materially stronger — see the probe table below, where three counterfactuals that passed the round-2 version now fail. But N8's own decisive counterfactual still passes. Re-filed as **M3** with the probe output. |
| **N4, N5, N6** | audit-backlog | Carried forward unchanged, non-gating. Re-listed below. |

## Independent counterfactual probe (chair)

The author asked that the counterfactuals be re-run rather than trusted. A scratch probe replayed the shipped guard's logic verbatim against 12 mutated in-memory copies of `worktreePanel.css` (the file on disk was never modified). All five `.wt-state--*` anchors were checked for verbatim presence before mutating, so no case silently no-ops.

| # | Counterfactual | Result |
|---|---|---|
| CF0 | shipped, unmodified | **PASSES** |
| CF1 | `.wt-state--running` restored to the pre-change tinted ring | **FAILS** — "two states share a shape (motion dropped: true) → running+idle" |
| CF2 | `.wt-state--waiting` base reduced to `{ border-radius: 50% }`, `::after` **intact** — round-2 N8's decisive counterfactual | **PASSES** ← M3 |
| CF3 | as CF2 **and** `::after` emptied to `content: ""` | **FAILS** — ".wt-state--waiting draws nothing", both passes |
| CF4 | `.wt-state--unknown` made `solid` in another hue | **FAILS** — "two states share a shape", both passes |
| CF5 | `waiting` base `{ border-radius: 50%; border: none }` + empty `::after` — draws nothing | **PASSES** ← M2 |
| CF6 | same with `border: 0` | **PASSES** ← M2 |
| CF7 | `.wt-state--unknown` base made byte-identical to `idle`, plus `.wt-state--unknown::after { content: "" }` | **PASSES** ← M3 |
| CF8 | control for CF7: same base collision, **no** `::after` | **FAILS** — "two states share a shape → idle+unknown", both passes |
| CF9 | `running`'s arc killed via `border-top-style: none` / `border-right-style: none` (colours left in place) | **PASSES** ← M2 |
| CF10 | `.wt-state--exited` flattened to `border-top: 0` — draws nothing | **PASSES** ← M2 |
| CF11 | `unknown` dashed→solid via a longhand `border-style: solid` — same pixels as `idle` | **PASSES** ← M2 |

CF1, CF3 and CF4 confirm all three of the author's reported counterfactuals, including that CF1 and CF4 are caught on the correct pass. CF7-vs-CF8 is the decisive pair for the `::after` question, and CF9/CF11 are the decisive pair for the `border-style` question.

**Refuted specialist claim, recorded so it does not propagate**: asm-review-frontend answered verification question 3 by stating that the `reduced` capture "is truncated at the first `\n}` inside the media query, so it contains only `.wt-state--running`; it never reaches the waiting `::after` override at `worktreePanel.css:268`". A direct probe refutes this. The captured block is `"\n  .wt-state--running {\n    animation: none;\n  }\n  .wt-state--waiting::after {\n    animation: none;\n    opacity: 0.4;\n  }"`, and `declsOf(reduced, "waiting::after")` returns `["animation: none", "opacity: 0.4"]`. The inner rules close with `\n  }` (two-space indent), which the `\n\}` terminator cannot match; the first column-0 `}` is the media block's own. Round 2's reading was correct and the parser is sound on this point. Everything else in that specialist's report is corroborated by the probe.

## Findings

### M1 — WARN · confidence HIGH · P2 · class feature
- **Agents**: asm-review-logic, chair (reached independently)
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:211` with `:220-224` and `:246`
- **Title**: The empty-list branch now says it cannot show the agent, then orders the user to stop it
- **Evidence**: The `presented.length === 0` lead is correctly retreated to past tense — `"An agent was mid-turn in this worktree, and no row can be shown for it now."` — but the text node appended at `:220-224` sits **outside** the branch chain and is unconditional: `" Stop it first — there is no confirmation that removes a folder out from under a working agent."` In that branch the `for (const [row, activity] of presented)` loop emits no rows, and the `if (busy[0] && deps.onShowAgent)` guard at `:246` suppresses the "Show the agent" button, leaving only "Close". The rendered paragraph reads, in one breath: *no row can be shown for it now. Stop it first.*
- **Impact**: This is the change's own defect class — a claim the view's own evidence does not support — reintroduced by the fix for it, on the one screen that gates a destructive action. **Evidence delta from N3 (SUGGEST)**, stated per the severity-stability rule: in round 2 the paragraph was internally consistent (a wrong but coherent present-tense claim); the fix made the lead explicitly disclaim the row, which the very next sentence presupposes. The impact changed from "an unactionable refusal" to "a self-contradicting paragraph", which is why this is WARN rather than N3's SUGGEST. It errs toward caution rather than an unevidenced positive, which is why it is not a BLOCK. N3's accepted triage named the replacement shape and it was applied to the lead only: *"a count-only sentence … ('An agent was mid-turn when this was checked; it is no longer listed. Retry the removal.')"* — the retry path is still absent, so the branch offers no route forward at all.
- **Suggested fix**: Move the trailing text node into the branch chain. Keep the existing sentence for the three branches that render rows; give the empty case its own, e.g. `" It is no longer listed here — retry the removal."` Extend the spec at `WorktreeView.test.ts:1319-1327` to pin the full `.wt-refusebox` `textContent`, not only the `b` element, so the two halves of the paragraph are asserted together.

### M2 — WARN · confidence HIGH · P3 · class feature
- **Agents**: asm-review-frontend, chair (counterfactual probe, corroborated)
- **File**: `src/webview/worktree/WorktreeView.test.ts:340-352` (the border branch of `shapeOf`)
- **Title**: The new `inked` assertion counts non-painting borders as ink, so it proves less than the commit claims for it
- **Evidence**: This is a finding about **evidence, not about the CSS** — the shipped stylesheet is correct. `flatten` maps only the literal `transparent` to `NONE`, so `lit = value.includes("NONE") ? "" : "ink"` treats every other value as ink. Probe results: CF5 (`border: none`), CF6 (`border: 0`) and CF10 (`border-top: 0`) all reduce a state to something that paints nothing and all three **pass** the guard, `inked === true`. `border: 0` is idiomatic in this very stylesheet (`.wt-presence { border: 0; }`). The `edges` map is also not cancellable: a standalone `border-width: 0` or `border-style: none` falls through to the generic `kept.set(\`${layer}/${prop}\`, value)` and never clears ink an earlier shorthand established — CF9 kills `running`'s arc with `border-top-style: none` / `border-right-style: none` and passes; CF11 turns `unknown` into pixel-identical `idle` with a longhand `border-style: solid` and passes. Separately, `kept.set(\`${layer}/style\`, …)` is a single key per layer, so a later `border` or `border-<side>` overwrites the earlier value and discards the style still applying to the other three sides.
- **Impact**: The commit's stated advance is that the guard "asserts each state is inked — a rule that draws nothing is distinct from every other rule and invisible on screen". That assertion holds only against the literal token `transparent`; against the two most ordinary ways to remove a border it is satisfied by CSS that draws nothing. Since this spec is the standing automated stand-in for parked manual task 1_3, the gap is in what the round record can claim, not in what ships today. No live defect.
- **Suggested fix**: Track final width, style, and colour per side in cascade order, and count an edge as inked only when width is non-zero, style is not `none`/`hidden`, and colour is not transparent. Add CF5, CF6, CF9, CF10 and CF11 above as regression cases for the guard itself.

### M3 — SUGGEST · confidence HIGH · P4 · class feature — **persists from round 2 (N8)**
- **Agents**: asm-review-frontend, chair (counterfactual probe, corroborated)
- **File**: `src/webview/worktree/WorktreeView.test.ts:315-323` and `:361` (the layer list and `inked ||=`)
- **Title**: The `::after` layer still lets a base-layer collision — and an empty base — through, so round-2 N8's own decisive counterfactual still passes
- **Evidence**: N8's accepted triage cited one counterfactual as decisive: *"replacing `.wt-state--waiting` with `{ border-radius: 50% }` … still scores 5/5 because its fill lives in the dropped `background` and its halo in a `::after` the regex never reads."* Both named mechanisms were addressed — `fill` is now a modelled key and `::after` is now read — and the counterfactual **still passes** (CF2). Two reasons, both structural: (1) `inked ||=` ORs across the base and `::after` layers, so the intact pulse ring keeps `waiting` inked while its base draws nothing; (2) the `kept` keys are namespaced by layer, which correctly prevents cross-layer collision but makes any `::after` declaration purely *additive* to the shape key. CF7-vs-CF8 isolates that second mechanism decisively: with `.wt-state--unknown`'s base made byte-identical to `.wt-state--idle`, the guard **fails** with no `::after` (CF8) and **passes** once `.wt-state--unknown::after { content: "" }` is added (CF7) — a pseudo-element that paints nothing at all, differing only by an `after/content` key. So the answer to the question the author raised is yes: the `::after` layer can mask a base-layer collision. Nothing asserts that any state's *base* paints.
- **Impact**: Bounded, and unchanged from N8 — this does not let the specific pre-change regression through (CF1 and CF4 both fail correctly). It matters because the round record would otherwise carry N8 as closed while its own justifying counterfactual passes.
- **Severity note**: held at N8's SUGGEST per the severity-stability rule. asm-review-frontend rated it WARN; its argument is N8's own ("this is the stand-in for a parked manual verify"), which is not a new evidence delta, so it is not escalated. Impact, likelihood and reachability are all unchanged from round 2.
- **Suggested fix**: Assert base-layer ink separately from the OR across layers (`baseInked` per state), and exclude non-painting pseudo-element declarations — `content`, `position`, `inset` — from the shape key, admitting a `::after` layer only when it paints a fill or a non-zero visible edge. CF2 and CF7 are the regression cases.

### M4 — SUGGEST · confidence HIGH · P4 · class feature — **persists in part from round 2 (N2)**
- **Agents**: asm-review-contracts, chair
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:28` and `:169`
- **Title**: N2's second named default is still optional, so the class it named is half-closed
- **Evidence**: N2's suggested fix named both `AgentRowOptions.activity` and `WorktreeRemoveDialogDeps.degradedSources`, and its accepted triage read "both defaults exist and every caller passes the argument, so making them required costs nothing". Only the first was changed. `degradedSources?: readonly PresenceDegradation[]` at `:28` and `const degraded = deps.degradedSources ?? [];` at `:169` are untouched, and the author's impact manifest for this round mentions only the first.
- **Impact**: No live defect — the one production caller (`WorktreeView.ts:800-805`) passes the field. The next caller silently reconstructs the pre-W1 behaviour: every listed row presents its wire value and the copy takes the confident branch. Same weight N2 already assigned it, with the same recorded counterpoint (`WorktreeRemoveDialogDeps` already carries other optional fields on the `?? fallback` convention, e.g. `agentRows?`).
- **Suggested fix**: Make `degradedSources` required, or explicitly re-triage N2 as "scope narrowed to `AgentRowOptions.activity`" so half of an accepted finding is not dropped silently.

### M5 — SUGGEST · confidence HIGH · P4 · class feature
- **Agents**: asm-review-logic, chair
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:217`
- **Title**: The new mixed-case sentence asserts a plural it has not counted
- **Evidence**: The branch fires for any `0 < confirmed < presented.length`, including one confirmed and one unreadable — which is exactly the configuration the new spec at `WorktreeView.test.ts:1290-1314` pins — yet the copy reads `"…and others here cannot be read at all."` Symmetrically, `"An agent is mid-turn"` is the lead when `confirmed` may be several. The file pluralizes carefully everywhere else on the same screen (`"Another worktree lives inside this one."` vs `` `${n} other worktrees live inside this one.` `` at `:187-188`; `blockerItem` guards `untracked === 1` and `idlePanes === 1`).
- **Impact**: Small, but it is a count claim the list does not support, added by the branch introduced to stop the copy misdescribing the list. A user seeing two rows reads "others" as two or more unreadable.
- **Suggested fix**: `const unread = presented.length - confirmed;` is already derivable from values in hand — pluralize both halves, and update the pinned string at `WorktreeView.test.ts:1308-1310`.

### M6 — SUGGEST · confidence MEDIUM · P5 · class feature
- **Agents**: asm-review-logic
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:246-254`
- **Title**: "Show the agent" targets `busy[0]` without regard to which rows the copy vouches for
- **Evidence**: The primary action always reveals the first wire-busy row. In the mixed branch the lead asserts a confirmed mid-turn agent, but `busy[0]` may be the row `presentedActivity` returned `unknown` for — ordering is whatever `WorktreeView.rowsFor(info.id)` yields. The `presented` pairs are in scope at that point, so the confirmed subset is free.
- **Impact**: The button can send the user to the row the dialog just said it cannot read while a confirmed row sits below it. A mismatch between the claim and the affordance, not a correctness bug; the row list itself is complete either way.
- **Suggested fix**: `const target = presented.find(([, a]) => a !== "unknown")?.[0] ?? busy[0];` and use `target` for both the gate and the click.

### M7 — SUGGEST · confidence HIGH · P5 · class machinery
- **Agents**: chair
- **File**: `src/webview/worktree/WorktreeView.test.ts:364`
- **Title**: The guard's state list is a hand-written `string[]`, so the reserved sixth vocabulary member will get no shape guard and no compile error
- **Evidence**: `const STATES = ["running", "waiting", "idle", "unknown", "exited"];` is newly extracted by this commit and is inferred as `string[]`, unconnected to `PresentedActivity` (`worktreeFormat.ts:133` = `WorktreeActivity | "unknown"`, and `WorktreeActivity` is the four-member union at `worktreeViewTypes.ts:28`). `stateShape` derives its class name as `` `wt-state wt-state--${activity}` `` from that union, so the two are required to agree. `docs/design/worktree-panel-ui.md:397` reserves `running (unconfirmed)` as a sixth member for WT-008.2, described as "a **static**, visibly different shape" — precisely a shape claim this guard is meant to hold.
- **Impact**: Adding the sixth member ships a state whose distinctness and inkedness are never checked, with nothing failing. Same shape of omission as round-1 S1 and round-2 N2: a silent default where an exhaustiveness check was available.
- **Suggested fix**: Declare it `const STATES: PresentedActivity[] = [...]` — or better, derive it from a `satisfies Record<PresentedActivity, true>` object so a new union member is a compile error in the guard.

## Phase 2.5 — inline support review

- **Tests**: three new specs, all pinning exact strings with `toBe` rather than `toContain`, which is the right instrument for copy that must not drift. Combined with the pre-existing `:1266` assertion, **all four refusal branches are now covered** — the coverage gap round 2 folded into N1 is closed. The mixed-case spec also asserts both dot classes (`wt-state--running` and `wt-state--unknown`) in the same list, so copy and glyph are pinned together rather than separately. No `.only` / `.skip`, no un-awaited async, and every new spec reuses the shipped `agentRow()` fixture.
- **Regression surface of the required option**: the four pre-existing refusal specs in `WorktreeRemoveDialog.test.ts:161-185` pass `agentRows: [busy]` with the fixture's default `activitySource: "hook"` and no degradations, so `confirmed === presented.length` and they continue to exercise the certain branch unchanged. No existing assertion was flipped or weakened by the new derivation.
- **`paneEvidenceReporting.test.ts:373`**: `activity: presentedActivity(row as WorktreeAgentRow, [])` is the right value for a spec that asserts only on `.wt-aicon`. Icon rendering reads `row.agent` / `row.agentSource`, never `activity`, and with an empty degradation list the derived value equals `row.activity` for any row with a source — the same value the removed default produced. What the spec exercises is unchanged.
- **Fixtures**: unchanged by this commit. No PII or secrets.

## Verify gate

Cited, not re-run (chair rules). `bun run asm change verify-status distinguish-unknown-activity` records `3_1 [x] exit 0 scope-unchanged`, with the suite delta as "assertions +6 — Round-2 N1/N8: pinned all four refusal-copy branches (previously only the hedged one was asserted) and rebuilt the shape guard around an edge profile plus a positive ink assertion. Three counterfactuals now fail it that passed before. One integration call site gained the now-required activity option. No assertion weakened." Author-reported gate on `71353136`: check-types pass, `pnpm run test:unit` 235 files / 4750 tests pass, I10 gate pass, biome at the pre-change baseline (3 errors / 14 warnings, all in untouched files). `1_3` shows `no record` — the parked manual verify.

## Audit backlog (non-gating)

Carried forward, none re-reported as new:

- **N4 (round 2)** — a collapsed `unknown` group that is not the strongest state never reaches assistive technology; the pill is `aria-hidden` by design and WT-010's rail composition reopens what the row summary claims. Unchanged by this commit.
- **N5 (round 2)** — the "is this row's evidence degraded" membership test is implemented twice (`worktreeFormat.ts:155` array scan vs `WorktreeHost.ts:527-529` set membership). Deferred to WT-008.2, which adds a third reader. Unchanged.
- **N6 (round 2)** — `activity === "running" || activity === "waiting"` spelled out at `WorktreeRemoveDialog.ts:172`, `worktreeBlockers.ts:151-153`, `WorktreeHost.ts:522-525`. Pre-existing at all three; the dialog's line is relocated again by this commit but not created by it. Unchanged.
- **Round 1, carried unchanged** — `worktreeTreeView.ts:531` renders a delegation subagent whose `status` is `"unknown"` as a completed checkmark, while `WorktreeHost.decay()` deliberately sets `unknown` when the parent's source is degraded. Same defect class as B1, adjacent surface, pre-existing.
- **Round 2, carried unchanged** — `worktreeFormat.ts:46` `ageTimestamp` reads the raw `row.activity` to pick the clock, so a wire-`running` row presented as `unknown` still ages from `stateStartedAt`. Not a leak of the invariant (the age column presents a duration, not a state), recorded because a change to what that column *claims* would make it one.

## Manual verify

Task 1_3 remains **parked, not skipped**. The rendered view at sidebar width, with reduced motion on and a monochrome or high-contrast theme, cannot be exercised here. It remains the only thing that settles whether a 1.5px dashed border on a 9px circle reads as a distinct outline rather than a fuzzy solid ring, and whether the `running` arc reads apart from the `idle` ring at sidebar size with the spin stopped. The automated stand-in is materially stronger this round — CF1, CF3 and CF4 all fail it — but M2 and M3 bound what it proves, and neither substitutes for the manual pass.

## Cycle close

Round 3 is the last round of cycle 1 and the exit condition (WARN, 0 blocking) was already met at round 2 and still holds. M1-M7 are non-blocking. If a further review is wanted after they are addressed, it starts **cycle 2, round 1 in discovery mode**, carrying the audit-backlog entries above forward re-listed rather than re-reported.

## Author triage (round 3)

All seven accepted; none rebutted. Each verified against the code before acceptance. Fixed under task `4_1`.

| ID | Status | Rationale |
|----|--------|-----------|
| M1 | accepted | Verified: the text node is appended outside the branch chain, so the empty case reads "no row can be shown for it now. Stop it first." The escalation from N3's SUGGEST is fair — the fix made the lead disclaim what the next sentence presupposes. Moving the follow-on sentence into the chain, giving the empty case a retry, and pinning the whole refusebox text rather than only the `b`. |
| M2 | accepted | Verified by re-running the probe's cases: `border: 0`, `border: none` and a longhand `border-style: none` all score inked. Tracking width, style and colour per side in cascade order so an edge inks only when it paints. |
| M3 | accepted | Folded into M2's fix rather than carried a third time: the base layer must ink on its own and be distinct on its own, so an `::after` that paints nothing cannot keep a state alive. This spec has now been wrong in three different ways, which is the argument for fixing it here rather than deferring it again. |
| M4 | accepted | Verified: I made the renderer's option required and left the dialog dep optional, which is half of N2. |
| M5 | accepted | Verified — "others" for one unreadable row is exactly the case the new spec pins. |
| M6 | accepted | Verified: `busy[0]` can be the row the copy just said it cannot read. Preferring the first confirmed row, falling back to the first listed. |
| M7 | accepted | Verified: an untyped `string[]` would let WT-008.2's sixth member ship with no shape guard. Deriving the list from a `Record<PresentedActivity, …>` so adding a member is a compile error. |

No further review round is requested. The cycle's exit condition (0 gating blockers) was met at round 2 and holds at round 3; these are accepted non-blocking fixes taken before close, not a fourth round's worth of work. The five audit-backlog entries carried by rounds 2 and 3 stay open for a later change.
