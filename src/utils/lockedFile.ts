// src/utils/lockedFile.ts — The write discipline this extension applies to any
// file another process may also hold: a lock beside the target, and replacement
// through a temporary file and a rename. A live lock is never reclaimed by age;
// waiting fails closed instead, and a non-ENOENT release failure is reported
// with the exact path rather than swallowed.

import { randomBytes } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { chmod, link, lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { type FileIdentity, fileIdentityOf, sameFileIdentity } from "./authorizedDirectory";

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

export interface LockDeadline {
  readonly elapsed: Promise<void>;
  readonly expired: boolean;
  cancel(): void;
}

export interface WriteGate {
  readonly open: boolean;
  guard<T>(step: () => Promise<T>): Promise<T>;
}

export type LockedOutcome<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "timedOut";
      readonly retainedLockPath?: string;
      readonly releasePending?: true;
    };

export type StagedCommit = "create" | "replace";

export interface StagedReplacement {
  readonly path: string;
  commit(kind: StagedCommit, gate?: WriteGate): Promise<boolean>;
  discard(gate?: WriteGate): Promise<boolean>;
  abandon(): Promise<void>;
}

export const LOCK_WAIT_MS = 25;
export const LOCK_MAX_WAIT_MS = 1_000;

class GateClosed extends Error {}

class MutationGate implements WriteGate {
  private latchedOpen = true;
  private mutating = 0;
  private dirty_ = false;

  public constructor(private readonly deadline: LockDeadline) {
    void deadline.elapsed.then(() => this.close(this.mutating > 0));
  }

  public get open(): boolean {
    if (this.deadline.expired) {
      this.close(this.mutating > 0);
    }
    return this.latchedOpen;
  }

  public get dirty(): boolean {
    return this.dirty_;
  }

  public get closed(): boolean {
    return !this.latchedOpen;
  }

  public async guard<T>(step: () => Promise<T>): Promise<T> {
    return this.run(step);
  }

  public async observe<T>(step: () => Promise<T>): Promise<T> {
    if (!this.open) {
      throw new GateClosed();
    }
    const running = Promise.resolve().then(step);
    return Promise.race([
      running.then(
        (value) => {
          if (!this.open) {
            throw new GateClosed();
          }
          return value;
        },
        (error) => {
          if (!this.open) {
            throw new GateClosed();
          }
          throw error;
        },
      ),
      this.deadline.elapsed.then<never>(() => {
        this.close(false);
        throw new GateClosed();
      }),
    ]);
  }

  public async run<T>(step: () => Promise<T>, onLate?: (value: T) => Promise<void> | void): Promise<T> {
    if (!this.open) {
      throw new GateClosed();
    }
    this.mutating += 1;
    let settled = false;
    const running = Promise.resolve().then(step);
    const completed = running.then(
      async (value) => {
        const late = !this.open;
        this.mutating -= 1;
        settled = true;
        if (late) {
          this.dirty_ = true;
          await Promise.resolve(onLate?.(value)).catch(() => undefined);
          throw new GateClosed();
        }
        return value;
      },
      (error) => {
        const late = !this.open;
        this.mutating -= 1;
        settled = true;
        if (late) {
          this.dirty_ = true;
          throw new GateClosed();
        }
        throw error;
      },
    );
    const expired = this.deadline.elapsed.then<never>(() => {
      if (!settled) {
        this.close(true);
      }
      throw new GateClosed();
    });
    return Promise.race([completed, expired]);
  }

  private close(dirty: boolean): void {
    this.latchedOpen = false;
    if (dirty) {
      this.dirty_ = true;
    }
  }
}

function mutationGate(gate: WriteGate | undefined): MutationGate | undefined {
  return gate instanceof MutationGate ? gate : undefined;
}

async function guarded<T>(gate: WriteGate | undefined, step: () => Promise<T>): Promise<T> {
  return gate === undefined ? step() : gate.guard(step);
}

