# Review Round 7

- Date: 2026-08-27
- Cycle: 3
- Round: 7
- Mode: discovery
- Scope: range `b9633b1cd803bdb773819e53e5f857f5a1d7cc5c..c341fd8bf8a92b3abfa4fc5d2d877a4f3ddede91`
- Head: `c341fd8bf8a92b3abfa4fc5d2d877a4f3ddede91` (explicit range scope; checkout clean before persisting this round)
- Change context: `launch-agent-in-worktree` — Gate 2 approved; D10, D11, task 8_1, and the worktree-tree protocol requirements are accepted obligations
- Cycle context: discovery cycle required by round 6 after the unwatched-repository authority decision superseded cycle 2 verification
- Reviewable lines: 229 added lines across reviewable production/state files; tests reviewed inline
- Large-change note: not triggered
- Agents spawned:
  - asm-review-logic — launch identity, cache retention, watcher and async state — `gpt-5.6-sol[1M]`
  - asm-review-contracts — D10/D11, protocol and admission contracts — `gpt-5.6-terra[1M]`
  - asm-review-frontend — rendered identity capture and regression coverage — `sonnet[1M]`
  - asm-review-performance — cache traversal and rebuild costs — `gpt-5.6-luna[1M]`
  - asm-finder — full launch/resume/create and freshness flow trace — `gpt-5.6-luna[1M]`
- Agents skipped:
  - asm-review-data-security — no persistence, auth, secret, or new external-input boundary beyond the launch admission contract covered by logic/contracts
  - asm-review-reuse — no duplicated parser/encoder, mirrored helper family, or split requiring a separate reuse audit
- Verdict: BLOCK
- Counts: 1 BLOCK | 2 WARN | 0 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` exits 0 and records task 8_1 at exit 0. The author reports type check clean, 4,385 tests passing, and 10 Biome findings, all pre-existing in untouched files. No project type check, lint, or test command was run during review.
- D11 adjudication: allowing launch on a successfully listed but unwatched repository is accepted. Refusing every unwatched repository would leave watcher-less hosts with no launch capability and would not make the displayed tree fresher. The accepted boundary depends on the stale-data warning remaining truthful and visible; W8 identifies where the implementation currently loses or replaces that warning.

## Findings

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:524`
- title: Resume Here still captures replacement identity after the rendered-action boundary
- evidence: `resumeHere()` receives the row captured by the context-menu item but derives `generation` from mutable `this.tree` only when the item is clicked. `handleTreeResponse()` replaces `this.tree` before `WorktreeView.setData()`, while the render signature deliberately excludes `repo.generation`; therefore a generation-only re-list leaves an already-open menu and its rendered row intact but changes the value `generationOf()` returns. Opening the menu under generation A, receiving an otherwise identical tree under B, then clicking Resume Here posts B. The host admits the replacement because both the webview and host now read B, so its stale-quote refusal is never exercised. This is the same late-capture invariant as round-5 B5, moved from host receipt to the open-menu decision window.
- impact: A session can resume into a same-id replacement worktree that the displayed action was not raised against. The final handoff check proves only that the replacement remained stable after admission, not that it was the registration selected by the user.
- suggestedFix: Freeze `{worktreeId, generation}` when the Resume Here menu action is constructed/opened, then post only that frozen pair. Add a controller regression that opens the row menu under A, receives a generation-only B response, invokes the retained action, and asserts A is posted and refused by the host.
- status: open
- triage: persists from round 5. The wire field and host admission were added, but the identity is still read from mutable current state after the rendered-action boundary. Severity remains BLOCK because the same replacement handoff remains reachable; there is no evidence delta reducing impact.
- invariant: A worktree-scoped launch must carry the selected worktree identity across every asynchronous UI, transport, eligibility, and resolution boundary through final side-effect handoff.
- boundary inventory:
  - affected: Resume Here menu opened under generation A, followed by an identical re-list to B before the menu item is clicked
  - verified safe: a stale generation explicitly reaching the host is refused; Resume Here generation movement during session resolution is refused; fresh-launch dialog freezes its generation at dialog open; create-then-launch remains the approved separate boundary

