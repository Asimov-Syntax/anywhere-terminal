// src/extension.worktreeMutations.test.ts — that PRODUCTION supplies the five
// mutating capabilities at all.
//
// Round-1 B1: the host declared all five as optional and the only production
// factory returned the read-only set, so Lock and Remove reached an absent
// capability and did nothing, and Create and Prune had no shipped entry path.
// Every other test in this change injects spy capabilities, which is exactly
// why none of them could see it. This one asserts against what `activate`
// actually hands the host.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeActions, WorktreeSurface } from "./providers/WorktreeHost";
import type { BranchDeleteRequest } from "./types/messages";
import type { RemovalAssessment } from "./worktree/worktreeBlockers";
import type { MutationOutcome, MutationServiceDeps } from "./worktree/worktreeMutationService";

const received: {
  actions?: WorktreeActions;
  deps?: MutationServiceDeps;
  reports: { outcome: MutationOutcome; origin: WorktreeSurface | undefined }[];
} = { reports: [] };

/** Set by a test that needs the listing to read as trustworthy. */
let forceUndegraded = false;
/**
 * Observations `observation()` hands out in order, so a test can move the tree
 * between the two reads `observeAfter` makes. Empty means "it never moved".
 */
let observations: number[] = [];

vi.mock("./worktree/worktreeMutationService", async (importOriginal) => {
  const real = await importOriginal<typeof import("./worktree/worktreeMutationService")>();
  return {
    ...real,
    createWorktreeMutationService: (deps: MutationServiceDeps) => {
      // `report` is the far end of the routing D17 describes. Recording it here
      // is the only way to see whether the argument survived the whole path.
      const wrapped: MutationServiceDeps = {
        ...deps,
        report: (outcome, origin) => {
          received.reports.push({ outcome, origin });
          deps.report(outcome, origin);
        },
      };
      received.deps = wrapped;
      return real.createWorktreeMutationService(wrapped);
    },
  };
});

vi.mock("./providers/WorktreeHost", async (importOriginal) => {
  const real = await importOriginal<typeof import("./providers/WorktreeHost")>();
  return {
    ...real,
    createWorktreeHost: (options: { actions: WorktreeActions }) => {
      received.actions = options.actions;
      const host = real.createWorktreeHost(options as never);
      if (!forceUndegraded) {
        return host;
      }
      // The ONLY substitution: with no repo in the mock's tree every id reads
      // as unobserved, and `observeAfter` short-circuits before it ever stats.
      // Everything else below is what `activate` really supplies.
      return {
        ...host,
        mutationBindings: () => ({ ...host.mutationBindings(), observation: () => observations.shift() ?? 1 }),
      };
    },
  };
});

beforeEach(() => {
  received.actions = undefined;
  received.deps = undefined;
  received.reports = [];
  forceUndegraded = false;
  observations = [];
  vi.resetModules();
});

/** Runs `activate` against the mock host, exactly as the B1 test does. */
async function activateExtension(): Promise<void> {
  const { activate } = await import("./extension");
  const vscode = await import("./test/__mocks__/vscode");
  vscode.__resetAll();
  (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
  const win = vscode.window as Record<string, unknown>;
  win.state ??= { focused: true, active: true };
  win.onDidChangeWindowState ??= () => ({ dispose: () => {} });
  win.tabGroups ??= { all: [], onDidChangeTabs: () => ({ dispose: () => {} }) };
  await activate({
    extensionUri: { fsPath: "/mock/extension" },
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {}, keys: () => [] },
    workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
    globalStorageUri: { fsPath: "/mock/storage" },
    storageUri: { fsPath: "/mock/workspace-storage" },
    extensionPath: "/mock/extension",
    logUri: { fsPath: "/mock/log" },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    environmentVariableCollection: { replace: () => {}, append: () => {}, prepend: () => {}, clear: () => {} },
  } as never);
}

