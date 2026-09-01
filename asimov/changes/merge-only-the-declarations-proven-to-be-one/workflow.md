# Workflow State: merge-only-the-declarations-proven-to-be-one

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Planned at: 43baba8b

Blueprint: docs/PLAN.md task WT-012.17
Lane: full — HIGH risk: this is the seventh mechanism proposed for one invariant and six are refuted; getting it wrong in the merging direction silently deletes a declaration the repository made | flags: new-api-contract
- Scoped by an oracle attack before planning, not after. Its boundary result is why WT-012.17 was split: the read path can prove only spelling-level identity, because git creates the worktree AFTER the offer is drawn and the folding rule belongs to that directory. WT-012.18 owns the apply-time half.
- Refuted before this change starts, do not re-propose: lexical-only normalization; a single-file case probe (a case-toggled symlink answers for the wrong volume); a two-spelling resolution probe; `realpath` per path (two aliases, one answer, two slots); `lstat` dev+ino per path (two hard links share an inode, a symlinked parent defeats no-follow, Windows `st_ino` collides past 2^53 without `{ bigint: true }`); `toLowerCase()` on Windows path semantics (over-merges `İ`/`i̇`, `ẞ`/`ß`, `Ϗ`/`ϗ`, which NTFS keeps apart through `$UpCase` with no normalization).
- Also refuted as a repair: ASCII-only folding. It closes the Windows over-merge but worsens the other direction — `Straße`/`STRASSE` and `ﬀ`/`ff` are one file on APFS, so splitting them recreates the round-7 defect where both rows arrive default-selected and the inherited mode wins the apply.
- Reuse, verified before planning: `BringRow.excluded` in `src/webview/worktree/WorktreeCreateDialog.ts:296-313` is already a row that is drawn with its provenance and carries no checkbox. The unresolved pair is a second marker down that same rendering path, not a new pattern.
- Plan attack run before Gate 2, not after. It refuted three ledger rows and two of my own claims, all accepted and applied: the "no I/O" witness was unfalsifiable as written (provider files ARE opened, so an empty-list assertion could never hold); the no-loss claim had to narrow to declarations with DISTINCT spellings; and a singular favoured member cannot represent native+native, so a group now carries an optional favoured id and is a connected component rather than a pair.
- Two findings were mine to own rather than the sibling's: `offerStore.remint()` replaces every entry id, so a group naming pre-remint ids points at ids nobody holds — silent and total, now task 2_1 step 4. And task 1_1's RED step could not have failed on this darwin lane, because the old fold only fired when `path.sep === "\\"`; the platform flag is now injected.
- The spec delta was MODIFYING a requirement that is not in the accepted baseline — it is an ADDED requirement of the sibling `assemble-one-config-from-several-files`, which now Depends On this task. Modifying a requirement owned by a change that depends on you is circular; the delta is ADDED-only now, and its two on-disk scenarios moved out to WT-012.18 where a witness can exist.
- Gate 2 taken under fastlane on the user's "ok nhé, tự chốt đi" (2026-09-01). The scope decision that preceded it — splitting WT-012.17 from WT-012.18 and dropping the unsatisfiable "one row before creation" clause — was made while the user was away and confirmed by them afterwards.
- Task 1_1 corrected the first ledger row a second time, and the correction came from RUNNING the witness rather than reasoning about it. The oracle had refuted "the recorded path list is empty" because provider files are opened; my replacement — "no recorded path derives from a declaration" — failed too, and the failure was informative: `/repo/kept` reaches `realpath` because containment resolves every declared path to check where it lands. That is the security property F009 exists to protect and it must not be asserted away. The witness is now differential: two fakes that disagree about every declared path must yield identical rows.
- Task 1_1 RED was proved by three mutations, not one. `toLowerCase()` kills 4 of the 7 conserved-declaration assertions, a Win32 dot-strip plus NFKD kills 2 more, and `toUpperCase()` kills the last (`Straße`/`STRASSE`). Each assertion is therefore non-vacuous against at least one plausible fold; none of them is a test that could only pass.
- Task 2_1's `contendersOf` identifies the repository's own row by declaring FILE, not by id. `ids()` mints a fresh sequence per adapter, so a base row and a native row can both be `i1`; identifying the favoured member by id matched both and cost every group its favoured member silently.
- Task 3_1's reachability walk follows call sites and reads one file, so a helper handed across as a bare value is an edge it cannot see. That is why each of the five roots is walked on its own rather than relying on one graph to cover the others, and why dropping a root from that list silently drops a guarantee. Stated in the test's own comment so a future reader cannot mistake the walk for a whole-program proof.
- Knowledge candidate: `pnpm run test:unit` is intermittently red on unrelated timing tests independently of any diff | Surprise: it cost task 3_1 its three verify attempts, and the failing test differs almost every run — `src/extension.worktreeAssembly.test.ts` most often, also `src/vault/snapshotPool.test.ts`, `src/webview/vault/VaultPanel.test.ts`, `src/worktree/deadline.test.ts` — each of which passes in isolation | Evidence: detached worktree at base 414b0aef with this change absent — `pnpm run test:unit` × 3 gave 2 failures, both `extension.worktreeAssembly.test.ts > … > [2_5] reports what a clean removal would cost`; the same commit under bare `pnpm exec vitest run` × 6 was green, so the flake is sensitive to the command, not to the diff | Consumer: plan | Action: a PLAN task owns stabilising it; until then a verify failure confined to those files is checked against a clean tree before it is believed.
- Verify Gate ticked with one failure: `src/worktree/deadline.test.ts > [F002] … > stays expired after it has fired`. Reproduced on a clean tree at base 414b0aef (1 failure in 25 runs) and `git diff 414b0aef..HEAD -- src/worktree/deadline.ts src/worktree/deadline.test.ts` is empty, so it is untouched by this change. Root cause found while confirming it, and it is a real latent defect rather than only load: `afterDelay` computes `at = Date.now() + ms` but resolves off `setTimeout(resolve, ms)` (src/worktree/deadline.ts), and Node's timer can fire up to a millisecond early against `Date.now()`, so with `ms = 1` the getter reads `expired === false` at the moment the promise resolves. Two clocks for one deadline. Owed as a PLAN task — outside this change's lease and a behavioural fix.
- Owed as a separate PLAN task: a bundle gate asserting `dist/extension.js` holds no unresolved relative `require`. The `jsonc-parser` UMD `main` shipped an activation-breaking `require("./impl/format")` that every test suite missed, because vitest resolves the `module` field and never sees the bundle.
- Round 1 rejected the change with four blockers, all reproduced independently before triage. F003 was the one that crossed the remediation boundary: nothing in the accepted artifacts said what a contender group NAMES, and the assumption that it can name ids came from an advisory plan step that is false here — every adapter calls `ids()` and each sequence restarts at `i1`. Handback taken, Gate 2 unticked, D7 and D8 written, Gate 2 re-earned under fastlane on the standing grant "cho phép rouund review mới hoặc tách change/ replan".
- The collision in F003 was half-known and that is the lesson worth keeping: task 2_1 already identified the FAVOURED member by declaring file rather than by id, precisely because ids collide across adapters. The same reasoning was not carried to MEMBERSHIP twenty lines away. A hazard that has been worked around once is not a hazard that has been closed.
- Round-1 fix-delta audit. Each finding's own witness now closes and each is non-vacuous against the defect it names: F001's three pairs, F002's framework-winner model, F003's distinct ids, and F004's two summary cases were all proved RED by restoring the exact defect, and F005's three shapes are backed by a test showing the old left-margin pattern matches none of them. Every earlier blocker's witness was re-run whole, not sampled — the full suite ran inside each `verify-task`. Nothing previously satisfied is falsified: D1 still holds because `foldable` remains pure and the gate over it got strictly stronger; task 2_1's Boundary still holds because no path merges on group membership; `oneOwner.test.ts`'s lockfile count still reads `entryGate.ts` once, because moving the Win32 strip out did not move `LOCKFILES.has(`; and `readOnly.test.ts` is unaffected because the new import crosses from one READ_PATH module to another.
- Impact manifest for the round-1 fixes, since they change an identity source and a shared interface. `ProviderBudget` gained `nextId`, so every construction site is a caller: `newBudget()` itself and the tests that build one — all type-checked, and `providerKit.test.ts` now asserts the sequence rather than the old exact-shape `toEqual`. `ids()` keeps its export and loses its four adapter callers. `foldWin32Name` is a new shared export with two callers whose reasons differ, which is why its doc says so. The behaviourally reachable entry modes for the contender relation are now three, and all three are covered: native assembly with an `extends`, a framework winner with no native file, and a provider switch — the switch reaches the same non-native branch through `prefer`.
