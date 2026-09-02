# Workflow State: stop-writing-through-a-name-someone-chose

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [x] Gate 2: plan approved

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

Blueprint: docs/PLAN.md task WT-012.21
Lane: full — escalation flags: security-privacy (from the PLAN row's Labels); the diff is the write path for user-owned agent configuration
Planned at: 21a436f1
- Two probes were RUN on darwin rather than reasoned, and both are load-bearing: `open(p,"wx")` under umask 022 lands at mode 0644 (`mode & 0o077 == 0o44`), and `fs.writeFile` onto a symlink pre-placed at Cursor's predictable temporary name wrote through it into the link's target while `open(...,"wx")` refused EEXIST.
- The plan attack REJECTED the descriptor-validation tier WT-012.21's Notes proposed, and the reason is a flag: cmux opens its lock without `O_EXCL` so it can land on a pre-existing object worth inspecting, while `wx` here refuses every pre-existing object outright. design.md D4. The change-id was `validate-the-lock-descriptor-not-its-name` before that finding; renamed pre-commit.
- ACCEPTED RISK, granted by the user at Gate 2 on 2026-09-02, in answer to a question naming all four: "Chấp nhận cả R1–R4". Owner: WT-012.21. R1 directory substitution, R2 release leaf (`lockedJsonFile.ts:291,305`), R3 temporary leaf (`lockedJsonFile.ts:190,208`) — no pure-Node mechanism reaches any of them; R2 and R3 pre-date this change and were ownerless in the WT-012.19 archive. R4 post-release wedge is INTRODUCED here as the price of D2 not deleting a foreign lock. Trigger and user-facing remedy for each go in `docs/design/worktree-provisioning.md` § 7 (task 1_3). Reactivation: a Node release exposing `openat`/`renameat`. No expiry — these are platform limits, not deferred work.
- Seam checked for 1_2: `src/utils/lockedFile.ts` does NOT exist on this branch, so `CursorHookInstaller` imports `LockedFile` from `src/agentHooks/install/lockedJsonFile.ts`. Peer commit `132d20ce` relocates it; that merge is a one-line import edit.
- 1_3 also corrected a stale line in the same § 7 bullet list: it said what a save reports about an unreleased lock "is NOT settled here (WT-012.22)", which WT-012.22 has since shipped into § 6. Left as-is it would have contradicted the section directly above the new bullet.
