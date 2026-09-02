import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { API, Repository } from "../providers/git";
import { afterDelay, type Deadline } from "./deadline";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import {
  captureMigrationDestination,
  MIGRATION_DEADLINE_MS,
  MIGRATION_MAX_BYTES,
  MIGRATION_MAX_GITFILE_BYTES,
  migrateChanges,
  migrationSourceStillAuthorized,
  probeMigrationSource,
  readMigrationSnapshot,
} from "./migrateChanges";

const execFile = promisify(execFileCallback);
const OID = "0".repeat(40);
const ordinary = (path: string) => `1 .M N... 100644 100644 100644 ${OID} ${OID} ${path}\0`;
const renamed = (to: string, from: string) => `2 R. N... 100644 100644 100644 ${OID} ${OID} R100 ${to}\0${from}\0`;
const copied = (to: string, from: string) => `2 C. N... 100644 100644 100644 ${OID} ${OID} C100 ${to}\0${from}\0`;
const untracked = (path: string) => `? ${path}\0`;

function result(stdout = "", code = 0, overrides: Partial<GitCommandResult> = {}): GitCommandResult {
  return {
    code,
    stdout: Buffer.from(stdout),
    stderr: code === 0 ? "" : "failed",
    timedOut: false,
    failedToSpawn: false,
    ...overrides,
  };
}

function runner(read: (cwd: string) => GitCommandResult): GitCommandRunner {
  return { run: vi.fn(async (_args, cwd) => read(cwd)) };
}

function repository(root: string, migrate = vi.fn(async () => {})): Repository {
  return {
    rootUri: { fsPath: root } as Repository["rootUri"],
    state: {
      workingTreeChanges: [],
      indexChanges: [],
      mergeChanges: [],
      untrackedChanges: [],
      onDidChange: (() => ({ dispose: () => {} })) as Repository["state"]["onDidChange"],
    },
    migrateChanges: migrate,
  };
}

function api(openRepository: API["openRepository"]): API {
  return {
    state: "initialized",
    repositories: [],
    onDidChangeState: (() => ({ dispose: () => {} })) as API["onDidChangeState"],
    onDidOpenRepository: (() => ({ dispose: () => {} })) as API["onDidOpenRepository"],
    onDidCloseRepository: (() => ({ dispose: () => {} })) as API["onDidCloseRepository"],
    openRepository,
  };
}

const uri = (path: string) => ({ fsPath: path }) as Repository["rootUri"];

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function worktree(name: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `migration-${name}-`)));
  roots.push(root);
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return root;
}

