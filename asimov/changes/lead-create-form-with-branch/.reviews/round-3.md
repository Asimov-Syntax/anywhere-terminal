# Review round 3 — lead-create-form-with-branch

- Date: 2026-08-29
- Cycle: 1
- Mode: verification (**this cycle's last round — max 3**)
- Head reviewed: `1e9c8ad555e63fc5bdf8b6515356857c24289227` (tree clean for `src/`; dirty only in `asimov/changes/active`, `.analytics-cursor.json`, `analytics.json` — metadata, not reviewed)
- Previous Head: `14cb12caf1ab35ff26ca1056e5842fc7fbad1319`
- Diff scope: `git diff 14cb12ca..1e9c8ad5` — one commit, task 1_5
- Reviewable lines: 20 added/modified in `src/webview/worktree/WorktreeCreateDialog.ts`; 123 test lines reviewed inline
- Verdict: **WARN**
- Counts: 0 BLOCK · 1 WARN · 4 SUGGEST
- Scope lock: **passed** — task 1_5 is remediation of the three accepted round-2 findings. No new capability, no new invariant owner, no semantically new contract. `tasks.md` gained the 1_5 remediation entry; `asimov/changes/active`, analytics and build-state are metadata.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | R1/R2 fixes + impact cone | state machine, races, regressions | `opus[1M]` |
| asm-review-contracts | changed suite + base spec | mutation / test-strength, spec conformance | `gpt-5.6-terra[1M]` |
| asm-review-frontend | R2/R3 fixes | caret/focus, tooltip show path, a11y | `gpt-5.6-terra[1M]` (respawn — the first attempt on `sonnet[1M]` died on an API error before reporting) |
| chair | full fix diff | all lenses + full-flow trace | `opus[1M]` |

Three independent passes (chair, logic, frontend) reached the one surviving finding separately; `asm-review-logic` reproduced it end to end with a scratch probe.

Verify gate evidence is the build's own (`.build/verified.ndjson`, task `1_5`: `pnpm run check-types && pnpm run test:unit` exit 0, tree `28f4e9c2`; author reports 4852 pass / 0 fail across 235 files, `gate:fs-deletion` ok, biome 16 findings vs a 17-finding baseline at `767094c0`). No verify command was run by this review.

---

## Prior findings — verification status

| ID | Round | Severity | Status |
|---|---|---|---|
| B1 | 1 | BLOCK | fixed (round 2) |
| W1 | 1 | WARN P1 | fixed (round 2 production, round 3 test) |
| W2 | 1 | WARN P1 | fixed (round 2) |
| W3 | 1 | WARN P2 | superseded by R2 |
| W4 | 1 | WARN P2 | carried as R6 |
| W5 | 1 | WARN P2 | fixed (round 2) |
| W6 | 1 | WARN P3 | **withdrawn** (chair, round 2) — correctly not reinstated |
| R1 | 2 | BLOCK | **FIXED** |
| R2 | 2 | WARN P2 | **PERSISTS** — boundary inventory expanded, see below |
| R3 | 2 | WARN P3 | **FIXED** |
| R4 | 2 | SUGGEST | open, not taken |
| R5 | 2 | SUGGEST | open, assessed **not live** |
| R6 | 2 | SUGGEST | open, not taken |

### [R1] — FIXED, verified at the invariant level

The invariant is *"the dialog submits the agent offer it was opened against"* (`asimov/specs/worktree-panel/spec.md:269-279`). Boundaries searched: every writer of the `repos` record, every caller of `agentBox.setAgents`, every reader of `currentRepo().agents`, and the host-side offer check.

- **Writers of `repos`.** Two: `repos[at] = opened === undefined ? next : { ...next, agents: opened.agents }` and `repos.push(next)`. The splice preserves the opening `agents` and takes the destination fields (`resolvedPath`, `collidedWith`, `pathParent`, `pathPrefix`) from the answer, which is what was asked for. Because the preserved value is re-read from the already-spliced record on each subsequent answer, `agents` stays pinned to the opening list across arbitrarily many answers, not just the first.
- **Callers of `setAgents`.** After the revert: construction (`:319`) and the repo `<select>` `change` handler (`:240`) only. The answer path calls neither. The `change` handler reads the spliced record, so a switch away and back restores the opening list — pinned by `[R1] a repo switch restores the agents that repo was opened with`.
- **Readers of `currentRepo().agents`.** `:293` and `:319` are construction-only; `:383` (`rebuildAfterOptions`) is now reachable only from the repo switch; `:431` (`syncDerived`) reads destination fields, which the splice deliberately refreshes. The author's manifest is confirmed on every row.
- **Host side.** `frozenCreateOffer` is stamped at dialog open (`WorktreeController.ts:653`) and quoted at submit (`:371`); `WorktreeHost.ts:760` refuses on `offerId !== offer.offerId`. Fail-closed, unchanged.
- **Entry modes.** Single-repo (no `<select>` built, so `setAgents` is construction-only); multi-repo; stale answer discarded by the guard at `:566`; `repos[at] === undefined` (dead under `at >= 0` — harmless index-access appeasement). The `repos.push(next)` branch does take the answer's live agents, and `asm-review-logic` proved that branch reachable (see the audit backlog) — but those agents reach neither the box nor `rebuildAfterOptions`, because the repo `<select>`'s options are fixed at construction and `:240`/`:293`/`:319`/`:383` are all unreachable for a pushed repoId. So it is not an R1 hole.
- **Type safety of the splice.** `agents` is a required field on `WorktreeCreateDefaults` (`worktreeViewTypes.ts:118`), so `{ ...next, agents: opened.agents }` cannot degrade to `undefined` and crash the `.agents.length` gate.

**Does the revert reintroduce W6?** No — the chair agrees with the author, plainly, and `asm-review-logic` refuted the possibility with a probe. W6's defect required `currentRepo().agents` to turn all-dangerous under a box holding a stale posture. The gate at `:523-525` reads `agentBox.needsPosture()`, which reads the box's own `offered` / `permissionChoiceId` (`worktreeAgentBox.ts:196`) and **never** `repos`. `offered` changes only via `setAgents`, whose sole surviving caller passes the spliced — that is, opening — list. Even on the reachable `repos.push` branch, where live agents do enter `currentRepo()`, the probe confirms the agent `<select>` options are unchanged and no posture reset occurs. So no offer can turn all-dangerous under the dialog, and Create cannot be enabled on a posture nobody chose. The residual concern W6 gestured at — the panel's real offer changing while the dialog is open — is now handled where the spec says it should be: the submission is refused at the host on the frozen offer id, rather than silently relabelled in the form.

### [R2] — PERSISTS. See the finding below. The gesture round 2 named is fixed; a second boundary of the same invariant is not.

### [R3] — FIXED

`[R3] the tooltip shows the exact path, not the shortened one` drives the real show path. Verified independently by chair and `asm-review-frontend`: a directly dispatched non-bubbling `mouseenter` reaches the listener `attachTooltip` installs on `.wt-dest` itself; `scheduleShow` arms the 300 ms timer, which `vi.advanceTimersByTime(400)` fires; `show()` does not bail in jsdom (zero rects and zero viewport values are tolerated, and `doc.body.contains(target)` holds); the assertion reads the widget's own `textContent`. The author's mutation (`getText: () => destShort.textContent`) turns it red, and so does `getText: () => ""`. The round-1 W1 lifecycle (`ensureDestTip` / `releaseDestTip` on every exit path) is undisturbed.

---

## Findings

### [R2] Clearing the override still refills the field under the caret — the write site was never guarded, only one of its callers

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-logic and asm-review-frontend (independently), corroborated by chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:449-453` (the write), reached from `:584` (the answer callback)
- Status: **open — persists from round 2** · Triage: pending

**Evidence.** `keepPathInput` is passed by exactly one of `syncDerived`'s nine call sites — the `#wt-path` `input` listener at `:549`. The write itself is unconditional for every other caller:

```ts
if (pathIsDerived) {
  draft.path = derived;
  if (opts.keepPathInput !== true) {
    pathInput.value = derived;
  }
}
```

After a clear, `pathIsDerived` is `true` — that is the whole point of the withdrawal — so any later `syncDerived()` without the flag rewrites the field. The `bindDefaults` answer callback (`:584`) is one such caller, and it is the one that can fire while the user has `#wt-path` focused, because it is asynchronous:

1. User types a branch character. `nameInput`'s `input` → `syncDerived()` → `askForDestination()` posts `requestWorktreeCreateDefaults`; `outstanding = true`.
2. With Advanced open, the user clicks into `#wt-path` and select-all-Deletes. `pathIsDerived = true`, field stays empty (the fix working).
3. The in-flight answer lands. `syncDerived()` runs with no flag and assigns `pathInput.value = derived` into the focused input; per the HTML value setter the caret jumps to the end.
4. The next characters append. `pathIsDerived` flips false and `derived + typed` is what `submit()` carries.

`asm-review-logic` reproduced this end to end in a jsdom scratch probe against the current file (created and deleted in one command):

```
a (field after 1st answer)                   = "/trees/x"
b (field after user clears it, focused)      = ""
c (field after the in-flight answer lands)   = "/trees/xy"   focused = true
submitted path                               = "/trees/xymine"   // user typed only "mine"
```

`/trees/xymine` is the exact round-2 R2 signature — `derived + typed` — reproduced through `bindDefaults` rather than through the `input` handler that was fixed.

**Reachability, stated precisely.** `asm-review-frontend` searched every sender of `worktreeCreateDefaults` and found exactly one (`src/providers/WorktreeHost.ts:927-967`), reachable only while handling a `requestWorktreeCreateDefaults`; tree refreshes do not push it, and the branchless open-time answer is routed to `openCreateDialog` rather than into an open form. So this is a race bounded by the host round trip, not an unsolicited push — the author's own dialog is what opened the window by typing. It widens whenever the host is slow (`suggestFreePath` calls `options.exists`, a filesystem stat).

**Invariant bookkeeping.** This is the same invariant as round-2 R2 — *the destination override field is never rewritten under a user who is editing it* — violated through the same causal mechanism (`pathInput.value = derived` executing while `pathIsDerived` is true and the field is focused). Per the invariant-findings rule it appends to R2 rather than opening a new ID. Boundaries: **searched** — the path input's own event, the branch-name and base-ref `input`/`change` listeners, the branch-mode buttons, the repo `<select>` handler, `syncOpenAfter`, the agent box's `onChange`, and the `bindDefaults` answer callback. **Verified safe** — all of the user-driven ones, because reaching them moves focus out of `#wt-path`, so their refill is a rendered state change on an unfocused field. **Affected** — the answer callback alone.

**Severity held at round 2's WARN P2.** The chair's initial reading downgraded the priority on likelihood; two specialists probing independently — one with a working end-to-end reproduction — put it back. Reachability did narrow (from *every* clear-then-type gesture to a race window bounded by the host round trip), but "any user who clears the path shortly after touching the branch name is inside it", and the impact is unchanged: a silently submittable wrong destination. What still holds it below BLOCK is the same mitigation as round 2 — the destination line states the concatenated value, so the form never lies about what it will submit.

**The withdrawn state is also not stable.** The same unguarded write fires from six synchronous call sites (`:242`, `:266`, `:319` via the agent-box `onChange`, `:378`, `:533`, `:535`), each of which overwrites the blank field with `derived`. Convergence is toward the truth there — the field ends up showing what will be submitted, with focus elsewhere — so it is not a correctness break on its own, but it means "withdrawn" survives only until the next unrelated interaction.

**Why the inventory expanded.** Round 2 named the write-site fix (`document.activeElement !== pathInput`); the author fixed at the call site instead. One expansion, and the remaining boundary is closed by that one already-named condition — this is not a pattern of accreting patches, so **no handback to planning is recommended**. But the lesson is worth recording: guarding a caller leaves every other caller of the same write unguarded by construction.

**Fix.** Guard the write, not the caller — one condition closes all nine call sites instead of one:

```ts
if (pathIsDerived) {
  draft.path = derived;
  if (document.activeElement !== pathInput && pathInput.value !== derived) {
    pathInput.value = derived;
  }
}
```

`keepPathInput` and its wrapper listeners then become redundant and can go. Regression test: clear `#wt-path`, deliver the pending answer, type a new override, assert the submission carries only that override.

---

### [S1] `[R1] submits the offer the dialog was opened against, not a refreshed one` never submits, and its first assertion only guards against a re-added `setAgents`

- Severity: SUGGEST · Confidence: HIGH · Priority: P4
- Agent: asm-review-contracts (corroborated by chair)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts` (`describe("round-2 review fixes")`)
- Status: open · Triage: pending

Answering the author's question directly: **deleting `[W6]` rather than inverting it was right** — it encoded behaviour the base requirement forbids, and an inverted assertion belongs with the requirement, not with the withdrawn finding. The inversion *is* covered, but not by the test carrying its name.

Because the revert removed the only answer-path `setAgents` call, the agent `<select>` is not rebuilt on an answer under *any* splice. So `expect([...options].map(o => o.value)).toEqual(opened)` stays green even under the wholesale mutation `repos[at] = next`; it pins "nobody reinstated `setAgents`", which is a legitimate regression guard but not the offer-preservation invariant. The second assertion (`.wt-dest` `aria-label` === `/trees/x`) is load-bearing — it pins that the answer's destination lands, and fails if the spread operands are swapped. The invariant itself is pinned elsewhere: `[R1] a repo switch restores the agents that repo was opened with` fails under `agents: next.agents`, and `[R1] keeps the posture the user chose…` is the only added test that actually submits, asserting `permissionChoiceId`. Nothing asserts the submitted `agentId` against the opening offer. Fix: rename this test to what it pins, or add a submit and assert `submitted[0].agentId` is one of `opened`.

### [R4] `outstanding = false` is unconditional — carried from round 2, not taken

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4 · Agent: asm-review-logic (round 2) · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:583` · Status: open (persists from round 2) · Triage: pending

Unchanged by this round, and the R1 edit did not alter its reachability: the branchless answer that passes the stale guard is still produced only by the controller's open-time request, which routes to `openCreateDialog` rather than into an open form. Note it now also reaches the unflagged `syncDerived()` that R2 above describes.

### [R5] Tooltip module singleton is not reset between tests — carried, and the predicted escalation did **not** occur

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P5 · Agent: asm-review-contracts (round 2) · Class: machinery
- File: `src/webview/ui/Tooltip.ts` vs `src/webview/worktree/WorktreeCreateDialog.test.ts:11-13` · Status: open, non-gating · Triage: pending

Round 2 predicted a real 300 ms timer would outlive the R3 test. It does not: `vi.useFakeTimers()` with `advanceTimersByTime(400)` fires the timer inside the test and `finally { vi.useRealTimers() }` restores the clock, leaving `pendingTimer` null. `currentTarget` and `widget` are left holding detached nodes, but `ensureWidget`'s `doc.body.contains(widget.el)` check (`Tooltip.ts:32-44`) recreates the widget on the next attach, and the next `scheduleShow` overwrites `currentTarget`. `[R3]` being the last test in the file is therefore not load-bearing. The hygiene gap remains as originally stated; it is not live.

### [R6] Two tests still submit through the pre-answer fixture shape — carried from round 1 (W4), not taken

- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Agent: asm-review-contracts (round 2) · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts`; `src/webview/worktree/worktreeFixtures.ts:291-297` · Status: open (persists from rounds 1, 2) · Triage: pending

`createDefaults()` still has no `resolvedPath`. Neither residual test exercises the path or offer behaviour this round changed. Unchanged and non-gating.

---

## Verified safe this round

Checked and found sound; recorded so a later cycle does not re-hunt them.

- **Every added test is non-vacuous**, and none repeats the shape the author caught in his own first draft (an answer discarded by the stale guard because no branch was committed). All five commit a branch before answering, and each `answersBranch` matches the live `askedFor` key. Per-test single-token mutations that turn each red: `[R1] keeps the posture…` — reinstate an answer-path `agentBox.setAgents(...)` (posture resets to `initialPosture` = `"default"`); `[R1] a repo switch…` — `agents: opened.agents` → `agents: next.agents`; `[R1] submits the offer…` — swap the spread operands (destination assertion); `[R2] clearing…` and `[W3]` — `opts.keepPathInput !== true` → `=== true`; `[R3]` — `getText: () => destShort.textContent`. The author's three mutation claims are confirmed independently.
- **The changed `[W3]` assertion (`toBe(FULL_A)` → `toBe("   ")`) is not a tautological echo of its input**, because production may synchronously overwrite `pathInput.value` in the same event — which is exactly what it now forbids. Its destination-line assertion is unchanged and still pins the withdrawal.
- **The withdrawn state is honest** (self-consistent, though not stable — see R2). With `pathIsDerived` true and the field blank, the placeholder describes the override shape, the destination line names the derived value `draft.path` carries, the collision note is restored, and Create is enabled iff `derived` is non-empty — all consistent with "no override". A whitespace-only field (`"   "`) is also a withdrawal: `draft.path` becomes the derivation and only the untouched field still shows the spaces. Truthful on the line, mildly misleading in the field.
- **The `repos.push(next)` branch is not an R1 hole.** It does take the answer's live agents, but a probe confirms they reach neither `agentBox` nor `rebuildAfterOptions`, so no posture reset and no refreshed offer reaches submit. Its separate, pre-existing effect on the destination line is in the audit backlog below.
- **Tooltip show path in jsdom**: `show()` does not bail on zero rects or zero viewport values; the non-bubbling `mouseenter` reaches the element's own listener; `aria-describedby`, the `aria-hidden` shortened span and the `.wt-visually-hidden` exact span are unchanged, as is `releaseDestTip` on every dismissal path.
- **Base-spec conformance**: `asimov/specs/worktree-panel/spec.md:269-279` is satisfied on both halves — the open dialog's launch controls cannot be relabelled by a host target refresh, and a submission made after such a refresh is refused at the host on the frozen offer id.
- **Round-1 and round-2 verified-safe sets** for `worktreeAgentBox.ts` and `WorktreeLaunchDialog.ts` stand; both files are untouched since round 1.

## Audit backlog

**New this round** — valid, outside the verification cone, non-gating:

- **`repos.push(next)` can silently re-point the dialog at a different repo's destination.** `asm-review-logic` probed it: open with `repos: [A]` and `initialRepoId: "B"` — reachable, because `WorktreeView.openCreateDialog` passes `msg.repoId` straight through while `createRepos()` only emits repos still present in `this.tree.repos`, so a tree refresh dropping a repo between the request and the answer leaves `draft.repoId` absent from `repos`. The destination line reads `/trees/A` before the answer and `/trees/B` after `apply({repoId:"B", …})`, because the push makes `currentRepo()`'s `find` start succeeding on the pushed record. Pre-existing (`initialRepoId` is never validated against `repos`) and untouched by this diff. Fix when convenient: resolve `draft.repoId` against `repos` at construction, or ignore an answer whose `repoId` is not already in `repos`, the way the stale-branch guard ignores a mismatched answer.

Carried unchanged and non-gating:

- On open, before any branch is typed, the destination line states the host's branchless default as a resolved destination. Create is disabled on `!named`.
- `openDialogShell`'s `focusable()` filters disabled buttons but not disabled inputs, so `nameInput` in detached mode stays in the computed trap list. Native Tab skips it.
- `submit()` carries `draft.path` untrimmed, so an override of `"   x"` submits with its leading spaces. Pre-existing, unchanged by this diff, and the enable gate (`draft.path.trim().length === 0`) is the only place trimming happens.

---

## Cycle close

Round 3 is this cycle's cap. **No blocker survives it** — the one open finding is a WARN, so none of the three thrash-stop exits applies. The R2 boundary expansion is one round old and closes with a single condition at the write site; it is not a case of patch-level fixing having failed, and no handback to planning is recommended. The next user-initiated review starts cycle 2, round 1 in discovery mode, carrying the audit-backlog entries forward re-listed rather than re-reported.
