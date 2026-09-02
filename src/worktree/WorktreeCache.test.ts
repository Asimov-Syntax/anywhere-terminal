import { describe, expect, it } from "vitest";
import type { FolderResolution, ResolvedRepo } from "./repoRoots";
import type { WorktreeInfo } from "./types";
import { createWorktreeCache } from "./WorktreeCache";
import type { RepoListing, WorktreeTreeBuild } from "./WorktreeDiscovery";

function worktree(id: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id,
    displayPath: id,
    kind: "linked",
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    missing: false,
    inWorkspace: false,
    ...over,
  };
}

function listing(worktrees: WorktreeInfo[], over: Partial<RepoListing> = {}): RepoListing {
  return { worktrees, reasons: [], skipped: 0, ...over };
}

function root(repoId: string, ino?: number): ResolvedRepo {
  return {
    repoId,
    rootPath: repoId.replace(/\/\.git$/, ""),
    ...(ino === undefined
      ? {}
      : {
          registration: {
            path: repoId,
            platform: "darwin",
            components: [{ path: repoId, identity: { dev: 1, ino } }],
          },
        }),
  };
}

/** A whole-tree build for `roots`, each with the listing given for its repoId. */
function build(
  roots: ResolvedRepo[],
  listings: Record<string, RepoListing>,
  folderOutcomes?: FolderResolution[],
): WorktreeTreeBuild {
  const map = new Map(Object.entries(listings));
  let skipped = 0;
  const reasons = new Set<string>();
  for (const one of map.values()) {
    skipped += one.skipped;
    for (const reason of one.reasons) {
      reasons.add(reason);
    }
  }
  return {
    tree: {
      repos: roots.map((r) => {
        const one = map.get(r.repoId) as RepoListing;
        return {
          repoId: r.repoId,
          label: r.rootPath,
          mainPath: r.rootPath,
          worktrees: one.worktrees,
          ...(one.degraded === undefined ? {} : { degraded: one.degraded }),
        };
      }),
      unreadable: { count: skipped, reasons: [...reasons] },
      gitAvailable: true,
    },
    roots,
    listings: map,
    normalizedFolders: roots.map((r) => r.rootPath),
    folderOutcomes:
      folderOutcomes ?? roots.map((r) => ({ folder: r.rootPath, outcome: { kind: "resolved" as const, repo: r } })),
  };
}

const REPO_A = root("/a/.git");
const REPO_B = root("/b/.git");

