// src/agentHooks/install/lockedJsonFile.test.ts — The exclusion and the
// replacement, tested once for both callers that now take them (D15).

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LockedFile, STALE_LOCK_MS } from "./lockedJsonFile";

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

  it("reclaims a lock left behind by a process that died", async () => {
    const { target, lockPath } = await fixture();
    await writeFile(lockPath, "");
    // Nothing sweeps a lock file, so a crash between acquire and release would
    // otherwise wedge every later write to this path.
    const file = new LockedFile(target, { now: () => Date.now() + STALE_LOCK_MS + 1_000 });

    expect(await file.withLock(async () => "ok", "unavailable", "failed")).toBe("ok");
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

  it("reads a missing file as absent rather than as an error", async () => {
    const { target } = await fixture();

    expect(await new LockedFile(target).readText()).toBeUndefined();
    await writeFile(target, "present");
    expect(await new LockedFile(target).readText()).toBe("present");
  });
});
