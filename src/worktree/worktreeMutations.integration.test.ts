// Real git, real directories. Argv-spy unit tests prove we ASK for the right
// thing; only this file proves git does what the safety model claims it does —
// that `remove --force` really deletes a nested worktree's files, that one
// `--force` really will not pass a lock, that prune really drops the count it
// reported (design.md D4, D5, D11).

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepoFixture, type RepoFixture } from "../test/fixtures/repoFixture";
import { createGitCommandRunner } from "./gitCommandRunner";
import { createWorktree, lockWorktree, pruneRepo, removeWorktree } from "./worktreeMutations";

const runner = createGitCommandRunner();
let fixture: RepoFixture;
let repo: string;
let tmp: string;

function git(args: string[], cwd = repo): string {
  return fixture.git(args, cwd);
}

beforeEach(() => {
  fixture = createRepoFixture({ prefix: "wt-int-" });
  repo = fixture.repo;
  tmp = fixture.tmp;
});

afterEach(() => {
  fixture.dispose();
});

/** Registered worktree paths, from git itself. */
function listed(): string[] {
  return git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}

describe("create", () => {
  it("creates a worktree on a new branch", async () => {
    const target = path.join(tmp, "wt-a");
    const result = await createWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      source: { kind: "newBranch", branch: "feat" },
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(target, "README.md"))).toBe(true);
  });

  it("creates into an existing EMPTY directory, which validation allows", async () => {
    // createPath.ts permits an empty directory; that permission is only correct
    // if git actually accepts one.
    const target = path.join(tmp, "wt-empty");
    fs.mkdirSync(target);
    const result = await createWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      source: { kind: "newBranch", branch: "feat" },
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("surfaces git's refusal for a branch already checked out, rather than forcing", async () => {
    const first = path.join(tmp, "wt-1");
    const second = path.join(tmp, "wt-2");
    await createWorktree(runner, {
      repoPath: repo,
      worktreePath: first,
      source: { kind: "newBranch", branch: "feat" },
    });
    const result = await createWorktree(runner, {
      repoPath: repo,
      worktreePath: second,
      source: { kind: "existingBranch", branch: "feat" },
    });
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/already (checked out|used)/i);
  });
});

describe("remove", () => {
  it("refuses an unforced removal of a dirty worktree", async () => {
    const target = path.join(tmp, "wt-dirty");
    await createWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      source: { kind: "newBranch", branch: "feat" },
    });
    fs.writeFileSync(path.join(target, "README.md"), "changed\n");
    const { result } = await removeWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      force: false,
      locked: false,
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("needs the DOUBLED force for a locked worktree — one is genuinely not enough", async () => {
    // The whole "confirm past a lock" path fails outright without the second
    // flag. This is the assertion an argv spy cannot make.
    const target = path.join(tmp, "wt-locked");
    await createWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      source: { kind: "newBranch", branch: "feat" },
    });
    await lockWorktree(runner, { repoPath: repo, worktreePath: target, reason: undefined });

    const single = await removeWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      force: true,
      locked: false,
    });
    expect(single.result.ok).toBe(false);
    expect(fs.existsSync(target)).toBe(true);

    const doubled = await removeWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      force: true,
      locked: true,
    });
    expect(doubled.result.ok).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("[I10] destroys a NESTED registered worktree's files — which is why D4 refuses outright", async () => {
    // The claim the whole refusal rests on: git treats a nested registered
    // worktree as ordinary untracked content and deletes it, leaving a
    // registration pointing at nothing.
    const parent = path.join(tmp, "wt-parent");
    await createWorktree(runner, {
      repoPath: repo,
      worktreePath: parent,
      source: { kind: "newBranch", branch: "parent" },
    });
    const child = path.join(parent, "nested");
    await createWorktree(runner, {
      repoPath: repo,
      worktreePath: child,
      source: { kind: "newBranch", branch: "child" },
    });
    expect(listed()).toContain(child);

    await removeWorktree(runner, { repoPath: repo, worktreePath: parent, force: true, locked: false });

    expect(fs.existsSync(child)).toBe(false);
    // And the orphaned registration is exactly the mess a confirmation could
    // not have described.
    expect(git(["worktree", "list", "--porcelain"])).toContain("nested");
  });

  it("[I10] removes a worktree whose directory is already gone, pruning its registration", async () => {
    const target = path.join(tmp, "wt-missing");
    await createWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      source: { kind: "newBranch", branch: "feat" },
    });
    fs.rmSync(target, { recursive: true, force: true });
    const { result } = await removeWorktree(runner, {
      repoPath: repo,
      worktreePath: target,
      force: false,
      locked: false,
    });
    expect(result.ok).toBe(true);
    expect(listed()).not.toContain(target);
  });
});

describe("prune", () => {
  it("drops exactly the registrations it counted", async () => {
    const a = path.join(tmp, "wt-a");
    const b = path.join(tmp, "wt-b");
    for (const [p, branch] of [
      [a, "fa"],
      [b, "fb"],
    ] as const) {
      await createWorktree(runner, { repoPath: repo, worktreePath: p, source: { kind: "newBranch", branch } });
    }
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });

    const count = await pruneRepo.countPrunable(runner, repo);
    expect(count).toEqual({ ok: true, count: 2 });

    expect(await pruneRepo.run(runner, repo)).toMatchObject({ ok: true });
    expect(listed()).toEqual([repo]);
    // And the count the confirmation named is now zero, not stale.
    expect(await pruneRepo.countPrunable(runner, repo)).toEqual({ ok: true, count: 0 });
  });

  it("counts nothing, and does nothing, when every worktree is healthy", async () => {
    await createWorktree(runner, {
      repoPath: repo,
      worktreePath: path.join(tmp, "wt-a"),
      source: { kind: "newBranch", branch: "fa" },
    });
    expect(await pruneRepo.countPrunable(runner, repo)).toEqual({ ok: true, count: 0 });
    expect(await pruneRepo.run(runner, repo)).toMatchObject({ ok: true });
    expect(listed()).toHaveLength(2);
  });
});