describe("WorktreeCache", () => {
  it("reads back the repos of a whole-tree build in root order", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a", { kind: "main" }), worktree("/a-wt")]),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      }),
    );

    const tree = cache.read();

    expect(tree.repos.map((r) => r.repoId)).toEqual(["/a/.git", "/b/.git"]);
    expect(tree.repos[0].worktrees).toHaveLength(2);
    expect(tree.gitAvailable).toBe(true);
  });

  it("resolves only the current authoritative generation to private registration evidence", () => {
    const cache = createWorktreeCache();
    const registered = root("/a/.git", 11);
    cache.applyBuild(build([registered], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    const generation = cache.readRepo("/a/.git")?.generation;

    expect(cache.registrationFor("/a/.git", generation as number)).toEqual(registered.registration);
    expect(cache.registrationFor("/a/.git", (generation as number) + 1)).toBeUndefined();
    expect(cache.read().repos[0]).not.toHaveProperty("registration");

    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" })]));
    const relistedGeneration = cache.readRepo("/a/.git")?.generation as number;
    expect(cache.registrationFor("/a/.git", generation as number)).toBeUndefined();
    expect(cache.registrationFor("/a/.git", relistedGeneration)).toEqual(registered.registration);

    const refreshed = root("/a/.git", 12);
    cache.applyBuild(build([refreshed], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    const refreshedGeneration = cache.readRepo("/a/.git")?.generation as number;
    expect(cache.registrationFor("/a/.git", refreshedGeneration)).toEqual(refreshed.registration);
  });

  it("withholds private registration when a repo-scoped listing is degraded", () => {
    const cache = createWorktreeCache();
    const registered = root("/a/.git", 11);
    cache.applyBuild(build([registered], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    cache.applyRepo("/a/.git", listing([], { degraded: "registration changed" }));

    expect(cache.readRepo("/a/.git")?.generation).toBeUndefined();
    expect(cache.registrationFor("/a/.git", 1)).toBeUndefined();
  });

  it("keeps a repo's last good listing when its rebuild fails", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A], {
        "/a/.git": listing([worktree("/a", { kind: "main" }), worktree("/a-1"), worktree("/a-2")]),
      }),
    );
    expect(cache.read().repos[0].worktrees).toHaveLength(3);

    cache.applyRepo("/a/.git", listing([], { degraded: "`git worktree list` timed out." }));

    // Dropping to zero would read as "the user deleted their worktrees".
    const repo = cache.read().repos[0];
    expect(repo.worktrees).toHaveLength(3);
    expect(repo.degraded).toBe("`git worktree list` timed out.");
  });

  it("clears degraded when the repo lists cleanly again", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    cache.applyRepo("/a/.git", listing([], { degraded: "boom" }));
    expect(cache.read().repos[0].degraded).toBe("boom");

    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" }), worktree("/a-new")]));

    const repo = cache.read().repos[0];
    expect(repo.degraded).toBeUndefined();
    expect(repo.worktrees).toHaveLength(2);
  });

  it("reports an empty group with a reason when the first ever read fails, leaving siblings populated", () => {
    const cache = createWorktreeCache();

    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([], { degraded: "no such repository" }),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      }),
    );

    const tree = cache.read();
    expect(tree.repos[0].worktrees).toHaveLength(0);
    expect(tree.repos[0].degraded).toBe("no such repository");
    expect(tree.repos[1].worktrees).toHaveLength(1);
  });

  it("confines a per-repo rebuild to that repo", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a", { kind: "main" })]),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      }),
    );
    const before = cache.read().repos[1];

    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" }), worktree("/a-2")]));

    const after = cache.read();
    expect(after.repos[0].worktrees).toHaveLength(2);
    expect(after.repos[1]).toEqual(before);
  });

  it("drops a repo that left the resolved root set", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a", { kind: "main" })]),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      }),
    );

    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));

    expect(cache.read().repos.map((r) => r.repoId)).toEqual(["/a/.git"]);
  });

  it("ignores a per-repo apply for a repo the workspace no longer holds", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));

    cache.applyRepo("/b/.git", listing([worktree("/b", { kind: "main" })]));

    expect(cache.read().repos.map((r) => r.repoId)).toEqual(["/a/.git"]);
  });

  it("aggregates unreadable counts and dedupes reasons across repos", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([], { skipped: 2, reasons: ["unparseable record"] }),
        "/b/.git": listing([], { skipped: 1, reasons: ["unparseable record"] }),
      }),
    );

    const tree = cache.read();
    expect(tree.unreadable.count).toBe(3);
    expect(tree.unreadable.reasons).toEqual(["unparseable record"]);
  });

  it("replaces a repo's unreadable contribution rather than adding to it", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([], { skipped: 2, reasons: ["bad record in a"] }),
        "/b/.git": listing([], { skipped: 1, reasons: ["bad record in b"] }),
      }),
    );
    expect(cache.read().unreadable.count).toBe(3);

    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" })]));

    const tree = cache.read();
    expect(tree.unreadable.count).toBe(1);
    expect(tree.unreadable.reasons).toEqual(["bad record in b"]);
  });

  it("keeps a degraded repo's previous unreadable contribution", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a")], { skipped: 2, reasons: ["bad"] }) }));

    cache.applyRepo("/a/.git", listing([], { degraded: "timed out" }));

    // A listing that failed produced no records, so it retracts none.
    expect(cache.read().unreadable).toEqual({ count: 2, reasons: ["bad"] });
  });

  /** What `buildWorktreeTreeDetailed` produces once git stops being usable. */
  function gitGone(reason: string, folders: string[]): WorktreeTreeBuild {
    return {
      tree: { repos: [], unreadable: { count: 1, reasons: [reason] }, gitAvailable: false },
      roots: [],
      listings: new Map(),
      normalizedFolders: [],
      gitUnavailableReason: reason,
      folderOutcomes: folders.map((folder) => ({ folder, outcome: { kind: "failed" as const, reason } })),
    };
  }

  it("keeps the retained repositories when git becomes unavailable", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" }), worktree("/a/wt")]) }));

    cache.applyBuild(gitGone("git 2.20 is below 2.31", ["/a"]));

    const tree = cache.read();
    // Audit A2: dropping to zero here read as "the user deleted their worktrees",
    // and the capability probe is memoised for 30 min so a refresh could not undo it.
    expect(tree.gitAvailable).toBe(false);
    expect(tree.repos).toHaveLength(1);
    expect(tree.repos[0].worktrees).toHaveLength(2);
    expect(tree.repos[0].degraded).toContain("2.31");
    expect(tree.unreadable).toEqual({ count: 1, reasons: ["git 2.20 is below 2.31"] });
  });

  it("reports no repositories when git is unavailable and none was ever listed", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(gitGone("git 2.20 is below 2.31", ["/a"]));

    const tree = cache.read();
    expect(tree.gitAvailable).toBe(false);
    expect(tree.repos).toHaveLength(0);
    expect(tree.unreadable).toEqual({ count: 1, reasons: ["git 2.20 is below 2.31"] });
  });

  it("exposes the roots and normalized folders a per-repo rebuild needs", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A, REPO_B], { "/a/.git": listing([]), "/b/.git": listing([]) }));

    expect(cache.roots().map((r) => r.repoId)).toEqual(["/a/.git", "/b/.git"]);
    expect(cache.rootFor("/b/.git")).toEqual(REPO_B);
    expect(cache.normalizedFolders()).toEqual(["/a", "/b"]);
  });

  it("hands out a fresh tree object per read so a consumer cannot mutate the cache", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));

    const first = cache.read();
    first.repos.pop();

    expect(cache.read().repos).toHaveLength(1);
  });

  it("isolates the repo objects and worktree arrays, not only the outer list", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" }), worktree("/a/wt")]) }));

    const first = cache.read();
    first.repos[0].worktrees.pop();
    first.repos[0].label = "clobbered";

    const second = cache.read();
    expect(second.repos[0].worktrees).toHaveLength(2);
    expect(second.repos[0].label).toBe("/a");
  });
});

