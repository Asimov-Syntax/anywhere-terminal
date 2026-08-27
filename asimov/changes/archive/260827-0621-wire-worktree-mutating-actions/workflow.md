# Workflow State: wire-worktree-mutating-actions

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(round 4 = cycle 2 verification; BLOCK with 1 blocker + 8 warnings, all accepted and fixed by 9_1..9_6; user directed no further review round)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes
- Blueprint sync: `worktree-actions.md:349` corrected — a window-owned running pane produces a REFUSAL, not a confirmable block, so "Blocked until confirmed" claimed a confirmation path that does not exist. `worktree-rpc.md` § 2.1/2.2 rewritten to the shipped payloads (create's three exclusive branch shapes, remove's paired force+fingerprint, lock/unlock as two messages, prune's confirmedCount, defaults' branch echo, and the mutation result's five result kinds).
- Round-2 W3 flagged task 6_4's Plan for naming outbound messages that did not exist. They exist now and are documented above, so the Plan is left as written rather than rewritten after the tick.
- Round 4 returned BLOCK (1 blocker, 8 warnings, 1 suggestion) and confirmed all eight round-3 fixes. Triage in `.reviews/round-4.md`; every finding accepted, none rebutted.
- Thrash-stop condition 2 held and is recorded in that triage: the "every mutation states its outcome" invariant survived four fix attempts across both cycles. Option 3 (one bounded extension round) was taken; blockers had fallen 8 -> 1 and the diagnosis was concrete.
- Round 5 was NOT run: the user directed that the fixes land without a further review round.
- 9_6's assembly walk found a defect no review round had: `WorktreeView` never supplied the context menu's `prunableCount`, so it defaulted to `() => 0` and the Prune item could not render in production at all.
- Round-3 fixes (8_1..8_9) closed; Verify Gate re-run on the whole tree: 0 type errors, 4230 tests, biome check 0 errors / 13 warnings (all pre-existing, in files this change does not touch).
- 8_9 adds `src/extension.worktreeAssembly.test.ts`: one walk from a rendered menu item to git argv through the shipped host, router and capability wiring. Round 3's eight blockers were all composition defects no module test could see.

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-005.2
Lane: full (standard) — destructive git operations, user-supplied refs and paths reaching git, host-side blocker evaluation, a new mutating message family, and two manifest settings keys | flags: security-privacy, new-api-contract
Reference finding 1 — a blocker the accepted design does not have. `orca/src/main/worktree-removal-safety.ts:134-152` refuses to remove a worktree that CONTAINS another registered worktree, because `git worktree remove --force` treats the nested one as an ordinary untracked directory: it deletes the child's working files and leaves git holding a prunable child record. `worktree-actions.md` § 3.3's blocker table has no equivalent. Our exposure is narrower than orca's but real: rpc § 4 validation rejects a create path inside a LINKED worktree and the main worktree is unremovable, so nesting we create ourselves is already covered — but a worktree nested by hand, or by another tool, still lists and would still be destroyed. Candidate: a `containsWorktree` blocker, refused rather than confirmable, since no confirmation text can describe losing a worktree the user was not removing.
Reference finding 2 — timeout interacts with removal latency. `orca/src/main/worktree-trash.ts:1-3` records that `git worktree remove` on a real checkout (multi-GB `node_modules`) took 8-35s, which is why orca renames into a trash root and deletes afterwards. We deliberately do NOT take that approach — § 3.1 rule 3 delegates all deletion to git — but the measurement still applies to us: `worktree-model.md` § 6 sets a 10s git command timeout, so a normal removal of a large worktree would be killed mid-delete and land in § 3.6's `indeterminate` path as routine rather than exceptional. The timeout for removal needs to be its own value, not the listing's.
- Oracle pass returned 7 BLOCKs; all verified against code and accepted, one modified (integration
  tests scoped to cases where git's own behavior is the claim, not every destructive path).
- Two accepted-doc conflicts resolved and flagged for Blueprint Sync: `worktree-actions.md:349`
  says a busy agent is "blocked until confirmed" where `:191`, § 3.3 and shipped code all say
  refused (refused wins); `worktree-actions.md:132-134` requires a create path outside every
  worktree where `worktree-rpc.md:202` allows one inside main, which the default root needs
  (rpc wins).
- `worktreeRemove`'s inbound payload gains `fingerprint?` — `worktree-rpc.md:90` declares only
  `{ worktreeId, force }` while `:196` requires the fingerprint be validated.
- 1_3 deviation: the evidence/assessment types live in `worktreeBlockers.ts`, not `messages.ts` —
  nothing crosses the host↔webview boundary until 1_5 wires the dialog.
- 2_1 widened its Plan to lease `WorktreeHost.actions.test.ts`; the enumerated dispatch switch in
  `WorktreeHost.handleMessage` routed the three new types nowhere until the cases were added — the
  exact gap `WORKTREE_MESSAGE_TYPES` exists to catch.
- 2_2 resumed and completed: the host resolves WHICH worktree and delegates; the capability owns
  the journal, the git call and the classification, taking its forced rebuild from the 1_2
  coordinator. Earlier parked note superseded.
- **2_2 (superseded — now complete).** `gitCommandRunner` per-call timeout/signal, `removeWorktree`, and
  `classifyRemoval` are built and verified (21 tests, 3 mutations killed). Plan step 3 — the
  `WorktreeHost` integration: journal capture, forced rebuild after every attempt, quarantine when
  child termination cannot be confirmed — is NOT built. The task stays `[ ]`.
- **4_1 is PARKED, not complete.** Done and verified: the agent option removed from the create form
  (D9), `WorktreePruneDialog` built with its count-bearing confirmation (D13), and prune added to
  `WorktreeMenuActions` with `prunableCount` gating its presence. NOT done: Plan step 1
  (`WorktreeController` supplying the mutating capabilities) and step 5 (the removal confirmation's
  destroys/spares copy). The task stays `[ ]`.
- Three tasks declared suite changes (+7, +17, +14 assertions) plus 4_1's replacement of the create
  form's agent-picker case. All additions to exhaustiveness guards that must enumerate every
  declared message type, except the create-dialog case, which encoded the now-removed agent mode and
  was replaced by its negative. Review should read these as one set.
- Verify Gate: type check clean; 213 files / 4068 tests pass. Lint leaves 1 error + 13 warnings,
  all reproduced on a clean HEAD and confined to files this change does not touch —
  `SnapshotPersistence.ts`, `fileTreeRpc.integration.test.ts`, `VaultService.customName.test.ts`,
  `fileTreePanel.css`, `vaultPanel.css`. Every warning this change introduced was fixed.
- 5_1 found two defects no unit test could: `git worktree prune --dry-run --verbose` reports on
  STDERR, so `countPrunable` returned 0 for every repo and D13's confirmation would always have read
  "0 registrations"; and `describeGitFailure` takes stderr's first line, which for `worktree add` is
  git's progress output rather than its `fatal:` reason. Both fixed in `worktreeMutations.ts`.
- Round-1 fix loop: 6_1 and 6_2 ticked; 6_3 parked mid-task with the tree green — the service, the host's `mutationBindings`, and the id-based dispatch are in and tested, but `extension.ts` still supplies none of the five, because `evaluateRemoval` needs PaneFacts and ExternalSessionFacts the bindings do not yet expose. B1 is therefore reduced, not closed.
- Round 2 REJECT (6 blockers). B2/W1/W2 fixed; B1/B3/B4/B5 persist, B6/B7 new. All 7 accepted, none rebutted. Thrash stop: same invariant survived two attempts (B1, B4, B5), the B3 remediation created a POSIX bypass, and blockers went 5 -> 6. Handed back to asimov-plan rather than spending round 3 — what remains is design, not patching.
- 7_7 found the gap `WORKTREE_MESSAGE_TYPES` exists to catch, a second time: `requestWorktreeCreateDefaults` was handled in `handleAction` but never routed there by `handleMessage`, so the host answered nothing. Caught by the task's own test, not by review.
- 7_8 widened its Plan to the two 7_7 protocol files plus `worktreeViewTypes.ts`, `MessageRouter.ts` and `main.ts`: the outbound result needed the worktree scope its notice attaches to and the blocker set the confirmation is bound to, and the defaults message needed the branch prefix, or the form would have had to derive one. Create's base name is now the repo's own label so the placeholder and the destination describe one scheme.
- Verify Gate (round-2 fixes): type check clean; 215 files / 4157 tests pass. Lint unchanged from the recorded baseline — 1 error + 13 warnings, all in files this change does not touch.
- Re-plan after the round-2 handback: D14-D17 added, three spec deltas, tasks 7_1..7_8. The prune count needed no protocol — `WorktreeInfo.prunable` already carries it (D14). Fastlane auto-took Approve & build.
