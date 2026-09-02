// src/agentHooks/install/lockedJsonFile.test.ts — The exclusion and the
// replacement, tested once for both callers that now take them (D15). Locking
// fails closed without time-based authority and reports non-ENOENT release
// residue by exact path rather than swallowing it (D5, D9).

import { lstat, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LockedFile } from "./lockedJsonFile";

const tempDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "locked-file-"));
  tempDirectories.push(directory);
  const target = join(directory, "record.json");
  return { directory, target, lockPath: `${target}.anywhere-terminal.lock` };
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("LockedFile", () => {
  it("holds the lock for the duration of the work and releases it after", async () => {
    const { target, lockPath } = await fixture();
    const file = new LockedFile(target);

    const held = await file.withLock(async () => (await stat(lockPath)).isFile(), false, false);

    expect(held).toBe(true);
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("releases the lock when the work throws, and reports the caller's failure value", async () => {
    const { target, lockPath } = await fixture();
    const file = new LockedFile(target);

    const outcome = await file.withLock<string>(
      async () => {
        throw new Error("boom");
      },
      "unavailable",
      "failed",
    );

    expect(outcome).toBe("failed");
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("gives up on a lock somebody else is holding rather than writing anyway", async () => {
    const { target, lockPath } = await fixture();
    await writeFile(lockPath, "");
    let ran = false;
    const file = new LockedFile(target, { sleep: async () => undefined });

    const outcome = await file.withLock<string>(
      async () => {
        ran = true;
        return "ok";
      },
      "unavailable",
      "failed",
    );

    expect(outcome).toBe("unavailable");
    expect(ran).toBe(false);
  });

  it("keeps failing closed when a live holder pauses beyond the old staleness threshold", async () => {
    const { target, lockPath } = await fixture();
    await writeFile(lockPath, "");
    let ran = false;
    // No mtime or elapsed-time reading can reclaim the lock anymore (D5): even
    // a clock that races far past the deleted 30-second window on every read
    // must not unwedge a live holder.
    const file = new LockedFile(target, {
      sleep: async () => undefined,
      now: () => Date.now() + 10 * 60_000,
    });

    const outcome = await file.withLock<string>(
      async () => {
        ran = true;
        return "ok";
      },
      "unavailable",
      "failed",
    );

    expect(outcome).toBe("unavailable");
    expect(ran).toBe(false);
    await expect(stat(lockPath)).resolves.toBeDefined();
  });

  it("never mutates the target or deletes the holder's lock while a waiter is failing closed", async () => {
    const { target, lockPath } = await fixture();
    await writeFile(target, "existing");
    await writeFile(lockPath, "");
    const file = new LockedFile(target, { sleep: async () => undefined });

    await file.withLock<string>(async () => "ok", "unavailable", "failed");

    expect(await readFile(target, "utf8")).toBe("existing");
    await expect(stat(lockPath)).resolves.toBeDefined();
  });

  it("returns the committed result and reports the exact path when the final release fails for a non-ENOENT reason", async () => {
    const { target, lockPath } = await fixture();
    const file = new LockedFile(target, {
      fs: {
        unlink: async () => {
          throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        },
      },
    });
    const reported: string[] = [];

    const outcome = await file.withLock<string>(
      async () => "committed",
      "unavailable",
      "failed",
      (path) => reported.push(path),
    );

    expect(outcome).toBe("committed");
    expect(reported).toEqual([lockPath]);
  });

  // libuv rounds `ino` into a double unless the caller asks for bigint, so two
  // DISTINCT files above 2^53 arrive as one number. This fake reproduces exactly
  // that — precision on request, rounding otherwise — which is what makes the
  // witness a test of the capture rather than of the fake.
  function identity(dev: bigint, ino: bigint) {
    return async (_path: unknown, options?: { bigint?: boolean }) =>
      (options?.bigint
        ? { dev, ino, nlink: 1n, isFile: () => true, isSymbolicLink: () => false }
        : {
            dev: Number(dev),
            ino: Number(ino),
            nlink: 1,
            isFile: () => true,
            isSymbolicLink: () => false,
          }) as never;
  }

  it("does not release a lock whose identity differs from the held one only above 2^53", async () => {
    const { target, lockPath } = await fixture();
    const statOf = identity(1n, 2n ** 53n + 1n);
    // 2^53 and 2^53+1 are DISTINCT integers that round to the SAME double.
    const unlinked: string[] = [];
    const reported: string[] = [];
    const file = new LockedFile(target, {
      fs: {
        open: (async () => ({
          stat: (o?: { bigint?: boolean }) => statOf(undefined, o),
          close: async () => undefined,
        })) as never,
        lstat: identity(1n, 2n ** 53n),
        unlink: (async (path: string) => {
          unlinked.push(path);
        }) as never,
      },
    });

    const outcome = await file.withLock<string>(
      async () => "committed",
      "unavailable",
      "failed",
      (path) => reported.push(path),
    );

    expect(outcome).toBe("committed");
    expect(unlinked).toEqual([]);
    expect(reported).toEqual([lockPath]);
  });

  it("does not delete a lock pathname substituted while work is running", async () => {
    const { target, lockPath } = await fixture();
    const reported: string[] = [];
    const file = new LockedFile(target);

    const outcome = await file.withLock<string>(
      async () => {
        await rm(lockPath);
        await writeFile(lockPath, "replacement");
        return "committed";
      },
      "unavailable",
      "failed",
      (path) => reported.push(path),
    );

    expect(outcome).toBe("committed");
    expect(reported).toEqual([lockPath]);
    expect(await readFile(lockPath, "utf8")).toBe("replacement");
  });

  it("treats an already-removed lock file as clean rather than a release failure", async () => {
    const { target } = await fixture();
    const file = new LockedFile(target, {
      fs: {
        unlink: async () => {
          throw Object.assign(new Error("no such file"), { code: "ENOENT" });
        },
      },
    });
    const reported: string[] = [];

    const outcome = await file.withLock<string>(
      async () => "ok",
      "unavailable",
      "failed",
      (path) => reported.push(path),
    );

    expect(outcome).toBe("ok");
    expect(reported).toEqual([]);
  });

  it("lets a caller merge the reported lock path into unresolved paths it already collected", async () => {
    const { target, lockPath } = await fixture();
    const file = new LockedFile(target, {
      fs: {
        unlink: async () => {
          throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        },
      },
    });
    const unresolved: string[] = ["other/stale.lock"];

    const outcome = await file.withLock<string>(
      async () => "committed",
      "unavailable",
      "failed",
      (path) => unresolved.push(path),
    );

    expect(outcome).toBe("committed");
    expect(unresolved).toEqual(["other/stale.lock", lockPath]);
  });

  it("replaces the contents and keeps the mode it was given", async () => {
    const { target } = await fixture();
    await writeFile(target, "old", { mode: 0o640 });
    const file = new LockedFile(target);

    expect(await file.atomicReplace("new", 0o640)).toBe(true);

    expect(await readFile(target, "utf8")).toBe("new");
    expect((await stat(target)).mode & 0o777).toBe(0o640);
  });

  it("leaves the original in place and no temporary behind when the rename fails", async () => {
    const { directory, target } = await fixture();
    await writeFile(target, "old");
    const file = new LockedFile(target, {
      rename: async () => {
        throw new Error("disk full");
      },
    });

    expect(await file.atomicReplace("new", undefined)).toBe(false);

    expect(await readFile(target, "utf8")).toBe("old");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("does not follow or delete a pre-created predictable temporary symlink", async () => {
    const { directory, target } = await fixture();
    const victim = join(directory, "victim.json");
    const temporaryPath = join(directory, `.record.json.${"ab".repeat(16)}.tmp`);
    await writeFile(target, "old");
    await writeFile(victim, "victim");
    await symlink(victim, temporaryPath);
    const file = new LockedFile(target, {
      randomBytes: () => Buffer.alloc(16, 0xab),
    });

    expect(await file.atomicReplace("new", undefined)).toBe(false);

    expect(await readFile(target, "utf8")).toBe("old");
    expect(await readFile(victim, "utf8")).toBe("victim");
    expect((await lstat(temporaryPath)).isSymbolicLink()).toBe(true);
  });

  it("does not commit or clean up a substituted temporary pathname", async () => {
    const { directory, target } = await fixture();
    const victim = join(directory, "victim.json");
    await writeFile(target, "old");
    await writeFile(victim, "victim");
    const file = new LockedFile(target);
    const staged = await file.stageReplacement("new", undefined);
    expect(staged).toBeDefined();
    if (!staged) {
      return;
    }
    await rm(staged.path);
    await symlink(victim, staged.path);

    expect(await staged.commit("replace")).toBe(false);
    await staged.discard();

    expect(await readFile(target, "utf8")).toBe("old");
    expect(await readFile(victim, "utf8")).toBe("victim");
    expect((await lstat(staged.path)).isSymbolicLink()).toBe(true);
  });

  it("reads a missing file as absent rather than as an error", async () => {
    const { target } = await fixture();

    expect(await new LockedFile(target).readText()).toBeUndefined();
    await writeFile(target, "present");
    expect(await new LockedFile(target).readText()).toBe("present");
  });
});
