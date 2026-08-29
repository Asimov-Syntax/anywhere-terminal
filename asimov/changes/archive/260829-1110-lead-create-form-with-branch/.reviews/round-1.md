# Review round 1 — lead-create-form-with-branch

- Date: 2026-08-29
- Cycle: 1
- Mode: discovery
- Head reviewed: `2a5ffc7b3ffbfdbec20f58f8bd1bf30d4b16b4b7` (tree clean for `src/`; working tree dirty in `docs/ui/worktree.html` and `skills-lock.json`, both outside the diff scope and not reviewed)
- Diff scope: `git diff 767094c0..HEAD`
- Reviewable lines: ~391 added/modified across 4 reviewable files (`WorktreeCreateDialog.ts`, `worktreeAgentBox.ts`, `WorktreeLaunchDialog.ts`, `worktreePanel.css`); ~417 test lines reviewed inline
- Verdict: **BLOCK**
- Counts: 1 BLOCK · 6 WARN · 5 SUGGEST
- Split over gating blockers: 1 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | `WorktreeCreateDialog.ts` state machine | destination sources, re-entry, races | `opus[1M]` |
| asm-review-frontend | create dialog + CSS | focus trap, ARIA, tooltip lifecycle | `gpt-5.6-terra[1M]` |
| asm-review-contracts | all changed files | code vs delta spec + APPLIED base spec | `sonnet[1M]` |
| asm-review-logic | `worktreeAgentBox.ts`, `WorktreeLaunchDialog.ts` | posture gate at both doors | `gpt-5.6-terra[1M]` |
| asm-review-contracts | test files | test-strength / mutation lens | `gpt-5.6-luna[1M]` |
| chair | full diff | all lenses + full-flow trace | `opus[1M]` |

Verify gate evidence is the build's own (`workflow.md` → Verify gate: lint check mode, 17 findings set-identical to baseline; three clean full-suite runs). No verify command was run by this review.

---

## Findings

### [B1] Repo switch with a typed branch never re-asks the host — the stated and submitted destination belong to a different repo/branch

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-logic (corroborated by asm-review-contracts and chair)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:372-383` (cache), `:202-207` (repo handler), `:402-420` (statement), `:481` (gate)
- Status: open · Triage: pending

**Evidence.** `askForDestination()` dedupes on the branch string alone:

```ts
const branch = detached ? draft.baseRef : draft.branchName;
if (branch === askedFor) { return; }
askedFor = branch;
if (deps.onBranchChange !== undefined) { outstanding = true; deps.onBranchChange(draft.repoId, branch); }
```

The request it guards is repo-scoped, but the cache key is not. The repo `change` handler (`:202-207`) sets `draft.repoId`, then reaches `syncDerived()` → `askForDestination()`, which short-circuits because the branch text did not change. `askedFor` is never reset there and `outstanding` is never re-armed, so `createBtn.disabled` (`:481`) leaves Create enabled.

Two variants, and which one occurs depends on whether the newly selected repo carries a `resolvedPath`:

- **Production shape.** `WorktreeController.createRepos()` only lists repos with a host answer and always sets `resolvedPath: answer.path`. So repo B carries a `resolvedPath` from its own *previous* answer — typically the branchless open-time one. The line then states `…/<tail>/<prefix>` and `draft.path` carries the same value. Statement and payload agree; both are the destination for a different branch, and the host's collision resolution for the current branch never ran.
- **Fixture shape** (and any caller without a seeded `resolvedPath`). `stated` is falsy → the line renders the pending copy `Defaults to …/<prefix>-<branch>`, while `derived` falls back to `${repo.pathParent}/${repo.pathPrefix}-${slug}` and `draft.path` carries that local guess. Here the line and the submission actively disagree.

The two specialists reported different variants; the divergence is itself explained by W4 below.

**Impact.** Violates the still-binding base requirement *"A created worktree names the destination it will actually use"*, and in the second variant also the delta's own *"The stated destination SHALL be the path the submission carries."* Reachable in a multi-repo workspace once the user has created from more than one repo in the session.

**Provenance.** The `askForDestination` dedup is pre-existing (this diff touches none of those lines). It is reported here because the diff rewrote `syncDerived` around it and made the destination line the form's authoritative statement, which is what turns the stale value into a requirement violation. Pre-change, the same stale value sat in a visible `Path` field on the form's face; it is now shortened and the editable copy is behind the collapsed disclosure.

**Fix.** Key the cache on repo as well — `askedFor = \`${draft.repoId}\u0000${branch}\`` — or set `askedFor = null` in the repo `change` handler before `syncDerived()`. Add a test that types a branch, switches repo, and asserts Create is disabled until the host answers for the new repo.

