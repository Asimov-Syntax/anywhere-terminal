---
topic: Orca path-to-worktree and repository resolution
created-by: user request
source: /Users/huybuidac/Projects/ai-oss/orca@9062494f9b
date: 2026-08-30
verified: 2026-08-30
libraries: [Orca]
used-by: [attribute-a-path-to-the-worktree-it-resolves-into]
---

# Research: Orca path-to-worktree and repository resolution

## 1. Ownership and containment sites

### Terminal pane cwd → worktree

The Checks panel polls the active local PTY cwd, then chooses the deepest current/prior worktree path containing it:

- `src/renderer/src/components/right-sidebar/checks-panel-terminal-worktree.ts:47-61`
  ```ts
  /** Resolve the worktree whose current or prior path contains the terminal cwd. */
  const best = buildWorktreeCandidates(worktrees)
    .filter((candidate) => isTerminalCwdInsideWorktree(candidate.path, terminalCwd))
    .sort(compareWorktreeCandidates)[0]
  ```
- `src/renderer/src/components/right-sidebar/checks-panel-terminal-worktree.ts:87-95`
  ```ts
  if (isPathInsideOrEqual(worktreePath, terminalCwd)) return true
  const wslPath = parseWslUncPath(worktreePath)
  return wslPath ? isPathInsideOrEqual(wslPath.linuxPath, terminalCwd) : false
  ```
- The runtime has a second cwd-attribution site for otherwise-unattributed PTYs: `src/main/runtime/orca-runtime.ts:41768-41789`.
  ```ts
  const matches = resolvedWorktrees
    .filter((worktree) => isPathInsideOrEqual(worktree.path, cwd))
    .sort((left, right) => right.path.length - left.path.length)
  ```
- A CLI/current-path path does the same longest-root scan after only `path.resolve(cwd)`: `src/main/runtime/orca-runtime.ts:37051-37062`.

**Verdict:** terminal cwd ownership is a lexical, normalized-prefix comparison. It does not `realpath` the cwd or worktree roots.

### Repository root discovery

The primary path is Git itself:

- `src/main/git/repo-detection.ts:76-97`
  ```ts
  const root = gitExecFileSync(['rev-parse', '--show-toplevel'], { cwd: path }).trim()
  return normalizeGitRepoRootForInputPath(path, root)
  ```

The filesystem fallback explicitly resolves the input once, scans both spellings, and preserves the lexical root only when both scans identify the same filesystem entry:

- `src/main/git/repo-git-marker-scan.ts:12-27`
  ```ts
  const realPath = resolveRealPathSync(path)
  if (realPath && realPath !== path) {
    const lexicalScan = scanGitMarkerAncestorsSync(path)
    const realPathScan = scanGitMarkerAncestorsSync(realPath)
    if (... pathsReferToSameEntry(lexicalScan.rootPath, realPathScan.rootPath)) {
      return lexicalScan
    }
    return realPathScan
  }
  ```
- `src/main/git/repo-git-marker-scan.ts:30-39` uses `realpathSync.native`, then `realpathSync` fallback.
- `src/main/git/repo-git-marker-scan.ts:70-82` tests `.git` containment lexically with `relative(rootPath, targetPath)`; `pathsReferToSameEntry` at `85-99` cross-checks inode/device, then both realpaths.

Registration stores Git's/fallback's returned root, not an unconditional canonical path:

- `src/main/ipc/repos/local-repo-registration.ts:30-45,75-79`
  ```ts
  const resolvedPath = repoKind === 'git' ? getGitRepoRoot(path) : path
  ...
  path: resolvedPath
  ```

**Verdict:** root discovery is mixed: Git-first; the marker fallback resolves at discovery time, but Orca deliberately may preserve the user's lexical spelling. Repository registration is not a general “canonicalize once” boundary.

### File-tree containment

The renderer's reveal, watcher filtering, and tree bookkeeping share lexical helpers:

- `src/shared/cross-platform-path.ts:124-137`
  ```ts
  const root = normalizeRuntimePathForComparison(rootPath)
  const rootWithBoundary = ... `${root.replace(/\/+$/, '')}/`
  return (normalizedCandidate) =>
    normalizedCandidate === root || normalizedCandidate.startsWith(rootWithBoundary)
  ```
- `src/shared/cross-platform-path.ts:140-161` uses the same normalized prefix in `relativePathInsideRoot`.
- File Explorer calls it at `src/renderer/src/components/right-sidebar/file-explorer-paths.ts:28-35` and `file-explorer-watch-path.ts:20-39`.

Local file IPC is stricter and resolves at operation time:

- `src/main/ipc/filesystem.ts:552-560` calls `resolveAuthorizedPath` before `readdir`; reads/writes/deletes do likewise at `596`, `860`, `898`, and `936`.
- `src/main/ipc/filesystem-auth.ts:61-103`
  ```ts
  const resolvedTarget = resolve(targetPath)
  ...
  const realTarget = resolve(await realpath(resolvedTarget))
  if (!(await isPathAllowedIncludingRegisteredWorktrees(realTarget, store, {
    canonicalSourcePath: resolvedTarget
  }))) throw ...
  return realTarget
  ```
