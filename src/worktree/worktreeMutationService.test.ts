// The assembly round-1 B1 found missing, and the ordering round-1 B2 found
// wrong. The unit tests around each component prove the component; only this
// one proves that a message reaching the service turns into a git command
// against the target the id names AFTER the rebuild.

import { describe, expect, it, vi } from "vitest";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import type { ReattachVerdict } from "./reattachProbe";
import type { RemovalEvidence } from "./worktreeBlockers";
import {
  createWorktreeMutationService,
  existenceFromStatError,
  type MutationServiceDeps,
  type ResolvedTarget,
} from "./worktreeMutationService";

const REPO = "/repo/.git";
/** Git reports this one with a trailing slash, so id and path differ. */
const RAW_ID = "/repo-wt/raw";
const RAW_PATH = "/repo-wt/raw/";

function ok(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function evidence(over: Partial<RemovalEvidence> = {}): RemovalEvidence {
  return {
    dirtyPaths: [],
    untrackedPaths: [],
    paneIds: [],
    externalSessionIds: [],
    notApplicable: [],
    ignored: { kind: "measured", entries: 0, bytes: 0 },
    proofs: { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven" },
    locked: false,
    lockReason: null,
    ...over,
  };
}

function target(over: Partial<ResolvedTarget> = {}): ResolvedTarget {
  return {
    repoPath: "/repo",
    worktreePath: RAW_PATH,
    incarnation: "adm-1",
    locked: false,
    wasRegistered: true,
    existedOnDisk: true,
    ...over,
  };
}

function harness(over: Partial<MutationServiceDeps> = {}) {
  const order: string[] = [];
  const argv: string[][] = [];
  const runner: GitCommandRunner = {
    run: vi.fn(async (args: readonly string[]) => {
      order.push(`git:${args[1]}`);
      argv.push([...args]);
      return ok();
    }),
  };
  const outcomes: unknown[] = [];
  const deps: MutationServiceDeps = {
    runner,
    forceRebuild: async () => {
      order.push("rebuild");
    },
    resolve: () => {
      order.push("resolve");
      return target();
    },
    repoPath: () => "/repo",
    assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence(), fingerprint: "" }),
    // A tree that holds still, unless a test says otherwise.
    observation: () => 1,
    observeAfter: async () => ({ isRegistered: false, existsOnDisk: false }),
    createContext: () => ({ mainWorktree: "/repo", linkedWorktrees: [] }),
    // A repository whose stale registration still corroborates, unless a test
    // moves one of these. Both are what D3 re-establishes at the mutation.
    corroborateRepair: async ({ repairPath }) => ({ kind: "offer", repairPath, expectedOid: "oid-1" }),
    listWorktrees: async () => [{ displayPath: "/repo-wt/stale", branch: "feat", prunable: true }],
    pathDeps: {
      platform: "darwin",
      lstat: async () => null,
      readdir: async () => null,
      normalize: async (raw) => raw,
    },
    report: (outcome) => outcomes.push(outcome),
    afterCreate: async () => {},
    gitExcludeDirFor: () => null,
    addToGitExclude: async () => {},
    now: () => 0,
    ...over,
  };
  // `deps.runner`, not the local one: an override in `over` replaces it, and
  // returning the shadowed original made every assertion on a test's own runner
  // read an object nothing had called.
  return { service: createWorktreeMutationService(deps), order, argv, outcomes, runner: deps.runner };
}