---

### [W1] The destination tooltip is never attached, and `aria-label` on a role-generic div is name-prohibited

- Severity: WARN · Confidence: HIGH · Priority: P1
- Agent: asm-review-frontend (corroborated by asm-review-logic and chair)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:181, 187-189`; `src/webview/ui/Tooltip.ts:123-126`
- Status: open · Triage: pending

**Evidence.** `attachTooltip` resolves its text once, at attach, and bails when empty:

```ts
const resolveText = (): string => (opts.getText ? opts.getText() : staticText).trim();
if (!resolveText()) {
  return () => {};   // no listeners, no widget, no aria-describedby
}
```

The call site is `let destExact = ""` immediately followed by `attachTooltip(dest, { getText: () => destExact })`. `destExact` has no value until the first `syncDerived()` at `:526`. So the tooltip is never live at any point in the dialog's life — no `mouseenter`, no `focus`, no `aria-describedby` — and `disposeDestTip` is a no-op, which makes the entire `disposeAll` / `onDismiss` tooltip-release apparatus (`:137-152`) dead code.

The other promised carrier does not work either: `dest` is a bare `<div>` with `tabIndex = 0` and no `role`, so its implicit ARIA role is `generic`, for which accessible naming is prohibited. Assistive technology does not expose its `aria-label`.

**Impact.** The delta requirement *"The exact value SHALL be reachable without leaving the dialog"* is satisfied only by accident, via the `#wt-path` override input inside the collapsed Advanced disclosure. Both mechanisms the code comments name are inert, and `tabIndex = 0` adds a focus stop to the trap that announces nothing and does nothing on focus. Not BLOCK: the value does remain reachable and no wrong behavior is produced.

**Fix.** Attach after the first render (move the call below `syncOpenAfter()`), or let `attachTooltip` defer the empty check to show time when `getText` is supplied. Keep `disposeDestTip` assigned before any exit path can run — the disposal plumbing itself is correct on all five paths (submit, Cancel, title dismiss, Escape, scrim, caller disposer). Give `dest` a role that permits a name, or move the exact value onto a visually-hidden child. Then pin it with a test that focuses `.wt-dest`, advances the 300 ms delay, and asserts the widget text.

---

### [W2] `shortPath` / `lastSegment` split on `/` only — on Windows the line is not shortened and the collision note restates the full path

- Severity: WARN · Confidence: HIGH · Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:32-39`, used at `:425` and `:449`
- Status: open · Triage: pending

**Evidence.** Both new helpers do `path.split("/")`. The host produces native paths — `src/worktree/createPath.ts` uses `node:path` and its tests explicitly exercise `platform: "win32"` with `\` separators (`createPath.test.ts:224-312`). Probe:

```
input : C:\Users\dev\Projects\ai-oss\anywhere-terminal-feat-x
shortPath  -> C:\Users\dev\Projects\ai-oss\anywhere-terminal-feat-x   (unshortened)
lastSegment -> C:\Users\dev\Projects\ai-oss\anywhere-terminal-feat-x   (whole path)
```

**Impact.** On Windows the ADDED requirement *"The form SHALL state the resolved destination exactly once, shortened for reading"* is not met, and the MODIFIED requirement *"SHALL NOT restate a full path a second time"* is broken outright — `dest` and `destNote` both render the full path. No test uses a Windows-shaped path.

**Reuse.** The repo already carries two documented "POSIX-and-Windows-safe" segment helpers in the same webview bundle: `basename` in `src/webview/fileTree/FileTreePanel.ts:1701-1708` and `dirname` in `src/webview/fileTree/FileSystemDataSource.ts:39-50`. Both use `Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))`. The new helpers ignore that convention.

**Fix.** Split on both separators (or lift the existing `basename` into a shared module and build on it). Add a win32-shaped fixture to the destination tests.

---

### [W3] Emptying the destination override is an unrecoverable dead end the form describes as a default

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:495-499`, effects at `:419-442`, `:481`
- Status: open · Triage: pending

