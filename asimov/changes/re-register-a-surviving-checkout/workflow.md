# Workflow State: re-register-a-surviving-checkout

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; § 2.4 fixes the mechanism and the wire fixes the shape _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
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
