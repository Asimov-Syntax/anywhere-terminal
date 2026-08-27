# Design: wire-worktree-mutating-actions

## Architecture

```
webview                          host
───────                          ────
menu / dialog
  └─ worktreeCreate ─────────┐
     worktreeRemove          │
     worktreeLock/Unlock     ├──▶ WorktreeHost switch
     worktreePrune ──────────┘         │
                                       ▼
                              mutationQueue.run(repoId)      ← D1 (own lock, NOT rebuildGate)
                                       │
                              await gate barrier             ← D12 (resolve against the rebuilt tree)
                                       │
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                  re-resolve id   evaluateBlockers  validatePath  ← D2, D6
                  (actionPath)         │             (create only)
                                       ▼
                          refusal? ──yes──▶ RemovalRefusal (no fingerprint)  ← D3, D4
                                       │no
                                       ▼
                            fingerprint over IDENTITIES    ← D3
                             identity-preserving? ──no──▶ needsConfirm (new evidence)
                                       │yes
                                       ▼
                       gitCommandRunner (argv, per-call timeout)  ← D5
                                       │
                                       ▼
                         gate.request(repoId, {force:true})   ← always, incl. failure/timeout
                                       │
                                       ▼
                       journal vs listing; killed ⇒ always ──▶ indeterminate  ← D11
                                       │
                                       ▼
                              release queue in `finally`     ← D12
```

## Decisions

### D1: Mutation serialization is its own per-repo lock, not the rebuild gate

Mutating actions serialize per `repoId` through a lock this change adds. They do **not** borrow
`rebuildGate`.

`rebuildGate` is serialized per `repoId` already (`rebuildGate.ts:90-98`), which makes it look like
the obvious home. It is not: it **coalesces** concurrent requests (`:158-203`), which is right for
rebuilds — two callers wanting a fresh tree want the same tree — and wrong for mutations, where two
removals must both run, in order, or the second must be told the first happened. Coalescing them
would silently drop one. The gate keeps its job; the queue is a separate, non-coalescing lock.

Serialization covers **this extension host only**. Another window, or a bare `git` invocation, is
outside it — stated in `worktree-actions.md` § 3.3 and not weakened here.

### D2: One evaluator produces the whole blocker set, from sources that already exist

A single host-side evaluator computes every blocker for a target in one pass. It reads:

| Blocker | Source | Already exists |
|---|---|---|
| `isMain` | `WorktreeInfo.kind` from the cached listing | yes |
| `locked` | the cached listing | yes |
| `dirty`, `untracked` | one `git status --porcelain` in the worktree | runner exists |
| `idlePanes` | `PaneEvidenceStore.panes()` + cwd containment + `activityFor()` | yes |
| `busyAgents` | **window-owned** rows only — `scope !== "external"` — whose activity is `running`/`waiting` | yes |
| `externalAgents` | the deduplicated `runningSessions` registry identity set attributed to the path | yes |
| `containsWorktree` | the cached listing for this repo | yes — see D4 |

One pass, because the confirmation has to name all of them at once (`worktree-actions.md` § 3.3) and
because a set assembled from several reads taken at different moments is not a set anyone confirmed.
Containment uses `src/utils/pathBoundary.ts`, never `startsWith` — `worktree-model.md` § 3.1.

**`busyAgents` excludes external rows, and this is load-bearing.** `presenceProjector.ts:365-370`
emits every external registry session as a row with `scope: "external"` and a hardcoded
`activity: "running"`. Counting "projected rows whose activity is running" would therefore score one
external session as both `busyAgents` and `externalAgents` — converting the accepted **confirmable**
`externalAgents` blocker (`worktree-actions.md:192`) into an unconditional refusal, and making a
worktree unremovable because some other window has a session in it. `busyAgents` is window-owned
rows only.

### D3: The fingerprint is issued by the host and verified against a re-evaluation

The host derives the fingerprint from **identity-bearing evidence**, not from the display counts,
records what it has issued per `worktreeId`, and on a forced action re-evaluates and compares.

Counts cannot see substitution. `dirty: true` with `README.md` cleaned and `.env` newly dirty is
still `dirty: true`; `idlePanes: 1` with pane A closed and pane B opened is still `idlePanes: 1`.
Every declared field would compare equal-or-smaller and the force would proceed against files and
panes nobody confirmed. The fingerprint therefore covers: the normalized **relative-path sets** for
dirty and untracked, the **pane id set**, the **external session id set**, `locked`, and the
**contained worktree id set**. Only an identity-preserving subset proceeds — A replaced by B
re-prompts even when the count is unchanged.