**Evidence.** Any `input` on `#wt-path` sets `pathIsDerived = false` permanently, including a clear-to-empty. Nothing ever sets it back. In that state: `overridden === true`, `stated = draft.path = ""` → falsy → the line renders `Defaults to …/${repo.pathPrefix}-<branch>` with `wt-dest--pending`; the collision note is suppressed by `repo.collidedWith && !overridden`; and Create is held disabled by `draft.path.trim().length === 0` with no message. Editing the branch does not recover it. A whitespace-only override is worse: `stated` is truthy, so the line renders blank while Create stays disabled.

**Impact.** The form's face asserts a derivation that is switched off for the rest of the dialog's life, the collision warning disappears silently, and the only control that explains the disabled Create is now behind a collapsed disclosure. Pre-change the emptied field was the form's primary control and self-evidently the cause; the restructure is what hides it.

**Fix.** Treat an empty/whitespace override as no override: `pathIsDerived = pathInput.value.trim() === ""` in the handler.

---

### [W4] Test fixtures render a state production cannot produce

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: chair (corroborated by asm-review-contracts)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts:15-31`; `src/webview/worktree/worktreeFixtures.ts:291-297`
- Status: open · Triage: pending

**Evidence.** `createDefaults()` never sets `resolvedPath`, and the `open()` helper omits `onBranchChange` and `bindDefaults`. `WorktreeController.createRepos()` always sets `resolvedPath: answer.path`, and `createDialogDeps` always wires both callbacks (`WorktreeController.ts:303-311`). Seven new/changed tests submit through `createDefaults()` with no host wiring, so they exercise the branch where `stated` is falsy, `outstanding` never arms, and `draft.path` is a local guess — a configuration production never reaches. Only the `resolved()` helper wires the host.

**Impact.** The new open-after, folder-mode and posture-gate tests all assert against the pending-destination shape rather than the resolved one. This is also why the two specialists produced different repros for B1.

**Fix.** Give `createDefaults()` a `resolvedPath` (production always has one) and wire `onBranchChange`/`bindDefaults` in `open()`, keeping an explicit opt-out fixture for the unresolved case.

---

### [W5] Tautological assertions, and the tooltip claim is asserted by nothing

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-contracts (test lens), corroborated by asm-review-frontend, asm-review-logic, chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts:385-395, 418, 465`
- Status: open · Triage: pending

**Evidence.**
- `:418` `expect(host).toBeDefined()` — `host` is a `document.createElement("div")` the helper just made.
- `:465` `expect(q === undefined).toBe(false)` — `q` is a function literal the helper just returned.
- `:385-395` the comment reads *"the exact value is what the element announces and what its tooltip carries"*, but the assertions are `textContent`, `aria-label` and `tabIndex` only. Deleting `attachTooltip`, `destExact`, `disposeDestTip`, `disposeAll` and the `onDismiss` hook leaves the entire suite green — which is exactly how W1 shipped.

**Impact.** No single-token production mutation can turn the first two red. The third pins a comment, not behavior.

**Fix.** Delete the two filler expectations; add a real tooltip assertion (focus `.wt-dest`, advance the timer, assert `#webview-tooltip-widget` text and `aria-describedby`).

---

### [W6] `bindDefaults` refreshes the repo's agents but never refreshes the agent box or the after-create options

