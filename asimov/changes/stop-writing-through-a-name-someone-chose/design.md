# Design: stop-writing-through-a-name-someone-chose

## Decisions

### D1: The Cursor replacement is staged by `LockedFile.stageReplacement`, not by a copy of it

`CursorHookInstaller.atomicReplace` is deleted. Staging goes through `LockedFile.stageReplacement`,
which already names the temporary from `randomBytes(16)`, creates it `wx`, applies the mode through
the handle, commits with `replace`, and — the part a copy kept missing — discards ONLY a temporary
whose identity it still owns.

Revised after review round 1. The first version copied the mechanism into `atomicReplace`
("matching `lockedJsonFile.ts:120-124`") and copied it incompletely: the failure path unlinked the
staging pathname with no ownership check, so an observer who moved the owned file and substituted
another object had that substitute deleted (round 1 F001). That is the same class of defect D2 was
written to remove from the lock, arriving through the half that was still duplicated — which is the
argument for reuse rather than a third ownership check.

This is the defect the change exists for. Today the temporary is named
`.<basename>.${this.now()}.tmp` — a millisecond timestamp, fully predictable — and created with
`fs.writeFile`, which opens `O_WRONLY | O_CREAT | O_TRUNC` and therefore FOLLOWS a symlink at that
name. Demonstrated on this host: with a symlink pre-placed at the predicted name, `writeFile` wrote
attacker-chosen JSON through it into the link's target, while `open(..., "wx")` on the same name
refused `EEXIST`. That is a write primitive aimed at any file the extension host's user can write.

`wx` closes the pre-placement arm completely. It does NOT close the arm where an observer discovers
the created name and substitutes it before the `rename`, nor before the discard — both are R3, which
Cursor now inherits at the same site rather than at a second one.

### D2: `CursorHookInstaller` stops deleting a lock it cannot prove it holds, by using `LockedFile`

`CursorHookInstaller.acquireLock`, `lockPath`, and the inline release inside its private `withLock`
are deleted; the method delegates to a `LockedFile` built on `options.configPath`.

| | `LockedFile` | `CursorHookInstaller` |
|---|---|---|
| after acquiring | keeps the handle to release against | `await handle.close()` immediately (`:297`) |
| release | `lstat`, compare identity, refuse when `notOurs` (`:286-315`) | unconditional `unlink(lockPath)` (`:282`) |

The unconditional release destroys a DIFFERENT writer's live lock whenever ours was renamed away or
replaced — the case `install-claude-hooks-v1` D1/D3 exist to prevent and that `LockRelease.notOurs`
was introduced to name. Hardening two implementations to one invariant leaves it with two owners and
no single witness; deleting one leaves it with one.

**This trades a destructive failure for a stuck one, and the trade is not free.** Where the name has
been replaced by an abandoned file, a symlink or a FIFO between our acquisition and our release, the
old code unlinked it and freed the name; the new code refuses and every later `wx` times out against
a lock nothing will ever reclaim — locks are deliberately never reclaimed by age. That state is a
disclosed residual (D3), not an oversight. It is accepted because the alternative is deleting a lock
that may be a live holder's, and this repository already settled that question for `LockedFile`.

Signatures differ — Cursor's callback TRANSFORMS the result (`(result: T) => T`), `LockedFile`'s
observes it. The adapter is a captured flag in the caller, not a change to `LockedFile`'s contract,
which WT-012.22 settled and this change does not reopen.

**Cursor does not create the configuration directory, and delegation must not make it.**
`LockedFile.acquireLock` calls `mkdir(dirname, { recursive: true })`; Cursor's own acquisition never
did, and returned `lock-unavailable` with unresolved paths when the parent was absent. Probed at
`21a436f1` vs `d9a0d94b`: `{installed:false, reason:"lock-unavailable"}` and nothing created, versus
`{installed:true}` and `.cursor/hooks.json` created (round 1 F002). Writing Cursor configuration for
a user who may not have Cursor is a different action from failing to write it, so the absent parent
is checked before the lock is taken and the prior result is returned unchanged.

`LockedFile` fills unsupplied filesystem operations from the real `node:fs/promises`
(`lockedJsonFile.ts:80`), and Cursor's test double supplies handles carrying only `close`
(`CursorHookInstaller.test.ts:48-53`). Delegating without extending that double produces a hybrid
real/fake filesystem, so the double is part of this decision's work, not incidental to it.

