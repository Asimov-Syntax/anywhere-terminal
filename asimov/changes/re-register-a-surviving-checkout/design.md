# Design: re-register-a-surviving-checkout

The wire carries adopt on the SUBMIT half only. `WorktreeCreateMode` has an `adopt` variant with
`adoptPath` and `expectedBranchOid`, and `intentFor` maps adopt to `mustExistAsDirectory` — but
`ResolvedMode.adopt` carries `adoptPath` alone, so the form cannot build the submit mode from a
resolution. The resolution half is the first thing this change closes. After that: a second detector,
an executor, and the form's action — `sourceOf` still throws for adopt, and the dialog falls back to a
fresh create.

## Decisions

### D1: Adopt is resolved from the occupied candidate, not from a second directory read

The surviving checkout is exactly the `occupiedCandidate` that `resolveDestination` already computes
and already reports. Adopt is decided from that candidate plus one `readGitLink` — nothing new is
enumerated and no path is derived twice.

`resolveDestination` finds the derived name taken, suffixes past it, and hands back
`occupiedCandidate: { path, disposition }`. A surviving checkout lands there with `disposition: free`,
because `classifyDestination` reports `free` for anything holding a `.git` — that is the correct
answer to "may this be deleted" and the wrong answer to "what is this". Adopt asks the second
question of the same path.

### D2: Adopt is offered only where the selected branch already exists

The reconstruction writes `worktrees/<id>/HEAD` as `ref: refs/heads/<branch>`, and it promises the
user a tip. Neither is available for a branch nobody has made: the deleted administrative directory
is where the checkout's own HEAD lived, so the surviving directory cannot say which branch it was on.

So the branch comes from the selection, and a selection resolving to `fresh` never resolves to adopt —
the occupied candidate stays occupied and the suffixed fresh path stands. This also makes the two
detectors agree: the prunable path (§ 2.3's probe downgrading to adopt) reaches adopt only for a
branch the listing named.

### D3: Both detectors produce one shape, and the host supplies the tip

| Case | Recognised by | Detector |
|---|---|---|
| A — git still lists the registration | `prunable`, and the `gitdir:` names a directory that is gone | `probeReattach` → `{ kind: "adopt" }` (exists) |
| B — the registration was pruned away | unregistered occupied candidate whose `.git` is a file naming a gone directory | `probeAdopt` (new) |

Neither detector knows the branch tip — case A's probe is path-scoped and case B's directory has no
HEAD left. `answerCreateProbe` fills `expectedBranchOid` from the ref enumeration it already holds,
once, for both cases. A candidate whose tip the enumeration does not carry is not offered as adopt.

The enumeration does not carry it today: `readRepoRefs` asks `for-each-ref` for
`%(refname:short)` alone. It gains `%(objectname)` in the SAME format string, split on the first
space — a ref name cannot contain one — so the tip costs no extra process and no second read that
could disagree with the first about one instant. Reading it separately with `git rev-parse` was
rejected for exactly that: two reads, two instants, and a tip that may not be the one the listing was
built from.

### D4: The entry is reconstructed under a lock, and withdrawn by emptying rather than deleting

```
read  <wt>/.git                        ← the bytes to restore
mkdir <common>/worktrees/<id>          ← exclusive; EEXIST mints the next id
lstat <common>/worktrees/<id>          ← record dev/ino — the entry's IDENTITY
write <common>/worktrees/<id>/locked   = "…"                     ← FIRST
open  <common>/worktrees/<id>/gitdir   O_CREAT|O_EXCL|O_RDWR      ← empty, and HELD
write through that handle              = "<wt>/.git\n"
write <common>/worktrees/<id>/commondir = "../.."
write <common>/worktrees/<id>/HEAD     = "ref: refs/heads/<branch>\n"
lstat <common>/worktrees/<id>          ← identity unchanged, or refuse
write <wt>/.git                        = "gitdir: <common>/worktrees/<id>\n"   ← LAST
git worktree repair <wt>
git -C <wt> rev-parse HEAD             ← == expectedBranchOid, or undo (D5)
git -C <wt> reset --mixed
lstat <common>/worktrees/<id>          ← identity unchanged, or refuse
unlink <common>/worktrees/<id>/locked  ← LAST; the entry becomes an ordinary registration
```

**`locked` is written first, and it is the fix for a real race.** `git worktree prune` removes an
administrative entry whose `gitdir` file is missing or malformed — verified on git 2.50.1, which
reported `Removing worktrees/<id>: gitdir file does not exist` for an entry holding only `commondir`
and `HEAD`, and `invalid gitdir file` for one whose `gitdir` is empty. An exclusive create publishes a
ZERO-LENGTH inode before its bytes land, so an entry under construction is briefly indistinguishable
from a malformed one; a concurrent prune can classify it then and delete it after it has become
valid, and a concurrent `git worktree add` can mint the same id in its place. `mkdir` being exclusive
says nothing about the interval after it. `should_prune_worktree` consults `locked` before anything
else, so the marker closes that whole interval — verified: an entry holding `locked` with an empty
`gitdir` is omitted from `list` and spared by `prune`, and `--expire` does not gate it either.
This is git's own discipline: `worktree add` writes `locked` before `gitdir` (2.50.1
`builtin/worktree.c:490-508`).

