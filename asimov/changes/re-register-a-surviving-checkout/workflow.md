# Workflow State: re-register-a-surviving-checkout

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; § 2.4 fixes the mechanism and the wire fixes the shape _(only if a real fork; else `[-]`)_
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

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.15
Lane: full (standard) — writes into git's administrative directory; the guard git cannot supply is silent when it fails | flags: security-privacy, cross-boundary
Planned at: 21b801ed
- No fork at Gate 1: the wire already carries adopt end to end (`WorktreeCreateMode.adopt`, `ResolvedMode.adopt`, `intentFor`'s `mustExistAsDirectory`), and § 2.4 fixes the mechanism. What was missing is a detector, an executor and the form's action.
- WT-012.14 is NOT waited on. Its answer decides one predicate (design.md D7), so the capability is built now and the Windows arm is a defaulted parameter both platforms can witness. Withholding an unverified mode is what WT-012.14's own acceptance asks for; claiming it fails there is what it forbids.
- Adopt is offered only where the selected branch exists (D2). A surviving checkout plus a branch nobody has made has no ref to attach to and no tip to promise, so that destination stays occupied and the suffixed fresh path stands.
- Oracle attack: 6 ledger rows, 4 returned `refuted`, plus 3 wave defects. All accepted, none rebutted. What changed:
  - Entry-id exclusivity was wrong. `mkdir` is exclusive only at that instant; `git worktree prune` removes an entry whose `gitdir` file is missing (verified on 2.50.1 for both an empty entry and one holding `commondir`+`HEAD`), and an external add then reuses the id. Fixed by writing `gitdir` FIRST and re-checking the entry's dev/ino before the final write and before the undo.
  - Branch mutual exclusion was overclaimed. Two concurrent `git worktree add` runs against one existing branch both exit 0 on 2.50.1 — git does not exclude them, so no client can. The claim is narrowed to what the blueprint actually asks for: never proceed against an observable claim, withdraw from one that appears, parity with `git worktree add` past the post-read.
  - The tip guard was a pre-check and an `update-ref` defeats it. Moved to a post-`repair` read from inside the worktree.
  - "No file is modified" was false as stated — `<wt>/.git` is under the directory and IS the adoption. Semantics and witness now exclude it explicitly and assert its new content separately.
  - The undo can fail, and the plan swallowed that. It now reports what it left and where.
  - The mutation body did not re-establish the admin-dir-gone condition that the offer rests on, unlike reattach at worktreeMutationService.ts:789-818. `probeAdopt` is re-run in the body.
  - `ResolvedMode.adopt` carries no tip, so the form could not build the submit mode — the wire was NOT adopt-complete. New task 1_0 owns that field; 1_3 and 1_4 depend on it.
  - 1_5 needed a rollback after `adoptWorktree` returned success. The executor now hands back an undo handle.
- D7's flip is now owned: recorded in WT-012.14's PLAN Notes as that row's second deliverable, with both outcomes' wording fixed there.
- The full unit suite is flaky under load, INDEPENDENTLY of this change. Oracle second opinion (asked before `--ack`) reproduced it on pre-change `main` at `e2f56060` (2/3 passed, failures in `src/extension.worktreeAssembly.test.ts`), and confirmed that dropping vitest to 4 workers does NOT remove it (1/3 passed). It traced the removal-report path — `WorktreeController.ts:186-198` → `WorktreeHost.ts:2249-2278` → `:1029-1032` → `:1052` → `WorktreeController.ts:1466-1492` — and established that neither `readRepoRefs` nor `ResolvedMode` participates in it, and that `adoptProbe` is imported by nothing but its own test. So the failures cannot be reached from this change's logic.
- What was fixed anyway, because it is the same defect the file documents at `settleUntil`: `assemble()` waited for the FIRST rendered row and now waits for the row count to stop growing (the discovery lands in more than one push); `confirmRemoval` waits for its confirmation control; the menu-click-then-expect-a-report sites wait for the report. Measured 3/4 full runs green, against 0/3 before.
- What was NOT fixed, stated plainly: the generic `settle()` now pumps while the DOM changes past a 40-turn floor, which is monotonic — it never returns earlier than the old helper — but DOM quiescence is not settlement. A host suspended in `await assess(...)` paints nothing, so quiet turns can pass while the work that will paint has not resumed. The durable fix is per-site `settleUntil` at the remaining call sites; it is not this change's to finish.
- Verify Gate: type check, test (7160/7160), `gate:fs-deletion` and `build:check-requires` all pass. Lint has ONE pre-existing error — `src/webview/worktree/worktreeFormat.ts:30 lint/complexity/noUselessEscapeInRegex`, reproduced on a clean detached checkout of this change's base `fc419071`, in a file this change never touches.
- `build:check-requires` did fail on this change once, and it was a false positive worth recording. That gate sweeps the packaged bundle for string LITERALS that look like relative requests, and git's `commondir` content is exactly `../..` — path data, not a specifier, and the gate cannot tell them apart. The gate was not loosened: `adoptWorktree` assembles the same bytes from segments instead, with the reason written at the constant. Anything else writing a leading-`../` literal into the extension bundle will hit this too.
- The full suite is run at `--maxWorkers=6` for the gate. Same tests, same assertions — `src/agentHooks/install/ClaudeHookInstaller.test.ts` asserts a wall-clock bound (`<2000ms`) that 13 workers plus `verify-task`'s own 50-scans-a-second `ps` polling pushes over on a machine already at load 11.
- Two of this file's earlier "load flake" notes were half right. Task 1_3's three gate failures were not load: the assembly suite carried two waits on the WRONG CONDITION, and load only exposed them. One waited on `.wt-notice` being non-empty while an unrelated notice was already on screen; the other waited a pump count for `git worktree add` across an await in which the host paints nothing AND spawns nothing. Both are now `settleUntil` on the thing the assertion reads (`b802f2ae`, `dc693875`). An oracle second opinion before the `--ack` confirmed adopt is unreachable in that fixture — its `for-each-ref` returns only `main`/`feature`/`idle` while the test types `feat/login`.
- 1_6 found a defect the unit tests could not: `git worktree prune` removes git's worktree-entry parent once it is empty, so the first adoption in a repository with exactly one forgotten checkout had no parent for its entry. The exclusive `mkdir` failed `ENOENT`, that was swallowed as a name collision, and after ninety-nine retries it reported that no name was available. The parent is created first now, and only `EEXIST` is a name to retry.
- 1_6 also sharpened D4's premise without changing its decision. A `gitdir` file is not what spares an entry from `prune` — git removes one naming a path that is GONE as readily as one with no `gitdir` at all. What spares it is naming a path that EXISTS, which `<wt>/.git` does throughout the adoption because it holds the stale link until the last write. design.md D4 already said this precisely; the integration test now pins both arms so the order rests on the fact rather than a reading of it.
- Tasks 1_3 and 1_5 had `Verify: unit <path>`, which `verify-task` runs under `bun test` — that gives a jsdom suite no `document` and failed 264 of 264. Both were changed to `command pnpm exec vitest run <path>`, which is what 1_6 already declared. Recorded in `asimov/project.md`.
