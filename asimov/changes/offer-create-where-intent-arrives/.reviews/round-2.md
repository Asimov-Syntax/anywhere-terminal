# Review round 2 — offer-create-where-intent-arrives

- Date: 2026-08-29
- Cycle: 1
- Mode: verification
- Head: `b1189165ee5fce8be94aacf7efbc6a17fa28f266` (src tree clean; `analytics.json` / `.analytics-cursor.json` dirty — change metadata, out of scope)
- Scope: range `3a5f632b..b1189165` — the round-1 fix diff and its behavioral impact cone
- Reviewable lines: ~111 (src, non-test) + ~176 test lines
- Scope lock: PASSED. The only non-src delta is task `1_4` (remediation bookkeeping, Refs resolve to already-accepted requirements) plus `.build/` and analytics metadata. No new capability, no new invariant owner.
- Agents spawned: asm-review-logic (opus[1M]), asm-review-frontend (gpt-5.6-terra[1M]), asm-review-contracts (sonnet[1M]), plus chair self-review + independent trace
- Agents skipped: asm-review-data-security (no auth/persistence/secrets surface), asm-review-performance (W4/S5 cost folded into the frontend and chair lenses — the cone is a four-door fan-out over a workspace-bounded repo list), asm-review-reuse (S3 is a one-line class rename verified inline)
- Verify gate: `bun run asm change verify-status offer-create-where-intent-arrives` → `1_4 [x] exit 0 scope-unchanged`
- Verdict: WARN
- Counts: 0 BLOCK / 3 WARN / 4 SUGGEST (+ 2 audit-backlog)

## Round-1 findings — verification result

| ID | Round-1 severity | Result | Verified by |
|----|------------------|--------|-------------|
| B1 | BLOCK | **fixed** | logic + contracts + chair (three independent) |
| B2 | BLOCK | **fixed** | logic + contracts + chair |
| W1 | WARN | **fixed** | logic + chair (ordering doubt resolved — see S6) |
| W2 | WARN | **fixed** | logic + contracts + chair |
| W3 | WARN | **fixed**, with a new defect on the fixed line — W8 | frontend + chair |
| W4 | WARN | **fixed** | frontend + chair |
| W5 | WARN | **fixed** | frontend |
| W6 | WARN | **fixed** | logic + chair |
| W7 | WARN | **fixed** in source; test shape noted — S7 | frontend + chair |
| S1 | SUGGEST | audit-backlog, carried forward unchanged | — |
| S2 | SUGGEST | **partially fixed** — escalated, see W10 | logic |
| S3 | SUGGEST | **fixed** | frontend |
| S4 | SUGGEST | **persists from round 1** (untriaged) | chair |
| S5 | SUGGEST | **persists from round 1** (untriaged), reachability widened | chair |

### B1 — verified fixed

The discriminator holds end to end. `WorktreeHost.ts:964` echoes with an `undefined`-only guard, so an
empty-string branch survives the round trip as `""`; `WorktreeController.ts:700` tests `!== undefined`,
not truthiness; `createRepos()` (`:678`) preserves `""` into `answersBranch`; the dialog's own staleness
guard (`WorktreeCreateDialog.ts:567`) is likewise `!== undefined`. Load-bearing rather than edge-case:
`askForDestination()` runs inside `syncDerived()`, which runs at dialog construction
(`WorktreeCreateDialog.ts:519`), so **the first thing every open form sends is `branch: ""`**. If any hop
ever normalised `""` to absent, the form would stop receiving its own answers from the moment it opened —
which is what makes W9 worth recording.

The "unsolicited branch-less answer" case the rewritten test was written for is genuinely unreachable:
`WorktreeHost.ts:956` is the only site in the tree that posts `worktreeCreateDefaults`, and it always
echoes the request's branch. The only branch-less *request* is the controller's opening ask
(`WorktreeController.ts:525`). The test gained `branch: "feat/login"` rather than being weakened.

