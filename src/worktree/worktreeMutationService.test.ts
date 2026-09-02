// The assembly round-1 B1 found missing, and the ordering round-1 B2 found
// wrong. The unit tests around each component prove the component; only this
// one proves that a message reaching the service turns into a git command
// against the target the id names AFTER the rebuild.

import { describe, expect, it, vi } from "vitest";
import type { BranchDeleteRequest, ProvisionStepResult } from "../types/messages";
import type { AuthorizedDirectory } from "../utils/authorizedDirectory";
import type { ClearDebrisDeps } from "./clearDebris";
import { createDebrisAuthorizationStore, type DebrisAuthorizationStore } from "./debrisAuthorization";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import type { MigrationOfferEvidence } from "./migrateChanges";
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
const DELETE_BRANCH: BranchDeleteRequest = {
  branch: "feature",
  expectedBranchOid: "1".repeat(40),
  defaultBranch: "main",
  expectedDefaultOid: "2".repeat(40),
  fingerprint: "branch-fp",
};

function deleteBranchRequest(fingerprint: string, over: Partial<BranchDeleteRequest> = {}): BranchDeleteRequest {
  return { ...DELETE_BRANCH, fingerprint, ...over };
}

function ok(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function authorization(path: string): AuthorizedDirectory {
  return {
    path,
    platform: process.platform,
    components: [{ path, identity: { dev: 7, ino: path.length + 1 } }],
  };
}

function migrationEvidence(): MigrationOfferEvidence {
  const sourcePath = "/repo-wt/source";
  return {
    source: {
      path: sourcePath,
      directory: authorization(sourcePath),
      git: {
        path: `${sourcePath}/.git`,
        kind: "file",
        identity: { dev: 7, ino: 21 },
        contentHash: "gitfile-a",
        adminPath: "/repo/.git/worktrees/source",
        adminIdentity: { dev: 7, ino: 22 },
        adminFiles: [],
      },
    },
    snapshot: { count: 1, records: [], states: [] },
  };
}

/** The merge evidence a proven merge would carry for `DELETE_BRANCH`'s pair. */
function mergeEvidenceFor(req: BranchDeleteRequest) {
  return {
    branch: req.branch,
    branchOid: req.expectedBranchOid,
    base: req.defaultBranch,
    baseOid: req.expectedDefaultOid,
  };
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
    authorizeDirectory: async (candidate) => authorization(candidate),
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
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0]).toMatchObject({ kind: "error", verb: "remove" });
  });

  it("refuses a fingerprint the service never issued", async () => {
    const h = harness();
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, "never-issued");

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({
      kind: "error",
      message: expect.stringContaining("changed since you confirmed"),
    });
  });

  it("reports instead of executing when no confirmation was supplied", async () => {
    const h = harness();
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "blocked", verb: "remove", fingerprint: expect.any(String) });
  });

  it("refuses confirmation whose current evidence could not be read", async () => {
    // Unreadable evidence is not "nothing at risk" — there is no set to
    // compare the confirmation against, so it authorizes nothing.
    const h = harness({ assessRemoval: async () => null });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());
    await h.service.removeWorktree(t, fp ?? "");

    expect(h.runner.run).not.toHaveBeenCalled();
  });

  it("accepts a confirmed risk once", async () => {
    const approved = evidence({ dirtyPaths: ["a.ts"] });
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: approved }) });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, approved);
    expect(fp).not.toBeNull();

    await h.service.removeWorktree(t, fp ?? "");
    expect(h.argv[0]).toEqual(["worktree", "remove", "--force", RAW_PATH]);

    // Spent: the same token a second time is refused rather than replayed.
    await h.service.removeWorktree(t, fp ?? "");
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
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

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
    await h.service.removeWorktree(t, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };
    expect(blocked.fingerprint).not.toBeNull();

    await h.service.removeWorktree(t, blocked.fingerprint ?? "");
    expect(h.argv[0]).toEqual(["worktree", "remove", "--force", RAW_PATH]);
  });

  it("reports a clean fingerprint-free removal instead of running git", async () => {
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }) });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(target, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    const blocked = h.outcomes[0] as { fingerprint: string | null };
    expect(blocked).toMatchObject({ kind: "blocked", verb: "remove" });
    expect(blocked.fingerprint).not.toBeNull();

    await h.service.removeWorktree(target, blocked.fingerprint ?? "");
    expect(h.argv[0]).toEqual(["worktree", "remove", RAW_PATH]);
  });

  /** A merge proven, at the exact pair `DELETE_BRANCH` claims — issued at the ask. */
  const provenAssessRemoval = async () => ({
    kind: "confirmable" as const,
    evidence: evidence({
      proofs: {
        lockAged: "unproven" as const,
        ownerGone: "unproven" as const,
        branchMerged: "passed" as const,
        mergeEvidence: mergeEvidenceFor(DELETE_BRANCH),
      },
    }),
  });

  it("runs the opted-in branch action only after a successful removal", async () => {
    const deleteBranch = vi.fn(async () => ({ kind: "deleted" as const, branch: "feature" }));
    const h = harness({ deleteBranch, assessRemoval: provenAssessRemoval });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(target, undefined);
    const fingerprint = (h.outcomes[0] as { fingerprint: string }).fingerprint;

    await h.service.removeWorktree(target, fingerprint, deleteBranchRequest(fingerprint));

    expect(deleteBranch).toHaveBeenCalledWith("/repo", deleteBranchRequest(fingerprint));
    expect(h.outcomes[1]).toMatchObject({
      kind: "ok",
      verb: "remove",
      branchDelete: { kind: "deleted", branch: "feature" },
    });
  });

  it("reports a refused branch action without changing the successful removal", async () => {
    const h = harness({
      deleteBranch: async () => ({ kind: "refused", reason: "refs-moved" }),
      assessRemoval: provenAssessRemoval,
    });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(target, undefined);
    const fingerprint = (h.outcomes[0] as { fingerprint: string }).fingerprint;

    await h.service.removeWorktree(target, fingerprint, deleteBranchRequest(fingerprint));

    expect(h.outcomes[1]).toMatchObject({
      kind: "ok",
      verb: "remove",
      branchDelete: { kind: "refused", reason: "refs-moved" },
    });
  });

  it("keeps the removal successful when the branch binding rejects", async () => {
    const h = harness({
      deleteBranch: async () => Promise.reject(new Error("unavailable")),
      assessRemoval: provenAssessRemoval,
    });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(target, undefined);
    const fingerprint = (h.outcomes[0] as { fingerprint: string }).fingerprint;

    await h.service.removeWorktree(target, fingerprint, deleteBranchRequest(fingerprint));

    expect(h.outcomes[1]).toMatchObject({
      kind: "ok",
      verb: "remove",
      branchDelete: { kind: "refused", reason: "holders-unavailable" },
    });
  });

  it("refuses the branch action without invoking the binding when nothing proved the merge", async () => {
    // D10: an opt-in whose issued evidence never carried merge evidence has no
    // proven OIDs to guard a delete with. Forwarding the caller's own claimed
    // `DELETE_BRANCH` OIDs here would be the exact substitution the guard
    // exists to prevent, so the binding must never see them.
    const deleteBranch = vi.fn(async () => ({ kind: "deleted" as const, branch: "feature" }));
    const h = harness({ deleteBranch });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(target, undefined);
    const fingerprint = (h.outcomes[0] as { fingerprint: string }).fingerprint;

    await h.service.removeWorktree(target, fingerprint, deleteBranchRequest(fingerprint));

    expect(deleteBranch).not.toHaveBeenCalled();
    expect(h.outcomes[1]).toMatchObject({
      kind: "ok",
      verb: "remove",
      branchDelete: { kind: "refused", reason: "holders-unavailable" },
    });
  });

  it.each([
    ["fingerprint", { fingerprint: "another-report" }],
    ["branch name", { branch: "other-feature" }],
    ["branch OID", { expectedBranchOid: "8".repeat(40) }],
    ["default name", { defaultBranch: "trunk" }],
    ["default OID", { expectedDefaultOid: "7".repeat(40) }],
  ] as const)("refuses a branch opt-in whose %s does not match the redeemed report", async (_field, mismatch) => {
    const deleteBranch = vi.fn(async () => ({ kind: "deleted" as const, branch: "feature" }));
    const h = harness({ deleteBranch, assessRemoval: provenAssessRemoval });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(target, undefined);
    const fingerprint = (h.outcomes[0] as { fingerprint: string }).fingerprint;

    await h.service.removeWorktree(target, fingerprint, deleteBranchRequest(fingerprint, mismatch));

    expect(deleteBranch).not.toHaveBeenCalled();
    expect(h.outcomes[1]).toMatchObject({
      kind: "ok",
      verb: "remove",
      branchDelete: { kind: "refused", reason: "holders-unavailable" },
    });
  });

  it("does not let an older surface's opt-in act on a newer same-risk report", async () => {
    const first = mergeEvidenceFor(DELETE_BRANCH);
    const second = { ...first, branch: "other-feature", branchOid: "8".repeat(40) };
    let assessments = 0;
    const deleteBranch = vi.fn(async () => ({ kind: "deleted" as const, branch: second.branch }));
    const h = harness({
      deleteBranch,
      assessRemoval: async () => {
        const mergeEvidence = assessments++ === 0 ? first : second;
        return {
          kind: "confirmable" as const,
          evidence: evidence({
            proofs: {
              lockAged: "unproven" as const,
              ownerGone: "unproven" as const,
              branchMerged: "passed" as const,
              mergeEvidence,
            },
          }),
        };
      },
    });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(target, undefined);
    const firstFingerprint = (h.outcomes[0] as { fingerprint: string }).fingerprint;
    await h.service.removeWorktree(target, undefined);
    const secondFingerprint = (h.outcomes[1] as { fingerprint: string }).fingerprint;
    expect(secondFingerprint).toBe(firstFingerprint);

    await h.service.removeWorktree(target, firstFingerprint, deleteBranchRequest(firstFingerprint));

    expect(deleteBranch).not.toHaveBeenCalled();
    expect(h.outcomes[2]).toMatchObject({
      kind: "ok",
      verb: "remove",
      branchDelete: { kind: "refused", reason: "holders-unavailable" },
    });
  });

  it("guards the branch delete with the OIDs issued at the ask, not ones read fresh at redemption", async () => {
    // The branch moved between the ask (issue) and the confirm (redeem). The
    // binding must still see the OID the user was shown, never the fresh one
    // — the exact case design.md D10 exists to close.
    const issued = mergeEvidenceFor(DELETE_BRANCH);
    const moved = { ...issued, branchOid: "9".repeat(40) };
    let asked = false;
    const deleteBranch = vi.fn(async () => ({ kind: "deleted" as const, branch: "feature" }));
    const h = harness({
      deleteBranch,
      assessRemoval: async () => {
        const mergeEvidence = asked ? moved : issued;
        asked = true;
        return {
          kind: "confirmable" as const,
          evidence: evidence({
            proofs: {
              lockAged: "unproven" as const,
              ownerGone: "unproven" as const,
              branchMerged: "passed" as const,
              mergeEvidence,
            },
          }),
        };
      },
    });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(target, undefined);
    const fingerprint = (h.outcomes[0] as { fingerprint: string }).fingerprint;

    await h.service.removeWorktree(target, fingerprint, deleteBranchRequest(fingerprint));

    expect(deleteBranch).toHaveBeenCalledWith("/repo", deleteBranchRequest(fingerprint));
    expect(deleteBranch).not.toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ expectedBranchOid: moved.branchOid }),
    );
  });

  it("attempts no branch action when removal fails or the opt-in is absent", async () => {
    const deleteBranch = vi.fn(async () => ({ kind: "deleted" as const, branch: "feature" }));
    const failingRunner: GitCommandRunner = {
      run: vi.fn(async (args) => (args[0] === "worktree" && args[1] === "remove" ? ok({ code: 1 }) : ok())),
    };
    const failed = harness({ runner: failingRunner, deleteBranch });
    const target = { repoId: REPO, worktreeId: RAW_ID };
    await failed.service.removeWorktree(target, undefined);
    const failedFingerprint = (failed.outcomes[0] as { fingerprint: string }).fingerprint;
    await failed.service.removeWorktree(target, failedFingerprint, deleteBranchRequest(failedFingerprint));

    const unrequested = harness({ deleteBranch });
    await unrequested.service.removeWorktree(target, undefined);
    const unrequestedFingerprint = (unrequested.outcomes[0] as { fingerprint: string }).fingerprint;
    await unrequested.service.removeWorktree(target, unrequestedFingerprint);

    expect(deleteBranch).not.toHaveBeenCalled();
    expect(failed.outcomes[1]).not.toMatchObject({ kind: "ok" });
    expect(unrequested.outcomes[1]).toMatchObject({ kind: "ok", verb: "remove" });
    expect(unrequested.outcomes[1]).not.toHaveProperty("branchDelete");
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
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "blocked", fingerprint: null });
  });

  it("reports unreadable evidence as its own outcome, and runs nothing", async () => {
    const h = harness({ assessRemoval: async () => ({ kind: "unavailable" as const, unreadable: ["status"] }) });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

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

    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());
    await h.service.removeWorktree(t, fp ?? "");

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "unavailable", unreadable: ["listing"] });
  });

  it("still runs when the tree holds still across both", async () => {
    // The negative that keeps the check above from being a blanket refusal.
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }) });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());

    await h.service.removeWorktree(t, fp ?? "");

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
    await h.service.removeWorktree(t, fp ?? "");
    expect(h.runner.run).not.toHaveBeenCalled();

    // The read recovers — and the token is still gone.
    readable = true;
    await h.service.removeWorktree(t, fp ?? "");
    expect(h.runner.run).not.toHaveBeenCalled();
  });

  it("forgets authority issued while the confirmed removal is in flight once the worktree is gone", async () => {
    let present = true;
    let reissued: string | null = null;
    const argv: string[][] = [];
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const h = harness({
      runner: {
        run: vi.fn(async (args: readonly string[]) => {
          argv.push([...args]);
          if (args[1] === "remove") {
            reissued = h.service.issueFingerprint(t, evidence());
            present = false;
          }
          return ok();
        }),
      },
      resolve: () => (present ? target() : null),
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
      observeAfter: async () => ({ isRegistered: false, existsOnDisk: false }),
    });
    const fp = h.service.issueFingerprint(t, evidence());

    await h.service.removeWorktree(t, fp ?? "");
    expect(argv).toHaveLength(1);
    expect(reissued).not.toBeNull();

    present = true;
    await h.service.removeWorktree(t, reissued ?? "");
    expect(argv).toHaveLength(1);
  });

  it("reports indeterminate when the removal left the directory behind", async () => {
    const h = harness({
      observeAfter: async () => ({ isRegistered: false, existsOnDisk: true }),
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());
    await h.service.removeWorktree(t, fp ?? "");

    expect(h.outcomes[0]).toMatchObject({ kind: "indeterminate" });
  });

  it("reports indeterminate when the post-attempt listing could not be trusted", async () => {
    const h = harness({
      observeAfter: async () => null,
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());
    await h.service.removeWorktree(t, fp ?? "");

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
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());
    await h.service.removeWorktree(t, fp ?? "");

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
    await h.service.removeWorktree(t, undefined);
    expect(argv).toHaveLength(0);

    // Recreated at the same location. The old confirmation authorizes nothing.
    present = true;
    await h.service.removeWorktree(t, fp ?? "");
    expect(argv.filter((a) => a.includes("--force"))).toHaveLength(0);
  });

  it("says the worktree is already gone rather than reporting an internal throw", async () => {
    const h = harness({ resolve: () => null });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

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
    await h.service.removeWorktree(t, fp ?? "");

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
    await h.service.removeWorktree(t, fp ?? "");

    expect(h.argv).toEqual([["worktree", "remove", RAW_PATH]]);
  });

  it("forces exactly one rebuild after the attempt, not one per layer", async () => {
    // Round-3 W5: the coordinator owned a post-attempt rebuild and the removal
    // body ran another one to classify against.
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }) });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

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
      gitExcludeDirFor: (repoId, repoPath, createdPath) => ({
        gitDir: repoId,
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
      gitExcludeDirFor: (repoId, repoPath, createdPath) => {
        const root = createdPath.slice(0, createdPath.lastIndexOf("/"));
        return { gitDir: repoId, relativePath: root.slice(repoPath.length + 1) };
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
    const t = { repoId: REPO, worktreeId: RAW_ID };
    const fp = h.service.issueFingerprint(t, evidence());
    await h.service.removeWorktree(t, fp ?? "");
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

    await h.service.removeWorktree(t, fp ?? "");
    expect(h.outcomes).toEqual([expect.objectContaining({ kind: "error", verb: "remove" })]);

    // Spent. A second attempt with the same token authorizes nothing, because
    // the first may already have run git — even though the assessment now works.
    h.outcomes.length = 0;
    explode = false;
    await h.service.removeWorktree(t, fp ?? "");
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

  it("will not run a fingerprint-free removal that would delete ignored material", async () => {
    // git refuses a dirty worktree itself and knows nothing about the ignored
    // tree — the `node_modules` and the copied `.env` this extension put there.
    const h = harness({
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: ignoring(4_000, 900_000) }),
    });
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

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
    await h.service.removeWorktree({ repoId: REPO, worktreeId: RAW_ID }, undefined);

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ kind: "blocked", verb: "remove" });
  });

  it("re-prompts a force when ignored material appeared after the confirmation", async () => {
    // An install between reading the confirmation and typing it. Re-evaluation
    // is what notices; the token the user holds was issued against the old set.
    const h = moving(ignoring(1, 10), ignoring(4_000, 900_000));
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, blocked.fingerprint ?? "");

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[1]).toMatchObject({ kind: "error", verb: "remove" });
  });

  it("proceeds on the risk the user already confirmed", async () => {
    // "Did anything fail" would re-prompt forever on the very files the user
    // just approved. The comparison is against the set the token was bound to.
    const h = moving(ignoring(12, 5_000), ignoring(12, 5_000));
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, blocked.fingerprint ?? "");

    expect(h.argv[0]).toEqual(["worktree", "remove", "--force", RAW_PATH]);
  });

  it("proceeds ordinarily when a confirmed risk stopped applying", async () => {
    const h = moving(ignoring(12, 5_000), ignoring(0, 0));
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, blocked.fingerprint ?? "");

    expect(h.argv[0]).toEqual(["worktree", "remove", RAW_PATH]);
  });

  it("refuses confirmation whose re-evaluation became a refusal", async () => {
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
    await h.service.removeWorktree(t, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, blocked.fingerprint ?? "");

    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.outcomes[1]).toMatchObject({ kind: "blocked", verb: "remove", fingerprint: null });
  });
});

