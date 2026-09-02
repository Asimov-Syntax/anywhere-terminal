import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProvisionPort } from "../types/messages";
import { authorizeDirectory } from "../utils/authorizedDirectory";
import { LockedFile, type StagedReplacement, type WriteGate } from "../utils/lockedFile";
import type { Deadline } from "./deadline";
import {
  allocateWorktreePorts,
  type PortWorktreeListing,
  previewWorktreePorts,
  type WorktreePortsDeps,
} from "./worktreePorts";

const tempDirectories: string[] = [];

async function fixture(names = ["main", "one", "two"]) {
  const created = await mkdtemp(path.join(tmpdir(), "worktree-ports-"));
  tempDirectories.push(created);
  const root = await realpath(created);
  const repoId = path.join(root, ".git");
  await mkdir(repoId, { recursive: true });
  const worktrees = await Promise.all(
    names.map(async (name) => {
      const worktree = path.join(root, name);
      await mkdir(worktree, { recursive: true });
      return worktree;
    }),
  );
  return { repoId, repoPath: worktrees[0] as string, worktrees };
}

function port(name: string, id = `id-${name}`, preview?: number): ProvisionPort {
  return { id, name, source: "asimov/worktree.yaml", ...(preview === undefined ? {} : { port: preview }) };
}

async function complete(paths: readonly string[]): Promise<PortWorktreeListing> {
  const worktrees = await Promise.all(
    paths.map(async (worktreePath) => {
      const authorization = await authorizeDirectory(worktreePath);
      if (authorization === undefined) {
        throw new Error(`the listed worktree could not be authorized: ${worktreePath}`);
      }
      return { id: worktreePath, path: worktreePath, authorization };
    }),
  );
  return { worktrees, reasons: [], skipped: 0 };
}

async function allocate(
  input: Omit<Parameters<typeof allocateWorktreePorts>[0], "authorization">,
  dependencies: WorktreePortsDeps,
) {
  const authorization = await authorizeDirectory(input.worktreePath);
  if (authorization === undefined) {
    throw new Error("the test worktree could not be authorized");
  }
  return allocateWorktreePorts({ ...input, authorization }, dependencies);
}

function probes(values: readonly number[]): WorktreePortsDeps["probe"] {
  let index = 0;
  return async () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("no probe value");
    }
    return value;
  };
}

function manualDeadline(initiallyExpired = false) {
  let expire!: () => void;
  let expired = initiallyExpired;
  const elapsed = new Promise<void>((resolve) => {
    expire = () => {
      expired = true;
      resolve();
    };
  });
  if (initiallyExpired) {
    expire();
  }
  const deadline: Deadline = {
    elapsed,
    get expired() {
      return expired;
    },
    cancel: vi.fn(),
  };
  return { deadline, expire };
}

const openGate: WriteGate = { open: true, guard: (step) => step() };

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("previewWorktreePorts", () => {
  it("excludes sibling claims and gives duplicate names one preview", async () => {
    const { worktrees } = await fixture(["main", "sibling"]);
    await writeFile(path.join(worktrees[1] as string, ".env.worktree"), "OTHER=5183\n");

    const previewed = await previewWorktreePorts([port("APP", "a"), port("APP", "b")], worktrees, {
      probe: probes([5183, 5184]),
    });

    expect(previewed.map((item) => item.port)).toEqual([5184, 5184]);
  });

  it("returns explicit unavailable previews when sibling claims are untrusted", async () => {
    const { worktrees } = await fixture(["main", "sibling"]);
    await writeFile(path.join(worktrees[1] as string, ".env.worktree"), "APP = 5183\n");

    const previewed = await previewWorktreePorts([port("APP", "app", 5000)], worktrees, {
      probe: probes([5184]),
    });

    expect(previewed[0]?.port).toBeUndefined();
  });

  it("stops waiting when the preview budget expires", async () => {
    const started = Date.now();
    const previewed = await previewWorktreePorts([port("APP", "app", 5000)], [], {
      transactionMs: 10,
      probe: () => new Promise<number>(() => undefined),
    });

    expect(Date.now() - started).toBeLessThan(200);
    expect(previewed[0]?.port).toBeUndefined();
  });
});