| Re-evaluated set vs. the set the fingerprint names | Result |
|---|---|
| identical | proceed |
| every blocker same or smaller | proceed — strictly less is at risk than was approved |
| any blocker appeared or grew | `needsConfirm` with the new set and a new fingerprint |
| fingerprint not one this host issued for this target, or expired | `needsConfirm` — authorizes nothing |
| `busyAgents > 0`, `isMain`, or `containsWorktree` non-empty | refused; **no fingerprint is ever issued** for these (D4) |

Issued fingerprints expire, so one recovered from stale webview state cannot authorize a removal
minutes later. Comparison is per-field and subset-based, not string equality: string equality alone
would re-prompt when a blocker *shrank*, which is the case the design explicitly wants to let
through.

A refusal must not be able to carry a fingerprint at all — "a busy agent went idle" must never read
as a shrinking set, because no fingerprint should have existed while `busyAgents > 0`. A single
always-present `fingerprint` field cannot express that, so the evaluator's output is three types
(§ Interfaces): `RemovalEvidence`, `ConfirmableRemoval { evidence, fingerprint }`, and
`RemovalRefusal` — which structurally has no fingerprint.

### D4: A worktree containing another registered worktree is refused, not confirmed

Removal is refused outright — no confirmation path — when the target contains another worktree the
repo has registered.

`git worktree remove --force` treats a nested registered worktree as an ordinary untracked
directory: it deletes the child's working files and leaves git holding a prunable child record.
`worktree-actions.md` § 3.3's blocker table has no equivalent, so this is an **addition to the
accepted safety model**, not an implementation of it. The reference implementation refuses for the
same reason (`orca/src/main/worktree-removal-safety.ts:134-152`) — that path is outside this
repository, so it corroborates the reasoning and is not load-bearing evidence for it; the argument
above stands on git's documented `--force` behavior alone.

Refused rather than confirmable, because a confirmation cannot honestly describe the loss: the user
is removing worktree A and would lose worktree B, which the dialog is not about. Making it
confirmable would require a different, recursive operation that evaluates and names every contained
target and each of *its* blockers — not this dialog.

Our own exposure is **narrow, not zero**, and the earlier claim that this extension cannot create
nesting was too strong. Ordinary creation under a linked worktree is rejected by validation, and
nesting under the main worktree is survivable only because main is unremovable. But D6's
acknowledged symlink/mount race and the documented-unsupported path aliases can still land a create
inside another worktree through this extension. The blocker therefore carries **every** contained
worktree — an array of normalized ids with display paths, not a single one — because a parent can
hold more than one child and naming only the first understates the loss.

**Accepted-doc conflict, resolved here.** `worktree-actions.md:132-134` requires a create path
"outside every existing worktree of the repo", while `worktree-rpc.md:202` states that a path inside
the **main** worktree is allowed because that is where the default root lives, which
`worktree-actions.md:345` and D8's `info/exclude` write both depend on. The rpc reading governs;
`worktree-actions.md:132-134` is the outlier and is flagged for correction at Blueprint Sync.

### D5: Removal carries its own timeout, separate from the listing's

This is the accepted design's own rule, not an addition: `worktree-actions.md:267-269` states that
"the 10 s timeout applies to read-only listings. Mutations get a longer budget and a cancellable path
where one exists, because killing git mid-write is the thing that creates these states in the first
place." Listing keeps the 10s timeout (`worktree-model.md` § 6).

`git worktree remove` performs the recursive delete synchronously, so under a 10s limit an ordinary
removal of a large worktree is killed mid-delete and lands in the `indeterminate` path (D11) as the
routine outcome rather than the exceptional one — which would train the user to ignore the one signal
that means "state is unclear". The reference implementation's 8-35s on a checkout with a large
`node_modules` (`orca/src/main/worktree-trash.ts:1-3`) is corroborating measurement from outside this
repository, not the source of the rule.

**This needs an API that does not exist.** `GitCommandRunner.run(args, cwd)` takes no timeout;
the timeout is fixed per-runner at construction (`gitCommandRunner.ts:32-45`). Choosing a larger
constant is not implementable against the current interface, so this change adds either a per-call
timeout/cancellation parameter or a dedicated mutation runner instance — and the **cancellable path**
the authority asks for is carried on that same seam.

