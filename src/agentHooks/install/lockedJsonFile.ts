// src/agentHooks/install/lockedJsonFile.ts — The write discipline this extension
// applies to every file another process may also hold: a lock file beside the
// target, and replacement through a temporary file and a rename. A live lock
// is never reclaimed by age; waiting fails closed instead, and a non-ENOENT
// release failure is reported with the exact path rather than swallowed
// (install-claude-hooks-v1 D5, D9).

import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { posix, win32 } from "node:path";

export type Platform = "darwin" | "linux" | "win32";

export type LockedFileSystem = Pick<
  typeof import("node:fs/promises"),
  "chmod" | "mkdir" | "open" | "readFile" | "rename" | "unlink" | "writeFile"
>;

export interface LockedFileDependencies {
  fs?: Partial<LockedFileSystem>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** The replacement step alone, injectable so a test can fail the rename and nothing else. */
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  platform?: Platform;
}

export const LOCK_WAIT_MS = 25;
export const LOCK_MAX_WAIT_MS = 1_000;

export class LockedFile {
  private readonly fs: LockedFileSystem;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly replace: (oldPath: string, newPath: string) => Promise<void>;
  private readonly platform: Platform;

  public constructor(
    public readonly path: string,
    dependencies: LockedFileDependencies = {},
  ) {
    this.fs = { chmod, mkdir, open, readFile, rename, unlink, writeFile, ...dependencies.fs };
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.replace = dependencies.rename ?? this.fs.rename;
    this.platform = dependencies.platform ?? (process.platform === "win32" ? "win32" : "linux");
  }

  /**
   * Runs `work` while holding the lock. The two failure values are the caller's
   * because only the caller knows what its outcome type says: a lock nobody
   * released and a body that threw are different facts.
   *
   * `work`'s result is never discarded for a release failure: a committed
   * install/remove already happened. Instead, a non-ENOENT failure unlinking
   * the lock afterward is reported through `onLockReleaseFailed` with the
   * exact lock path, so a caller can merge it into its own unresolved-path
   * list without losing the committed outcome (D5, D9).
   */
  public async withLock<T>(
    work: () => Promise<T>,
    lockUnavailable: T,
    failed: T,
    onLockReleaseFailed?: (lockPath: string) => void,
  ): Promise<T> {
    const lockPath = `${this.path}.anywhere-terminal.lock`;
    if (!(await this.acquireLock(lockPath))) {
      return lockUnavailable;
    }
    let result: T;
    try {
      result = await work();
    } catch {
      result = failed;
    }
    try {
      await this.fs.unlink(lockPath);
    } catch (error) {
      if (!isNotFound(error)) {
        onLockReleaseFailed?.(lockPath);
      }
    }
    return result;
  }

  public async atomicReplace(contents: string, mode: number | undefined): Promise<boolean> {
    const path = this.platform === "win32" ? win32 : posix;
    const temporaryPath = path.join(
      path.dirname(this.path),
      `.${path.basename(this.path) || "hooks.json"}.${this.now()}.tmp`,
    );
    try {
      await this.fs.mkdir(path.dirname(this.path), { recursive: true });
      await this.fs.writeFile(temporaryPath, contents, { encoding: "utf8", mode: mode ?? 0o600 });
      if (mode !== undefined) {
        await this.fs.chmod(temporaryPath, mode);
      }
      await this.replace(temporaryPath, this.path);
      return true;
    } catch {
      await this.fs.unlink(temporaryPath).catch(() => undefined);
      return false;
    }
  }

  /** `undefined` for a file that is not there — every other read failure throws. */
  public async readText(): Promise<string | undefined> {
    try {
      return await this.fs.readFile(this.path, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async acquireLock(lockPath: string): Promise<boolean> {
    // The lock file lives beside the target, so its directory has to exist
    // before the first attempt — otherwise every write to a not-yet-created
    // location degrades to lock-unavailable rather than creating it.
    try {
      await this.fs.mkdir((this.platform === "win32" ? win32 : posix).dirname(this.path), { recursive: true });
    } catch {
      return false;
    }
    // Bounded exclusive wait only: no mtime or age ever authorizes deleting a
    // live holder's lock (D5). A holder that pauses indefinitely simply keeps
    // every other host waiting until this budget runs out.
    const attempts = Math.ceil(LOCK_MAX_WAIT_MS / LOCK_WAIT_MS);
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      try {
        const handle = await this.fs.open(lockPath, "wx");
        await handle.close();
        return true;
      } catch (error) {
        if (!isAlreadyExists(error)) {
          return false;
        }
        await this.sleep(LOCK_WAIT_MS);
      }
    }
    return false;
  }
}

export function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
