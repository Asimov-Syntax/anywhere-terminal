# Review Round 1

- Date: 2026-09-03
- Target: make-the-create-dialog-explain-itself
- Scope: range `2d6a8436..4bd0bd98e3554fd99f685002cf802eea8e806988`
- Cycle: 1
- Mode: discovery
- Arbiter: no
- Head: `4bd0bd98e3554fd99f685002cf802eea8e806988` (tree dirty only from review analytics bookkeeping)
- Reviewable lines: 160
- Agents spawned: 4 (`asm-review-frontend`, `asm-review-logic`, `asm-review-contracts`, `asm-review-reuse`)
- Agents skipped: `asm-review-data-security` (no persistence, auth, secrets, or host-side authority changes); `asm-review-performance` (no growing collection, recomputation, or hot-path data work)
- Verdict: WARN
- Counts: BLOCK 0 | WARN 5 | SUGGEST 0
- Split over gating blockers: 0 feature | 0 machinery
- Verification evidence: `bun run asm change verify-status make-the-create-dialog-explain-itself` reports task `1_1` exit 0 and scope unchanged. The caller also reported type check, 7,558 tests, bundle, vendor, requires, size, and filesystem-deletion gates passing; Biome retains only the stated baseline findings.

## Risk map and full-flow trace

- Safe launch default: host-issued launch agents -> `safeAgentId` -> shared agent-box posture selection -> `WorktreeCreateDraft` -> controller's existing discriminated `afterCreate` message -> host-side frozen-offer resolution. No wire or host-authority bypass found.
- Disabled submit: branch/ref validation, host selection/resolution state, destination/debris authorization, base verdict, and posture selection -> one `blockedBy` value -> button state plus accessible description. Predicate parity is intact; test coverage is incomplete (F004).
- Destructive debris flow: host-issued occupied candidate -> unchecked clear checkbox -> debris assessment/authorization -> settled disposition -> existing host validation. The label changed; authorization and reset behavior remain intact.
- Consequence hints: after-create action and its agent/folder sub-selection -> synchronous hint refresh. The update path is live, but two statements can contradict the actual selected state/mode (F002, F003).

## Findings

### F001

- ID: F001
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-reuse, chair
- class: feature
- file: src/webview/worktree/WorktreeCreateDialog.ts:191
- title: The safe-posture policy now has two independent implementations
- evidence: `safeAgentId` independently decides that an agent is safe when any permission choice satisfies `!choice.dangerous`. `worktreeAgentBox.ts:53-55` already owns the same policy in `initialPosture`, which selects the posture the shared launch control will actually submit. The dialog copy decides whether agent mode is selected, while the box copy decides whether that mode has a posture.
- impact: A later change to what counts as explicit safe evidence can update one site without the other, allowing the dialog default and the submitted posture behavior to diverge on a security-sensitive default.
- suggestedFix: Keep the safety predicate beside `initialPosture` and expose one cohesive helper for the first agent with an initial safe posture; use that helper from the create dialog.
- status: accepted
- triage: ACCEPTED. This is behavioral duplication, not an extraction preference: the two copies jointly enforce the same no-dangerous-default invariant at different halves of one flow.
- outcome: fixed — `initialSafeAgentId` now owns both default eligibility and initial posture selection.

### F002

- ID: F002
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- class: feature
- file: src/webview/worktree/WorktreeCreateDialog.ts:1866
- title: The agent consequence sentence claims permissions are selected when none are
- evidence: The agent hint always says the launch uses “the selected permissions.” A no-axis agent has `permissionChoices: []`, so the permission control is absent and `needsPosture()` is false. A dangerous-only agent initially has an unselected placeholder and the button is correctly gated. In both reachable agent-mode states, `agentBox.read().permissionChoiceId` is undefined while the hint claims a selected posture exists.
- impact: The dialog presents contradictory security information precisely where this change is meant to explain launch consequences. The gate still prevents the dangerous-only launch, so this does not bypass authority, but the visible explanation is false.
- suggestedFix: Let the permission control and disabled reason own posture selection. Make the consequence sentence say only that the selected agent starts in the worktree, or branch the wording on an actually selected posture and omit the permission claim for no-axis agents.
- status: accepted
- triage: ACCEPTED. The specialist's broader repository-switch warning was not sustained because the accepted D2 contract preserves an offered agent id and production currently stamps one launch-agent list into every repository; the independently reachable false hint remains.
- outcome: fixed — the consequence names only the selected agent and worktree; the permission control and disabled reason own posture state.