**`<wt>/.git` is still written last.** Verified on 2.50.1: an entry whose `gitdir` names a `.git` that
exists but points at a different administrative directory is omitted from `git worktree list
--porcelain` and is not pruned. So between `gitdir` and the final write the entry is inert — neither
listed nor collected.

**The identity re-check is not a precheck.** Node exposes no `openat`/`renameat` (WT-012.19), so an
entry directory cannot be held open and written through. `lstat` at `{ bigint: true }`, compared
through `src/utils/fileIdentity.ts`, is what this repository already uses for exactly this shape, and
it converts a substitution from silent into refused. It gates the ONE act that still addresses a name
— the marker unlink — and it gates it at every caller, the success path included, because a gate
written at one site covered one (round-8 F005).

Undo is: restore the recorded `<wt>/.git` bytes **through the handle D9 pins**, never by pathname —
and then empty the entry rather than remove it.

**The undo removes nothing, and the link's state does not gate what it does.** Rounds 2 through 6 each closed one mutation boundary of the withdrawal and the next round
found the next one, because every version of this rule made the deletion depend on a fact about
`<wt>/.git` — and the check and the deletion are two calls that Node couples by nothing
(`openat`/`renameat`/`linkat` are `undefined`, WT-012.19). The rule is not fixed by a sixth guard and
it is not fixed by refusing to delete. It was the wrong rule.

**The state it was defending against is the state this change exists to recover from.** Verified on
git 2.50.1:

| Destination state | `git worktree list` | `git worktree prune` | `git -C <wt> status` |
|---|---|---|---|
| `<wt>/.git` names an entry that is gone | omitted | leaves it alone | `fatal: not a git repository` |
| entry exists, `gitdir` file missing | omitted | **deletes the entry, leaving `<wt>/.git` dangling** | — |
| entry retained, `gitdir` names an existing `<wt>/.git` | omitted | **never collects it** | — |

A dangling `<wt>/.git` is not damage. It is precisely the precondition `probeAdopt` recognises
(`adoptProbe.ts`), git produces it routinely — row 2 is `git worktree prune` creating it without being
asked — and a retry re-offers adopt on the same directory. Row 3 is what the round-6 amendment would
have shipped instead: an administrative entry no command lists and no command collects, accumulating
one directory per failed attempt because a retry takes `EEXIST` and mints the next id. That is
strictly worse than the state it avoids, and it is the only outcome here a user cannot recover from
without deleting files inside `.git` by hand (oracle A2, reproduced).

**What is achievable, after seven rounds on this one obligation.** Two guarantees were being asserted
together — *always remove the entry this adoption created* and *never remove a replacement at that
pathname* — and they do not coexist under this runtime. Round 7's chair said so; I proposed delegating
the deletion to `git worktree prune` instead, and an oracle attack refuted it with git's own source:
`should_prune_worktree()` returns an entry NAME and `delete_git_dir()` then resolves that name again
and removes it recursively, with no identity or lock recheck in between (2.50.1 `worktree.c:919-963`).
Handing the deletion to git moves this exact race into git rather than ending it. The chair was right
and the third option was not one. So the second guarantee is kept and the first is weakened to what
can be delivered.

The withdrawal therefore DELETES NOTHING. It leaves the entry in the state git already collects:

1. Settle the LINK first, through the handle D9 pins.
2. `ftruncate` `<entry>/gitdir` to zero through a descriptor held since `createEntry` wrote it — safe
   against a different-inode replacement for D9's reason, and never a pathname resolution.