- Severity: WARN · Confidence: MEDIUM · Priority: P3
- Agent: asm-review-logic (posture lens)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:509-524`
- Status: open · Triage: pending

**Evidence.** The apply callback does `repos[at] = next` — replacing `agents` along with everything else — then calls only `syncDerived()`. It never calls `agentBox.setAgents(next.agents)` or `rebuildAfterOptions()`. The box keeps its own `offered` array, and `needsPosture()` reads `current()` from it.

**Impact.** A host answer arriving while the dialog is open can change the current repo's agent offer without the box or the new posture gate noticing: an offer that became all-dangerous leaves Create enabled on a posture the user never chose, and one that gained a safe posture can leave Create disabled. The `agent` choice can also stay offered for a repo that no longer has agents. The apply block is unchanged by this diff, but the posture gate added here is what makes it load-bearing.

**Fix.** When `next.repoId === draft.repoId`, call `agentBox.setAgents(next.agents)` and `rebuildAfterOptions()` before `syncDerived()`. Add a test that applies refreshed defaults switching the current repo from a safe agent to an all-dangerous one.

---

### [S1] `onBranchChange` / `bindDefaults` are optional while the whole "destination known before submit" gate depends on them

- Severity: SUGGEST · Confidence: HIGH · Priority: P4
- Agent: asm-review-contracts
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:93, 99`
- Status: open · Triage: pending

Without the pair, `outstanding` never arms and a purely local guess becomes submittable. The one production caller supplies both, so this is a contract hazard rather than a live path — but the type does not encode the invariant, and the test suite is already living in the unsafe configuration (W4). Make them required, or throw when one is present without the other.

### [S2] Redundant renders: two per repo switch, one per seed-prompt keystroke

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4
- Agent: asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:202-207, 283`; `src/webview/worktree/worktreeAgentBox.ts:185`
- Status: open · Triage: pending

The repo handler calls `rebuildAfterOptions()` (which ends in `syncDerived()`) and then `syncDerived()` again. Separately, this diff introduced `createWorktreeAgentBox(agents, () => syncDerived())` in the create form, and the box routes `promptInput`'s `input` event through `onChange` — so every character of the seed prompt rebuilds the destination line, rewrites `pathInput.value`, re-runs `validateBranch`, and re-queries the focus trap. Only agent/posture changes can move `needsPosture()`. Bounded and small; not a correctness issue. No re-entry or oscillation exists: `syncDerived` has no back-edge to `syncOpenAfter`, and `askForDestination` self-limits.

### [S3] The all-dangerous test does not assert the placeholder is disabled

- Severity: SUGGEST · Confidence: HIGH · Priority: P4
- Agent: asm-review-logic (posture lens)
- Class: feature
- File: `src/webview/worktree/worktreeAgentBox.test.ts:178`
- Status: open · Triage: pending

Mutating `placeholder.disabled = true` to `false` leaves the assertions green — the value is still `""` and `permissionChoiceId` is still `undefined`. Assert the first option has `value === ""`, `disabled === true`, `selected === true`.

### [S4] The "no second full path" filter never inspects control values

- Severity: SUGGEST · Confidence: HIGH · Priority: P5
- Agent: asm-review-contracts (test lens)
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts:398-404`
- Status: open · Triage: pending

`el.children.length === 0 && (el.textContent ?? "").includes(FULL)` never reaches an `<input value={FULL}>`, whose `textContent` is `""`. The assertion is load-bearing for `shortPath` (mutating it to return the input would fail the test) but blind to a full path rendered through a control. The `!advanced?.contains(el)` clause is currently dead for the same reason.

