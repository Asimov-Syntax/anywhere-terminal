# Workflow State: materialize-declared-files-into-a-new-worktree

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no real fork: the seam, the roots and the refusals are all fixed by worktree-apply.md § 2.1-2.3 and the PLAN Acceptance
- [x] `asm change validate` passes
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

Blueprint: none
Lane: full
Planned at: 027f0064

Blueprint: docs/PLAN.md task WT-012.2
Lane: full (standard) — HIGH risk: writes files into a directory that did not exist a moment ago,
from paths a checked-in file supplied | flags: security-privacy, cross-boundary, new-api-contract
Planned at: 027f0064
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

- D7 carried a sentence that contradicted its own premise and was corrected at build time rather than
  implemented: "its target is checked by D6's destination-side rule like any other". D6's rule
  requires a target to resolve INSIDE the worktree, and a link entry points at the main checkout —
  leaving is what link means. Applied literally it would have refused every link this decision exists
  to create. Corrected in design.md and in 1_4's Plan, with the scope of D6 stated: it governs
  symlinks found while walking a copied tree, where nothing intends to leave. No Acceptance, Boundary
  or spec requirement moved, which is why this was a correction and a Notes line rather than a
  handback.
- Mutation testing on 1_3 found TWO survivors, and both were guards the plan attack had specifically
  demanded — the walk's descent check and its two-sided symlink validation. The tests I wrote for them
  passed for the wrong reason: `admitEntry` refuses those inputs before the walk runs, so the walk's
  own checks were never reached. Fixed with two witnesses the gate cannot answer — a destination
  symlink one level BELOW the admitted entry, and a relocation whose source side passes so only the
  destination check can refuse it. Recorded because "the test exists" was false comfort here, and the
  same shape will recur wherever a gate and a walk check overlapping things.
- That also exposed a real defect rather than only a weak test: `copyLink` resolved a symlink's target
  from the LEXICAL dirname. It admitted nothing extra, but it refused legitimate links under a
  symlinked ancestor. Both sides now resolve from real directories, with a companion test asserting a
  valid relative link still survives.
- `EACCES` was briefly added to the codes that degrade a link to a copy and then removed: it is
  permission denied on the containing directory, not the platform saying it has no symlink to give,
  and degrading on it would hand the user a copy where a failure is the honest answer. The design's
  three codes stand.
- F002's LISTING half stays open and is not a ledger row: `readdir` materializes the whole listing in
  one operation before anything can charge it, so the deadline cannot interrupt the read that
  produced the children. `opendir` would close it and would change `ApplyFsDeps` for every caller and
  the fake. The in-flight COPY half is closed (an `AbortSignal` driven by the deadline).
- F022 has no runtime witness and does not need one: making `realpath` required on `ApplyFsDeps` is a
  compile-time fact, and the behaviour it protects is round-1 F003's node test, which runs the
  production binding verbatim against a real tree.
- Round 2's F017 turned out to have TWO halves, and only the first was visible from the finding. The
  service supplying a `worktreeId` is not enough: `WorktreeController.rescope` DROPS an id the tree
  does not carry yet, and a worktree created a moment ago is exactly that until the next rebuild
  lands — so the merge key missed on every real create anyway. Found by writing the assembly witness
  rather than by reading the fix, which is the fourth time in this change that a seam exercised only
  through a fake read as verified.
- Round 3 superseded without adjudicating anything, and the round type was the mistake. The fix-task
  entries 3_1/3_2 were committed artifact-only in `da95a7e4`, BEFORE the two implementation commits,
  which is the remedy that has been recorded for this trap — and the chair ruled it insufficient:
  "placing it before the two implementation commits does not put it outside the verification delta".
  It cannot be made to work, because a verification range must start at the previous round's Head and
  a fix-task scaffold is authored after it. Whenever remediation needs new tasks.md ENTRIES rather
  than ticks, the next round is a DISCOVERY round in a new cycle. Round 4 needs the user's grant, so
  the change parks here with all 12 round-2 findings fixed, mutation-checked and green but
  unadjudicated.