3. Remove the `locked` marker (below), which is what re-admits the entry to collection — and ONLY
   where the entry is still provably this adoption's. This single non-recursive unlink of a file this
   adoption wrote is the one act left that addresses a name; it cannot be made atomic with the
   identity check above it, and its worst case is another process's entry becoming eligible for git's
   collection rather than being destroyed by an `rm -r` on a pathname.
4. Report the entry's path only where steps 2 or 3 could not be completed. An entry git will collect
   is not something a person has to act on; it is omitted from `git worktree list` from step 2 onward.

**`locked` is written FIRST, and it fixes a defect in this decision that predates the amendment.**
`wx` publishes a zero-length inode before the bytes land, so an entry under construction is briefly
indistinguishable from a malformed one, and a concurrent prune can classify it invalid and delete it
after it has become valid. Git guards its own construction the same way — `worktree add` writes
`locked` before `gitdir` (2.50.1 `builtin/worktree.c:490-508`) — and `should_prune_worktree` consults
`locked` before anything else. Verified on 2.50.1: an entry holding `locked` and an empty `gitdir` is
omitted from `list` and spared by `prune`; removing `locked` makes the next prune report `Removing
worktrees/<id>: invalid gitdir file`. `--expire` does not gate a malformed entry. So the marker is
written before `gitdir`, removed on success after the branch tip is re-proved, and removed by the
withdrawal at step 3.

The claim this decision now makes is therefore: **a withdrawal never deletes a directory, and leaves
the entry it created where git's own collection will take it.**

**Stated residuals.** A same-inode writer — `git worktree repair` — can repurpose our `gitdir` inode
between creation and the truncate, exactly as D9 states for `<wt>/.git`; the descriptor is parity with
that writer, not exclusion of it, and D4 no longer borrows D9's argument without its limit. Where the
truncate cannot be made, `locked` is left in place so that a state this process could not finish is
not offered to anyone's prune, and the entry path is reported. And where no prune ever runs the
entries accumulate — bounded by the existing attempt cap on minting ids, visible in `list` to nobody,
and recovered in full by a single later prune. A withdrawal leaves the destination re-adoptable, not
byte-identical.

`adoptWorktree` returns the undo as a handle on SUCCESS too, because D5's post-write conflict check
runs at the caller and needs it.

`reset --mixed` is not cleanup. The index lived in the deleted directory; until it is rebuilt every
tracked file reports as both deleted and untracked. It writes the index and touches no file
(worktree-create.md § 2.4).

### D5: The branch-claim guard is read inside the mutation body and re-proved after the write

`git worktree add` refuses a branch another worktree holds; a reconstructed entry never reaches that
check and git says nothing. So adopt reads `git worktree list --porcelain` itself:

- **Before** the `mkdir`: any non-prunable record whose branch is the selected one → refuse, no
  confirmation path, nothing written. This is a refusal in the sense of worktree-removal.md § 2.2.
- **After** `repair`: exactly one non-prunable record holds the branch, and its path is the adopted
  directory. Two → undo (D4) and report refused.
- **The registration state is re-established too**, not carried from the probe: `probeAdopt` is re-run
  against `adoptPath` inside the body, and anything but `adopt` refuses. Without it an external process
  that restores the old administrative directory during the user's pause is adopted over — the
  selected-branch guard does not see it, because that restored entry may be detached or on another
  branch. This is the same discipline reattach already applies at
  `src/worktree/worktreeMutationService.ts:789-818`.

**What the second read closes, and what it does not.** The mutation coordinator serializes this
extension's own mutations per repository; an external `git worktree add` is not serialized by it, and
git does not serialize it either — two concurrent `git worktree add <path> <existing-branch>` runs
were observed on 2.50.1 to BOTH exit 0 and produce two symbolic HEADs naming the same branch. So no
client can promise global mutual exclusion on a branch, and this change does not.

The claim is therefore narrower, and it is the one the blueprint actually asks for: adoption never
proceeds against a claim it can observe, and it withdraws from one that appears while it works. An
external add that materializes after the post-read leaves the same two-holder state a plain
`git worktree add` leaves, with the same absence of a warning. Adopt is at parity with the supported
command rather than worse than it, and the ledger row says exactly that.

