# Review round 1 — distinguish-unknown-activity

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: discovery
- **Head**: `bd0635a55c074c7c0d52acdf23c5c3491d1880ab`
- **Scope**: commit range `94135439..HEAD` (4 commits). Working tree was dirty in files OUTSIDE the reviewed range (`docs/ui/worktree.html`, `skills-lock.json`, the change's own analytics json, untracked `asimov/.analytics-open/`); the range was reviewed at the recorded Head, not the tree.
- **Reviewable lines**: ~137 (code only: `worktreeFormat.ts` 74, `worktreeTreeView.ts` 34, `WorktreeView.ts` 15, `worktreePanel.css` 14). Tests reviewed inline at Phase 2.5 (172 lines). Docs (`docs/**`, 2 of the 4 commits) classified skipped per Phase 0; § 7.2 and § 8.4 read as contract anchors, not reviewed as prose.
- **Verdict**: **BLOCK**
- **Counts**: 1 BLOCK · 4 WARN · 2 SUGGEST
- **Split (gating blockers)**: 1 feature / 0 machinery
- **Agents spawned**: 4 — asm-review-logic (`opus[1M]`), asm-review-frontend (`gpt-5.6-terra[1M]`), asm-review-contracts (`sonnet[1M]`), asm-review-reuse (`gpt-5.6-luna[1M]`), plus chair self-review and full-flow trace.
- **Agents skipped**: asm-review-data-security (no persistence, auth, input-validation, or third-party surface — the change is a pure presentation derivation inside the webview); asm-review-performance (no growth axis: `presentedActivity` is O(rows × degradedSources), `degradedSources` is bounded by the closed `PresenceDegradation["source"]` union and rows by the pre-existing `MAX_WORKTREES_PER_REPO` cap; the render signature already keyed `degradedSources` before this change, so nothing widened).

## Full-flow trace (discovery, mandatory)

`presenceProjector` → `WorktreePresence { rowsByWorktreeId, degradedSources }` → `WorktreeHost.withDelegations` / `decay` (reads its own `ACTIVITY_EVIDENCE` map) → RPC → `WorktreeView.setData` → `worktreeSignature` guard (keys `r.activity`, `r.activitySource`, and each degradation's `source`/`reason`/`since` — no stale-glyph path found) → three render surfaces:

| Surface | Derivation applied? |
|---|---|
| Worktree row glyph (`WorktreeView.ts:663`) | yes — `strongestActivity(rows, degradedSources())` |
| Expanded agent row dot (`WorktreeView.ts:704`) | yes — `presentedActivity(row, degradedSources())` |
| **Collapsed presence pill** (`WorktreeView.ts:688`) | **no** — `groupPresenceByActivity(rows)` takes no degradations → **B1** |
| **Remove/force-remove dialog** (`WorktreeRemoveDialog.ts:206`) | **no** — raw filter, `renderAgentRow` with no `activity` → **W1** |

Fallback/error path: `presence === undefined` → `degradedSources()` returns `[]`, and no agent rows exist to draw. Correct.

## Findings

### B1 — BLOCK · confidence HIGH · P1 · class feature
- **Agents**: chair, asm-review-logic, asm-review-contracts, asm-review-frontend, asm-review-reuse (5-way corroboration)
- **File**: `src/webview/worktree/WorktreeView.ts:688` (defect in `src/webview/worktree/worktreeFormat.ts:221`, drawn at `src/webview/worktree/worktreeTreeView.ts:243`)
- **Title**: The collapsed presence pill still presents `idle` from an absence of evidence
- **Evidence**: `renderPresencePill(groupPresenceByActivity(rows), …)` is called with raw `rows` and no degradation list. `groupPresenceByActivity` buckets on `r.activity` and iterates `ACTIVITY_STRENGTH` (`waiting|running|idle|exited` — no `unknown`); `renderPresencePill` then draws `stateShape(group.activity)` straight from that bucket. Line 663 on the *same* worktree row passes `this.degradedSources()`; line 688, twenty-five lines later, does not. Confirmed against the shipped fixture: `worktreeFixtures.ts:230-231` holds a row with `activity: "idle", activitySource: "none"` — a row that is `unknown` with **nothing degraded at all** — and the pill draws it as an `idle` dot.
- **Impact**: Directly violates the accepted ADDED requirement *"An activity no source could determine is not presented as idle"* — "the view SHALL present that row's activity as `unknown` rather than as `idle`. `idle` SHALL NOT be presented from an absence of evidence." It fails on the **default** surface: `WorktreeView.ts:435` collapses any first-seen worktree that is not in the workspace, so the pill is what most users see first. In one frame a collapsed row can draw an `unknown` leading glyph and, inches to its right, an `idle` pill dot for the very rows that produced the `unknown`. No new or existing test collapses a worktree with a degraded source and asserts on the pill — all five new `WorktreeView.test.ts` specs query `.wt-arow .wt-state` (expanded only) or the row glyph.
- **Suggested fix**: Widen `PresenceGroup.activity` to `PresentedActivity`, give `groupPresenceByActivity` a `degradedSources` parameter, group on `presentedActivity(r, degradedSources)` keyed off `PRESENTED_STRENGTH`, and pass `this.degradedSources()` at `WorktreeView.ts:688`. Add a collapsed-pill assertion for both the degraded-source case and the `activitySource: "none"` case.
- **Status**: accepted · **Triage**: accepted — verified. `groupPresenceByActivity` iterates `ACTIVITY_STRENGTH`, and `worktreeFixtures.ts:227-235` does carry an `activitySource: "none"` row that the pill draws as `idle`. The accepted ADDED requirement is written about the view's presentation, not about one renderer, so this is remediation of an incomplete thread rather than a contract change.

### W1 — WARN · confidence HIGH · P2 · class feature
- **Agents**: asm-review-logic, chair (verified independently)
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:206-215`
- **Title**: The force-remove dialog draws a live `running` dot for a row whose deciding source is down
- **Evidence**: `const busy = (deps.agentRows ?? []).filter((r) => r.activity === "running" || r.activity === "waiting")` reads the raw wire value, and `renderAgentRow(row, { now: deps.now }, …)` omits the new `activity` option, so `opts.activity ?? row.activity` (`worktreeTreeView.ts:358`) draws the raw state. The caller at `WorktreeView.ts:797` passes `agentRows: this.rowsFor(info.id)` while holding `this.degradedSources()` and simply not threading it.
- **Impact**: On the one screen where the claim gates a destructive action, the view asserts "An agent is mid-turn in this worktree" with a spinning `running` glyph for a row no live source can vouch for — the same unevidenced positive claim this change exists to remove, one surface over. Note the *listing* itself is defensibly fail-closed (warning about a possibly-running agent is the safe side of a folder deletion); the defect is the **glyph and the copy**, which state certainty the evidence does not support. The new `AgentRowOptions.activity` doc comment — "honest for a caller with no presence to consult" — does not describe this caller, which has presence and does not consult it.
- **Suggested fix**: Thread `degradedSources` into the dialog deps; derive with `presentedActivity` for the render so an unreadable row draws `unknown`, and soften the copy for that case. Keep the *filter* inclusive (fail-closed) even when the presented state is `unknown`.
- **Status**: accepted · **Triage**: accepted — verified at `WorktreeRemoveDialog.ts:206` and `WorktreeView.ts:797`. Fixing the glyph and the copy; the filter stays inclusive, since warning about a possibly-running agent is the safe side of a folder deletion.

### W2 — WARN · confidence HIGH · P2 · class feature
- **Agents**: chair (counterfactual probe), asm-review-logic, asm-review-frontend
- **File**: `src/webview/worktree/WorktreeView.test.ts` — the `"gives each of the five states a shape"` spec
- **Title**: The shape test does not guard the reduced-motion case its own comment names
- **Evidence**: The test's normalizer drops any declaration whose property matches `/color|background|opacity/`, which removes `border-top-color` and `border-right-color` — the entire arc that makes `running` a different outline from `idle`. What is left distinguishing them is the `animation` declaration, which is exactly what `@media (prefers-reduced-motion: reduce)` at `worktreePanel.css:264-267` sets to `none`; the regex uses `exec` on the base rule and never reads that media block. A chair scratch probe replayed the normalizer verbatim against the shipped stylesheet and against a counterfactual that reverts `.wt-state--running` to its **pre-change** tinted ring — the defect this change was written to fix:

  ```
  as shipped:   running -> animation…;border-radius: 50%;border: 1.5px solid C
                idle    -> border-radius: 50%;border: 1.5px solid C          distinct 5/5 → PASSES
  arc reverted: running -> animation…;border-radius: 50%;border: 1.5px solid C 28%, C)
                idle    -> border-radius: 50%;border: 1.5px solid C          distinct 5/5 → PASSES
  ```

  Secondary weakness in the same spec: `waiting` normalizes to `border-radius: 50%` alone, because its filled disc lives entirely in the dropped `background` declaration. Its distinctness in the test comes from a *missing* declaration, not from any modelled shape.
- **Impact**: The CSS itself is correct — the arc is a genuine outline difference that survives both reduced motion and a monochrome theme. The problem is the evidence: this test is the automated stand-in for parked manual task 1_3, and it would pass with the regression restored. `workflow.md` records the automated half as asserting "five states that stay distinct with every colour token collapsed"; that is true only of the test's own model, which keeps the animation it claims to remove.
- **Suggested fix**: Normalize a second time with `animation` also stripped and assert the set is still 5-distinct, and read the `prefers-reduced-motion` override so a future `animation: none` in the base rule cannot be smuggled past. Consider keeping `background` in the shape model (a filled disc *is* a shape) and collapsing only the colour value inside it.
- **Status**: accepted · **Triage**: accepted — the counterfactual is decisive: the normalizer strips the arc as a colour and leaves `animation` as the discriminator, which is exactly what reduced motion removes. The test would have passed on the code this task exists to change, so it is not evidence.

### W3 — WARN · confidence HIGH · P3 · class feature
- **Agents**: asm-review-frontend, asm-review-logic, chair
- **File**: `src/webview/worktree/worktreeTreeView.ts:388-396`
- **Title**: The fallback confidence marker contradicts the `unknown` glyph on the row beside it
- **Evidence**: The `~` marker and its tooltip are still keyed off the raw `row.activitySource`. A row with `activitySource: "none"` now draws an `unknown` dot labelled "activity unknown" and, on the same line, a marker reading *"Activity inferred from none — not a published agent state"*. An `output` row with `panes` degraded draws "activity unknown" beside *"Activity inferred from terminal output — the terminal is busy…"*, in the present tense, about a source that is down.
- **Impact**: The row says both "no source could say" and "here is what a source inferred". On the exact rows this change was written to make honest, the copy re-asserts the evidence the glyph just withdrew.
- **Suggested fix**: Key marker presence and wording off the presented activity — suppress it when the presented state is `unknown`, or replace it with a string tied to the degraded source ("Activity unavailable — `panes` is not responding").
- **Status**: accepted · **Triage**: accepted — verified at `worktreeTreeView.ts:388-396`. The marker asserting present-tense inference beside a glyph that just withdrew it is the same contradiction the change exists to remove.

### W4 — WARN · confidence HIGH · P2 · class feature
- **Agents**: asm-review-reuse, asm-review-logic, chair
- **File**: `src/webview/worktree/worktreeFormat.ts:139-151`
- **Title**: `decidingSource` reimplements the host's `ACTIVITY_EVIDENCE`, and unlike it is not exhaustiveness-checked
- **Evidence**: `src/providers/WorktreeHost.ts:527-534` already holds the identical mapping as `ACTIVITY_EVIDENCE`, declared `as const satisfies Record<WorktreeAgentRow["activitySource"], PresenceDegradation["source"] | undefined>` and used by `parentIsLive()` to decide whether a delegation roster decays. The new `decidingSource` is a `switch` with no `default` and a return type that includes `undefined`, so an added `WorktreeActivitySource` member falls through and implicitly returns `undefined` with **no compile error**. The two agree today, value for value.
- **Impact**: One mapping decides delegation decay in the host, the other decides the glyph in the view; they are required to agree and nothing enforces it. Adding a source member breaks the host at compile time and silently makes every such row render `unknown` in the view — divergence with no signal, on a mapping `docs/design/worktree-panel-ui.md` § 7.2 states once in prose and the code now implements twice. A shared home is genuinely reachable: `worktreeViewTypes.ts` already re-exports host-owned types from `src/worktree/presenceTypes.ts`, and webview code already imports runtime helpers out of `src/worktree/`.
- **Suggested fix**: Move the table into `src/worktree/presenceTypes.ts`, keep the host's `satisfies Record<…>` exhaustiveness check on it, and import it from both sides. Failing that, at minimum add a `default: { const _never: never = source; return undefined; }` guard to the switch.
- **Status**: accepted · **Triage**: accepted — verified: `WorktreeHost.ts:527-534` holds the identical table, exhaustiveness-checked with `satisfies`, and mine is not. Moving it to `src/worktree/presenceTypes.ts` and importing from both sides; `WorktreeCreateDialog.ts:16` already imports a value from `src/worktree/`, so the layering precedent exists.

### S1 — SUGGEST · confidence HIGH · P4 · class feature
- **Agents**: asm-review-logic, chair
- **File**: `src/webview/worktree/worktreeFormat.ts:192-195`
- **Title**: `strongestActivity`'s defaulted `degradedSources = []` has no production consumer
- **Evidence**: The only non-test caller is `WorktreeView.ts:663`, which passes the list. Every other reference is in `worktreeFormat.test.ts`.
- **Impact**: The default does not re-introduce the `idle`-from-absence claim (an `activitySource: "none"` row ranks `unknown` regardless), but it keeps a "rank without degradation" mode alive that nothing needs, and hands it silently to any future caller — the same shape of omission as B1 and W1.
- **Suggested fix**: Make the parameter required and update the tests.
- **Status**: accepted · **Triage**: accepted — trivial, and the default is what made B1 and W1 possible to write silently.

### S2 — SUGGEST · confidence MEDIUM · P5 · class feature
- **Agents**: chair
- **File**: `src/webview/worktree/worktreeTreeView.ts:70` and `:167-171`
- **Title**: Two label policies for one concept in one file — `activityLabel()` is exported but the worktree-row branch hand-rolls its own
- **Evidence**: `activityLabel()` is added and exported to centralise "what the glyph announces", and `renderAgentRow` uses it. `renderWorktreeRow` instead branches inline: `glyphActivity === "unknown" ? stateShape(glyphActivity, "An agent's activity is unknown") : stateShape(glyphActivity, \`An agent is ${glyphActivity}\`)`.
- **Impact**: A sixth vocabulary member — `running (unconfirmed)`, which § 7.2 explicitly reserves for WT-008.2 — has to be handled in two places, and the inline branch is the one with no named home.
- **Suggested fix**: Fold the worktree-row phrasing into a sibling of `activityLabel` (e.g. `worktreeGlyphLabel(activity)`) so the next vocabulary member has exactly one place to land.
- **Status**: accepted · **Triage**: accepted — trivial, and WT-008.2 adds a sixth member to exactly this vocabulary.

## Phase 2.5 — inline support review

- **Tests**: every changed behaviour has a corresponding test except the two surfaces in B1 and W1, which is precisely how both survived. No `.only` / `.skip`. No un-awaited async. New tests reuse `worktreeFixtures.ts:agentRow()` rather than duplicating a helper. `worktreeFormat.test.ts` correctly covers the `vault` source (degraded but decides no row) and the "some other source degraded" case — good negative coverage. W2 records the one test whose strength is below its stated claim.
- **`src/test/invariants/coverage.test.ts`**: the widening of `blueprintTaskIds()` to union `docs/PLAN.md` + `PLAN.v<n>.md` does **not** weaken the gate. A filename failing the regex is excluded, which shrinks the accepted owner set and makes the gate stricter, not fail-open. `expect(plans, "no blueprint plan found under docs/").not.toEqual([])` fires correctly on an empty result — assertion direction verified, not inverted. The § 8.4 rule holds in both directions: `documentedInvariants()` parses the doc and the registry is asserted equal to it by id list *and* verbatim statement, so documented-but-absent and present-but-undocumented each fail.
- **Fixtures**: no PII or secrets. Shapes match `worktreeViewTypes.ts`.

## Notes carried, not filed as findings

Per the chair rules, unchanged code outside the diff is not flagged. Recorded here as context for a later change, since it is the same invariant this change establishes:

- `src/webview/worktree/worktreeTreeView.ts:531` renders a delegation subagent's outcome as `outcome.textContent = failed ? "✕" : sub.status === "running" ? "…" : "✓"`. `DelegationRoster` rows carry `status: "running" | "completed" | "failed" | "unknown"` (`src/worktree/presenceTypes.ts:32`), and `WorktreeHost.decay()` deliberately *sets* `unknown` when a parent's source is degraded. A child decayed to `unknown` therefore draws a completed checkmark — a positive claim from withdrawn evidence, on a surface the host explicitly marks unreadable. Same defect class as B1, adjacent surface, pre-existing.

## Manual verify

Task 1_3 (`manual`: rendered view at sidebar width, reduced motion on, monochrome/high-contrast theme) could not be run in this environment. It is **parked, not skipped**, and it remains the only thing that can settle two open questions: whether a 1.5px dashed border on a 9px circle reads as a distinct outline rather than as a fuzzy solid ring, and whether the `running` arc reads apart from the `idle` ring at sidebar size with the spin stopped. W2 shows the automated test cannot substitute for it.
