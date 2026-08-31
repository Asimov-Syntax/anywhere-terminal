# Workflow State: report-what-was-checked-before-confirming

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [ ] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-013.4
Lane: full (M) — user-visible-ui; the report is the last thing between a click and an irrevocable delete | flags: user-visible-ui, new-api-contract, security-privacy
Planned at: 538217c2

Shipped baseline, established before planning: the context menu's `Remove Worktree…` posts an
UNFORCED `worktreeRemove` (WorktreeController.ts:181) and the host acts on it. Where nothing needs
confirming, the worktree is deleted on one click with no dialog anywhere — no webview dialog and no
native `showWarningMessage`. The ellipsis in the menu label promises a box that does not exist. So
this task is a safety fix, not a rendering improvement, and that is what set its scope.

Auto-decision (fastlane, no fork): implement `worktreeRemoveAssess` / `worktreeRemoveAssessment`
rather than driving the report from the existing blocked path. Not a real fork — the blocked path
is produced BY attempting the removal, so it structurally cannot report before deleting, which is
the requirement. The two messages are already documented in worktree-rpc.md § 2.5 and were simply
never implemented, so this implements an accepted contract rather than minting one.

Auto-decision (fastlane, D4): assess issues a fingerprint only where the blocked path already
issues one; an all-passed assessment confirms through the existing UNFORCED path carrying none. The
alternative — issue on every assess, for symmetry — was rejected without asking because it would
make "ask what this would cost" a deletion-authority door on a worktree where nothing was wrong.
Round-1 B2 and round-3 B2 of WT-012.16 were both exactly that mistake.

Escalation flags beyond the PLAN row's `user-visible-ui`: `new-api-contract` (two new wire messages)
and `security-privacy` (the path is irrevocable deletion). Recorded here because the PLAN task
carries neither and review scopes its roster from these.

Blueprint edit pending approval: docs/design/worktree-rpc.md § 2.5 documents `worktreeRemoveAssess`
and `worktreeRemoveAssessment` including a `branchDelete` field on the assessment. This change
implements both messages WITHOUT `branchDelete` — that offer is WT-013.3, which depends on this. The
doc currently describes a payload no code produces; it syncs to what ships on approval, and § 2.5
keeps the branch-delete field as WT-013.3's obligation rather than this change's.

Knowledge candidate: worktree-rpc.md § 2.5 documented two wire messages that no code implemented, and
nothing caught it | Surprise: the blueprint was read as authority for the removal wire during two
prior tasks, and the gap only surfaced when a task needed to SEND one of them | Evidence:
docs/design/worktree-rpc.md § 2.5 vs src/types/messages.ts (no such type) | Consumer: plan | Action:
when a task's Design Ref names a wire message, grep src/types/messages.ts for the type before
planning on it — a documented message is not an implemented one.

STOPPED BEFORE GATE 2 — NOT BUILT. WT-013.4 is already built on branch
`asimov/render-the-removal-assessment-as-a-report` (worktree
asimov/worktrees/render-the-removal-assessment-as-a-report, tip dab70c29, 15 commits off the same
cf4492aa base). Its 7 tasks are all `[x]`, its Verify Gate passed at 6014/6014, and it has run three
review rounds. It is PARKED on round-3 B1, which is a user scope decision, not a defect. This change
was planned without seeing it: my Stage 1 ran `change list` in THIS worktree, which cannot see a
change dir that lives on another branch. That is the real lesson here, not anything about removal.

Overlap is direct, not incidental. That change's tasks 1_1 and 1_2 are my 2_1 and 2_2: it already
drives the report from the assessment's own check list and already picks the confirmation control
from the classes the host sent (`WorktreeRemoveDialog.ts`, +416 lines there, untouched here). Its
1_5 through 1_7 then hardened the refusal path past anything this plan contemplated.

What is genuinely NOT built there is my part 1 and part 3 — assess before deleting, so a clean
worktree gets a report at all. And that is precisely their round-2/round-3 B1: "should removing a
CLEAN worktree ask for confirmation at all?". Their author rebutted it by rescoping the delta to the
control the dialog selects for an assessment it is GIVEN; the chair and the contracts specialist
OVERRULED that rebuttal. So the reviewer has already ruled that WT-013.4 owes the clean-removal path.
The two sessions reached the same finding independently from opposite ends.

Recommended disposition, for the user: do NOT run this change as written. Either fold parts 1 and 3
into that change as its B1 remedy (it is parked waiting for exactly this decision), or keep this
change and cut parts 2_1/2_2 to nothing. Duplicating the dialog rewrite on a second branch would
give two divergent implementations of one file that both have to merge into create-worktree-harden.

Oracle plan attack (asm-oracle, completed) — dispositions written against the ledger as-planned:
- Assessing removes nothing: SUPPORTED. `assessRemoval` reads only; orphan proofs are read-only.
- Assessing a clean worktree mints no force authority: SUPPORTED. `atRisk` and `checksFor` agree.
- A refusal offers no way through: SUPPORTED.
- The report cannot silently omit a check: SUPPORTED.
- The store does not grow without bound: SUPPORTED.
- Typing never unlocks a proof-gated option: UNRESOLVED — vacuous witness. This change carries no
  proof-gated control, so the proposed test cannot fail; it only becomes falsifiable under WT-013.3.
- A fingerprint issued at assess time cannot authorize a removal the user did not see: REFUTED.

The refutation is about SHIPPED code and outlives this change: `isIdentityPreservingSubset`
(worktreeBlockers.ts:35-36) compares the lock as a BOOLEAN, and the fingerprint digest
(worktreeFingerprint.ts:179-189) omits `lockReason` although `RemovalEvidence` carries it. So a
worktree locked for reason A, unlocked and relocked for reason B between report and confirm, redeems
a fingerprint the user earned against a lock that no longer exists. Second schedule, same shape: the
150 ms presence projection cap can leave a pane's rows stale while its agent has started running, and
redemption compares pane IDENTITY, not activity.

Two contract defects the oracle found in the plan itself, both real: (1) D1's "the contract is not
new" is false in detail — worktree-rpc.md § 2.5 declares `fingerprint` REQUIRED and carries
`branchDelete`, and has no `contained`; my interface made fingerprint optional and swapped the
fields. (2) D3 misreads an UNAVAILABLE assessment as a refusal: `checksFor({kind:"unavailable"})`
marks the whole catalogue unproven, refusal checks included, so the panel would mount no control at
all for a worktree it simply could not evaluate. The response shape erases the assessment kind, so
the panel cannot tell the two apart. Any revival of this plan fixes D3 first.
