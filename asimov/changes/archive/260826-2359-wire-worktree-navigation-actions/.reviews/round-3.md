# Review Round 3

- Date: 2026-08-27
- Cycle: 1
- Round: 3
- Mode: verification
- Scope: working tree — accepted round-2 fixes plus behavioral impact cone
- Review base: tree `2940321dc8332df4b0cf95344a242e331308bd1a`
- Review head: tree `923f8dd393be57cd7d00e22d75f04a44214357f6`
- Reviewable lines: 199
- Scope lock: passed — tasks 7_1, 7_2, and 7_3 are remediation for accepted B2/B4/W2; shared tab switching, every Vault affordance owner, all init producers, and retry callers are within the declared impact cone
- Agents spawned:
  - asm-review-logic — rootless tab display, action gating, init ordering, and retry/error paths — gpt-5.6-sol[1M]
  - asm-review-frontend — pane visibility, Vault affordance inventory, preview behavior, and surface defaults — gpt-5.6-terra[1M]
  - asm-review-contracts — display helper contract, required init field, cross-provider parity, and automatic watch semantics — sonnet[1M]
- Agents skipped:
  - asm-review-data-security — no new identity, input-validation, authorization, secret, or storage boundary in this remediation
  - asm-review-performance — tab resolution is user-triggered and bounded by open panes; Vault capability state is one boolean; no collection growth or full-history recompute
  - asm-review-reuse — the new helper is one cohesive extraction used by both shared tab switching and worktree activation; no competing implementation was introduced
- Verdict: WARN
- Counts: BLOCK 0 | WARN 1 | SUGGEST 1
- Verification: chair-observed `pnpm run check-types`, 112 focused tests across 8 remediation suites, and the complete 204-file / 3926-test unit suite passed. `pnpm exec biome check src/` completed with the same 13 warnings in untouched baseline files and no fixes applied. The exact remediation diff passes `git diff --check`.
- Cycle note: this is cycle 1's third and final verification round. Another user-initiated review after remediation starts cycle 2 in discovery mode.

## Prior finding verification

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/split/tabDisplay.ts:36
- title: Valid panes in rootless split tabs still cannot be activated
- evidence: `resolveTabDisplayPane` prefers the tab's original pane while live and otherwise resolves the first live leaf from the retained layout. `switchTab` now gates on that result, reveals the split container without requiring `terminals[tabId]`, and fits/focuses through the resolved leaf. `activatePane` checks whether the tab is displayable, sets the requested target as active before showing it, and then focuses that target. Tests cover ordinary roots, root preference, rootless retained leaves, layout order, no-live-leaf failure, and the worktree activation handoff.
- impact: A host-resolved pane in a tab whose original root pane was closed is now brought forward and activated in its actual surface.
- suggestedFix: None for B2's accepted worktree activation invariant.
- status: fixed
- triage: Accepted in round 2; verified fixed across ordinary split, rootless split, tab display, active-pane, fit/focus, and no-live-leaf boundaries.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.ts:239
- title: Editor preview support exposes a Vault list whose other controls are all inert
- evidence: Every init payload now declares whether its surface can perform Vault actions: sidebar/panel true, editor false. That value reaches the whole UI inventory. On a read-only editor surface the context menu is not mounted, row Resume is absent, list and preview rename are absent, preview-header Resume is absent, metadata Continue is absent, and timeline Raw/Continue are omitted while clipboard-local Markdown/JSON copy remains. The preview still opens and its list/detail/load-more reads still work. Positive tests prove action-capable surfaces retain their prior controls.
- impact: Populating the editor Vault list no longer exposes any visible operation that its provider drops.
- suggestedFix: None. A single boolean is the correct current shape because production surfaces are all-actions or zero-actions; introduce a capability set only when a real partial surface exists.
- status: fixed
- triage: Accepted in round 2; verified fixed at list row, context menu, inline rename, preview header, metadata body, timeline actions, and positive sidebar/panel boundaries.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.ts:1549
- title: Cold-created surfaces can still lose a row-activation update during init
- evidence: Both cold-create branches now await `safeSendWithRetry(init)` and post the current activation only after successful delivery, matching the reload and snapshot-restore branches. The regression fails the first init attempt specifically, observes the retry, and proves activation lands after the last init attempt. The helper's retry count, delays, abort semantics, and boolean result are unchanged.
- impact: Configuration updates can no longer overtake cold init and disappear before the worktree controller exists.
- suggestedFix: None for production ordering. W3 records the remaining cross-provider regression-test gap.
- status: fixed
- triage: Accepted in round 2; verified fixed in both provider implementations and mutation-checked on the view-provider retry path.

