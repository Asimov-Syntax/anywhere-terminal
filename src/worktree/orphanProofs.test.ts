import { describe, expect, it } from "vitest";
import {
  LOCK_AGE_MS,
  type OrphanProofDeps,
  type ProofSessionRecord,
  readOrphanProofs,
  resolveDefaultBranch,
} from "./orphanProofs";

const NOW = 1_000_000_000_000;
const WT = "/repo/wt-a";

/** Every read fails unless a case supplies it — a proof must never pass by default. */
function deps(over: Partial<OrphanProofDeps> = {}): OrphanProofDeps {
  return {
    git: async () => ({ code: 128, stdout: Buffer.from(""), timedOut: false }),
    lockMtime: async () => {
      throw new Error("ENOENT");
    },
    gitDir: async () => "/repo/.git/worktrees/wt-a",
    now: () => NOW,
    ...over,
  };
}

/** A git fake answering from a table keyed on the joined argv. */
function gitTable(
  replies: Record<string, { code: number; stdout?: string }>,
  seen?: string[][],
): OrphanProofDeps["git"] {
  return async (args) => {
    seen?.push([...args]);
    const reply = replies[args.join(" ")];
    return {
      code: reply?.code ?? 128,
      stdout: Buffer.from(reply?.stdout ?? ""),
      timedOut: false,
    };
  };
}

const record = (over: Partial<ProofSessionRecord> = {}): ProofSessionRecord => ({
  cwd: WT,
  alive: true,
  ...over,
});

describe("the lock-age proof", () => {
  it("does not apply to a worktree that is not locked", async () => {
    // Not "passed": there is no lock, so the question of its age never arose,
    // and a pass would claim a reading somebody took.
    const proofs = await readOrphanProofs({ path: WT, locked: false, sessions: { ok: true, value: [] } }, deps());

    expect(proofs.lockAged).toBe("notApplicable");
  });

  it("passes for a lock older than the threshold", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: true, sessions: { ok: true, value: [] } },
      deps({ lockMtime: async () => NOW - LOCK_AGE_MS - 1 }),
    );

    expect(proofs.lockAged).toBe("passed");
  });

  it("fails for a lock younger than the threshold", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: true, sessions: { ok: true, value: [] } },
      deps({ lockMtime: async () => NOW - 1000 }),
    );

    expect(proofs.lockAged).toBe("failed");
  });

  it("is unproven when the lock file cannot be read", async () => {
    // A lock we cannot age is not a stale lock, and it is not a fresh one.
    const proofs = await readOrphanProofs({ path: WT, locked: true, sessions: { ok: true, value: [] } }, deps());

    expect(proofs.lockAged).toBe("unproven");
  });

  it("reads the lock from the git dir git names, inside the worktree", async () => {
    const asked: string[] = [];
    await readOrphanProofs(
      { path: WT, locked: true, sessions: { ok: true, value: [] } },
      deps({
        gitDir: async () => "/repo/.git/worktrees/wt-a-2",
        lockMtime: async (p) => {
          asked.push(p);
          return NOW;
        },
      }),
    );

    // Not `<repo>/.git/worktrees/<basename>` — git disambiguates colliding
    // names, so a derived path names the OTHER worktree's lock.
    expect(asked).toEqual(["/repo/.git/worktrees/wt-a-2/locked"]);
  });
});

describe("the ownership proof", () => {
  it("passes when the registry names no record rooted here", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, sessions: { ok: true, value: [record({ cwd: "/repo/wt-b" })] } },
      deps(),
    );

    expect(proofs.ownerGone).toBe("passed");
  });

  it("passes when every record rooted here is dead", async () => {
    // The distinction the whole reader change exists for: a crashed session
    // left a record behind, and that record is evidence nobody is here.
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, sessions: { ok: true, value: [record({ alive: false })] } },
      deps(),
    );

    expect(proofs.ownerGone).toBe("passed");
  });

  it("fails when one record rooted here is alive", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, sessions: { ok: true, value: [record({ alive: false }), record()] } },
      deps(),
    );

    expect(proofs.ownerGone).toBe("failed");
  });

  it("counts a record in a SUBDIRECTORY of the worktree as rooted here", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, sessions: { ok: true, value: [record({ cwd: `${WT}/packages/app` })] } },
      deps(),
    );

    expect(proofs.ownerGone).toBe("failed");
  });

  it("is not fooled by a sibling whose path merely starts the same way", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, sessions: { ok: true, value: [record({ cwd: "/repo/wt-a-2" })] } },
      deps(),
    );

    expect(proofs.ownerGone).toBe("passed");
  });

  it("is unproven when the registry could not be read", async () => {
    const proofs = await readOrphanProofs({ path: WT, locked: false, sessions: { ok: false } }, deps());

    expect(proofs.ownerGone).toBe("unproven");
  });
});