async function linkedWorktree(name: string): Promise<{ root: string; admin: string }> {
  const root = await worktree(name);
  const admin = join(root, "admin");
  await rm(join(root, ".git"), { recursive: true });
  await mkdir(admin);
  await writeFile(join(admin, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(join(admin, "gitdir"), `${join(root, ".git")}\n`);
  await writeFile(join(admin, "commondir"), "../..\n");
  await writeFile(join(root, ".git"), `gitdir: ${admin}\n`);
  return { root, admin };
}

async function registeredLinkedWorktree(name: string): Promise<{ root: string; admin: string; common: string }> {
  const common = await realpath(await mkdtemp(join(tmpdir(), `migration-common-${name}-`)));
  const root = await realpath(await mkdtemp(join(tmpdir(), `migration-linked-${name}-`)));
  roots.push(common, root);
  const admin = join(common, "worktrees", name);
  await mkdir(admin, { recursive: true });
  await writeFile(join(admin, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(join(admin, "gitdir"), `${join(root, ".git")}\n`);
  await writeFile(join(admin, "commondir"), "../..\n");
  await writeFile(join(root, ".git"), `gitdir: ${admin}\n`);
  return { root, admin, common };
}

async function migrationInput(
  sourcePath: string,
  destinationPath: string,
  offered: NonNullable<Awaited<ReturnType<typeof probeMigrationSource>>>,
) {
  const destination = await captureMigrationDestination(join(destinationPath, ".git"), destinationPath);
  if (destination === undefined) {
    throw new Error("destination fixture was not authorized");
  }
  return {
    sourcePath,
    destinationPath,
    source: offered.source,
    destination,
    snapshot: offered.snapshot,
  };
}

describe("readMigrationSnapshot", () => {
  it("counts ordinary and untracked paths and snapshots their bytes", async () => {
    const root = await worktree("snapshot");
    await writeFile(join(root, "tracked.txt"), "tracked");
    await writeFile(join(root, "new.txt"), "new");

    const git = runner(() => result(ordinary("tracked.txt") + untracked("new.txt")));
    const snapshot = await readMigrationSnapshot(git, root);

    expect(git.run).toHaveBeenCalledWith(["status", "--porcelain=v2", "-z", "--untracked-files=all"], root, {
      timeoutMs: MIGRATION_DEADLINE_MS,
      maxBufferBytes: MIGRATION_MAX_BYTES,
    });
    expect(snapshot?.count).toBe(2);
    expect(snapshot?.records.map((record) => record.path)).toEqual(["tracked.txt", "new.txt"]);
    expect(snapshot?.states.map((state) => [state.path, state.kind])).toEqual([
      ["new.txt", "file"],
      ["tracked.txt", "file"],
    ]);
  });

  it("retains a rename origin without counting it twice", async () => {
    const root = await worktree("rename");
    await writeFile(join(root, "new.txt"), "renamed");

    const snapshot = await readMigrationSnapshot(
      runner(() => result(renamed("new.txt", "old.txt"))),
      root,
    );

    expect(snapshot?.count).toBe(1);
    expect(snapshot?.records).toEqual([
      {
        kind: "rename",
        path: "new.txt",
        originalPath: "old.txt",
        signature: `2 R. N... 100644 100644 100644 ${OID} ${OID} R100`,
      },
    ]);
    expect(snapshot?.states.map((state) => [state.path, state.kind])).toEqual([
      ["new.txt", "file"],
      ["old.txt", "absent"],
    ]);
  });

  it("records a deleted path as absent when its former parent is also gone", async () => {
    const root = await worktree("nested-deletion");

    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("removed/file.txt"))),
        root,
      ),
    ).toMatchObject({ states: [{ path: "removed/file.txt", kind: "absent" }] });
  });

  it("retains a copy origin while snapshotting only the copied path", async () => {
    const root = await worktree("copy");
    await writeFile(join(root, "source.txt"), "source");
    await writeFile(join(root, "copy.txt"), "source");

    const snapshot = await readMigrationSnapshot(
      runner(() => result(copied("copy.txt", "source.txt"))),
      root,
    );

    expect(snapshot?.count).toBe(1);
    expect(snapshot?.records).toEqual([
      {
        kind: "copy",
        path: "copy.txt",
        originalPath: "source.txt",
        signature: `2 C. N... 100644 100644 100644 ${OID} ${OID} C100`,
      },
    ]);
    expect(snapshot?.states.map((state) => [state.path, state.kind])).toEqual([["copy.txt", "file"]]);
  });

  it("captures absence, symlink targets, directories, modes, and streamed file bytes", async () => {
    const root = await worktree("state-kinds");
    await writeFile(join(root, "executable"), Buffer.alloc(128 * 1024, 7));
    await chmod(join(root, "executable"), 0o755);
    await symlink("executable", join(root, "link"));
    await mkdir(join(root, "folder"));

    const snapshot = await readMigrationSnapshot(
      runner(() => result(ordinary("deleted") + ordinary("executable") + ordinary("link") + ordinary("folder"))),
      root,
      { maxBytes: 256 * 1024 },
    );

    expect(snapshot?.states).toEqual([
      { path: "deleted", kind: "absent" },
      { path: "executable", kind: "file", mode: 0o755, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { path: "folder", kind: "directory", mode: expect.any(Number) },
      { path: "link", kind: "symlink", mode: expect.any(Number), target: "executable" },
    ]);
  });

  it("shares one byte budget between status output and streamed file hashing", async () => {
    const root = await worktree("shared-budget");
    const content = Buffer.alloc(64 * 1024, 3);
    await writeFile(join(root, "large.bin"), content);
    const status = ordinary("large.bin");
    const exactBudget = Buffer.byteLength(status) + content.length;

    expect(
      await readMigrationSnapshot(
        runner(() => result(status)),
        root,
        { maxBytes: exactBudget },
      ),
    ).toBeDefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result(status)),
        root,
        { maxBytes: exactBudget - 1 },
      ),
    ).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "refuses a regular file replaced by a writerless FIFO without waiting on a writer",
    async () => {
      const root = await worktree("fifo-replacement");
      const target = join(root, "changing");
      const replacement = join(root, "replacement.fifo");
      await writeFile(target, "before");
      await execFile("mkfifo", [replacement]);
      let replaced = false;
      const snapshot = readMigrationSnapshot(
        runner(() => result(ordinary("changing"))),
        root,
        {
          fs: {
            lstat: async (candidate) => {
              const stat = await lstat(candidate);
              if (candidate === target && !replaced) {
                replaced = true;
                await rename(replacement, target);
              }
              return stat;
            },
            readlink,
            open: (candidate, flags) => open(candidate, flags),
          },
        },
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<"waited">((resolve) => {
        timer = setTimeout(() => resolve("waited"), 500);
      });

      const outcome = await Promise.race([snapshot.then((value) => ({ kind: "settled" as const, value })), waited]);
      if (timer !== undefined) {
        clearTimeout(timer);
      }

      expect(outcome).toEqual({ kind: "settled", value: undefined });
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a regular path replaced by a symlink outside the worktree",
    async () => {
      const root = await worktree("symlink-replacement");
      const outside = await worktree("symlink-outside");
      const target = join(root, "changing");
      const external = join(outside, "external");
      await writeFile(target, "before");
      await writeFile(external, "outside");
      let replaced = false;

      const snapshot = await readMigrationSnapshot(
        runner(() => result(ordinary("changing"))),
        root,
        {
          fs: {
            lstat: async (candidate) => {
              const stat = await lstat(candidate);
              if (candidate === target && !replaced) {
                replaced = true;
                await rm(target);
                await symlink(external, target);
              }
              return stat;
            },
            readlink,
            open: (candidate, flags) => open(candidate, flags),
          },
        },
      );

      expect(snapshot).toBeUndefined();
    },
  );

  it("closes an opened handle when the helper's initial fstat stalls", async () => {
    const root = await worktree("stalled-fstat");
    await writeFile(join(root, "changing"), "content");
    let closeHandle: ReturnType<typeof vi.spyOn> | undefined;
    let releaseStat: (() => void) | undefined;

    const snapshot = readMigrationSnapshot(
      runner(() => result(ordinary("changing"))),
      root,
      {
        fs: {
          lstat,
          readlink,
          open: async (candidate, flags) => {
            const handle = await open(candidate, flags);
            const stat = await handle.stat();
            vi.spyOn(handle, "stat").mockImplementationOnce(
              () =>
                new Promise((resolve) => {
                  releaseStat = () => resolve(stat);
                }),
            );
            closeHandle = vi.spyOn(handle, "close");
            return handle;
          },
        },
        makeDeadline: () => afterDelay(50),
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<"waited">((resolve) => {
      timer = setTimeout(() => resolve("waited"), 500);
    });

    const outcome = await Promise.race([snapshot.then((value) => ({ kind: "settled" as const, value })), waited]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    releaseStat?.();
    await Promise.resolve();

    expect(outcome).toEqual({ kind: "settled", value: undefined });
    expect(closeHandle).toHaveBeenCalled();
  });

  it("closes a handle whose open resolves after the deadline before fstat stalls", async () => {
    const root = await worktree("late-open-stalled-fstat");
    const target = join(root, "changing");
    await writeFile(target, "content");
    let releaseOpen: (() => Promise<void>) | undefined;
    let releaseStat: (() => void) | undefined;
    let closeHandle: ReturnType<typeof vi.spyOn> | undefined;
    const pendingOpen = new Promise<Awaited<ReturnType<typeof open>>>((resolve) => {
      releaseOpen = async () => {
        const handle = await open(target, "r");
        const stat = await handle.stat();
        vi.spyOn(handle, "stat").mockImplementationOnce(
          () =>
            new Promise((finish) => {
              releaseStat = () => finish(stat);
            }),
        );
        closeHandle = vi.spyOn(handle, "close");
        resolve(handle);
      };
    });

    const snapshot = await readMigrationSnapshot(
      runner(() => result(ordinary("changing"))),
      root,
      {
        fs: {
          lstat,
          readlink,
          open: async () => pendingOpen,
        },
        makeDeadline: () => afterDelay(50),
      },
    );
    expect(snapshot).toBeUndefined();

    await releaseOpen?.();
    await Promise.resolve();
    expect(closeHandle).toHaveBeenCalled();
    releaseStat?.();
  });

  it("refuses when the opened file's path becomes a same-identity symlink", async () => {
    const root = await worktree("same-identity-symlink");
    const target = join(root, "changing");
    await writeFile(target, "content");
    const stat = await lstat(target);
    const symlinkStat = {
      ...stat,
      isFile: () => false,
      isSymbolicLink: () => true,
    } as typeof stat;
    let reads = 0;

    const snapshot = await readMigrationSnapshot(
      runner(() => result(ordinary("changing"))),
      root,
      {
        fs: {
          lstat: async (candidate) => {
            if (candidate !== target) {
              return lstat(candidate);
            }
            reads += 1;
            return reads === 1 ? stat : symlinkStat;
          },
          readlink,
          open: (candidate, flags) => open(candidate, flags),
        },
      },
    );

    expect(snapshot).toBeUndefined();
  });

  it("closes every regular-file handle after a successful snapshot", async () => {
    const root = await worktree("closed-handle");
    await writeFile(join(root, "changing"), "content");
    const closes: Array<ReturnType<typeof vi.spyOn>> = [];

    const snapshot = await readMigrationSnapshot(
      runner(() => result(ordinary("changing"))),
      root,
      {
        fs: {
          lstat,
          readlink,
          open: async (candidate, flags) => {
            const handle = await open(candidate, flags);
            closes.push(vi.spyOn(handle, "close"));
            return handle;
          },
        },
      },
    );

    expect(snapshot).toBeDefined();
    expect(closes).toHaveLength(1);
    expect(closes[0]).toHaveBeenCalledOnce();
  });

  it("returns undefined within the deadline when handle close stalls", async () => {
    const root = await worktree("stalled-close");
    const target = join(root, "changing");
    await writeFile(target, "content");
    let releaseClose: (() => Promise<void>) | undefined;

    const snapshot = readMigrationSnapshot(
      runner(() => result(ordinary("changing"))),
      root,
      {
        fs: {
          lstat,
          readlink,
          open: async (candidate, flags) => {
            const handle = await open(candidate, flags);
            const close = handle.close.bind(handle);
            vi.spyOn(handle, "close").mockImplementation(
              () =>
                new Promise<void>((resolve) => {
                  releaseClose = async () => {
                    await close();
                    resolve();
                  };
                }),
            );
            return handle;
          },
        },
        makeDeadline: () => afterDelay(50),
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<"waited">((resolve) => {
      timer = setTimeout(() => resolve("waited"), 500);
    });

    const outcome = await Promise.race([snapshot.then((value) => ({ kind: "settled" as const, value })), waited]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    await releaseClose?.();

    expect(outcome).toEqual({ kind: "settled", value: undefined });
  });

  it("refuses unresolved, malformed, failed, unreadable, and over-budget snapshots", async () => {
    const root = await worktree("unmerged");
    await writeFile(join(root, "file.txt"), "content");
    expect(
      await readMigrationSnapshot(
        runner(() => result("u UU N... 100644 100644 100644 100644 a b c file.txt\0")),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("file.txt").slice(0, -1))),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result("x unsupported\0")),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result(`1 ZZ N... nope 100644 100644 ${OID} ${OID} file.txt\0`)),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result(`2 R. N... 100644 100644 100644 ${OID} ${OID} R101 file.txt\0old.txt\0`)),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result("\0")),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("../outside"))),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result("", 1)),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result("", 0, { timedOut: true })),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result("", 0, { failedToSpawn: true })),
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        {
          run: vi.fn(async () => ({ ...result(), stdout: Buffer.from([0x3f, 0x20, 0xff, 0]) })),
        },
        root,
      ),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot({ run: vi.fn(async () => Promise.reject(new Error("status unreadable"))) }, root),
    ).toBeUndefined();
    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("file.txt"))),
        root,
        { maxBytes: 1 },
      ),
    ).toBeUndefined();
    const expired: Deadline = { elapsed: Promise.resolve(), expired: true, cancel: vi.fn() };
    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("file.txt"))),
        root,
        {
          makeDeadline: () => expired,
        },
      ),
    ).toBeUndefined();
  });

  it("refuses a static intermediate symlink that redirects a changed file outside the source", async () => {
    const root = await worktree("intermediate-static");
    const outside = await worktree("intermediate-static-outside");
    await writeFile(join(outside, "file.txt"), "outside");
    await symlink(outside, join(root, "dir"));

    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("dir/file.txt"))),
        root,
      ),
    ).toBeUndefined();
  });

  it("refuses an absent changed path behind a static intermediate symlink", async () => {
    const root = await worktree("intermediate-absent");
    const outside = await worktree("intermediate-absent-outside");
    await symlink(outside, join(root, "dir"));

    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("dir/missing.txt"))),
        root,
      ),
    ).toBeUndefined();
  });

  it("refuses a missing intermediate directory that becomes an outside symlink during the read", async () => {
    const root = await worktree("intermediate-created");
    const outside = await worktree("intermediate-created-outside");
    const target = join(root, "dir", "missing.txt");
    let replaced = false;

    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("dir/missing.txt"))),
        root,
        {
          fs: {
            lstat: async (candidate) => {
              if (candidate === target && !replaced) {
                replaced = true;
                await symlink(outside, join(root, "dir"));
              }
              return lstat(candidate);
            },
            readlink,
            open,
          },
        },
      ),
    ).toBeUndefined();
  });

  it("refuses an intermediate directory that persistently becomes an outside symlink during the read", async () => {
    const root = await worktree("intermediate-race");
    const outside = await worktree("intermediate-race-outside");
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "dir", "file.txt"), "inside");
    await writeFile(join(outside, "file.txt"), "outside");
    const target = join(root, "dir", "file.txt");
    let replaced = false;

    expect(
      await readMigrationSnapshot(
        runner(() => result(ordinary("dir/file.txt"))),
        root,
        {
          fs: {
            lstat: async (candidate) => {
              if (candidate === target && !replaced) {
                replaced = true;
                await rename(join(root, "dir"), join(root, "dir-old"));
                await symlink(outside, join(root, "dir"));
              }
              return lstat(candidate);
            },
            readlink,
            open,
          },
        },
      ),
    ).toBeUndefined();
  });
});