**The tip guard is a post-check, not a pre-check.** `git rev-parse <branch>` before the write is
defeated by an `update-ref` landing between the read and the symbolic-HEAD write. So the guard is
read AFTER `repair`, from inside the worktree — `git -C <wt> rev-parse HEAD` — against
`expectedBranchOid`; a mismatch undoes and refuses. The pre-read stays, because refusing early is
cheaper, but it is not what the claim rests on.

### D6: Adopt refuses the base ref and the destination control

Adopt takes its starting point and its directory from what already exists, so both controls are
unavailable with a stated reason, on the rule `reuse` and `reattach` already follow. This replaces the
current `takesBase = mode.kind === "fresh" || mode.kind === "adopt"` in `answerCreateProbe`, which was
correct only while the form turned adopt into a fresh create.

### D7: Adopt is offered where the reconstruction has been recorded, and withheld elsewhere as unverified

`process.platform === "win32"` withholds the offer until WT-012.14 records its run. The wording is
"not yet verified on this platform", never "does not work here" — WT-012.14's own acceptance is
explicit that an unrun recipe is not a failed one, and a fabricated failure reason would be a claim
nobody established.

This is the dependency WT-012.15 already declares on WT-012.14, expressed as one predicate rather than
as a wait.

**The flip is owned, not left hanging.** WT-012.14's acceptance already ends "whichever holds is
written into the design"; this predicate is that writing. Its two outcomes are named there rather than
left to whoever notices: a PASS sets the default true, a FAIL leaves it false and replaces the reason
with the captured failure — never with "unverified", which is only correct while the recipe is unrun.
WT-012.15 ships the predicate and its two witnessed arms; WT-012.14 ships the value.

The gate is a parameter with a default, not a bare `process.platform` read at the call site, so both
arms are witnessable from either platform — the shape `readFlags` uses in `src/utils/regularFileRead.ts`.

### D8: What adoption cannot restore is declared, never probed

The five losses (index, in-progress operation, per-worktree refs and reflog, `config.worktree`, locked
state) are a fixed list stated in the confirmation. None can be probed after the fact — the directory
that held the evidence is what was deleted — and a check that cannot fail is worse than a stated
limitation (worktree-create.md § 2.4).

### D9: `<wt>/.git` is written through one pinned handle, and the claim is narrowed to what git itself permits

Rounds 1 through 3 attacked the same defect three times without naming it: this code proves things
about a PATH and then writes to that path BY NAME. Byte comparison (round 2) narrowed the window; it
cannot close it, because the second read and the write are still two separate resolutions of the same
name. So the name is resolved once, and the claim is then cut down to what a client can actually
promise.

**What no client can promise here, evidenced rather than assumed.** `git worktree repair` writes
`<wt>/.git` through git's own `write_file_buf`, which opens `O_WRONLY | O_CREAT | O_TRUNC` and
rewrites the EXISTING inode in place (git 2.50.1 `wrapper.c:682-688`, called from
`worktree.c:887-890`). It takes no lock on that file. So a same-inode writer is not an adversarial
schedule — it is git's ordinary behavior, and nothing this process holds can exclude it: not a handle,
not a byte comparison, not an identity check. This is the same shape D5 already established for the
branch claim, where two concurrent `git worktree add` runs against one existing branch were both
observed to exit 0. **The claim is therefore parity with `git worktree repair`, not exclusion of it**,
and the ledger rows say so rather than promising a guarantee this file cannot keep. Our own instances
need no mechanism for this: the mutation coordinator already serializes them per repository (D5).

**What the handle does buy, stated at its real size.** `<wt>/.git` is opened `O_RDWR` (no `O_TRUNC`,
`O_NOFOLLOW` where the platform defines it) once, before the `mkdir`, and held. Every read and write
of that file goes through it. A writer that REPLACES the file — `rename`, or `unlink`+`create`, which
is what a careful writer and every atomic-save library does — gives the path a new inode while our
handle keeps the old one, so our write cannot land on the replacement. That is a real subset of the
destructive case F005 and F006 each described, and it is the subset a second careful process
produces. The subset it does not cover is the in-place writer above.

```
open   <wt>/.git  O_RDWR|O_NOFOLLOW    ← the ONE resolution of this name
fstat  handle                           ← isFile(), and the identity later checks compare to
read   handle at position 0             ← == staleLink, or refuse before anything is created
   … the entry is built (D4) …
read   handle at position 0             ← still the bytes we proved
lstat  <wt>/.git  == fstat(handle)      ← the name still means our object
truncate handle 0 ; write handle ourLink at 0, to completion
lstat  <wt>/.git  == fstat(handle)      ← our write landed at the name, not on a detached inode
```

