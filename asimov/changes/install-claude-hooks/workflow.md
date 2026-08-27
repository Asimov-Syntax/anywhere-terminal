# Workflow State: install-claude-hooks

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-006.2
Lane: full (standard) — writes into a user-owned config file and registers an executable path | flags: security-privacy
Fastlane: no real fork at Gate 1. The PLAN Notes already mandate reuse of the existing lock, atomic rename, and typed reasons, so extract-and-adapt was the only direction; recorded as D1 rather than asked.
Oracle review: REJECT → 6 findings, 5 accepted, 1 partially. Fixes landed as D10 (classified read — the finding that justified the REJECT: a malformed settings.json would have been rewritten as a fresh document), D2 tightened to container-level validation, D3 re-founded and narrowed to directory-suffix ownership, D11 wrapper chmod-before-rename, and a real wiring Verify on 2_2. Rejected: a rolling settings backup (atomic rename plus compare-and-retry is the accepted failure model) and a user-facing install-status detector (outside WT-006.2's contract).
Two corrections owed to agent-hook-server.md at blueprint sync: § 4.7's scope column should read `machine` (D8), and § 4.7's update-reconciliation rationale is factually wrong — it claims the script lives in the extension install directory, while `src/extension.ts:128` puts it under `globalStorageUri`, which is stable across version upgrades (D3).
docs/research/20260827-claude-code-hooks-settings-schema.md was produced during the oracle round and is cited by task 2_1.
2_1 posts `application/json` with `--data-binary @-`, not the form-encoded body § 4.3's prose names. Form fields exist in the reference implementation only because it hand-builds JSON around path-bearing coordinate fields; ours carries every coordinate in the URL and streams stdin verbatim, so the hazard form-encoding solves does not exist here. A third correction owed to § 4.3 at blueprint sync.
2_3 was added mid-build from the same reference read: Windows resolves an unqualified `more`/`curl` against the working directory before PATH, so the shipped cursor wrapper hands the hook payload to a repo-local `more.*` if one exists. Out of 2_1's lease, hence its own task.
Cycle-1 remediation landed as tasks 4_1 (D12 ledger), 4_2 (D13 single transition owner) and 4_3 (D14 probe runner). The parser, `migrateAgentDestination` and `uninstallAllAgents` are deleted rather than patched — the three defects each had the same root, which is why patching them individually thrashed.
`main` was merged in mid-cycle (b405735): 24 commits carrying phases 4 and 5, including WT-004.3. Two conflicts, both resolved toward this branch's contract — `SessionManager`'s `cursorHooks` field is `agentHooks` here since WT-006.1, and `paneEvidence` from main is threaded alongside it. The pnpm lockfile was regenerated rather than hand-merged.
Lint reports 13 warnings, all pre-existing on main and none in files this change touches; `biome check` exits 0. `pnpm run lint` runs Biome's auto-fix form and would silently rewrite `src/webview/worktree/worktreeFormat.ts`'s spinner regex, dropping backslash from the frame set — reverted, and the gate was taken from check mode.
Round 9 (cycle 4 discovery) REJECTED with 7 blockers and confirmed B5, B6, B9, B11, B13
and W6 fixed. Three of the seven are one design contradiction, so the thrash stop was taken
as a handback rather than a fourth patch: B10 (a pending list cannot both retain every host's
cleanup obligations and stay bounded), B14 (D16 made the ledger machine-scoped while
`destination` stays a single string, so two installations with different `claudeConfigDir`
cannot both be represented), and B17 (8 remembered commands against 16 pending destinations —
an evicted command makes its own pending configuration unrecognisable, and cleanup then drops
the pointer to a file that still fires hooks). Gate 2, All tasks done and Verify gate are
unticked; the round-9 blockers B12, B15, B16 and B18 are ordinary implementation defects and
are planned alongside the amendment. The user did not answer the thrash-stop question within
the wait, so option 1 was auto-chosen under fastlane; option 2 was not available without them,
since risk-accepting B17 means accepting that an uninstall can leave live hooks behind.

Cycle 3 closed as SUPERSEDED at round 8: D16 (commit 435d911) amends accepted storage,
ownership, durability and bounding contracts, so the round-7 fixes cannot be verified inside
the cycle they changed the premises of. Round 9 opens cycle 4 as a discovery round over the
whole change (ce2e801..HEAD) and D16's impact cone; the round cap restarts with it. Round 7's
blockers B5, B6, B9, B10, B11, B12, B13 and W6 carry over unadjudicated — claimed fixed, not
confirmed fixed.

Cycle-3 fixes landed as 7_1..7_5. Two of them found defects the report had not: the ledger's held-back write re-decided the pending ceiling against this host's own view, admitting an obligation the merged list had no room for; and the probe reported a clean kill whenever the reap grace expired before the terminator answered, so silence read as success. Both are covered.
B9 is answered as D16: the ledger moves to `~/.anywhere-terminal/agent-hooks-ledger.json` and only the wrappers stay under the storage root, because a record of what we wrote must outlive every location it describes. Relocating the wrapper too was rejected — the registered executable path is the reviewed security surface, and outside the extension's own storage nothing reclaims it at uninstall. One ledger now serves every VS Code installation for this user, which is right: they already share the config files they write into. Tasks 7_1..7_5.
Round 7 (cycle 3 discovery) returned REJECT with seven blockers; B8, W5 and A1 were independently confirmed fixed. All accepted, none rebutted. B9 is the handback: `globalStorageUri` roots BOTH the wrapper command and the ledger file (`extension.ts:348-357`), so relocating the root takes the ownership history with it and the old entry becomes unownable — never swept, and re-appended beside the new one. D3 established that root as stable across extension UPDATES; the design never separated that from profile, portable-mode, or remote-vs-local moves. The relocation test that appeared to cover this passes one ledger object across both roots, which production cannot do — it proved the command-history mechanism, not relocation.
B11 is a security defect older than this cycle: the Windows Cursor wrapper invokes bare `powershell` while the same template qualifies `more.com` and Claude's qualifies `curl.exe`. Task 2_3 fixed that class for `more`/`curl` and missed the PowerShell branch, so a repo-local `powershell.*` executes on every Cursor hook. Not eligible for risk acceptance, same ruling as round-3 B4.
An oracle consult run in parallel settled the question under all of this: ownership CANNOT be derived from the hook document — Claude closes `hookMatcher` and every `hookCommand` branch with `additionalProperties: false`, and a self-identifying command still cannot say where a moved `claudeConfigDir` went. So the ledger stays; B9 moves where it lives. The oracle also corrected the claimable guarantee: never removing a non-identical lookalike or a command-edited entry, NOT per-occurrence provenance — a byte-identical copy a user wrote is indistinguishable. Owed to design.md.
An oracle sub-agent overwrote `docs/research/20260827-claude-code-hooks-settings-schema.md` despite a read-only instruction, cutting 103 lines; reverted with `git checkout --`.
Round 6 closed cycle 2 as SUPERSEDED at the scope lock rather than reviewing the fixes: D15 amended D12 mid-cycle, and a verification round cannot adjudicate a design the discovery round never saw. That restarts the round cap — cycle 3 opens with a discovery round (round 7) over the whole change, carrying B5, B8, W5 and audit-backlog A1 forward as fixed-but-unverified. Not a thrash stop; no blocker survived a third round.
Round-5 fixes landed as 6_1 and 6_2. The lock and atomic replacement moved out of `ManagedConfigInstaller` into `src/agentHooks/install/lockedJsonFile.ts`, so the ledger takes the same authority instead of a second one; the round-5 audit-backlog item (a raw path compared against canonicalized ledger paths) was fixed in the same seam 6_2 already held.
Round 5 (cycle 2) handed back to planning: B5 overturns where D12 puts the ledger. `context.globalState` is a per-window cache flushed on update, not a store two extension hosts share, so the ledger cannot hold the invariant D13 depends on — amended as D15, a lock-protected file under `globalStorageUri`. Round 5 also overturned my round-4 modification of B7: a pending ceiling that refuses to track while letting the transition continue loses a file we modified, because the next `recordInstalled` overwrites the record naming it. D13 now stops the move instead. Tasks 6_1 and 6_2 carry both, plus W5 (a finalization failure records the written path as pending). Round 6 is cycle 2's last available round.
Cycle 1 closed after its third round with blockers outstanding (REJECT). B1 and B2 each survived two fix attempts and widened under patching, which is the thrash stop: remediation returns to planning rather than a fourth round. Round 3 also raised B4 (unqualified `taskkill`) and left W1 (the outer deadline preempts the inner reap wait). Risk acceptance was not available for B2 or B4 — silent deletion of user configuration and executing a working-directory binary in the extension host are both on the never-eligible list. Gate 2 and the Implement gates are untucked accordingly; the next review is cycle 2 discovery, not a verification round.