// Audit A1 / spec: never present a stale listing as current. A folder that is
// still open but could not be resolved is a failure, not a deletion.
describe("WorktreeCache — a repository that could not be resolved", () => {
  const failed = (folder: string, reason: string): FolderResolution[] => [
    { folder, outcome: { kind: "failed", reason } },
  ];

  it("retains its worktrees, marked degraded, when its folder is still open", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A], {
        "/a/.git": listing([worktree("/a", { kind: "main" }), worktree("/a/wt-1"), worktree("/a/wt-2")]),
      }),
    );

    cache.applyBuild(build([], {}, failed("/a", "`git rev-parse --show-toplevel` timed out.")));

    const tree = cache.read();
    expect(tree.repos).toHaveLength(1);
    expect(tree.repos[0].worktrees).toHaveLength(3);
    expect(tree.repos[0].degraded).toContain("timed out");
  });

  it("drops it when the workspace folder itself is gone", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));

    cache.applyBuild(build([], {}, []));

    expect(cache.read().repos).toHaveLength(0);
  });

  it("drops it when the folder is genuinely not a repository", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));

    cache.applyBuild(build([], {}, [{ folder: "/a", outcome: { kind: "absent" } }]));

    expect(cache.read().repos).toHaveLength(0);
  });

  it("keeps folder order when a middle folder fails to resolve", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a", { kind: "main" })]),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      }),
    );

    cache.applyBuild(
      build([REPO_B], { "/b/.git": listing([worktree("/b", { kind: "main" })]) }, [
        { folder: "/a", outcome: { kind: "failed", reason: "boom" } },
        { folder: "/b", outcome: { kind: "resolved", repo: REPO_B } },
      ]),
    );

    expect(cache.read().repos.map((r) => r.repoId)).toEqual(["/a/.git", "/b/.git"]);
  });
});

