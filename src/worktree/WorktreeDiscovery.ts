// src/worktree/WorktreeDiscovery.ts — Compose git into a WorktreeTree.
// See: docs/design/worktree-model.md § 3.3, § 6,
//      asimov/changes/enumerate-git-worktrees/design.md D6

import * as path from "node:path";
import { type AuthorizedDirectory, sameFileIdentity } from "../utils/authorizedDirectory";
import { isPathInside } from "../utils/pathBoundary";
import { describeGitFailure } from "./describeGitFailure";
import { type GitCapabilities, isUnsupportedZResult } from "./gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import { parseWorktreeList } from "./porcelainParser";
import {
  dedupeResolvedRepos,
  type FolderResolution,
  type GitApiAccessor,
  type ResolvedRepo,
  resolveRepoOutcomes,
} from "./repoRoots";
import type { WorktreeInfo, WorktreeRepo, WorktreeTree } from "./types";
import { orderWorktrees, type WorktreeActivityRank } from "./worktreeOrder";

/** docs/design/worktree-model.md § 3.3 — existence probes run 8 at a time. */
export const PRUNABLE_PROBE_CONCURRENCY = 8;

/** Repositories list concurrently so one hung `git` cannot stall its siblings. */
export const REPO_LISTING_CONCURRENCY = 8;

/**
 * The only `stat` failures that prove absence. Anything else — EACCES, a
 * descriptor limit, a network filesystem blip — leaves the worktree as the
 * `prunable` git already called it, which is the weaker and safer claim.
 */
const ABSENCE_CODES = new Set(["ENOENT", "ENOTDIR"]);

/** Run `task` over `items`, at most `limit` in flight, results by input index. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export interface WorktreeListingDeps {
  runner: GitCommandRunner;
  capabilities: GitCapabilities;
  normalize(p: string): Promise<string | null>;
  /** Existence probe; rejects when the path is absent. */
  stat(p: string): Promise<unknown>;
}

export interface RepoListing {
  worktrees: WorktreeInfo[];
  /** Deduplicated, for display. */
  reasons: string[];
  /** One per omitted worktree record — occurrences, not distinct reasons. */
  skipped: number;
  /** Set when this repo's listing failed; its worktrees are then empty. */
  degraded?: string;
}

export interface RepoListingOptions {
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
  readonly maxWorktrees?: number;
}

function describeFailure(result: GitCommandResult): string {
  return describeGitFailure(result, "git worktree list");
}

/** Run `worktree list`, preferring `-z` until this git rejects it. */
async function runListing(
  rootPath: string,
  deps: WorktreeListingDeps,
  options: RepoListingOptions | undefined,
): Promise<{ result: GitCommandResult; nulDelimited: boolean }> {
  const deadline = options?.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;
  const run = (args: readonly string[]) => {
    if (options === undefined) {
      return deps.runner.run(args, rootPath);
    }
    return deps.runner.run(args, rootPath, {
      ...(deadline === undefined ? {} : { timeoutMs: Math.max(1, deadline - Date.now()) }),
      ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
    });
  };
  return deps.capabilities.runWithFallback<{ result: GitCommandResult; nulDelimited: boolean }>(
    "worktree-list-z",
    async () => {
      const result = await run(["worktree", "list", "--porcelain", "-z"]);
      if (isUnsupportedZResult(result)) {
        return { supported: false };
      }
      return { supported: true, value: { result, nulDelimited: true } };
    },
    async () => ({
      result: await run(["worktree", "list", "--porcelain"]),
      nulDelimited: false,
    }),
  );
}

/**
 * Probe the *linked, unlocked* worktrees git already flagged prunable, so the UI
 * can say "missing" instead of the vaguer "prunable". A lock shields a
 * registration whose directory is intentionally absent, and the main worktree's
 * absence is a repo-level failure — neither is probed.
 */
async function annotateMissing(worktrees: WorktreeInfo[], deps: WorktreeListingDeps): Promise<void> {
  const candidates = worktrees.filter((w) => w.kind === "linked" && w.prunable && !w.locked && !w.bare);
  await mapBounded(candidates, PRUNABLE_PROBE_CONCURRENCY, async (worktree) => {
    try {
      await deps.stat(worktree.displayPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== undefined && ABSENCE_CODES.has(code)) {
        worktree.missing = true;
      }
    }
  });
}

