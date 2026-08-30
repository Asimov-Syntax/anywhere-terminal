# Proposal: attribute-a-path-to-the-worktree-it-resolves-into

## Why

`resolve-containment-through-symlinks` (WT-011.1) established that a path must be compared where it
actually resolves, and deliberately scoped itself to the resolvers that gate a transcript READ. Its
design named the five sites it left behind and said plainly that they carry the same error with a
different consequence.

Those five still compare lexically. A pane whose shell reports `~/work/wt` while git reports
`/private/var/.../wt` — the ordinary macOS arrangement, or any worktree reached through a symlinked
parent — is attributed to the wrong worktree, or to none. `presenceDeps.ts:73-77` documents the miss
in its own comment rather than hiding it: `normalize: (p) => path.resolve(p)`, because "a realpath
here would have to be async". Repository discovery has the same shape at `repoRoots.ts:91`, where
raw workspace-folder and Git API `fsPath` values are compared against each other.

The consequence is not a security hole — none of these five authorizes a read — it is a window that
shows a session under the wrong heading, or drops it from every heading.

## Scope

- The five sites: `worktree/repoRoots.ts`, `worktree/worktreeBlockers.ts`, `worktree/presenceProjector.ts`,
  `providers/gitDecorationProvider.ts`, `webview/fileTree/FileTreePanel.ts`.
- Resolution happens once per distinct path where that path is produced, not once per comparison.
- `FileTreePanel`'s file-local copy of the containment rule is deleted in favour of the shared one.

## Non-goals / must-not

- **Must not** add a `realpath` per comparison on the per-push paths. The projector runs on every
  presence push and the decoration provider on every git refresh; the acceptance names this.
- **Must not** widen `isResolvedPathInsideRoot` or relax its no-cache rule. That predicate answers a
  question that authorizes a read, and its D8 forbids caching for a reason that still holds. This
  change adds a second answer for a second question rather than editing the first.
- **Must not** canonicalize every known root eagerly at startup — see the TCC risk below.
- Not a change to which worktrees exist, how they are discovered, or how sessions are indexed. It
  changes only which of them a given path is judged to be inside.

## Appetite

Medium. The predicate exists, the worktree side is already resolved, and the seam that needs the
resolved value is a single injected `normalize` function. The work is concentrated in deciding
where resolution is memoized and in adopting it at five call sites without regressing their cost.

## Risk

The failure this introduces is a **stale resolution**: a path resolved once and reused after its
symlink is repointed. The mitigation is that the answer is attribution rather than authorization —
a stale answer files a row under the wrong heading until the next structural change, where a stale
authorization would let a read escape a store. `docs/research/20260830-orca-path-to-worktree-resolution.md`
records that Orca accepts this same residual in its *authorization* cache, which is the stricter
context; it invalidates on repo/worktree mutation and has no watcher or TTL for symlink retargeting.

Second risk, learned from that research rather than from this repo: on macOS, canonicalizing paths
the user has not asked about can trigger TCC permission prompts. That is an argument against
resolving eagerly and in favour of resolving lazily, per distinct path, on the paths the window is
already working with.
