# Workflow State: materialize-declared-files-into-a-new-worktree

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

Blueprint: none
Lane: full
Planned at: 50e6428d

Blueprint: docs/PLAN.md task WT-012.2
Lane: full (standard) — HIGH risk: writes files into a directory that did not exist a moment ago,
from paths a checked-in file supplied | flags: security-privacy, cross-boundary, new-api-contract
Planned at: 50e6428d
- `new-api-contract` added beyond PLAN's two labels: `ProvisionStepResult` and
  `worktreeProvisionResult` are documented at worktree-rpc.md § 2.2 line 115 and defined NOWHERE in
  `src/`, and `WorktreeCreateRequestMessage` grows `provision?`. Three wire additions is a contract
  change whatever the PLAN row says.
- Admission screen, re-run after discovery as the skill requires: ONE new invariant owner — the
  discipline by which provider-declared material is written into a new worktree. Copy and link are
  two modes of one step sharing one validation path, not two owners, and the result contract is the
  reporting half of the same acceptance story rather than a second story. No split proposed.
- Verified before planning on them: `ProvisionEntry`/`ProvisionModel`/`ProvisionSelection` DO exist
  (`src/types/messages.ts:851-945`); `ProvisionStepResult` does NOT; there is no apply code and no
  recursive copy helper anywhere in `src/` to reuse; `offerStore.ts:11` names WT-012.2 as its first
  redeemer, which this change is.
- The seam is `src/worktree/worktreeMutationService.ts:891-920`, between `addToGitExclude` and
  `afterCreate`. Chosen over "after the create returns" because `afterCreate` launches an agent INTO
  the worktree and would otherwise start before its `.env` landed.
- Validate warning triaged as a false positive, not fixed away: the lockfile / `node_modules`
  requirement reads as prescribing implementation because it names two files, but both are material
  the user is shown a refused row for. The behaviour is externally verifiable; the wording was
  already loosened once and further loosening would stop naming what is refused.
- FOLLOW-UP, needs its own PLAN task and is NOT closed here: rpc § 2.4 requires a stale `offerId` to
  produce no create AND a freshly resolved model, re-presented, awaiting a second submission. D3
  builds the refusal; the re-present half is provisioning UI. Carried as a ledger row rather than
  left implicit.


Plan attack (`asm-oracle`) before Gate 2. It refuted FOUR ledger rows and defeated the `n/a` on a
fifth. Every finding accepted; nothing was rejected. What changed, and why each mattered:

- REFUTED, destination containment. `COPYFILE_EXCL` protects the FINAL component only. Validate
  `/wt/cfg/secret`, create `/wt/cfg`, let something swap `cfg` for a symlink to `/outside`, and the
  write escapes through the intermediate component. D5 was rewritten: no-follow on both final
  components, an `lstat` check at every descent, and the intermediate window named as its own `n/a`
  row because Node exposes no `openat` and no walk written in Node can close it. The first draft's
  "the exclusive primitive IS the check, so no depth is exempt" was simply wrong.
- REFUTED, source containment. `lstat` says regular file; the file becomes a symlink before the open;
  `copyFile` reads through it. Fixed by opening the source `O_RDONLY | O_NOFOLLOW` and `fstat`-ing
  that fd — which means the copy cannot be `copyFile` at all, since it cannot express no-follow.
- REFUTED, symlink relocation. An in-repo relative link can resolve OUT of the repo once copied to a
  different depth: `/repo/alias → deep/a/b`, entry `alias/tree`, link `../../../inside.txt`. D6 now
  validates the target from BOTH the source and the destination directory, because validating either
  one alone is wrong in a different direction.
- REFUTED, failed-entry isolation — and this one would have shipped. An apply REJECTION (not a
  returned failed step) falls to the create body's outer arm at `worktreeMutationService.ts:920-925`
  and reports a successful git create as a create error. D1 now takes its own `.catch()`, modelled on
  `afterCreate`'s at `:905-910`, and 1_5's test must use a rejecting fake — the finding notes that a
  fake returning a failed result passes while proving nothing.
- REFUTED, no-delay. A finite list of ENTRIES does not bound the descendants of one of them. New D10
  adds a node/byte/deadline budget built on `afterDelay` (`src/worktree/deadline.ts`), which this repo
  already uses for this shape of bound.
- `n/a` DEFEATED, partial content. Calling it "not a claim this change makes" was a dodge: D9 does
  promise it, and apply runs before `afterCreate`, so a launched agent can read a file mid-write. Both
  halves are now stated. Per-file atomicity would need temp-then-`link`-then-`unlink`, and `unlink` is
  a deletion primitive in a module the I10 gate scans — not worth that trade, but the reason is
  recorded rather than the conclusion alone.
- Also accepted: destination TYPE mismatches (`mkdir` EEXIST over a file, or over a symlink to a
  directory) were unhandled and are now their own ledger row; `ProvisionStepResult` could not express
  a skipped descendant the spec requires reporting, so D8 gains `details`; 1_1's Verify was a unit run
  on a file that says outright `check-types` is its judge, and is now that command.
- Two rows the attack UPHELD and it is worth saying which: the offer-redemption row (surface identity
  is host-minted, the key includes `repoId`, and `remint` draws entries, ports and setup from one
  sequence so a setup id cannot pass as an entry id) and the refuse-never-clamp row.

DOC CONFLICT found by the attack, to be corrected at Blueprint Sync: `worktree-apply.md` § 2.1 and its
§ 4 table say a lockfile is reported as SKIPPED; `docs/PLAN.md` WT-012.2's Acceptance, this change's
spec delta, D7 and D8 all say REFUSED. PLAN is the task contract and wins; the doc predates the
`refused`/`skipped` distinction D8 mints, under which "skipped" means nothing was wrong.

FOLLOW-UP grew a second half, both for the same PLAN task: rpc § 2.4 requires a fresh model
re-presented after a stale offer id, AND refusal when the provider files changed underneath a
still-held offer — `lookup` (`offerStore.ts:132-136`) compares key and id only, carrying no version or
content identity. D3 builds the safety half; neither missing half is in WT-012.2's Acceptance.