describe("a proof never makes a confirmed removal use force (design.md D2)", () => {
  const proofs = (over: Partial<RemovalEvidence["proofs"]>): RemovalEvidence =>
    evidence({ proofs: { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven", ...over } });

  it("runs ordinarily with every proof failing", async () => {
    const h = harness({
      assessRemoval: async () => ({
        kind: "confirmable" as const,
        evidence: proofs({ lockAged: "failed", ownerGone: "failed", branchMerged: "failed" }),
      }),
    });
    const t = { repoId: REPO, worktreeId: RAW_ID };
    await h.service.removeWorktree(t, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, blocked.fingerprint ?? "");

    expect(h.argv[0]).toEqual(["worktree", "remove", RAW_PATH]);
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
    await h.service.removeWorktree(t, undefined);
    const blocked = h.outcomes[0] as { fingerprint: string | null };

    await h.service.removeWorktree(t, blocked.fingerprint ?? "");

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
      /** The post-repair listing carries the same path and branch twice. */
      doubledAfter?: boolean;
      repairOk?: boolean;
      registeredBefore?: boolean;
      branchBefore?: string;
      verdict?: ReattachVerdict;
      listing?: null;
      /** Present only for the one test that pairs a repair with a clearance. */
      debris?: { store: DebrisAuthorizationStore; deps: ClearDebrisDeps };
    } = {},
  ) {
    // The listing is read TWICE — once to prove the stale registration is still
    // there to repair, once to prove the repair took. A test moves one without
    // moving the other.
    let reads = 0;
    const h = harness({
      ...(over.debris === undefined
        ? {}
        : { debrisAuthorizations: over.debris.store, clearDebrisDeps: over.debris.deps }),
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
        const record = { displayPath: STALE, branch: "feat", prunable: (over.stillPrunable ?? []).includes(STALE) };
        return over.doubledAfter === true ? [record, { ...record }] : [record];
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

  it("[B7] refuses a repair that carries a clearance, rather than repairing and leaving the debris", async () => {
    // A repair acts on the registration's own path and returns before the
    // clearance runs. Without the refusal this create reports a SUCCESSFUL
    // repair while the directory it promised to clear is untouched — which is
    // why the assertion is on the repair not happening, not on `removed`.
    const store = createDebrisAuthorizationStore();
    const removed: string[] = [];
    const h = reattachHarness({
      debris: {
        store,
        deps: {
          lstat: () => ({ isSymbolicLink: () => false, isDirectory: () => true, dev: 1, ino: 9 }),
          readdir: () => ["stale.log"],
          probeEntry: () => "absent",
          remove: async (path: string) => {
            removed.push(path);
          },
        },
      },
    });
    const token = store.issue(STALE, { entries: ["stale.log"], identity: "1:9" }, 0);

    await h.service.createWorktree({
      repoId: REPO,
      path: STALE,
      afterCreate: { kind: "none" },
      mode: { kind: "reattach", branch: "feat", repairPath: STALE, expectedOid: "oid-1" },
      disposition: { kind: "debris", authorization: { path: STALE, fingerprint: token } },
    });

    expect(
      argvOf(h).some((a) => a[1] === "repair"),
      "the repair ran on a create that promised a clearance",
    ).toBe(false);
    expect(removed).toEqual([]);
    expect(h.outcomes[0]).toMatchObject({ kind: "error" });
  });

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

  it("refuses a listing that carries the repaired path twice", async () => {
    // Two records for one path and branch is a listing nobody can reason about,
    // and picking one would be a guess about which registration was proved.
    const h = reattachHarness({ doubledAfter: true });
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

describe("clearing crash debris", () => {
  const DEBRIS = "/repo/wt/new";

  function debrisHarness(
    over: {
      entries?: string[] | null;
      remaining?: string[] | null;
      ino?: number;
      removed?: string[];
      git?: "present" | "absent" | "unknown";
      /** What the destination probe says AFTER the removal. Absent = it went. */
      after?: "present" | "absent" | "unknown";
      /**
       * What the CLEARANCE's own read sees, when it differs from the
       * redemption's. Two readings of one directory taken at different moments
       * is the whole subject of round-2 W4.
       */
      atBoundary?: readonly string[];
    } = {},
  ) {
    const removed = over.removed ?? [];
    const store = createDebrisAuthorizationStore();
    const h = harness({
      debrisAuthorizations: store,
      clearDebrisDeps: {
        lstat: () => ({ isSymbolicLink: () => false, isDirectory: () => true, dev: 1, ino: over.ino ?? 7 }),
        // The boundary's own read of the CONTENTS, and after the removal the
        // question of what remains — both synchronous, because the window
        // between the last reading and the delete is what they guard.
        readdir: () => over.remaining ?? over.atBoundary ?? over.entries ?? [],
        probeEntry: (p) => (p.endsWith(".git") ? (over.git ?? "absent") : (over.after ?? "absent")),
        remove: async (p: string) => {
          removed.push(p);
        },
      },
      pathDeps: {
        platform: "darwin",
        lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true, dev: 1, ino: over.ino ?? 7 }),
        readdir: async () => (over.entries === null ? null : (over.entries ?? ["stale.log"])),
        normalize: async (raw: string) => raw,
      },
    });
    return { ...h, store, removed };
  }

  it("clears the destination and then creates, in that order", async () => {
    const { service, store, removed, runner } = debrisHarness();
    const token = store.issue(DEBRIS, { entries: ["stale.log"], identity: "1:7" }, 0);
    await service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "debris", authorization: { path: DEBRIS, fingerprint: token } },
    });

    expect(removed).toEqual([DEBRIS]);
    expect(runner.run).toHaveBeenCalled();
  });

  it("removes nothing and never reaches git when the authorization is refused", async () => {
    // An entry appeared since the user was shown the directory.
    const { service, store, removed, argv, outcomes } = debrisHarness({ entries: ["stale.log", "new.tmp"] });
    const token = store.issue(DEBRIS, { entries: ["stale.log"], identity: "1:7" }, 0);
    await service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "debris", authorization: { path: DEBRIS, fingerprint: token } },
    });

    expect(removed).toEqual([]);
    // The branch-name check runs before the clearance and is allowed to; what
    // must not happen is the create itself.
    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(false);
    expect(outcomes[0]).toMatchObject({ kind: "error" });
  });

  it("removes nothing and never reaches git for a forged authorization", async () => {
    const { service, removed, argv, outcomes } = debrisHarness();
    await service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "debris", authorization: { path: DEBRIS, fingerprint: "forged" } },
    });

    expect(removed).toEqual([]);
    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(false);
    expect(outcomes[0]).toMatchObject({ kind: "error" });
  });

  it("fails the create rather than reporting success when the clearance is partial", async () => {
    // `remove` returns, but entries survive it. The create must not proceed on
    // a destination it could not clear (design.md D5).
    const { service, store, argv, outcomes } = debrisHarness({
      entries: ["locked.db"],
      remaining: ["locked.db"],
      // The destination is STILL THERE after `remove` returned — which is the
      // only thing that makes this a partial clearance rather than a clean one.
      after: "present",
    });
    const token = store.issue(DEBRIS, { entries: ["locked.db"], identity: "1:7" }, 0);
    await service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "debris", authorization: { path: DEBRIS, fingerprint: token } },
    });

    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(false);
    expect(outcomes[0]).toMatchObject({ kind: "error" });
  });

  it("[B3] refuses an unreadable directory rather than redeeming it as empty", async () => {
    // `entries ?? []` made an unreadable directory a subset of every approved
    // set, so contents nobody could inspect passed the comparison and a
    // recursive delete followed.
    const removed: string[] = [];
    const { service, store, argv, outcomes } = debrisHarness({ removed, entries: null });
    const token = store.issue(DEBRIS, { entries: ["stale.log"], identity: "1:7" }, 0);
    await service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "debris", authorization: { path: DEBRIS, fingerprint: token } },
    });

    expect(removed).toEqual([]);
    expect(argv.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(false);
    expect(outcomes[0]).toMatchObject({ kind: "error" });
  });

  it("[B3] spends the authorization on the refusal, so a retry cannot replay it", async () => {
    const removed: string[] = [];
    const { service, store } = debrisHarness({ removed, entries: null });
    const token = store.issue(DEBRIS, { entries: ["stale.log"], identity: "1:7" }, 0);
    const request = {
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" } as const,
      mode: { kind: "fresh", branch: "feat" } as const,
      disposition: { kind: "debris", authorization: { path: DEBRIS, fingerprint: token } } as const,
    };
    await service.createWorktree(request);

    expect(store.size()).toBe(0);
    expect(removed).toEqual([]);
  });

  it("[round-2 W4] clears against what was APPROVED, not the reading the redemption happened to take", async () => {
    // `cache` was approved, was briefly gone when the redemption read the
    // directory, and is back by the time the boundary reads it. Comparing
    // against the redemption's intermediate reading called it new and refused a
    // clearance the user had authorized.
    const removed: string[] = [];
    const { service, store } = debrisHarness({
      removed,
      entries: ["stale.log"],
      atBoundary: ["stale.log", "cache"],
    });
    const token = store.issue(DEBRIS, { entries: ["stale.log", "cache"], identity: "1:7" }, 0);

    await service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "debris", authorization: { path: DEBRIS, fingerprint: token } },
    });

    expect(removed).toEqual([DEBRIS]);
  });

  it("[round-2 W4] still refuses an entry that was never approved at all", async () => {
    // The pair to the above: widening the comparison to the approved set must
    // not stop it refusing something genuinely new.
    const removed: string[] = [];
    const { service, store } = debrisHarness({
      removed,
      entries: ["stale.log"],
      atBoundary: ["stale.log", "UNSAVED-WORK.md"],
    });
    const token = store.issue(DEBRIS, { entries: ["stale.log", "cache"], identity: "1:7" }, 0);

    await service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "debris", authorization: { path: DEBRIS, fingerprint: token } },
    });

    expect(removed).toEqual([]);
  });

  it("issues a token the create can actually spend, over the entries it reports", async () => {
    // The round trip. An issuer writing to a different store than the create
    // redeems from would mint tokens nothing can spend, and every unit test on
    // either half would still pass.
    const removed: string[] = [];
    const h = debrisHarness({ removed });
    const issued = await h.service.issueDebrisAuthorization(DEBRIS);
    expect(issued.ok).toBe(true);
    expect(issued.ok && issued.entries).toEqual(["stale.log"]);

    await h.service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: {
        kind: "debris",
        authorization: { path: DEBRIS, fingerprint: issued.ok ? issued.fingerprint : "" },
      },
    });

    expect(removed).toEqual([DEBRIS]);
  });

  it("issues nothing for a path holding a .git, and says that is why", async () => {
    const h = debrisHarness({ git: "present" });
    expect(await h.service.issueDebrisAuthorization(DEBRIS)).toEqual({ ok: false, because: "notDebris" });
  });

  it("[W1] tells an unreadable directory apart from one holding a repository", async () => {
    // Collapsed to one answer, a permission failure told the user their
    // directory holds a repository — a claim the reading never made.
    const unknown = debrisHarness({ git: "unknown" });
    expect(await unknown.service.issueDebrisAuthorization(DEBRIS)).toEqual({ ok: false, because: "unreadable" });
  });

  it("issues nothing for a path whose entries could not be read", async () => {
    const h = debrisHarness({ entries: null });
    expect(await h.service.issueDebrisAuthorization(DEBRIS)).toEqual({ ok: false, because: "unreadable" });
  });

  it("removes nothing on an ordinary free-destination create", async () => {
    const removed: string[] = [];
    const h = harness({
      clearDebrisDeps: {
        lstat: () => null,
        readdir: () => null,
        probeEntry: () => "absent",
        remove: async (p: string) => {
          removed.push(p);
        },
      },
    });
    await h.service.createWorktree({
      repoId: REPO,
      path: DEBRIS,
      afterCreate: { kind: "none" },
      mode: { kind: "fresh", branch: "feat" },
      disposition: { kind: "free" },
    });

    expect(removed).toEqual([]);
    expect(h.runner.run).toHaveBeenCalled();
  });
});