describe("the shipped extension supplies its mutating capabilities", () => {
  it("gives the host all five, not only the read-only actions", async () => {
    const { activate } = await import("./extension");
    const vscode = await import("./test/__mocks__/vscode");
    vscode.__resetAll();
    // The mock's `extensions` carries only `getExtension`; the git-decoration
    // provider subscribes to `onDidChange`. Supplied here rather than in the
    // shared mock, because this is the only test that runs `activate` itself.
    (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
    const win = vscode.window as Record<string, unknown>;
    win.state ??= { focused: true, active: true };
    win.onDidChangeWindowState ??= () => ({ dispose: () => {} });
    win.tabGroups ??= { all: [], onDidChangeTabs: () => ({ dispose: () => {} }) };

    await activate({
      extensionUri: { fsPath: "/mock/extension" },
      subscriptions: [],
      globalState: { get: () => undefined, update: async () => {}, keys: () => [] },
      workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
      globalStorageUri: { fsPath: "/mock/storage" },
      storageUri: { fsPath: "/mock/workspace-storage" },
      extensionPath: "/mock/extension",
      logUri: { fsPath: "/mock/log" },
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
      environmentVariableCollection: { replace: () => {}, append: () => {}, prepend: () => {}, clear: () => {} },
    } as never);

    // Named individually: a `toBeDefined` on the object would pass on the very
    // shape B1 found, where the object existed and the five keys did not.
    expect(typeof received.actions?.createWorktree).toBe("function");
    expect(typeof received.actions?.removeWorktree).toBe("function");
    expect(typeof received.actions?.lockWorktree).toBe("function");
    expect(typeof received.actions?.unlockWorktree).toBe("function");
    expect(typeof received.actions?.pruneRepo).toBe("function");
    // Round-10 B8: the coordinator's last check before a destructive command is
    // only as real as production supplying what it asks. The service is built
    // lazily, so something has to ask for it first.
    received.actions?.reconcileFingerprints?.([]);
    expect(typeof received.deps?.observation).toBe("function");
  });
});

describe("the shipped removal assessment payload", () => {
  const mergeEvidence = {
    branch: "feature",
    branchOid: "1".repeat(40),
    base: "main",
    baseOid: "2".repeat(40),
  };

  function assessment(branchMerged: "passed" | "unproven"): Exclude<RemovalAssessment, { kind: "unavailable" }> {
    return {
      kind: "confirmable",
      evidence: {
        dirtyPaths: [],
        untrackedPaths: [],
        paneIds: [],
        externalSessionIds: [],
        locked: false,
        lockReason: null,
        notApplicable: [],
        ignored: { kind: "measured", entries: 0, bytes: 0 },
        proofs: {
          lockAged: "unproven",
          ownerGone: "unproven",
          branchMerged,
          ...(branchMerged === "passed" ? { mergeEvidence } : {}),
        },
      },
    };
  }

  it("emits the recorded merge evidence only when the proof passed", async () => {
    await activateExtension();
    received.actions?.reconcileFingerprints?.([]);
    const posted: unknown[] = [];
    const origin: WorktreeSurface = { isReady: () => true, post: (message) => posted.push(message) };
    const report = received.deps?.report;
    expect(report).toBeInstanceOf(Function);

    report?.(
      {
        kind: "blocked",
        verb: "remove",
        repoId: "/repo/.git",
        worktreeId: "/repo-feature",
        assessment: assessment("passed"),
        fingerprint: "fp-1",
      },
      origin,
    );
    report?.(
      {
        kind: "blocked",
        verb: "remove",
        repoId: "/repo/.git",
        worktreeId: "/repo-other",
        assessment: assessment("unproven"),
        fingerprint: "fp-2",
      },
      origin,
    );

    expect(posted[0]).toMatchObject({
      type: "worktreeMutationResult",
      result: {
        kind: "blocked",
        assessment: {
          branchDelete: {
            branch: "feature",
            branchOid: mergeEvidence.branchOid,
            defaultBranch: "main",
            defaultOid: mergeEvidence.baseOid,
          },
        },
      },
    });
    expect(posted[1]).not.toHaveProperty("result.assessment.branchDelete");
  });
});

describe("what the shipped observation makes of an unreadable path", () => {
  // The classifier is unit-tested next to its own definition. What no unit test
  // could see is whether PRODUCTION calls it — the wiring is the whole of B13.
  const target = { repoId: "/repo/.git", worktreeId: "/repo-wt/raw" };

  async function observeWith(reject: NodeJS.ErrnoException | null) {
    vi.resetModules();
    forceUndegraded = true;
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const real = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...real,
        default: { ...real, stat: async () => (reject === null ? {} : Promise.reject(reject)) },
        stat: async () => (reject === null ? {} : Promise.reject(reject)),
      };
    });
    await activateExtension();
    // The service is built lazily; the deps do not exist until something asks
    // for them. This is the cheapest capability that does.
    received.actions?.reconcileFingerprints?.([]);
    const observe = received.deps?.observeAfter;
    expect(observe).toBeInstanceOf(Function);
    return await observe?.(target, "/repo-wt/raw");
  }

  it("does not call an unreadable directory a removed one", async () => {
    expect(await observeWith({ code: "EACCES" } as NodeJS.ErrnoException)).toBeNull();
  });

  it("still calls an absent directory absent", async () => {
    const seen = await observeWith({ code: "ENOENT" } as NodeJS.ErrnoException);
    expect(seen).toMatchObject({ existsOnDisk: false });
  });

  it("still calls a present directory present", async () => {
    expect(await observeWith(null)).toMatchObject({ existsOnDisk: true });
  });

  it("answers nothing when the tree moves between the existence and registration reads", async () => {
    // Round-9 B8: the two reads exist precisely because registration and
    // filesystem can disagree. Taken from different observations they are not
    // a disagreement, they are two unrelated facts — so the pair is discarded
    // rather than classified.
    observations = [7, 8];
    expect(await observeWith(null)).toBeNull();
  });
});

