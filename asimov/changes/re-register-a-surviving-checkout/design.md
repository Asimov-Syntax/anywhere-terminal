# Design: re-register-a-surviving-checkout

The wire already carries adopt. `WorktreeCreateMode` has an `adopt` variant with `adoptPath` and
`expectedBranchOid`, `ResolvedMode` has `adopt`, and `intentFor` already maps adopt to
`mustExistAsDirectory`. What is missing is a second detector, an executor, and the form's action —
`sourceOf` still throws for adopt, and the dialog falls back to a fresh create.

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

### D4: The entry is reconstructed under an exclusively created directory, with a recorded undo

```
mkdir <common>/worktrees/<id>          ← exclusive; ENOTEMPTY/EEXIST mints the next id
read  <wt>/.git                        ← the bytes to restore
write <common>/worktrees/<id>/commondir = "../.."
write <common>/worktrees/<id>/HEAD     = "ref: refs/heads/<branch>\n"
write <common>/worktrees/<id>/gitdir   = "<wt>/.git\n"
write <wt>/.git                        = "gitdir: <common>/worktrees/<id>\n"   ← last
git worktree repair <wt>
git -C <wt> reset --mixed
```

`<wt>/.git` is written **last** on purpose: until it points at the new entry, the entry is inert —
`git worktree list` does not report a worktree whose directory does not link back, so every earlier
failure is invisible to the repository rather than half-visible.

Undo is `rm -rf <common>/worktrees/<id>` plus restoring the recorded `<wt>/.git` bytes. It runs on
every failure after the `mkdir`, including a failed `repair` and a failed `reset`. Nothing inside the
working tree is in the undo, because nothing inside it was written.

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

The second read is what closes the window the first cannot: the mutation coordinator serializes this
extension's own mutations per repository, but an external `git worktree add` is not serialized by it.
Reading afterwards and undoing turns an unobservable race into an observable refusal.

The tip is re-checked in the same body: `git rev-parse <branch>` against `expectedBranchOid`, and a
mismatch refuses rather than attaching the checkout to a commit the user was never shown.

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
as a wait. Flipping it when the Windows RESULT block lands is a one-line change plus its test.

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
| No two worktrees hold one branch | After any adoption reports success, exactly one non-prunable record in `git worktree list --porcelain` names the branch | An external `git worktree add <other> <branch>` lands between our pre-read and our write | The post-`repair` listing re-read (D5); two records → undo and report refused. Integration test drives the interleaving by running `worktree add` between the two reads | supported |
| The working tree is not modified | Every file under the adopted directory keeps its content and mtime across the adoption | `reset --mixed` degrading to `--hard`; `repair` rewriting content | Integration test hashing every file plus mtime before and after, on a real repository with a dirty tree | supported |
| A failed adoption leaves nothing behind | On any failure, no administrative entry exists for the directory and `<wt>/.git` holds its original bytes | A failure between the `mkdir` and the `<wt>/.git` write; a failure of the undo itself | Unit test injecting a failure at each of the six steps and asserting the entry directory is absent and the `.git` bytes match | supported |
| The branch is at the tip the user was shown | The adopted worktree's branch resolves to `expectedBranchOid` at the moment the entry is written | The branch moves during the user's pause | `git rev-parse <branch>` re-read in the mutation body, compared to `expectedBranchOid`, refusing on mismatch (D5) | supported |
| A live registration is never adopted over | A directory whose administrative entry exists never reaches adopt | An administrative directory that exists but cannot be read, misread as gone | `readGitLink`/`adminDirExists` already fail closed — `unreadable` declines rather than adopting (`src/worktree/reattachProbe.ts`). Reused unchanged, with a unit test for the unreadable arm on the new detector | supported |
| The entry id names no existing entry | `<common>/worktrees/<id>` is created by this adoption and by nothing else | Two adoptions, or an adoption and a `git worktree add`, minting the same id | `mkdir` without recursion is `O_CREAT｜O_EXCL` for directories: it fails `EEXIST` on any pre-existing entry, and the id advances. No pre-check, so there is no window between deciding and acting | supported |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `adoptWorktree` | A partial reconstruction leaves the repository listing a broken worktree | `<wt>/.git` written last (D4); undo on every post-`mkdir` failure; unit test per injected step |
| `answerCreateProbe` | A second filesystem read per settled edit, on the create path with a dialog waiting | Runs only for an `occupiedCandidate` the derivation already produced, on a branch the enumeration already named — the common path adds no I/O, matching D2/D3 of resolve-a-selection-before-the-create-runs |
| Branch-claim guard | The pre-read is a claim about a past instant | Post-write re-read with undo (D5), not a longer lock |
| `createWorktree` | Adopt entering the create-path validation, which refuses an occupied destination | Adopt leaves before `validateCreatePath`, exactly as reattach does (`src/worktree/worktreeMutationService.ts:769`) |
| Windows | Offering an unverified reconstruction that half-works | D7 withholds the mode; WT-012.14 supplies the evidence that flips it |
| `WorktreeCreateDialog` | A silent render regression in a mode nobody exercises by hand | The mode's offer, its refused controls, and its declaration are unit-tested in the dialog's own suite |