### F003

- ID: F003
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file: src/webview/worktree/WorktreeCreateDialog.ts:1857
- title: Consequence hints call repaired and adopted destinations new
- evidence: Terminal and agent hints say “the new worktree,” and the add-to-workspace hint says “the new folder.” The same dialog supports `reattach` and `adopt`, whose targets are existing on-disk checkouts/paths. In those modes the mode note explains repair or re-registration while the newly added consequence sentence simultaneously describes a new worktree or folder. Accepted D1 deliberately used “the created worktree” and did not require a “new folder” claim.
- impact: Users repairing or adopting a surviving checkout receive conflicting descriptions of whether a new destination is being created, weakening the change's central truthfulness goal.
- suggestedFix: Use mode-neutral wording such as “the worktree” and “its folder,” or the accepted D1 phrase “the created worktree,” across terminal, agent, and folder hints.
- status: accepted
- triage: ACCEPTED. This is reachable through existing reattach/adopt modes and conflicts with the adjacent host-derived mode statement.
- outcome: fixed — terminal, agent, and folder hints now use mode-neutral worktree wording, including an adopt witness.

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- class: feature
- file: src/webview/worktree/WorktreeCreateDialog.test.ts:165
- title: The disabled-reason test does not witness the complete gate inventory
- evidence: D3 and its accepted obligation ledger require the reason and disabled state to be exercised for each priority arm. The changed tests assert the initial missing branch, validation, unasked selection, resolution classification, debris assessment, invalid base, and missing posture, but do not assert the new reason for an absent destination or a stale/outstanding destination, and do not establish the full priority matrix in one table. The test named as distinguishing classification from a missing destination never reaches the `Waiting for a destination.` branch.
- impact: The central “same predicates, one reason” invariant can drift for untested async destination states while the suite remains green, leaving Create correctly disabled but inaccurately explained.
- suggestedFix: Add a table-driven gate test that constructs every `blockedBy` arm, asserts the exact first reason, button disabled state, `aria-describedby`, and the enabled/hidden terminal state.
- status: accepted
- triage: ACCEPTED. Runtime inspection found predicate parity today; the warning is the missing accepted witness that protects that parity.
- outcome: fixed — one parameterized inventory now exercises every priority arm plus the enabled terminal state and accessibility association.

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- class: feature
- file: src/extension.worktreeAssembly.test.ts:1696
- title: The short-viewport regression test checks CSS text, not visibility
- evidence: The test title claims the create actions remain visible in a short scrolling dialog, but it only regex-matches a `.wt-dialog-actions` rule containing `position: sticky` and `bottom:`. It creates no short viewport, renders no dialog, and does not observe the action row. The assertion still passes if a container/override/layout change makes the footer scroll away despite those declarations.
- impact: The accepted short-viewport risk mitigation has no behavioral witness, so the Create action can regress below the fold without failing the test that claims to protect it.
- suggestedFix: Exercise a rendered dialog in a constrained-height browser/layout fixture and assert the action row remains within the dialog viewport after scrolling. If the current DOM test environment cannot compute layout, move this witness to the smallest browser-capable lane instead of naming a source regex as visibility proof.
- status: accepted
- triage: ACCEPTED. The CSS appears directionally correct; this warning is about the promised regression witness, not styling preference.
- outcome: deferred — removed the source-regex test that falsely claimed visibility; `prove-create-footer-in-browser` owns the portable browser-layout witness because this repository has no such lane.

## Specialist adjudication

- `asm-review-frontend`: one repository-switch/unknown-posture warning. The switch portion was refuted by the accepted D2 preservation rule and the production `createRepos()` invariant that shares one launch-agent list across repositories. Its false “selected permissions” evidence survives as F002.
- `asm-review-logic`: no findings.
- `asm-review-contracts`: no findings; confirmed wire shapes and host-held authority are unchanged.
- `asm-review-reuse`: one safe-policy duplication warning, sustained as F001.

## Audit backlog

None.