// Review round 1, B1. Two workspace folders can name one repository — a repo and
// a folder inside it. The folder that fails still has to carry the memory, or
// the day its sibling closes the group goes with it.
describe("WorktreeCache — two folders sharing one repository", () => {
  const both = (a: FolderResolution["outcome"], b: FolderResolution["outcome"]): FolderResolution[] => [
    { folder: "/a", outcome: a },
    { folder: "/a/sub", outcome: b },
  ];
  const resolved = { kind: "resolved" as const, repo: REPO_A };
  const shared = { "/a/.git": listing([worktree("/a", { kind: "main" }), worktree("/a/wt")]) };

  it("retains the group once the sibling that still resolved is closed", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], shared, both(resolved, resolved)));

    // /a/sub stops resolving while /a still does. The fresh listing wins, but
    // dropping /a/sub's mapping here is what loses the group below.
    cache.applyBuild(build([REPO_A], shared, both(resolved, { kind: "failed", reason: "boom" })));
    // Now /a is closed and only the still-failing /a/sub is open.
    cache.applyBuild(build([], {}, [{ folder: "/a/sub", outcome: { kind: "failed", reason: "boom" } }]));

    const tree = cache.read();
    expect(tree.repos).toHaveLength(1);
    expect(tree.repos[0].worktrees).toHaveLength(2);
    expect(tree.repos[0].degraded).toBe("boom");
  });

  it("does not let the failed folder's degraded listing displace its sibling's fresh one", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], shared, both(resolved, resolved)));

    cache.applyBuild(build([REPO_A], shared, both(resolved, { kind: "failed", reason: "boom" })));

    expect(cache.read().repos[0].degraded).toBeUndefined();
  });

  it("pairs a fresh duplicate-repository generation and follow-up with its current registration", () => {
    const cache = createWorktreeCache();
    const registeredA = root("/a/.git", 11);
    const registeredB = root("/a/.git", 12);
    const listingB = listing([worktree("/a", { kind: "main" }), worktree("/a/wt")]);
    cache.applyBuild(
      build(
        [registeredA],
        { "/a/.git": listingB },
        both({ kind: "resolved", repo: registeredA }, { kind: "resolved", repo: registeredA }),
      ),
    );
    const generationA = cache.readRepo("/a/.git")?.generation as number;

    cache.applyBuild(
      build([registeredB], { "/a/.git": listingB }, [
        { folder: "/a", outcome: { kind: "failed", reason: "boom" } },
        { folder: "/a/sub", outcome: { kind: "resolved", repo: registeredB } },
      ]),
    );

    const generationB = cache.readRepo("/a/.git")?.generation as number;
    expect(cache.registrationFor("/a/.git", generationA)).toBeUndefined();
    expect(cache.registrationFor("/a/.git", generationB)).toEqual(registeredB.registration);
    expect(cache.rootFor("/a/.git")).toEqual(registeredB);

    cache.applyRepo("/a/.git", listingB);
    const followUpGeneration = cache.readRepo("/a/.git")?.generation as number;
    expect(cache.registrationFor("/a/.git", generationB)).toBeUndefined();
    expect(cache.registrationFor("/a/.git", followUpGeneration)).toEqual(registeredB.registration);
    expect(cache.rootFor("/a/.git")).toEqual(registeredB);

    cache.applyBuild(build([], {}, [{ folder: "/a", outcome: { kind: "failed", reason: "still unavailable" } }]));
    const retained = cache.readRepo("/a/.git");
    expect(retained?.worktrees).toHaveLength(2);
    expect(retained?.degraded).toBe("still unavailable");
    expect(retained?.generation).toBeUndefined();
    expect(cache.registrationFor("/a/.git", followUpGeneration)).toBeUndefined();
    expect(cache.rootFor("/a/.git")).toEqual(registeredB);
  });

  it("retains every failed duplicate mapping when no sibling currently resolves", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], shared, both(resolved, resolved)));

    cache.applyBuild(build([], {}, both({ kind: "failed", reason: "boom" }, { kind: "failed", reason: "boom" })));
    cache.applyBuild(build([], {}, [{ folder: "/a/sub", outcome: { kind: "failed", reason: "still failing" } }]));

    const retained = cache.readRepo("/a/.git");
    expect(retained?.worktrees).toHaveLength(2);
    expect(retained?.degraded).toBe("still failing");
    expect(retained?.generation).toBeUndefined();
  });
});