**Reads are positioned, never sequential.** `FileHandle.readFile` reads from the handle's CURRENT
offset, so a second `readFile` on one handle returns zero bytes — which this design would read as an
empty link and refuse every ordinary adoption on its second proof. Both reads pass an explicit
position of 0.

**A write that never began is not a write that failed, and `nlink` is not a boolean.** A rejecting
`truncate`/`write` and the link-count refusal both handed the caller one `false`, which it read as
content nobody can vouch for — so a claim refused BEFORE its first mutation was reported as an unknown
link, and in the pruned same-name case that retained a live registration (round-6 F015). Worse, the
refusal collapsed two link counts that mean opposite things (oracle B1):

| `nlink` at the sample | What the descriptor proves | Outcome |
|---|---|---|
| `0` | the pinned object has NO name left — `<wt>/.git` is now a different object, or gone. This adoption is not the link and cannot be | `notWritten`, and the link is `leftAsFound`: we demonstrably changed nothing and demonstrably no longer own it |
| `> 1` | our object carries our name AND an alias; truncating would rewrite a file outside the checkout (round-4 F013) | `notWritten`, link ownership unchanged |
| `1` | exactly one name, and the identity comparison says that name is `<wt>/.git` | the write proceeds |

So the write reports THREE outcomes: `wrote`; `notWritten`, for either link-count refusal and for a
rejected `truncate`; and `unknown`, for a failure at or after `truncate` has RETURNED. Only `unknown`
triggers the stale-byte recovery and the unvouchable-content report.

**A rejected `truncate` is classified `notWritten` on a documented guarantee, and the interface has to
carry it.** POSIX specifies that an unsuccessful `ftruncate` leaves the file unaffected, and
production delegates straight to `FileHandle.truncate` (`extension.ts`), so `EINTR`/`EIO`/`EROFS` and
the rest change nothing — this does not reopen round-3 F012, whose defect was `fs.writeFile` opening
`w` and truncating before the first byte (oracle B2). But `LinkHandle.truncate` is an injected seam,
and a fake that mutates and then rejects would violate a contract the type does not state. The
interface documents the guarantee it depends on, and the suite carries a case asserting a rejecting
`truncate` leaves the bytes intact — otherwise the classification is an assumption about a test
double rather than about the filesystem.

**Writes are accounted to completion.** `FileHandle.write` fulfills with `bytesWritten` and is not
required to have written the whole string. Taking fulfilment for completion leaves a partial `.git`
that both identity checks accept, so the write loops on the remainder until every byte is written. A
fulfilled write of ZERO bytes is not progress — looping on it is a hang rather than an error — so
that alone ends the write and takes the recovery path below.

**Ownership is "the link resolves to OUR entry", not byte equality.** Byte equality was the round-2
answer and it is wrong for a reason that has nothing to do with races: with `worktree.useRelativePaths`
set, `git worktree repair` legitimately rewrites the link we just wrote into relative form (git 2.50.1
`worktree.c:875-876, 1085-1090`) — reproduced against a hand-built entry of exactly this adoption's
shape, where repair reported `.git file absolute/relative path mismatch` and left `gitdir: ../repo/...`
behind. The undos D5 reaches — the branch-claim contender and the tip
mismatch — all run AFTER `repair`, so byte equality would report our own link as a stranger's on the
common failure path and leave `<wt>/.git` naming an entry the undo then removed. So the undo parses
the current link with the same grammar the detector uses and asks whether it resolves to the entry
directory this adoption created, identified by dev/ino. A link that does not is left alone and
reported as found.

**The restore is proved on both sides of itself.** `stillOurLink()` samples the path against the
handle and returns, so the write that follows it is once again a check-then-write — the shape rounds
2, 3 and 4 each caught. The handle means the write cannot damage a replacement, so what is left is a
REPORTING defect: the withdrawal says `restored` while the link at that name is somebody else's. The
identity is therefore compared again after the restore, and a divergence downgrades the outcome to
`leftAsFound`. That is all this can be: the sample-write-sample shape is the same endpoint check
stated below, and no ordering of two syscalls makes it atomic.

