# Workflow State: surface-subagent-history-rows

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no real fork — see Notes)_ _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(re-earned after the round-1 handback)_

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(3 rounds, cycle 1: round 1 REJECT 5B+1W, round 2 REJECT 3B+1W, round 3 WARN — 0 gating blockers; every finding accepted and fixed, none rebutted, no accepted risk)_
- [x] Gate: implementation approved _(fastlane)_
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-004.3
Lane: full (small) — adds a request/response pair to the worktree protocol and spans host reader, projector seam and webview | flags: new-api-contract, cross-boundary
Fastlane: no Gate 1 fork — § 3.6 settles the mechanism (lazy on expansion, never live, one level, children inherit parent freshness); the only open calls were protocol shape and where the roster lives, both settled in design.
Oracle pass: 2 BLOCKs + 5 WARNs, all accepted. D5 now claims incompleteness from three signals (a >5000-item transcript reports `truncated`, not `partial`, and at the maximum limit nothing larger recovers it); D6 maps the plain `subagent` item too, since an unmatched Task call never becomes a `subagentSession`; D11 is new — § 3.6 mandates the decay and the existing renderer inherits only the parent's AGE. Tasks gained 1_3 (a failed OpenCode child query silently substituted an empty child list), the render-signature consumer 1_1 had missed, and the extension construction order 2_2 needs.
Deviation from blueprint: worktree-rpc.md § 3 specifies a `worktreeSubagentsResponse` and § 6 answers a row with no entry id with an empty list. The roster rides the tree+presence envelope instead (design.md D2), and an empty list is never the answer to an unread roster; both sections are updated at blueprint sync.
Replan: B2 is fixed at the OpenCode READER, not the mapper — measured against a real store, part rows are head+tail windowed while the child query is not, so a session with four delegations surfaced four child stubs and one surviving subtask part; a mapper de-duplicating by name would collapse four real delegations into one. The reader change also fixes the same duplicate in the preview overlay, which shares the detail contract. D12 records that this change carries its own two-case routing forward rather than shipping inert while wire-worktree-navigation-actions lands the durable fix.
Round 1: REJECT — 5 BLOCK + 1 WARN, all accepted. B2 and B5 falsify accepted design (D6 assumes the two delegation item kinds cannot double-count; OpenCode emits both, uncorrelated. D5 claims three signals cover source omission; the OpenCode child query is a fourth, unprobed path), so the round is an artifact handback, not a fix round.
B1 was found in this session before the report and is the same defect WT-005.1 D1 is built on: neither provider forwards `requestWorktreeSubagents` — `TerminalViewProvider.ts:1282` and `TerminalEditorProvider.ts:639` enumerate `requestWorktreeTree` / `worktreeViewVisibility` only, so the request never reaches the host and the feature is inert end to end. Unit tests could not see it: they exercise the host and the view separately and nothing crosses the provider seam.
Verify gate: lint reports 13 pre-existing findings, all reproduced on a clean `HEAD` worktree and all in files this change does not touch (SnapshotPersistence.ts, fileTreeRpc.integration.test.ts, VaultService.customName.test.ts, fileTreePanel.css, vaultPanel.css).
Round-1 fixes: 4_1 correlates OpenCode subtask parts to child stubs (description-then-agent, consumed one-for-one) so one delegation is one item; 4_2 probes the child bound and derives `subagentCount` from the correlation; 4_3 `title ?? prompt`; 4_4 orders the section state by the roster's claim and reconciles the view's asked/expanded sets; 4_5 forwards the request from both surfaces.
Round 2: REJECT — 3 BLOCK + 1 WARN, all introduced by the round-1 remediation and all accepted; none falsified accepted design, so all five were fixable within contract as tasks 5_1 (B6/B7/B8, one lease) and 5_2 (W2). B6 the correlation ran its agent fallback per-subtask, letting an earlier same-agent delegation consume a later one's exact child; B7 a failed child probe claimed confirmed omission even for a list short enough to prove itself whole, and PreviewController.ts:449 discards every partial nested detail; B8 the declared count at the bound stated less than the probe proved.
Round 3: WARN, 0 blocking — cycle 1 exits clean. B6/B7/B8/W2 verified fixed; W3 (a failed read reported as "Session not found.") accepted and fixed as 6_1. The chair confirmed the two rewritten probe tests are contract movement, not weakened coverage, and that `>= CHILD_LIMIT` is correct.
Blueprint sync: worktree-rpc.md drops `worktreeSubagentsResponse` and states why the roster rides the tree+presence envelope (D2), plus three corrected edge cases; worktree-agent-presence.md § 2 carries `DelegationRoster` and § 3.6 the two rules round 1 established; worktree-panel-ui.md § 3.3/§ 3.5 fix the chevron rule (offered by the session, not by children already held) and § 3.4 gains the four section states; vault-readers.md § 7 and § 11 carry the probe, correlation and count rules, since the OpenCode detail contract is shared with the preview overlay. PLAN WT-004.3 -> done.
Review chair: resume:ad0b9e6caba7a68a2 (rounds 2 and 3).
Deferred: § 3.4's child activation (focus the parent's pane) is left unwired — WT-005.1 owns row activation, and wiring a focus target here would duplicate it.