// Review round 1, W2. design.md D3 says `read()` returns the retained
// repositories each marked degraded — so the mark cannot depend on which write
// last touched the group.
describe("WorktreeCache — degraded cause while git is unavailable", () => {
  function gitGone(reason: string, folders: string[]): WorktreeTreeBuild {
    return {
      tree: { repos: [], unreadable: { count: 1, reasons: [reason] }, gitAvailable: false },
      roots: [],
      listings: new Map(),
      normalizedFolders: [],
      gitUnavailableReason: reason,
      folderOutcomes: folders.map((folder) => ({ folder, outcome: { kind: "failed" as const, reason } })),
    };
  }

  it("keeps the group degraded after a repo-local rebuild succeeds", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    cache.applyBuild(gitGone("git 2.20 is below 2.31", ["/a"]));

    // Retention keeps the root, so the watches survive and a per-repo rebuild
    // can still land. It must not leave the group looking fresh while the tree
    // still reports git unavailable.
    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" }), worktree("/a/wt")]));

    const tree = cache.read();
    expect(tree.gitAvailable).toBe(false);
    expect(tree.repos[0].degraded).toContain("2.31");
  });

  it("publishes no registration for any repository while git is unusable", () => {
    const cache = createWorktreeCache();
    const registered = root("/a/.git", 11);
    cache.applyBuild(build([registered], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    const publishedGeneration = cache.read().repos[0].generation as number;

    cache.applyBuild(gitGone("git 2.20 is below 2.31", ["/a"]));
    expect(cache.read().repos[0].generation).toBeUndefined();

    // And a per-repo rebuild that lands while git is still unusable mints no
    // public OR private authority — the next sequence value is predictable to a
    // client that saw the prior publication.
    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" }), worktree("/a/wt")]));
    expect(cache.read().repos[0].generation).toBeUndefined();
    expect(cache.registrationFor("/a/.git", publishedGeneration + 1)).toBeUndefined();
  });

  it("publishes one again once git answers", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    cache.applyBuild(gitGone("git 2.20 is below 2.31", ["/a"]));
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));

    expect(cache.read().repos[0].generation).not.toBeUndefined();
  });

  it("leaves a more specific degraded cause in place", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    cache.applyBuild(gitGone("git 2.20 is below 2.31", ["/a"]));

    cache.applyRepo("/a/.git", listing([], { degraded: "This repository is not being watched." }));

    expect(cache.read().repos[0].degraded).toBe("This repository is not being watched.");
  });
});

describe("WorktreeCache — re-ranking without re-reading git", () => {
  it("re-sorts stored groups from a rank the cache did not have when it stored them", () => {
    // Order is baked in at assemble time. Presence-only work — a pane change, an
    // external scan — moves the rank but never re-reads git, so without this the
    // worktree that just gained an agent would not move until some unrelated
    // rebuild happened to re-assemble the group.
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A], {
        "/a/.git": listing([
          worktree("/a", { kind: "main" }),
          worktree("/a/one", { branch: "one" }),
          worktree("/a/two", { branch: "two" }),
        ]),
      }),
    );
    expect(cache.read().repos[0]?.worktrees.map((w) => w.id)).toEqual(["/a", "/a/one", "/a/two"]);

    cache.reorder((id) => (id === "/a/two" ? 500 : undefined));

    expect(cache.read().repos[0]?.worktrees.map((w) => w.id)).toEqual(["/a", "/a/two", "/a/one"]);
  });

  it("re-sorts every stored repository, not only the first", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a/one", { branch: "one" }), worktree("/a/two", { branch: "two" })]),
        "/b/.git": listing([worktree("/b/one", { branch: "one" }), worktree("/b/two", { branch: "two" })]),
      }),
    );

    cache.reorder((id) => (id.endsWith("/two") ? 7 : undefined));

    expect(cache.read().repos.map((r) => r.worktrees[0]?.id)).toEqual(["/a/two", "/b/two"]);
  });

  it("drops a worktree out of the active bucket when its rank goes away", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A], {
        "/a/.git": listing([worktree("/a/one", { branch: "one" }), worktree("/a/two", { branch: "two" })]),
      }),
    );
    cache.reorder((id) => (id === "/a/two" ? 5 : undefined));
    expect(cache.read().repos[0]?.worktrees.map((w) => w.id)).toEqual(["/a/two", "/a/one"]);

    cache.reorder(() => undefined);

    expect(cache.read().repos[0]?.worktrees.map((w) => w.id)).toEqual(["/a/one", "/a/two"]);
  });
});