**The pinned object must have exactly one name.** `O_NOFOLLOW` refuses a symlink AT the leaf; nothing
in it refuses a HARD LINK, and `isFile()` is true of an inode with `nlink > 1`. Truncating such a
descriptor rewrites every alias, including one outside the checkout — an adoption writing a file the
user never pointed it at (round-4 F013). Unlike the in-place writer above this is observable before
the write: `nlink` is in the `fstat` already taken. So the open refuses `nlink !== 1`, and the count is re-read
immediately before EVERY write through the handle — the claim, the failed-claim recovery, and the
undo's restore. The check belongs to the operation and not to the site: written at the site it
covered one of the three callers, and an alias made after a successful claim was rewritten by both
of the others (round-5 F013). This
repository already refuses on exactly this at `src/agentHooks/install/lockedJsonFile.ts`. What stays
open is an alias created AFTER the last check, which is the same instant the identity comparison
cannot cover.

**The handle outlives the function, because the undo does.** `adoptWorktree` returns its undo on
SUCCESS — D5's post-write branch and tip checks run at the caller and both can withdraw — so closing
the handle in a `finally` would hand back an undo that can only fail `EBADF` or reopen by name and
lose the pin. The result carries the handle instead: `undo()` closes it as its last act, and the ok
result gains `release()` for the caller that accepts the adoption, which
`src/worktree/worktreeMutationService.ts:930-940` must call on the success return it currently takes
without disposing anything.

**A write that begins and does not finish is a third outcome, not a clean failure.** `truncate(0)`
then a complete `write` through the handle: if either fails, `staleLink` is re-written through the
same handle. That recovery is an opportunity and not a guarantee — `ENOSPC`, `EIO` and a revoked
handle commonly reject it too, so the unknown-content outcome is an expected result for those causes
rather than an exotic one, and it names the directory. Reporting it as an ordinary failure is what
round 3's F012 falsified: the message told the user nothing had changed while `.git` was empty.

Ordering is `truncate` then `write` rather than write-then-truncate: a short write over longer old
bytes leaves a valid first line followed by a fragment of the old one, and git's `read_gitfile_gently`
accepts that first line — a file that reads as VALID and names the wrong administrative directory is
worse than one that reads as empty. Neither ordering is atomic, and a temp-file-plus-`rename` was
rejected for making it worse: `rename` replaces whatever is at the name, so it would clobber a
different-inode replacement unconditionally — trading a detectable failure for an undetectable one.

**The identity comparison is an endpoint check and is documented as one.** It answers "does this name
resolve to this handle's object now?" at two instants. It does not linearize the interval between
them: an A→B→A substitution passes both, and `src/utils/fileIdentity.ts` already records that the
predicate is bounded by inode reuse and by the file id Windows does not guarantee unique on ReFS.
Adopt is withheld on win32 until WT-012.14 (D7), where `O_NOFOLLOW` is additionally a no-op — libuv
defines `UV_FS_O_NOFOLLOW` as 0 — so the leaf-symlink refusal there rests on the `fstat` regular-file
test alone. Supported filesystems are the local ones git itself supports; a filesystem synthesizing
unstable `dev`/`ino` degrades this check to nothing, and that is stated rather than mitigated.


## Obligation ledger

