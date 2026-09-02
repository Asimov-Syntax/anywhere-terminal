# Workflow State: stop-writing-through-a-name-someone-chose

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.21
Lane: full — escalation flags: security-privacy (from the PLAN row's Labels); the diff is the write path for user-owned agent configuration
Planned at: eed90688
- Two probes were RUN on darwin rather than reasoned, and both are load-bearing: `open(p,"wx")` under umask 022 lands at mode 0644 (`mode & 0o077 == 0o44`), and `fs.writeFile` onto a symlink pre-placed at Cursor's predictable temporary name wrote through it into the link's target while `open(...,"wx")` refused EEXIST.
- The plan attack REJECTED the descriptor-validation tier WT-012.21's Notes proposed, and the reason is a flag: cmux opens its lock without `O_EXCL` so it can land on a pre-existing object worth inspecting, while `wx` here refuses every pre-existing object outright. design.md D4. The change-id was `validate-the-lock-descriptor-not-its-name` before that finding; renamed pre-commit.
- ACCEPTED RISK, granted by the user at Gate 2 on 2026-09-02, in answer to a question naming all four: "Chấp nhận cả R1–R4". Owner: WT-012.21. R1 directory substitution, R2 release leaf (`lockedJsonFile.ts:291,305`), R3 temporary leaf (`lockedJsonFile.ts:190,208`) — no pure-Node mechanism reaches any of them; R2 and R3 pre-date this change and were ownerless in the WT-012.19 archive. R4 post-release wedge is INTRODUCED here as the price of D2 not deleting a foreign lock. Trigger and user-facing remedy for each go in `docs/design/worktree-provisioning.md` § 7 (task 1_3). Reactivation: a Node release exposing `openat`/`renameat`. No expiry — these are platform limits, not deferred work.
- Seam checked for 1_2: `src/utils/lockedFile.ts` does NOT exist on this branch, so `CursorHookInstaller` imports `LockedFile` from `src/agentHooks/install/lockedJsonFile.ts`. Peer commit `132d20ce` relocates it; that merge is a one-line import edit.
- 1_3 also corrected a stale line in the same § 7 bullet list: it said what a save reports about an unreleased lock "is NOT settled here (WT-012.22)", which WT-012.22 has since shipped into § 6. Left as-is it would have contradicted the section directly above the new bullet.
- HANDBACK after round 1. F001 (cleanup unlinks a substituted staging object) is fixed by REUSING `LockedFile.stageReplacement` rather than adding a third ownership check to Cursor's own — which changes D1's mechanism, so it re-earns Gate 2 instead of landing as a fix commit. The miss is instructive and is why reuse won: I hardened the LOCK by reuse in 1_2 and left STAGING duplicated in 1_1, and the gap landed in the duplicate.
- F002 was confirmed by my own probe at `21a436f1` vs `d9a0d94b`, not taken on the chair's word: absent config parent returned `lock-unavailable` and created nothing before, returns `{installed:true}` and creates `.cursor/hooks.json` after, because `LockedFile.acquireLock` mkdirs recursively and Cursor's own acquisition never did.
- Verify Gate lint: `pnpm exec biome check src` reports 16 findings, ALL pre-existing at `21a436f1` and none in a file this change touches — `SnapshotPersistence.ts`, `fileTreeRpc.integration.test.ts`, `VaultService.customName.test.ts`, `worktreeFormat.ts`, `AgentHookController.test.ts`, and three webview CSS files. Reproduced on a clean tree at that sha. This change removed one of them: `CursorHookInstaller.test.ts` was in the pre-existing set and is not in the current one.
- HANDBACK after round 2. F002's fix moves the no-parent-creation policy from a precheck in Cursor into `LockedFile` itself, which changes D2's mechanism and adds an option to a module `ClaudeHookInstaller` and `writeNativeConfig` also use — so it re-earns Gate 2 rather than landing as a fix commit. Second attempt on this invariant; a third failure trips the thrash stop.
- F003 was confirmed by my own probe before the chair reported it: `{...proxy}` copies own enumerable properties into a plain object, so the trap never fires on the path `lockedJsonFile.ts:80` fills from the real `node:fs/promises`. My round-1 fix relocated the defect instead of closing it.
- `src/extension.worktreeAssembly.test.ts` flaked three times during 1_8's gate, a DIFFERENT test each run. Proved pre-existing rather than acked on suspicion: a clean worktree at `21a436f1` — before this change's first commit — flaked the same file 1 run in 3, on a fourth distinct test. The file passes 5/5 in isolation. Its own `settle()` comment (`:608-621`) says the fixed 40-turn pump fails intermittently under full-suite load. Second opinion obtained before `--ack`, as the rule of three requires.
- Blueprint sync narrowed WT-012.21's Goal BEFORE marking it done. The Goal had no "or" branch — it asked to make the four operations act on the authorized directory, which D4 shows no pure-Node mechanism reaches — so ticking done against it would have recorded a promise nobody kept. The Acceptance was left intact: its fourth branch anticipates exactly this outcome and was met.
