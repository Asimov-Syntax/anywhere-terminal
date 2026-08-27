# Design: enumerate-git-worktrees

Mechanism, ordering, and the data model are owned by
[docs/design/worktree-model.md](../../../docs/design/worktree-model.md) § 2, § 3.1–3.4, § 6 and
are not restated here. These decisions cover only what is repo-local: where the module sits, how
it reaches `git`, and the points the blueprint leaves to implementation.

Orca ships a working reader for the same git surface. What it learned — and what of it is worth
porting — is recorded once in
[docs/research/20260826-orca-git-worktree-mechanics.md](../../../docs/research/20260826-orca-git-worktree-mechanics.md);
D2, D3, D7 and D8 cite it rather than restating it.

## Target Layout

```
src/worktree/
  types.ts              WorktreeTree / WorktreeRepo / WorktreeInfo — model § 2, verbatim
  normalizePath.ts      the one normalizer — model § 3.1
  gitCommandRunner.ts   bounded execFile seam
  gitCapabilities.ts    -z / --path-format support, its detection and its expiry
  porcelainParser.ts    --porcelain [-z] → WorktreeInfo fields — model § 3.3
  repoRoots.ts          workspace folders → deduped repoId set — model § 3.2
  worktreeOrder.ts      intra-group ordering — model § 3.4
  WorktreeDiscovery.ts  composes the above into a WorktreeTree
```

Only `repoRoots.ts` and `WorktreeDiscovery.ts` import `vscode`. The normalizer, the parser and
the comparator stay dependency-free so vitest exercises them without the editor mock — the same
split `src/vault/` uses between `readers/` and `VaultService.ts`.

## Decisions

### D1: Git reaches this module through one bounded runner, injected

All git invocations go through a `GitCommandRunner` interface owned by
`src/worktree/gitCommandRunner.ts`, whose default implementation is `execFile` with a 10 s
timeout, a `maxBuffer` cap, and **`Buffer` stdout**.

`-z` parsing is byte-oriented: decoding stdout to a string before splitting on NUL is what makes
a path with an unusual encoding unparseable rather than merely unusual. The three existing
`exec` deps surfaces in the repo (`src/pty/processCwd.ts:21`, `src/vault/sqlite.ts:65`,
`src/cursor/CursorExecutableResolver.ts:9`) are a *test seam idiom*, not a shared capability —
each differs in timeout and decoding, and none returns bytes. A fourth purpose-built runner is
the reuse-correct answer here; hoisting them into one util is a separate refactor with three
unrelated call sites to migrate, and does not belong in this diff.

Worktree mutations (WT-005) reuse this runner rather than adding a second git seam.

### D2: Git version and capability results are cached with a 30-minute expiry, not for the process

`git --version` and each command capability are probed on first use and memoized, and a
*negative* result expires after 30 minutes so the next rebuild re-probes. Concurrent probes for
the same key share one in-flight promise.

The blueprint requires below-floor git to be "reported as unsupported, not silently degraded"
(model § 8) while bounding a rebuild to two git commands per repo (model § 7); a memoized probe
satisfies both, amortizing to zero per rebuild.

**This deviates from model § 3.6, which specifies a cache that never expires** on the grounds
that a mid-session git *downgrade* is not worth modelling. That reasoning is sound and beside
the point: the realistic move is an **upgrade**, by the user who was just told their git is too
old. Under § 3.6 as written, they upgrade git and the view keeps saying "unsupported" until they
restart the window. Orca hit this and re-probes every 30 minutes for exactly that reason
(research § 3). The cost of the deviation is one failed `git --version` per half hour on a
machine with no git at all.

### D7: Capability detection reads exit codes and output, never error text

`-z` support is rejected by **exit 129**; `--path-format` support is rejected by an **exit-zero
run that echoes `--path-format` back as an output line**. Both live in `gitCapabilities.ts` as
their own tested predicates.

Neither is discoverable by the obvious route. A regex on `unknown option` fails on a
non-English git, which is why 129 — git's locale-independent usage-error code — is the primary
signal. And old git does not fail `--path-format` at all: it succeeds and prints the flag, so
code that branches on exit status reads the flag itself as a repository path. Research § 1
records both, with orca's implementations as the source.

### D8: Port orca's capability *behaviour*, not its `GitCapabilityCache` class

`gitCapabilities.ts` is a module holding a `Map` keyed by capability plus one
`runWithFallback`-shaped function. Orca's class is not vendored.

Two capabilities exist today — `worktree-list-z` and `rev-parse-path-format` — and
[patterns.md](../../../.claude/skills/asimov-refactor/references/patterns.md) admits a pattern
only once the pain is counted from the code along a named growth axis. Two is not an axis, and
the simpler construct it must beat is precisely a `Map` lookup. Orca's class earns itself over
five capabilities and several subsystems (`git-capability-cache.ts:5-11`); we have one consumer.
What survives the trim is the behaviour that cost orca bug reports: expiry (D2), in-flight
dedup, and D7's detection. If worktree *actions* (WT-005) add a third and fourth capability with
their own consumers, that is the point to revisit — not now.