### D3: Four namespace races are disclosed as residuals, not implied closed by silence

Every operation here reaches its object through a NAME that re-resolves on each call, and Node
exposes no `*at` syscall to anchor any of them (`fs.openat`/`renameat`/`linkat` all `undefined` on
v24.7 — WT-012.19). The addon that would supply them is closed by evidence (WT-012.21 Notes). Four
consequences, each with a trigger:

| # | Race | Where | Trigger |
|---|---|---|---|
| R1 | Directory substitution — rename-plus-symlink at the DIRECTORY between any two of lock, temporary, read, commit | all four sites | a writer able to rename a directory the extension is mid-write inside |
| R2 | Release leaf — `lstat` and `unlink` are two calls, so a substitution between them unlinks the substitute | `lockedJsonFile.ts:291,305` | same-user process racing a release |
| R3 | Temporary leaf — `ownsTemporaryPath()` and `rename` are two calls, so a substitution between them commits the substitute | `lockedJsonFile.ts:190,208` | an observer who discovers the created temporary name |
| R4 | Post-release wedge — a lock name replaced under us is refused rather than removed, and nothing reclaims it | `lockedJsonFile.ts:301` | R2's trigger, or a crashed foreign writer |

R2 and R3 are PRE-EXISTING and were already recorded as ownerless in
`asimov/changes/archive/260902-1340-.../design.md:96-102` and its `workflow.md:186-191`. This change
does not introduce them; it stops leaving them unstated. R4 is introduced by D2 and is the price of
not destroying foreign locks.

The statement goes in `docs/design/worktree-provisioning.md` § 7, beside the bullets already owning
this module's security constraints. Format copied from `cmux/cmux-tui/spec/transports.md:128-135`:
scope covered · the exact mechanism that leaks · the named syscall declined, marked future · the
threat condition. Both reference projects keep such statements in source and spec files, never a
README.

**These residuals are accepted by the USER, not by this plan.** Gate 2 presents all four with owner,
trigger and remedy; without that acceptance WT-012.21's fourth Acceptance branch is not satisfied and
this change does not close the row.

### D4: The descriptor-validation tier is REJECTED, and the premise that proposed it was wrong

WT-012.21's Notes name cmux's post-open descriptor validation — `fstat` for `S_IFREG`, uid,
`nlink == 1`, `mode & 0o077 == 0` — as "reachable in pure Node and closing strictly more than
nothing". A plan attack showed it closes nothing here, and the reason is the flag:

- cmux opens its lock `O_CREAT | O_RDWR | O_NOFOLLOW` (`cmux/CLI/cmux_open.swift:3298`) — **no
  `O_EXCL`**. It can therefore land on an object that already existed, which is precisely what the
  validation exists to catch.
- This repository opens `wx` = `O_CREAT | O_EXCL` (`lockedJsonFile.ts:275`), which refuses every
  pre-existing object outright, with no descriptor to inspect.

So `O_EXCL` already delivers strictly MORE than the validation, at the only moment the validation
would speak. After a successful `wx` on a real filesystem the object is a regular file this process
just created: `isFile()` cannot be false, and `nlink === 1` and the mode are construction properties.
The three witnesses originally planned against it — a directory, a hardlinked lock, a 0666 lock at
the name — all fail at `wx` with `EEXIST` before any `fstat` runs, so each would have passed without
the code under test existing. What remains is detection of a same-UID mutation in the microseconds
between `open` and `fstat`, by an attacker who by definition can do worse directly.

Worse, refusing on that predicate leaves the lock this process just created sitting at the name, and
nothing reclaims it — a self-inflicted R4 in exchange for nothing.

