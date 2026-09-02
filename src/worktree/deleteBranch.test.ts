import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type DeleteBranchEvidence, type DeleteBranchFsDeps, deleteBranch } from "./deleteBranch";
import {
  createGitCommandRunner,
  type GitCommandResult,
  type GitCommandRunner,
  type GitRunOptions,
} from "./gitCommandRunner";

const EVIDENCE: DeleteBranchEvidence = {
  branch: "feature",
  branchOid: "1".repeat(40),
  defaultBranch: "main",
  defaultOid: "2".repeat(40),
};
const COMMON = "/repo/.git";
const ADMIN = `${COMMON}/worktrees/feature-admin`;
const MAIN = `worktree /repo\0HEAD ${"a".repeat(40)}\0branch refs/heads/main\0\0`;
const LINKED = `worktree /repo-feature\0HEAD ${"b".repeat(40)}\0detached\0\0`;

function result(stdout = "", code = 0): GitCommandResult {
  return {
    code,
    stdout: Buffer.from(stdout),
    stderr: code === 0 ? "" : "ref changed",
    timedOut: false,
    failedToSpawn: false,
  };
}

function missing(absPath: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`missing ${absPath}`), { code: "ENOENT" });
}

interface HarnessOptions {
  listing?: GitCommandResult;
  common?: GitCommandResult;
  defaultBranch?: string;
  objectFormat?: "sha1" | "sha256";
  transaction?: GitCommandResult;
  files?: Record<string, string>;
  directories?: readonly string[];
  entries?: Record<string, readonly string[]>;
  errors?: Record<string, string>;
  statErrors?: Record<string, string>;
}

function runner(options: HarnessOptions = {}) {
  const calls: Array<{ args: readonly string[]; cwd: string; options?: GitRunOptions }> = [];
  const events: string[] = [];
  const run = vi.fn(async (args: readonly string[], cwd: string, runOptions?: GitRunOptions) => {
    calls.push({ args, cwd, options: runOptions });
    events.push(`git:${args.join(" ")}`);
    if (args[0] === "worktree") {
      return options.listing ?? result(MAIN);
    }
    if (args[0] === "rev-parse" && args[1] === "--git-common-dir") {
      return options.common ?? result(".git\n");
    }
    if (args[0] === "rev-parse" && args[1] === "--show-object-format=storage") {
      return result(`${options.objectFormat ?? "sha1"}\n`);
    }
    if (args[0] === "symbolic-ref") {
      return result(`origin/${options.defaultBranch ?? "main"}\n`);
    }
    if (args[0] === "config") {
      return result("", 1);
    }
    if (args[0] === "rev-parse") {
      return result("a\n");
    }
    if (args[0] === "update-ref") {
      return options.transaction ?? result();
    }
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  });

  const files = new Map(Object.entries(options.files ?? {}));
  const directories = new Set([COMMON, ...(options.directories ?? [])]);
  const entries = new Map(Object.entries(options.entries ?? {}));
  const errors = new Map(Object.entries(options.errors ?? {}));
  const statErrors = new Map(Object.entries(options.statErrors ?? {}));
  function fail(absPath: string, from = errors): never {
    const code = from.get(absPath);
    if (code !== undefined) {
      throw Object.assign(new Error(`${code}: ${absPath}`), { code });
    }
    throw missing(absPath);
  }
  const fs: DeleteBranchFsDeps = {
    readdir: async (absPath) => {
      events.push(`fs:readdir:${absPath}`);
      return entries.get(absPath) ?? fail(absPath);
    },
    lstat: async (absPath) => {
      events.push(`fs:lstat:${absPath}`);
      if (errors.has(absPath)) {
        fail(absPath);
      }
      if (directories.has(absPath)) {
        return { isDirectory: () => true };
      }
      if (files.has(absPath)) {
        return { isDirectory: () => false };
      }
      return fail(absPath);
    },
    stat: async (absPath) => {
      events.push(`fs:stat:${absPath}`);
      if (statErrors.has(absPath)) {
        fail(absPath, statErrors);
      }
      if (errors.has(absPath)) {
        fail(absPath);
      }
      if (directories.has(absPath) || files.has(absPath)) {
        return {};
      }
      return fail(absPath);
    },
    readFile: async (absPath) => {
      events.push(`fs:read:${absPath}`);
      if (errors.has(absPath)) {
        fail(absPath);
      }
      return files.get(absPath) ?? fail(absPath);
    },
  };
  return { calls, events, git: { run } as GitCommandRunner, fs };
}