describe("an outcome comes back to the surface that started it (design.md D17)", () => {
  // Round-3 B1: production posted results straight at two providers, so every
  // editor surface got nothing and the origin argument was decoration. Each
  // capability is driven through the object `activate` really hands the host,
  // and the assertion is on the far end of the routing, not on the call.
  const REPO = "/repo/.git";
  const WT = "/repo-wt/raw";

  async function drive(run: (a: WorktreeActions) => Promise<void> | void): Promise<void> {
    await activateExtension();
    const actions = received.actions;
    expect(actions).toBeDefined();
    if (actions) {
      await run(actions);
    }
  }

  /** A stand-in for one of the three real surfaces — the routing sees an object. */
  function surface(name: string): WorktreeSurface & { name: string; posted: unknown[] } {
    const posted: unknown[] = [];
    return { name, posted, isReady: () => true, post: (m) => posted.push(m) };
  }

  for (const name of ["sidebar", "panel", "editor"]) {
    it(`routes every mutating capability's outcome back to the ${name} that asked`, async () => {
      const origin = surface(name);
      await drive(async (a) => {
        await a.removeWorktree?.({ repoId: REPO, worktreeId: WT, origin }, undefined);
        await a.lockWorktree?.({ repoId: REPO, worktreeId: WT, origin }, undefined);
        await a.unlockWorktree?.({ repoId: REPO, worktreeId: WT, origin });
        await a.pruneRepo?.(REPO, 0, origin);
        await a.createWorktree?.({
          repoId: REPO,
          path: "/repo-wt/new",
          mode: { kind: "fresh", branch: "feat" },
          disposition: { kind: "free" },
          afterCreate: { kind: "none" },
          origin,
        });
      });
      // Every verb reported, and every report carried the surface it came from.
      expect(received.reports.map((r) => r.outcome.verb).sort()).toEqual([
        "create",
        "lock",
        "prune",
        "remove",
        "unlock",
      ]);
      expect(received.reports.map((r) => r.origin)).toEqual(received.reports.map(() => origin));
      // And it actually arrived: the host posted every one of them there.
      expect(origin.posted).toHaveLength(received.reports.length);
    });
  }

  it("still reports when no surface claims the action", async () => {
    await drive(async (a) => {
      await a.pruneRepo?.(REPO, 0, undefined);
    });
    expect(received.reports).toHaveLength(1);
    expect(received.reports[0]?.origin).toBeUndefined();
  });
});