describe("a removal report is produced without performing the removal", () => {
  const ASK = { repoId: "/repo/.git", worktreeId: RAW_ID };

  it("issues confirmation authority for a clean report without performing removal", async () => {
    const h = harness({ assessRemoval: async () => ({ kind: "confirmable", evidence: evidence(), fingerprint: "" }) });
    const report = await h.service.assessRemovalReport(ASK);

    expect(report?.kind === "assessed" && typeof report.fingerprint).toBe("string");
    // Confirmation authority is not Git force. The report remains read-only.
    expect(h.order.filter((s) => s.startsWith("git:"))).toEqual([]);
  });

  it("issues one exactly where the blocked path already would", async () => {
    // Tied to `atRisk` rather than restated: one dirty path is enough, and it is
    // the same predicate and the same call the blocked outcome makes.
    const h = harness({
      assessRemoval: async () => ({
        kind: "confirmable",
        evidence: evidence({ dirtyPaths: ["src/a.ts"] }),
        fingerprint: "",
      }),
    });
    const report = await h.service.assessRemovalReport(ASK);

    expect(report?.kind === "assessed" && typeof report.fingerprint).toBe("string");
    // Still nothing performed. `fingerprints.issue` is called directly here, as
    // the blocked path calls it — not through `issueFingerprint`, which resolves
    // a second time for a target `assessRemoval` has already answered null for.
    expect(h.order.filter((s) => s.startsWith("git:"))).toEqual([]);
  });

  it("issues none for a refusal, which has no evidence to bind one to", async () => {
    const h = harness({
      assessRemoval: async () => ({
        kind: "refused" as const,
        isMain: true,
        busyAgents: 0,
        containsWorktrees: [],
        liveExternalSessionIds: [],
      }),
    });
    const report = await h.service.assessRemovalReport(ASK);

    expect(report?.kind === "assessed" && report.fingerprint).toBe(null);
  });

  it("says an assessment could not be made rather than reporting empty checks", async () => {
    const h = harness({ assessRemoval: async () => ({ kind: "unavailable", unreadable: ["status"] }) });

    expect(await h.service.assessRemovalReport(ASK)).toEqual({ kind: "unavailable", unreadable: ["status"] });
  });

  it("answers null when the id names nothing", async () => {
    const h = harness({ assessRemoval: async () => null });

    expect(await h.service.assessRemovalReport(ASK)).toBe(null);
  });

  it("[B3] resolves and assesses only after the forced rebuild has released", async () => {
    // Held unresolved deliberately. Inspecting the finished order would also
    // pass with no barrier at all, on any schedule where the calls happened to
    // land that way — the claim is that the rebuild GATES them (D10).
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    const h = harness({
      forceRebuild: async () => {
        await barrier;
      },
      resolve: () => {
        seen.push("resolve");
        return target();
      },
      assessRemoval: async () => {
        seen.push("assess");
        return { kind: "confirmable" as const, evidence: evidence(), fingerprint: "" };
      },
    });

    const pending = h.service.assessRemovalReport(ASK);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([]);

    release();
    await pending;
    expect(seen).toEqual(["resolve", "assess"]);
  });

  it("[B3] says the worktree is no longer registered when the barrier finds it gone", async () => {
    // D12: the coordinator's `missing` leg is a silent exit too. A rebuild whose
    // presence projection rejects publishes nothing, so the row does not depart
    // AND no reply arrives — the user's destructive request goes unanswered.
    const h = harness({ resolve: () => null });

    expect(await h.service.assessRemovalReport(ASK)).toEqual({
      kind: "unavailable",
      unreadable: ["the worktree is no longer registered"],
    });
  });

  it("[B3] assesses the registration the barrier revealed, not the one the cache held", async () => {
    // The finding itself: a remove-and-recreate at the same path with the
    // watcher rebuild still pending. Read before the barrier, the predecessor is
    // clean and the report mints no token; read after it, the replacement is
    // dirty and the token binds the evidence the user is actually shown.
    let registered = evidence();
    const h = harness({
      forceRebuild: async () => {
        registered = evidence({ dirtyPaths: ["src/replacement.ts"] });
      },
      assessRemoval: async () => ({ kind: "confirmable" as const, evidence: registered, fingerprint: "" }),
    });

    const report = await h.service.assessRemovalReport(ASK);

    expect(
      report?.kind === "assessed" && report.assessment.kind === "confirmable" && report.assessment.evidence,
    ).toEqual(evidence({ dirtyPaths: ["src/replacement.ts"] }));
    expect(report?.kind === "assessed" && typeof report.fingerprint).toBe("string");
  });
});