### D3: Windows identity is one canonical spelling, not a case-insensitive comparator

`normalizeWorktreePath` on Windows uppercases the drive letter **and** lowercases the remainder,
so `id` equality *is* the case-insensitive comparison model § 3.1 step 5 calls for.

Ids are map keys and message payloads; a comparator that lives beside them would have to be
threaded through every `Map`, `Set`, and longest-prefix test in presence and actions, and the
first place it was forgotten would silently split one worktree into two. `displayPath` already
carries git's exact spelling, so nothing user-visible is lost. This follows the shipped
precedent at `src/providers/gitDecorationProvider.ts:47`, which folds case for the same reason.

Orca's equivalent (`git-handler-worktree-ops.ts:122`) is lexical only — no realpath, no NFC, no
case fold — and is deliberately **not** reused: DESIGN.md D4 rejects lexical comparison by name,
because macOS reports `/private/var` from the process table and `/var` from git (research § 4).

### D4: Ordering takes an injected rank function, defaulting to unranked

`orderWorktrees` accepts `rank?: (id: string) => number | undefined`. This change always passes
nothing.

Model § 3.4 step 2 ranks by live-pane activity, but that key is owned by the presence projection
(P4) and does not exist yet. An injected seam lets P4 supply it without reopening this module's
contract, and matches model § 3.4's instruction to treat every worktree as unranked until
presence resolves — which also keeps the order stable across the first two pushes instead of
jumping mid-render.

### D5: `vscode.git` is preferred but never awaited

Repo-root resolution reads `api.repositories` when the extension is present and its state is
`initialized`; in every other case — extension absent, disabled, or still `uninitialized` — each
workspace folder falls through to `git rev-parse` directly.

Model § 3.2 assumes the API is there. It may not be: `APIState` starts `uninitialized`
(`src/providers/git.ts:22`), and `gitDecorationProvider.ts:266-277` already treats a missing
extension as a normal condition. Blocking discovery on an extension activation would make an
empty tree the first thing a cold window renders, and `rev-parse` answers the same question.

### D6: Degradation here is a reason, not a retained listing

A repository whose listing fails carries `degraded` with a reason and zero worktrees. There is
no last-good fallback in this change.

Model § 5's keep-last-good rule needs the per-repo cache that model § 3.6 specifies and WT-001.2
builds. Implementing a half-cache here to satisfy one row of that table would put the cache's
ownership in two places. WT-001.2 layers retention over this module's output; until it lands, a
first-and-only read that fails is indistinguishable from a first-ever read that fails, which is
exactly the case model § 5 already renders as an empty group with a reason.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `normalizePath.ts` | A normalizer that disagrees with the process table silently attributes zero agents to every row — the failure is invisible, not loud | Unit tests pin both directions of the macOS `/var` ↔ `/private/var` case and the Windows case-fold (spec scenario *A symlinked root reported two ways is one worktree*); D3 makes the id itself canonical so no caller can forget the comparator |
| `normalizePath.ts` | `realpath` per worktree per rebuild — growth axis: worktrees per repo | Bounded by worktree count, which DESIGN.md D14 fixes at tens; one `realpath` per worktree, never recursive. No cap needed, but no directory walk may be added either |
| `gitCommandRunner.ts` | An unbounded or hung git on a network filesystem stalls discovery | 10 s timeout + `maxBuffer` cap in the default runner (D1); a timeout degrades that repo alone (spec *Degrade a failing scope with a reason*) |
| `porcelainParser.ts` | Growth axis: records per repo. A malformed record could push one reason per record into `unreadable.reasons` on every rebuild | Reasons are deduplicated before they enter the tree, so the array is bounded by distinct failure kinds, not by record count or rebuild count |
| `porcelainParser.ts` | The line-delimited fallback mis-parses a path containing a newline and reports a **shorter, wrong** path as a real worktree — silently. Orca's own parser has this bug | Non-`-z` porcelain does not quote paths (verified, research § 2), so decoding cannot help: a record containing a line matching no known token is skipped and reported. Fixture with an embedded newline, asserting *no* worktree rather than a truncated one |
| `gitCapabilities.ts` | Old git answers `--path-format` with **exit 0** and echoes the flag, so success-checking code reads `--path-format` as a repo path | Detection is the output echo, not the exit status — D7; predicate tested against a captured old-git response |
| `gitCapabilities.ts` | A permanent negative cache leaves a user who upgrades git stuck on "unsupported" until they restart the window | 30-minute expiry on negative results — D2 |
| Existence probe | Growth axis: worktrees git flagged prunable | Concurrency 8, and only linked unlocked prunable worktrees are probed — model § 3.3 |
| `repoRoots.ts` | Deduping on `rootUri` instead of the common dir renders one repo as two groups (DESIGN.md D2) | `repoId` is the only grouping key; spec scenario *A linked worktree opened beside its parent repo is one group* pins it |
| `WorktreeDiscovery.ts` | Unit tests that shell to a real `git` make the suite depend on the developer's git version | Every git call goes through the injected runner (D1); porcelain fixtures cover the token matrix, and the small number of tests that need a real repo create one in a temp dir |