describe("the merge proof", () => {
  const merged = {
    "symbolic-ref --short refs/remotes/origin/HEAD": { code: 0, stdout: "origin/main\n" },
    "rev-parse --verify --quiet refs/heads/main": { code: 0, stdout: "abc\n" },
    "merge-base --is-ancestor feat main": { code: 0 },
  };

  it("passes when the branch is an ancestor of the default", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, branch: "feat", sessions: { ok: true, value: [] } },
      deps({ git: gitTable(merged) }),
    );

    expect(proofs.branchMerged).toBe("passed");
  });

  it("fails on exit 1, which is the one code that means NOT merged", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, branch: "feat", sessions: { ok: true, value: [] } },
      deps({ git: gitTable({ ...merged, "merge-base --is-ancestor feat main": { code: 1 } }) }),
    );

    expect(proofs.branchMerged).toBe("failed");
  });

  it("is unproven on any OTHER non-zero exit, 128 included", async () => {
    // git exits 128 with `fatal: Not a valid object name` for a ref it cannot
    // resolve (probed on 2.50.1). A `code !== 0` test would read that as "not
    // merged" — a fact, from an error — and "not merged" is the answer that
    // withholds a destructive option.
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, branch: "feat", sessions: { ok: true, value: [] } },
      deps({ git: gitTable({ ...merged, "merge-base --is-ancestor feat main": { code: 128 } }) }),
    );

    expect(proofs.branchMerged).toBe("unproven");
  });

  it("does not apply to a worktree with no branch", async () => {
    // Detached or bare: there is no branch for the question to be about, and
    // `unproven` would claim a comparison was attempted (design.md D5).
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, sessions: { ok: true, value: [] } },
      deps({ git: gitTable(merged) }),
    );

    expect(proofs.branchMerged).toBe("notApplicable");
  });

  it("does not apply when the branch IS the default branch", async () => {
    // A branch is trivially an ancestor of itself, so `passed` here would say
    // the default branch is merged and offer to delete it (§ 5 rule 4).
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, branch: "main", sessions: { ok: true, value: [] } },
      deps({ git: gitTable(merged) }),
    );

    expect(proofs.branchMerged).toBe("notApplicable");
  });

  it("is unproven when no default branch resolves", async () => {
    const proofs = await readOrphanProofs(
      { path: WT, locked: false, branch: "feat", sessions: { ok: true, value: [] } },
      deps({ git: gitTable({}) }),
    );

    expect(proofs.branchMerged).toBe("unproven");
  });

  it("never issues a fetch, whatever the ladder does", async () => {
    // The rule with the most to lose: a fetch answers a question the user did
    // not ask, over a network they did not choose to use.
    const seen: string[][] = [];
    await readOrphanProofs(
      { path: WT, locked: false, branch: "feat", sessions: { ok: true, value: [] } },
      deps({ git: gitTable({}, seen) }),
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((args) => args.includes("fetch") || args.includes("remote"))).toBe(false);
  });
});

describe("resolveDefaultBranch", () => {
  it("prefers what origin/HEAD names", async () => {
    const name = await resolveDefaultBranch(
      WT,
      gitTable({
        "symbolic-ref --short refs/remotes/origin/HEAD": { code: 0, stdout: "origin/trunk\n" },
        "rev-parse --verify --quiet refs/heads/trunk": { code: 0, stdout: "abc\n" },
      }),
    );

    expect(name).toBe("trunk");
  });

  it("falls back to init.defaultBranch, but only when that branch actually exists here", async () => {
    // `init.defaultBranch` is a preference about repositories yet to be
    // created. It says nothing about this one, so it is a candidate and not
    // an answer.
    expect(
      await resolveDefaultBranch(
        WT,
        gitTable({
          "config init.defaultBranch": { code: 0, stdout: "trunk\n" },
          "rev-parse --verify --quiet refs/heads/trunk": { code: 1 },
          "rev-parse --verify --quiet refs/heads/main": { code: 0, stdout: "abc\n" },
        }),
      ),
    ).toBe("main");
  });

  it("falls through main to master", async () => {
    expect(
      await resolveDefaultBranch(
        WT,
        gitTable({
          "rev-parse --verify --quiet refs/heads/main": { code: 1 },
          "rev-parse --verify --quiet refs/heads/master": { code: 0, stdout: "abc\n" },
        }),
      ),
    ).toBe("master");
  });

  it("names nothing when no candidate exists as a local ref", async () => {
    expect(await resolveDefaultBranch(WT, gitTable({}))).toBeUndefined();
  });
});