describe("registration generation", () => {
  // The launch guard's whole point: the token says "I can no longer prove
  // these are the registrations I last reported", so it must move on every
  // authoritative apply and never be derived from what git reported.
  const genOf = (cache: ReturnType<typeof createWorktreeCache>, repoId: string): number | undefined =>
    cache.read().repos.find((r) => r.repoId === repoId)?.generation;

  it("stamps every repository with a generation", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a", { kind: "main" })]),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      }),
    );
    expect(genOf(cache, "/a/.git")).toEqual(expect.any(Number));
    expect(genOf(cache, "/b/.git")).toEqual(expect.any(Number));
    // Distinct repositories never share a token, so one cannot be mistaken
    // for the other by a request that quotes only the number.
    expect(genOf(cache, "/a/.git")).not.toBe(genOf(cache, "/b/.git"));
  });

  it("advances the touched repository and leaves its sibling alone", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a", { kind: "main" })]),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      }),
    );
    const beforeA = genOf(cache, "/a/.git");
    const beforeB = genOf(cache, "/b/.git");
    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" })]));
    expect(genOf(cache, "/a/.git")).not.toBe(beforeA);
    // A launch into /b must not be refused because /a rebuilt.
    expect(genOf(cache, "/b/.git")).toBe(beforeB);
  });

  it("advances even when the listing came back identical", () => {
    // An identical listing is not proof of continuity — a worktree removed
    // and recreated at the same path, branch and commit lists the same
    // (round-4 B6). The cache advances because it cannot tell.
    const cache = createWorktreeCache();
    const same = (): RepoListing => listing([worktree("/a", { kind: "main", head: "abc", branch: "main" })]);
    cache.applyBuild(build([REPO_A], { "/a/.git": same() }));
    const before = genOf(cache, "/a/.git");
    cache.applyRepo("/a/.git", same());
    expect(genOf(cache, "/a/.git")).not.toBe(before);
  });

  it("publishes NO generation for a repository whose listing was retained, not observed", () => {
    // Both halves at once: an intent quoting the old number stops matching, and
    // a new one has nothing to quote. Advancing instead would do only the first
    // and mint authority over registrations nobody looked at (round-5 B7).
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    expect(genOf(cache, "/a/.git")).toEqual(expect.any(Number));
    cache.applyRepo("/a/.git", listing([], { degraded: "`git worktree list` timed out." }));
    // The listing is still shown — dropping to zero would read as a deletion.
    expect(cache.read().repos[0]?.worktrees).toHaveLength(1);
    expect(genOf(cache, "/a/.git")).toBeUndefined();
    // And a listing that succeeds again publishes a fresh one.
    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" })]));
    expect(genOf(cache, "/a/.git")).toEqual(expect.any(Number));
  });

  it("keeps the generation when a repository is only annotated", () => {
    // "Not being watched" is true ABOUT a repository, not a report of what it
    // contains: its worktrees were observed by the rebuild that just ran, and
    // withdrawing their token would refuse every launch on a host without file
    // watching — which is what the assembly harness is.
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    const before = genOf(cache, "/a/.git");
    cache.markUnwatched("/a/.git", "not watched");
    expect(cache.read().repos[0]?.degraded).toBe("not watched");
    expect(genOf(cache, "/a/.git")).toBe(before);
  });

  it("keeps the watch claim across a rebuild that re-listed the repository", () => {
    // The rebuild says what the repository CONTAINS. Whether a watcher is
    // established is a different question, and letting a listing clear it left
    // the panel silently claiming freshness it did not have (round-7 W8).
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    cache.markUnwatched("/a/.git", "not watched");
    cache.applyRepo("/a/.git", listing([worktree("/a", { kind: "main" })]));
    expect(cache.read().repos[0]?.degraded).toBe("not watched");
    // And it clears when the watcher comes back, rather than outliving it.
    cache.markUnwatched("/a/.git", undefined);
    expect(cache.read().repos[0]?.degraded).toBeUndefined();
  });

  it("does not let either degradation claim hide the other", () => {
    // A current listing failure described only as a future watcher limitation
    // is the wrong story told to the user, and the more urgent half is the one
    // that was being lost.
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    cache.markUnwatched("/a/.git", "not watched");
    cache.applyRepo("/a/.git", listing([], { degraded: "`git worktree list` timed out." }));
    const shown = cache.read().repos[0]?.degraded ?? "";
    expect(shown).toContain("timed out");
    expect(shown).toContain("not watched");
    // And the listing failure still withdraws authority, watcher or no watcher.
    expect(genOf(cache, "/a/.git")).toBeUndefined();
  });

  it("advances every repository a whole-tree build re-listed", () => {
    const cache = createWorktreeCache();
    const both = (): WorktreeTreeBuild =>
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a", { kind: "main" })]),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      });
    cache.applyBuild(both());
    const beforeA = genOf(cache, "/a/.git");
    const beforeB = genOf(cache, "/b/.git");
    cache.applyBuild(both());
    expect(genOf(cache, "/a/.git")).not.toBe(beforeA);
    expect(genOf(cache, "/b/.git")).not.toBe(beforeB);
  });

  it("does not move a generation on a reorder or a read", () => {
    // Neither re-reads git, so neither is an observation that could have
    // missed a replacement. Advancing there would refuse launches for free.
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    const before = genOf(cache, "/a/.git");
    cache.reorder();
    expect(genOf(cache, "/a/.git")).toBe(before);
    expect(genOf(cache, "/a/.git")).toBe(before);
  });
});