The mutable resource is the repository's own administrative directory, which outlives the request and
is reachable by every other git process on the machine.

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| Adoption never adds a claim to a branch it can see claimed | At the pre-read and again at the post-read, no non-prunable record other than the adopted path names the branch; a claim seen at either point refuses, or withdraws — and where the withdrawal cannot complete, the outcome says the claim is still there rather than reporting a refusal that cleaned up | An external `git worktree add` after the post-read — not defeatable by any client, since two concurrent adds against one existing branch both exit 0 on git 2.50.1. And a withdrawal that cannot finish: an undo that cannot empty or unlock its entry, or whose handles were closed before the caller reached it (oracle finding 1 — the success path closed the handle in a `finally` while `undo` is returned to the caller and invoked at `worktreeMutationService.ts:919`) | Integration test driving the add BETWEEN the two reads (undo path) and BEFORE the pre-read (refusal path); unit test failing the unlock on the post-read withdrawal and asserting the message names the surviving entry. Both handles are carried on the result and closed exactly once by `undo()`/`release()`, asserted on both terminal paths (round-8 F019), so the deferred withdrawal is reachable at all. The residual after the post-read is D5's stated parity with `git worktree add` | supported |
| The adopted working tree is not modified | Every path under `<wt>` except `<wt>/.git` keeps its bytes and mtime; `<wt>/.git` holds exactly the new `gitdir:` line and nothing else | `reset --mixed` degrading to `--hard`; `repair` rewriting content | Integration test hashing every path under `<wt>` except `<wt>/.git`, with mtimes, on a real repository holding a dirty tracked file and an untracked file — plus a separate assertion on `<wt>/.git`'s exact new content | supported |
| A withdrawal deletes nothing, and leaves its entry where git's collection takes it | The link is settled first through its pinned handle; `<entry>/gitdir` is then truncated through a descriptor held since creation, the `locked` marker written before `gitdir` is removed, and the entry is then git's to collect. No pathname is deleted and no repository-wide command is run. The entry path is reported ONLY where that handoff did not complete — where the truncate or the unlock failed, `locked` is left in place and the path names what git will not collect | The absolute form — always remove the created entry — is REFUTED and has been dropped: `identify` then `removeDir` is a check-then-mutate pair (round-7 F005), and delegating to `git worktree prune` moves the same pair into git, which resolves the entry name a second time inside `delete_git_dir()` with no recheck (oracle 3, git 2.50.1 `worktree.c:919-963`). Also refuted and now fixed: `wx` publishes an empty inode before its bytes, so a concurrent prune could classify a half-built entry invalid and delete it once valid (oracle 7) — `locked` is written first, as git's own `worktree add` does. NOT closed, and stated: `git worktree repair` truncating our `gitdir` inode in place (oracle 1, the same limit D9 already carries for `<wt>/.git`); and accumulation where no prune is ever run | The four states verified against git 2.50.1 and tabulated in D4, including the locked-and-malformed entry that `prune` spares and `list` omits. Unit tests: a replacement of the entry directory between creation and withdrawal, asserting the replacement's files are intact and OUR detached object was the one truncated; an alias on `<entry>/gitdir` refusing the truncate; a truncate that rejects, asserting `locked` SURVIVES and the outcome names the entry. Integration: `locked` present for the whole construction interval; after a withdrawal the entry is omitted from `git worktree list`, a real `git worktree prune` then collects it, and `probeAdopt` offers the directory again. Witnessed as an ABSENCE: `AdoptFs` offers no recursive removal at all, and the only `rm` a withdrawal issues is the marker's. The unlock's ownership gate is witnessed on BOTH callers, including the success path (round-8 F005), and a write that fails after the entry's inode is published still leaves the entry collectable (round-8 F017) | supported |
| The branch is at the tip the user was shown | After `repair`, `git -C <wt> rev-parse HEAD` equals `expectedBranchOid` | An `update-ref` between the pre-read and the symbolic-HEAD write — which is why the pre-read is not the guard | The post-`repair` read (D5), with a unit test moving the branch between the two reads and asserting undo + refusal | supported |
| A live registration is never adopted over by any writer this process can distinguish | The write lands on the object `<wt>/.git` was opened as, that object held `staleLink` at the last read, the administrative directory it names is still absent, and the name still resolves to that object afterwards — or the adoption refuses. Against an in-place writer of the same inode this is parity with `git worktree repair`, which takes no lock and truncates in place, and NOT exclusion | An external process restoring the administrative directory during the user's pause (closed by re-running `probeAdopt` in the body, D5); a different-inode replacement of the link (closed by the handle pin); an A→B→A substitution across the two identity samples, and an in-place rewrite of the pinned inode — neither closed, both stated (oracle findings 2 and 5) | `probeAdopt` re-run inside the mutation body against `adoptPath` (D5); the handle pin with pre- and post-write identity comparison. Unit tests: restore the admin directory between resolution and mutation; replace the link through the inode table between the final read and the write, asserting the replacement's bytes are intact and the adoption refused. The unclosed residual is evidenced against git 2.50.1 `wrapper.c:682-688` rather than asserted away | supported |
| The object written has exactly one name | At the open, and again immediately before EVERY write through the handle — claim, recovery and undo restore — the pinned descriptor's `nlink` is 1, or that write does not happen | A `.git` hard-linked to a second path, which `O_NOFOLLOW` does not exclude and `isFile()` accepts: truncating the descriptor rewrites every alias, including one outside the checkout (round-4 F013). An alias created after a successful claim, which the recovery and the undo restore both rewrote because the guard sat at the claim site rather than in the write (round-5 F013). Not closed: an alias created after the last check, the same instant the identity comparison cannot cover | `nlink` rides on the `fstat` already taken and is refused inside the write itself, so all three callers inherit it — the discipline `src/agentHooks/install/lockedJsonFile.ts` already applies. Unit cases for an alias at the open, before the claim, and appearing before the undo's restore; a real-filesystem case that hard-links `<wt>/.git` and asserts the adoption refuses with the alias's bytes intact | supported |
| A link write that does not finish is reported as unestablished | The claim write loops on the remainder until every byte is written, and reports `wrote`; `notWritten` for either link-count refusal and for a rejected `truncate`; or `unknown` for a failure at or after `truncate` RETURNED. Only `unknown` re-writes `staleLink` and reports unvouchable content. `nlink === 0` additionally settles link ownership: the pinned object has no name, so the link is `leftAsFound` and is not restored | Round-3 F012 (`fs.writeFile` opens `w`). Oracle finding 4 (`write` fulfils short). Round-6 F015: one boolean could not separate a refusal that mutated nothing from a half-finished write. Oracle B1: `nlink === 0` and `nlink > 1` mean opposite things — the first is positive evidence the link was REPLACED — and collapsing them let a refusal be reported as an untouched link. Not closed: an alias created between the sample and the `truncate`, the instant the check cannot cover (D9) | Unit tests: a `write` that truncates then rejects; one fulfilling half the bytes, asserting the link ends WHOLE; one fulfilling zero; a recovery that succeeds and one that fails. For the new outcomes: an `nlink === 0` replacement before the claim, asserting `leftAsFound`, that the REPLACEMENT's bytes are the ones left at the name, and that the entry was still handed over collectable with no path reported; an alias before the claim in the pruned SAME-NAME shape, asserting the residue does not say `unknown`; the failed-claim recovery boundary (round-6 F016). Plus a case asserting a REJECTING `truncate` left the bytes intact, so the POSIX guarantee the classification rests on is checked at the seam rather than assumed of the double | supported |
| The entry written is the entry created | The three entry files land inside the directory this adoption created: `gitdir` through a descriptor held from its creation, the other two under the `locked` marker | `git worktree prune` classifying a half-built entry — an exclusive create publishes an empty inode before its bytes — and an external add then reusing the id, both observed on 2.50.1 | `locked` written FIRST so prune passes over the entry for the whole construction interval (D4, verified, and the order `git worktree add` itself uses), plus an identity re-check through `src/utils/fileIdentity.ts` before the final write and inside every marker unlink | supported |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `adoptWorktree` | A write addressed by pathname lands on an object it never proved | One `O_RDWR` handle on `<wt>/.git` held across the reconstruction, with `fstat`-vs-`lstat` identity compared before and after the write (D9). Reads and writes of that file go through the handle and nowhere else |
| `adoptWorktree` | The object proved is reachable under a name the adoption was never pointed at | `nlink !== 1` refused at the open and re-read before the claim (D9) |
| `adoptWorktree` | A partial reconstruction leaves the repository listing a broken worktree | `locked` first, then `gitdir` through a descriptor held from its creation, and `<wt>/.git` last (D4, all verified on 2.50.1) — the marker spares the entry from `prune` for the whole construction interval, and the descriptor means no window publishes an inode nobody holds; identity re-check before the final write; undo on every post-`mkdir` failure, with an undo that names only the entry git's collection will not take |
| `answerCreateProbe` | A second filesystem read per settled edit, on the create path with a dialog waiting | Runs only for an `occupiedCandidate` the derivation already produced, on a branch the enumeration already named — the common path adds no I/O, matching D2/D3 of resolve-a-selection-before-the-create-runs |
| Branch-claim guard | The pre-read is a claim about a past instant, and git excludes nothing globally | Post-write re-read with undo (D5). The residual past the post-read is parity with `git worktree add`, stated rather than mitigated |
| `createWorktree` | Adopt entering the create-path validation, which refuses an occupied destination | Adopt leaves before `validateCreatePath`, exactly as reattach does (`src/worktree/worktreeMutationService.ts:769`) |
| Windows | Offering an unverified reconstruction that half-works | D7 withholds the mode; WT-012.14 supplies the evidence that flips it |
| `WorktreeCreateDialog` | A silent render regression in a mode nobody exercises by hand | The mode's offer, its refused controls, and its declaration are unit-tested in the dialog's own suite |