The shipping test's staging — a repository answering twice — is reachable in production: two door clicks
before the first answers, since `openCreateForRepo` replaces `pendingCreate` and re-posts to every target
with no modal yet mounted. Round 1 predicted exactly this user behaviour ("a second click on a button that
appears dead is the natural user response").

### B2 — verified fixed

`VaultPanel.createAvailable` initialises `false` (`VaultPanel.ts:215`); the only writer is
`onCreateAvailability` (`main.ts:1049`), invoked at `WorktreeController.ts:755` **after** `this.tree` is
assigned. `WorktreeController.mount` has one call site (`main.ts:1038`) — a single surface. `worktreeHasRepo`
now feeds only `resolveInitialView`, which is what it is honest for. `setVisible(true)` always posts
`requestWorktreeTree`, so the result is absence-until-first-tree, never permanent absence.

### W4 — verified fixed, and the early return cannot skip a needed write

`focusRow` assigns `this.focusedKey` **before** `row.focus()` (`WorktreeView.ts:1430-1431`) — that ordering
is what the fix rests on. Every writer of `focusedKey` also writes the stops (`syncRovingTabindex`, the
`focusin` delegate, `focusRow`), so the DOM can never disagree with the key. `render()` calls
`syncRovingTabindex()` before focus restoration (`:730-733`), and every `renderListing` path that returns
`undefined` — and therefore skips the sync — draws no `NAV_ROWS` at all. The pointer-press-after-render case
the author asked about is covered by that sync. Focus landing on a `.wt-rowaction` resolves through
`closest(NAV_ROWS)` to the same owning row, so `keyOf` returns the same key.

### W6 — the narrower fix is safe

`visible` initialises `false` (`:202`), so the `visible === this.visible` guard only suppresses a redundant
first `setVisible(false)` — when there is nothing to clear. A surface that never reports visibility never
transitions, so it keeps the ability to open a form. `frozenCreateOffer` is written only *after*
`openPendingCreate`'s early return, and abandoned host work lands in the `pending === null` branch where
B1's guard drops it — the two fixes compose. `dispose()` not clearing `pendingCreate` is unreachable:
`worktreeController` is a module-level singleton (`main.ts:351`) that is never disposed.

## Findings

### W8 — The header's new accessible name announces "1 worktrees"
- Severity: WARN | Confidence: HIGH | Priority: P3 | Agent: asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/worktreeTreeView.ts:239`
- Evidence: the W3 fix writes `header.setAttribute("aria-label", \`${repo.label}, ${count} worktrees\`)` with no
  plural handling. `count` is `visible.length` (`WorktreeView.ts:983`, `:993`) — the filtered count, which is
  the right one to announce and agrees with the `.wt-repo-count` badge beside it. A repository showing one
  worktree is announced "anywhere-terminal, 1 worktrees"; a degraded repo with none is announced "0 worktrees".
- Impact: a grammatical defect introduced by the round-1 fix, in the string the fix exists to produce, on the
  common single-checkout repository the change's own unbranched state targets. Screen-reader users only.
- SuggestedFix: `${count} worktree${count === 1 ? "" : "s"}`.
- Status: open | Triage: pending

### W9 — The open/update discriminator rides on structural optionality with no type enforcement
- Severity: WARN | Confidence: MEDIUM | Priority: P3 | Agent: asm-review-contracts + chair
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:700`, `:323`, `:525`; `src/types/messages.ts:775-783`, `:1802-1811`
- Evidence: `branch?: string` was introduced (round-3/round-4) so a form could tell a *stale* answer from a
  *current* one by comparing values. B1's fix now overloads the same optional key with a second, orthogonal
  meaning: presence vs absence distinguishes an *opening* ask from an *update* ask. Nothing in the type says
  so. Two producers exist today (`:323` sends it, `:525` omits it) and both happen to preserve the invariant.
  A future caller that "builds the request the same way every time" — defaulting `branch` to `""` rather than
  omitting the key — silently converts every opening ask into an update and reproduces B1, with the compiler
  accepting it. The inverse is worse: because an open form's first ask carries `branch: ""`, any normalisation
  that drops empty strings breaks the form's own destination updates from the moment it opens.
- Impact: the round-1 blocker is now prevented by a convention that neither the type system nor a test at the
  wire boundary enforces.
- SuggestedFix: add an explicit tag (`kind: "open" | "update"`) to the request/response pair and switch the
  check at `:700` to read it; or, minimally, a wire-level test asserting both shapes and a comment pinning the
  two call sites.
- Status: open | Triage: pending

### W10 — A create is dropped with no dialog and no notice when its repositories leave in the same push that brings others (persists from round 1 as S2, partially fixed)
- Severity: WARN | Confidence: HIGH | Priority: P4 | Agent: asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:721-727`, `:823`
- Evidence: round-1 S2's suggested fix had two halves — stop stamping `frozenCreateOffer` for a form that did
  not open, **and** surface a notice otherwise. Only the first half landed. `openPendingCreate` nulls
  `pendingCreate` at `:721`, then returns at `:725-727` when `createRepos()` is empty. On a two-repo workspace
  `{A,B}`: the toolbar `+` asks A and B; before either answers, a tree lands carrying `{C}` (a folder swap).
  `createDefaults` is pruned at `:799`, both outstanding ids are dropped at `:812-816`, `outstanding.size === 0`,
  and `createRepos()` returns `[]` because C was never asked. The click evaporates — no form, no notice — while
  the toolbar `+` stays visible because `C` makes availability true.
- Impact: the user's create intent is lost while the panel visibly still has a repository to create in.
  Recoverable only by clicking again, with no signal anything was dropped. (The `repos: []` variant of the same
  path is correct — there really is nothing to create in.)
- Evidence delta justifying escalation from round-1 SUGGEST: round 1 called this "reachable when `reconcile()`
  dropped the answers between the last reply and the open", which was hypothetical because `reconcile()` did not
  touch `pendingCreate` then. W1's fix makes `reconcile()` the completion path, so the scenario is now concrete
  and demonstrable rather than speculative.
- SuggestedFix: when the seed comes back empty but the arriving tree still holds repositories, re-issue the ask
  — rebuild `pendingCreate` from `next.repos`, drop `initialRepoId`, re-post. Failing that, emit an action-result
  notice so the drop is visible.
- Status: open | Triage: pending

### S6 — The reconcile-path form is seeded from the outgoing tree; the offer set is correct only by ordering
- Severity: SUGGEST | Confidence: HIGH | Priority: P5 | Agent: asm-review-logic + chair
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:750-751`, `:823`, `:661`
- Evidence: `handleTreeResponse` runs `this.reconcile(msg.tree)` **before** `this.tree = msg.tree`, so
  `openPendingCreate` → `createRepos()` reads the outgoing tree. The author's doubt was well placed, and the
  answer is that the *offer set* is nonetheless identical: `createRepos()` is the intersection of `this.tree.repos`
  and `this.createDefaults`, and the prune loop at `:799` has already cut `createDefaults` to the arriving repo
  set two blocks earlier in the same function. Old-but-not-new has had its answer deleted; new-but-not-old was
  never asked. What does leak is `repoLabel` and `mainPath`, copied off the outgoing record and rendered at
  `WorktreeCreateDialog.ts:235` and `:432`. `pathParent`/`pathPrefix`/`resolvedPath` come from the host answer,
  so no create can be misrouted. The subsequent `push()` cannot disturb the dialog: it is appended to
  `deps.host` (`#vault-panel`) while `render()` only calls `replaceChildren()` on the sibling `wt-tree` div, and
  focus restoration is gated on `this.element.contains(document.activeElement)`, which is false once
  `focusInitial(nameInput)` has run. No re-entrancy: `onBranchChange` goes out over `vscode.postMessage`.
- Impact: cosmetic staleness today. The structural point is that correctness here rests on the prune loop
  preceding the pending block inside one function, with nothing asserting that ordering.
- SuggestedFix: thread the arriving tree through — `openPendingCreate(pending, tree = this.tree)` with
  `createRepos(tree)` — so the reconcile call site passes `next` and the ordering stops being load-bearing.
  Assigning `this.tree` before `reconcile` is NOT the fix: `reconcile` needs the outgoing tree for `departed` labels.
- Status: open | Triage: pending

### S7 — The W7 stylesheet test reads only the first matching block, the shape this very file documents as a repeat escape
- Severity: SUGGEST | Confidence: HIGH | Priority: P5 | Agent: chair (frontend corroborated the brittleness)
- Class: machinery
- File: `src/webview/worktree/WorktreeView.test.ts` ("[W7] the control is revealed by focus, not by hover alone")
- Evidence: the new test does `css.match(/([^}]*)\{\s*visibility: visible;\s*\}/)` — the first such block in the
  file. The same file's own precedent at `:296-303` uses `matchAll` and carries the comment: "EVERY
  reduced-motion block, not the first. The file already holds two, and reading only one is the ASSUMPTION — not
  a missing special case — behind several of the escapes found across three review rounds." There is exactly one
  `visibility: visible` in `worktreePanel.css` today (`:1138`), so the test anchors correctly; a second one added
  above it would silently re-aim the assertion. It degrades to a loud false failure rather than a silent pass,
  which is why this is SUGGEST and not WARN.
- Impact: the rule is correctly pinned today and the source fix is right; the test will need rewriting the first
  time another reveal rule lands.
- SuggestedFix: collect every match with `matchAll` and assert the `.wt-rowaction` reveal is among them, matching
  the precedent 200 lines above it.
- Status: open | Triage: pending

### S8 — The W4 test pins `querySelectorAll` call count rather than tab-stop passes
- Severity: SUGGEST | Confidence: HIGH | Priority: P5 | Agent: chair + asm-review-frontend
- Class: machinery
- File: `src/webview/worktree/WorktreeView.test.ts` ("[W4] one arrow keypress writes the tab stops once, not twice")
- Evidence: the count of 2 is correct — `onKeyDown` calls `navRows()` once, `focusRow` once, and the delegate's
  third pass is what the fix removes. It catches both mutations that matter, including the subtle one: moving
  `this.focusedKey = this.keyOf(row)` to after `row.focus()` restores the third pass and fails the test. But the
  contract is "no more than one tab-stop pass per focus change", and the assertion is `toBe(2)` on a DOM-query
  counter — a legitimate refactor that caches `navRows()` across the keypress drops it to 1 and turns a green
  change red. `setRowTabStop`'s own per-row `.wt-rowaction` query is not counted (it runs on the row, not
  `view.element`), so the number is not the full DOM cost either.
- Impact: a correct pin in a shape that will fight the next refactor of the same code.
- SuggestedFix: `toBeLessThanOrEqual(2)`, which states the bound the fix actually establishes; or count
  `tabIndex` writes via an instrumented property descriptor to pin the real contract.
- Status: open | Triage: pending

### S4 — `repoAnchors` for an unbranched repo points at the empty-state block
- Severity: SUGGEST | Confidence: HIGH | Priority: P5 | Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeView.ts:840-847`, `:1044-1051`
- Evidence: unchanged since round 1. `this.repoAnchors.set(repo.repoId, last)` records `lastElementChild`, which
  for an unbranched repository is the `.vault-empty` CTA appended after the rows.
- Impact: a repo-scoped action notice with no drawn row lands after the CTA rather than beside the rows. Cosmetic.
- Status: open (persists from round 1, never triaged) | Triage: pending

### S5 — Every door now posts one host request per repository
- Severity: SUGGEST | Confidence: HIGH | Priority: P5 | Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:520-527`; `src/providers/WorktreeHost.ts:931-967`
- Evidence: unchanged mechanism, widened surface. W2's fix routes all four doors through the same fan-out, so a
  header `+` in an R-repo workspace now costs R round trips and 2R `suggestFreePath` resolutions instead of one.
  Cost is small and workspace-bounded: `suggestFreePath` (`createPath.ts:281`) exits on the first free candidate
  in the common case, and R is the number of git repositories in the opened workspace folders — structurally
  capped, not a growth axis. The real coupling is availability, not cost: the host answers only while the repo is
  in its cache (`WorktreeHost.ts:932`) with no error reply, so a repo the cache lost between its last push and the
  click stalls **every** door. W1's reconcile unjams it on the next tree push, and a second click replaces
  `pendingCreate` wholesale, so it is a lost click rather than a permanent jam.
- Impact: one lost click in a narrow window, on all four doors instead of one.
- SuggestedFix: batch the defaults request across repositories, keeping host-side resolution authoritative.
- Status: open (persists from round 1, never triaged; reachability widened by W2's fix) | Triage: pending

## Audit backlog (non-gating)

### S1 — Arrow and Home/End from a non-row control inside `role="tree"` teleport focus
- Carried forward from round 1 unchanged, at the author's triage. `.wt-empty-action` and the header `+` share the
  mechanism with the pre-existing "Show all" and notice Retry controls. Fixing it means deciding what arrows do
  for every non-row control in the tree — a contract this change does not own.
- File: `src/webview/worktree/WorktreeView.ts:1425-1450`
- Status: audit-backlog

### A1 — `applyCreateDefaults` is bound on dialog open and never unbound on close
- Severity: SUGGEST | Confidence: MEDIUM | Agent: asm-review-logic
- File: `src/webview/worktree/WorktreeController.ts:324-326`; `src/webview/worktree/WorktreeView.ts:444-451`
- Evidence: `bindDefaults` assigns `this.applyCreateDefaults = apply` and nothing sets it back to `null` — not
  `onSubmit`, not `onCancel`, not `closeDialog?.()`. B1's guard does not cover it: the leftovers here are the
  closed form's own last-keystroke asks, which DO carry a branch, so they take the `:701` branch and run
  `syncDerived()` against detached DOM. No user-visible misbehaviour; the closure pins one dismissed dialog's DOM
  until the next form opens.
- Disposition: **audit-backlog** — the binding at `:324` is unchanged code and the leak predates this diff. Recorded
  so it is visible, not gating.
- Status: audit-backlog

---

## Triage (author)

| ID | Status | Rationale |
|----|--------|-----------|
| W8 | accepted, fixed | "1 worktrees", in the line round 1 asked for, on exactly the single-checkout repository this change's own new state is about. |
| W9 | **listed, not fixed** | Correct and worth doing, and not here. The fix is an explicit `kind: "open" \| "update"` on the request and its answer, which means `src/types/messages.ts` and `src/providers/WorktreeHost.ts` — the host boundary, outside this change's lease and outside its stated must-not ("no new wire message"). Both producers are correct today and the chair confirms only one site posts the answer; the exposure is a future caller, not a live defect. Carried to the blueprint as a follow-up rather than bolted on at the end of a review cycle. |
| W10 | accepted, fixed | The half of round-1 S2 that did not land. W1's fix turned `reconcile` into a completion path, so the folder-swap drop is concrete: the panel now says nothing was attempted and names the repositories it was waiting on, using the `unavailable` outcome the spec already defines for exactly this. |
| S7 | accepted, fixed | I re-introduced the first-block-only shape this same file already paid for two hundred lines above. Now reads every matching block. |
| S8 | accepted, fixed | The cost contract is a bound, not an equality; `toBe(2)` would turn a row-list cache red. |
| S4 | listed | `repoAnchors` points at the CTA for an unbranched repo, so a repo-scoped notice lands after it rather than after a row. Cosmetic ordering, pre-existing mechanism. |
| S5 | listed | Per-repo fan-out on all four doors. Cost negligible and workspace-bounded; the real edge — one repo the host's cache lost stalling every door until the next tree push — is bounded by W1's reconcile, which now completes the ask when that repo leaves the tree. |
| S6 | listed | `createRepos()` reads the outgoing tree inside `reconcile`. The chair verified the offer SET is identical; what leaks is `repoLabel`/`mainPath` into the picker, and `resolvedPath` still comes from the host. Threading `next` through is the fix, and it is not a one-liner — `reconcile` needs the outgoing tree for `departed` labels. |
| S1 | audit-backlog | Carried unchanged from round 1: arrows from a non-row control inside `role="tree"`. Shared with the pre-existing "Show all" and notice Retry. |
| A1 | audit-backlog | `applyCreateDefaults` is bound on open and never unbound on close. Unchanged code, non-gating. |

**Cycle exit:** 0 gating blockers. No BLOCK was fixed or rebutted in this round, so the cycle ends at re-verify rather than opening round 3.