### W8

- ID: W8
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:1473`
- title: Watcher degradation is lost or misclassified across rebuild paths
- evidence: `reconcileWatches()` applies `cache.markDegraded()` only after a whole-tree rebuild. A partially established watch can still deliver an event through a surviving subscription; that repo-scoped rebuild calls `cache.applyRepo()` at line 1481, which replaces the repo with a successful listing and clears `degraded`, but never reapplies the unchanged `watch.failureReason`. Conversely, when a whole-tree listing itself fails, the retained repo first holds that specific listing-failure reason and no generation, then `markDegraded()` at line 1529 overwrites it with the less-specific watcher annotation because `WorktreeCache.markDegraded()` unconditionally replaces `repo.degraded` at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:190`. This violates project invariant I8 and the project-plan acceptance that watcher or command failures remain labelled with source and reason, never silently stale.
- impact: An unwatched repository can retain launch authority after a repo-local rebuild while its only stale-data warning disappears; a retained failed listing can instead display only a future-watch warning and conceal that the current read failed. D11's accepted ceiling is then undisclosed or misdescribed even though authority itself remains fail-closed for retained listings.
- suggestedFix: Reapply watcher failure after every successful rebuild of the affected repo, including repo-scoped rebuilds, without overwriting a current listing failure. Prefer storing listing and watcher degradation as separate claims and composing display reasons; minimally preserve an existing listing reason and annotate successful applies from the persistent watch state. Cover partial-watch event -> repo rebuild and listing-failure + watcher-failure together.
- status: open
- triage: new in cycle 3 discovery. WARN because registration authority remains correct, but the user-visible freshness contract and D11's disclosure premise are broken.
- invariant: A known freshness failure remains labelled with its own source and reason for as long as it remains true; observation failure and future-watch failure are independent claims.
- boundary inventory:
  - affected: successful repo-scoped rebuild with a persistent partial watcher failure; whole-tree retained listing while the watcher also has a failure
  - verified safe: successful whole-tree listing followed by watcher annotation retains generation; retained listing publishes no generation; global git unavailability refuses launches and renders a global warning

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.test.ts:760`
- title: Exact boundary coverage remains split or implicit
- evidence: The create-form offer freeze now has an exact controller regression, and host tests manually prove stale launch/resume generations are refused. The controller Resume Here test still uses a tree with no generation and asserts a generation-less message, so it cannot catch B5's live-field capture. The unrelated-repository case is only a cache assertion that the sibling generation does not move, not a launch surviving that rebuild. The unwatched-repository launch case is exercised only incidentally because the assembly mock lacks `createFileSystemWatcher`; the test neither establishes nor asserts that the repo is degraded-but-tokened. These are the exact causal boundaries round-5 W6 requested after earlier green suites repeatedly missed cross-layer identity races.
- impact: The suite can remain green while Resume Here reads replacement identity after menu open, or while host admission becomes coupled to global rebuild state. D11's most controversial allowed path also depends on an unstated property of the assembly mock.
- suggestedFix: Add the B5 controller menu-open A -> generation-only B -> click test; add a multi-repo host launch held across a sibling rebuild; and make the watcher-less launch case explicit by asserting both the warning and retained generation/launch behavior. The cache sibling test remains useful but is not a substitute for host admission coverage.
- status: open
- triage: persists from round 5 with reduced scope. Create freeze, retained-listing refusal, and host stale-quote checks are now covered; Resume capture, sibling-host behavior, and explicit D11 watcher-less behavior remain unproven. Severity remains WARN.

## Fixed prior findings

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:97`
- title: A failed observation cannot mint registration authority
- evidence: A retained degraded apply now publishes no generation; global git unavailability is rejected by `launchTarget()`; successful recovery publishes a fresh generation. New and in-flight launches therefore both fail closed while registrations were not observed.
- impact: The prior path that authorized retained, unverified registrations is closed.
- suggestedFix: implemented by absence of generation on retained applies plus host fail-closed admission.
- status: fixed
- triage: fixed in `d9f3897`; D11 narrows only the separately observed-but-unwatched case and does not reopen retained authority.