We do **not** adopt the reference's trash-rename trick: `worktree-actions.md` § 3.1 rule 3 delegates
all deletion to git, and renaming a directory out from under git to make the UI feel faster is
exactly the class of path handling that rule exists to forbid.

### D6: The create path is validated as untrusted input, and re-validated at execution

Create is the one action with no host-issued id to re-resolve from, so validation is the only
barrier. The pipeline, per `worktree-actions.md` § 3.2 and `worktree-rpc.md` § 4:

**Order matters, and the obvious order is wrong.** `normalizeWorktreePath` step 2 realpaths the
nearest existing ancestor (`worktree-model.md:88-89`). Normalizing first therefore *resolves away*
the very symlink the pipeline exists to reject: `/safe/link/new` becomes the link's target, and the
later component walk never sees `link` at all. The lexical walk runs **before** the normalizer.

```
keep the ORIGINAL absolute lexical path
  ↓ reject if not absolute
  ↓ lstat every existing LEXICAL component → reject any symlinked component   ← before normalizing
  ↓ normalizeWorktreePath(candidate)      → identity + containment only        (model § 3.1)
  ↓ reject if exists and is not an empty directory
  ↓ reject if inside any LINKED worktree of this repo   (inside the MAIN worktree is allowed)
  ↓ reject if it IS the main worktree
  ↓ record the identity of the candidate itself when it exists, else its nearest existing ancestor
  ↓ ── queue wait ──                                    ← D1, D12
  ↓ re-run BOTH operations; re-check the recorded identity, and re-check emptiness
  ↓ spawn git
```

When the candidate already exists as an empty directory, the nearest existing ancestor **is the
candidate**, not its parent — so the re-check must be recorded against the candidate's own identity
and its emptiness re-asserted, or swapping that directory after validation goes undetected.

The result is never cached across the queue wait. The residual window is real and stated rather than
papered over: segments that do not yet exist cannot be `lstat`ed, so a local process can create a
symlink or mount inside them between the last check and the spawn. Path aliasing through UNC paths,
mapped drives, and network mounts stays **documented as unsupported**.

### D7: The create root is detected from the repo, and an explicit setting outranks detection

Precedence, per `worktree-actions.md` § 3.2 — the design owns the rule; this records what it costs
to implement:

1. `anywhereTerminal.worktree.createRoot`, only when the user actually set it
2. the mode of the parent directory of this repo's **linked** worktrees, read from the listing the
   host already holds — no extra git work
3. `.claude/worktrees`

"Only when the user actually set it" means inspecting the configuration's own resolution, not
comparing against the declared default — a user who explicitly sets the default value has still
stated a preference, and must outrank detection. Detection infers the **root only, never the naming
pattern**: one root can hold worktrees named two ways, and inferring a pattern from them encodes one
tool's convention as the repo's.

`worktree.createRoot` is declared in **neither** `package.json` nor `SettingsReader` today
(`rowActivation` was added by WT-005.1; this key was not). Both are added here.

### D8: A create under a root inside the main worktree writes `info/exclude`, and a failure there does not block

The default root sits inside the main worktree, so a created worktree is untracked content in the
parent's working tree. The create adds that root to the repository's `.git/info/exclude` once,
idempotently. No such writer exists anywhere in the repo today — it is a new filesystem seam.

`info/exclude` and never `.gitignore`: the former is repo-local and uncommitted, which is the right
home for a layout this user chose and their collaborators did not; the latter is tracked, and
committing an entry on the user's behalf is not ours to do. A failed exclusion write is **reported
and does not fail the create** — the worktree is what was asked for, and a noisy `git status` is a
nuisance, not a failure.

### D9: Create ships without its agent mode, and validation rejects that mode

`openAfter` accepts `none`, `terminal`, `newWindow`, and `addToWorkspace`. `agent` is **rejected by
host validation** until WT-005.3.

`worktree-actions.md` § 3.2 gives the create form an agent picker, but the launch it performs is § 4,
which WT-005.3 owns and whose fresh-launch registry capability does not exist yet.

