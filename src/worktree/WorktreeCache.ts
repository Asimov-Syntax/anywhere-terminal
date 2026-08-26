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
import type { WorktreeActivityRank } from "./worktreeOrder";

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
  /** The assembled tree, in resolved-root order. */
  read(): WorktreeTree;
  roots(): readonly ResolvedRepo[];
  rootFor(repoId: string): ResolvedRepo | undefined;
  normalizedFolders(): readonly string[];
}

export function createWorktreeCache(): WorktreeCache {
  const repos = new Map<string, CachedRepo>();
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
    // Entries absent from the new root set are gone, not stale: a workspace
    // folder that was removed must not leave its group behind.
    repos.clear();
    for (const [repoId, cached] of next) {
      repos.set(repoId, cached);
    }
    order = [...build.roots];
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

  function read(): WorktreeTree {
    if (!gitAvailable) {
      return {
        repos: [],
        unreadable: {
          count: gitUnavailableReason === undefined ? 0 : 1,
          reasons: gitUnavailableReason === undefined ? [] : [gitUnavailableReason],
        },
        gitAvailable: false,
      };
    }

    const out: WorktreeRepo[] = [];
    const reasons = new Set<string>();
    let count = 0;
    for (const root of order) {
      const cached = repos.get(root.repoId);
      if (!cached) {
        continue;
      }
      out.push(cached.repo);
      count += cached.skipped;
      for (const reason of cached.reasons) {
        reasons.add(reason);
      }
    }
    return { repos: out, unreadable: { count, reasons: [...reasons] }, gitAvailable: true };
  }

  return {
    applyBuild,
    applyRepo,
    read,
    roots: () => order,
    rootFor: (repoId) => order.find((one) => one.repoId === repoId),
    normalizedFolders: () => folders,
  };
}