describe("migration runs inside the successful create", () => {
  const entries = [{ id: "i1", path: ".env", mode: "copy" as const, source: "asimov/worktree.yaml" }];
  const ports = [{ id: "p1", name: "APP", source: "asimov/worktree.yaml", port: 5183 }];
  const migration = migrationEvidence();
  const create = (over: Record<string, unknown> = {}) => ({
    repoId: REPO,
    path: "/repo/wt/new",
    afterCreate: { kind: "none" as const },
    mode: { kind: "fresh" as const, branch: "feat" },
    disposition: { kind: "free" as const },
    migration: { sourcePath: migration.source.path, source: migration.source, snapshot: migration.snapshot },
    ...over,
  });
  const outcome = (h: ReturnType<typeof harness>) =>
    h.outcomes.find((item) => (item as { verb?: string }).verb === "create") as
      | { kind: string; worktreeId?: string; migrationIndeterminate?: string; provision?: unknown }
      | undefined;

  it("orders exclusion and migration before authorization, provisioning, ports, and launch", async () => {
    const seen: string[] = [];
    const h = harness({
      gitExcludeDirFor: () => ({ gitDir: REPO, relativePath: "wt" }),
      addToGitExclude: async () => {
        seen.push("exclude");
      },
      migrateChanges: async () => {
        seen.push("migration");
        return { kind: "moved" };
      },
      authorizeDirectory: async (path) => {
        seen.push(`authorize:${path}`);
        return authorization(path);
      },
      applyProvision: async () => {
        seen.push("files");
        return [];
      },
      applyPorts: async () => {
        seen.push("ports");
        return { ports: [], warnings: [] };
      },
      afterCreate: async () => {
        seen.push("afterCreate");
      },
    });

    await h.service.createWorktree(create({ provision: entries, ports }));

    expect(seen).toEqual([
      "exclude",
      "migration",
      "authorize:/repo",
      "authorize:/repo/wt/new",
      "files",
      "ports",
      "afterCreate",
    ]);
  });

  it("forwards the host-held source evidence and destination exactly", async () => {
    const moved = vi.fn(async () => ({ kind: "moved" as const }));
    const h = harness({ migrateChanges: moved });

    await h.service.createWorktree(create());

    expect(moved).toHaveBeenCalledWith({
      sourcePath: migration.source.path,
      destinationPath: "/repo/wt/new",
      source: migration.source,
      snapshot: migration.snapshot,
    });
  });

  it.each([
    ["fresh", { kind: "fresh" as const, branch: "feat" }],
    ["detached", { kind: "fresh-detached" as const, baseRef: "HEAD" }],
    ["reuse", { kind: "reuse" as const, branch: "feat" }],
  ])("moves for a %s checkout", async (_name, mode) => {
    const moved = vi.fn(async () => ({ kind: "moved" as const }));
    const h = harness({ migrateChanges: moved });

    await h.service.createWorktree(create({ mode }));

    expect(moved).toHaveBeenCalledOnce();
    expect(outcome(h)?.kind).toBe("ok");
  });

  it("normalizes a move-only create without inventing provisioning results", async () => {
    const h = harness({
      migrateChanges: async () => ({ kind: "moved" }),
      normalizeWorktreeId: async () => "/normalized/new",
    });

    await h.service.createWorktree(create());

    expect(outcome(h)).toMatchObject({ kind: "ok", worktreeId: "/normalized/new" });
    expect(outcome(h)?.provision).toBeUndefined();
  });

  it.each([
    ["indeterminate result", async () => ({ kind: "indeterminate" as const, reason: "source no longer matches" })],
    [
      "adapter rejection",
      async () => {
        throw new Error("Git integration rejected");
      },
    ],
    [
      "non-stringifiable rejection",
      async () => {
        throw Object.create(null);
      },
    ],
    [
      "oversized rejection",
      async () => {
        throw new Error("x".repeat(2_000));
      },
    ],
  ])("keeps the checkout and stops every later step on %s", async (_name, migrateChanges) => {
    const authorize = vi.fn(async (path: string) => authorization(path));
    const applyProvision = vi.fn(async () => []);
    const applyPorts = vi.fn(async () => ({ ports: [], warnings: [] }));
    const afterCreate = vi.fn(async () => undefined);
    const h = harness({
      migrateChanges,
      authorizeDirectory: authorize,
      applyProvision,
      applyPorts,
      afterCreate,
      normalizeWorktreeId: async () => "/normalized/new",
    });

    await h.service.createWorktree(create({ provision: entries, ports, afterCreate: { kind: "newWindow" } }));

    expect(outcome(h)).toMatchObject({
      kind: "ok",
      worktreeId: "/normalized/new",
      migrationIndeterminate: expect.any(String),
    });
    expect(outcome(h)?.migrationIndeterminate?.length).toBeLessThanOrEqual(1_000);
    expect(authorize).not.toHaveBeenCalled();
    expect(applyProvision).not.toHaveBeenCalled();
    expect(applyPorts).not.toHaveBeenCalled();
    expect(afterCreate).not.toHaveBeenCalled();
  });

  it("attempts no migration when the option was declined", async () => {
    const moved = vi.fn(async () => ({ kind: "moved" as const }));
    const h = harness({ migrateChanges: moved });
    const { migration: _declined, ...declined } = create();

    await h.service.createWorktree(declined);

    expect(moved).not.toHaveBeenCalled();
    expect(outcome(h)?.kind).toBe("ok");
  });

  it.each([
    [
      "reattach",
      { kind: "reattach" as const, branch: "feat", repairPath: "/repo-wt/stale", expectedOid: "oid-1" },
    ],
    [
      "adopt",
      { kind: "adopt" as const, branch: "feat", adoptPath: "/repo-wt/stale", expectedBranchOid: "oid-1" },
    ],
  ])("refuses migration on %s before git or the adapter", async (_name, mode) => {
    const moved = vi.fn(async () => ({ kind: "moved" as const }));
    const h = harness({ migrateChanges: moved });

    await h.service.createWorktree(create({ mode }));

    expect(moved).not.toHaveBeenCalled();
    expect(h.argv).toEqual([]);
    expect(outcome(h)?.kind).toBe("error");
  });

  it("turns an exclusion rejection into migration uncertainty after create", async () => {
    const moved = vi.fn(async () => ({ kind: "moved" as const }));
    const afterCreate = vi.fn(async () => undefined);
    const h = harness({
      gitExcludeDirFor: () => ({ gitDir: REPO, relativePath: "wt" }),
      addToGitExclude: async () => {
        throw new Error("exclude is read-only");
      },
      migrateChanges: moved,
      afterCreate,
    });

    await h.service.createWorktree(create());

    expect(outcome(h)).toMatchObject({ kind: "ok", migrationIndeterminate: expect.stringContaining("read-only") });
    expect(moved).not.toHaveBeenCalled();
    expect(afterCreate).not.toHaveBeenCalled();
  });
});

