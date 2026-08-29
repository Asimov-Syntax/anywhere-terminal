# Review round 2 — lead-create-form-with-branch

- Date: 2026-08-29
- Cycle: 1
- Mode: verification
- Head reviewed: `14cb12caf1ab35ff26ca1056e5842fc7fbad1319` (tree clean for `src/`)
- Previous Head: `2a5ffc7b3ffbfdbec20f58f8bd1bf30d4b16b4b7`
- Diff scope: `git diff 2a5ffc7b..14cb12ca` — one commit, task 1_4
- Reviewable lines: ~93 added/modified in `WorktreeCreateDialog.ts` + `worktreePanel.css`; ~159 test lines reviewed inline
- Verdict: **BLOCK**
- Counts: 1 BLOCK · 2 WARN · 3 SUGGEST
- Scope lock: **passed** — task 1_4 is remediation of the seven accepted round-1 findings. No new capability, no new invariant owner, no semantically new contract. `asimov/changes/active`, analytics and build-state changes are metadata.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | B1 / W3 / W6 fixes + impact cone | state, races, regressions | `opus[1M]` |
| asm-review-frontend | W1 / W2 fixes | tooltip lifecycle, ARIA, path shortening | `gpt-5.6-terra[1M]` |
| asm-review-contracts | the five new tests | mutation / test-strength | `sonnet[1M]` |
| chair | full fix diff | all lenses + full-flow trace | `opus[1M]` |

Round 3 would be this cycle's last (max 3 per cycle).

---

## Prior findings — verification status

| ID | Round-1 severity | Status |
|---|---|---|
| B1 | BLOCK | **FIXED** |
| W1 | WARN P1 | **FIXED** in production; test gap → R3 |
| W2 | WARN P1 | **FIXED** |
| W3 | WARN P2 | **PARTIALLY FIXED** → R2 |
| W4 | WARN P2 | **PARTIALLY FIXED** → carried, downgraded (R6) |
| W5 | WARN P2 | **FIXED** |
| W6 | WARN P3 | **PARTIALLY FIXED**, regression introduced → R1 |

**B1 — FIXED.** `askKey` (`:407`) folds `draft.repoId` into the key; the only writer (`askForDestination`, `:415-418`) and the only reader (the `bindDefaults` guard, `:560`) use the same shape. The repo `change` handler sets `draft.repoId` before reaching `syncDerived()`, so the re-ask uses the new key; `repoSelect.change` is the only mutator of `draft.repoId` and always reaches `askForDestination`. Detached mode asks under `draft.baseRef` through the same key, and a repo switch while detached re-asks correctly. The one benign gap: switching mode new↔detached while `branchName === baseRef` (both `""` at open) does not re-ask, but the host's answer is a pure function of that string, so the answer would be identical. The pre-existing round-4-B12 tests still hold under the composite key, and the two-span change strengthens the stale-answer assertion (`h.host.textContent` now also carries the exact path).

**W1 — FIXED.** `ensureDestTip` (`:217`) attaches only once `destExact` is non-empty, called from the resolved branch of `syncDerived` (`:467`); `releaseDestTip` (`:222`) nulls the handle and is on all exit paths (`:149`, `:159`). The `getText: () => destExact` closure reads the live `let`, so it cannot strand a path across a repo switch or a branch edit — no leak, no stale closure. Production cannot re-enter the PENDING branch after attach, because `WorktreeController.createRepos()` only lists repos whose host answer carries a `path`, mapped to `resolvedPath`. The exact value is now carried by a real text node (`.wt-visually-hidden`) with the shortened sibling `aria-hidden="true"`, so it is stated exactly once per modality. The retained `aria-label` on the role-`generic` div is inert compatibility state — it neither overrides nor duplicates the accessible child. CSS uses a valid clip pattern with no layout effect; nothing in production reads `dest.textContent`.

**W2 — FIXED.** `segments()` (`:32`) splits `/[/\\]/`. Probed: POSIX, Windows, UNC (`\\server\share\wt` → `…/share/wt`), mixed separators and drive-relative `C:x` all behave; two-segment paths stay verbatim by design. Long Windows paths render their shortened tail with `/`, but the exact spelling remains in the hidden span and the tooltip, so the requirement holds.

**W5 — FIXED.** Both assertions that could not fail are gone, replaced with load-bearing ones (`not.toContain("already exists")`, `host.querySelector(".wt-dialog")).toBeNull()`). The rescoped "does not state a full path outside the advanced override" test holds under mutation: the `carries` predicate does reach the visually-hidden span, and the paired length-0 / length-1 assertions pin both halves.

