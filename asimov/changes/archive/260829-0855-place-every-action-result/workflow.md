# Workflow State: place-every-action-result

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
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: b9467406

Blueprint: none
Lane: light — one concern, one owner, no new API/data/security surface; flags: re-review

- Origin: `fold-idle-worktrees` review round 2 declared a thrash stop. The invariant "an
  action result is rendered somewhere, and says what it is about" has survived two fix
  attempts across two changes (prior round-3 B1 → fold-idle-worktrees round-1 W1 →
  round-2 W6/W7). The user chose the designed fix over a third patch round.
- `fold-idle-worktrees` DEPENDS on this change: its W6/W7 gaps close here, not there.
  Not folded into it — a single owner for notice reach is a new invariant owner.
- Scope boundary: this change never alters which worktrees are LISTED. It does not open a
  fold, lift a cap, or widen a filter to make a row appear; it changes only where a result
  is rendered and whether it names its subject.
- Oracle on the re-plan raised two blockers, both accepted: the sweep as first scoped
  did not own repo-scoped results on a collapsed repository (which return before the
  loop that would emit them) or results held when `render` exits early, and the naming
  rule named a source that does not exist — `orphanedLabel` is reconstructed in
  `WorktreeController` from the previous tree, not supplied by the host — over labels
  that do not identify one worktree. Placement now owns every result and naming is by
  row presence with qualification.
- Verify gate: lint check mode, 17 findings, identical set to the pre-change baseline.
  Removing the three emission sites left `resultsFor` dead and biome said so; deleted
  rather than suppressed.
- `render` gained a single exit so placement cannot sit behind the listing's four early
  returns. Focus restoration moved to a key captured before `replaceChildren` rather than
  read from a DOM that has already been replaced.
- Round-1 B1 is closed twice over — the anchor map is cleared with the DOM, AND a
  detached anchor is refused at use. Each alone closes it, so neither is individually
  falsifiable by the suite; removing BOTH fails all three early-exit tests, which is the
  evidence recorded. The second half is deliberate defence against a silent `after()`
  no-op, kept knowing no reachable state exercises it.
- Review cycle 1: round 1 BLOCK (2 blockers, both mine — the anchor map reopened the very
  hole this change closes), round 2 WARN with 0 blockers. Exited at re-verify; all four
  round-2 warnings taken anyway.
- Chair corrected my own record: the two halves of the B1 fix are behaviourally
  equivalent, so neither being individually falsifiable is a property of the code and not
  a gap in the suite. Both kept — `clear()` stops the map pinning a departed repository's
  subtree, the guard turns a future regression from a silent drop into an honest append.