function linked(state: Record<string, string> = {}, over: Partial<HarnessOptions> = {}) {
  return runner({
    listing: result(MAIN + LINKED),
    entries: { [`${COMMON}/worktrees`]: ["feature-admin"] },
    directories: [ADMIN],
    files: { [`${ADMIN}/gitdir`]: "/repo-feature/.git\n", ...state },
    ...over,
  });
}

async function expectRefused(
  h: ReturnType<typeof runner>,
  reason: "branch-in-use" | "default-branch" | "holders-unavailable" | "refs-moved",
) {
  await expect(deleteBranch(h.git, "/repo", EVIDENCE, h.fs)).resolves.toEqual({ kind: "refused", reason });
  if (reason !== "refs-moved") {
    expect(h.calls.some((call) => call.args[0] === "update-ref")).toBe(false);
  }
}

describe("deleteBranch", () => {
  it("deletes only through one transaction guarded by both recorded OIDs", async () => {
    const h = runner();

    await expect(deleteBranch(h.git, "/repo", EVIDENCE, h.fs)).resolves.toEqual({
      kind: "deleted",
      branch: "feature",
    });

    const transaction = h.calls.find((call) => call.args[0] === "update-ref");
    expect(transaction?.args).toEqual(["update-ref", "--stdin"]);
    expect(transaction?.options?.input).toBe(
      `start\nverify refs/heads/main ${EVIDENCE.defaultOid}\noption no-deref\ndelete refs/heads/feature ${EVIDENCE.branchOid}\ncommit\n`,
    );
    expect(h.calls.some((call) => call.args.includes("-D") || call.args[0] === "branch")).toBe(false);
  });

  it("preserves whitespace in a real separate common-git-directory path", async () => {
    const root = mkdtempSync(join(tmpdir(), "delete-branch-common-space-"));
    const worktree = join(root, "worktree");
    const common = join(root, "admin ");
    try {
      execFileSync("git", ["init", "-q", "-b", "main", `--separate-git-dir=${common}`, worktree]);
      const git = (...args: string[]) => execFileSync("git", args, { cwd: worktree, encoding: "utf8" }).trim();
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      writeFileSync(join(worktree, "tracked"), "content");
      git("add", "tracked");
      git("commit", "-qm", "initial");
      const oid = git("rev-parse", "HEAD");
      git("branch", "feature");
      mkdirSync(join(common, "rebase-merge"));
      writeFileSync(join(common, "rebase-merge", "head-name"), "refs/heads/feature\n");

      await expect(
        deleteBranch(createGitCommandRunner(), worktree, {
          branch: "feature",
          branchOid: oid,
          defaultBranch: "main",
          defaultOid: oid,
        }),
      ).resolves.toEqual({ kind: "refused", reason: "branch-in-use" });
      expect(git("rev-parse", "--verify", "refs/heads/feature")).toBe(oid);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not dereference a substituted symbolic ref into another branch", async () => {
    const repo = mkdtempSync(join(tmpdir(), "delete-branch-no-deref-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
      git("init", "-q", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      writeFileSync(join(repo, "tracked"), "content");
      git("add", "tracked");
      git("commit", "-qm", "initial");
      const oid = git("rev-parse", "HEAD");
      git("branch", "victim");
      git("symbolic-ref", "refs/heads/feature", "refs/heads/victim");

      await expect(
        deleteBranch(createGitCommandRunner(), repo, {
          branch: "feature",
          branchOid: oid,
          defaultBranch: "main",
          defaultOid: oid,
        }),
      ).resolves.toEqual({ kind: "deleted", branch: "feature" });

      expect(git("rev-parse", "--verify", "refs/heads/victim")).toBe(oid);
      expect(() => git("rev-parse", "--verify", "--quiet", "refs/heads/feature")).toThrow();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("leaves no awaited work between the full holder scan and the transaction", async () => {
    const h = runner();

    await deleteBranch(h.git, "/repo", EVIDENCE, h.fs);

    expect(h.events.indexOf("git:symbolic-ref --quiet refs/remotes/origin/HEAD")).toBeLessThan(
      h.events.indexOf("git:worktree list --porcelain -z"),
    );
    expect(h.events.slice(-2)).toEqual([`fs:read:${COMMON}/rebase-merge/update-refs`, "git:update-ref --stdin"]);
  });

  it("refuses a symbolic HEAD holder", async () => {
    const h = runner({
      listing: result(`${MAIN}worktree /repo-feature\0HEAD ${"b".repeat(40)}\0branch refs/heads/feature\0\0`),
    });
    await expectRefused(h, "branch-in-use");
  });

  for (const [name, state] of [
    ["rebase-merge", { [`${ADMIN}/rebase-merge/head-name`]: "refs/heads/feature\n" }],
    ["rebase-apply", { [`${ADMIN}/rebase-apply/head-name`]: "refs/heads/feature\n" }],
    ["bisect", { [`${ADMIN}/BISECT_START`]: "feature\n", [`${ADMIN}/BISECT_LOG`]: "git bisect start\n" }],
    [
      "update-refs",
      {
        [`${ADMIN}/rebase-merge/update-refs`]: `refs/heads/feature\n${"3".repeat(40)}\n${"4".repeat(40)}\n`,
      },
    ],
  ] as const) {
    it(`refuses a ${name} holder in another worktree`, async () => {
      await expectRefused(linked(state), "branch-in-use");
    });
  }

  for (const statePath of ["rebase-merge/head-name", "rebase-apply/head-name"]) {
    it(`does not treat detached HEAD in ${statePath} as a holder`, async () => {
      const h = linked({ [`${ADMIN}/${statePath}`]: "detached HEAD\n" });
      await expect(deleteBranch(h.git, "/repo", EVIDENCE, h.fs)).resolves.toEqual({
        kind: "deleted",
        branch: "feature",
      });
    });
  }

  it("does not treat rebase-apply patch application as a branch holder", async () => {
    const h = linked({
      [`${ADMIN}/rebase-apply/head-name`]: "refs/heads/feature\n",
      [`${ADMIN}/rebase-apply/applying`]: "",
    });
    await expect(deleteBranch(h.git, "/repo", EVIDENCE, h.fs)).resolves.toEqual({
      kind: "deleted",
      branch: "feature",
    });
  });

  it("normalizes a full local ref recorded by bisect", async () => {
    const h = linked({
      [`${ADMIN}/BISECT_START`]: "refs/heads/feature\n",
      [`${ADMIN}/BISECT_LOG`]: "git bisect start\n",
    });
    await expectRefused(h, "branch-in-use");
  });

  it("follows applying-marker symlinks like Git before classifying rebase-apply", async () => {
    const applying = `${ADMIN}/rebase-apply/applying`;
    const h = linked(
      {
        [`${ADMIN}/rebase-apply/head-name`]: "refs/heads/feature\n",
        [applying]: "symlink target",
      },
      { statErrors: { [applying]: "ENOENT" } },
    );
    await expectRefused(h, "branch-in-use");
  });

  it("does not treat a stale BISECT_START without BISECT_LOG as a holder", async () => {
    const h = linked({ [`${ADMIN}/BISECT_START`]: "feature\n" });
    await expect(deleteBranch(h.git, "/repo", EVIDENCE, h.fs)).resolves.toEqual({
      kind: "deleted",
      branch: "feature",
    });
  });

  it("fails closed on an active detached-bisect OID origin", async () => {
    const h = linked({
      [`${ADMIN}/BISECT_START`]: `${"5".repeat(40)}\n`,
      [`${ADMIN}/BISECT_LOG`]: "git bisect start\n",
    });
    await expectRefused(h, "holders-unavailable");
  });

  for (const [name, contents] of [
    ["truncated", `refs/heads/feature\n${"3".repeat(40)}\n`],
    ["malformed OID", `refs/heads/feature\nnot-an-oid\n${"4".repeat(40)}\n`],
    ["malformed ref", `feature\n${"3".repeat(40)}\n${"4".repeat(40)}\n`],
  ]) {
    it(`fails closed on ${name} update-refs state`, async () => {
      await expectRefused(linked({ [`${ADMIN}/rebase-merge/update-refs`]: contents }), "holders-unavailable");
    });
  }

  it("validates sequencer OIDs at the repository object format's width", async () => {
    const evidence256: DeleteBranchEvidence = {
      ...EVIDENCE,
      branchOid: "1".repeat(64),
      defaultOid: "2".repeat(64),
    };
    const listing256 =
      `worktree /repo\0HEAD ${"a".repeat(64)}\0branch refs/heads/main\0\0` +
      `worktree /repo-feature\0HEAD ${"b".repeat(64)}\0detached\0\0`;
    const state = (oid: string) => ({
      [`${ADMIN}/rebase-merge/update-refs`]: `refs/heads/other\n${oid}\n${oid}\n`,
    });
    const valid = linked(state("3".repeat(64)), { listing: result(listing256), objectFormat: "sha256" });
    const invalid = linked(state("3".repeat(40)), { listing: result(listing256), objectFormat: "sha256" });

    await expect(deleteBranch(valid.git, "/repo", evidence256, valid.fs)).resolves.toEqual({
      kind: "deleted",
      branch: "feature",
    });
    await expect(deleteBranch(invalid.git, "/repo", evidence256, invalid.fs)).resolves.toEqual({
      kind: "refused",
      reason: "holders-unavailable",
    });
  });

  it("fails closed when a raw administrative entry is unreadable", async () => {
    const h = runner({
      listing: result(MAIN + LINKED),
      entries: { [`${COMMON}/worktrees`]: ["feature-admin"] },
      errors: { [ADMIN]: "EACCES" },
    });
    await expectRefused(h, "holders-unavailable");
  });

  it("does not skip a dot-prefixed raw administrative entry", async () => {
    const hidden = `${COMMON}/worktrees/.hidden`;
    const h = runner({
      entries: { [`${COMMON}/worktrees`]: [".hidden"] },
      errors: { [hidden]: "EACCES" },
    });
    await expectRefused(h, "holders-unavailable");
  });

  it("fails closed when a raw entry is not a directory", async () => {
    const h = runner({
      listing: result(MAIN + LINKED),
      entries: { [`${COMMON}/worktrees`]: ["feature-admin"] },
      files: { [ADMIN]: "not a directory" },
    });
    await expectRefused(h, "holders-unavailable");
  });

  it("fails closed when a linked worktree omitted from porcelain still has raw administration", async () => {
    const h = runner({
      entries: { [`${COMMON}/worktrees`]: ["feature-admin"] },
      directories: [ADMIN],
      files: { [`${ADMIN}/gitdir`]: "/repo-feature/.git\n" },
    });
    await expectRefused(h, "holders-unavailable");
  });

  it("fails closed when equal raw and porcelain counts name different worktrees", async () => {
    const h = runner({
      listing: result(MAIN + LINKED),
      entries: { [`${COMMON}/worktrees`]: ["feature-admin"] },
      directories: [ADMIN],
      files: { [`${ADMIN}/gitdir`]: "/repo-other/.git\n" },
    });
    await expectRefused(h, "holders-unavailable");
  });

  it("fails closed when porcelain has a linked record with no raw administration", async () => {
    const h = runner({ listing: result(MAIN + LINKED) });
    await expectRefused(h, "holders-unavailable");
  });

  it("fails closed when an administrative gitdir pointer is missing", async () => {
    const h = runner({
      listing: result(MAIN + LINKED),
      entries: { [`${COMMON}/worktrees`]: ["feature-admin"] },
      directories: [ADMIN],
    });
    await expectRefused(h, "holders-unavailable");
  });

  it("reads holder state from the main worktree's common git directory", async () => {
    const h = runner({
      files: {
        [`${COMMON}/rebase-merge/update-refs`]: `refs/heads/feature\n${"3".repeat(40)}\n${"4".repeat(40)}\n`,
      },
    });
    await expectRefused(h, "branch-in-use");
  });

  it("fails closed on an ambiguous or bare main record", async () => {
    const bare = "worktree /repo.git\0bare\0\0";
    await expectRefused(runner({ listing: result(bare) }), "holders-unavailable");
    await expectRefused(runner({ listing: result(MAIN + LINKED) }), "holders-unavailable");
  });

  it("fails closed on malformed porcelain or an unreadable common git directory", async () => {
    await expectRefused(runner({ listing: result(MAIN.slice(0, -1)) }), "holders-unavailable");
    await expectRefused(runner({ common: result("", 1) }), "holders-unavailable");
  });

  it("fails closed when an existing optional state file cannot be read", async () => {
    const h = linked({}, { errors: { [`${ADMIN}/rebase-merge/head-name`]: "EACCES" } });
    await expectRefused(h, "holders-unavailable");
  });

  it("refuses the branch that currently resolves as default", async () => {
    await expectRefused(runner({ defaultBranch: "feature" }), "default-branch");
  });

  it("verifies the recorded default ref even when the selector now names another branch", async () => {
    const h = runner({ defaultBranch: "release" });
    await expect(deleteBranch(h.git, "/repo", EVIDENCE, h.fs)).resolves.toEqual({
      kind: "deleted",
      branch: "feature",
    });
    expect(h.calls.find((call) => call.args[0] === "update-ref")?.options?.input).toContain(
      `verify refs/heads/main ${EVIDENCE.defaultOid}`,
    );
  });

  it("fails closed when the worktree listing cannot be read", async () => {
    await expectRefused(runner({ listing: result("", 1) }), "holders-unavailable");
  });

  it("reports a moved ref when the verified transaction declines", async () => {
    await expectRefused(runner({ transaction: result("", 1) }), "refs-moved");
  });

  it("rejects ref names that could inject another transaction command", async () => {
    const h = runner();
    await expect(deleteBranch(h.git, "/repo", { ...EVIDENCE, branch: "feature\ncommit" }, h.fs)).resolves.toEqual({
      kind: "refused",
      reason: "holders-unavailable",
    });
    expect(h.calls).toHaveLength(0);
  });
});