The form **already offers it today**: `WorktreeCreateDialog.ts:30-36` lists
`{ value: "agent", label: "Start an agent" }` in a module-level `OPEN_AFTER` constant, rendered
unconditionally. Host rejection alone would leave that option selectable and inert — exactly what the
accepted absent-not-inert rule forbids. So this change **removes the option and its agent box from
the form**, and keeps host rejection as defense in depth rather than as the mechanism. WT-005.3
restores both alongside the capability that backs them.

### D10: No shared dialog shell is extracted

`ContinueDialog` and the worktree dialogs keep their own shells.

The blueprint names the vault continuation dialog's focus trap and disposal as a reuse signal. That
signal is **stale**: `src/webview/worktree/worktreeDialogShell.ts:34-121` already generalizes
mounting, focus trap, disposal, scrim, and Escape for the worktree side. What remains is one
similarity between two shells that already exist, and extracting a third to unify them would be
going looking for a pattern to apply. Revisit when a third dialog needs one.

### D11: `indeterminate` is a comparison, not a guess

After every mutation attempt the host forces a rebuild and compares git's registrations against a
**journal of the target's pre-operation registration and path**, taken before the spawn. Disagreement
yields `outcome: "indeterminate"` carrying what was observed.

Comparison alone is not sufficient, and the naive form is a false negative: a forced removal that
deletes half the directory before being killed leaves both the top-level directory and the
registration in place, so "registrations versus filesystem existence" *agrees* and would report a
clean error over irreversible partial data loss. Three rules close that:

- **A killed or timed-out removal is always `indeterminate`**, whatever the coarse comparison says.
  Unchanged existence is not evidence of unchanged contents.
- **A failed authoritative listing is itself `indeterminate`** — the cache retains the last-good
  registration, so a comparison against it proves nothing.
- **The journal, not a directory scan, is the reference.** "A directory git no longer lists" is only
  meaningful against the operation's own remembered target.

This is why the rebuild runs on failure and on timeout, not only on success. The mutation lock is held
until the child process is confirmed terminated and the recovery rebuild has completed (D12); if
termination cannot be established, further mutations for that repo are **quarantined** rather than
released to run concurrently with an unknown writer. There is no retry — `worktree-actions.md` § 5 —
because retrying a partially applied git mutation is how a recoverable error becomes an unrecoverable
one.

### D12: One coordinator orders every mutation against the rebuild gate

Every verb runs through one wrapper, in one order:

```
acquire mutationQueue(repoId)
  → await a forced rebuildGate barrier          (so we resolve against the rebuilt tree)
  → re-resolve the target id / re-validate the path
  → run git
  → force and await the post-attempt rebuild
  → release in `finally`
```

D1 gives mutations their own non-coalescing lock, but a lock alone does not satisfy
`worktree-rpc.md:238` — "action arrives during a rebuild → queued behind it, then re-resolves against
the new tree". Without the barrier a mutation entering the queue while a watcher-driven rebuild is in
flight re-resolves from the *old* cache. Nothing in D1 implements that, so the coordinator does.

**Lock order is one-way: `mutationQueue → rebuildGate`, never the reverse.** Gate callbacks must never
await the mutation queue. Today `rebuild()` acquires no mutation lock, so there is no deadlock to fix —
this records the invariant that keeps it that way. The release is in `finally` so a *failed* rebuild
still frees the queue.

Holding the lock across the post-attempt rebuild is deliberate: releasing at git's exit would let the
next mutation resolve against a cache the previous one just invalidated.

### D13: Prune is confirmed, and the count is what the confirmation is for

`worktree-actions.md` § 3.5 requires prune to be offered only when something is prunable **and** to be
confirmed with the number of registrations that will be dropped — "an unexplained count is worse than
a confirmation". Neither exists today: `WorktreeMenuActions` (`WorktreeContextMenu.ts:19-31`) has no
prune entry and there is no prune dialog, so this is built here, not wired.

The host result therefore carries the count, because only the host can know it.

**The one prune affordance that does exist is exempt.** `WorktreeView.ts:661-671` offers a "Prune"
button on the `indeterminate` notice as recovery from a partly-applied removal. It stays
unconfirmed: the user is looking at the report of what was observed, which is a stronger and more
specific statement than the generic count a confirmation would restate. Every other entry point is
confirmed.

## Interfaces

