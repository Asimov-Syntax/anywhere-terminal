# Workflow State: open-a-provider-file-without-waiting-on-it

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
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.20
Lane: full (small) — MEDIUM risk: the single read behind every provider adapter, and the fix must not turn a hostile object into an empty configuration | flags: security-privacy, cross-boundary
Planned at: 63507ec1
- Fastlane auto-decisions: full lane taken on the security-privacy flag; no Gate 1 fork — the
  mechanism is forced by what the platform makes knowable at open, not chosen between options.
- Plan attack refuted two ledger rows and the first D4. The first draft gave `writeNativeConfig` a
  target file-type check inside its existing locked `lstat`; the attack showed `lstat` then a
  path-based `readText` is a race, and that WT-012.19 anchors the DIRECTORY, not the child name, so
  it does not cover it. D4 now bounds the open instead, which closes the stationary and the raced
  case together and removes the writer edit entirely — three tasks became three smaller ones and
  `write-only-the-native-config-file` is not touched at all.
- Knowledge candidate: a bounded READ is not a bounded OPEN — `open(path, "r")` on a FIFO with no
  writer never returns, so a byte cap enforced after the open protects nothing, and `O_NONBLOCK`
  alone converts the hang into a silent empty read. | Surprise: the module's whole contract is
  "bounded" and every existing witness (oversize, directory, EACCES) returns promptly, so the bound
  read as total. | Evidence: src/worktree/provisioning/provisioningDeps.ts#readBounded;
  src/agentHooks/install/lockedJsonFile.ts#readText | Consumer: plan | Action: any decision that
  moves a read under a lock, a deadline, or an interactive path budgets a liveness bound for the
  open itself, and pairs a nonblocking open with a handle-type check.
- Merge seam: peer commit `132d20ce` moves `LockedFile` to `src/utils/lockedFile.ts` and does not
  touch `readText`. Task 1_3's edit is deliberately minimal so the merge carries it into the moved
  file.
