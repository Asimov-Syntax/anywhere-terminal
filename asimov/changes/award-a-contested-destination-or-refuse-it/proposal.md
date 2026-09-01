# Proposal: award-a-contested-destination-or-refuse-it

## Why

WT-012.17 settled what the read path can honestly know: two declared spellings are one entry only
when they are spelled alike, and a pair related by case or Unicode folding is offered as a
contender group rather than merged or dropped. That was the whole of what a read can prove — git
creates the worktree after the offer is drawn, so the folding rule that decides the answer belongs
to a directory that did not exist yet.

Both members of such a group arrive selected and the apply materializes them in provider order. On
a folding volume the second one lands on the first one's destination, and today the outcome is
decided by whichever entry the copy-before-link sort happened to run first. That is the inherited
declaration as often as the repository's own, which inverts the merge rule the whole model is built
on: an entry the repository wrote is supposed to win its destination, including its mode.

This is the half that can observe the answer. The destination exists by the time the apply runs.

## Scope

- Arbitrate a destination that two SELECTED entries may both claim, deciding it from the
  declarations and from what the apply observes at the destination, never from an errno.
- Award such a destination to the repository's own declaration, including its `mode`.
- Refuse the pair, naming both declarations, whenever the apply cannot causally attribute the
  collision to its own write.
- Refuse a recreated symlink whose target resolves to the link's own destination, which is a loop
  on every filesystem.

## Non-goals and must-nots

- **Provisioning still deletes nothing.** No unlink, no truncate, no overwrite — on any path this
  change touches.
- **No refusal on the folding key at apply time.** The key is over-inclusive by construction, so
  using it to refuse material would destroy a declaration to prevent a collision the volume cannot
  have. A symlink that loops only because the destination folds its target onto its own name is
  therefore left to the filesystem, which answers `ELOOP` to a reader and loses nothing; owning
  that case needs the probe below and is a follow-up.
- **No twin-create probe.** Creating two test names in a private directory to ask the volume
  whether it folds them is a real mechanism and a real follow-up; it needs a stated
  filesystem-support contract and an owner for what a crash leaves behind. This change does not
  assume it.
- **No new refusal for an uncontested entry.** Every entry outside a contested group keeps exactly
  the outcome it has today, including a directory copy merging into an existing destination.
- **No filesystem read moves into the read path.** Identity at read time stays lexical
  (worktree-provisioning.md § 4.4).
- Does not touch `src/worktree/worktreeMutationService.ts` or the removal-report path — another
  session owns those.

## Appetite

M. One orchestration seam extracted and given a claim discipline; the entry walk itself changes in
one place.

## Risk

The two hard requirements over one state are named and settled in design.md, not discovered during
build: `Copying SHALL happen before linking` is accepted, and a native LINK claiming its slot ahead
of an inherited COPY contradicts it outright. The other risk is over-refusal — the folding key is
deliberately over-inclusive, so a group whose members are genuinely two files on this volume must
still land both.