describe("provisioning rides the create without ever costing it", () => {
  const entries = [
    { id: "i1", path: ".env", mode: "copy" as const, source: "asimov/worktree.yaml" },
    { id: "i2", path: "data", mode: "link" as const, source: "asimov/worktree.yaml" },
  ];
  const ports = [
    { id: "p1", name: "APP", source: "asimov/worktree.yaml", port: 5183 },
    { id: "p2", name: "DB", source: "asimov/worktree.yaml", port: 5432 },
  ];
  const create = (over: Record<string, unknown> = {}) => ({
    repoId: REPO,
    path: "/repo/wt/new",
    afterCreate: { kind: "none" as const },
    mode: { kind: "fresh" as const, branch: "feat" },
    disposition: { kind: "free" as const },
    ...over,
  });
  const okOutcome = (h: ReturnType<typeof harness>) =>
    h.outcomes.find((o) => (o as { verb?: string }).verb === "create") as
      | {
          kind: string;
          worktreeId?: string;
          provision?: {
            path: string;
            steps: readonly ProvisionStepResult[];
            ports?: readonly { id: string; outcome: { kind: string } }[];
            portWarnings?: readonly string[];
          };
        }
      | undefined;

  it("[F009] says a selection was not applied rather than dropping it into a silent success", async () => {
    // A host with no binding cannot provision. Returning `provision: undefined`
    // produced an outcome byte-identical to "the user ticked nothing", which is
    // the one answer indistinguishable from the truth — the user is told the
    // worktree was made and never told their files were not brought over.
    const h = harness({ applyProvision: undefined });
    await h.service.createWorktree(create({ provision: entries }));
    const outcome = okOutcome(h);

    expect(outcome?.kind).toBe("ok");
    expect(outcome?.provision?.steps.map((s) => s.outcome.kind)).toEqual(["failed", "failed"]);
    expect(outcome?.provision?.steps.map((s) => s.id)).toEqual(["i1", "i2"]);
  });

  it("[F015] reports the id the tree keys on, not the path git was handed", async () => {
    const h = harness({ normalizeWorktreeId: async () => "/normalized/feat" });
    await h.service.createWorktree(create({ provision: entries }));

    expect(okOutcome(h)?.provision?.path).toBe("/normalized/feat");
  });

  it("[F015] falls back to the resolved path when nothing can normalize it", async () => {
    const h = harness({ normalizeWorktreeId: async () => null });
    await h.service.createWorktree(create({ provision: entries }));

    expect(okOutcome(h)?.provision?.path).toBeTypeOf("string");
    expect(okOutcome(h)?.provision?.path).not.toBe("/normalized/feat");
  });

  it("keeps the create successful when apply REJECTS, not merely when it reports a failure", async () => {
    // The witness the plan attack asked for. A fake that RETURNS a failed step
    // exercises the happy promise path and proves nothing: the defect is a
    // rejection reaching the create body's outer arm, which reports a
    // successful git create as a create error.
    const h = harness({
      applyProvision: async () => {
        throw new Error("EIO: the walk blew up");
      },
    });
    await h.service.createWorktree(create({ provision: entries }));
    const outcome = okOutcome(h);
    expect(outcome?.kind).toBe("ok");
    // And it still answers for every entry rather than going silent.
    expect(outcome?.provision?.steps.map((s) => s.id)).toEqual(["i1", "i2"]);
  });

  it("reports one step per entry on the create's own outcome", async () => {
    const h = harness({
      applyProvision: async (_main, _wt, given) =>
        given.map((e) => ({ id: e.id, path: e.path, outcome: { kind: "copied" as const } })),
    });
    await h.service.createWorktree(create({ provision: entries }));
    expect(okOutcome(h)?.provision?.steps).toHaveLength(2);
    expect(okOutcome(h)?.provision?.path).toBe("/repo/wt/new");
  });

  it("provisions before the launch that reads what it provisioned", async () => {
    const seen: string[] = [];
    const h = harness({
      applyProvision: async () => {
        seen.push("provision");
        return [];
      },
      afterCreate: async () => {
        seen.push("afterCreate");
      },
    });
    await h.service.createWorktree(create({ provision: entries }));
    // An agent launched into the worktree must not start before its .env lands.
    expect(seen).toEqual(["provision", "afterCreate"]);
  });

  it("applies files, then ports, then launches", async () => {
    const seen: string[] = [];
    const h = harness({
      applyProvision: async () => {
        seen.push("files");
        return [];
      },
      applyPorts: async () => {
        seen.push("ports");
        return { ports: [], warnings: [] };
      },
      afterCreate: async () => {
        seen.push("afterCreate");
      },
    });

    await h.service.createWorktree(create({ provision: entries, ports }));

    expect(seen).toEqual(["files", "ports", "afterCreate"]);
  });

  it("passes one mutation-issued source and destination authorization pair to selected writes", async () => {
    const source = authorization("/repo");
    const destination = authorization("/repo/wt/new");
    const authorize = vi.fn(async (candidate: string) => (candidate === "/repo" ? source : destination));
    const applyProvision = vi.fn(async () => []);
    const applyPorts = vi.fn(async () => ({ ports: [], warnings: [] }));
    const h = harness({ authorizeDirectory: authorize, applyProvision, applyPorts });

    await h.service.createWorktree(create({ provision: entries, ports }));

    expect(authorize.mock.calls.map(([candidate]) => candidate)).toEqual(["/repo", "/repo/wt/new"]);
    expect(applyProvision).toHaveBeenCalledWith("/repo", "/repo/wt/new", entries, { source, destination });
    expect(applyPorts).toHaveBeenCalledWith({
      repoId: REPO,
      repoPath: "/repo",
      worktreePath: "/repo/wt/new",
      ports,
      authorization: destination,
    });
  });

  it("keeps the create successful and launches when destination authorization fails", async () => {
    const afterCreate = vi.fn(async () => undefined);
    const applyProvision = vi.fn(async () => []);
    const applyPorts = vi.fn(async () => ({ ports: [], warnings: [] }));
    const h = harness({
      authorizeDirectory: async (candidate) => (candidate === "/repo" ? authorization(candidate) : undefined),
      applyProvision,
      applyPorts,
      afterCreate,
    });

    await h.service.createWorktree(create({ provision: entries, ports }));
    const outcome = okOutcome(h);

    expect(outcome?.kind).toBe("ok");
    expect(outcome?.provision?.steps.map((step) => step.outcome.kind)).toEqual(["failed", "failed"]);
    expect(outcome?.provision?.ports?.map((item) => item.outcome.kind)).toEqual(["failed", "failed"]);
    expect(applyProvision).not.toHaveBeenCalled();
    expect(applyPorts).not.toHaveBeenCalled();
    expect(afterCreate).toHaveBeenCalledOnce();
  });

  it("applies and reports ports when they are the only selected items", async () => {
    const normalized = vi.fn(async () => "/normalized/feat");
    const applied = vi.fn(async (input: Parameters<NonNullable<MutationServiceDeps["applyPorts"]>>[0]) => ({
      ports: input.ports.map((item) => ({
        id: item.id,
        name: item.name,
        preview: item.port,
        outcome: { kind: "allocated" as const, port: (item.port ?? 0) + 1 },
      })),
      warnings: ["excludeFailed" as const],
    }));
    const h = harness({ applyPorts: applied, normalizeWorktreeId: normalized });

    await h.service.createWorktree(create({ ports }));
    const outcome = okOutcome(h);

    expect(applied).toHaveBeenCalledWith({
      repoId: REPO,
      repoPath: "/repo",
      worktreePath: "/repo/wt/new",
      ports,
      authorization: authorization("/repo/wt/new"),
    });
    expect(outcome?.kind).toBe("ok");
    expect(outcome?.worktreeId).toBe("/normalized/feat");
    expect(outcome?.provision?.path).toBe("/normalized/feat");
    expect(outcome?.provision?.steps).toEqual([]);
    expect(outcome?.provision?.ports?.map((item) => item.outcome.kind)).toEqual(["allocated", "allocated"]);
    expect(outcome?.provision?.portWarnings).toEqual(["excludeFailed"]);
    expect(normalized).toHaveBeenCalledTimes(1);
  });

  it("keeps create successful and reports every port when allocation rejects", async () => {
    const h = harness({
      applyPorts: async () => {
        throw new Error("lock unavailable");
      },
    });

    await h.service.createWorktree(create({ ports }));
    const outcome = okOutcome(h);

    expect(outcome?.kind).toBe("ok");
    expect(outcome?.provision?.ports?.map((item) => item.id)).toEqual(["p1", "p2"]);
    expect(outcome?.provision?.ports?.map((item) => item.outcome.kind)).toEqual(["failed", "failed"]);
  });

  it("preserves partial port success and batch warnings", async () => {
    const h = harness({
      applyPorts: async () => ({
        ports: [
          { id: "p1", name: "APP", preview: 5183, outcome: { kind: "allocated" as const, port: 5184 } },
          { id: "p2", name: "DB", preview: 5432, outcome: { kind: "failed" as const, reason: "no port" } },
        ],
        warnings: ["lockReleaseFailed" as const],
      }),
    });

    await h.service.createWorktree(create({ ports }));
    const outcome = okOutcome(h);

    expect(outcome?.provision?.ports?.map((item) => item.outcome.kind)).toEqual(["allocated", "failed"]);
    expect(outcome?.provision?.portWarnings).toEqual(["lockReleaseFailed"]);
  });

  it("provisions nothing, and reports nothing, for a create that carried no selection", async () => {
    const applied = vi.fn(async () => []);
    const appliedPorts = vi.fn(async () => ({ ports: [], warnings: [] }));
    const h = harness({ applyProvision: applied, applyPorts: appliedPorts });
    await h.service.createWorktree(create());
    expect(applied).not.toHaveBeenCalled();
    expect(appliedPorts).not.toHaveBeenCalled();
    expect(okOutcome(h)?.kind).toBe("ok");
    expect(okOutcome(h)?.provision).toBeUndefined();
  });

  it("[F017] carries the id its provisioning message will arrive under", async () => {
    // The panel merges the two messages on this id. Without it the create
    // notice had none at all, so the merge missed and every real create grew a
    // second notice with a fabricated `outcome: "ok"`.
    const h = harness({ normalizeWorktreeId: async () => "/normalized/feat" });
    await h.service.createWorktree(create({ provision: entries }));
    const outcome = okOutcome(h);

    expect(outcome?.worktreeId).toBe("/normalized/feat");
    expect(outcome?.worktreeId).toBe(outcome?.provision?.path);
  });

  it("[F023] never reads the tree for a create that provisions nothing", async () => {
    const normalized = vi.fn(async () => "/normalized/feat");
    const h = harness({ normalizeWorktreeId: normalized });
    await h.service.createWorktree(create());

    expect(normalized).not.toHaveBeenCalled();
    expect(okOutcome(h)?.worktreeId).toBeUndefined();
  });

  it("[F023] keeps the create successful when normalizing REJECTS", async () => {
    // It was the one unguarded await left in the body D1 exists to protect: a
    // rejection here reached the outer arm and reported a successful git create
    // as a create error, having already made the worktree.
    const h = harness({
      normalizeWorktreeId: async () => {
        throw new Error("EIO: the registry read blew up");
      },
    });
    await h.service.createWorktree(create({ provision: entries }));
    const outcome = okOutcome(h);

    expect(outcome?.kind).toBe("ok");
    expect(outcome?.provision?.path).toBe("/repo/wt/new");
    expect(outcome?.worktreeId).toBe("/repo/wt/new");
  });

  it("does not provision a repair, which brings nothing over", async () => {
    const applied = vi.fn(async () => []);
    const h = harness({ applyProvision: applied });
    await h.service.createWorktree(
      create({
        provision: entries,
        mode: { kind: "reattach" as const, branch: "feat", repairPath: "/repo-wt/stale", expectedOid: "oid-1" },
      }),
    );
    expect(applied).not.toHaveBeenCalled();
  });
});
