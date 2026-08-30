# Workflow State: prove-nobody-is-using-this-worktree

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; worktree-removal.md § 4.1 names a source for every proof and the ladder for the one that needed it
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(re-earned after the round-1 B2 handback amended D3)_ (fastlane)

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-013.2`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

- Round 1 closed with a HANDBACK, not an exit. B1, B3(b) and W2 are fixed and committed as task 4_1. B2, B3(a) and W1 are accepted and parked: all three turn on one question the accepted design answers two ways — what the producer derives from the single registry scan, and what reaches `evaluateRemoval`. D3 says both "the removal producer ... derives both the live external evidence and the ownership proof from them" AND "`evaluateRemoval` filters the live ones where it used to be handed them", and 2_1's Boundary ("no change to what refuses") is broken by the second reading. Every correct fix needs selection metadata `SessionRecord` deliberately omits, or a second derived list beside the raw records; either changes D3's published interface. Per the remediation boundary that is an artifact handback, and per fastlane it is never auto-chosen.
- The parked defects are fail-safe in the tree as it stands, which is why leaving them parked is not shipping a hazard: B2 makes a removal refuse MORE often, B3(a) costs resolution work, and W1's wrong answer lands only in `ownerGone`, which gates nothing until WT-013.3 produces the offer. None of them can authorize a destructive action today.
- My own round-1 triage error, recorded because it is the reason B2 nearly closed as a rebuttal: I rebutted the same finding when `asm-review-reuse` raised it out of band, reasoning entirely inside the NEW algorithm. The old code deduped with `winsDedupe` across every live record user-wide BEFORE any caller applied containment, so the winner was global. Checking the order, not just the membership, was the step I skipped.
- Round-1 out-of-band from `asm-review-reuse` (WARN HIGH P2, arrived before the chair's report; to be triaged in the round file when it lands). Claim: `dedupeBySessionId` keeps the first record while `winsDedupe` picks interactive-over-headless then newest startedAt then highest pid, so duplicates could select a different cwd/pid. Verified and REBUTTING as filed: `SessionRecord` carries neither pid nor startedAt, so `winsDedupe`'s keys do not exist here; `cwd` and `entryId` are consumed in the filter that runs BEFORE the dedupe, so the winner cannot change membership; after the dedupe only `sessionId` (identical by construction) and `activity` are read. The two rules answer different questions — `winsDedupe` picks the record that best DESCRIBES a session for the presence panel, this needs a set of ids — which is why 1_1's reader is deliberately undeduped. ACCEPTING a narrower residual: `activity` is read off an arbitrary winner. Unreachable today (extension.ts sets it `undefined` for every record) but the type admits disagreement and `activity !== "idle"` decides refusal. Fix is this module's own safe-side rule, not `winsDedupe`: where records for one session id disagree, keep the one that refuses. Held until the chair's Head is recorded.
- Verify Gate lint: `pnpm exec biome check src` exits 1 on 3 pre-existing format errors in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts` and `src/cursor/CursorHookInstaller.test.ts` — the recorded baseline for this branch, none of them touched by this change. 14 warnings, also the baseline.

- 3_2: D1 says the proofs are reported from the `confirmable` branch only. They ARE absent from `refused`, which is what D1's reason argues for. They are NOT filtered out of `unavailable`: that branch reports the whole catalogue unproven, an unproven proof claims nothing, and filtering would make the check list differ by outcome — the failure D1's one-row-per-id table exists to prevent.
- 3_2: `src/webview/worktree/WorktreeRemoveDialog.ts` added to the Plan paths. WT-013.1's guard withholds Force whenever ANY check is unproven, and three routinely-unproven proofs in every confirmable report silently withheld it from every removal — caught by the assembly test, not by removalChecks. Scoped to non-proof checks: the guard is about a risk the dialog could not describe, and withholding force over a proof IS a proof refusing a removal (§ 2.2, D2, and the proposal's Must-not). Remediation inside the accepted contract, not a new decision.
- 3_2: `src/providers/WorktreeHost.ts` added to the Plan paths. It supplies three `unproven` outcomes so the tree compiles; 3_3 replaces the constant with the reader.
<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-013.2
Lane: full (standard) — three read-only proofs feeding the one irreversible action, and a shared registry reader four call sites depend on | flags: security-privacy
Planned at: f289f31f

Validator warning triaged and rejected: "Task 2_1 Plan names 9 files — split it". Six of the nine are test fixtures following one type rename (`ExternalSessionFact` → `SessionRecord`, gaining `alive`). A rename does not survive being split — the tree does not compile between the halves — so splitting it would trade a sizing heuristic for a broken intermediate commit. The three files carrying actual logic are `worktreeBlockers.ts`, `WorktreeHost.ts` and `extension.ts`.

Probed rather than assumed, before designing around them (git 2.50.1, the lesson from the previous change's round-1 B3): `git worktree lock` writes the `locked` file with or without a reason — zero bytes when there is none — so its presence tracks the lock and its mtime is the age; `merge-base --is-ancestor` exits 0 for merged, 1 for not, and 128 for a bad ref, so only the first two mean anything; `symbolic-ref --short refs/remotes/origin/HEAD` exits 128 when no origin HEAD exists; `rev-parse --verify --quiet refs/heads/<name>` exits 1 for absent and 0 for present.

Carried in from WT-013.1 round 5 and NOT folded into this change: an `lstat` that outlives its deadline is abandoned rather than cancelled, and nothing dedupes abandoned reads across assessments. The lock proof adds one bounded stat of one small file, and only when the worktree is locked, so it does not change that finding's mechanism — but it is one more read a stalled mount could strand. Fixing it would mint the invariant owner the finding needs, which is a change of its own. It stays open and unwaived.

Blueprint extension to carry at sync: `worktree-removal.md` § 4.1 leaves the `notApplicable` column blank for `branchMerged`, which the code cannot honour — a detached or bare worktree has no branch for the question to be about, and `unproven` would claim a comparison was attempted (design.md D5).

Ordering deviation on 1_2: I staged and committed the task before its tick, in the same shell block as the verify that was still failing. The verify then failed on the suite guard — `runningSessions.test.ts`, which is 1_1's committed addition, since the comparison runs against the change baseline and not the previous task's commit — so nothing unverified reached the tree, but the commit did land ahead of the evidence. The tick and its rationale are recorded now, and the commit is unchanged. Run the verify to completion before staging.

- Round-1 handback resolved, and my parking of it was too wide. W1's own triage already said "Inside 1_1's accepted contract; touches no D#" — it is remediation and never needed a plan cycle; I parked it alongside B2 by association. Only B2 and B3(a) turned on the D3 reading.
- D3 amended for B2 and Gate 2 re-earned under fastlane. The fork was between two readings of an INTERNAL seam — what the producer derives and what reaches `evaluateRemoval` — with no spec delta and no user-visible behaviour either way, so it is not the product-scope fork fastlane withholds. Chosen: keep `winsDedupe` in its one home and export a pure derivation over records already in hand, so the single scan yields both views. Rejected: widening `SessionRecord` with selection metadata, which would copy the rule into a second module.

- `Blueprint:` was scaffolded `none` while the very next line's template text already named WT-013.2, and the round-1 handback is the first moment anything read the field. Corrected to the PLAN task, so blueprint sync runs against a real owner instead of being ticked away as having none.
