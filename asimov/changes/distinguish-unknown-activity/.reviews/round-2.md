# Review round 2 — distinguish-unknown-activity

- **Date**: 2026-08-29
- **Cycle**: 1
- **Mode**: verification
- **Head**: `3ee55fae8c63c72ea41bd3f6ffaf943758669b1e`
- **Scope**: `bd0635a5..HEAD` — one commit, `3ee55fae`, the single remediation for all seven accepted round-1 findings. Working tree dirty only OUTSIDE the reviewed set (`asimov/changes/distinguish-unknown-activity/analytics.json`, `.analytics-cursor.json`, `asimov/changes/active`, `docs/ui/worktree.html` (docs → skipped), `skills-lock.json`, untracked `asimov/.analytics-open/`); the range was reviewed at the recorded Head, not the tree.
- **Reviewable lines**: 84 added (non-test: `worktreeTreeView.ts` 19, `presenceTypes.ts` 19, `worktreeFormat.ts` 18, `WorktreeRemoveDialog.ts` 17, `WorktreeView.ts` 10, `WorktreeHost.ts` 1). Tests reviewed inline at Phase 2.5 (104 added lines across `WorktreeView.test.ts`, `worktreeFormat.test.ts`).
- **Verdict**: **WARN**
- **Counts**: 0 BLOCK · 1 WARN · 6 SUGGEST (all new, all inside the fix's impact cone) · 7 round-1 findings fixed
- **Agents spawned**: 4 — asm-review-logic (`opus[1M]`), asm-review-frontend (`gpt-5.6-terra[1M]`), asm-review-contracts (`sonnet[1M]`), asm-review-reuse (`gpt-5.6-luna[1M]`), plus chair self-review and an independent counterfactual probe for W2.
- **Agents skipped**: asm-review-data-security, asm-review-performance — the cone is unchanged from round 1 (pure presentation derivation inside the webview; no persistence, auth, input validation, or growth axis).

## Scope lock

Passed. The diff since round 1 is one remediation commit plus asimov metadata. `tasks.md` gained a `## 2. Review round 1` section with task `2_1`, whose `Refs` point at the two spec anchors the change already owned and whose Plan enumerates the six accepted fixes. No new capability, no semantically changed contract or design, no new invariant owner. The cycle continues; this is round 2 of a maximum of 3.

## Verification of round-1 findings

All seven verified **fixed** at the invariant level, not at the quoted line.

| ID | Status | Verification |
|---|---|---|
| **B1** | fixed | `groupPresenceByActivity(rows, degradedSources)` buckets on `presentedActivity` over `PRESENTED_STRENGTH`; `PresenceGroup.activity` is `PresentedActivity`; `WorktreeView.ts:689` supplies `this.degradedSources()`. Grouping is total over the five presented states, empty buckets are still skipped, and `overflow = inGroup.length - agents.length` is unaffected by which strength list produced the bucket, so unproven-identity rows still count without contributing an icon. New spec at `WorktreeView.test.ts:387` asserts one `unknown` dot and no idle/running dot for a degraded-source row plus an `activitySource: "none"` row. The assistive-technology path is covered separately: the worktree row's own dot carries `aria-label` from `worktreeActivityLabel(strongestActivity(...))`. **Surface sweep**: no render surface remains that draws a positive state from an unqualified `row.activity` — the four surfaces round 1 enumerated all derive, and `worktreeRenderSignature.ts:112` hashes `degradedSources`, so a degradation arriving with no row change still invalidates the repaint guard (`worktreeRenderSignature.test.ts:67` asserts exactly this). |
| **W1** | fixed | `WorktreeRemoveDialogDeps.degradedSources` added; `busy` and `degraded` hoisted above the copy branch; each listed row renders with `activity: presentedActivity(row, degraded)`; the filter still reads the wire value, fail-closed as triaged. **Entry modes checked**: `WorktreeView.openRemoveDialog` has exactly one production caller, `WorktreeView.ts:795-806`, and the "reopens the confirmation from a blocked action result" path (`WorktreeView.test.ts:1217`) routes through that same `renderNotice` action — it uses `confirmableBlocker`, so `refused === false` and it never reaches the refusal branch at all. Confirmable paths are unaffected: nothing in the `refused === false` arm reads activity. The fix does introduce **N1** below. |
| **W2** | fixed (primary claim) | Re-run independently rather than taken on trust. A scratch probe replayed the *new* normalizer verbatim against the shipped stylesheet and three counterfactuals: shipped → 5/5 distinct on both passes; **pre-change tinted ring** (`border: 1.5px solid color-mix(… 28%, transparent)`) → 5/5 on pass 1 but **4/5 on the motion-dropped pass**, `running` collapsing onto `idle` as `border:1.5px solid C;border-radius:50%`; a plain `border: 1.5px solid var(--vscode-charts-blue)` ring → also 4/5. The guard now fails on the code this task exists to change. The nested-paren ordering claim is confirmed: `var()` must flatten before `color-mix()`, since `[^)]*` in the mix pattern otherwise stops at the inner `var()`'s paren. Residual sub-claim filed as **N8**. |
| **W3** | fixed | The `~` marker is keyed off the presented `activity` at `worktreeTreeView.ts:389`; the `unknown` arm names the failure instead of the inference and the old `isFallbackActivity` arm is now unreachable for an unknown row. Residual copy-token point filed as **N7**. |
| **W4** | fixed | `ACTIVITY_EVIDENCE` is a module-level export in `src/worktree/presenceTypes.ts` with the same five keys, same values, and the same `as const satisfies Record<WorktreeAgentRow["activitySource"], PresenceDegradation["source"] \| undefined>`, so a new source member is still a compile error rather than a silent `undefined`. `WorktreeHost.parentIsLive` (`WorktreeHost.ts:522-529`) reads it identically — `evidence !== undefined && !degraded.has(evidence)` — so **delegation decay is behaviourally identical**. The explicit `: PresenceDegradation["source"] \| undefined` annotation on `deciding` in `worktreeFormat.ts` widens only the local's declared type; the assignability check already happened at the `satisfies`. **Layering verified**: `presenceTypes.ts`'s only import is `import type { VaultAgentId } from "../vault/types"`, erased at compile, and `src/vault/types.ts` itself imports nothing — the webview bundle gains no runtime dependency and no cycle. The claimed precedent is genuine and the same shape: `branchSlug.ts` was split out of `createPath.ts` precisely because the latter imports `node:path`, which the webview's `platform: "browser"` esbuild config (`esbuild.js:94`) cannot resolve. Nothing mechanically enforces the boundary in either case — discipline-only, pre-existing. |
| **S1** | fixed | `strongestActivity`'s `degradedSources` is required; the two test call sites pass `[]`. See **N2** for the two remaining defaults of the same class. |
| **S2** | fixed | `worktreeActivityLabel()` exported at `worktreeTreeView.ts:75` and used at the one former inline site (`:172`). |

## Findings

### N1 — WARN · confidence HIGH · P2 · class feature
- **Agents**: asm-review-logic, asm-review-frontend, chair (three-way, reached independently)
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:205`
- **Title**: The hedged refusal copy contradicts a confirmed row listed directly beneath it
- **Evidence**: `const anyUnreadable = busy.some((r) => presentedActivity(r, degraded) === "unknown")`. Take two rows in one refusal list — `{activity: "running", activitySource: "hook"}` and `{activity: "running", activitySource: "none"}` — with `degradedSources: [{source: "panes", …}]`. Both pass the wire-value filter at `:172`. The first presents as `running` (its deciding source `hook` is live) and is drawn at `:223` with a live `wt-state--running` dot; the second presents as `unknown`. `some` is therefore true and the lead reads *"An agent may be mid-turn in this worktree, and nothing can currently confirm it."* — inches above a running dot that does confirm it.
- **Impact**: The same glyph-versus-copy divergence W1 was accepted to remove, inverted: the copy now under-claims where the view still asserts. It weakens the one instruction the dialog exists to give ("Stop it first — there is no confirmation that removes a folder out from under a working agent") on a destructive-action screen, and it is reachable on any mixed list — the common case once a single source degrades in a worktree holding several agents. It errs toward caution rather than toward an unevidenced positive, which is why this is WARN and not BLOCK.
- **Suggested fix**: Partition rather than `some`. `const confirmed = busy.filter((r) => presentedActivity(r, degraded) !== "unknown")`; all-unknown → the current sentence; `confirmed.length > 0 && confirmed.length < busy.length` → a mixed sentence ("An agent is mid-turn in this worktree, and another can't currently be read."); else the plain sentence. Add the missing negative assertion while you are there: `WorktreeView.test.ts:1194` opens the refusal with a readable row but asserts only that `.wt-refusebox` exists — nothing pins the certainty branch's string, so a regression flipping `anyUnreadable` permanently true would pass the suite.
- **Status**: accepted · **Triage**: verified — `busy.some(...)` does hedge a whole list on one unreadable row. Partitioning the list and pinning the certainty branch's string in a test; N3 is folded in, since the empty-list case is the same predicate.

### N2 — SUGGEST · confidence HIGH · P4 · class feature
- **Agents**: asm-review-logic, chair (asm-review-contracts examined the same asymmetry and rated it a watch item, not a finding)
- **File**: `src/webview/worktree/worktreeTreeView.ts:359` and `src/webview/worktree/WorktreeRemoveDialog.ts:169`
- **Title**: Two silent defaults of exactly the class S1 was accepted to remove
- **Evidence**: `const activity = opts.activity ?? row.activity;` with `AgentRowOptions.activity` optional, and `const degraded = deps.degradedSources ?? [];` with `WorktreeRemoveDialogDeps.degradedSources` optional. S1 was accepted precisely because `strongestActivity(rows, degradedSources = [])` let a caller silently reconstruct the pre-fix behaviour with no compile error. Both remaining defaults do the same — the first for the dot, the `aria-label` and the `~` marker, the second for the whole dialog.
- **Impact**: No live defect. All three current `renderAgentRow` callers and the one production `openWorktreeRemoveDialog` caller pass the argument (`WorktreeView.ts:706`, `WorktreeRemoveDialog.ts:223`, `WorktreeView.ts:800-805`). The next caller regresses B1/W1/W3 silently instead of failing to compile.
- **Counterpoint recorded**: `WorktreeRemoveDialogDeps` already carries other optional fields with the same `?? fallback` convention (`agentRows?`), and the accepted task plan scopes the dialog fix to "keep the filter inclusive" without requiring the dep. That is why this sits at SUGGEST rather than WARN.
- **Suggested fix**: Make `AgentRowOptions.activity` and `WorktreeRemoveDialogDeps.degradedSources` required, mirroring what S1 did to `strongestActivity`; the four call sites already supply both.
- **Status**: accepted · **Triage**: verified — both defaults exist and every caller passes the argument, so making them required costs nothing and closes the class S1 named.

### N3 — SUGGEST · confidence MEDIUM · P5 · class feature
- **Agents**: asm-review-logic, chair
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:172`
- **Title**: The refusal can assert a mid-turn agent and list none — and that is the branch with the confident copy
- **Evidence**: The `else` branch is reached whenever `blocker.busyAgents > 0` (`isRemoveRefused`, `:39`), but `busy` derives from `deps.agentRows`, a *different* snapshot read at click time from `WorktreeView.rowsFor(info.id)` on a notice that can sit on screen indefinitely. If the agent finished in between — or presence has not yet arrived — `busy` is empty: the lead still says "An agent is mid-turn in this worktree. Stop it first", no row is listed, and no "Show the agent" affordance is offered. The new `anyUnreadable` inherits this, since `[].some(...)` is `false` — so the case with the least evidence gets the most confident sentence.
- **Impact**: An unactionable refusal naming an agent the user cannot see. The filter itself is unchanged by this commit, but it is now the fallback branch of the new derivation, which is why it is in the cone.
- **Suggested fix**: When `busy.length === 0` in that branch, source a count-only sentence from `blocker.busyAgents` ("An agent was mid-turn when this was checked; it is no longer listed. Retry the removal.") rather than the present-tense claim.
- **Status**: accepted · **Triage**: verified — folded into the N1 fix: `[].some()` is false, so the least-evidenced case gets the most confident sentence.

### N4 — SUGGEST · confidence HIGH · P4 · class feature
- **Agents**: asm-review-frontend, chair (verified independently)
- **File**: `src/webview/worktree/worktreeTreeView.ts:244` (with `:161-162` and `WorktreeView.ts:663-666`)
- **Title**: A collapsed `unknown` group that is not the strongest state never reaches assistive technology
- **Evidence**: `renderPresencePill` draws `stateShape(group.activity)` with no label, inside a button carrying `aria-hidden="true"` and `tabIndex -1` (`:236`). What AT gets for a collapsed worktree is the row's `aria-label`, `` `${branchLabel(info).text}, ${opts.agentSummary}` ``, where `agentSummary` is `agentCountLabel(rows.length)` — a bare count ("3 agents") — plus the row dot's own label from `worktreeActivityLabel(strongestActivity(...))`. A `waiting` or `running` row outranks `unknown` in `PRESENTED_STRENGTH`, so with a mixed set the screen-reader user hears only the positive active-state claim and never learns another row's activity could not be read.
- **Impact**: The asymmetry between the visual and accessible channels is pre-existing, but B1's fix put a new, evidentially-significant state into the visual-only channel — the pill is precisely where a collapsed worktree now advertises `unknown`, and the collapsed state is the default for any first-seen worktree not in the workspace (`WorktreeView.ts:435`).
- **Suggested fix**: Fold the group summary into the worktree row's accessible name or description — e.g. extend `agentSummary` to "3 agents, 1 activity unknown" — while leaving the pill `aria-hidden` so the tree structure is unchanged.
- **Status**: audit-backlog · **Triage**: valid and non-gating. The pill is `aria-hidden` by design and its states are announced through the row's own glyph and summary; giving the collapsed groups a voice is a change to what the summary claims, which WT-010's rail composition already reopens. Recorded rather than fixed here — it is not a defect this change introduced.

### N5 — SUGGEST · confidence HIGH · P5 · class machinery
- **Agents**: asm-review-reuse
- **File**: `src/webview/worktree/worktreeFormat.ts:155` and `src/providers/WorktreeHost.ts:527-529`
- **Title**: The "is this row's evidence degraded" membership test is implemented twice
- **Evidence**: The view scans an array — `degradedSources.some((d) => d.source === deciding)`; the host tests a set — `!degraded.has(evidence)`. Both now read the same `ACTIVITY_EVIDENCE`, so the *table* can no longer diverge, but the predicate built on it still can.
- **Impact**: Low. The predicate is one line on each side and the shapes genuinely differ (wire records versus a prebuilt `ReadonlySet`). W4's accepted resolution was the table, not the predicate.
- **Suggested fix**: If it is worth doing at all, an `isActivityEvidenceDegraded(row, degraded)` in the presence layer adapting both shapes at that seam.
- **Status**: audit-backlog · **Triage**: valid. The table is shared, which is what W4 asked for; extracting the predicate as well is a second refactor across the host/view boundary with no behavioural difference, and it belongs with WT-008.2, which adds a third reader.

### N6 — SUGGEST · confidence HIGH · P5 · class machinery
- **Agents**: asm-review-reuse
- **File**: `src/webview/worktree/WorktreeRemoveDialog.ts:172`, `src/worktree/worktreeBlockers.ts:151-153`, `src/providers/WorktreeHost.ts:522-525`
- **Title**: `activity === "running" || activity === "waiting"` is spelled out at three sites
- **Evidence**: The dialog's busy filter, the removal blocker's busy-agent count, and `parentIsLive`'s opening guard all hand-roll the same "is this an active state" test.
- **Impact**: If the set of states considered active changes, the removal dialog's row list, the host's removal blockers, and delegation-parent liveness can disagree. Pre-existing at all three sites — the dialog's line is only *relocated* by this commit — which is why it is a SUGGEST and not a WARN.
- **Suggested fix**: Export an `isActiveActivity(activity)` predicate from the presence layer and use it at all three.
- **Status**: audit-backlog · **Triage**: valid and explicitly pre-existing — three sites this change relocated but did not create. A shared `isBusy` predicate touches `worktreeBlockers.ts`, which this change has no other reason to open.

### N7 — SUGGEST · confidence MEDIUM · P5 · class feature
- **Agents**: chair
- **File**: `src/webview/worktree/worktreeTreeView.ts:396`
- **Title**: The new `unknown` tooltip names the row's source where the stale affordance names the failing one
- **Evidence**: The marker reads `` `Activity came from ${row.activitySource}, which is not currently reporting` `` — so an `output` or `title` row says "output … is not currently reporting", while the thing that is actually down, and what the stale affordance names verbatim with its `reason`, is `panes`. W3's accepted suggested fix named the degraded source ("Activity unavailable — `panes` is not responding").
- **Impact**: Two different tokens for one failure on two surfaces of the same panel. Not false — the output-derived evidence genuinely is not arriving — and arguably more legible to a user than the internal `panes` token, which is why this is MEDIUM and P5 rather than a defect.
- **Suggested fix**: Either name the degradation source (`ACTIVITY_EVIDENCE[row.activitySource]`) and reuse its `reason`, or record in § 7.2 that the marker deliberately speaks in row-source terms.
- **Status**: accepted · **Triage**: verified — the tooltip should name the source that failed, which is what the stale affordance names, not the row's own source label. Trivial.

### N8 — SUGGEST · confidence HIGH · P4 · class feature
- **Agents**: chair (counterfactual probe), asm-review-frontend
- **File**: `src/webview/worktree/WorktreeView.test.ts` — the `"gives each of the five states a shape that survives losing colour AND motion"` spec
- **Title**: `waiting` is still distinguished only by an absent declaration, so deleting its fill passes the guard
- **Evidence**: W2's primary claim is fixed and re-verified (see the table above); this is the residual sub-claim round 1 recorded as a "secondary weakness", reachable through a **different mechanism** — the dropped `background` property rather than the stripped `animation` — and so filed as its own finding rather than appended to W2. `.wt-state--waiting`'s filled disc lives entirely in `background: var(--vscode-charts-yellow)`, which the normalizer drops (prop matches `/background/`, value flattens to `C`, not `NONE`), leaving the shape modelled as `border-radius:50%` alone. A fourth counterfactual replacing `.wt-state--waiting` with `{ border-radius: 50% }` — an invisible dot — still scores **5/5 distinct on both passes**. The pulse ring at `.wt-state--waiting::after` never participates: `declsOf`'s `\.wt-state--waiting\s*\{` cannot match a pseudo-element selector, in the base sheet or in the reduced-motion block.
- **Impact**: Bounded. Unlike the W2 defect, this one does not let the *specific* regression this change targets through — it is a gap for a hypothetical future regression that removes `waiting`'s fill. It matters because this spec is the automated stand-in for parked manual task 1_3, and a filled disc is a shape, not a colour.
- **Suggested fix**: Keep `background` in the shape model and collapse only the colour value inside it (so `background:C` is a shape and its absence is a different shape), or model `::after` as part of the `waiting` rule.
- **Status**: accepted · **Triage**: verified — the counterfactual is decisive: replacing `.wt-state--waiting` with a bare `border-radius` still scores 5/5 because its fill lives in the dropped `background` and its halo in a `::after` the regex never reads. Same class of defect as W2, so it is fixed rather than carried.

## Adjudicated and dropped

- **asm-review-reuse, `docs/design/worktree-panel-ui.md:412`** — "the activity-source mapping is restated in the design doc". Dropped. `docs/**` is `skipped` at Phase 0, and more importantly W4's accepted resolution was explicitly *one prose statement in § 7.2, one code implementation*: the doc stating the mapping is the doc doing its job as the spec anchor, not a third copy. Verified the doc's table and `PRESENTED_STRENGTH` ordering both still match the code exactly.

## Phase 2.5 — inline support review

- **Tests**: both surfaces round 1 found unguarded now have a spec — `WorktreeView.test.ts:387` (pill) and `:1194` (dialog). No `.only` / `.skip`, no un-awaited async, and the new specs reuse the existing `agentRow()` fixture rather than re-rolling one. The `agentRow` default (`activitySource: "hook"`, no degradations) means every pre-existing dialog and pill spec still exercises the *readable* path unchanged, so the new derivation did not silently flip any existing assertion.
- **Coverage gap**: no assertion pins the certainty branch of the dialog lead ("An agent is mid-turn in this worktree."). Folded into N1's suggested fix rather than filed separately.
- **The rewritten CSS shape spec**: verified as evidence, not taken on trust — see W2 above and N8 for what it still does not model. One structural note in its favour: the `@media (prefers-reduced-motion: reduce)` regex terminates on `\n}` at column 0, so it correctly captures the whole first block including its indented inner rules, and correctly stops before the second reduced-motion block at `worktreePanel.css:677`.
- **Fixtures**: unchanged by this commit. No PII or secrets.

## Verify gate

Cited, not re-run (chair rules). `bun run asm change verify-status distinguish-unknown-activity` records `2_1 [x] exit 0 scope-unchanged`, with the suite delta noted as "+6 assertions … rewrote the shape guard so it fails on the pre-change tinted ring (verified by counterfactual) and added pill + remove-dialog cases. No existing assertion weakened". Author-reported gate on the fix commit: check-types pass, `pnpm run test:unit` 235 files / 4747 tests pass, I10 gate pass, biome at the pre-change baseline (3 errors / 14 warnings, all in untouched files). `1_3` shows `no record` — the parked manual verify.

## Audit backlog (non-gating)

- **Carried forward from round 1, unchanged**: `src/webview/worktree/worktreeTreeView.ts:531` renders a delegation subagent whose `status` is `"unknown"` as a completed checkmark (`failed ? "✕" : sub.status === "running" ? "…" : "✓"`), while `WorktreeHost.decay()` deliberately *sets* `unknown` when the parent's source is degraded. Same defect class as B1, adjacent surface, pre-existing, outside this change's accepted scope.
- **New, unchanged code, not filed as a finding**: `worktreeFormat.ts:46` `ageTimestamp` reads the raw `row.activity` to choose which clock the age column reads, so a wire-`running` row presented as `unknown` still ages from `stateStartedAt`. Reached independently by the chair and asm-review-logic, and both concluded it is not a leak of the invariant — the age column presents a duration, not a state, and § 3.3 defines the clock by activity. Recorded because a future change to what the age column *claims* would make it one.

## Manual verify

Task 1_3 remains **parked, not skipped**: the rendered view at sidebar width, with reduced motion on and a monochrome or high-contrast theme, cannot be exercised here. It is still the only thing that settles whether a 1.5px dashed border on a 9px circle reads as a distinct outline rather than a fuzzy solid ring, and whether the `running` arc reads apart from the `idle` ring at sidebar size with the spin stopped. W2's fix strengthens the automated stand-in materially — it now fails on the exact regression it exists to catch — but N8 shows it still does not substitute for the manual pass.