## Current findings

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalEditorProvider.ts:1059
- title: The editor half of the cold-init ordering fix has no regression test
- evidence: Round-2 W2 named both providers. Production now awaits init and posts activation afterward in both, but the failed-first-init ordering regression exists only in `TerminalViewProvider.worktree.test.ts`. No editor-provider test fails an init attempt and proves `worktreeRowActivation` lands after the successful retry. The implementations have separate message loops, `safeSendWithRetry` methods, and construction harnesses, so one test does not mechanically constrain the other.
- impact: A future editor-only refactor can reintroduce the accepted W2 race while the sidebar/panel regression remains green — the same cross-surface drift class this change is intended to close.
- suggestedFix: Port the cold-init retry-ordering case to `TerminalEditorProvider`'s onReady test harness: fail the first `init` attempt by message type, let the retry succeed, and assert the activation post follows the successful init attempt.
- status: open
- triage: pending

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-contracts
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/types/messages.ts:975
- title: The Vault capability contract says watch is gated, but preview watch traffic is exempt
- evidence: `vaultActionsAvailable` documents `watch` among the governed actions, while `PreviewController` posts `vaultWatchSession` unconditionally on open and close. An editor provider drops those messages. This creates no inert control and no visible current failure, but the declared all-or-nothing contract and actual lifecycle exemption disagree.
- impact: Future readers or partial capability work can incorrectly assume `false` suppresses all Vault action traffic; editor previews also perform two known no-op posts per lifecycle.
- suggestedFix: Prefer narrowing the field's documentation to define it as availability of user-facing Vault controls and explicitly exempt automatic live-follow lifecycle traffic. Alternatively gate watch if static editor previews are the intended contract.
- status: open
- triage: pending

## Adjudication notes

- Logic and frontend reviewers found no production defects in B2, B4, or W2. The chair's full-flow traces agree: target pane entry → retained layout → display leaf → active target → surface show/focus; editor preview entry → read-only list/detail → capability-gated affordances; cold ready → retried init → current activation.
- W3 is retained as a support WARN under Phase 2.5: the production code is correct, but the accepted invariant explicitly spans two independently implemented providers and only one is regression-pinned.
- The specialist's watch finding is downgraded from WARN to SUGGEST because its evidence shows no visible current defect: `vaultWatchSession` is automatic preview lifecycle traffic, not an offered control, and the initial/read-more preview contract remains functional. The contract wording should still match that deliberate exemption.
- Leaving editor `vaultWatchSession` unhandled is outside B4's absent-control invariant. It degrades live follow invisibly but does not make the offered preview or any rendered control inert.
- The boolean capability shape is accepted. An enum/set now would encode no production distinction; the existing finer entry-level gates compose correctly with the surface-level all-or-none fact.
- B1, B3, and W1 remain fixed; no changed behavior reactivated them.
- No audit-backlog or accepted-risk entries apply.

---

## Triage (author, round 3)

### [W3] The editor half of the cold-init ordering fix has no regression test
- **Status**: accepted
- **Triage**: Correct, and it is the same class of gap this whole change exists to close. I fixed
  the ordering in both providers but pinned it in only one, and the editor provider has its own
  message loop, its own `safeSendWithRetry`, and its own construction harness — so
  `TerminalViewProvider.worktree.test.ts` constrains none of it. An editor-only refactor could
  reintroduce W2 with every sidebar and panel test still green. Fixed as task 8_1 rather than
  carried as a warning: the test is cheap and the drift it prevents is exactly what round 2 caught
  me on twice (B1b, B4).

### [S1] The capability contract says watch is gated, but preview watch traffic is exempt
- **Status**: accepted
- **Triage**: The chair sustains my round-3 reading that ungated `vaultWatchSession` is not a B4
  failure — it is automatic lifecycle traffic, not an offered control. What is wrong is my own
  documentation: the `vaultActionsAvailable` doc comment lists `watch` among the governed actions
  while `PreviewController` posts it unconditionally, so the comment overclaims what the flag
  covers. Taking the documentation fix, not the gating alternative: gating watch would make the
  editor preview static for no user-visible gain, and the flag's real scope is user-facing controls.
  Fixed as task 8_2.

### Cycle exit
Zero gating blockers: every BLOCK across rounds 1-3 is fixed and verified by the chair. The two
findings above are non-gating and are being closed anyway because both are trivial. No further
review round is requested — per the chair, another review would open cycle 2 in discovery mode,
and there is no new discovery to justify it.
