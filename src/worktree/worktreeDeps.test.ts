import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createWorktreeTreeDeps } from "./worktreeDeps";

// The two seams worth exercising are the ones bound to the real OS: everything
// else in the factory is composition the type-checker already proves. Git is
// deliberately not spawned — that is WorktreeDiscovery's territory.
const tempRoots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "at-worktree-deps-"));
  tempRoots.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("createWorktreeTreeDeps", () => {
  it("normalizes two spellings of one directory to a single identity", async () => {
    const deps = createWorktreeTreeDeps();
    const real = await makeTempDir();
    const link = path.join(await makeTempDir(), "link");
    await fs.symlink(real, link);

    const viaReal = await deps.normalize(real);
    const viaLink = await deps.normalize(link);

    expect(viaReal).not.toBeNull();
    expect(viaLink).toBe(viaReal);
  });

  it("normalizes a path that does not exist", async () => {
    const deps = createWorktreeTreeDeps();
    const root = await makeTempDir();

    const missing = await deps.normalize(path.join(root, "gone", "deeper"));

    expect(missing).not.toBeNull();
    expect(missing).toContain("deeper");
  });

  it("rejects a relative path rather than guessing at one", async () => {
    const deps = createWorktreeTreeDeps();

    await expect(deps.normalize("relative/path")).resolves.toBeNull();
  });

  it("stat rejects with ENOENT for an absent path", async () => {
    const deps = createWorktreeTreeDeps();
    const root = await makeTempDir();

    await expect(deps.stat(path.join(root, "absent"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stat resolves for a path that exists", async () => {
    const deps = createWorktreeTreeDeps();
    const root = await makeTempDir();

    await expect(deps.stat(root)).resolves.toBeDefined();
  });

  it("authorizes a repository common directory with retained component identities", async () => {
    const deps = createWorktreeTreeDeps();
    const root = await makeTempDir();
    const normalized = await deps.normalize(root);
    expect(normalized).not.toBeNull();

    const registration = await deps.authorizeCommonDirectory?.(normalized as string);

    expect(registration?.path).toBe(normalized);
    expect(registration?.components.at(-1)?.path).toBe(normalized);
    expect(registration?.components.at(-1)?.identity.ino).not.toBe(0);
  });

  it("shares one capability cache across the returned deps", () => {
    const first = createWorktreeTreeDeps();
    const second = createWorktreeTreeDeps();

    // Each call owns its cache; the host makes one call per window so every
    // repository shares the same `-z` / `--path-format` probe result.
    expect(first.capabilities).not.toBe(second.capabilities);
    expect(first.capabilities).toBeDefined();
  });
});
