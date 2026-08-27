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
  /**
   * See `WorktreeRepo.generation`. Absent when this repo's latest apply RETAINED
   * its worktrees instead of observing them.
   */
  generation: number | undefined;
  /**
   * Why this repository is not being watched, if it is not.
   *
   * Kept apart from the listing's own `degraded` because the two are different
   * claims with different consequences: a failed listing means these
   * registrations were never read, an unestablished watcher means later changes
   * to them may go unnoticed. Sharing one field lost the watcher claim on every
   * repo-scoped rebuild and let each overwrite the other (round-7 W8).
   */
  unwatched: string | undefined;
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
   * Record whether a repository is being watched — `undefined` clears it.
   *
   * A claim ABOUT a repository rather than a report of what it contains, so it
   * neither replaces its registrations nor withdraws the token they were
   * published under. It outlives every listing, because whether a watcher is
   * established has nothing to do with whether the last `git worktree list`
   * succeeded.
   */
  markUnwatched(repoId: string, reason: string | undefined): void;
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

/** Both claims, in one line, with neither able to hide the other. */
function composeDegraded(listing: string | undefined, unwatched: string | undefined): string | undefined {
  if (listing === undefined) {
    return unwatched;
  }
  return unwatched === undefined ? listing : `${listing} ${unwatched}`;
}

export function createWorktreeCache(): WorktreeCache {
  const repos = new Map<string, CachedRepo>();
  /**
   * Monotonic across the whole cache, so two repositories never hold the same
   * generation and a request quoting only the number cannot be read against the
   * wrong one.
   *
   * Every apply that OBSERVED a repository takes a fresh number for it,
   * including one whose listing came back identical: an identical listing is not
   * proof of continuity, only proof that git says the same thing.
   *
   * An apply that RETAINED — a degraded listing, where the stored worktrees are
   * kept because dropping to zero would read as "the user deleted these" —
   * publishes no number at all. Absence does both halves of the job at once: an
   * intent quoting the old number no longer matches, and a new one has nothing
   * to quote. Advancing instead would invalidate the first while minting
   * authority over registrations nobody looked at (round-5 B7).
   *
   * Neither `reorder` nor `read` takes a number — neither re-reads git, so
   * neither can have missed a replacement, and advancing there would refuse
   * launches for nothing (design.md D10).
   */
  let generationSeq = 0;
  const nextGeneration = (): number => (generationSeq += 1);
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
        generation: undefined,
        unwatched: stored.unwatched,
        reasons: stored.reasons,
        skipped: stored.skipped,
      };
    }
    return {
      repo: incoming,
      generation: nextGeneration(),
      // Survives the listing that just replaced everything else: a rebuild says
      // what the repository contains, never whether it is being watched.
      unwatched: stored?.unwatched,
      reasons: listing.reasons,
      skipped: listing.skipped,
    };
  }

  function applyBuild(build: WorktreeTreeBuild): void {
    const next = new Map<string, CachedRepo>();
    for (const repo of build.tree.repos) {
      const listing = build.listings.get(repo.repoId);
      next.set(
        repo.repoId,
        listing
          ? merge(repo.repoId, repo, listing)
          : {
              repo,
              generation: nextGeneration(),
              unwatched: repos.get(repo.repoId)?.unwatched,
              reasons: [],
              skipped: 0,
            },
      );
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
            // Retained for the same reason and on the same terms: this folder
            // failed to resolve, so nothing here was observed either.
            repo: { ...stored.repo, degraded: outcome.reason },
            generation: undefined,
            unwatched: stored.unwatched,
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

  function markUnwatched(repoId: string, reason: string | undefined): void {
    const cached = repos.get(repoId);
    if (!cached) {
      return;
    }
    repos.set(repoId, { ...cached, unwatched: reason });
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
      // Composed at read, not merged at write: the listing failure is the more
      // specific and more urgent claim, so it leads, and the watcher warning is
      // appended rather than replacing it (round-7 W8).
      const degraded = composeDegraded(cached.repo.degraded, cached.unwatched);
      out.push({
        ...cached.repo,
        ...(degraded === undefined ? {} : { degraded }),
        ...(cached.generation === undefined ? {} : { generation: cached.generation }),
        worktrees: [...cached.repo.worktrees],
      });
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
      //
      // The registration token goes for the same reason and to the same extent:
      // an unusable git OBSERVED nothing, so no group may authorize a launch or
      // a removal on a number minted before git went away (design.md D12).
      const marked = out.map((repo) => {
        const retained: WorktreeRepo = { ...repo };
        delete retained.generation;
        return reason === undefined || retained.degraded !== undefined ? retained : { ...retained, degraded: reason };
      });
      return { repos: marked, unreadable: { count, reasons: [...reasons] }, gitAvailable: false };
    }

    return { repos: out, unreadable: { count, reasons: [...reasons] }, gitAvailable: true };
  }

  return {
    applyBuild,
    applyRepo,
    markUnwatched,
    reorder,
    read,
    roots: () => order,
    rootFor: (repoId) => order.find((one) => one.repoId === repoId),
    normalizedFolders: () => folders,
  };
}