describe("a mutation reaches git through the coordinator", () => {
  it("resolves the id AFTER the forced rebuild, not when the message arrived", async () => {
    // The whole point of B2: a path resolved on arrival names whatever held it
    // then. The rebuild must precede the resolve, and git must follow both.
    const h = harness();
    await h.service.lockWorktree({ repoId: REPO, worktreeId: RAW_ID }, "release build");

    expect(h.order.slice(0, 3)).toEqual(["rebuild", "resolve", "git:lock"]);
  });

  it("runs against the path the id resolves to, not against the id", async () => {
    // RAW's id and displayPath differ by a trailing slash. This is where the
    // pair the host used to prove is now proved.
    const h = harness();
    await h.service.lockWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

    expect(h.argv[0]).toEqual(["worktree", "lock", RAW_PATH]);
  });

  it("rebuilds again after the attempt, so the panel is not left on stale state", async () => {
    const h = harness();
    await h.service.lockWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

    expect(h.order.filter((s) => s === "rebuild")).toHaveLength(2);
    expect(h.order.at(-1)).toBe("rebuild");
  });

  it("runs no command at all when the id no longer names anything", async () => {
    // A destructive verb against a registration that vanished while it queued
    // is exactly the case B2 describes, and doing nothing is the only safe
    // answer — reported, never silently dropped.
    const h = harness({ resolve: () => null });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0]).toMatchObject({ kind: "error", verb: "remove" });
  });

  it("refuses a force whose confirmation was never issued", async () => {
    const h = harness();
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, true, "never-issued");

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({
      kind: "error",
      message: expect.stringContaining("changed since you confirmed"),
    });
  });

  it("refuses a force carrying no confirmation at all", async () => {
    // The host refuses this pairing too, but the service is what spawns git and
    // must not depend on a caller having checked. Found by mutation: flipping
    // the no-fingerprint branch to "proceed" passed every other case here.
    const h = harness();
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, true, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "error", verb: "remove" });
  });

  it("refuses a force whose current evidence could not be read", async () => {
    // Unreadable evidence is not "nothing at risk" — there is no set to
    // compare the confirmation against, so it authorizes nothing.
    const h = harness({ assessRemoval: async () => null });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());
    await h.service.removeWorktree(t, true, fp ?? "");

    expect(h.runner.run).not.toHaveBeenCalled();
  });

  it("accepts a force carrying the confirmation it issued, once", async () => {
    const h = harness();
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence({ dirtyPaths: ["a.ts"] }));
    expect(fp).not.toBeNull();

    await h.service.removeWorktree(t, true, fp ?? "");
    expect(h.argv[0]).toEqual(["worktree", "remove", "--force", RAW_PATH]);

    // Spent: the same token a second time is refused rather than replayed.
    await h.service.removeWorktree(t, true, fp ?? "");
    expect(h.argv).toHaveLength(1);
  });

  it("abandons a prune whose count moved since the confirmation named it", async () => {
    // The user authorized a NUMBER. Two stale registrations becoming three is
    // not what they agreed to drop.
    const h = harness({
      runner: {
        run: vi.fn(async (args: readonly string[]) =>
          args.includes("--dry-run") ? ok({ stderr: "Removing worktrees/a\nRemoving worktrees/b\n" }) : ok(),
        ),
      },
    });
    await h.service.pruneRepo(REPO, 1);

    expect(h.outcomes[0]).toMatchObject({ kind: "error", verb: "prune" });
  });

  it("serializes two mutations on one repository", async () => {
    const h = harness();
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await Promise.all([h.service.lockWorktree(t, undefined), h.service.unlockWorktree(t)]);

    // Interleaving would put a second rebuild between one mutation's git call
    // and its trailing rebuild.
    expect(h.order).toEqual([
      "rebuild",
      "resolve",
      "git:lock",
      "rebuild",
      "rebuild",
      "resolve",
      "git:unlock",
      "rebuild",
    ]);
  });

  it("validates the create path on BOTH sides of the queue wait", async () => {
    // D6 wants two observations with the wait between them. One observation on
    // the far side cannot detect a change, because it never saw the earlier
    // state to compare against (round-2 B4).
    const seen: string[] = [];
    const h = harness({
      forceRebuild: async () => {
        seen.push("rebuild");
      },
      pathDeps: {
        platform: "darwin",
        lstat: async () => {
          seen.push("lstat");
          return null;
        },
        readdir: async () => null,
        normalize: async (raw) => raw,
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo/wt/new",
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
    });

    // At least one filesystem observation before the first rebuild, and more
    // after it.
    expect(seen.indexOf("lstat")).toBeLessThan(seen.indexOf("rebuild"));
    expect(seen.lastIndexOf("lstat")).toBeGreaterThan(seen.indexOf("rebuild"));
  });

  it("refuses when the validated directory is swapped during the wait", async () => {
    // Same path, still an empty directory, different inode. Emptiness alone
    // cannot see this, which is why the identity is carried across the wait.
    let ino = 1;
    const h = harness({
      pathDeps: {
        platform: "darwin",
        lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true, dev: 1, ino: ino++ }),
        readdir: async () => [],
        normalize: async (raw) => raw,
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo/wt/new",
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
    });

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({
      kind: "error",
      message: expect.stringContaining("changed while the action was queued"),
    });
  });

  it("refuses when the validated directory stopped being empty during the wait", async () => {
    // `mustBeEmpty` was recorded and never asked again. A directory that gained
    // files while queued is one git will refuse anyway — but it must be refused
    // with the reason that is true, not with git's.
    let calls = 0;
    const h = harness({
      pathDeps: {
        platform: "darwin",
        lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true, dev: 1, ino: 7 }),
        readdir: async () => {
          calls += 1;
          return calls > 2 ? ["surprise.txt"] : [];
        },
        normalize: async (raw) => raw,
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo/wt/new",
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
    });

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "error", message: expect.stringContaining("no longer empty") });
  });

  it("still creates when nothing moved across the wait", async () => {
    // The negatives above only mean something if the ordinary case survives.
    const h = harness({
      pathDeps: {
        platform: "darwin",
        lstat: async () => null,
        readdir: async () => null,
        normalize: async (raw) => raw,
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo/wt/new",
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
    });

    // Found rather than indexed: a `fresh` mode is name-checked first (W9), so
    // the create is not the first git call and asserting on position would tie
    // this case to that ordering.
    expect(h.argv.find((a) => a[0] === "worktree" && a[1] === "add")).toBeDefined();
  });

  it("creates a NEW branch when the user asked for one and named no base ref", async () => {
    // The wire used to carry `branch` for both the new-branch and the
    // existing-branch mode, so the service guessed from whether `baseRef`
    // happened to be present and picked `existingBranch` when it was not. That
    // asks git to check out a branch nobody has made yet, and git answers
    // `fatal: invalid reference` — the ordinary create, broken.
    const h = harness({
      pathDeps: {
        platform: "darwin",
        lstat: async () => null,
        readdir: async () => null,
        normalize: async (raw) => raw,
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo/wt/new",
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
    });

    expect(h.argv.find((a) => a[0] === "worktree" && a[1] === "add")).toContain("-b");
  });

  it("returns the blockers of an UNFORCED removal instead of running git", async () => {
    // The hole round-2 B1 found: assessment was gated behind `force`, so an
    // unforced removal evaluated nothing and went straight to git. Git refuses
    // a dirty worktree itself — an idle pane it knows nothing about.
    const h = harness({
      assessRemoval: async () => ({
        kind: "confirmable" as const,
        evidence: evidence({ paneIds: ["pane-1"] }),
      }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "blocked", verb: "remove" });
  });

  it("carries the token that authorizes exactly the blockers it just returned", async () => {
    // And that token must actually work — issuing one nothing can redeem is
    // the same dead end as issuing none.
    const h = harness({
      assessRemoval: async () => ({
        kind: "confirmable" as const,
        evidence: evidence({ dirtyPaths: ["a.ts"] }),
      }),
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, false, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };
    expect(blocked.fingerprint).not.toBeNull();

    await h.service.removeWorktree(t, true, blocked.fingerprint ?? "");
    expect(h.argv[0]).toEqual(["worktree", "remove", "--force", RAW_PATH]);
  });

  it("runs an unforced removal when nothing is at risk", async () => {
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }) });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.argv[0]).toEqual(["worktree", "remove", RAW_PATH]);
  });

  it("offers no token at all when the assessment refuses", async () => {
    // A refusal that carried a fingerprint would make a force against it
    // representable, which is the thing the three-type split exists to prevent.
    const h = harness({
      assessRemoval: async () => ({
        kind: "refused" as const,
        isMain: true,
        busyAgents: 0,
        containsWorktrees: [],
        liveExternalSessionIds: [],
      }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "blocked", fingerprint: null });
  });

  it("reports unreadable evidence as its own outcome, and runs nothing", async () => {
    const h = harness({ assessRemoval: async () => ({ kind: "unavailable" as const, unreadable: ["status"] }) });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "unavailable", unreadable: ["status"] });
  });

  it("runs nothing when the tree moves between the assessment and the command", async () => {
    // Round-10 B8: `assessRemoval` validates its own observation, but this
    // coordinator resumes from an `await`, and a rebuild continuation already
    // queued behind that one lands first. The evidence then describes a tree
    // the command would no longer be issued against — at the same path, that is
    // how a replacement gets removed on a predecessor's evidence.
    //
    // The movement happens from INSIDE the assessment, after it resolves and
    // before the coordinator resumes — the position a queued rebuild
    // continuation really occupies. An implementation that compared before the
    // await would see no movement here, issue the command, and fail (W10).
    let observation = 1;
    const h = harness({
      observation: () => observation,
      assessRemoval: async () => {
        queueMicrotask(() => {
          observation = 2;
        });
        return { kind: "confirmable" as const, evidence: evidence() };
      },
    });

    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "unavailable", unreadable: ["listing"] });
  });

  it("still runs when the tree holds still across both", async () => {
    // The negative that keeps the check above from being a blanket refusal.
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }) });

    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).toHaveBeenCalled();
  });

  it("spends the token even on an exit that never reached git", async () => {
    // The half round-2 B5 found: an unreadable assessment returned `reprompt`
    // without redeeming, so the token stayed live and the same message could be
    // replayed against a removal that may already have run half-way.
    const clean = { kind: "confirmable" as const, evidence: evidence({ dirtyPaths: ["a.ts"] }) };
    let readable = true;
    const h = harness({
      assessRemoval: async () => (readable ? clean : { kind: "unavailable" as const, unreadable: ["status"] }),
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence({ dirtyPaths: ["a.ts"] }));

    readable = false;
    await h.service.removeWorktree(t, true, fp ?? "");
    expect(h.runner.run).not.toHaveBeenCalled();

    // The read recovers — and the token is still gone.
    readable = true;
    await h.service.removeWorktree(t, true, fp ?? "");
    expect(h.runner.run).not.toHaveBeenCalled();
  });

  it("forgets a confirmation once the worktree is observed to be gone", async () => {
    // Isolated from the spend-on-use rule on purpose: the first removal here is
    // UNFORCED, so it consumes no token, and the token stays live through it.
    // The only thing that can invalidate it afterwards is the disappearance
    // (D15). Found by mutation — an earlier version of this test spent the
    // token itself and passed with `forget` deleted.
    let present = true;
    const argv: string[][] = [];
    const h = harness({
      runner: {
        run: vi.fn(async (args: readonly string[]) => {
          argv.push([...args]);
          if (args[1] === "remove") {
            present = false;
          }
          return ok();
        }),
      },
      resolve: () => (present ? target() : null),
      // Clean now, so the unforced removal proceeds; the token was issued
      // against a dirtier set, which a subset check would otherwise accept.
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
      observeAfter: async () => ({ isRegistered: false, existsOnDisk: false }),
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence({ dirtyPaths: ["a.ts"] }));
    expect(fp).not.toBeNull();

    await h.service.removeWorktree(t, false, undefined);
    expect(argv).toHaveLength(1);

    // The path comes back. The old confirmation must authorize nothing here.
    present = true;
    await h.service.removeWorktree(t, true, fp ?? "");
    expect(argv.filter((a) => a.includes("--force"))).toHaveLength(0);
  });

  it("reports indeterminate when the removal left the directory behind", async () => {
    const h = harness({
      observeAfter: async () => ({ isRegistered: false, existsOnDisk: true }),
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.outcomes[0]).toMatchObject({ kind: "indeterminate" });
  });

  it("reports indeterminate when the post-attempt listing could not be trusted", async () => {
    const h = harness({
      observeAfter: async () => null,
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.outcomes[0]).toMatchObject({ kind: "indeterminate" });
  });

  it("passes the journalled path to the observation", async () => {
    const seen: string[] = [];
    const h = harness({
      observeAfter: async (_t, journalled) => {
        seen.push(journalled);
        return { isRegistered: false, existsOnDisk: false };
      },
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    // git's own string, recorded before the spawn — not the normalized id.
    expect(seen).toEqual([RAW_PATH]);
  });
});

describe("a confirmation dies on every route the disappearance can take", () => {
  it("spends the token when the target is already gone before the body runs", async () => {
    // Round-3 B5. The coordinator threw straight past the body on this path, so
    // neither the spend nor the forget ran — and the confirmation stayed live
    // for whatever was created at the same location next.
    let present = true;
    const argv: string[][] = [];
    const h = harness({
      runner: {
        run: vi.fn(async (args: readonly string[]) => {
          argv.push([...args]);
          return ok();
        }),
      },
      resolve: () => (present ? target() : null),
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence({ dirtyPaths: ["a.ts"] }));
    expect(fp).not.toBeNull();

    // It vanished — by another window, by hand, by anything.
    present = false;
    await h.service.removeWorktree(t, false, undefined);
    expect(argv).toHaveLength(0);

    // Recreated at the same location. The old confirmation authorizes nothing.
    present = true;
    await h.service.removeWorktree(t, true, fp ?? "");
    expect(argv.filter((a) => a.includes("--force"))).toHaveLength(0);
  });

  it("says the worktree is already gone rather than reporting an internal throw", async () => {
    const h = harness({ resolve: () => null });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.outcomes[0]).toMatchObject({ kind: "error", verb: "remove", message: "That worktree is already gone." });
  });

  it("drops the confirmation of any worktree a rebuild no longer finds", async () => {
    // The watcher-driven path: nobody asked for a removal, the tree simply came
    // back without it. Until this existed, only the removal path forgot.
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }) });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence({ dirtyPaths: ["a.ts"] }));
    expect(fp).not.toBeNull();

    h.service.reconcileFingerprints(["/some/other/worktree"]);
    await h.service.removeWorktree(t, true, fp ?? "");

    expect(h.argv.filter((a) => a.includes("--force"))).toHaveLength(0);
  });

  it("keeps the confirmation of a worktree the rebuild still holds", async () => {
    // The negative that gives the reconcile its meaning: it must drop what is
    // absent, not everything it has.
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }) });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());
    expect(fp).not.toBeNull();

    h.service.reconcileFingerprints([RAW_ID]);
    await h.service.removeWorktree(t, true, fp ?? "");

    expect(h.argv.filter((a) => a.includes("--force"))).toHaveLength(1);
  });

  it("forces exactly one rebuild after the attempt, not one per layer", async () => {
    // Round-3 W5: the coordinator owned a post-attempt rebuild and the removal
    // body ran another one to classify against.
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }) });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.order.filter((s) => s === "rebuild")).toHaveLength(2);
  });
});

