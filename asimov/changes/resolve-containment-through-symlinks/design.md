# Design: resolve-containment-through-symlinks

## Decisions

### D1: The predicate joins the module that already owns path boundaries

`src/utils/pathBoundary.ts` exists for exactly this question and already handles the three things a
hand-rolled comparison gets wrong (filesystem-root roots, Windows separator drift, drive-letter
casing). The resolved form is added **beside** `isPathInside`.

The two predicates share the boundary rules through a **private core parameterized by its
normalizer** rather than one calling the other. Delegating to `isPathInside` was the original plan
and round-1 B1 is why it cannot be: the lexical form folds Windows case, and an authorization
predicate must not (D7). The rules that stay defined once are the ones that are genuinely common —
where the boundary sits, how a filesystem-root root is handled, how separators are folded. What
differs is the one thing that has to.

Rejected: a new `src/shared/pathContainment.ts`. It would mean two modules answering "is this
inside that", which is the shape of the defect being fixed.

`realpathTolerant` **stays** in `src/worktree/normalizePath.ts` and is not reused. It is an
availability helper — it swallows every `realpath` error and rebuilds the unresolved tail
lexically, which is right for naming a worktree that may be missing and wrong for authorizing a
read. See D3.

### D2: `isPathInside` is not widened, and its callers are not touched

This is a **scope rule, not a claim that the other callers are safe.** Ten production callers use
the shared lexical predicate and two more use a file-local copy. Four of them do compare ids that
`normalizeWorktreePath` already resolved — `extension.ts:602,611`, `WorktreeDiscovery.ts:173`,
`createPath.ts:135`, `worktreeBlockers.ts:141`. The rest do not:

| Site | Input |
|---|---|
| `worktree/repoRoots.ts:91` | raw workspace-folder and Git API `fsPath` |
| `worktree/worktreeBlockers.ts:163,167` | pane/session `cwd`, `path.resolve` only |
| `worktree/presenceProjector.ts:366` | pane `cwd`, `path.resolve` only — `presenceDeps.ts:73-77` documents the miss |
| `providers/gitDecorationProvider.ts:148` | raw `fsPath` both sides |
| `webview/fileTree/FileTreePanel.ts:309,334` | raw UI paths, file-local predicate |

Those five carry the same lexical error in a different consequence: a cwd spelled beneath a
worktree but resolving elsewhere is attributed to that worktree, and `repoRoots` can pick the wrong
repository. **They are real and they are out of scope here** — none of them gates a transcript
read, they run on per-push hot paths, and fixing attribution is a different acceptance story. They
go back to the blueprint as their own task rather than being absorbed silently.

What this change does establish:

| Comparison | Predicate | Why |
|---|---|---|
| A **filesystem path about to be read** against a store root | `isResolvedPathInside` (resolved, async, strict) | The answer authorizes a read, so it must be true of the file that will actually be opened |
| Anything else | `isPathInside` (lexical, sync) | Unchanged by this task |

The distinguishing question is "does this answer authorize a read". Recording it here is the point:
without it, the next reader sees two predicates and no rule for choosing.

### D3: Both sides resolve, and only demonstrable absence is tolerated

Resolving only the candidate would refuse legitimate files whenever the **root** is reached through
a symlink — `~/.claude` on another volume, or macOS resolving `/var` to `/private/var`. That
arrangement is common and healthy, so both sides resolve and are then compared.

The tolerance has to be much narrower than the worktree-naming walker's. That walker catches *every*
`realpath` error and rebuilds the unresolved tail lexically, which gives an attacker a way through:

```
/store/link/session.jsonl        link → /elsewhere   (target does not exist yet)
  realpath(/store/link/session.jsonl)  → fails
  realpath(/store/link)                → fails, dangling
  realpath(/store)                     → resolves
  ⇒ rebuilt lexically as /store/link/session.jsonl ⇒ "contained"
```

Create `/elsewhere` before the read lands and the read escapes. `ELOOP` and `EACCES` reach the same
accepting answer.

So the rule is **absence, not failure**:

- A tail that is absent (`ENOENT`) beneath a parent that **did** resolve inside the root is
  contained. This is the only tolerated case, and it is the one that matters — a transcript that has
  not been written yet is the normal early state of a session.
- Any other `realpath` error — `ELOOP`, `EACCES`, or anything else — is **refused**, not degraded.
- An existing symlink whose target cannot be resolved is refused rather than rebuilt lexically.

Rejected: the availability fallback the worktree walker uses. It is correct for naming a worktree
that may be missing, where refusing would erase a row the user needs to see, and incorrect for
authorizing a read, where it hands the decision to whatever the filesystem happens to be doing.

### D4: Async is free at every site

All six call sites already sit inside `async` functions — the three Claude resolvers, both
`isUnder` callers in the Codex reader, and the preview service's `resolve`. The predicate is
`async` and no signature above it changes.

### D5: Equality is refused — the predicate is a strict descendant test

`isPathInside` answers true when `candidate === root`; both predicates being replaced reject it
(`rel !== ""`). Preserving the loose form would be an observable regression: a Codex index whose
`rolloutPath` equals the sessions directory would pass containment, `pickRolloutPath` would return
the **directory**, and the filename scan that finds the real rollout would be skipped. The resolved
predicate is therefore strict, and that case is a named regression test.

### D6: The three local predicates are deleted, not left beside the shared one

`isUnder` and `isInside` are private to their files and have no other callers; the three inline
`path.relative` blocks are open-coded. All go. Leaving one behind would leave a second answer to
the question this change exists to give one answer to.

### D7: The resolved form preserves component case; only the volume is folded