### [S5] `syncStart` is reachable from a callback declared before it

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P5
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeLaunchDialog.ts:45-56`
- Status: open · Triage: pending

The `onChange` closure passed into `createWorktreeAgentBox` calls `syncStart`, a `const` arrow declared afterwards. Safe today only because `setAgents()` — which the box runs during construction — does not invoke `onChange`. If that ever changes, the constructor throws a TDZ `ReferenceError`. Hoist `syncStart` to a function declaration.

---

## Verified safe

Checked and found sound; recorded so a later round does not re-hunt them.

- Posture gate correctness: zero declared postures → `needsPosture()` false (agent stays launchable); empty agent list → false; the create form's `afterChoice === "agent" &&` guard keeps the gate from firing while the block is hidden. Both doors gate (`createBtn.disabled`, `startBtn.disabled` plus the `submit()` re-check).
- `read()` never returns `permissionChoiceId: ""` — the change handler maps `""` back to `undefined`, and `renderPostures()` rebuilds options rather than resetting by value.
- `renderPostures()` inside the `change` handler does not re-enter, storm, lose the selection, move focus off the `<select>`, or clear the prompt on a same-agent posture change.
- Tooltip disposal covers all five exit paths (submit, Cancel, title dismiss, Escape, scrim, caller disposer) and is idempotent; only the attach is wrong (W1).
- `rebuildAfterOptions` across a repo switch: `folder` and its `folderMode` survive as required; `agent` is withdrawn to `none` only when the new repo has no agents. Every `WorktreeOpenAfter` wire value stays reachable.
- Focus trap after the restructure: nothing inside `[hidden]` is tabbable while the disclosure is collapsed or the agent block absent; the shell recomputes `focusable()` on every Tab, so the `refreshFocusTrap`-before-`disabled` ordering in `WorktreeLaunchDialog` has no observable effect.
- A late host answer after an override cannot overwrite `draft.path` (`pathIsDerived` is false), and detached mode routes `baseRef` through the same single `stated` expression.
- The posture-gate create test is load-bearing: with the fixture's wiring the only reason Create is disabled there is `postureMissing`.

## Audit backlog

- On open, before any branch is typed, the destination line states the host's branchless default as a resolved destination. Create is disabled (`named` is false), so nothing can act on it, and the pre-change form displayed the same value in the path field. Non-gating.
- `openDialogShell`'s `focusable()` filters disabled buttons but not disabled inputs/selects, so `nameInput` in detached mode stays in the computed trap list. Native Tab skips it, so no control is unreachable today. Pre-existing, non-gating.

---

## Author triage — cycle 1, round 1

Every finding was checked against source before a status was written. All seven accepted; none rebutted.

### [B1] Repo switch never re-asks the host — **accepted**
Confirmed at `WorktreeCreateDialog.ts:373-383` and `:202-206`. `askedFor` holds a bare branch string while the request it guards is `(repoId, branch)`; the repo handler mutates `draft.repoId` and reaches `askForDestination()`, which short-circuits. The dedup predates this change, but the chair is right that this diff is what made the line authoritative — before it, the path input WAS the display, so a stale answer was visible in the field the user could edit. Keying on both is the fix; nulling in the handler would leave the same hole for any future caller that changes the repo elsewhere.

### [W1] The destination tooltip is never attached — **accepted**
Confirmed at `ui/Tooltip.ts:122-125`: `resolveText()` runs at attach and returns `() => {}` when empty. `destExact` is `""` on the line above the call, so the attach has always been a no-op and `disposeDestTip` has always been dead. The second half is also right: `aria-label` on a bare `<div>` (implicit role `generic`) is not exposed, so neither promised carrier worked. My task Plan named both mechanisms explicitly and neither was ever live — the assertion that would have caught it is the one W5 says is missing.

### [W2] `shortPath` / `lastSegment` are POSIX-only — **accepted**
Confirmed. Both split on `/`. The repo already carries the POSIX-and-Windows idiom twice (`fileTree/FileSystemDataSource.ts:41`, `fileTree/FileTreePanel.ts:1703`), both module-private. Taking the idiom rather than exporting a file-tree helper into the worktree dialog — the coupling would cost more than the four characters saved.

### [W3] Emptying the override is an unrecoverable dead end — **accepted**
Confirmed at `:495-499`. `pathIsDerived` is one-way. Clearing the field leaves the face showing a derivation that is switched off, and the control that explains it behind the disclosure.

### [W4] Test fixtures render a state production cannot produce — **accepted**
Confirmed: `createDefaults()` sets no `resolvedPath`, and the default `open()` omits both host callbacks. This is the same class of defect as the fixtures that hid earlier rounds' bugs on this codebase, and it is why B1 needed two repros to describe.

### [W5] Tautologies, and the tooltip claim is asserted by nothing — **accepted**
`expect(host).toBeDefined()` and `expect(q === undefined).toBe(false)` are mine and cannot fail; I added them to keep a destructured binding used. That is not a reason to assert something. The tooltip gap is the direct cause of W1 shipping.

### [W6] `bindDefaults` refreshes agents without refreshing the box — **accepted**
Confirmed at `:509-524`. Pre-existing, made load-bearing by the posture gate this change added — which is exactly the case the remediation boundary says to fix rather than defer.

### Suggestions
Taking the `placeholder.disabled` mutation gap (a real test-strength hole in code this change wrote). Leaving the two performance ones and the optional-callback typing — neither changes behaviour, and the render count is bounded by keystrokes.
