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

### D4: The entry is reconstructed gitdir-first, under an identity that is re-checked

```
read  <wt>/.git                        ← the bytes to restore
mkdir <common>/worktrees/<id>          ← exclusive; EEXIST mints the next id
lstat <common>/worktrees/<id>          ← record dev/ino — the entry's IDENTITY
write <common>/worktrees/<id>/gitdir   = "<wt>/.git\n"          ← FIRST
write <common>/worktrees/<id>/commondir = "../.."
write <common>/worktrees/<id>/HEAD     = "ref: refs/heads/<branch>\n"
lstat <common>/worktrees/<id>          ← identity unchanged, or refuse
write <wt>/.git                        = "gitdir: <common>/worktrees/<id>\n"   ← LAST
git worktree repair <wt>
git -C <wt> rev-parse HEAD             ← == expectedBranchOid, or undo (D5)
git -C <wt> reset --mixed
```

**`gitdir` is written first, and this is the fix for a real race.** `git worktree prune` removes an
administrative entry whose `gitdir` file is missing — verified on git 2.50.1, which reported
`Removing worktrees/<id>: gitdir file does not exist` for both an empty entry directory and one
holding `commondir` and `HEAD`. A concurrent `git worktree add` then mints the same id and writes its
own entry there, and our remaining writes land inside somebody else's registration. `mkdir` being
exclusive says nothing about the interval after it. Writing `gitdir` first closes that interval:
`<wt>/.git` already exists (it is the stale link the detector read), so the entry immediately names an
existing path and prune passes over it.

**`<wt>/.git` is still written last.** Verified on 2.50.1: an entry whose `gitdir` names a `.git` that
exists but points at a different administrative directory is omitted from `git worktree list
--porcelain` and is not pruned. So between `gitdir` and the final write the entry is inert — neither
listed nor collected.

**The identity re-check is not a precheck.** Node exposes no `openat`/`renameat` (WT-012.19), so an
entry directory cannot be held open and written through. `lstat` at `{ bigint: true }` before and
after the three writes, compared through `src/utils/fileIdentity.ts`, is what this repository already
uses for exactly this shape, and it converts a substitution from silent into refused.

Undo is: re-`lstat` the entry, refuse to remove anything whose identity moved, otherwise remove it and
restore the recorded `<wt>/.git` bytes. `adoptWorktree` returns the undo as a handle on SUCCESS too,
because D5's post-write conflict check runs at the caller and needs it.

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

## Obligation ledger

The mutable resource is the repository's own administrative directory, which outlives the request and
is reachable by every other git process on the machine.

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| Adoption never adds a claim to a branch it can see claimed | At the pre-read and again at the post-read, no non-prunable record other than the adopted path names the branch; a claim seen at either point refuses or undoes | An external `git worktree add` that lands after the post-read. Not defeatable by any client: two concurrent adds against one existing branch were both observed to exit 0 on git 2.50.1, so git itself does not exclude them | Integration test driving the add BETWEEN the two reads (undo path) and BEFORE the pre-read (refusal path). The residual after the post-read is stated in D5 as parity with `git worktree add`, and is the state the blueprint's own guard describes | supported |
| The adopted working tree is not modified | Every path under `<wt>` except `<wt>/.git` keeps its bytes and mtime; `<wt>/.git` holds exactly the new `gitdir:` line and nothing else | `reset --mixed` degrading to `--hard`; `repair` rewriting content | Integration test hashing every path under `<wt>` except `<wt>/.git`, with mtimes, on a real repository holding a dirty tracked file and an untracked file — plus a separate assertion on `<wt>/.git`'s exact new content | supported |
| A failed adoption is either undone or reported unfinished | On any failure the entry is removed and `<wt>/.git` restored; where the undo ITSELF fails, the outcome names the entry path and the `.git` state left behind rather than reporting a create | A failure inside the undo — the entry removal, or the `.git` restore | Unit test injecting a failure at each reconstruction step AND at each undo step, asserting the restored state in the first case and the naming of what was left in the second | supported |
| The branch is at the tip the user was shown | After `repair`, `git -C <wt> rev-parse HEAD` equals `expectedBranchOid` | An `update-ref` between the pre-read and the symbolic-HEAD write — which is why the pre-read is not the guard | The post-`repair` read (D5), with a unit test moving the branch between the two reads and asserting undo + refusal | supported |
| A live registration is never adopted over | At the moment of the write, `<wt>/.git` names an administrative directory that does not exist | An external process restoring the old administrative directory during the user's pause, possibly detached or on another branch, which the branch guard would not catch | `probeAdopt` re-run inside the mutation body against `adoptPath` (D5); anything but `adopt` refuses. Unit test restoring the admin directory between resolution and mutation | supported |
| The entry written is the entry created | The three entry files land inside the directory this adoption created, identified by dev/ino rather than by pathname | `git worktree prune` removing an entry whose `gitdir` is missing, then an external add reusing the id — observed on 2.50.1 | `gitdir` written first so prune passes over the entry (D4, verified), plus an identity re-check through `src/utils/fileIdentity.ts` before the final write and before the undo's removal | supported |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `adoptWorktree` | A partial reconstruction leaves the repository listing a broken worktree | `gitdir` first and `<wt>/.git` last (D4, both verified on 2.50.1); identity re-check before the final write; undo on every post-`mkdir` failure, with an undo that fails naming what it left |
| `answerCreateProbe` | A second filesystem read per settled edit, on the create path with a dialog waiting | Runs only for an `occupiedCandidate` the derivation already produced, on a branch the enumeration already named — the common path adds no I/O, matching D2/D3 of resolve-a-selection-before-the-create-runs |
| Branch-claim guard | The pre-read is a claim about a past instant, and git excludes nothing globally | Post-write re-read with undo (D5). The residual past the post-read is parity with `git worktree add`, stated rather than mitigated |
| `createWorktree` | Adopt entering the create-path validation, which refuses an occupied destination | Adopt leaves before `validateCreatePath`, exactly as reattach does (`src/worktree/worktreeMutationService.ts:769`) |
| Windows | Offering an unverified reconstruction that half-works | D7 withholds the mode; WT-012.14 supplies the evidence that flips it |
| `WorktreeCreateDialog` | A silent render regression in a mode nobody exercises by hand | The mode's offer, its refused controls, and its declaration are unit-tested in the dialog's own suite |