/**
 * List one repository's worktrees. A failure is confined here as `degraded` —
 * it never throws, and never empties or disturbs another repository.
 */
export async function listRepoWorktrees(
  rootPath: string,
  deps: WorktreeListingDeps,
  options?: RepoListingOptions,
): Promise<RepoListing> {
  const { result, nulDelimited } = await runListing(rootPath, deps, options);
  if (result.code !== 0) {
    return { worktrees: [], reasons: [], skipped: 0, degraded: describeFailure(result) };
  }

  const parsed = parseWorktreeList(result.stdout, { nulDelimited });
  if (options?.maxWorktrees !== undefined && parsed.worktrees.length > options.maxWorktrees) {
    return {
      worktrees: [],
      reasons: [],
      skipped: 0,
      degraded: `git worktree list exceeded the ${options.maxWorktrees}-worktree limit`,
    };
  }
  const reasons = new Set(parsed.reasons);
  const worktrees: WorktreeInfo[] = [];
  let skipped = parsed.skipped;

  for (const record of parsed.worktrees) {
    const id = await deps.normalize(record.path);
    if (id === null) {
      reasons.add(`Could not resolve a worktree path reported by git: ${record.path}`);
      skipped += 1;
      continue;
    }
    worktrees.push({
      id,
      displayPath: record.path,
      kind: record.kind,
      bare: record.bare,
      branch: record.branch,
      head: record.head,
      detached: record.detached,
      locked: record.locked,
      lockReason: record.lockReason,
      prunable: record.prunable,
      missing: false,
      inWorkspace: false,
    });
  }

  await annotateMissing(worktrees, deps);
  return { worktrees, reasons: [...reasons], skipped };
}

function sameRegistration(left: AuthorizedDirectory, right: AuthorizedDirectory): boolean {
  return (
    left.path === right.path &&
    left.platform === right.platform &&
    left.components.length === right.components.length &&
    left.components.every(
      (component, index) =>
        component.path === right.components[index]?.path &&
        sameFileIdentity(component.identity, right.components[index]?.identity),
    )
  );
}

export async function listRegisteredRepoWorktrees(root: ResolvedRepo, deps: WorktreeTreeDeps): Promise<RepoListing> {
  const listing = await listRepoWorktrees(root.rootPath, deps);
  if (listing.degraded !== undefined || root.registration === undefined) {
    return listing;
  }
  const current = await deps.authorizeCommonDirectory?.(root.repoId).catch(() => undefined);
  return current !== undefined && sameRegistration(root.registration, current)
    ? listing
    : {
        worktrees: [],
        reasons: [],
        skipped: 0,
        degraded: "The repository registration changed while listing worktrees.",
      };
}

export interface WorktreeTreeDeps extends WorktreeListingDeps {
  authorizeCommonDirectory?(p: string): Promise<AuthorizedDirectory | undefined>;
  getGitApi?: GitApiAccessor;
  /** Supplied by the presence projection (P4); absent here — design.md D4. */
  rank?: WorktreeActivityRank;
}

/**
 * `inWorkspace` asks whether the user has this worktree open, so the test is
 * "a workspace folder is this path or lies inside it" — not the reverse. The
 * reverse answers false for a folder opened at `repo-wt/packages/api`, and a
 * false negative offers "add to workspace" for a folder already in it.
 */
function isOpenInWorkspace(worktreeId: string, folders: readonly string[]): boolean {
  return folders.some((folder) => isPathInside(folder, worktreeId));
}

/**
 * Turn one repository's listing into its group. Exported because a per-repo
 * rebuild must produce a group identical to the one a whole-tree build would —
 * `inWorkspace`, ordering, label and `mainPath` all derived the same way.
 */
export function assembleRepo(
  root: ResolvedRepo,
  listing: RepoListing,
  normalizedFolders: readonly string[],
  rank?: WorktreeActivityRank,
): WorktreeRepo {
  for (const worktree of listing.worktrees) {
    worktree.inWorkspace = isOpenInWorkspace(worktree.id, normalizedFolders);
  }

  const ordered = orderWorktrees(listing.worktrees, rank);
  const mainPath = ordered.find((w) => w.kind === "main")?.id ?? root.rootPath;
  return {
    repoId: root.repoId,
    label: path.basename(mainPath) || mainPath,
    mainPath,
    worktrees: ordered,
    ...(listing.degraded === undefined ? {} : { degraded: listing.degraded }),
  };
}

