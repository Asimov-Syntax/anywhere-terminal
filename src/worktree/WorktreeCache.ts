// src/worktree/WorktreeCache.ts — The window's in-memory worktree tree.
// See: docs/design/worktree-model.md § 3.6, § 5,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D2
//
// Nothing is persisted; a cold window rebuilds from git on first show. What the
// cache adds over a plain snapshot is stickiness: a repository that listed three
// worktrees a second ago and now fails keeps showing three, marked degraded.
// Dropping to zero would read as "the user deleted their worktrees".

import type { ResolvedRepo } from "./repoRoots";
import type { WorktreeRepo, WorktreeTree } from "./types";
import { assembleRepo, type RepoListing, type WorktreeTreeBuild } from "./WorktreeDiscovery";
import { orderWorktrees, type WorktreeActivityRank } from "./worktreeOrder";

interface CachedRepo {
  repo: WorktreeRepo;
  /** This repo's own share of the tree's `unreadable`, replaced per rebuild. */
  reasons: string[];
  skipped: number;
}

export interface WorktreeCache {
  /** Replace everything from a whole-tree rebuild, keeping last-good listings. */
  applyBuild(build: WorktreeTreeBuild): void;
  /** Update one repository. A repoId outside the resolved roots is ignored. */
  applyRepo(repoId: string, listing: RepoListing, rank?: WorktreeActivityRank): void;
  /**
   * Re-sort every stored group against a rank taken now — no git read.
   *
   * Order is baked in at `assembleRepo` time, using the rank the projector held
   * then. Presence-only work moves the rank without ever re-assembling a group,
   * so a worktree that just gained an agent would otherwise not move until some
   * unrelated git rebuild happened to re-read it (design.md D8).
   */
  reorder(rank?: WorktreeActivityRank): void;
  /** The assembled tree, in resolved-root order. */
  read(): WorktreeTree;
  roots(): readonly ResolvedRepo[];
  rootFor(repoId: string): ResolvedRepo | undefined;
  normalizedFolders(): readonly string[];
}