**Two specialist test-strength claims were refuted by the chair** and are recorded here so they are not re-raised: mutating `getText: () => destExact` to `getText: () => ""` does *not* survive the `[W1]` test (`attachTooltip` bails on empty and never sets `aria-describedby` → red), and mutating `lastSegment`'s `.at(-1)` to `.at(-2)` does *not* survive the `[W2]` test (`collidedWith` is `"-feat-x"`, which does not contain `"repo-feat-x"` → red). Both verified by direct probe.

---

## Findings

### [R1] The W6 fix admits a refreshed launch offer into an open dialog, discarding the user's chosen posture on every branch keystroke

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:573-576`, with `src/webview/worktree/worktreeAgentBox.ts:147-162`
- Status: open · Triage: pending

**Evidence.** `setAgents` resets the posture unconditionally, regardless of whether the list changed:

```ts
function setAgents(next) {
  offered = next;
  const keep = next.some((a) => a.id === agentId) ? agentId : next[0]?.id;
  agentId = keep;
  permissionChoiceId = initialPosture(next.find((a) => a.id === keep));   // ← unconditional
```

`agentId` survives an identical list; `permissionChoiceId` does not — it is recomputed to "first non-dangerous". `WorktreeController.createRepos()` (`:612-638`) stamps `agents: this.launchAgents`, and `launchAgents` is reassigned only on a launch-targets message (`:587`), so every create-defaults answer carries the **same array reference**. The refreshed list is byte-identical in the common case and the reset still fires.

Reachability is per keystroke, not per settled edit: `nameInput.addEventListener("input", syncDerived)` and `syncDerived` calls `askForDestination()`, whose key changes with every character. So the host is asked and answers per character, and each answer now runs `agentBox.setAgents(...)`. Before this diff `setAgents` was reachable only from the repo `change` handler (`:240`) and construction, where resetting the posture is the intended semantics.

**Impact — two branches.**

1. *Identical offer (common).* User picks "Start an agent", an agent, and a posture other than the first safe one, then edits the branch name. Every character wipes the selection back to `initialPosture`. For an agent whose postures are all dangerous, `initialPosture` returns `undefined`, so the deliberate choice is erased, `needsPosture()` flips true, and Create disables mid-typing with no explanation. `agentId` and `prompt` survive; only the posture is swapped. The reset never escalates — `initialPosture` skips dangerous choices — but a deliberate permission choice is discarded silently, which is the invariant this change's submit gate exists to hold.

2. *Changed offer.* This silently repeals the unmodified base requirement **"A launch is submitted as the offer it was shown"** (`asimov/specs/worktree-panel/spec.md:269`), whose scenario reads: *"WHEN a launch dialog is open and the host publishes a new set of launch targets before the dialog is submitted THEN the submission is refused rather than admitted as a choice made from the new set."* The create dialog implements that via `frozenCreateOffer`, set once at dialog open (`WorktreeController.ts:653`) and quoted at submit (`:371`). `launchAgents` and `launchOfferId` are refreshed on every panel visibility transition (`:434-445`), so opening the dialog and toggling the sidebar view away and back replaces both. A subsequent keystroke's answer now installs the **new** agent set into the open dialog while the submission still quotes the **old** offerId. `WorktreeHost.ts:760` refuses on `offerId !== offer.offerId`, so this is fail-closed — the host catches it, the offer check is not defeated. The harm is a create the user fills in and submits that silently does nothing, where the requirement says the new set should never have been offered.

**Chair note — round 1 got this partly wrong.** Round-1 W6 asked for exactly this refresh. The base requirement above says the opposite: a create dialog should submit against the offer it was opened against, so the "staleness" W6 named was in part that requirement working as designed. W6 is withdrawn as stated and restated here: the defect is that `createRepos()` puts a live `launchAgents` reference into an answer that reaches an open dialog at all.

**Fix.** Revert the `agentBox.setAgents(...)` + `rebuildAfterOptions()` at `:573-576`. Address the original gate-staleness concern the way the base requirement prescribes — have the apply callback preserve the dialog's opening `agents` when splicing `repos[at] = next`, so the record the dialog holds keeps the offer it opened against. If a refresh must be admitted at all, `setAgents` should carry a still-valid selection forward the way it already carries `agentId`:

```ts
const kept = next.find((a) => a.id === keep);
permissionChoiceId = kept?.permissionChoices.some((c) => c.id === permissionChoiceId)
  ? permissionChoiceId
  : initialPosture(kept);
```

That preserves repo-switch semantics (a posture id from another agent is not in the new list, so it still resets) while making an identical-list refresh inert.

---

### [R2] Clearing the override refills the field under the caret, so clear-then-type submits `derived + typed`

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:537-544`, with `:449-452`
- Status: open · Triage: pending

**Evidence.** The `input` handler sets `pathIsDerived = pathInput.value.trim() === ""`, then `syncDerived()` runs `if (pathIsDerived) { draft.path = derived; pathInput.value = derived; }`. So the moment the field is empty or whitespace it is rewritten with the derived path in the same event, and per the HTML value setter the caret moves to the end.

- **select-all + Delete** → refilled with the derived path, caret at end. The user believes the field is empty; the next characters append, `pathIsDerived` flips false, and that concatenation is what `submit()` carries.
- **backspace-to-empty** → same refill at the empty step; the next backspace deletes the last character of the derived path, producing a plausible-looking but wrong destination.
- **typing a single space** → swallowed and replaced.
- **select-all then type in one keystroke** → correct. This is the gesture the new `[W3]` test exercises, which is why it passes.

**Impact.** The withdrawal itself works, so W3's stated goal is met — but round 1's visible dead end has been traded for a silently submittable wrong path. Mitigating: the destination line does state the concatenated value (shortened, with the exact value in the hidden span), so the form still names what it will submit; the delta requirement is not violated. That is what holds this at WARN rather than BLOCK.

**Fix.** Do not write the field back while the user is mid-edit — assign `pathInput.value` only when the value differs *and* `document.activeElement !== pathInput`; or move the withdrawal to `change`/blur so the field stays empty while typing and re-derives once the edit settles.

---

### [R3] The `[W1]` test pins tooltip attachment, not tooltip content — nothing in the suite ever hovers or focuses the destination

- Severity: WARN · Confidence: MEDIUM · Priority: P3
- Agent: asm-review-contracts (test lens)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts:459-467`
- Status: open · Triage: pending

**Evidence.** The test asserts `dest.querySelector(".wt-visually-hidden")?.textContent` and `dest.getAttribute("aria-describedby") === "webview-tooltip-widget"`. Both are set synchronously by `attachTooltip` at attach time, independent of what `getText` later returns. Surviving mutation: change `getText: () => destExact` (`:219`) to `getText: () => destShort.textContent ?? ""` — `resolveText()` is still non-empty at attach, so `aria-describedby` is still set and the test stays green, while hover and focus would silently show the *shortened* text instead of the exact path. No test in the file calls `.focus()` or dispatches `mouseenter` on `.wt-dest`, so `scheduleShow`/`show()` are never exercised.

**Impact.** The "reachable by hover" half of round-1 W1 — the half that was entirely dead before this round — is still unverified. Only "a tooltip was attached" is pinned.

**Fix.** Add a case that dispatches `focus` (or `mouseenter`) on `.wt-dest`, advances 300 ms on fake timers, and asserts `#webview-tooltip-widget` `textContent === FULL_A`.

---

### [R4] `outstanding = false` is unconditional, so a branchless answer can clear a still-unanswered request

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4
- Agent: asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:560-569`
- Status: open · Triage: pending

The late-answer guard short-circuits when `answersBranch === undefined`, and `outstanding = false` (`:569`) then runs regardless of which request is in flight; the `next.repoId === draft.repoId` check gates the W6 refresh but not the clear. `WorktreeController.ts:482` (`openCreateFor`) is the only branchless sender and `WorktreeHost.ts:963` echoes `branch` only when it was sent. Unreachable with harm today: `handleCreateDefaults` routes a branchless answer to `view.openCreateDialog`, which disposes the open dialog and rebinds `applyCreateDefaults`, and the freshly opened dialog has Create disabled on `!named` anyway. The invariant rests entirely on that caller coupling. Fix: require the key to match, or move the clear inside the repo-matching block.

### [R5] Tooltip module singleton is not reset between tests

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4
- Agent: asm-review-contracts
- Class: machinery
- File: `src/webview/ui/Tooltip.ts` (module state) vs `src/webview/worktree/WorktreeCreateDialog.test.ts:11-13`
- Status: open · Triage: pending

`afterEach` only calls `document.body.replaceChildren()`; no test disposes the dialog or calls the exported `resetTooltipForTests()`. Benign today only because nothing triggers `scheduleShow`. The moment R3's fix lands, a real 300 ms timer will outlive the test that scheduled it and can fire mid-next-test against the shared widget. Fix: add `resetTooltipForTests()` to `afterEach`, or use fake timers in any hover test.

### [R6] Two tests still submit through the pre-answer fixture shape — carried from round-1 W4, downgraded

- Severity: SUGGEST · Confidence: HIGH · Priority: P4
- Agent: asm-review-contracts (corroborated by chair)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts:514-523, 525-534`; `src/webview/worktree/worktreeFixtures.ts:291-297`
- Status: open (persists from round 1, W4) · Triage: pending

`createDefaults()` never gained a `resolvedPath`, though task 1_4 step 6 named it. The author documented `open()` as the pre-answer shape and rewired the one test that asserts destinations (`leaves no open-after mode unreachable`, `:536-575`) instead. **Evidence delta justifying the downgrade from WARN P2:** the residual is two tests in the same block that assert only `openAfter` and never touch destination or path, and the `outstanding` gate is separately covered by the round-4-B12 block. The inconsistency is within one `describe`. Fix: rewire the two the same way, or state why they are exempt.

---

## Verified safe this round

- **Re-entry (author's manifest confirmed).** The apply path runs `setAgents` (the box does not call back) → `rebuildAfterOptions` → `syncOpenAfter` → `syncDerived` #1 → `syncDerived` #2. Exactly two renders plus one agent-box render. `outstanding = false` is set before both, so neither sees a stale gate. Inside render #1 `askForDestination` recomputes `askKey` from unchanged inputs, equals `askedFor`, and returns without posting. No re-ask loop, no oscillation; state settles.
- **`rebuildAfterOptions`** resets `afterChoice` only on a genuine withdrawal.
- **`[B1]`, `[W2]`, `[W3]`, `[W6]` tests** each independently re-derived and confirmed to go red under the single-token revert of their fix. The `[W6]` test's own "ruled out" comment holds: at its final assertion the button is disabled by `postureMissing` alone, not by `outstanding`, an empty path, or a branch error.
- **`worktreeAgentBox.test.ts`** placeholder-`disabled` assertion is load-bearing.
- **`worktreeAgentBox.ts` and `WorktreeLaunchDialog.ts`** are untouched since round 1; their round-1 verified-safe set stands.

## Audit backlog

Carried from round 1, unchanged and non-gating:

- On open, before any branch is typed, the destination line states the host's branchless default as a resolved destination. Create is disabled on `!named`.
- `openDialogShell`'s `focusable()` filters disabled buttons but not disabled inputs, so `nameInput` in detached mode stays in the computed trap list. Native Tab skips it.

---

## Author triage — cycle 1, round 2

All three findings accepted; none rebutted. Each verified against source first.

### [R1] The W6 fix admits a refreshed offer into an open dialog — **accepted**
Confirmed on every link: `setAgents` resets `permissionChoiceId` unconditionally (`worktreeAgentBox.ts:147-150`), `createRepos()` stamps the live `this.launchAgents` (`WorktreeController.ts:634`), and `nameInput`'s `input` handler reaches `askForDestination`, so the host answers per character. And the base requirement is explicit — `asimov/specs/worktree-panel/spec.md:269`, "the values it submits SHALL be the ones the dialog was opened against", with a scenario saying a refresh under an open dialog is refused rather than admitted.

I made the same mistake here that a previous change's round 2 caught: a fix cannot repeal an unmodified base requirement, and the fact that a review round asked for the fix does not license it. The chair withdrawing its own W6 on that reading is the correct call, and the revert is not a rebuttal of W6 — it is W6 being answered from the other side. The gate reading the opening list is CORRECT, because the opening list is what the dialog is allowed to submit.

### [R2] Clear-then-type on the override submits `derived + typed` — **accepted**
Confirmed at `:537-544`. My W3 fix flips `pathIsDerived` back on an empty field and then `syncDerived` writes the derivation into the same input in the same event. The `[W3]` test passes because select-all-then-type is a single `input` event carrying the final value — the one gesture that cannot observe the refill. Round 1's visible dead end became a silently wrong path, which is worse.

### [R3] The `[W1]` test pins attachment, not content — **accepted**
Confirmed: nothing in the suite hovers or focuses `.wt-dest`, so `show()` never runs and `getText` is never called. The assertion proves an attach happened, which is not what the requirement says.

### Chair's two refutations
Recorded and accepted as correct — I re-probed both. `getText: () => ""` does not survive `[W1]` because `attachTooltip` bails before setting `aria-describedby`; `.at(-1)` → `.at(-2)` does not survive `[W2]` because `collidedWith` is `"-feat-x"` and the assertion looks for `"repo-feat-x"`.

### Suggestions
Not taken this round: the unconditional `outstanding = false` (harmless under the current single caller), the tooltip singleton vs `afterEach` (R3's fix uses fake timers and disposes, so it does not become live), and the two remaining pre-answer-shape tests (they assert `openAfter` only, never a path — the chair downgraded W4 on that basis).
