import { mkdir, mkdtemp, realpath, rename, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeDirectory, directoryStillAuthorized, fileIdentityOf } from "./authorizedDirectory";

const temporaryRoots: string[] = [];

async function fixture(): Promise<{ root: string; target: string }> {
  const created = await mkdtemp(path.join(tmpdir(), "authorized-directory-"));
  temporaryRoots.push(created);
  const root = await realpath(created);
  const target = path.join(root, "ancestor", "worktree");
  await mkdir(target, { recursive: true });
  return { root, target };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("authorizeDirectory", () => {
  it("freezes a stable component chain and rechecks it", async () => {
    const { target } = await fixture();
    const authorization = await authorizeDirectory(target);

    expect(authorization).toBeDefined();
    await expect(directoryStillAuthorized(authorization!)).resolves.toBe(true);
  });

  it("detects a regular replacement of the authorized leaf", async () => {
    const { target } = await fixture();
    const authorization = await authorizeDirectory(target);
    await rename(target, `${target}-original`);
    await mkdir(target);

    await expect(directoryStillAuthorized(authorization!)).resolves.toBe(false);
  });

  it("detects an ancestor replaced by a symlink to another regular tree", async () => {
    const { root, target } = await fixture();
    const authorization = await authorizeDirectory(target);
    const ancestor = path.dirname(target);
    const original = `${ancestor}-original`;
    const redirected = path.join(root, "redirected");
    await mkdir(path.join(redirected, path.basename(target)), { recursive: true });
    await rename(ancestor, original);
    await symlink(redirected, ancestor);

    await expect(directoryStillAuthorized(authorization!)).resolves.toBe(false);
  });

  it("refuses a symlinked leaf while minting authority", async () => {
    const { root, target } = await fixture();
    const alias = path.join(root, "alias");
    await symlink(target, alias);

    await expect(authorizeDirectory(alias)).resolves.toBeUndefined();
  });

  it("treats zero inode as unavailable identity", async () => {
    expect(fileIdentityOf({ dev: 4, ino: 0 })).toBeUndefined();
    expect(fileIdentityOf({ dev: 4n, ino: 0n })).toBeUndefined();
    expect(fileIdentityOf({ dev: 4, ino: 9 })).toEqual({ dev: 4, ino: 9 });
  });

  it("enumerates Windows drive components with win32 semantics", async () => {
    const seen: string[] = [];
    const inodes = new Map<string, number>();
    const lstat = vi.fn(async (candidate: string) => {
      seen.push(candidate);
      const ino = inodes.get(candidate) ?? inodes.size + 1;
      inodes.set(candidate, ino);
      return {
        dev: 7,
        ino,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      };
    });

    const authorization = await authorizeDirectory("C:\\repo\\worktree", { platform: "win32", lstat });

    expect(authorization).toBeDefined();
    expect(seen.slice(0, 3)).toEqual(["C:\\", "C:\\repo", "C:\\repo\\worktree"]);
  });

  it("runs every filesystem observation through the supplied budget", async () => {
    const { target } = await fixture();
    let calls = 0;
    const budget = {
      run: async <T>(work: () => Promise<T>): Promise<T> => {
        calls += 1;
        if (calls === 2) {
          throw new Error("expired");
        }
        return work();
      },
    };

    await expect(
      authorizeDirectory(target, { lstat: (candidate) => stat(candidate) }, budget),
    ).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