describe("migration source evidence", () => {
  it("detects in-place rewrites of the .git entry and its admin state", async () => {
    const { root, admin } = await linkedWorktree("identity");
    await writeFile(join(root, "a.txt"), "a");
    const offered = await probeMigrationSource(
      api(async () => repository(root)),
      root,
      {
        runner: runner(() => result(ordinary("a.txt"))),
        uri,
      },
    );
    expect(offered).toBeDefined();

    await writeFile(join(root, ".git"), `gitdir: ${admin}-replacement\n`);
    expect(await migrationSourceStillAuthorized(offered!.source)).toBe(false);

    await writeFile(join(root, ".git"), `gitdir: ${admin}\n`);
    await writeFile(join(admin, "HEAD"), "ref: refs/heads/other\n");
    expect(await migrationSourceStillAuthorized(offered!.source)).toBe(false);
  });

  it("shares one bounded stream budget across changed bytes and source identity evidence", async () => {
    const root = await worktree("evidence-budget");
    await writeFile(join(root, "a.txt"), Buffer.alloc(24 * 1024, 1));
    await writeFile(join(root, ".git", "HEAD"), Buffer.alloc(24 * 1024, 2));
    const status = ordinary("a.txt");
    const eachReadFits = 32 * 1024;

    expect(Buffer.byteLength(status) + 24 * 1024).toBeLessThan(eachReadFits);
    expect(
      await probeMigrationSource(
        api(async () => repository(root)),
        root,
        {
          runner: runner(() => result(status)),
          uri,
          maxBytes: eachReadFits,
        },
      ),
    ).toBeUndefined();
  });

  it("detects source-directory, .git-entry, and admin-directory replacement", async () => {
    const sourceReplacement = await linkedWorktree("source-replacement");
    await writeFile(join(sourceReplacement.root, "a.txt"), "a");
    const sourceOffer = await probeMigrationSource(
      api(async () => repository(sourceReplacement.root)),
      sourceReplacement.root,
      {
        runner: runner(() => result(ordinary("a.txt"))),
        uri,
      },
    );
    const oldRoot = `${sourceReplacement.root}-old`;
    await rename(sourceReplacement.root, oldRoot);
    roots.push(oldRoot);
    await mkdir(sourceReplacement.root);
    await mkdir(join(sourceReplacement.root, ".git"));
    await writeFile(join(sourceReplacement.root, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(await migrationSourceStillAuthorized(sourceOffer!.source)).toBe(false);

    const gitReplacement = await linkedWorktree("git-replacement");
    await writeFile(join(gitReplacement.root, "a.txt"), "a");
    const gitOffer = await probeMigrationSource(
      api(async () => repository(gitReplacement.root)),
      gitReplacement.root,
      {
        runner: runner(() => result(ordinary("a.txt"))),
        uri,
      },
    );
    await rename(join(gitReplacement.root, ".git"), join(gitReplacement.root, ".git-old"));
    await writeFile(join(gitReplacement.root, ".git"), `gitdir: ${gitReplacement.admin}\n`);
    expect(await migrationSourceStillAuthorized(gitOffer!.source)).toBe(false);

    const adminReplacement = await linkedWorktree("admin-replacement");
    await writeFile(join(adminReplacement.root, "a.txt"), "a");
    const adminOffer = await probeMigrationSource(
      api(async () => repository(adminReplacement.root)),
      adminReplacement.root,
      {
        runner: runner(() => result(ordinary("a.txt"))),
        uri,
      },
    );
    await rename(adminReplacement.admin, `${adminReplacement.admin}-old`);
    await mkdir(adminReplacement.admin);
    await writeFile(join(adminReplacement.admin, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(adminReplacement.admin, "gitdir"), `${join(adminReplacement.root, ".git")}\n`);
    await writeFile(join(adminReplacement.admin, "commondir"), "../..\n");
    expect(await migrationSourceStillAuthorized(adminOffer!.source)).toBe(false);
  });

  it("accepts a standalone separate-git-dir source without linked-worktree metadata", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "migration-separate-source-")));
    const admin = await realpath(await mkdtemp(join(tmpdir(), "migration-separate-admin-")));
    roots.push(root, admin);
    await writeFile(join(root, ".git"), `gitdir: ${admin}\n`);
    await writeFile(join(admin, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(root, "a.txt"), "a");

    expect(
      await probeMigrationSource(
        api(async () => repository(root)),
        root,
        {
          runner: runner(() => result(ordinary("a.txt"))),
          uri,
        },
      ),
    ).toMatchObject({ source: { git: { commonPath: admin } } });
  });

  it("withholds an offer when source evidence changes across its status snapshot", async () => {
    const root = await worktree("offer-bracket");
    await writeFile(join(root, "a.txt"), "a");
    const git: GitCommandRunner = {
      run: vi.fn(async () => {
        await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/replaced\n");
        return result(ordinary("a.txt"));
      }),
    };

    expect(
      await probeMigrationSource(
        api(async () => repository(root)),
        root,
        { runner: git, uri },
      ),
    ).toBeUndefined();
  });

  it("captures only a destination registered under the expected common repository and back-pointer", async () => {
    const linked = await registeredLinkedWorktree("destination-evidence");

    expect(await captureMigrationDestination(linked.common, linked.root)).toMatchObject({
      path: linked.root,
      git: { commonPath: linked.common, backPointerPath: join(linked.root, ".git") },
    });
    expect(await captureMigrationDestination(`${linked.common}-other`, linked.root)).toBeUndefined();

    await writeFile(join(linked.admin, "gitdir"), "/different/worktree/.git\n");
    expect(await captureMigrationDestination(linked.common, linked.root)).toBeUndefined();
  });

  it("refuses an oversized linked-worktree gitfile before it can consume the general snapshot budget", async () => {
    const linked = await linkedWorktree("oversized-gitfile");
    await writeFile(join(linked.root, ".git"), Buffer.alloc(MIGRATION_MAX_GITFILE_BYTES + 1, 1));

    expect(
      await probeMigrationSource(
        api(async () => repository(linked.root)),
        linked.root,
        {
          runner: runner(() => result(ordinary("a.txt"))),
          uri,
        },
      ),
    ).toBeUndefined();
  });

  it("accepts a worst-case Windows-sized UTF-8 gitdir path below the host-safe cap", async () => {
    const linked = await registeredLinkedWorktree("long-gitdir");
    const longAdmin = `/${"界".repeat(45_100)}`;
    const content = `gitdir: ${longAdmin}\n`;
    expect(Buffer.byteLength(content)).toBeGreaterThan(132 * 1024);
    expect(Buffer.byteLength(content)).toBeLessThan(MIGRATION_MAX_GITFILE_BYTES);
    await writeFile(join(linked.root, ".git"), content);
    await writeFile(join(linked.admin, "commondir"), `${linked.common}\n`);
    const mapped = (candidate: string): string =>
      candidate === longAdmin || candidate.startsWith(`${longAdmin}/`)
        ? join(linked.admin, candidate.slice(longAdmin.length + 1))
        : candidate;
    const allocations: number[] = [];
    const allocate = Buffer.allocUnsafe;
    vi.spyOn(Buffer, "allocUnsafe").mockImplementation((size) => {
      allocations.push(size);
      return allocate(size);
    });

    expect(
      await probeMigrationSource(
        api(async () => repository(linked.root)),
        linked.root,
        {
          runner: runner(() => result(ordinary("a.txt"))),
          uri,
          fs: {
            lstat: (candidate) => lstat(mapped(candidate)),
            readlink: (candidate) => readlink(mapped(candidate)),
            open: (candidate, flags) => open(mapped(candidate), flags),
          },
        },
      ),
    ).toBeDefined();
    const gitfileBytes = Buffer.byteLength(content);
    expect(allocations.filter((size) => size === gitfileBytes)).toHaveLength(2);
    expect(Math.max(...allocations)).toBe(gitfileBytes);
  });
});