describe("what the create writes into info/exclude", () => {
  it("hands the exclude an anchored repo-relative pattern, never the absolute path", async () => {
    // Round-3 B10: an absolute path is not a valid exclude pattern, so D8 had
    // never taken effect — and it failed silently, because a pattern matching
    // nothing looks exactly like a pattern that was not needed.
    const written: Array<[string, string]> = [];
    const h = harness({
      repoPath: () => "/repo",
      gitExcludeDirFor: (repoPath, createdPath) => ({
        gitDir: `${repoPath}/.git`,
        relativePath: createdPath.slice(repoPath.length + 1),
      }),
      addToGitExclude: async (gitDir, entry) => {
        written.push([gitDir, entry]);
      },
      pathDeps: {
        platform: "darwin",
        lstat: async () => null,
        readdir: async () => null,
        normalize: async (raw: string) => raw,
      },
    });

    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo/wt/feat",
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
      afterCreate: { kind: "none" },
    });

    expect(written).toEqual([["/repo/.git", "/wt/feat/"]]);
  });

  it("excludes the create ROOT once, not one leaf per worktree", async () => {
    // Production derives the root from the created path; two creates under the
    // same root are one entry, which is what keeps info/exclude bounded.
    const written: [string, string][] = [];
    const h = harness({
      gitExcludeDirFor: (repoPath, createdPath) => {
        const root = createdPath.slice(0, createdPath.lastIndexOf("/"));
        return { gitDir: `${repoPath}/.git`, relativePath: root.slice(repoPath.length + 1) };
      },
      addToGitExclude: async (gitDir, entry) => {
        written.push([gitDir, entry]);
      },
      pathDeps: {
        platform: "darwin",
        lstat: async () => null,
        readdir: async () => null,
        normalize: async (raw: string) => raw,
      },
    });

    for (const branch of ["feat", "fix"]) {
      await h.service.createWorktree({
        repoId: REPO,
        path: `/repo/wt/${branch}`,
        mode: { kind: "fresh", branch },
        disposition: { kind: "free" },
        afterCreate: { kind: "none" },
      });
    }
    expect(written).toEqual([
      ["/repo/.git", "/wt/"],
      ["/repo/.git", "/wt/"],
    ]);
  });
});