### W7

- ID: W7
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:765`
- title: Launch admission carries one admitted lookup
- evidence: `admittedTarget()` returns path, worktree id, and generation as one object; the resolver uses that object; handoff performs one re-resolution. Fresh launch and Resume Here each perform one full-tree lookup at admission and one at handoff rather than five independently materialized reads. The performance specialist found no remaining data-scale issue for this user-triggered path.
- impact: The prior check/action split and repeated materialization are removed.
- suggestedFix: implemented.
- status: fixed
- triage: fixed in `d9f3897`; no evidence delta reopens it.

## Audit backlog

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeDialogShell.ts:38`
- title: Continue and worktree dialogs maintain parallel modal lifecycles
- evidence: The duplicated focus, Escape, disposal, and focus-restoration lifecycles predate this range.
- impact: Lifecycle fixes can drift between dialog families.
- suggestedFix: Consider a separate refactor that generalizes the worktree shell for Continue.
- status: audit-backlog
- triage: carried forward, non-gating

### AB1

- ID: AB1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:290`
- title: The prune dialog remains outside `closeDialog` ownership
- evidence: `openPruneDialog()` opens its dialog without assigning the returned disposer. This path predates and is outside the reviewed range.
- impact: A later dialog can stack over an open prune confirmation and leave its listener/focus trap mounted.
- suggestedFix: Address prune dialog ownership in the change that owns that pre-existing path.
- status: audit-backlog
- triage: carried forward, non-gating

### AB2

- ID: AB2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/LaunchBuilder.ts:234`
- title: Entry-backed Continue still ignores an explicit posture for a zero-choice agent
- evidence: `permissionArgs()` returns an empty list for an agent with no permission choices before consulting a supplied choice. This older Continue path is unchanged and outside the reviewed range.
- impact: The posture truthfulness rule is not universal across the older Continue path, but WT-005.3 did not introduce or worsen it.
- suggestedFix: In a change owning Continue admission, validate an explicit choice before the empty-choice fallback.
- status: audit-backlog
- triage: carried forward, non-gating

---

## Triage (author, round 7)

### [B5] Resume Here still captures replacement identity after the rendered-action boundary
**Status**: accepted
**Triage**: Correct, and my round-5 fix was wrong for a reason I wrote down myself and then did
not follow through. D10 deliberately keeps the generation OUT of the render signature, so a
generation-only update replaces `this.tree` without repainting. My fix read `this.tree` at click
and I commented it as "the tree the row was rendered from" — which is exactly what it is not,
in the one case that matters. The freeze has to happen when the menu is built, which is where
every other value the menu acts on is already captured.

### [W8] Watcher degradation is lost or misclassified across rebuild paths
**Status**: accepted
**Triage**: Both halves are mine, from introducing `markDegraded`. A repo-scoped rebuild clears
`degraded` and nothing restores the watcher claim; and where both are true, the watcher warning
overwrites the listing failure, describing a current failure as a future limitation. The cause
is storing two independent claims in one field — the same conflation round 6 made me split in
the first place, left half-done. They become two fields, composed for display.

### [W6] Exact boundary coverage remains split or implicit
**Status**: accepted
**Triage**: Fair on all three counts, and the resume fixture being generation-less is why my
own test could not have caught B5.

### Boundary
D11 upheld. The chair's condition — that it holds only while the panel truthfully discloses
staleness — is exactly what W8 threatens, so fixing W8 is what keeps D11 honest.