export function createWorktreeCache(): WorktreeCache {
  const repos = new Map<string, CachedRepo>();
  /**
   * Which repository each workspace folder resolved to, last time it did. A
   * failed resolution never learns the `repoId` — the `repoId` IS the common dir
   * it failed to read — so the folder path is the only key available to tell a
   * transient failure from the user removing the folder (design.md D2).
   */
  let repoByFolder = new Map<string, ResolvedRepo>();
  let order: ResolvedRepo[] = [];
  let folders: string[] = [];
  let gitAvailable = true;
  let gitUnavailableReason: string | undefined;

  /**
   * Merge one incoming group over what is stored. A degraded listing carries no
   * worktrees and produced no records, so it retracts neither.
   */
  function merge(repoId: string, incoming: WorktreeRepo, listing: RepoListing): CachedRepo {
    const stored = repos.get(repoId);
    if (listing.degraded !== undefined && stored) {
      return {
        repo: { ...incoming, worktrees: stored.repo.worktrees, degraded: listing.degraded },
        reasons: stored.reasons,
        skipped: stored.skipped,
      };
    }
    return { repo: incoming, reasons: listing.reasons, skipped: listing.skipped };
  }

  function applyBuild(build: WorktreeTreeBuild): void {
    const next = new Map<string, CachedRepo>();
    for (const repo of build.tree.repos) {
      const listing = build.listings.get(repo.repoId);
      next.set(repo.repoId, listing ? merge(repo.repoId, repo, listing) : { repo, reasons: [], skipped: 0 });
    }

    // Walk the folders rather than the roots: only a folder can say whether a
    // missing repository was removed by the user or merely failed to resolve.
    // The memory is rebuilt from this walk, so a folder no longer open drops out.
    const nextOrder: ResolvedRepo[] = [];
    const nextRepoIds = new Set<string>();
    const nextRepoByFolder = new Map<string, ResolvedRepo>();
    for (const { folder, outcome } of build.folderOutcomes) {
      let resolved: ResolvedRepo | undefined;
      if (outcome.kind === "resolved") {
        resolved = outcome.repo;
      } else if (outcome.kind === "failed") {
        // `absent` is an answer — that folder is not a repository, so anything
        // remembered for it is genuinely gone. `failed` is the absence of one.
        const remembered = repoByFolder.get(folder);
        const stored = remembered && repos.get(remembered.repoId);
        if (remembered && next.has(remembered.repoId)) {
          // A sibling folder names this same repository and did resolve, so its
          // fresh listing stands. This folder still keeps the mapping: the day
          // that sibling closes, it is the only memory the group has left.
          resolved = remembered;
        } else if (remembered && stored) {
          next.set(remembered.repoId, {
            repo: { ...stored.repo, degraded: outcome.reason },
            reasons: stored.reasons,
            skipped: stored.skipped,
          });
          resolved = remembered;
        }
      }
      if (resolved === undefined) {
        continue;
      }
      nextRepoByFolder.set(folder, resolved);
      if (!nextRepoIds.has(resolved.repoId)) {
        nextRepoIds.add(resolved.repoId);
        nextOrder.push(resolved);
      }
    }

    // Entries absent from the new root set are gone, not stale: a workspace
    // folder that was removed must not leave its group behind.
    repos.clear();
    for (const [repoId, cached] of next) {
      if (nextRepoIds.has(repoId)) {
        repos.set(repoId, cached);
      }
    }
    repoByFolder = nextRepoByFolder;
    order = nextOrder;
    folders = [...build.normalizedFolders];
    gitAvailable = build.tree.gitAvailable;
    gitUnavailableReason = build.gitUnavailableReason;
  }

  function applyRepo(repoId: string, listing: RepoListing, rank?: WorktreeActivityRank): void {
    const root = order.find((one) => one.repoId === repoId);
    if (!root) {
      return;
    }
    repos.set(repoId, merge(repoId, assembleRepo(root, listing, folders, rank), listing));
  }

  function reorder(rank?: WorktreeActivityRank): void {
    for (const cached of repos.values()) {
      cached.repo = { ...cached.repo, worktrees: orderWorktrees(cached.repo.worktrees, rank) };
    }
  }

  function read(): WorktreeTree {
    const out: WorktreeRepo[] = [];
    const reasons = new Set<string>();
    let count = 0;
    for (const root of order) {
      const cached = repos.get(root.repoId);
      if (!cached) {
        continue;
      }
      // A copy of the group and of its worktree list: `read()` runs on every
      // broadcast, and a consumer that mutates what it was handed must not be
      // able to edit the cache. The `WorktreeInfo` records inside stay shared —
      // copying each one per read costs with worktree count for no caller.
      out.push({ ...cached.repo, worktrees: [...cached.repo.worktrees] });
      count += cached.skipped;
      for (const reason of cached.reasons) {
        reasons.add(reason);
      }
    }
    if (!gitAvailable) {
      // An unusable git is a failure to read, not a deletion: the retained
      // listings are what the window keeps showing until git answers again, and
      // only a window that never listed anything has nothing to show. The
      // capability probe is memoised for 30 min, so emptying here could not be
      // undone by a refresh either (design.md D3).
      const reason = gitUnavailableReason;
      if (reason !== undefined) {
        reasons.add(reason);
        count += 1;
      }
      // Marking here rather than at write time is what keeps the mark true of
      // every retained group: a per-repo rebuild that landed after git went
      // away would otherwise read as fresh under a tree calling git unusable.
      // A group that already names a more specific cause keeps it.
      const marked =
        reason === undefined ? out : out.map((r) => (r.degraded === undefined ? { ...r, degraded: reason } : r));
      return { repos: marked, unreadable: { count, reasons: [...reasons] }, gitAvailable: false };
    }

    return { repos: out, unreadable: { count, reasons: [...reasons] }, gitAvailable: true };
  }

  return {
    applyBuild,
    applyRepo,
    reorder,
    read,
    roots: () => order,
    rootFor: (repoId) => order.find((one) => one.repoId === repoId),
    normalizedFolders: () => folders,
  };
}
