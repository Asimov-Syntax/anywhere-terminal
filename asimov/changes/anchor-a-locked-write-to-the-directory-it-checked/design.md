# Design: anchor-a-locked-write-to-the-directory-it-checked

## Decisions

### D1: Descriptor-relative anchoring is unreachable, so the blueprint row cannot be delivered as written

Probed on Node v24.7.0 darwin: `fs.openat`, `fs.renameat` and `fs.linkat` are all `undefined`; the
only `fs` names ending in `at` are `fstat`/`lstat`; `FileHandle`'s prototype carries no
descriptor-relative operation; `/dev/fd/<dirfd>/child` was already recorded as unusable on macOS;
and the repository's three dependencies are pure JS, so a native addon would mean prebuilt binaries
per platform, architecture and Electron ABI.

The prior art agrees rather than merely failing to disagree. orca guards leaf opens with
`O_NOFOLLOW` and a `typeof … === 'number'` degradation (`src/main/runtime/orca-runtime-files.ts:170`);
cmux — Swift, with the whole POSIX surface — still writes
`open(lockPath, O_CREAT | O_RDWR | O_NOFOLLOW, 0600)` (`CLI/cmux_open.swift:3298`). Nobody in the
reference set anchors to a directory descriptor, and nobody in the reference set attempts
directory-substitution safety at all.

### D2: The directory-checkpoint machinery is CUT, and this is the honest reason

Three plan attacks refuted the majority of this change's ledger each time, and the third refuted the
rewrite of the second. The machinery that kept failing was always the same one: holding the target's
directory open and comparing its identity before every operation that names a string inside it.

It cannot state its own guarantee. The comparison and the syscall it guards are two calls, so between
them the name can be redirected — and then `open(temporaryPath, "wx")` creates a temporary in the
decoy, the next comparison detects the swap, and cleanup's own guard must refuse to act, leaving the
temporary exactly where the requirement said nothing would be. The mechanism manufactures the
condition it exists to forbid. Adding checkpoints does not shrink that window; it only moves it.

Two further defects made the shape unsalvageable rather than merely leaky: opening the directory
AFTER `mkdir` authorizes whatever the name reaches at open time, so an attacker-selected directory
becomes the operation's identity for every later comparison; and the guard cannot be placed at all
for the read, because task 1_1's own `lstat`-then-open pair inside `openRegularFile` is a second
unguarded window the outer inventory does not reach.

Everything directory-shaped therefore moves to `docs/PLAN.md` WT-012.21, undivided. This change keeps
only what can be stated truthfully and witnessed. That is a real reduction against the blueprint row
and is recorded as such in workflow.md rather than presented as a completed row.

### D3: Ownership identities are compared as bigints

`sameIdentity` already accepts `number | bigint` (`lockedJsonFile.ts:282-285`), but every caller feeds
it ordinary numbers: `handle.stat()` and `this.fs.lstat(...)` without options. An `ino` above 2^53
therefore rounds, and the 2^53 collision WT-012.17's notes record for Windows `st_ino` can make a
DIFFERENT file compare as owned — at `ownsTemporaryPath` (`:107-108`), which then unlinks it, and at
`releaseLock` (`:255-265`), which then unlinks it as a lock.

Both sides of each comparison SHALL be captured `{ bigint: true }`. This is the whole fix; the
comparison itself is already correct.

Note what is NOT a defect, contrary to the first two drafts of this design: `releaseLock` ALREADY
compares the held handle's identity against the lock the path names now and refuses to unlink on a
mismatch (`:253-272`). Release-by-identity does not need to be built.

### D4: Lock-release reporting is NOT in this change — it is its own

The first two attempts at it are recorded in `.reviews/round-1.md` and `.reviews/round-3.md`, and the
second attempt was worse than nothing. `releaseLock` answers a BOOLEAN, and `false` covers four
different situations (`lockedJsonFile.ts:258-275`): an indeterminate inspection failure; `ENOENT`
with `nlink > 0n`, meaning this holder's lock was renamed away and the canonical name is empty; an
identity MISMATCH, meaning a different writer's LIVE lock now holds that name; and a genuine
non-ENOENT unlink failure. Only the last is a leaked lock.

Reporting the pathname for all four told the user to delete another writer's live lock — destroying
the mutual exclusion the lock exists to provide (round 3 F003). The truthful version needs
`releaseLock` to return a typed disposition rather than a boolean, which is a new invariant on the
primitive both config writers depend on, plus a user-facing problem classification this change's spec
does not own (F005). That is a new invariant owner, so it is a separate change by the remediation
boundary, and this one reverts its attempt rather than shipping a harmful half.