// [3_2] Production supplies the `deleteBranch` binding the mutation service
// only DECLARES (task 2_2) — through the same shared git runner every other
// worktree read and write goes through, never a parallel invocation path.
describe("the shipped branch-delete binding (design.md D2)", () => {
  const request: BranchDeleteRequest = {
    branch: "feature",
    expectedBranchOid: "3".repeat(40),
    defaultBranch: "main",
    expectedDefaultOid: "4".repeat(40),
    fingerprint: "fp-branch",
  };

  it("maps the redeemed evidence's own field names into the guard, through the same runner discovery uses", async () => {
    let deleteBranchRunner: unknown;
    let discoveryRunner: unknown;
    vi.doMock("./worktree/deleteBranch", async (importOriginal) => {
      const real = await importOriginal<typeof import("./worktree/deleteBranch")>();
      return {
        ...real,
        deleteBranch: async (runner: unknown, repoPath: string, evidence: unknown) => {
          deleteBranchRunner = runner;
          expect(repoPath).toBe("/repo");
          // The SERVICE'S own field names (`expectedBranchOid`, `expectedDefaultOid`),
          // carried into the shape `deleteBranch` verifies against — a swap here
          // would silently check the wrong ref against the wrong OID.
          expect(evidence).toEqual({
            branch: "feature",
            branchOid: request.expectedBranchOid,
            defaultBranch: "main",
            defaultOid: request.expectedDefaultOid,
          });
          return { kind: "deleted", branch: "feature" };
        },
      };
    });
    vi.doMock("./worktree/WorktreeDiscovery", async (importOriginal) => {
      const real = await importOriginal<typeof import("./worktree/WorktreeDiscovery")>();
      return {
        ...real,
        listRepoWorktrees: async (_repoPath: string, deps: { runner: unknown }) => {
          discoveryRunner = deps.runner;
          return { degraded: undefined, worktrees: [] };
        },
      };
    });
    await activateExtension();
    received.actions?.reconcileFingerprints?.([]);
    await received.deps?.listWorktrees?.("/repo");
    const outcome = await received.deps?.deleteBranch?.("/repo", request);
    expect(outcome).toEqual({ kind: "deleted", branch: "feature" });
    expect(deleteBranchRunner).toBeDefined();
    // Identity, not merely shape: a second git-runner construction here would
    // be a parallel invocation path the design ruled out (D2).
    expect(deleteBranchRunner).toBe(discoveryRunner);
  });

  it("never runs the guarded delete for an opt-in the service redeems nothing for", async () => {
    let called = false;
    vi.doMock("./worktree/deleteBranch", () => ({ deleteBranch: async () => (called = true) }));
    await activateExtension();
    received.actions?.reconcileFingerprints?.([]);
    // A target the tree does not register: the service refuses before it ever
    // redeems a fingerprint, let alone reads the branch opt-in riding it.
    await received.actions?.removeWorktree?.({ repoId: "/repo/.git", worktreeId: "/repo-missing" }, "fp-1", request);
    expect(called).toBe(false);
  });

  it("never runs the guarded delete when removal carries no opt-in at all", async () => {
    let called = false;
    vi.doMock("./worktree/deleteBranch", () => ({ deleteBranch: async () => (called = true) }));
    await activateExtension();
    received.actions?.reconcileFingerprints?.([]);
    await received.actions?.removeWorktree?.({ repoId: "/repo/.git", worktreeId: "/repo-missing" }, "fp-1", undefined);
    expect(called).toBe(false);
  });
});