- Its comparison primitive is still lexical after canonicalization: `src/main/ipc/filesystem-path-containment.ts:8-15` uses `relative(resolvedBase, resolvedTarget)` and rejects `..`/absolute results.

**Verdict:** renderer containment is shared lexical normalization; security-sensitive file operations resolve the candidate per operation, then compare lexically against allowed roots.

### Git decoration scoping

Git status is already scoped by the selected worktree because Git runs with that path as cwd:

- `src/main/git/source-control/status-read.ts:100-104,126-140`
  ```ts
  function runGetStatus(worktreePath: string, ...)
  ...
  gitStreamStdout(statusArgs, { cwd: worktreePath, ... })
  ```

Returned entries are worktree-relative strings; decoration maps do no absolute ownership resolution:

- `src/renderer/src/components/right-sidebar/status-display.ts:47-59`
  ```ts
  const path = normalizeRelativePath(entry.path)
  statusByPath.set(path, resolved)
  ```

Watcher-triggered refresh scoping is lexical:

- `src/renderer/src/components/right-sidebar/git-status-file-watch-refresh.ts:38-57`
  ```ts
  normalizeRuntimePathForComparison(payload.worktreePath) !==
    normalizeRuntimePathForComparison(worktreePath)
  ...
  return relativePathInsideRoot(worktreePath, event.absolutePath) !== null
  ```

**Verdict:** decorations inherit the explicitly selected worktree; event scoping is lexical. There is no per-decoration or per-event realpath.

## 2. Lexical vs resolved; shared predicate vs hand-rolled

The dominant shared predicate is `isPathInsideOrEqual` / `relativePathInsideRoot` in `src/shared/cross-platform-path.ts:124-161`. It normalizes NFC, separators, Windows case, and WSL UNC aliases (`41-57`), but does not touch the filesystem.

Hand-rolled exceptions remain:

- Claude usage attribution: resolved paths, then `child === parent || child.startsWith(`${parent}/`)` at `src/main/claude-usage/worktree-attribution.ts:29-47`.
- Codex/OpenCode usage attribution: canonical worktree paths but an unresolved cwd, then `win32.relative`/`posix.relative` at `src/main/codex-usage/codex-usage-event-attribution.ts:35-57,60-70` and `src/main/opencode-usage/opencode-usage-worktree-attribution.ts:37-55,72-82`.
- File IPC has its own `isDescendantOrEqual` because it compares already-resolved local paths and enforces traversal security (`src/main/ipc/filesystem-path-containment.ts:4-15`).

**Verdict:** there is a shared lexical predicate for UI/runtime ownership, but not one universal predicate. Security and usage scanners use separate shapes.

## 3. Where resolution happens

There is no single application-wide boundary where all repo/worktree paths are canonicalized and cached.

Three distinct shapes exist:

1. **Terminal cwd attribution, runtime ownership, renderer file tree, Git refresh scoping:** no realpath at all; compare current stored paths lexically at each site.
2. **File IPC authorization:** resolve the candidate at each filesystem operation. Roots are kept lexical initially, then only the matching root is canonicalized on demand (`src/main/ipc/filesystem-auth.ts:173-192`).
3. **Watchers:** resolve once per subscription, not per event. `src/main/ipc/watcher-event-root-path-rewrite.ts:129-156` says and implements:
   ```ts
   // one `realpath` per subscribe (not per event)
   watchRoot = (deps.realpath ?? realpathSync.native)(requestedRoot)
   return { watchRoot, rewriteEventPath: createRootPathRewriter(requestedRoot, watchRoot, ...) }
   ```
   Events are rewritten from canonical back to requested spelling (`80-119`) before renderer lexical checks.

Usage analytics is another boundary-scoped variant: worktree roots are realpathed once per scan with concurrency 8 (`src/main/usage-worktree-canonicalizer.ts:7-35`), while Claude cwd realpaths are cached per unique transcript cwd during that scan (`src/main/claude-usage/worktree-attribution.ts:108-129`).

**Verdict:** for the interactive ownership path in question, Orca does **not** use either realpath shape; it is lexical. Where correctness/security requires realpath, Orca uses a hybrid: per-operation candidate resolution, on-demand root resolution, and per-subscription watcher resolution.

## 4. Cache invalidation

The file-authorization root cache stores lexical `path.resolve` roots, not canonical roots:

- `src/main/ipc/registered-worktree-roots-cache.ts:22-57`
  ```ts
  // Why no realpath here: canonicalizing every root on invalidation would trigger macOS TCC prompts
  roots.push(resolve(repo.path))
  roots.push(resolve(worktree.path))
  ```