### D5: The leaf read refuses a link, for the ordinary case only

`readText` goes through `openRegularFile`, which follows symlinks BY CONTRACT
(`src/utils/regularFileRead.ts`) because a provider file legitimately may be one. A file this
extension EDITS IN PLACE is a different kind of object, and the native writer already refuses a
symlinked target by `lstat` — so the residue is the race between that `lstat` and the open.

`openRegularFile` SHALL take a `noFollow` option as a THIRD argument, leaving `openFile` in position
two so the existing injected-open callers and `provisioningDeps.readBounded` are untouched and keep
following links. The option adds `O_NOFOLLOW` where the platform defines it and otherwise compares
the pre-open `lstat` identity against the opened handle's.

This is bounded ON PURPOSE and the bound is stated rather than discovered later: inode REUSE defeats
the identity comparison — unlink the observed file and create another until the filesystem reissues
its `ino` — and on Windows libuv exposes a 64-bit file ID that Microsoft does not guarantee unique on
ReFS. The claim is therefore made for a non-adversarial filesystem and delegated otherwise, which is
this repository's existing vocabulary for exactly this situation.

### D6: What remains unowned, stated rather than assigned to a task that cannot close it

Lock-release reporting is owned by the change D4 splits out, and carries round 3's F003, F004, F005
and F006 (the duplicated identity helper) as its inputs.

WT-012.21 owns directory anchoring. It does NOT close the LEAF substitution window — even
`renameat(dirfd, tempName, dirfd, targetName)` resolves `tempName` at syscall time, so replacing the
temporary between `ownsTemporaryPath` and the rename still moves the substitute. Closing that needs
an operation tied to the held temporary HANDLE, which POSIX does not offer for rename.

That residual is homeless, and this design does not pretend otherwise by filing it under a task whose
mechanism cannot reach it. It is recorded in workflow.md as needing a blueprint owner.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| ownership identities | Widening to bigint breaks a comparison written for numbers | `sameIdentity` already accepts both; both sides change together in task 1_1, and the existing ownership witnesses cover the ordinary path |
| result vocabulary | A new outcome breaks an exhaustive switch on the writer's result | Task 1_2 changes the type and lets the type checker enumerate the sites; `WorktreeHost` is the only consumer |
| `openRegularFile` | A new argument breaks the provider read, which MUST keep following links | The option is off by default and third in the list; `provisioningDeps.readBounded` passes nothing and `regularFileRead.test.ts:147-155` pins the following behaviour |
| growth axis | One extra `lstat` per locked read | n/a |

## Obligation ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| Ownership cannot be satisfied by a different file through rounding | Temporary and lock ownership compare `dev`/`ino` at full precision | An `ino` above 2^53, which `Number` cannot distinguish | A witness with injected identities differing ONLY above 2^53, asserting ownership is refused; arm-checked by narrowing back to `Number` (task 1_1) | supported — the comparison already exists and already accepts bigint; only the capture changes |
| Ownership precision is all this claims | A same-precision but adversarially reused identity is NOT covered | Reading the row as protection against substitution | D5's stated bound; the spec says "cannot round", never "cannot be substituted" | supported |
| The leaf read reaches the object it inspected, on a non-adversarial filesystem | `lstat` refuses a link; otherwise the opened handle's identity equals the `lstat`'s | Inode reuse; and Windows ReFS, where the exposed 64-bit ID is not guaranteed unique | A witness swapping the target through an injected `lstat` so the swap lands after the observation, asserting refusal with the flag forced absent so the identity check alone carries it (task 1_1) | supported for a non-adversarial filesystem, delegated otherwise — D5 states both defeaters |
| The provider read still follows links | `openRegularFile` without the option behaves exactly as today | Making no-follow the default, or taking position two | `readBounded` passes nothing (`provisioningDeps.ts:41`); `regularFileRead.test.ts:128-155` stays green unchanged (task 1_1) | supported |
| Lock-release reporting is not addressed by this change | No claim in the spec depends on what a save says about its lock | Shipping the reverted attempt, which named another writer's live lock | D4's revert, round 3 F003's probe, and the blueprint task that now owns it | supported — was `refuted` twice, by round 1 F001 and round 3 F003/F004/F005 |
| Directory substitution is not addressed by this change | No claim in the spec depends on the directory the name reaches | Reading the blueprint row's title as delivered | D2's cut, and workflow.md recording the reduction against WT-012.19 rather than ticking it | supported |
| The leaf substitution window has no owner | Neither this change nor WT-012.21's mechanism closes it | Filing it under WT-012.21 to make the ledger look complete | D6, and the workflow.md note asking for a blueprint owner | supported |