`0o600` is still passed at creation, as POSIX hygiene and **not** as a security claim: the mutual
exclusion comes from `O_EXCL` on the NAME, and write permission on an empty lock file grants neither
rename nor unlink, which need write permission on the parent directory. It is POSIX-only —
`src/vault/VaultCacheStore.ts:191-196` already records that Node's `mode` argument does not produce
an owner-only ACL on Windows — so no requirement is written against it.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| D1 | A caller depending on the temporary's name or on `writeFile`'s truncate-in-place behaviour | The temporary is private to `atomicReplace`, created and renamed inside one method; nothing outside reads `temporaryPath` |
| D2 wedge (R4) | Cursor leaks a lock it previously cleaned, and the user's config becomes permanently unwritable | Disclosed as R4 and presented for acceptance at Gate 2; `lock-release-failed` (WT-012.22) already gives the caller the vocabulary to report it, so the user is told rather than left guessing |
| D2 test double | Delegation silently mixes the real filesystem into Cursor's memory-fs tests (`lockedJsonFile.ts:80`) | Task 1_2 extends the double with `stat`-carrying handles and bigint `lstat` BEFORE delegating, and asserts no real path is touched |
| D2 seam | Peer commit `132d20ce` relocates the imported module to `src/utils/lockedFile.ts` | One import line; checked against both locations and recorded in workflow.md Notes for the merge |
| D3 | A statement that reads as complete while a fifth race exists | The table is keyed to `file:line`; a new two-call sequence on a pathname is what a reviewer looks for, and R2/R3 show the shape |
| growth axis | None — no new collection, and one extra `open` per staging | n/a |

## Obligation ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| A staged write never lands on an object ALREADY at the staging name | At the `open`, for both staging sites | `fs.writeFile`, which follows a symlink there | Witness pre-placing a symlink at the injected staging name and asserting the target is unmodified; arm-checked by restoring `writeFile` (task 1_1) | supported |
| A staged write cannot be redirected AFTER creation | Not claimed | Reading the row above as covering the whole staging | R3 in D3's table; the spec says "already at that name", never "for the duration" | supported — the narrower claim is the one written |
| A failed staging discards only a temporary it still owns | Between the ownership check and the `unlink`, at the one staging site that now exists | A cleanup that unlinks the pathname unconditionally — which the copied `atomicReplace` did | `stageReplacement`'s `ownsTemporaryPath` guard, plus witnesses failing the handle write, the chmod and the replace and asserting a substituted object survives (task 1_4) | supported to R3's boundary — the check-then-act window is R3's, now inherited rather than added |
| Delegating the lock does not create configuration a user did not have | An absent config parent yields the prior refusal, and nothing is written | `LockedFile.acquireLock`'s recursive `mkdir` | Before/after probe recorded in D2; witness asserting `lock-unavailable` and an untouched parent (task 1_5) | supported |
| The staging name cannot be derived from the clock or the target's name | 16 bytes of `randomBytes` per staging | Keeping `this.now()` as the only entropy | Witness asserting the name contains neither the injected clock value nor a second staging's name (task 1_1) | supported |
| A release removes only the object this operation still identifies at the name | Between the `lstat` and the `unlink` | A substitution scheduled BETWEEN those two calls, which the comparison cannot see | Witness scheduling the substitution inside the injected `lstat`'s return, asserting the substitute is unlinked — a RED that stays red (task 1_2) | **refuted as a continuous claim; supported as written.** R2 owns the gap; the spec says "still identifies", and the witness pins the boundary rather than a fix |
| Cursor no longer deletes a stable foreign lock | The name identifies a different object at release, and it survives | Cursor's unconditional `unlink`, which tests nothing | Witness substituting a stable different file before release, asserting it survives and the result carries `lock-release-failed` (task 1_2) | supported |
| D2 does not silently reach the real filesystem from Cursor's tests | No test path escapes the memory double | `lockedJsonFile.ts:80` spreading real `node:fs/promises` under a partial fake | Witness asserting a real temp dir is untouched after a full install run (task 1_2) | supported |
| Directory substitution is NOT closed | No claim depends on which directory a name reaches | Reading the row's title as delivered | R1; Gate 2 presents it | supported |
| R1-R4 are risks the USER accepts | WT-012.21 branch four requires owner, trigger and user-facing remedy for each | Fastlane auto-choosing it, which the Mode exception forbids for risk acceptance | Gate 2 stops and asks; blueprint sync does not run without it | unresolved — closes at Gate 2, and it is the only row left open |
| The descriptor-validation tier buys nothing here | `wx` is `O_CREAT\|O_EXCL`; cmux's lock open is not | Assuming the cmux tier transfers because both are locks | D4, against `lockedJsonFile.ts:275` and `cmux/CLI/cmux_open.swift:3298`; the three planned witnesses were shown to pass on `EEXIST` before reaching any `fstat` | supported |
