# Workflow State: coalesce-assessment-requests-at-the-host

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

Blueprint: none — this change was minted by the remediation boundary, not by a PLAN task. It is the
child of `render-the-removal-assessment-as-a-report` (docs/PLAN.md WT-013.4), which is PARKED
complete-but-unapproved and DEPENDS on this one: its round-6 B5 and W6 are this change's whole
subject. docs/PLAN.md was deliberately not edited — minting a task there needs the user.
Lane: full (standard) — MEDIUM risk | flags: security-privacy (the assessment is the read that mints
force authority for an irrevocable deletion), new-api-contract (`WorktreeSurface` gains `postCritical`)
Planned at: a72bc499
- Owner test run at Stage 1 and it lands on `own change`, both signals of the remediation boundary:
  the remedy needs a semantically changed `D#` (the parent's accepted D10 claim "a burst cannot back
  up the mutation queue" is false), and it mints an admission/serialization discipline for queued
  read work that no accepted plan owns. Contrast the round-4 handback, which correctly stayed an
  amendment because `mutationCoordinator.run` already existed and was merely adopted.
- No Gate 1: the four constructions were weighed and three rejected on stated grounds in design.md
  § Rejected. None of them differs in contract, cost or risk in a way the user would decide
  differently on, so it was a call to make rather than a fork to offer.
- No discovery.md: the evidence is the parent's `.reviews/round-6.md` and the shipped create-form
  identity flow, both of which already own it. Duplicating either here would give one fact two owners.
- The create form solved this problem first and its solution is the reuse: opening identity per
  surface, retire on close, an explicit repeat policy (`asimov/specs/worktree-panel/spec.md:1595-1641`,
  `WorktreeHost.ts:605-680,1940-1975`). This change follows it and deliberately DIFFERS on one point —
  a repeat supersedes rather than joins — which is stated in the spec delta so a reviewer reads it as
  a decision rather than a violation of the sibling rule.

Knowledge candidate: the panel cannot bound host work, and a guard that tries becomes a liveness bug |
Surprise: one webview guard produced both round-6 findings — B5 because it could not see the other
surface or the other row, and W6 because the same refusal blocked the re-ask that would have
recovered a dropped reply | Evidence: `WorktreeController.ts:1359-1366` vs
`.reviews/round-6.md` B5 and W6 | Consumer: plan | Action: when a bound is proposed on the webview
side of a host boundary, put it on the host and leave the panel only what it can observe for itself.