describe("evidence that could not be read is not evidence of safety", () => {
  it("reads only absence as absence when a stat is rejected", () => {
    expect(existenceFromStatError({ code: "ENOENT" } as NodeJS.ErrnoException)).toBe(false);
    expect(existenceFromStatError({ code: "ENOTDIR" } as NodeJS.ErrnoException)).toBe(false);
  });

  it("does not read a filesystem it could not query as an empty one", () => {
    for (const code of ["EACCES", "EPERM", "EIO", "ELOOP", "ENAMETOOLONG", undefined]) {
      expect(existenceFromStatError({ code } as NodeJS.ErrnoException)).toBeNull();
    }
  });

  it("leaves a removal indeterminate when the observation could not be made", async () => {
    const h = harness({
      resolve: () => target({ locked: false }),
      observeAfter: async () => null,
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);
    expect(h.outcomes).toEqual([expect.objectContaining({ kind: "indeterminate", verb: "remove" })]);
  });

  it("does not run a prune whose dry run could not be read", async () => {
    const h = harness({
      runner: {
        run: vi.fn(async (args: readonly string[]) =>
          args[1] === "prune" && args.includes("--dry-run")
            ? ok({ code: 128, stderr: "fatal: not a git repository" })
            : ok(),
        ),
      },
    });
    await h.service.pruneRepo(REPO, 2, undefined);
    expect(h.outcomes).toEqual([
      expect.objectContaining({ kind: "unavailable", verb: "prune", unreadable: ["prunable"] }),
    ]);
    // Nothing was changed, and that is the claim the notice makes.
    expect((h.runner.run as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).not.toContainEqual([
      "worktree",
      "prune",
    ]);
  });

  it("still prunes when the dry run genuinely counts nothing and nothing was confirmed", async () => {
    const h = harness({
      runner: {
        run: vi.fn(async () => ok({ stderr: "" })),
      },
    });
    await h.service.pruneRepo(REPO, 0, undefined);
    expect(h.outcomes).toEqual([expect.objectContaining({ kind: "ok", verb: "prune" })]);
  });

  it("refuses a confirmed count that is not a count", async () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const h = harness();
      await h.service.pruneRepo(REPO, bad, undefined);
      expect(h.outcomes).toEqual([expect.objectContaining({ kind: "error", verb: "prune" })]);
      expect(h.order).toEqual([]);
    }
  });

  it("reports a failed open-after beside the create it did not undo", async () => {
    const h = harness({
      afterCreate: async () => {
        throw new Error("no window available");
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo-wt/new",
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
      afterCreate: { kind: "newWindow" },
    });
    // ONE outcome, and it is the success: a second notice sharing this scope
    // would replace the very result it annotates (round-4 W7).
    expect(h.outcomes).toEqual([
      expect.objectContaining({ kind: "ok", verb: "create", openFailed: "no window available" }),
    ]);
  });

  it("reports a failed AGENT launch as an agent that did not start", async () => {
    // Same channel as any other open-after, different sentence: the user needs
    // to read "the worktree is there, the agent is not" off one notice.
    const h = harness({
      afterCreate: async () => {
        throw new Error("Claude Code cannot start a new session");
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo-wt/new",
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
      afterCreate: { kind: "agent", waitForSetup: false, agent: "claude" },
    });
    expect(h.outcomes).toEqual([
      expect.objectContaining({
        kind: "ok",
        verb: "create",
        openFailed: "Agent did not start: Claude Code cannot start a new session",
      }),
    ]);
  });

  it("hands the launch details and the asking surface to the after-create", async () => {
    const seen: unknown[] = [];
    const surface = { isReady: () => true, post: () => {} };
    const h = harness({
      afterCreate: async (path, after, origin) => {
        seen.push({ path, after, sameSurface: origin === surface });
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo-wt/new",
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
      afterCreate: {
        kind: "agent",
        waitForSetup: false,
        agent: "claude",
        permissionChoiceId: "plan",
        prompt: "read the failing test",
      },
      origin: surface,
    });
    expect(seen).toEqual([
      {
        path: "/repo-wt/new",
        after: {
          kind: "agent",
          waitForSetup: false,
          agent: "claude",
          permissionChoiceId: "plan",
          prompt: "read the failing test",
        },
        sameSurface: true,
      },
    ]);
  });

  // The runtime guard that used to stand here — "an agent mode with no launch
  // details, or launch details riding another mode, creates nothing" — is gone
  // because `WorktreeAfterCreate` cannot express either arrangement: the agent
  // fields are members of the `agent` variant. The refusal is now a compile
  // error, asserted in `src/types/messages.contract.test.ts` (task 1_5).

  it("says nothing extra when the open-after succeeds", async () => {
    const h = harness();
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo-wt/new",
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
      afterCreate: { kind: "newWindow" },
    });
    expect(h.outcomes).toEqual([expect.objectContaining({ kind: "ok", verb: "create" })]);
    expect(h.outcomes[0]).not.toHaveProperty("openFailed");
  });
});

describe("an invalid branch name creates nothing (round-4 W9)", () => {
  /** A runner that refuses the name check and records everything asked of it. */
  function withRefFormat(valid: boolean) {
    const argv: string[][] = [];
    const h = harness({
      runner: {
        run: vi.fn(async (args: readonly string[]) => {
          argv.push([...args]);
          return args[0] === "check-ref-format" && !valid ? ok({ code: 1, stderr: "fatal: not valid" }) : ok();
        }),
      },
    });
    return { h, argv };
  }

  it("refuses before `worktree add` runs at all", async () => {
    const { h, argv } = withRefFormat(false);
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo-wt/new",
      mode: { kind: "fresh", branch: "feat..bad", baseRef: "main" },
      disposition: { kind: "free" },
      afterCreate: { kind: "none" },
    });
    expect(h.outcomes).toEqual([
      expect.objectContaining({ kind: "error", verb: "create", message: expect.stringContaining("feat..bad") }),
    ]);
    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(false);
  });

  it("leaves a name git accepts untouched", async () => {
    const { h, argv } = withRefFormat(true);
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo-wt/new",
      mode: { kind: "fresh", branch: "feat/ok", baseRef: "main" },
      disposition: { kind: "free" },
      afterCreate: { kind: "none" },
    });
    expect(h.outcomes).toEqual([expect.objectContaining({ kind: "ok", verb: "create" })]);
    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(true);
  });

  it("still creates when git could not answer the question", async () => {
    // `null` is "we could not ask", not "invalid". Treating it as a refusal
    // would make an unavailable git block every create by name.
    const argv: string[][] = [];
    const h = harness({
      runner: {
        run: vi.fn(async (args: readonly string[]) => {
          argv.push([...args]);
          return args[0] === "check-ref-format" ? ok({ code: 1, timedOut: true }) : ok();
        }),
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo-wt/new",
      mode: { kind: "fresh", branch: "feat/ok", baseRef: "main" },
      disposition: { kind: "free" },
      afterCreate: { kind: "none" },
    });
    expect(h.outcomes).toEqual([expect.objectContaining({ kind: "ok", verb: "create" })]);
    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(true);
  });

  it("does not check a branch it is not creating", async () => {
    const { h, argv } = withRefFormat(true);
    await h.service.createWorktree({
      repoId: REPO,
      path: "/repo-wt/new",
      mode: { kind: "fresh-detached", baseRef: "HEAD" },
      disposition: { kind: "free" },
      afterCreate: { kind: "none" },
    });
    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(true);
    expect(argv.some((a) => a[0] === "check-ref-format")).toBe(false);
  });
});

