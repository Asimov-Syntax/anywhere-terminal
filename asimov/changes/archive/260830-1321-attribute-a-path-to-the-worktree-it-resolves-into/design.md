# Design: attribute-a-path-to-the-worktree-it-resolves-into

## Decisions

### D1: The bounded side of each comparison resolves; the unbounded side does not

Every one of the five sites compares a **candidate** against a **root**. Sorting them by what
produces each side is what makes the cost question answerable:

| Site | Candidate | Root | Both bounded? |
|---|---|---|---|
| `presenceProjector.ts:366` | pane `cwd` | worktree id | yes — panes the window holds, worktrees git listed |
| `worktreeBlockers.ts:163,167` | pane / session `cwd` | worktree id | yes |
| `repoRoots.ts:91` | workspace folder | git repo `rootUri.fsPath` | yes — folders open, repos the Git API holds |
| `FileTreePanel.ts:309,334` | a path the tree is displaying | workspace root | root only |
| `gitDecorationProvider.ts:148` | any file being decorated | workspace folder | root only |

A path produced by a bounded set is resolved ONCE where it is produced and its resolved form is
compared thereafter. A path that arrives per event — a file being decorated, a node being revealed —
is not resolved at all: that is precisely the "unbounded syscall per comparison" the acceptance
forbids, and the decoration provider is called per file per git refresh.

So this change fixes **root-side aliasing everywhere** and **candidate-side aliasing wherever the
candidate is itself producer-bounded**. It does not make an arbitrary per-file decoration lookup
symlink-exact. That line is drawn to match the acceptance, which names the pane cwd, repository
discovery, the per-push cost, and the duplicated predicate — and does not name per-file decoration.
Stating it here so review judges a chosen boundary rather than finding a gap.

### D2: The comparison stays lexical, and stays `isPathInside`

Because both sides are already resolved by the time it runs, the comparison needs nothing new. It
keeps `isPathInside` from `src/utils/pathBoundary.ts`, which already owns filesystem-root roots,
separator drift and drive-letter casing. No third predicate is introduced, and
`isResolvedPathInsideRoot` is not adopted here — it is async, and it resolves its candidate on every
call by design.

`FileTreePanel.ts:1715`'s file-local copy is deleted and the shared predicate imported, which is the
acceptance's "no site keeps a private copy of the containment rule".

### D3: A resolved value may be cached here because the answer authorizes nothing

`resolve-containment-through-symlinks` D8 forbids caching a resolved candidate, and that rule is not
being relaxed — it is being scoped. The distinguishing question is the one that change already
recorded: **does this answer authorize a read?**

| | WT-011.1 | This change |
|---|---|---|
| The answer decides | whether a file may be opened | which heading a row appears under |
| A stale answer means | a read escapes its store | a row is filed under the wrong worktree until the next structural change |
| Therefore | resolve every time, cache nothing | resolve once per distinct path, cache it |

Without this stated, the cache reads as a regression against D8. It is the same mechanism serving a
question with a different blast radius.

`docs/research/20260830-orca-path-to-worktree-resolution.md` records Orca accepting this same
residual in its *authorization* cache, which is the stricter context: structural repo/worktree
mutations clear it, and symlink retargeting alone has no watcher and no TTL.

### D4: Resolution is lazy and per distinct path, never an eager sweep