/** Normalize every workspace folder, dropping the ones that do not resolve. */
export async function normalizeFolders(
  workspaceFolders: readonly string[],
  deps: Pick<WorktreeTreeDeps, "normalize">,
): Promise<string[]> {
  const normalized: string[] = [];
  for (const folder of workspaceFolders) {
    const one = await deps.normalize(folder);
    if (one !== null) {
      normalized.push(one);
    }
  }
  return normalized;
}

/**
 * What a whole-tree build learned, not just what it produced. The cache needs
 * the roots to know what to keep and each repo's own `unreadable` contribution
 * to keep the aggregate exact when a single repo is rebuilt later.
 */
export interface WorktreeTreeBuild {
  tree: WorktreeTree;
  roots: ResolvedRepo[];
  /** Keyed by `repoId`; empty when git is unusable or no folder is a repo. */
  listings: Map<string, RepoListing>;
  /** Normalized workspace folders, reusable by a later per-repo rebuild. */
  normalizedFolders: string[];
  /** Set when git itself is unusable; the tree is then empty. */
  gitUnavailableReason?: string;
  /**
   * One entry per workspace folder, in folder order. The cache needs to tell a
   * folder that is not a repository from one whose resolution failed, which the
   * `roots` list alone cannot say (design.md D1, D2).
   */
  folderOutcomes: FolderResolution[];
}

/**
 * Build the whole tree, keeping what the build learned. Never throws: an
 * unusable git empties the tree with a reason, and a single repo's failure is
 * confined to that repo's `degraded`.
 */
export async function buildWorktreeTreeDetailed(
  workspaceFolders: readonly string[],
  deps: WorktreeTreeDeps,
): Promise<WorktreeTreeBuild> {
  const empty = { roots: [], listings: new Map<string, RepoListing>(), normalizedFolders: [] };
  if (workspaceFolders.length === 0) {
    return {
      ...empty,
      tree: { repos: [], unreadable: { count: 0, reasons: [] }, gitAvailable: true },
      folderOutcomes: [],
    };
  }

  const version = await deps.capabilities.probeVersion();
  if (version.kind !== "supported") {
    return {
      ...empty,
      tree: { repos: [], unreadable: { count: 1, reasons: [version.reason] }, gitAvailable: false },
      gitUnavailableReason: version.reason,
      // An unusable git is every folder failing to resolve at once, so retention
      // needs no second mechanism — the cache keeps each last good listing.
      folderOutcomes: workspaceFolders.map((folder) => ({
        folder,
        outcome: { kind: "failed" as const, reason: version.reason },
      })),
    };
  }

  const normalizedFolders = await normalizeFolders(workspaceFolders, deps);
  const folderOutcomes = await resolveRepoOutcomes(workspaceFolders, deps);
  const roots = dedupeResolvedRepos(folderOutcomes);
  const repos: WorktreeRepo[] = [];
  const reasons = new Set<string>();
  const listings = new Map<string, RepoListing>();
  let unreadableCount = 0;

  // Concurrent, but assembled by index: one repo's 10 s timeout must not delay
  // its siblings, and the result order still follows workspace-folder order.
  const results = await mapBounded(roots, REPO_LISTING_CONCURRENCY, (root) => listRegisteredRepoWorktrees(root, deps));

  for (const [index, root] of roots.entries()) {
    const listing = results[index];
    listings.set(root.repoId, listing);
    unreadableCount += listing.skipped;
    for (const reason of listing.reasons) {
      reasons.add(reason);
    }
    repos.push(assembleRepo(root, listing, normalizedFolders, deps.rank));
  }

  return {
    tree: { repos, unreadable: { count: unreadableCount, reasons: [...reasons] }, gitAvailable: true },
    roots,
    listings,
    normalizedFolders,
    folderOutcomes,
  };
}

/**
 * Build the whole tree. Never throws: an unusable git empties the tree with a
 * reason, and a single repo's failure is confined to that repo's `degraded`.
 */
export async function buildWorktreeTree(
  workspaceFolders: readonly string[],
  deps: WorktreeTreeDeps,
): Promise<WorktreeTree> {
  return (await buildWorktreeTreeDetailed(workspaceFolders, deps)).tree;
}