describe("a thrown assessment still spends its token (round-4 S1)", () => {
  it("does not leave a forced confirmation live when the assessment throws", async () => {
    let explode = true;
    const h = harness({
      resolve: () => target(),
      assessRemoval: async () => {
        if (explode) {
          throw new Error("registry exploded");
        }
        return { kind: "confirmable" as const, evidence: evidence({ dirtyPaths: ["a.ts"] }) };
      },
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence({ dirtyPaths: ["a.ts"] }));
    expect(fp).not.toBeNull();

    await h.service.removeWorktree(t, true, fp ?? "");
    expect(h.outcomes).toEqual([expect.objectContaining({ kind: "error", verb: "remove" })]);

    // Spent. A second attempt with the same token authorizes nothing, because
    // the first may already have run git — even though the assessment now works.
    h.outcomes.length = 0;
    explode = false;
    await h.service.removeWorktree(t, true, fp ?? "");
    expect(h.outcomes).toEqual([
      expect.objectContaining({ kind: "error", message: expect.stringContaining("changed since you confirmed") }),
    ]);
  });
});

describe("a confirmation authorizes only the risks it was shown", () => {
  /** An assessment whose evidence the test can move between the two calls. */
  function moving(first: RemovalEvidence, second: RemovalEvidence) {
    let call = 0;
    return harness({
      assessRemoval: async () => {
        call += 1;
        return { kind: "confirmable" as const, evidence: call === 1 ? first : second };
      },
    });
  }

  const ignoring = (entries: number, bytes: number) => evidence({ ignored: { kind: "measured", entries, bytes } });

  it("will not run an unforced removal that would delete ignored material", async () => {
    // git refuses a dirty worktree itself and knows nothing about the ignored
    // tree — the `node_modules` and the copied `.env` this extension put there.
    const h = harness({
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: ignoring(4_000, 900_000) }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "blocked", verb: "remove" });
  });

  it("will not run one whose ignored material could not be measured either", async () => {
    // Unproven is confirmable, never a refusal — but it is still something the
    // user has to be told before an irreversible delete.
    const h = harness({
      assessRemoval: async () => ({
        kind: "confirmable" as const,
        evidence: evidence({ ignored: { kind: "unproven", reason: "budget" } }),
      }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "blocked", verb: "remove" });
  });

  it("re-prompts a force when ignored material appeared after the confirmation", async () => {
    // An install between reading the confirmation and typing it. Re-evaluation
    // is what notices; the token the user holds was issued against the old set.
    const h = moving(ignoring(1, 10), ignoring(4_000, 900_000));
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, false, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, true, blocked.fingerprint ?? "");

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[1]).toMatchObject({ kind: "error", verb: "remove" });
  });

  it("proceeds on the risk the user already confirmed", async () => {
    // "Did anything fail" would re-prompt forever on the very files the user
    // just approved. The comparison is against the set the token was bound to.
    const h = moving(ignoring(12, 5_000), ignoring(12, 5_000));
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, false, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, true, blocked.fingerprint ?? "");

    expect(h.argv[0]).toEqual(["worktree", "remove", "--force", RAW_PATH]);
  });

  it("proceeds when a risk the user confirmed stopped applying", async () => {
    const h = moving(ignoring(12, 5_000), ignoring(0, 0));
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, false, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, true, blocked.fingerprint ?? "");

    expect(h.argv[0]).toEqual(["worktree", "remove", "--force", RAW_PATH]);
  });

  it("refuses a force whose re-evaluation turned into a refusal", async () => {
    // § 3: force never runs against a working agent, and there is no
    // confirmation for it to ask for — so this is a refusal, not a re-prompt.
    let call = 0;
    const h = harness({
      assessRemoval: async () => {
        call += 1;
        return call === 1
          ? { kind: "confirmable" as const, evidence: evidence({ dirtyPaths: ["a.ts"] }) }
          : {
              kind: "refused" as const,
              isMain: false,
              busyAgents: 1,
              containsWorktrees: [],
              liveExternalSessionIds: [],
            };
      },
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, false, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, true, blocked.fingerprint ?? "");

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[1]).toMatchObject({ kind: "blocked", verb: "remove", fingerprint: null });
  });
});