Resolution happens on first use of a path and is memoized by that path's spelling. It is not a
startup sweep over every known root, for a reason the same research supplies with a citation rather
than a guess: canonicalizing paths the user has not asked about can trigger **macOS TCC permission
prompts** (`registered-worktree-roots-cache.ts:22-57` — "canonicalizing every root on invalidation
would trigger macOS TCC prompts"). An attribution fix must not make the window ask the user for disk
access it did not previously need.

The memo is invalidated **structurally, not on a timer**: the worktree set changing, the workspace
folder set changing, or a pane's reported cwd changing. A TTL would add a second freshness notion
answering nothing — a symlink that is repointed without any of those events is the accepted residual
named in the Risk Map.

This clause was written when each consumer held its own memo, and 1_4 made the memo shared without
restating it. On a shared memo the events above no longer say the same thing. A pane closing does not
mean the directory moved — the filesystem is unchanged — it means one claimant stopped needing the
answer. Reading it as staleness lets one consumer's bookkeeping delete a fact another consumer is
still standing on, which is round-2 B4. **When a path is released is D6's question, not D4's**: D4
governs freshness, and only a genuine filesystem-shape event makes an entry stale.

### D5: `presenceDeps.normalize` becomes the seam it already documents

`src/worktree/presenceDeps.ts:73-77` is `normalize: (p) => path.resolve(p)` with a comment naming
the exact miss and the exact obstacle: "a realpath here would have to be async". The projector is
already async at its boundary (`getCwd: async () => pane.cwd`), so the obstacle is real only for the
synchronous shape it has today, not for the projection as a whole. Resolution moves to where the
pane's cwd is read, and `normalize` receives an already-resolved value.

`normalizeWorktreePath` (`src/worktree/normalizePath.ts:79`) already realpaths worktree ids through
`realpathTolerant`, so the root side of the presence comparisons needs no change — only the
candidate side does. Verified against current code rather than inherited from the archived design.

### D6: A resolved path is held by its claimants and released when the last one lets go

The memo is shared, so no single consumer knows whether a path is still wanted. Presence releasing a
cwd on pane retirement is memory bookkeeping, and today it reaches the shared entry directly: the
last pane leaving the workspace folder deletes the entry the decoration provider is standing on, and
decorations do not re-prepare — `resolveFolders` runs at construction and on workspace-folder change
only — so containment falls back to the lexical answer for the window's life. That is the exact
defect this change exists to remove, reintroduced through the release path (round-2 B4).

Each entry therefore records **which consumers claim it**, and a release drops the claim rather than
the entry. The entry goes when the claim set empties. `invalidateAll` is unaffected: a structural
event under D4 makes the answer wrong for everyone, so it clears regardless of claims.

The claimant is the handle a consumer already holds. `createTrackedPathResolver` is exactly "a
bounded set, re-prepared when it changes, forgetting what left" — it gains an identity, and its
existing prune becomes a release of its own claim. The consequence is a deletion rather than an
addition: presence's bespoke `prepareCwds`/`forgetCwd` pair and its two hand-written set differences
are the same logic spelled a second time, so presence adopts two resolver handles — panes and
sessions, which retire on different triggers — and that code goes.

**Rejected — every standing consumer re-prepares on a broadcast.** It turns each pane close into a
full decoration rebuild, which is W2's waste on a hot trigger instead of a cold one.

**Rejected — give each consumer its own memo again.** It resolves the same path once per consumer
and reopens what 1_4 closed, to avoid tracking a claim set that is at most one entry per consumer.

### D7: A resolution that lands after mount updates containment, never the mount

The resolved workspace root reaches the webview as its own field (round-1 B1), and it arrives late by
construction: the host posts the mounted root immediately and re-posts once `realpath` settles. The
controller treats any `workspace-root-changed` as a re-root — exits search, disposes the tree, clears
expanded paths, remounts — so the late arrival would discard the user's expansion and search state
every time a window opens, for a message in which the mounted root did not change (round-2 W1).

An update whose `rootPath` and generation are unchanged carries containment metadata only, and is
applied to the resolved pair alone. This stays inside the message contract rather than adding a type:
the field is already optional and already means "containment only", and the mount identity the
controller keys on is the pair that did not change.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| Who owns writes to the memo | The process that holds it, in memory only. Nothing is persisted, so no other process or host can read or corrupt it |
| What serializes concurrent access | Single-threaded extension host. A concurrent miss on one path resolves twice and stores the same value; the memo stores promises so the second caller joins the first |
| Crash mid-write | n/a — the memo is in-memory and rebuilt from nothing on restart |
| Failed or malformed read | Fails to the path's `path.resolve` form, unchanged from today's behaviour. A `realpath` that fails must not drop a pane from every worktree — a missing directory is normal while a worktree is being created, and refusing attribution would blank rows the window currently shows |
| Two racing hosts | Two extension hosts keep independent memos of the same read-only filesystem facts and never share state |
| A symlink repointed with no structural event | Accepted, and named in the Risk Map. Attribution is stale until the next worktree/folder/cwd change |

## Risk Map

| Risk | Mitigation |
|---|---|
| A cached resolution outlives the symlink it resolved | Bounded by what the answer decides (D3): attribution, not authorization. Invalidated by every structural event that would change the answer for a real reason |
| Resolving makes the window ask for disk permissions it did not need | D4's lazy, per-distinct-path resolution, on paths the window is already working with — never an eager sweep |
| The per-push paths get slower | D1 resolves only producer-bounded sides; the projector's and decoration provider's per-event candidates gain no syscall. Acceptance is a cost assertion, not only a correctness one |
| A `realpath` failure blanks rows the window shows today | The failure surface fails to today's behaviour, never to "attributed to nothing" |
| The fix reads as a regression against WT-011.1 D8 | D3 states the scoping rule explicitly, so review judges a boundary rather than discovering a contradiction |
| Candidate-side aliasing survives at the two per-event sites | Stated in D1 as a chosen boundary matching the acceptance, not left for review to find |
