// src/agentHooks/install/lockedJsonFile.ts — The write discipline this extension
// applies to every file another process may also hold: a lock file beside the
// target, and replacement through a temporary file and a rename. A live lock
// is never reclaimed by age; waiting fails closed instead, and a non-ENOENT
// release failure is reported with the exact path rather than swallowed
// (install-claude-hooks-v1 D5, D9).

import { randomBytes } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { chmod, link, lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { sameIdentity } from "../../utils/fileIdentity";
import { type OpenLike, openRegularFile } from "../../utils/regularFileRead";

export type Platform = "darwin" | "linux" | "win32";

export type LockedFileSystem = Pick<
  typeof import("node:fs/promises"),
  "chmod" | "link" | "lstat" | "mkdir" | "open" | "readFile" | "rename" | "unlink" | "writeFile"
>;

export interface LockedFileDependencies {
  fs?: Partial<LockedFileSystem>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** The replacement step alone, injectable so a test can fail the rename and nothing else. */
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  randomBytes?: (size: number) => Uint8Array;
  platform?: Platform;
}

export type StagedCommit = "create" | "replace";

/**
 * What a release did — not whether it worked.
 *
 * A boolean collapsed situations that are not alike, and the caller then had to
 * treat them alike: the one that matters is `notOurs`, where the name identifies
 * a DIFFERENT writer's live lock, so offering that pathname for removal destroys
 * the mutual exclusion the lock exists to provide (design.md D1, D3).
 *
 * `released` and `stuck` are claims about the NAME at the moment of the unlink,
 * not proofs about the held inode — which is why neither becomes an instruction
 * to delete anything.
 */
export type LockRelease =
  /** The name identified this holder's lock and it is gone. */
  | "released"
  /** The held lock was already unlinked by someone else; the name is free. */
  | "alreadyGone"
  /** The held lock still exists under a name this process cannot address. */
  | "movedAway"
  /** The name identifies a different file — never this holder's to remove. */
  | "notOurs"
  /** The release could not be told apart from any of the above. */
  | "indeterminate"
  /** The name identified this holder's lock and removing it was refused. */
  | "stuck";

export interface StagedReplacement {
  readonly path: string;
  commit(kind: StagedCommit): Promise<boolean>;
  discard(): Promise<void>;
}

export const LOCK_WAIT_MS = 25;
export const LOCK_MAX_WAIT_MS = 1_000;

export class LockedFile {
  private readonly fs: LockedFileSystem;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly replace: (oldPath: string, newPath: string) => Promise<void>;
  private readonly createRandomBytes: (size: number) => Uint8Array;
  private readonly platform: Platform;

  public constructor(
    public readonly path: string,
    dependencies: LockedFileDependencies = {},
  ) {
    this.fs = { chmod, link, lstat, mkdir, open, readFile, rename, unlink, writeFile, ...dependencies.fs };
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.replace = dependencies.rename ?? this.fs.rename;
    this.createRandomBytes = dependencies.randomBytes ?? randomBytes;
    this.platform = dependencies.platform ?? (process.platform === "win32" ? "win32" : "linux");
  }

  public get lockPath(): string {
    return `${this.path}.anywhere-terminal.lock`;
  }

  /**
   * Runs `work` while holding an exclusively-created sibling lock. The owned
   * handle stays open until release, and release removes the pathname only if
   * it still names the inode this operation created.
   */
  public async withLock<T>(
    work: () => Promise<T>,
    lockUnavailable: T,
    failed: T,
    onLockReleaseFailed?: (lockPath: string, release: LockRelease) => void,
  ): Promise<T> {
    const lock = await this.acquireLock(this.lockPath);
    if (!lock) {
      return lockUnavailable;
    }
    let result: T;
    try {
      result = await work();
    } catch {
      result = failed;
    }
    const release = await this.releaseLock(this.lockPath, lock);
    if (release !== "released" && release !== "alreadyGone") {
      onLockReleaseFailed?.(this.lockPath, release);
    }
    return result;
  }

  /** Creates and fills an unpredictable exclusive sibling temporary. */
  public async stageReplacement(contents: string, mode: number | undefined): Promise<StagedReplacement | undefined> {
    const path = this.platform === "win32" ? win32 : posix;
    const temporaryPath = path.join(
      path.dirname(this.path),
      `.${path.basename(this.path) || "hooks.json"}.${Buffer.from(this.createRandomBytes(16)).toString("hex")}.tmp`,
    );
    let handle: FileHandle | undefined;
    let ownedIdentity: { dev: bigint; ino: bigint } | undefined;
    let live = false;

    const ownsTemporaryPath = async (): Promise<boolean> => {
      if (!live || !ownedIdentity) {
        return false;
      }
      try {
        const current = await this.fs.lstat(temporaryPath, { bigint: true });
        return !current.isSymbolicLink() && current.isFile() && sameIdentity(ownedIdentity, current);
      } catch {
        return false;
      }
    };

    const closeHandle = async () => {
      await handle?.close().catch(() => undefined);
      handle = undefined;
    };

    const discard = async () => {
      if (!live) {
        return;
      }
      if (await ownsTemporaryPath()) {
        await this.fs.unlink(temporaryPath).catch(() => undefined);
      }
      live = false;
      await closeHandle();
    };

    try {
      await this.fs.mkdir(path.dirname(this.path), { recursive: true });
      handle = await this.fs.open(temporaryPath, "wx", mode ?? 0o600);
      live = true;
      await handle.writeFile(contents, { encoding: "utf8" });
      if (mode !== undefined) {
        await handle.chmod(mode);
      }
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile()) {
        await discard();
        return undefined;
      }
      ownedIdentity = { dev: opened.dev, ino: opened.ino };
    } catch {
      if (live && !ownedIdentity) {
        try {
          const opened = await handle?.stat({ bigint: true });
          if (opened) {
            ownedIdentity = { dev: opened.dev, ino: opened.ino };
          }
        } catch {
          // No identity means no pathname is authorized for cleanup.
        }
      }
      await discard();
      return undefined;
    }

    return {
      path: temporaryPath,
      commit: async (kind) => {
        if (!(await ownsTemporaryPath())) {
          return false;
        }
        try {
          if (kind === "create") {
            await this.fs.link(temporaryPath, this.path);
            try {
              await this.fs.unlink(temporaryPath);
              live = false;
              await closeHandle();
            } catch (error) {
              if (isNotFound(error)) {
                live = false;
                await closeHandle();
              }
            }
            return true;
          }
          await this.replace(temporaryPath, this.path);
          live = false;
          await closeHandle();
          return true;
        } catch {
          return false;
        }
      },
      discard,
    };
  }

  public async atomicReplace(contents: string, mode: number | undefined): Promise<boolean> {
    const staged = await this.stageReplacement(contents, mode);
    if (!staged) {
      return false;
    }
    const committed = await staged.commit("replace");
    if (!committed) {
      await staged.discard();
    }
    return committed;
  }

  /** `undefined` for a file that is not there — every other read failure throws. */
  /**
   * The current contents, or `undefined` when there is no file.
   *
   * Read through `openRegularFile` rather than `readFile`, because this call
   * happens under the lock: `readFile` on a named pipe with no writer never
   * returns, so the lock would never reach its release and every later holder
   * would time out acquiring it. The type comes from the OPENED handle, so a
   * caller that observed the path a moment ago is not trusting that observation
   * — there is no window between the check and the read
   * (`open-a-provider-file-without-waiting-on-it` design.md D4).
   */
  public async readText(): Promise<string | undefined> {
    let handle: FileHandle;
    try {
      // A file this class EDITS IN PLACE is not the provider file the helper was
      // written for: a link at the name is refused rather than followed (D5).
      handle = await openRegularFile(this.path, this.fs.open as OpenLike, {
        noFollow: true,
        lstatFile: (target) => this.fs.lstat(target, { bigint: true }),
      });
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
    try {
      return await handle.readFile("utf8");
    } finally {
      await handle.close().catch(() => {});
    }
  }

  private async acquireLock(lockPath: string): Promise<FileHandle | undefined> {
    try {
      await this.fs.mkdir((this.platform === "win32" ? win32 : posix).dirname(this.path), { recursive: true });
    } catch {
      return undefined;
    }
    const attempts = Math.ceil(LOCK_MAX_WAIT_MS / LOCK_WAIT_MS);
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      try {
        return await this.fs.open(lockPath, "wx");
      } catch (error) {
        if (!isAlreadyExists(error)) {
          return undefined;
        }
        await this.sleep(LOCK_WAIT_MS);
      }
    }
    return undefined;
  }

  private async releaseLock(lockPath: string, handle: FileHandle): Promise<LockRelease> {
    try {
      const owned = await handle.stat({ bigint: true });
      let current: Awaited<ReturnType<typeof lstat>>;
      try {
        current = await this.fs.lstat(lockPath, { bigint: true });
      } catch (error) {
        if (!isNotFound(error)) {
          return "indeterminate";
        }
        // Absent at the name, but the held lock may still EXIST — renamed out
        // from under us, under a name nothing here can address. That arm is
        // reachable and is not the same as the lock being gone (design.md D3).
        return owned.nlink === 0n ? "alreadyGone" : "movedAway";
      }
      if (!sameIdentity(owned, current)) {
        return "notOurs";
      }
      try {
        await this.fs.unlink(lockPath);
      } catch (error) {
        return isNotFound(error) ? "released" : "stuck";
      }
      return "released";
    } catch {
      return "indeterminate";
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}

export function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