describe("allocateWorktreePorts", () => {
  it("serializes concurrent allocators so sibling claims are distinct", async () => {
    const { repoId, repoPath, worktrees } = await fixture();
    const probe = probes([5183, 5183, 5184]);
    const deps = { listWorktrees: async () => complete(worktrees), probe };

    const [first, second] = await Promise.all([
      allocate({ repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] }, deps),
      allocate({ repoId, repoPath, worktreePath: worktrees[2] as string, ports: [port("APP")] }, deps),
    ]);

    const values = [first, second].map((result) => {
      const outcome = result.ports[0]?.outcome;
      return outcome?.kind === "allocated" ? outcome.port : undefined;
    });
    expect(new Set(values)).toEqual(new Set([5183, 5184]));
  });

  it("fails closed without writing when the common lock already exists", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const sentinel = path.join(repoId, "anywhere-terminal-port-claims");
    await writeFile(`${sentinel}.anywhere-terminal.lock`, "held");

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      { listWorktrees: async () => complete(worktrees), probe: probes([5183]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    await expect(readFile(path.join(worktrees[1] as string, ".env.worktree"), "utf8")).rejects.toThrow();
  });

  it("does not persist claims through a recreated mutation-authorized target", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const worktreePath = worktrees[1] as string;
    const authorization = await authorizeDirectory(worktreePath);
    if (authorization === undefined) {
      throw new Error("the target could not be authorized");
    }
    await rename(worktreePath, `${worktreePath}-original`);
    await mkdir(worktreePath);

    const result = await allocateWorktreePorts(
      { repoId, repoPath, worktreePath, ports: [port("APP")], authorization },
      { listWorktrees: async () => complete(worktrees), probe: probes([5183]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    await expect(readFile(path.join(worktreePath, ".env.worktree"), "utf8")).rejects.toThrow();
  });

  it("reuses an existing assignment and appends only missing names", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(target, "# keep\nAPP=5183\n");

    const result = await allocate(
      {
        repoId,
        repoPath,
        worktreePath: worktrees[1] as string,
        ports: [port("APP", "app", 5182), port("DB", "db", 5432)],
      },
      { listWorktrees: async () => complete(worktrees), probe: probes([5433]) },
    );

    expect(result.ports.map((item) => item.outcome.kind)).toEqual(["reused", "allocated"]);
    expect(await readFile(target, "utf8")).toBe("# keep\nAPP=5183\nDB=5433\n");
  });

  it("refuses a claim file whose filesystem identity is unavailable", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(target, "APP=5183\n");

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => complete(worktrees),
        lstat: async (candidate) => {
          const entry = await lstat(candidate);
          return candidate === target
            ? new Proxy(entry, {
                get: (value, property) => (property === "ino" ? 0 : Reflect.get(value, property, value)),
              })
            : entry;
        },
      },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    expect(await readFile(target, "utf8")).toBe("APP=5183\n");
  });

  it("preserves the existing claim file mode while appending", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(target, "APP=5183\n");
    await chmod(target, 0o640);

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("DB")] },
      { listWorktrees: async () => complete(worktrees), probe: probes([5433]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("allocated");
    expect((await stat(target)).mode & 0o777).toBe(0o640);
  });

  it.each([
    { name: "degraded", listing: { worktrees: [], reasons: [], skipped: 0, degraded: "git failed" } },
    { name: "skipped", listing: { worktrees: [], reasons: [], skipped: 1 } },
    { name: "reason", listing: { worktrees: [], reasons: ["one record was omitted"], skipped: 0 } },
  ])("fails fresh allocation for an incomplete $name listing", async ({ listing }) => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      { listWorktrees: async () => listing, probe: probes([5183]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    await expect(readFile(path.join(worktrees[1] as string, ".env.worktree"), "utf8")).rejects.toThrow();
  });

  it("leaves a file with duplicate numeric values untouched and fails every selection", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    const original = "APP=5183\nDB=5183\n";
    await writeFile(target, original);

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP"), port("DB")] },
      { listWorktrees: async () => complete(worktrees), probe: probes([]) },
    );

    expect(result.ports.every((item) => item.outcome.kind === "failed")).toBe(true);
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it.each([
    "APP=0\n",
    "APP=01\n",
    "APP=65536\n",
    " APP=5183 \n",
    "APP=5183\nAPP=5184\n",
  ])("leaves the unsupported target %j untouched", async (original) => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(target, original);

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      { listWorktrees: async () => complete(worktrees), probe: probes([5184]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("fails fresh allocation when a listed sibling is recreated before its claim read", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new", "sibling"]);
    const listing = await complete(worktrees);
    const sibling = worktrees[2] as string;
    await rename(sibling, `${sibling}-original`);
    await mkdir(sibling);
    await writeFile(path.join(sibling, ".env.worktree"), "OTHER=5183\n");

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      { listWorktrees: async () => listing, probe: probes([5184]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    await expect(readFile(path.join(worktrees[1] as string, ".env.worktree"), "utf8")).rejects.toThrow();
  });

  it("excludes the normalized target listing row by authorized identity despite its display alias", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const worktreePath = worktrees[1] as string;
    await writeFile(path.join(worktreePath, ".env.worktree"), "APP=5183\n");
    const listing = await complete(worktrees);
    const aliased = {
      ...listing,
      worktrees: listing.worktrees.map((worktree) =>
        worktree.id === worktreePath
          ? { ...worktree, path: path.join(path.dirname(worktreePath), "raw-alias") }
          : worktree,
      ),
    };

    const result = await allocate(
      { repoId, repoPath, worktreePath, ports: [port("APP")] },
      { listWorktrees: async () => aliased, probe: probes([]) },
    );

    expect(result.ports[0]?.outcome).toEqual({ kind: "reused", port: 5183 });
  });

  it("fails fresh allocation when a sibling claim file is malformed", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new", "sibling"]);
    await writeFile(path.join(worktrees[2] as string, ".env.worktree"), "not an assignment\n");

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      { listWorktrees: async () => complete(worktrees), probe: probes([5183]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    await expect(readFile(path.join(worktrees[1] as string, ".env.worktree"), "utf8")).rejects.toThrow();
  });

  it("fails fresh allocation when a sibling claim file exceeds the byte cap", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new", "sibling"]);
    await writeFile(path.join(worktrees[2] as string, ".env.worktree"), `#${"x".repeat(64 * 1024)}\n`);

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      { listWorktrees: async () => complete(worktrees), probe: probes([5184]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    await expect(readFile(path.join(worktrees[1] as string, ".env.worktree"), "utf8")).rejects.toThrow();
  });

  it("fails fresh allocation when a sibling claim file cannot be opened", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new", "sibling"]);
    const siblingClaim = path.join(worktrees[2] as string, ".env.worktree");
    await writeFile(siblingClaim, "OTHER=5183\n");

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => complete(worktrees),
        probe: probes([5184]),
        open: async (target, flags) => {
          if (target === siblingClaim) {
            throw Object.assign(new Error("denied"), { code: "EACCES" });
          }
          return open(target, flags);
        },
      },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    await expect(readFile(path.join(worktrees[1] as string, ".env.worktree"), "utf8")).rejects.toThrow();
  });

  it("refuses symlink targets without replacing their referent", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const referent = path.join(worktrees[0] as string, "claims");
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(referent, "APP=5183\n");
    await symlink(referent, target);

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      { listWorktrees: async () => complete(worktrees), probe: probes([5184]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    expect(await readFile(referent, "utf8")).toBe("APP=5183\n");
  });

  it("retains a sibling-conflicting assignment without adopting it", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new", "sibling"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(target, "# retained\nAPP=5183\n");
    await writeFile(path.join(worktrees[2] as string, ".env.worktree"), "OTHER=5183\n");

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      { listWorktrees: async () => complete(worktrees), probe: probes([]) },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    expect(await readFile(target, "utf8")).toBe("# retained\nAPP=5183\n");
  });

  it("coalesces duplicate names while retaining per-id outcomes", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");

    const result = await allocate(
      {
        repoId,
        repoPath,
        worktreePath: worktrees[1] as string,
        ports: [port("APP", "first", 5182), port("APP", "second", 5182)],
      },
      { listWorktrees: async () => complete(worktrees), probe: probes([5183]) },
    );

    expect(result.ports.map((item) => item.id)).toEqual(["first", "second"]);
    expect(result.ports.map((item) => item.outcome)).toEqual([
      { kind: "allocated", port: 5183 },
      { kind: "allocated", port: 5183 },
    ]);
    expect(await readFile(target, "utf8")).toBe("APP=5183\n");
  });

  it("keeps name-local failures from stopping a valid name", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);

    const result = await allocate(
      {
        repoId,
        repoPath,
        worktreePath: worktrees[1] as string,
        ports: [port("BAD-NAME", "bad"), port("APP", "app")],
      },
      { listWorktrees: async () => complete(worktrees), probe: probes([5183]) },
    );

    expect(result.ports.map((item) => item.outcome.kind)).toEqual(["failed", "allocated"]);
    expect(await readFile(path.join(worktrees[1] as string, ".env.worktree"), "utf8")).toBe("APP=5183\n");
  });

  it("bounds exhausted probes and continues with the next name", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new", "sibling"]);
    await writeFile(path.join(worktrees[2] as string, ".env.worktree"), "OTHER=5183\n");
    const probe = probes([...Array.from({ length: 32 }, () => 5183), 5184]);

    const result = await allocate(
      {
        repoId,
        repoPath,
        worktreePath: worktrees[1] as string,
        ports: [port("APP", "app"), port("DB", "db")],
      },
      { listWorktrees: async () => complete(worktrees), probe },
    );

    expect(result.ports.map((item) => item.outcome.kind)).toEqual(["failed", "allocated"]);
    expect(await readFile(path.join(worktrees[1] as string, ".env.worktree"), "utf8")).toBe("DB=5184\n");
  });

  it("aborts pending names when the authorized target changes before commit", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(target, "# original\n");
    class SubstitutingLockedFile extends LockedFile {
      public override async stageReplacement(contents: string, mode: number | undefined) {
        const staged = await super.stageReplacement(contents, mode);
        if (this.path === target) {
          await writeFile(target, "# external edit\n");
        }
        return staged;
      }
    }

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => complete(worktrees),
        probe: probes([5183]),
        lockedFile: (lockedPath) => new SubstitutingLockedFile(lockedPath),
      },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    expect(await readFile(target, "utf8")).toBe("# external edit\n");
  });

  it("reports failed atomic publication without claiming allocation", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => complete(worktrees),
        probe: probes([5183]),
        lockedFile: (lockedPath) => {
          const locked = new LockedFile(lockedPath);
          return lockedPath === target
            ? { withLock: locked.withLock.bind(locked), stageReplacement: async () => undefined }
            : locked;
        },
      },
    );

    expect(result.ports[0]?.outcome).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("staged"),
    });
    await expect(readFile(target, "utf8")).rejects.toThrow();
  });

  it("preserves committed outcomes while reporting lock-release and exclude warnings", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const sentinel = path.join(repoId, "anywhere-terminal-port-claims");
    const warned: string[] = [];

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => complete(worktrees),
        probe: probes([5183]),
        lockedFile: (lockedPath) => {
          if (lockedPath !== sentinel) {
            return new LockedFile(lockedPath);
          }
          return {
            stageReplacement: async () => undefined,
            withLock: async (_deadline, work, _failed, releaseFailed) => {
              const value = await work({ open: true, guard: (step) => step() });
              releaseFailed?.(`${sentinel}.lock`);
              return { kind: "done" as const, value };
            },
          };
        },
        addExclude: async () => ({ failed: "denied" }),
        warn: (message) => warned.push(message),
      },
    );

    expect(result.ports[0]?.outcome).toEqual({ kind: "allocated", port: 5183 });
    expect(result.warnings).toEqual(["lockReleaseFailed", "excludeFailed"]);
    expect(warned).toHaveLength(1);
  });

  it("reports a dirty port timeout as retained serialization", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const { deadline } = manualDeadline();
    const retainedLockPath = `${path.join(repoId, "anywhere-terminal-port-claims")}.anywhere-terminal.lock`;
    const warn = vi.fn();

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        deadline: () => deadline,
        listWorktrees: async () => complete(worktrees),
        lockedFile: () => ({
          stageReplacement: async () => undefined,
          withLock: async () => ({ kind: "timedOut" as const, retainedLockPath }),
        }),
        addExclude: async () => ({ added: false }),
        warn,
      },
    );

    expect(result.ports[0]?.outcome).toEqual({
      kind: "failed",
      reason: "port allocation timed out while a protected write was still pending",
    });
    expect(result.warnings).toEqual(["lockRetained"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(retainedLockPath));
    expect(deadline.cancel).toHaveBeenCalledOnce();
  });

  it("reports a clean port timeout without claiming lock retention", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const { deadline } = manualDeadline();

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        deadline: () => deadline,
        listWorktrees: async () => complete(worktrees),
        lockedFile: () => ({
          stageReplacement: async () => undefined,
          withLock: async () => ({ kind: "timedOut" as const }),
        }),
        addExclude: async () => ({ added: false }),
      },
    );

    expect(result.ports[0]?.outcome).toEqual({
      kind: "failed",
      reason: "port allocation timed out before publication",
    });
    expect(result.warnings).toEqual([]);
    expect(deadline.cancel).toHaveBeenCalledOnce();
  });

  it("starts no listing or publication after the shared deadline is already expired", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const { deadline } = manualDeadline(true);
    const listWorktrees = vi.fn(async () => complete(worktrees));
    const stageReplacement = vi.fn(async () => undefined);
    const probe = vi.fn(async () => 5183);
    const addExclude = vi.fn(async (_gitDir: string, _entry: string, given?: Deadline) => {
      expect(given).toBe(deadline);
      return { added: false } as const;
    });

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        deadline: () => deadline,
        listWorktrees,
        probe,
        lockedFile: () => ({
          stageReplacement,
          withLock: async (given) => {
            expect(given).toBe(deadline);
            expect(given.expired).toBe(true);
            return { kind: "timedOut" as const };
          },
        }),
        addExclude,
      },
    );

    expect(result.ports[0]?.outcome.kind).toBe("failed");
    expect(listWorktrees).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(stageReplacement).not.toHaveBeenCalled();
    expect(addExclude).toHaveBeenCalledOnce();
    expect(deadline.cancel).toHaveBeenCalledOnce();
  });

  it("preserves committed allocation when temporary cleanup misses the shared deadline", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const { deadline, expire } = manualDeadline();
    const sentinel = path.join(repoId, "anywhere-terminal-port-claims");
    const target = path.join(worktrees[1] as string, ".env.worktree");
    const discard = vi.fn(() => {
      expire();
      return new Promise<boolean>(() => undefined);
    });
    const commit = vi.fn(async () => true);
    const staged: StagedReplacement = { path: `${target}.tmp`, commit, discard, abandon: vi.fn(async () => undefined) };
    const addExclude = vi.fn(async (_gitDir: string, _entry: string, given?: Deadline) => {
      expect(given).toBe(deadline);
      expect(deadline.cancel).not.toHaveBeenCalled();
      return { added: true } as const;
    });

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        deadline: () => deadline,
        listWorktrees: async () => complete(worktrees),
        probe: probes([5183]),
        lockedFile: (lockedPath) =>
          lockedPath === sentinel
            ? {
                stageReplacement: async () => undefined,
                withLock: async (_deadline, work) => ({ kind: "done" as const, value: await work(openGate) }),
              }
            : {
                stageReplacement: async (_contents, _mode, gate) => {
                  expect(gate).toBe(openGate);
                  return staged;
                },
                withLock: async () => ({ kind: "unavailable" as const }),
              },
        addExclude,
      },
    );

    expect(commit).toHaveBeenCalledWith("create", openGate);
    expect(discard).toHaveBeenCalledWith();
    expect(result.ports[0]?.outcome).toEqual({ kind: "allocated", port: 5183 });
    expect(result.warnings).toEqual(["temporaryCleanupFailed"]);
    expect(addExclude).toHaveBeenCalledOnce();
    expect(deadline.cancel).toHaveBeenCalledOnce();
  });

  it("maps a retained exclude timeout without changing committed ports", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const { deadline } = manualDeadline();
    const retainedLockPath = path.join(repoId, "info", "exclude.anywhere-terminal.lock");
    const addExclude = vi.fn(async (_gitDir: string, _entry: string, given?: Deadline) => {
      expect(given).toBe(deadline);
      return {
        failed: "the repository-local exclude update timed out while a write was still pending",
        timedOut: true as const,
        retainedLockPath,
      };
    });

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        deadline: () => deadline,
        listWorktrees: async () => complete(worktrees),
        probe: probes([5183]),
        addExclude,
      },
    );

    expect(result.ports[0]?.outcome).toEqual({ kind: "allocated", port: 5183 });
    expect(result.warnings).toEqual(["excludeFailed", "lockRetained"]);
    expect(deadline.cancel).toHaveBeenCalledOnce();
  });

  it("turns a thrown exclude update into a warning without rejecting allocation", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => complete(worktrees),
        probe: probes([5183]),
        addExclude: async () => {
          throw new Error("denied");
        },
      },
    );

    expect(result.ports[0]?.outcome).toEqual({ kind: "allocated", port: 5183 });
    expect(result.warnings).toEqual(["excludeFailed"]);
  });

  it("refuses a substituted worktree root instead of publishing through it", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const worktreePath = worktrees[1] as string;
    const authorization = await authorizeDirectory(worktreePath);
    if (authorization === undefined) {
      throw new Error("the target could not be authorized");
    }
    const listing = await complete([repoPath, worktreePath]);
    const original = `${worktreePath}-original`;
    const redirected = path.join(path.dirname(worktreePath), "redirected");
    await mkdir(redirected);
    await rename(worktreePath, original);
    await symlink(redirected, worktreePath);

    const result = await allocateWorktreePorts(
      { repoId, repoPath, worktreePath, ports: [port("APP")], authorization },
      { listWorktrees: async () => listing, probe: probes([5183]) },
    );

    expect(result.ports[0]?.outcome).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("worktree directory"),
    });
    await expect(readFile(path.join(redirected, ".env.worktree"), "utf8")).rejects.toThrow();
  });

  it("downgrades retained outcomes when the authorized source changes", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(target, "APP=5183\n");
    class EditingLockedFile extends LockedFile {
      public override async stageReplacement(contents: string, mode: number | undefined) {
        const staged = await super.stageReplacement(contents, mode);
        if (this.path === target) {
          await writeFile(target, "# external edit\n");
        }
        return staged;
      }
    }

    const result = await allocate(
      {
        repoId,
        repoPath,
        worktreePath: worktrees[1] as string,
        ports: [port("APP"), port("DB")],
      },
      {
        listWorktrees: async () => complete(worktrees),
        probe: probes([5433]),
        lockedFile: (lockedPath) => new EditingLockedFile(lockedPath),
      },
    );

    expect(result.ports.map((item) => item.outcome.kind)).toEqual(["failed", "failed"]);
    expect(await readFile(target, "utf8")).toBe("# external edit\n");
  });

  it("reauthorizes retained-only claims before reporting reuse", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const target = path.join(worktrees[1] as string, ".env.worktree");
    await writeFile(target, "APP=5183\n");
    let targetStats = 0;

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => complete(worktrees),
        probe: probes([]),
        lstat: async (candidate) => {
          if (candidate === target && ++targetStats === 2) {
            await writeFile(target, "# external edit\n");
          }
          return stat(candidate);
        },
      },
    );

    expect(targetStats).toBeGreaterThan(1);
    expect(result.ports[0]?.outcome.kind).toBe("failed");
  });

  it("passes the remaining transaction budget into the fresh listing", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    let timeoutMs: number | undefined;

    await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        transactionMs: 50,
        listWorktrees: async (_root, options) => {
          timeoutMs = options.timeoutMs;
          return complete(worktrees);
        },
        probe: probes([5183]),
      },
    );

    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(50);
  });

  it("fails within the transaction when listing-time sibling authorization expires", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new", "sibling"]);
    const started = Date.now();

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        transactionMs: 10,
        listWorktrees: async (_path, options) => {
          await options.authorizationBudget.run(() => new Promise<void>(() => undefined));
          return complete(worktrees);
        },
      },
    );

    expect(Date.now() - started).toBeLessThan(200);
    expect(result.ports[0]?.outcome.kind).toBe("failed");
  });

  it("stops waiting when a listing dependency ignores its timeout", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const started = Date.now();
    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        transactionMs: 10,
        listWorktrees: () => new Promise<PortWorktreeListing>(() => undefined),
      },
    );

    expect(Date.now() - started).toBeLessThan(200);
    expect(result.ports[0]?.outcome).toEqual({
      kind: "failed",
      reason: "port allocation timed out before publication",
    });
  });

  it("reports listing failures as proof failures rather than lock contention", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new"]);
    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => {
          throw new Error("git listing failed");
        },
      },
    );

    expect(result.ports[0]?.outcome).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("listing"),
    });
    expect(result.ports[0]?.outcome).not.toMatchObject({ reason: expect.stringContaining("locked") });
  });

  it("uses bounded descriptor reads instead of buffering the whole claim file", async () => {
    const { repoId, repoPath, worktrees } = await fixture(["main", "new", "sibling"]);
    const siblingClaim = path.join(worktrees[2] as string, ".env.worktree");
    await writeFile(siblingClaim, "OTHER=5183\n");
    let largestRead = 0;

    const result = await allocate(
      { repoId, repoPath, worktreePath: worktrees[1] as string, ports: [port("APP")] },
      {
        listWorktrees: async () => complete(worktrees),
        probe: probes([5184]),
        open: async (target, flags) => {
          const handle = await open(target, flags);
          return {
            stat: () => handle.stat(),
            read: async (buffer, offset, length, position) => {
              largestRead = Math.max(largestRead, length);
              return handle.read(buffer, offset, length, position);
            },
            readFile: async () => {
              throw new Error("unbounded readFile must not be used");
            },
            close: () => handle.close(),
          };
        },
      },
    );

    expect(result.ports[0]?.outcome).toEqual({ kind: "allocated", port: 5184 });
    expect(largestRead).toBeLessThanOrEqual(64 * 1024 + 1);
  });
});
