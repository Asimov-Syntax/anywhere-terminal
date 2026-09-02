# Workflow State: anchor-a-locked-write-to-the-directory-it-checked

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-012.19`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (small) — MEDIUM risk: precision and reporting inside the primitive both config writers depend on | flags: security-privacy
Planned at: 5af4d3fd
- Fastlane auto-decisions, each recorded because it narrows or redirects what the blueprint row said:
  no Gate 1 question was asked of the user, per the standing instruction to settle hard technical
  questions against orca/cmux/t3code or the oracle.
- The row's `openat`/`renameat` mechanism is UNREACHABLE, not merely inconvenient — design.md D1
  carries the probe table. The reference implementations do not use it either, including cmux, which
  is Swift and could. Their answer is a no-follow leaf, which this repository already has.
- Size stays at the row's L. The M appetite the first draft claimed rested on "the leaf is already
  covered", which plan attack 1 refuted; nothing has since made the work smaller.
- Peer branch NOT merged. `132d20ce` moves `LockedFile` to `src/utils/lockedFile.ts`, but that
  branch is 45 commits and ~7800 lines ahead with WT-012.11 not yet reviewed; merging to reach the
  final path would pull unreviewed peer work into this change's review scope. Work stays on
  `src/agentHooks/install/lockedJsonFile.ts` and peer-2 has agreed to verify the hunk survives their
  move.
- Knowledge candidate: an open directory descriptor in Node is a usable IDENTITY even though it is
  not a usable ANCHOR — `handle.stat({ bigint: true })` on it answers for the directory the
  descriptor holds, while `stat(path)` answers for whatever the name reaches now, so comparing the
  two detects a rename-plus-symlink swap that `realpath` cannot see. | Surprise: expected the
  descriptor to be useless without `openat`, and expected `realpath` to be the tool for this. |
  Evidence: probed — `fstat(fd)` 276498985 vs `stat(path)` 276498986 after the swap, equal when
  quiescent; `fs.openat`/`renameat`/`linkat` are all `undefined` on Node 24.7. | Consumer: plan |
  Action: any task asked to make a path-named operation safe against directory redirection uses this
  comparison and states the residual window, rather than reaching for `realpath` or a native addon.

## Plan attack triage (round 1, `asm-oracle`)

Five of six ledger rows came back REFUTED and one UNRESOLVED. Every finding accepted, none
rejected. The plan as frozen did not deliver the blueprint row, and the replan below is what the
goal's standing `tách change / replan` grant is for.

- REFUTED, "the leaf is already covered". The reduction that took this change from L to M was
  false. `wx` covers only the LOCK and the TEMPORARY; the target is created by `link` and replaced
  by `rename`, and `readText` goes through `openRegularFile`, which FOLLOWS symlinks by contract.
  The ledger row that said there was "nothing to falsify" was the wrong kind of row to write.
- REFUTED, "nothing is written at the location the name now reaches". Two-decoy schedule: redirect
  to A, the lock is created in A; redirect to B, the checkpoint refuses — and `releaseLock` now
  names B, finds nothing, and leaves a LIVE lock in A. A refused save has written outside the held
  directory.
- REFUTED, and this is the worst of them: that stranded lock permanently wedges the file. Locks are
  deliberately never reclaimed by age, so restoring the original directory restores the orphan and
  every later save times out. It contradicts this change's OWN spec scenario.
- REFUTED, "a redirection observable at a checkpoint is refused" — for one caller it cannot even be
  placed. `ClaudeHookInstaller.run` holds the lock on one `LockedFile` while `replace` builds a
  SECOND instance to stage through (`:91-100`, `:181-190`), so a per-instance directory handle never
  reaches the staging call. Direct `stageReplacement` outside `withLock` is also an existing
  supported shape.
- REFUTED, "ordinary writes are unchanged" — the design claimed the two stats are a same-instant
  comparison. They are two sequential calls, so an unstable network `ino` can refuse a quiet write.
- Also accepted: `acquireLock` retries up to 41 opens separated by sleeps, so one pre-acquire check
  guards only the first; `mkdir`, both `unlink`s, both ownership `lstat`s and the release `lstat`
  are unguarded; and ABA — redirect, let an unguarded operation land on the decoy, restore before
  the next checkpoint — defeats detection entirely for the operations between checkpoints.
- Also accepted, and independent of the anchoring question: temporary and lock ownership capture
  `dev`/`ino` as ordinary numbers (`:99-108`, `:138-143`, `:255-266`), so the 2^53 collision
  WT-012.17's notes record can make a DIFFERENT leaf read as owned.
- Blueprint acceptance, clause by clause: "lands in that directory or does not land ... at any point"
  is NARROWED to selected checkpoints; "the lock, the temporary, the read and the commit all name
  the same anchored directory" is ABANDONED — they still name strings, and the descriptor is an
  identity oracle, not a namespace; "a failure part-way leaves no temporary behind even when the
  directory was renamed under it" is ABANDONED — cleanup still reaches through the current spelling.
  The row's own goal, "anchoring the operations to an open directory rather than to a path string",
  is not delivered by any mechanism Node exposes.

## Plan attack triage (round 2, same `asm-oracle` resumed)

Four rows refuted again, two unresolved. Every finding accepted. The round is worth recording
separately from round 1 because it did not find the same class of error: round 1 found claims that
were FALSE, round 2 found a claim that was IMPOSSIBLE, which no amount of building would have fixed.

- REFUTED, and the one that mattered: "a refused write strands no lock" cannot be built. Once the
  directory is renamed away, no pathname reaches the lock inside it and a `FileHandle` has no unlink
  — the lock is unaddressable, not merely awkward. Task 1_2's witness demanded an assertion that
  could not be written. The requirement is REMOVED from the spec and the half that IS assertable —
  the decoy holds nothing — is what remains. The stranded lock moves to WT-012.21.
- REFUTED, "never reads through a link at the leaf": `O_NOFOLLOW` is platform-OPTIONAL and the spec
  had no degradation clause, so the sentence was false on win32. Fixed by a portable mechanism rather
  than a weaker sentence — `lstat`, open, compare the opened handle's identity — probed in D2.
- REFUTED, "every step naming a string is guarded": there are THREE `unlink` sites, not the two the
  design said, and the initial `mkdir`/directory-open cannot be guarded by a descriptor that does not
  exist yet. D4 now carries the inventory as a table and declares the bootstrap as an exception.
- REFUTED, "the residual is stated": D6 claimed D4 reduced unguarded operations to zero. It does not.
  D6 now names five residuals and assigns all five to WT-012.21.
- ACCEPTED (Critical, missed by BOTH drafts): the leaf write-side TOCTOU — `ownsTemporaryPath` checks
  an identity and the later `link`/`rename`/`unlink` names the string again. Neither this change nor
  WT-012.21 owned it. Assigned to WT-012.21 in D6.
- ACCEPTED (High): "refuse without acting" was underspecified — a guard at the wrong altitude leaks
  an already-open handle. D4 now states the altitude and task 1_3 counts opens against closes.
- ACCEPTED (Medium): `onLockReleaseFailed` is optional and `writeNativeConfig` passes none, so the
  reporting would have been silent for the caller that matters. Both callers now supply one.
- ACCEPTED (Medium): the absent-`.vscode` case (`writeNativeConfig.ts:395-402`) was undefined under
  D4. Ordered `mkdir`-then-open, with the descriptor becoming the identity from that point.
- ACCEPTED: `openRegularFile`'s new argument would have broken the existing injected-open callers if
  it took position two. It is third, and the provider read keeps following links by default.
- Confirmed sound and left alone: D5 introduces no ordering regression, and the installer never calls
  `readText`.

## Plan attack triage (round 3) — and the stop it forced

Six of eight rows refuted, including the rewrite round 2 produced. Every finding accepted.

- REFUTED, and this one is about MY fix rather than the code: the rewritten spec was VACUOUS. An
  implementation that refuses every save immediately — no lock, no read, nothing created — satisfies
  all three requirements. Removing the impossible clause in round 2 also removed the positive
  obligation, so the pre-existing stranded-lock bug satisfied the spec too.
- REFUTED, the checkpoint machinery contradicts its own spec: the comparison and the syscall it
  guards are two calls, so `open(temporaryPath, "wx")` can land in the decoy between them, and
  cleanup's guard must then refuse to act — leaving a temporary exactly where the requirement forbade
  one. More checkpoints move that window; they never close it.
- REFUTED, the bootstrap authorizes an attacker: `mkdir` then open means whatever the name reaches at
  OPEN time becomes the identity every later comparison trusts.
- REFUTED, the inventory is still incomplete, and structurally so: task 1_1's own `lstat`-then-open
  inside `openRegularFile` is a second window the outer inventory cannot reach.
- REFUTED, the residual was filed under a task that cannot close it: `renameat` still resolves the
  LEAF at syscall time, so directory anchoring — all WT-012.21 owns — does not close leaf
  substitution. Now recorded below as homeless rather than parked under a false owner.
- REFUTED, `O_NOFOLLOW`+identity is defeated by inode REUSE, and on Windows libuv exposes a 64-bit
  file ID Microsoft does not guarantee unique on ReFS. Kept, but narrowed to "non-adversarial
  filesystem, delegated otherwise".
- Survived: the provider read keeps following links, and the outside-`withLock` staging shape.

### Scope reduction, taken under the goal's replan grant

Three consecutive attacks refuted the majority, and round 3 refuted round 2's repair. That is the
thrash signal, so the directory-checkpoint machinery is CUT rather than revised a fourth time
(design.md D2). What remains is what can be stated truthfully: bigint ownership identities, a
no-follow leaf read bounded to the ordinary case, and making the existing lock-release report reach
the user.

Checking the code while cutting also corrected two of my own claims: `releaseLock` ALREADY compares
identity and already refuses to unlink a stranger (`lockedJsonFile.ts:253-272`), so "release by
identity" never needed building — only the precision of the capture was wrong; and the callback it
calls reports to nobody, because `writeNativeConfig` passes none and its vocabulary cannot express
the case.

This is a REDUCTION against blueprint row WT-012.19, not a completion of it. The row's own goal —
"anchoring the operations to an open directory rather than to a path string" — is delivered by
nothing here, and blueprint sync must reflect that rather than tick the row done.

- Residual with NO owner: leaf substitution between `ownsTemporaryPath` and the `link`/`rename`/
  `unlink` that follows. WT-012.21 cannot close it (design.md D6). Needs a blueprint owner.