`normalizePathForCompare` lowercases an entire Windows path, and that is correct for its callers:
they compare worktree **ids**, where VS Code hands back `c:\Repo` and `C:\repo` for one path and a
comparison that distinguished them would split one worktree into two.

An authorization predicate cannot inherit it. Windows supports case-sensitive directories (WSL,
`fsutil file setCaseSensitiveInfo`), where `C:\vault\Store` and `C:\vault\store` are two
directories; folded, a transcript in the second passes containment against the first. Round-1 B1
demonstrated exactly that against the shipped predicate.

The rule that replaces it: **after `realpath`, case is data.** Both sides have been through the
filesystem, which returns each component in its canonical on-disk case, so any surviving difference
is a real difference. Folding it can only erase a distinction the filesystem makes — it can never
repair one. So the resolved comparison folds separators and lowercases only the **drive letter**,
which no filesystem treats as significant. A UNC prefix is left alone: both sides are canonical, so
they already agree, and preserving it fails closed if they somehow do not.

POSIX is unaffected — nothing was folded there before or after.

### D8: The root resolves once per operation, the candidate on every check

`claudeReader` calls the predicate once per enumerated file, and `claudePaths`'s resolvers call it
once per project directory. Resolving the **root** inside each of those calls is a syscall per item
on a path that grows with the user's session history, for an answer that cannot change within one
pass (round-1 W1).

So the root is prepared once — resolved, and its volume kind decided — and handed to the per-item
check. The **candidate** still resolves on every check, and containment is never cached: a file
stamp is not an identity, and a cache keyed on one would let a path that has since become a symlink
keep an authorization it earned before.

What this trades: the prepared root is a snapshot for the length of one listing. A root swapped
mid-pass leaves the remaining candidates compared against the old resolution — they refuse, because
their freshly resolved paths no longer sit under it. The stale direction is the closed one.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| The user's vault store (`~/.claude/projects`, Codex sessions dir) | Read-only here and never written by this change. Concurrent writes by the agent are what the resolvers already tolerate: a file appearing between the containment answer and the read is the ordinary case, and the read's own failure path handles it |
| A resolved path used after the check (TOCTOU) | A symlink swapped between `realpath` and the subsequent `stat`/read is not closed by this change and is not claimed to be. The window is the same one DESIGN.md § 8.5 already records for `worktreeCreate`; the read is of a transcript the caller is already entitled to, so the residual is a narrower version of today's exposure, not a new one |
| The tolerant walker on a cyclic symlink | `fs.realpath` rejects on `ELOOP`; the walker catches, ascends to the parent, and terminates at the filesystem root. Bounded by path depth, not by the cycle |
| Two surfaces resolving the same path concurrently | No shared state — the predicate holds nothing between calls and caches nothing. Two callers may both resolve the same path; the cost is a duplicate syscall, not a race |
| A prepared root outliving the pass it was prepared for | Owned by the caller that starts the pass and dropped when it ends; nothing stores one. A root replaced mid-pass is not observed, and the remaining candidates refuse against the old resolution rather than being admitted by it (D8) |

## Interfaces

```ts
// src/utils/pathBoundary.ts — added
export interface ResolvedPathInsideDeps {
  /** Injected for tests; defaults to node:fs/promises realpath. */
  realpath?: (p: string) => Promise<string>;
}

/** A store root, resolved once and reused across one pass over its contents (D8). */
export interface PreparedRoot {
  readonly resolved: string;
}

/** Resolve a store root, or `null` when it does not resolve — nothing is inside it. */
export function prepareResolvedRoot(root: string, deps?: ResolvedPathInsideDeps): Promise<PreparedRoot | null>;

/**
 * Is `candidate` STRICTLY inside an already-resolved `root`? Tolerates one case
 * only: an absent tail beneath a parent that resolved inside the root. Every
 * other resolution failure is refused (D3). Equality is false (D5). Component
 * case is significant (D7).
 */
export function isResolvedPathInsideRoot(
  candidate: string,
  root: PreparedRoot,
  deps?: ResolvedPathInsideDeps,
): Promise<boolean>;

/** The single-shot form: prepare, then check. For callers with one candidate. */
export function isResolvedPathInside(
  candidate: string,
  root: string,
  deps?: ResolvedPathInsideDeps,
): Promise<boolean>;

// src/worktree/normalizePath.ts — realpathTolerant stays private and unchanged (D1, D3).
```

Removed:

```ts
// src/vault/readers/codexReader.ts
function isUnder(p: string, root: string): boolean
// src/worktree/sessionPreviewService.ts
function isInside(candidate: string, root: string): boolean
// src/vault/readers/claudePaths.ts — three inline path.relative blocks
```

## Risk map

| Risk | Mitigation |
|---|---|
| A `realpath` failure is treated as absence, re-opening the hole | D3 distinguishes `ENOENT` beneath a resolved in-root parent from every other error; the broken-escaping-link, `ELOOP` and `EACCES` cases are asserted directly at the predicate |
| Equality quietly disables Codex's filename fallback | D5 — the strict test carries its own regression case naming that consequence |
| Resolving only one side, refusing legitimate stores | A case per resolver with the **root** behind a symlink and the candidate genuinely inside it, which must still be accepted (D3) |
| A hot path picks up a syscall it did not have | D2 confines the resolved predicate to the four transcript resolvers; the fourteen worktree-id comparisons keep the lexical one |
| Case folding authorizes a read into a case-distinct sibling | D7 — the resolved comparison keeps component case, with a regression whose two paths differ only in the case of one component |
| A prepared root goes stale mid-listing | D8 — the stale direction refuses rather than admits, and that direction is asserted |
| A local predicate survives the change | D6 — deletion is part of each adopting task, and the shared predicate's arrival is its own task so the adopters cannot land without it |