async function observed<T>(gate: WriteGate | undefined, step: () => Promise<T>): Promise<T> {
  const internal = mutationGate(gate);
  return internal === undefined ? guarded(gate, step) : internal.observe(step);
}

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

  public async withLock<T>(
    work: () => Promise<T>,
    lockUnavailable: T,
    failed: T,
    onLockReleaseFailed?: (lockPath: string) => void,
  ): Promise<T>;
  public async withLock<T>(
    deadline: LockDeadline,
    work: (gate: WriteGate) => Promise<T>,
    failed: T,
    onLockReleaseFailed?: (lockPath: string) => void,
  ): Promise<LockedOutcome<T>>;
  public async withLock<T>(
    deadlineOrWork: LockDeadline | (() => Promise<T>),
    workOrUnavailable: ((gate: WriteGate) => Promise<T>) | T,
    failed: T,
    onLockReleaseFailed?: (lockPath: string) => void,
  ): Promise<T | LockedOutcome<T>> {
    if (typeof deadlineOrWork === "function") {
      const lock = await this.acquireLock(this.lockPath);
      if (!lock) {
        return workOrUnavailable as T;
      }
      let result: T;
      try {
        result = await deadlineOrWork();
      } catch {
        result = failed;
      }
      if (!(await this.releaseLock(this.lockPath, lock))) {
        onLockReleaseFailed?.(this.lockPath);
      }
      return result;
    }

    const deadline = deadlineOrWork;
    const work = workOrUnavailable as (gate: WriteGate) => Promise<T>;
    const gate = new MutationGate(deadline);
    const acquisition = await this.acquireLockBeforeDeadline(this.lockPath, deadline, gate);
    if (acquisition.kind !== "acquired") {
      return acquisition.kind === "unavailable"
        ? { kind: "unavailable" }
        : {
            kind: "timedOut",
            ...(acquisition.retained ? { retainedLockPath: this.lockPath } : {}),
          };
    }
    const lock = acquisition.handle;
    if (!gate.open) {
      void this.releaseLock(this.lockPath, lock).then((released) => {
        if (!released) {
          onLockReleaseFailed?.(this.lockPath);
        }
      });
      return { kind: "timedOut", releasePending: true };
    }
    const running = Promise.resolve()
      .then(() => work(gate))
      .then(
        (value) => ({ kind: "value" as const, value }),
        () => ({ kind: "value" as const, value: failed }),
      );
    const settled = await Promise.race([running, deadline.elapsed.then(() => ({ kind: "timeout" as const }))]);
    if (settled.kind === "timeout") {
      if (gate.dirty) {
        void lock.close().catch(() => undefined);
        return { kind: "timedOut", retainedLockPath: this.lockPath };
      }
      void this.releaseLock(this.lockPath, lock).then((released) => {
        if (!released) {
          onLockReleaseFailed?.(this.lockPath);
        }
      });
      return { kind: "timedOut", releasePending: true };
    }

    if (gate.closed) {
      if (gate.dirty) {
        void lock.close().catch(() => undefined);
        return { kind: "timedOut", retainedLockPath: this.lockPath };
      }
      void this.releaseLock(this.lockPath, lock).then((released) => {
        if (!released) {
          onLockReleaseFailed?.(this.lockPath);
        }
      });
      return { kind: "timedOut", releasePending: true };
    }

    const release = this.releaseLock(this.lockPath, lock);
    const released = await Promise.race([release, deadline.elapsed.then(() => undefined)]);
    if (released !== true) {
      onLockReleaseFailed?.(this.lockPath);
    }
    return { kind: "done", value: settled.value };
  }

  /** Creates and fills an unpredictable exclusive sibling temporary. */
  public async stageReplacement(
    contents: string,
    mode: number | undefined,
    gate?: WriteGate,
  ): Promise<StagedReplacement | undefined> {
    const path = this.platform === "win32" ? win32 : posix;
    const temporaryPath = path.join(
      path.dirname(this.path),
      `.${path.basename(this.path) || "hooks.json"}.${Buffer.from(this.createRandomBytes(16)).toString("hex")}.tmp`,
    );
    let handle: FileHandle | undefined;
    let ownedIdentity: FileIdentity | undefined;
    let live = false;

    const ownsTemporaryPath = async (checkGate?: WriteGate): Promise<boolean> => {
      if (!live || !ownedIdentity) {
        return false;
      }
      try {
        const current = await observed(checkGate, () => this.fs.lstat(temporaryPath));
        return !current.isSymbolicLink() && current.isFile() && sameFileIdentity(ownedIdentity, current);
      } catch {
        return false;
      }
    };

    const closeHandle = async () => {
      const current = handle;
      handle = undefined;
      await current?.close().catch(() => undefined);
    };

    const abandon = async () => {
      live = false;
      await closeHandle();
    };

    const discard = async (discardGate?: WriteGate): Promise<boolean> => {
      if (!live) {
        await closeHandle();
        return true;
      }
      if (!(await ownsTemporaryPath(discardGate))) {
        await abandon();
        return false;
      }
      try {
        await guarded(discardGate, () => this.fs.unlink(temporaryPath));
        live = false;
        await closeHandle();
        return true;
      } catch (error) {
        if (isNotFound(error)) {
          live = false;
          await closeHandle();
          return true;
        }
        await abandon();
        return false;
      }
    };

    try {
      await observed(gate, () => this.fs.mkdir(path.dirname(this.path), { recursive: true }));
      const internal = mutationGate(gate);
      handle = internal
        ? await internal.run(
            () => this.fs.open(temporaryPath, "wx", mode ?? 0o600),
            (late) => late.close().catch(() => undefined),
          )
        : await guarded(gate, () => this.fs.open(temporaryPath, "wx", mode ?? 0o600));
      live = true;
      await guarded(gate, () => handle!.writeFile(contents, { encoding: "utf8" }));
      if (mode !== undefined) {
        await guarded(gate, () => handle!.chmod(mode));
      }
      const opened = await observed(gate, () => handle!.stat());
      ownedIdentity = fileIdentityOf(opened);
      if (!opened.isFile() || ownedIdentity === undefined) {
        await discard(gate);
        return undefined;
      }
    } catch {
      if (live && !ownedIdentity && gate?.open !== false) {
        try {
          const opened = await handle?.stat();
          if (opened) {
            ownedIdentity = fileIdentityOf(opened);
          }
        } catch {
          // No identity means no pathname is authorized for cleanup.
        }
      }
      if (gate?.open === false) {
        await abandon();
      } else {
        await discard(gate);
      }
      return undefined;
    }

    return {
      path: temporaryPath,
      commit: async (kind, commitGate) => {
        if (!(await ownsTemporaryPath(commitGate))) {
          return false;
        }
        try {
          if (kind === "create") {
            await guarded(commitGate, () => this.fs.link(temporaryPath, this.path));
            return true;
          }
          await guarded(commitGate, () => this.replace(temporaryPath, this.path));
          live = false;
          void closeHandle();
          return true;
        } catch {
          return false;
        }
      },
      discard,
      abandon,
    };
  }

  public async atomicReplace(contents: string, mode: number | undefined, gate?: WriteGate): Promise<boolean> {
    const staged = await this.stageReplacement(contents, mode, gate);
    if (!staged) {
      return false;
    }
    const committed = await staged.commit("replace", gate);
    if (!committed) {
      await staged.discard(gate);
    }
    return committed;
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

  private async acquireLockBeforeDeadline(
    lockPath: string,
    deadline: LockDeadline,
    gate: MutationGate,
  ): Promise<
    | { readonly kind: "acquired"; readonly handle: FileHandle }
    | { readonly kind: "unavailable" }
    | { readonly kind: "timedOut"; readonly retained: boolean }
  > {
    const parent = (this.platform === "win32" ? win32 : posix).dirname(this.path);
    const creatingParent = this.fs.mkdir(parent, { recursive: true });
    const parentResult = await Promise.race([
      creatingParent.then(
        () => "done" as const,
        () => "failed" as const,
      ),
      deadline.elapsed.then(() => "timeout" as const),
    ]);
    if (parentResult !== "done") {
      void creatingParent.catch(() => undefined);
      return parentResult === "timeout" ? { kind: "timedOut", retained: false } : { kind: "unavailable" };
    }

    const attempts = Math.ceil(LOCK_MAX_WAIT_MS / LOCK_WAIT_MS);
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      if (!gate.open) {
        return { kind: "timedOut", retained: gate.dirty };
      }
      try {
        const handle = await gate.run(
          () => this.fs.open(lockPath, "wx"),
          (late) => late.close().catch(() => undefined),
        );
        return { kind: "acquired", handle };
      } catch (error) {
        if (error instanceof GateClosed) {
          return { kind: "timedOut", retained: gate.dirty };
        }
        if (!isAlreadyExists(error)) {
          return { kind: "unavailable" };
        }
        const sleeping = this.sleep(LOCK_WAIT_MS);
        const slept = await Promise.race([sleeping.then(() => true), deadline.elapsed.then(() => false)]);
        if (!slept || deadline.expired) {
          void sleeping.catch(() => undefined);
          return { kind: "timedOut", retained: false };
        }
      }
    }
    return { kind: "unavailable" };
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

  private async releaseLock(lockPath: string, handle: FileHandle): Promise<boolean> {
    try {
      const opened = await handle.stat();
      const owned = fileIdentityOf(opened);
      if (owned === undefined) {
        return false;
      }
      let current: Awaited<ReturnType<typeof lstat>>;
      try {
        current = await this.fs.lstat(lockPath);
      } catch (error) {
        if (isNotFound(error) && opened.nlink === 0) {
          return true;
        }
        return false;
      }
      if (!sameFileIdentity(owned, current)) {
        return false;
      }
      try {
        await this.fs.unlink(lockPath);
      } catch (error) {
        return isNotFound(error);
      }
      return true;
    } catch {
      return false;
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
