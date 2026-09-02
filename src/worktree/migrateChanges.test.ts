import { chmod, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { API, Repository } from "../providers/git";
import type { Deadline } from "./deadline";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import {
  MIGRATION_DEADLINE_MS,
  MIGRATION_MAX_BYTES,
  migrateChanges,
  migrationSourceStillAuthorized,
  probeMigrationSource,
  readMigrationSnapshot,
} from "./migrateChanges";

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

    const outcome = await migrateChanges(
      { sourcePath: source, destinationPath: destination, source: offered!.source, snapshot: offered!.snapshot },
      { api: opened, runner: git, uri },
    );

    expect(outcome).toEqual({ kind: "moved" });
    expect(migrate).toHaveBeenCalledWith(source, {
      confirmation: false,
      deleteFromSource: true,
      untracked: true,
    });
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
      await migrateChanges(
        { sourcePath: source, destinationPath: destination, source: offered!.source, snapshot: offered!.snapshot },
        { api: opened, runner: git, uri },
      ),
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
        await migrateChanges(
          { sourcePath: source, destinationPath: destination, source: offered!.source, snapshot: offered!.snapshot },
          { api: opened, runner: git, uri },
        ),
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
      await migrateChanges(
        { sourcePath: source, destinationPath: destination, source: offered!.source, snapshot: offered!.snapshot },
        { api: opened, runner: git, uri },
      ),
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
      await migrateChanges(
        { sourcePath: source, destinationPath: destination, source: offered!.source, snapshot: offered!.snapshot },
        { api: opened, runner: git, uri },
      ),
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

    const outcome = await migrateChanges(
      { sourcePath: source, destinationPath: destination, source: evidence!.source, snapshot: evidence!.snapshot },
      { api: opened, runner: git, uri },
    );

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
        await migrateChanges(
          { sourcePath: source, destinationPath: destination, source: offered!.source, snapshot: offered!.snapshot },
          { api: integration, runner: git, uri },
        ),
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
      await migrateChanges(
        { sourcePath: source, destinationPath: destination, source: evidence!.source, snapshot: evidence!.snapshot },
        { api: opened, runner: git, uri },
      ),
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
      await migrateChanges(
        { sourcePath: source, destinationPath: destination, source: offered!.source, snapshot: offered!.snapshot },
        { api: api(async (value) => repository(value.fsPath, migrate)), runner: git, uri, makeDeadline },
      ),
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

    const outcome = await migrateChanges(
      { sourcePath: source, destinationPath: destination, source: offered!.source, snapshot: offered!.snapshot },
      {
        api: opening,
        runner: git,
        uri,
        makeDeadline: () => expired,
      },
    );
    for (const release of releases) {
      release();
    }
    await Promise.resolve();

    expect(outcome.kind).toBe("indeterminate");
    expect(migrate).not.toHaveBeenCalled();
  });
});