describe("migrateChanges", () => {
  it("opens the exact source before issuing an offer", async () => {
    const root = await worktree("offer");
    await writeFile(join(root, "a.txt"), "a");
    const openRepository = vi.fn(async () => repository(root));

    const offered = await probeMigrationSource(api(openRepository), root, {
      runner: runner(() => result(ordinary("a.txt"))),
      uri,
    });

    expect(offered?.snapshot.count).toBe(1);
    expect(openRepository).toHaveBeenCalledWith({ fsPath: root });
  });

  it("withholds offers for unavailable, null, rejected, incapable, and late repository opens", async () => {
    const root = await worktree("offer-failures");
    await writeFile(join(root, "a.txt"), "a");
    const git = runner(() => result(ordinary("a.txt")));
    const withoutOpen = api(undefined);
    const incapable = repository(root);
    delete (incapable as { migrateChanges?: Repository["migrateChanges"] }).migrateChanges;

    expect(await probeMigrationSource(undefined, root, { runner: git, uri })).toBeUndefined();
    expect(await probeMigrationSource(withoutOpen, root, { runner: git, uri })).toBeUndefined();
    expect(
      await probeMigrationSource(
        api(async () => null),
        root,
        { runner: git, uri },
      ),
    ).toBeUndefined();
    expect(
      await probeMigrationSource(
        api(async () => Promise.reject(new Error("open failed"))),
        root,
        { runner: git, uri },
      ),
    ).toBeUndefined();
    expect(
      await probeMigrationSource(
        api(async () => incapable),
        root,
        { runner: git, uri },
      ),
    ).toBeUndefined();
    expect(
      await probeMigrationSource(
        api(async () => repository(dirname(root))),
        root,
        { runner: git, uri },
      ),
    ).toBeUndefined();

    let finishOpen: ((value: Repository | null) => void) | undefined;
    const lateOpen = new Promise<Repository | null>((resolve) => {
      finishOpen = resolve;
    });
    const expired: Deadline = { elapsed: Promise.resolve(), expired: true, cancel: vi.fn() };
    expect(
      await probeMigrationSource(
        api(async () => lateOpen),
        root,
        {
          runner: git,
          uri,
          makeDeadline: () => expired,
        },
      ),
    ).toBeUndefined();
    finishOpen?.(repository(root));
  });

  it("reports moved only for empty source and the exact destination snapshot", async () => {
    const source = await worktree("source");
    const destination = await worktree("destination");
    await writeFile(join(source, "a.txt"), "wanted");
    let moved = false;
    const git = runner((cwd) => {
      if (!moved) {
        return result(cwd === source ? ordinary("a.txt") : "");
      }
      return result(cwd === source ? "" : ordinary("a.txt"));
    });
    const migrate = vi.fn(async () => {
      await writeFile(join(destination, "a.txt"), "wanted");
      moved = true;
    });
    const opened = api(async (value) => repository(value.fsPath, value.fsPath === destination ? migrate : vi.fn()));
    const offered = await probeMigrationSource(opened, source, { runner: git, uri });

    const outcome = await migrateChanges(await migrationInput(source, destination, offered!), {
      api: opened,
      runner: git,
      uri,
    });

    expect(outcome).toEqual({ kind: "moved" });
    expect(migrate).toHaveBeenCalledWith(source, {
      confirmation: false,
      deleteFromSource: true,
      untracked: true,
    });
  });

  it("refuses persistent destination identity drift before and after the Git call", async () => {
    for (const phase of ["before", "after"] as const) {
      const source = await worktree(`destination-drift-${phase}-source`);
      const destination = await worktree(`destination-drift-${phase}-destination`);
      await writeFile(join(source, "a.txt"), "wanted");
      let moved = false;
      const git = runner((cwd) =>
        result(!moved ? (cwd === source ? ordinary("a.txt") : "") : cwd === source ? "" : ordinary("a.txt")),
      );
      const migrate = vi.fn(async () => {
        await writeFile(join(destination, "a.txt"), "wanted");
        await writeFile(join(destination, ".git", "HEAD"), "ref: refs/heads/replaced\n");
        moved = true;
      });
      const opened = api(async (value) => repository(value.fsPath, value.fsPath === destination ? migrate : vi.fn()));
      const offered = await probeMigrationSource(opened, source, { runner: git, uri });
      const input = await migrationInput(source, destination, offered!);
      if (phase === "before") {
        await writeFile(join(destination, ".git", "HEAD"), "ref: refs/heads/replaced\n");
      }

      expect(await migrateChanges(input, { api: opened, runner: git, uri })).toEqual({
        kind: "indeterminate",
        reason:
          phase === "before"
            ? "the source or destination changed before migration"
            : "the migration result could not be verified",
      });
      expect(migrate).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
    }
  });

  it("rejects a source .git substitution bracketed around the post-call snapshot", async () => {
    const source = await worktree("post-bracket-source");
    const destination = await worktree("post-bracket-destination");
    await writeFile(join(source, "a.txt"), "wanted");
    let moved = false;
    let rewroteSource = false;
    const git: GitCommandRunner = {
      run: vi.fn(async (_args, cwd) => {
        if (moved && cwd === source && !rewroteSource) {
          rewroteSource = true;
          await writeFile(join(source, ".git", "HEAD"), "ref: refs/heads/replaced\n");
        }
        return result(!moved ? (cwd === source ? ordinary("a.txt") : "") : cwd === source ? "" : ordinary("a.txt"));
      }),
    };
    const migrate = vi.fn(async () => {
      await writeFile(join(destination, "a.txt"), "wanted");
      moved = true;
    });
    const opened = api(async (value) => repository(value.fsPath, value.fsPath === destination ? migrate : vi.fn()));
    const offered = await probeMigrationSource(opened, source, { runner: git, uri });

    expect(
      await migrateChanges(await migrationInput(source, destination, offered!), { api: opened, runner: git, uri }),
    ).toEqual({ kind: "indeterminate", reason: "the migration result could not be verified" });
    expect(rewroteSource).toBe(true);
  });

  it("reports indeterminate when destination bytes do not match", async () => {
    const source = await worktree("source-mismatch");
    const destination = await worktree("destination-mismatch");
    await writeFile(join(source, "a.txt"), "wanted");
    let moved = false;
    const git = runner((cwd) =>
      result(!moved ? (cwd === source ? ordinary("a.txt") : "") : cwd === source ? "" : ordinary("a.txt")),
    );
    const opened = api(async (value) =>
      repository(
        value.fsPath,
        value.fsPath === destination
          ? vi.fn(async () => {
              await writeFile(join(destination, "a.txt"), "different");
              moved = true;
            })
          : vi.fn(),
      ),
    );
    const offered = await probeMigrationSource(opened, source, { runner: git, uri });

    expect(
      await migrateChanges(await migrationInput(source, destination, offered!), { api: opened, runner: git, uri }),
    ).toEqual({ kind: "indeterminate", reason: "the migration result could not be verified" });
  });

  it("rejects matching destination bytes under different record topology", async () => {
    const source = await worktree("topology-source");
    const destination = await worktree("topology-destination");
    await writeFile(join(source, "a.txt"), "wanted");
    let moved = false;
    const git = runner((cwd) =>
      result(!moved ? (cwd === source ? ordinary("a.txt") : "") : cwd === source ? "" : copied("a.txt", "b.txt")),
    );
    const migrate = vi.fn(async () => {
      await writeFile(join(destination, "a.txt"), "wanted");
      moved = true;
    });
    const opened = api(async (value) => repository(value.fsPath, value.fsPath === destination ? migrate : vi.fn()));
    const offered = await probeMigrationSource(opened, source, { runner: git, uri });

    expect(
      await migrateChanges(await migrationInput(source, destination, offered!), { api: opened, runner: git, uri }),
    ).toEqual({ kind: "indeterminate", reason: "the migration result could not be verified" });
  });

  it("keeps mode, extra-path, unmerged, dirty-source, and failed-read post-states indeterminate", async () => {
    const source = await worktree("matrix-source");
    await writeFile(join(source, "a.txt"), "wanted");
    await chmod(join(source, "a.txt"), 0o755);
    const offered = await probeMigrationSource(
      api(async () => repository(source)),
      source,
      {
        runner: runner(() => result(ordinary("a.txt"))),
        uri,
      },
    );

    const scenarios = ["mode", "extra", "unmerged", "source-dirty", "read-failed"] as const;
    for (const scenario of scenarios) {
      const destination = await worktree(`matrix-${scenario}`);
      let moved = false;
      const git = runner((cwd) => {
        if (!moved) {
          return result(cwd === source ? ordinary("a.txt") : "");
        }
        if (cwd === source) {
          return result(scenario === "source-dirty" ? ordinary("a.txt") : "");
        }
        if (scenario === "unmerged") {
          return result("u UU N... 100644 100644 100644 100644 a b c a.txt\0");
        }
        if (scenario === "read-failed") {
          return result("", 1);
        }
        return result(ordinary("a.txt") + (scenario === "extra" ? ordinary("extra.txt") : ""));
      });
      const migrate = vi.fn(async () => {
        await writeFile(join(destination, "a.txt"), "wanted");
        if (scenario !== "mode") {
          await chmod(join(destination, "a.txt"), 0o755);
        }
        if (scenario === "extra") {
          await writeFile(join(destination, "extra.txt"), "extra");
        }
        moved = true;
      });
      const opened = api(async (value) => repository(value.fsPath, value.fsPath === destination ? migrate : vi.fn()));

      expect(
        await migrateChanges(await migrationInput(source, destination, offered!), { api: opened, runner: git, uri }),
      ).toEqual({ kind: "indeterminate", reason: "the migration result could not be verified" });
      expect(migrate).toHaveBeenCalledOnce();
    }
  });

  it("rejects a destination symlink with a different target", async () => {
    const source = await worktree("link-source");
    const destination = await worktree("link-destination");
    await symlink("wanted-target", join(source, "link"));
    let moved = false;
    const git = runner((cwd) =>
      result(!moved ? (cwd === source ? ordinary("link") : "") : cwd === source ? "" : ordinary("link")),
    );
    const migrate = vi.fn(async () => {
      await symlink("different-target", join(destination, "link"));
      moved = true;
    });
    const opened = api(async (value) => repository(value.fsPath, value.fsPath === destination ? migrate : vi.fn()));
    const offered = await probeMigrationSource(opened, source, { runner: git, uri });

    expect(
      await migrateChanges(await migrationInput(source, destination, offered!), { api: opened, runner: git, uri }),
    ).toEqual({ kind: "indeterminate", reason: "the migration result could not be verified" });
  });

  it("verifies rename absence as part of the destination result", async () => {
    const source = await worktree("rename-source");
    const destination = await worktree("rename-destination");
    await writeFile(join(source, "new.txt"), "renamed");
    let moved = false;
    const git = runner((cwd) => {
      if (!moved) {
        return result(cwd === source ? renamed("new.txt", "old.txt") : "");
      }
      return result(cwd === source ? "" : renamed("new.txt", "old.txt"));
    });
    const migrate = vi.fn(async () => {
      await writeFile(join(destination, "new.txt"), "renamed");
      moved = true;
    });
    const opened = api(async (value) => repository(value.fsPath, value.fsPath === destination ? migrate : vi.fn()));
    const offered = await probeMigrationSource(opened, source, { runner: git, uri });

    expect(
      await migrateChanges(await migrationInput(source, destination, offered!), { api: opened, runner: git, uri }),
    ).toEqual({ kind: "moved" });
  });

  it("does not let evidence for one source authorize another source path", async () => {
    const authorized = await worktree("authorized-source");
    const substituted = await worktree("substituted-source");
    const destination = await worktree("substituted-destination");
    await writeFile(join(authorized, "a.txt"), "same");
    await writeFile(join(substituted, "a.txt"), "same");
    const git = runner((cwd) => result(cwd === destination ? "" : ordinary("a.txt")));
    const opened = api(async (value) => repository(value.fsPath));
    const offered = await probeMigrationSource(opened, authorized, { runner: git, uri });
    const migrate = vi.fn(async () => {});

    expect(
      await migrateChanges(
        {
          sourcePath: substituted,
          destinationPath: destination,
          source: offered!.source,
          snapshot: offered!.snapshot,
        },
        { api: api(async (value) => repository(value.fsPath, migrate)), runner: git, uri },
      ),
    ).toEqual({ kind: "indeterminate", reason: "the migration source does not match its authorization" });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("does not enter the API after source drift or a dirty destination", async () => {
    const source = await worktree("drift-source");
    const destination = await worktree("drift-destination");
    await writeFile(join(source, "a.txt"), "a");
    await writeFile(join(source, "b.txt"), "b");
    await writeFile(join(destination, "other.txt"), "other");
    let offered = true;
    const git = runner((cwd) => {
      if (cwd === source) {
        return result(offered ? ordinary("a.txt") : ordinary("b.txt"));
      }
      return result(ordinary("other.txt"));
    });
    const migrate = vi.fn(async () => {});
    const opened = api(async (value) => repository(value.fsPath, migrate));
    const evidence = await probeMigrationSource(opened, source, { runner: git, uri });
    offered = false;

    const outcome = await migrateChanges(await migrationInput(source, destination, evidence!), {
      api: opened,
      runner: git,
      uri,
    });

    expect(outcome).toEqual({ kind: "indeterminate", reason: "the source or destination changed before migration" });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("does not call migration when either exact repository cannot be opened", async () => {
    const source = await worktree("open-source");
    const destination = await worktree("open-destination");
    await writeFile(join(source, "a.txt"), "a");
    const git = runner((cwd) => result(cwd === source ? ordinary("a.txt") : ""));
    const live = api(async (value) => repository(value.fsPath));
    const offered = await probeMigrationSource(live, source, { runner: git, uri });
    const migrate = vi.fn(async () => {});
    const incapable = repository(source);
    delete (incapable as { migrateChanges?: Repository["migrateChanges"] }).migrateChanges;
    const integrations: Array<API | undefined> = [
      undefined,
      api(undefined),
      api(async (value) => (value.fsPath === source ? null : repository(destination, migrate))),
      api(async (value) => (value.fsPath === destination ? null : repository(source, migrate))),
      api(async () => Promise.reject(new Error("open failed"))),
      api(async () => repository(dirname(source), migrate)),
      api(async (value) => (value.fsPath === source ? incapable : repository(destination, migrate))),
    ];

    for (const integration of integrations) {
      expect(
        await migrateChanges(await migrationInput(source, destination, offered!), {
          api: integration,
          runner: git,
          uri,
        }),
      ).toEqual({
        kind: "indeterminate",
        reason:
          integration === undefined
            ? "the Git integration is unavailable"
            : "the Git integration could not open both worktrees",
      });
    }
    expect(migrate).not.toHaveBeenCalled();
  });

  it("keeps a rejected API call indeterminate", async () => {
    const source = await worktree("reject-source");
    const destination = await worktree("reject-destination");
    await writeFile(join(source, "a.txt"), "a");
    const git = runner((cwd) => result(cwd === source ? ordinary("a.txt") : ""));
    const opened = api(async (value) =>
      repository(
        value.fsPath,
        value.fsPath === destination ? vi.fn(async () => Promise.reject(new Error("stash failed"))) : vi.fn(),
      ),
    );
    const evidence = await probeMigrationSource(opened, source, { runner: git, uri });

    expect(
      await migrateChanges(await migrationInput(source, destination, evidence!), { api: opened, runner: git, uri }),
    ).toEqual({ kind: "indeterminate", reason: "stash failed" });
  });

  it("does not enter the API when the repository deadline expires during prechecks", async () => {
    const source = await worktree("precheck-deadline-source");
    const destination = await worktree("precheck-deadline-destination");
    await writeFile(join(source, "a.txt"), "a");
    const offered = await probeMigrationSource(
      api(async (value) => repository(value.fsPath)),
      source,
      {
        runner: runner(() => result(ordinary("a.txt"))),
        uri,
      },
    );
    let openExpired = false;
    const never = new Promise<void>(() => {});
    const openDeadline: Deadline = {
      elapsed: never,
      get expired() {
        return openExpired;
      },
      cancel: vi.fn(),
    };
    let firstDeadline = true;
    const makeDeadline = () => {
      if (firstDeadline) {
        firstDeadline = false;
        return openDeadline;
      }
      return { elapsed: never, expired: false, cancel: vi.fn() } satisfies Deadline;
    };
    const git = runner((cwd) => {
      if (cwd === destination) {
        openExpired = true;
        return result();
      }
      return result(ordinary("a.txt"));
    });
    const migrate = vi.fn(async () => {});

    expect(
      await migrateChanges(await migrationInput(source, destination, offered!), {
        api: api(async (value) => repository(value.fsPath, migrate)),
        runner: git,
        uri,
        makeDeadline,
      }),
    ).toEqual({ kind: "indeterminate", reason: "the source or destination changed before migration" });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("never calls migrateChanges after the repository-open deadline expires", async () => {
    const source = await worktree("expired-source");
    const destination = await worktree("expired-destination");
    await writeFile(join(source, "a.txt"), "a");
    const git = runner((cwd) => result(cwd === source ? ordinary("a.txt") : ""));
    const liveApi = api(async (value) => repository(value.fsPath));
    const offered = await probeMigrationSource(liveApi, source, { runner: git, uri });
    const migrate = vi.fn(async () => {});
    const releases: Array<() => void> = [];
    const opening = api(
      async (value) =>
        new Promise<Repository | null>((resolve) => {
          releases.push(() => resolve(repository(value.fsPath, migrate)));
        }),
    );
    const expired: Deadline = { elapsed: Promise.resolve(), expired: true, cancel: vi.fn() };

    const outcome = await migrateChanges(await migrationInput(source, destination, offered!), {
      api: opening,
      runner: git,
      uri,
      makeDeadline: () => expired,
    });
    for (const release of releases) {
      release();
    }
    await Promise.resolve();

    expect(outcome.kind).toBe("indeterminate");
    expect(migrate).not.toHaveBeenCalled();
  });
});