describe("WorktreeCache — one repository, without snapshotting the workspace", () => {
  // `read()` copies every group and every worktree list per call, so a caller
  // that wants one repository pays for all of them — and a caller that runs
  // once per repository pays that R times over (offer-every-ref round-1 B3).

  it("answers the same group `read()` would, for the id asked", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(
      build([REPO_A, REPO_B], {
        "/a/.git": listing([worktree("/a", { kind: "main" }), worktree("/a-wt")]),
        "/b/.git": listing([worktree("/b", { kind: "main" })]),
      }),
    );

    expect(cache.readRepo("/b/.git")).toEqual(cache.read().repos.find((r) => r.repoId === "/b/.git"));
  });

  it("carries a repo's own degraded reason, not the tree's roll-up", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));
    cache.applyRepo("/a/.git", listing([], { degraded: "`git worktree list` timed out." }));

    expect(cache.readRepo("/a/.git")?.degraded).toBe("`git worktree list` timed out.");
  });

  it("hands out a copy, so a caller cannot edit the cache through it", () => {
    // The same discipline `read()` applies. A caller that mutated what it was
    // handed would edit the listing every other consumer reads.
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" }), worktree("/a-wt")]) }));

    cache.readRepo("/a/.git")?.worktrees.pop();

    expect(cache.readRepo("/a/.git")?.worktrees).toHaveLength(2);
    expect(cache.read().repos[0].worktrees).toHaveLength(2);
  });

  it("answers nothing for a repository it does not hold", () => {
    const cache = createWorktreeCache();
    cache.applyBuild(build([REPO_A], { "/a/.git": listing([worktree("/a", { kind: "main" })]) }));

    expect(cache.readRepo("/nowhere/.git")).toBeUndefined();
  });
});