describe("a proof never makes an unforced removal ask for confirmation (design.md D2)", () => {
  const proofs = (over: Partial<RemovalEvidence["proofs"]>): RemovalEvidence =>
    evidence({ proofs: { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven", ...over } });

  it("runs an unforced removal with every proof FAILING", async () => {
    // A fresh lock, a live owner and an unmerged branch. `atRisk` decides
    // whether an unforced removal may run at all, and none of that is a risk:
    // there is nothing here the removal would destroy.
    const h = harness({
      assessRemoval: async () => ({
        kind: "confirmable" as const,
        evidence: proofs({ lockAged: "failed", ownerGone: "failed", branchMerged: "failed" }),
      }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, false, undefined);

    expect(h.runner.run).toHaveBeenCalled();
    expect(h.outcomes[0]).not.toMatchObject({ kind: "blocked" });
  });

  it("does not re-prompt a granted force because a proof moved", async () => {
    // A real risk the user confirmed (one dirty file), and between the two
    // reads the branch got merged. `isIdentityPreservingSubset` must not see
    // that: re-prompting an irreversible action over a change in its favour is
    // exactly what folding a proof into the digest would do.
    let call = 0;
    const h = harness({
      assessRemoval: async () => {
        call += 1;
        return {
          kind: "confirmable" as const,
          evidence: {
            ...proofs(call === 1 ? { branchMerged: "failed" } : { branchMerged: "passed", ownerGone: "passed" }),
            dirtyPaths: ["a.ts"],
          },
        };
      },
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, false, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, true, blocked.fingerprint ?? "");

    expect(h.argv[0]).toEqual(["worktree", "remove", "--force", RAW_PATH]);
  });
});

describe("reattach repairs in place, and re-checks the pause", () => {
  const STALE = "/repo-wt/stale";

  /** A listing whose only prunable record is `paths`. */
  function listing(paths: readonly string[]): string {
    return [
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      ...paths.flatMap((p) => [`worktree ${p}`, "HEAD bbb", "branch refs/heads/feat", "prunable gitdir gone", ""]),
    ].join("\n");
  }

  /**
   * A runner that answers each git question separately, so a test can move one
   * of them without moving the others.
   */
  function reattachHarness(
    over: {
      head?: string;
      stillPrunable?: readonly string[];
      /** The administrative entry disappeared between the pre-check and now. */
      goneAfter?: boolean;
      repairOk?: boolean;
      registeredBefore?: boolean;
      branchBefore?: string;
      verdict?: ReattachVerdict;
      listing?: null;
    } = {},
  ) {
    // The listing is read TWICE — once to prove the stale registration is still
    // there to repair, once to prove the repair took. A test moves one without
    // moving the other.
    let reads = 0;
    const h = harness({
      listWorktrees: async () => {
        reads += 1;
        if (over.listing === null) {
          return null;
        }
        if (reads === 1) {
          return over.registeredBefore === false
            ? []
            : [{ displayPath: STALE, branch: over.branchBefore ?? "feat", prunable: true }];
        }
        // The registration is STILL THERE after a repair — what moves is its
        // `prunable` flag. Modelling success as the record VANISHING is what
        // let the vacuous-success path pass: a registration pruned between the
        // pre-check and the command looks exactly like that, and `repair`
        // no-ops at exit 0 against it (round-3 B1).
        if (over.goneAfter === true) {
          return [];
        }
        return [{ displayPath: STALE, branch: "feat", prunable: (over.stillPrunable ?? []).includes(STALE) }];
      },
      corroborateRepair: async ({ repairPath }) =>
        over.verdict ?? { kind: "offer", repairPath, expectedOid: over.head ?? "oid-1" },
      pathDeps: {
        platform: "darwin",
        lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true, dev: 1, ino: 9 }),
        readdir: async () => ["src", ".git"],
        normalize: async (raw) => raw,
      },
      runner: {
        run: vi.fn(async (args: readonly string[]) => {
          if (args[0] === "rev-parse") {
            return ok({ stdout: Buffer.from(`${over.head ?? "oid-1"}\n`) });
          }
          if (args[1] === "list") {
            return ok({ stdout: Buffer.from(listing(over.stillPrunable ?? [])) });
          }
          if (args[1] === "repair" && over.repairOk === false) {
            return { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: no such worktree", ...FAILED };
          }
          return ok();
        }),
      },
    });
    return h;
  }

  const FAILED = { timedOut: false, failedToSpawn: false };

  async function reattach(h: ReturnType<typeof harness>, expectedOid = "oid-1"): Promise<void> {
    await h.service.createWorktree({
      repoId: REPO,
      path: STALE,
      afterCreate: { kind: "none" },
      mode: { kind: "reattach", branch: "feat", repairPath: STALE, expectedOid },
      disposition: { kind: "free" },
    });
  }

  function argvOf(h: ReturnType<typeof harness>): string[][] {
    return (h.runner.run as ReturnType<typeof vi.fn>).mock.calls.map((c) => [...(c[0] as string[])]);
  }

  it("issues `worktree repair` and never `worktree add`", async () => {
    const h = reattachHarness();
    await reattach(h);

    const argv = argvOf(h);
    expect(argv).toContainEqual(["worktree", "repair", STALE]);
    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(false);
    expect(h.outcomes[0]).toMatchObject({ kind: "ok", verb: "create" });
  });

  it("refuses a checkout that moved since it resolved, and issues no mutation", async () => {
    // The resolution is a read that authorizes a mutation, and the user's
    // decision sits between them. The guard is at the mutation (D3).
    const h = reattachHarness({ head: "oid-2" });
    await reattach(h, "oid-1");

    const argv = argvOf(h);
    expect(argv.some((a) => a[1] === "repair")).toBe(false);
    expect(argv.some((a) => a[1] === "add")).toBe(false);
    expect(h.outcomes[0]).toMatchObject({ kind: "error", message: expect.stringContaining("moved") });
  });

  it("refuses a checkout whose commit could not be read, and issues no mutation", async () => {
    // The mutation delegates D3 conditions 2 and 3 to the same probe that made
    // the offer, so an unreadable HEAD arrives here as the verdict the probe
    // already folds it into: we cannot say this checkout is where the branch
    // is, which is not a state to repair against.
    const h = reattachHarness({ verdict: { kind: "declined", because: "headMoved" } });
    await reattach(h);

    expect(argvOf(h).some((a) => a[1] === "repair")).toBe(false);
    expect(h.outcomes[0]).toMatchObject({ kind: "error", verb: "create" });
  });

  it("refuses when the git link itself could not be read", async () => {
    const h = reattachHarness({ verdict: { kind: "declined", because: "unreadable" } });
    await reattach(h);

    expect(argvOf(h).some((a) => a[1] === "repair")).toBe(false);
    expect(h.outcomes[0]).toMatchObject({
      kind: "error",
      message: expect.stringContaining("could not be read"),
    });
  });

  it("refuses once the administrative entry is gone, rather than repairing nothing", async () => {
    // The hole this closes: with the entry pruned, `git worktree repair` has
    // nothing to reconnect and exits 0, and the condition-4 check then asks
    // whether a path nobody registered is still prunable. It is not — so
    // without this guard a repair that did nothing reports success.
    const h = reattachHarness({ verdict: { kind: "adopt", adoptPath: STALE } });
    await reattach(h);

    expect(argvOf(h).some((a) => a[1] === "repair")).toBe(false);
    expect(h.outcomes[0]).toMatchObject({
      kind: "error",
      message: expect.stringContaining("administrative entry is gone"),
    });
  });

  it("refuses when the listing no longer carries the stale registration", async () => {
    const h = reattachHarness({ registeredBefore: false });
    await reattach(h);

    expect(argvOf(h).some((a) => a[1] === "repair")).toBe(false);
    expect(h.outcomes[0]).toMatchObject({
      kind: "error",
      message: expect.stringContaining("no longer reports"),
    });
  });

  it("refuses when the stale registration is on a different branch", async () => {
    // `mode.branch` was accepted and never consulted before round 1: a stale
    // registration of ANOTHER branch would have been repaired on this one's say-so.
    const h = reattachHarness({ branchBefore: "some-other-branch" });
    await reattach(h);

    expect(argvOf(h).some((a) => a[1] === "repair")).toBe(false);
    expect(h.outcomes[0]).toMatchObject({ kind: "error", verb: "create" });
  });

  it("corroborates BEFORE it repairs, never after", async () => {
    const seen: string[] = [];
    const h = reattachHarness();
    await reattach(h);

    for (const call of argvOf(h)) {
      seen.push(call.join(" "));
    }
    // Nothing but the repair itself reaches git on this path now: the listing
    // and the corroboration are injected, and both ran before it.
    expect(seen.filter((c) => c.includes("repair"))).toHaveLength(1);
  });

  it("reports a repair that did not take, rather than claiming it", async () => {
    // Git exiting 0 is not the claim. § 2.3 condition 4 is the listing losing
    // `prunable`, and a listing that still reports it is a failed repair.
    const h = reattachHarness({ stillPrunable: [STALE] });
    await reattach(h);

    expect(argvOf(h)).toContainEqual(["worktree", "repair", STALE]);
    expect(h.outcomes[0]).toMatchObject({ kind: "error", message: expect.stringContaining("did not take") });
  });

  it("does not report a repair when the registration it repaired is gone", async () => {
    // The entry was pruned between the pre-check and the command. `repair`
    // no-ops at exit 0 against that, so reading its ABSENCE from the listing as
    // success announced a repair that never happened (round-3 B1).
    const h = reattachHarness({ goneAfter: true });
    await reattach(h);

    expect(argvOf(h)).toContainEqual(["worktree", "repair", STALE]);
    expect(h.outcomes[0]).toMatchObject({ kind: "unavailable", verb: "create", unreadable: ["prunable"] });
  });

  it("does not read a listing it could not obtain as a successful repair", async () => {
    const h = reattachHarness({ listing: null });
    await reattach(h);

    expect(h.outcomes[0]).toMatchObject({ kind: "unavailable", verb: "create", unreadable: ["prunable"] });
  });

  it("never writes the working tree: no add, no checkout, no --force", async () => {
    const h = reattachHarness();
    await reattach(h);

    // A repair that RAN and still wrote nothing. Without this line the loop
    // below is satisfied by a branch that never issued a command at all.
    expect(argvOf(h)).toContainEqual(["worktree", "repair", STALE]);
    for (const args of argvOf(h)) {
      expect(args).not.toContain("--force");
      expect(args).not.toContain("checkout");
      expect(args[1]).not.toBe("add");
    }
  });

  it("still refuses a directory that is gone, before asking git anything", async () => {
    const h = harness({
      pathDeps: {
        platform: "darwin",
        lstat: async () => null,
        readdir: async () => null,
        normalize: async (raw) => raw,
      },
    });
    await reattach(h);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "error" });
  });
});