```ts
// What the user is shown (counts) and what the fingerprint is taken over
// (identities). Both travel together so the dialog never derives one from the other.
interface RemovalEvidence {
  dirtyPaths: readonly string[];      // repo-relative, normalized, sorted
  untrackedPaths: readonly string[];  // idem
  paneIds: readonly string[];         // window-owned panes rooted here
  externalSessionIds: readonly string[];
  locked: boolean;
  lockReason: string | null;
}

// Refusals structurally cannot carry a fingerprint (D3).
interface RemovalRefusal {
  kind: "refused";
  isMain: boolean;
  busyAgents: number;
  containsWorktrees: readonly { worktreeId: string; displayPath: string }[]; // D4 — all of them
}

interface ConfirmableRemoval {
  kind: "confirmable";
  evidence: RemovalEvidence;
  fingerprint: string;  // over evidence identities, not over counts
}

type RemovalAssessment = RemovalRefusal | ConfirmableRemoval;

// Inbound payload. worktree-rpc.md:90 declares `{ worktreeId, force }`, but
// worktree-rpc.md:196 requires the fingerprint to be validated on the way in —
// so the payload is amended here (spec delta).
interface WorktreeRemoveRequest {
  worktreeId: string;
  force: boolean;
  fingerprint?: string;  // REQUIRED when force is true; REJECTED when it is false
}

type WorktreeActionOutcome = "ok" | "error" | "indeterminate";
```

The webview's `WorktreeRemoveBlocker` (`worktreeViewTypes.ts:36-49`) gains `containsWorktrees` and is
re-shaped to this split — it is a published contract with the dialog, not an internal type (D4).

## Risk Map

| Risk | Growth axis / trigger | Mitigation |
|---|---|---|
| `--force` deletes a worktree that gained a blocker after confirmation | any concurrent writer | D3 re-evaluates immediately before spawn over **identities**, so a same-count substitution re-prompts. Window narrowed, not closed — stated in the confirmation copy per spec `worktree-panel#a-removal-states-what-it-destroys-and-what-it-spares` |
| A partly-deleted worktree reported as a clean error | removal killed mid-delete | D11 — killed/timed-out is unconditionally `indeterminate`; journal, not directory scan, is the reference |
| A mutation resolves against a cache a concurrent rebuild is replacing | watcher activity during a mutation | D12 gate barrier before re-resolution; lock held across the post-attempt rebuild |
| An external session makes a worktree permanently unremovable | any second window | D2 — `busyAgents` is window-owned rows only |
| Nested registered worktree destroyed by a parent's removal | nesting created outside this extension | D4 refusal + `worktree-tree-protocol#some-blockers-no-confirmation-can-override` |
| Symlink/mount swapped into a not-yet-existing path segment | local process, between check and spawn | D6 narrows via component `lstat` + ancestor re-check; residual documented, not claimed closed |
| Large removal killed mid-delete, state unclear | worktree size — 8-35s observed | D5 removal-specific timeout; D11 reports `indeterminate` rather than a clean error |
| Two mutations on one repo interleave | user speed, two surfaces | D1 non-coalescing per-repo lock; queued action re-resolves and re-evaluates on start |
| Blocker evaluation cost per removal | panes × worktrees in this window | One pass over data already held (D2); one `git status --porcelain` per removal, not per rebuild — it runs on the action, never on the tree push |
| Issued fingerprints accumulate | one per confirmation shown | Bounded by expiry (D3); entries are per `worktreeId` and replaced, not appended |
| `info/exclude` grows on repeated creates | one line per root, not per worktree | D8 idempotent — the root is added once and re-checked before writing |

## Design Constraints

- **Git floor is 2.31** (`gitCapabilities.ts:54-92`). `git worktree lock --reason`, `remove --force`,
  and `prune` all predate it; no capability probe is needed for the mutating verbs.
- **`--force --force` is required to remove a locked worktree.** A single `--force` does not override
  a lock, so the documented "confirm past a lock" path fails outright without the second flag
  (`worktree-actions.md` § 3.3).
- **Never `rm -rf`.** Directory removal is git's job (§ 3.1 rule 3). This bounds our bugs, not git's
  consequences — git's delete is still recursive and irreversible.

### D14: The panel derives the prune count it already holds; the host re-counts authoritatively

Round-2 B1 read the missing `prunableCount` as missing protocol. It is not: `WorktreeInfo.prunable`
is already on every worktree in the tree the panel renders (`src/worktree/types.ts:23`), set from
git's own `prunable` flag. The repo's count is `worktrees.filter((w) => w.prunable).length`, and no
new inbound message is needed for it.

The two counts are deliberately different things and both are kept:

| Count | Source | What it is for |
|---|---|---|
| panel-side | `prunable` flags in the rendered tree | whether to OFFER the item, and the number the confirmation names |
| host-side | `git worktree prune --dry-run --verbose` | what actually gets dropped |

D13 already has the host re-count and abandon when the number moved. That mismatch path is what
makes the panel-side count safe to derive rather than transmit: the worst case is a confirmation
the host then refuses, never a prune of a number the user did not see.

### D15: A confirmation is invalidated by OBSERVATION, not by a marker on the target

Round-2 B5 rejected `${head}:${branch}` as an incarnation, correctly — a remove-and-recreate at the
same commit and branch reproduces it exactly. The admin directory is no better: git reuses
`.git/worktrees/<name>` when the name is free again, which is precisely the recreate case.

So stop trying to name the incarnation and watch for the event instead. **Every rebuild that does
not find `worktreeId` drops that worktree's fingerprint.** A recreate cannot inherit a token,
because the disappearance that preceded it already destroyed the token. This needs no new git read,
no new field, and no marker that has to be unique.

Two rules complete it:

- **Every forced-removal exit spends the token**, including the exits that never reach git — an
  unreadable assessment, a refused verdict, a target that vanished. Round-2 B5's first half was a
  `return "reprompt"` that skipped `redeem`, leaving the token live after an evidence-read failure.
- `incarnation` leaves `FingerprintTarget` entirely. A field that cannot be made unique is worse
  than no field: it reads as a binding that holds.

### D16: Evidence that cannot be READ is its own outcome, and it refuses

The specs say a removal returns its blockers rather than failing. They never said what it does when
the blockers cannot be read, so three sources fail open into "nothing at risk" (round-2 B6): a
non-zero `git status --porcelain` becomes `""`, a failed registry scan becomes `[]`, and a
`degraded` listing is read as current.

`RemovalAssessment` therefore gains a third member alongside `refused` and `confirmable`:

```ts
interface UnavailableRemoval {
  kind: "unavailable";
  /** Which reads failed, for the panel to name. Never empty. */
  unreadable: readonly ("status" | "sessions" | "listing")[];
}
```

An `unavailable` assessment issues no fingerprint and runs no git. It is not a refusal — a refusal
says the answer is no, and this says there is no answer — so it reads as "could not check" and
offers a retry, which a refusal never does.

**The three sources must therefore carry typed failure rather than a fallback value.** That is the
whole of the fix: `porcelain: string` becomes an outcome, `externalSessions` keeps the
`RunningSessionsOutcome` it already has instead of discarding it, and `WorktreeRepo.degraded`
propagates instead of being ignored.

### D17: Results return to the surface that asked; the tree refresh goes to everyone

Round-2 B1 found results posted directly to the sidebar and panel providers, missing attached editor
surfaces. Direct posting was the mistake — the host already owns attachment and already broadcasts
the tree.

- **The outcome** goes to the ORIGINATING surface. `handleMessage(surface, msg)` already carries it,
  and the surface that raised a dialog is the one holding the state that dialog left behind.
- **The rebuilt tree** broadcasts to every attached surface, as it already does. A worktree that
  vanished must vanish everywhere, not only where the action was raised.

This also settles `openAfter: "terminal"`, which production silently drops: opening a terminal needs
a view id and a webview, which is why `openTerminal` lives on `WorktreeSurface` (D2). The
originating surface performs it on a successful create — the same path `worktreeOpenTerminal`
already takes. The mode stays in the form because it can now be honoured.

**Outbound contract**, added to `ExtensionToWebViewMessage` (round-2 W3: production currently posts
an untyped object):

```ts
interface WorktreeMutationResultMessage {
  type: "worktreeMutationResult";
  verb: "create" | "remove" | "lock" | "unlock" | "prune";
  repoId: string;
  result:
    | { kind: "ok" }
    | { kind: "error"; message: string }
    | { kind: "indeterminate"; observed: string }
    | { kind: "unavailable"; unreadable: readonly string[] };
}

/** The destination a create will actually take — the host resolves it, never the webview. */
interface WorktreeCreateDefaultsMessage {
  type: "worktreeCreateDefaults";
  repoId: string;
  /** Free, suffixed if taken. `specs/worktree-panel/spec.md#a-created-worktree-names-the-destination-it-will-actually-use`. */
  path: string;
  root: string;
}
```