- Fresh `git worktree list` results seed it at `src/main/ipc/worktrees/listing/detected-worktree-scan-cache.ts:120-132` and after creation at `src/main/ipc/worktree-remote.ts:2558-2563`.
- `invalidateAuthorizedRootsCache` marks dirty and clears all sets immediately (`registered-worktree-roots-cache.ts:14-20`). It is called on repo add/update/remove, folder→Git upgrade, worktree create/remove/forget, and runtime equivalents; representative sites include `folder-repo-git-upgrade.ts:132-145`, `repos/repo-catalog-handlers.ts:90,103`, and `worktrees/removal/execute-worktree-removal.ts:122`.

Canonical matched roots are added to the same set lazily:

- `registered-worktree-roots-cache.ts:180-197`
  ```ts
  const canonicalRoot = await normalizeExistingPath(textualRoot)
  ...
  registeredWorktreeRoots.add(canonicalRoot)
  ```

There is no TTL or filesystem watcher specifically for a symlink being repointed. A repo/worktree catalog mutation clears the set; otherwise a lazily cached old canonical alias can remain until such invalidation or process restart. Watcher canonical roots are fixed for that subscription and change only when the watcher is removed/reinstalled.

**Verdict:** structural repo/worktree mutations invalidate; symlink retargeting alone has no dedicated invalidation, watcher, or TTL.

## 5. Root reached through a symlink

File IPC handles both sides correctly. It realpaths the target, remembers the original source spelling, finds the matching lexical root, then realpaths that root before comparing:

- `src/main/ipc/filesystem-auth.ts:93-103,173-190`
  ```ts
  const realTarget = resolve(await realpath(resolvedTarget))
  ... canonicalSourcePath: resolvedTarget
  ...
  const canonicalRoot = await normalizeExistingPath(resolvedRoot)
  if (isDescendantOrEqual(targetPath, canonicalRoot)) return true
  ```
- The registered-worktree equivalent explicitly names `/var→/private/var`: `src/main/ipc/registered-worktree-roots-cache.ts:191-197`.

Watchers also handle root aliases by resolving the root once and mapping canonical event paths back to the requested spelling. The problem and solution are explicit in `src/main/ipc/watcher-event-root-path-rewrite.ts:1-23`.

The lexical ownership predicates do **not** handle `/var/x` versus `/private/var/x`. They normalize syntax/Unicode/case/WSL aliases only. Therefore terminal cwd attribution, runtime cwd ownership, and direct renderer containment can false-negative when candidate and root arrive in different symlink spellings. Repository marker fallback avoids this by scanning both lexical and real paths; Git-first discovery depends on Git's returned spelling and intentionally does not canonicalize registration globally.

**Verdict:** root symlinks are handled in file authorization, watcher installation, and marker fallback, but not in the general worktree-ownership predicate.

## 6. Cost evidence

Orca explicitly avoids realpath on hot/event paths:

- Shared matcher pre-normalizes the root for fan-out (`src/shared/cross-platform-path.ts:116-132`), leaving each candidate as string normalization + equality/prefix.
- Watchers pay “one `realpath` per subscribe (not per event)” (`watcher-event-root-path-rewrite.ts:129-146`); the common rewrite path returns unchanged events and the batch helper avoids allocation when no rewrite is needed (`159-177`).
- Root-cache rebuild avoids realpath because it may trigger macOS TCC prompts (`registered-worktree-roots-cache.ts:22-35`); file auth performs cheap lexical checks before targeted realpath (`122-147`, `filesystem-auth.ts:143-170`).
- Terminal cwd polling itself is throttled: main caches/coalesces per PID for 1.5s (`src/main/providers/process-cwd.ts:16-53`), the Checks panel polls every 4s and only while both panel and window are visible (`use-checks-panel-terminal-worktree.ts:15-19,30-37,128-140`). The subsequent worktree comparison is syscall-free.
- Usage scans bound root-realpath fan-out to 8 (`usage-worktree-canonicalizer.ts:1,16-35`) and Claude attribution caches repeated cwd realpaths per scan (`claude-usage/worktree-attribution.ts:108-128`).

**Verdict:** yes—Orca deliberately moves realpath off per-event comparisons, limits it to subscriptions/operations/scans, and caches or bounds the remaining filesystem/process probes.

## Recommended Approach

- Do not describe Orca as globally “resolve once at registration”: its stored repo/worktree model preserves lexical paths.
- If copying its interactive attribution behavior, copy the shared normalized lexical predicate and accept symlink-alias false negatives.
- If symlink-correct attribution is required, Orca's closest proven shape is watcher/file-auth hybrid: preserve the user spelling, canonicalize both candidate and matched root, and cache only at a lifecycle boundary with explicit invalidation.

## Confidence

High — direct local source inspection at Orca `9062494f9b`, including comparison implementations, callers, cache writes, invalidators, and comments documenting syscall/TCC costs.

## Bottom line

Orca's actual interactive “which worktree owns this path?” shape is **pure lexical everywhere**, not “resolve at each site” or “resolve once at the boundary”; it pays zero realpath syscalls on cwd/file-event attribution but can false-negative across symlink aliases. In the narrower subsystems that require symlink correctness, it mostly chooses **resolve once at the boundary** for watchers, but **resolve at each operation** for file authorization.