- Gate 2 re-earned for the 3_1/3_2 task delta, which round 3's Route required and which the original
  Gate 2 (`3f3c8418`) predates — the scaffold landed at `da95a7e4`, after it. No `D#` moved and no
  invariant owner was minted: both tasks remediate accepted round-2 findings inside the accepted
  contract, and their implementation (`1dc745ef`, `cecab7c8`) is built, verified and green.
  `asm change validate` reports 0 errors; its 3 warnings are pre-existing and sit on tasks already
  ticked. Fastlane auto-approves. Round 4 therefore opens as cycle 2 DISCOVERY over the cumulative
  change, with all 12 round-2 findings and the 11 round-3 left unadjudicated.
- Round 4 (cycle 2 discovery) returned BLOCK with 10 findings, all accepted, none rebutted. F025,
  F026 and F027 were verified against source with production-binding probes before triage rather than
  taken from the report; F025 and F027 reproduced exactly. Fix tasks 4_1-4_4 scaffolded, Gate 2
  re-earned, `validate` 0 errors. Because these are new tasks.md ENTRIES, round 5 is a cycle 3
  DISCOVERY round, not verification — that is the same trap that superseded round 3, and it is
  accepted here deliberately rather than worked around. Round 5 needs the user's grant.
- The two blockers' first fix approaches were BOTH refuted by an oracle attack before any code was
  written, and the refutations were verified independently: classifying a descendant symlink as a
  link would refuse `cfg/node_modules -> vendor`, which D6 requires be recreated, and a
  spelling-level trailing-dot rule would refuse `scratch./../.env`, whose offending segment
  resolution discards — reintroducing exactly the raw-versus-resolved disagreement round-2 F004
  removed. The oracle also found a third alias the round missed, `pnpm-lock.yaml::$DATA`. 4_1 is
  written against the revised approach: fold the RESOLVED basename to the filesystem's own identity,
  and apply the existing classifier only in the `isFile()` branch.
- Round-4 fixes complete: 4_4 (`01155fe3`), 4_1 (`50899700`), 4_3 (`f0bebb7a`), 4_2 (`64ee6296`).
  Nine of the ten accepted findings are closed; F002's listing half stays open as the recorded
  residual it already was. Verify Gate re-run clean on the whole tree: types, the I10 fs-deletion
  gate, biome at the 3/14/1 baseline, 6581 unit tests, `verify-status` exit 0.
- Every fix carries a witness confirmed failing against the code it replaced, not merely against no
  code — for 4_1 that meant reverting each half separately, and for F027 a guard test that fails if
  the machine's umask is 0, because the pair beneath it would otherwise pass while proving nothing.
- Correction to 4_4's recorded `--test-change`: it names seven test files, but that task edited only
  `oneOwner.test.ts`. The tree stamp dated from task 3_2 and another change (WT-012.4) had landed
  test edits on this branch in between, so the diff the flag reported was wider than the task's own.
  4_1, 4_2 and 4_3's records are accurate.
- Round 5 is a cycle 3 DISCOVERY round and needs the user's grant. Under the cycle cap it is also the
  last fix window: a third cycle never opens another fix loop, so anything it finds is fixed once and
  then the change either exits or hands back to planning for a designed fix.

Round 5 (cycle 3, discovery) returned 0 gating blockers — F021, F017 and F002 WARN, F028 and F029
SUGGEST. Re-review is required only when a BLOCK was fixed or rebutted, so the cycle ends at
Re-Verify. F021, F017, F028 and F029 are fixed in tasks 5_1 and 5_2; F002 stays the recorded
residual, triaged as accepted by both chairs.

Two tests OUTSIDE this change flake under the load `verify-task` produces by running vitest twice
back to back, and passed on a clean `HEAD` worktree and on ten unloaded runs here:
`src/extension.worktreeAssembly.test.ts` waits on any `.wt-notice` while the panel also carries an
unrelated one, and `src/worktree/deadline.test.ts` reads `expired` after `afterDelay(1)`, which
`setTimeout` may fire fractionally early. Neither is touched by this change and neither is a defect
this change introduced; both are worth a task of their own.
