// src/agentHooks/install/ManagedConfigInstaller.ts — Reconciles only AnyWhere
// Terminal's observational entries in an agent's user hook configuration.
// One reconciler serves every agent (install-claude-hooks D1): it owns the
// cross-process lock, the classified read, compare-and-retry, atomic rename,
// and the wrapper script's lifecycle. What the document looks like belongs to
// the AgentConfigAdapter it is constructed with.

import { chmod, lstat, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { posixShellQuote } from "../../utils/posixShellQuote";
import { ManagedEntryLedger, type ManagedEntryOwnership, memoryLedgerStore } from "./managedEntryLedger";
import {
  PROBE_OUTER_DEADLINE_MS,
  type ProbeResult,
  runProbe,
  windowsSystemPath,
  withProbeDeadline,
} from "./probeRunner";
import {
  type AgentConfigAdapter,
  type ConfigRead,
  type HookInstallOutcome,
  type HookRemoveOutcome,
  isJsonObject,
  type JsonObject,
  type Platform,
} from "./types";

type FileSystem = Pick<
  typeof import("node:fs/promises"),
  "chmod" | "lstat" | "mkdir" | "open" | "readFile" | "rename" | "stat" | "unlink" | "writeFile"
>;

export interface ManagedConfigInstallerOptions {
  /** Root the extension owns; the adapter names the sub-directory inside it. */
  storageRoot: string;
  platform?: Platform;
  /**
   * What this extension has recorded writing (D12). Omitted, the installer owns
   * exactly the command it would write itself and remembers it only for the
   * lifetime of this object — enough for a test, never for a restart.
   */
  ownership?: ManagedEntryOwnership;
}

export interface ManagedConfigInstallerDependencies {
  fs?: Partial<FileSystem>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  run?: (file: string, args: string[]) => Promise<ProbeResult>;
  beforeReplace?: () => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
}

const LOCK_WAIT_MS = 25;
const LOCK_MAX_WAIT_MS = 1_000;
const STALE_LOCK_MS = 30_000;
const MAX_RECONCILE_ATTEMPTS = 3;

export class ManagedConfigInstaller {
  private readonly fs: FileSystem;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly run: (file: string, args: string[]) => Promise<ProbeResult>;
  private readonly replace: (oldPath: string, newPath: string) => Promise<void>;
  private readonly beforeReplace: () => Promise<void>;
  private readonly platform: Platform;
  private readonly ownership: ManagedEntryOwnership;

  public constructor(
    private readonly adapter: AgentConfigAdapter,
    private readonly options: ManagedConfigInstallerOptions,
    dependencies: ManagedConfigInstallerDependencies = {},
  ) {
    this.fs = { chmod, lstat, mkdir, open, readFile, rename, stat, unlink, writeFile, ...dependencies.fs };
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.run = dependencies.run ?? ((file, args) => runProbe(file, args));
    this.replace = dependencies.rename ?? this.fs.rename;
    this.beforeReplace = dependencies.beforeReplace ?? (async () => undefined);
    this.platform = options.platform ?? hostPlatform();
    this.ownership =
      options.ownership ?? new ManagedEntryLedger(memoryLedgerStore()).ownership("ephemeral", this.command());
  }

  public async install(): Promise<HookInstallOutcome> {
    // Resolved once and threaded through every stage below (round-1 B1). The
    // adapter re-resolves per call, so re-asking would let a setting change
    // mid-operation lock one file and write another.
    const configPath = this.adapter.configPath();
    if (await this.isSymlinkedDestination(configPath)) {
      return { installed: false, reason: "unsupported-config" };
    }
    const wrapper = await this.createWrapper();
    if (wrapper === "failed") {
      return { installed: false, reason: "write-failed" };
    }
    if (wrapper === "probe-failed") {
      return { installed: false, reason: "windows-probe-failed" };
    }
    // The lock file lives beside the config, so the directory has to exist
    // before the lock — a first-run agent whose config directory is absent
    // would otherwise fail as `lock-unavailable`.
    try {
      await this.fs.mkdir(this.configDirectory(configPath), { recursive: true });
    } catch {
      return { installed: false, reason: "write-failed" };
    }

    return this.withLock<HookInstallOutcome>(
      configPath,
      async (): Promise<HookInstallOutcome> => {
        // The command is recorded BEFORE the file changes (round-4 B6). Owning a
        // command we never wrote costs nothing — there is nothing to remove —
        // while writing one we never recorded puts it beyond our own reach.
        await this.ownership.recordCommand(this.command());
        const reconciled = await this.reconcile(configPath, (document, command) =>
          this.adapter.applyManagedEntries(document, command, (entry) => this.ownership.isOwned(entry)),
        );
        if (reconciled !== "success") {
          return { installed: false, reason: reconciled === "unsupported" ? "unsupported-config" : "write-failed" };
        }
        await this.ownership.recordInstalled(configPath, this.command());
        return { installed: true };
      },
      { installed: false, reason: "lock-unavailable" },
      { installed: false, reason: "write-failed" },
    );
  }

  public async uninstall(): Promise<HookRemoveOutcome> {
    const configPath = this.adapter.configPath();
    if (await this.isSymlinkedDestination(configPath)) {
      return { removed: false, reason: "unsupported-config" };
    }
    // Answered without a lock, and without creating the directory a lock file
    // would need: there is nothing to remove and nothing to race against.
    if ((await this.readConfiguration(configPath)).kind === "missing") {
      return { removed: false, reason: "not-installed" };
    }
    return this.withLock<HookRemoveOutcome>(
      configPath,
      async (): Promise<HookRemoveOutcome> => {
        let removed = false;
        const reconciled = await this.reconcile(configPath, (document) => {
          removed = this.adapter.removeManagedEntries(document, (entry) => this.ownership.isOwned(entry));
          return removed;
        });
        if (reconciled !== "success") {
          return { removed: false, reason: reconciled === "unsupported" ? "unsupported-config" : "write-failed" };
        }
        if (!removed) {
          return { removed: false, reason: "not-installed" };
        }
        await this.ownership.recordRemoved(configPath);
        return { removed: true };
      },
      { removed: false, reason: "lock-unavailable" },
      { removed: false, reason: "write-failed" },
    );
  }

  /**
   * Refused ahead of the lock (D5): a lock file created beside a symlinked
   * config is itself a write into a directory we have decided not to touch.
   */
  private async isSymlinkedDestination(configPath: string): Promise<boolean> {
    try {
      return (await this.fs.lstat(configPath)).isSymbolicLink();
    } catch {
      return false;
    }
  }

  /**
   * Joined with the *host's* separator, not the target platform's: `platform` is
   * a seam for the emitted script and the config layout, and a Windows-shaped
   * wrapper path on a POSIX host would name a file nothing can execute.
   */
  private wrapperPath(): string {
    const { fileName } = this.adapter.wrapperLocation(this.platform);
    return join(this.wrapperDirectory(), fileName);
  }

  private wrapperDirectory(): string {
    return join(this.options.storageRoot, this.adapter.wrapperLocation(this.platform).directoryName);
  }

  private configDirectory(configPath: string): string {
    const path = this.platform === "win32" ? win32 : posix;
    return path.dirname(configPath);
  }

  /**
   * Written to a temporary file, made executable, then renamed into place (D11),
   * so the canonical path is never observable non-executable by a hook that
   * fires mid-install.
   */
  private async createWrapper(): Promise<"ready" | "probe-failed" | "failed"> {
    const wrapper = this.wrapperPath();
    const temporaryPath = `${wrapper}.${this.now()}.tmp`;
    try {
      await this.fs.mkdir(this.wrapperDirectory(), { recursive: true });
      await this.fs.writeFile(temporaryPath, this.adapter.wrapperScript(this.platform), "utf8");
      if (this.platform !== "win32") {
        await this.fs.chmod(temporaryPath, 0o700);
      }
      await this.replace(temporaryPath, wrapper);
    } catch {
      await this.fs.unlink(temporaryPath).catch(() => undefined);
      return "failed";
    }
    if (this.platform !== "win32") {
      return "ready";
    }
    // Two bounds, deliberately. `runProbe` kills and reaps its own child; this
    // one bounds the installer against an injected runner that does not, and is
    // strictly the looser of the two so it never preempts that reap (D14).
    const result = await withProbeDeadline(
      this.run(windowsSystemPath("cmd.exe"), ["/d", "/s", "/c", wrapper]),
      PROBE_OUTER_DEADLINE_MS,
    );
    return result.exitCode === 0 && isEmptyJson(result.stdout) ? "ready" : "probe-failed";
  }

  private async withLock<T>(
    configPath: string,
    work: () => Promise<T>,
    lockUnavailable: T,
    writeFailed: T,
  ): Promise<T> {
    const lockPath = `${configPath}.anywhere-terminal.lock`;
    if (!(await this.acquireLock(lockPath))) {
      return lockUnavailable;
    }
    try {
      return await work();
    } catch {
      return writeFailed;
    } finally {
      await this.fs.unlink(lockPath).catch(() => undefined);
    }
  }

  private async acquireLock(lockPath: string): Promise<boolean> {
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
        try {
          const lock = await this.fs.stat(lockPath);
          if (this.now() - lock.mtimeMs > STALE_LOCK_MS) {
            await this.fs.unlink(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        await this.sleep(LOCK_WAIT_MS);
      }
    }
    return false;
  }

  private async reconcile(
    configPath: string,
    change: (document: JsonObject, command: string) => boolean,
  ): Promise<"success" | "unsupported" | "failed"> {
    const command = this.command();
    for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
      const source = await this.readConfiguration(configPath);
      if (source.kind === "unsupported") {
        return "unsupported";
      }
      const contents = source.kind === "missing" ? "" : source.contents;
      const document = source.kind === "missing" ? this.adapter.createInitialDocument() : source.document;
      if (!this.adapter.isSupportedDocument(document)) {
        return "unsupported";
      }
      const desired = structuredClone(document);
      if (!change(desired, command)) {
        return "success";
      }
      const serialized = `${JSON.stringify(desired, null, 2)}\n`;
      await this.beforeReplace();
      if (!(await this.matches(configPath, contents))) {
        continue;
      }
      return (await this.atomicReplace(configPath, serialized, source.kind === "document" ? source.mode : undefined))
        ? "success"
        : "failed";
    }
    return "failed";
  }

  /**
   * Only ENOENT may seed a new document (D10). A file that exists but does not
   * parse, or whose root is not an object, is `unsupported` — never coerced to
   * `{}` and rewritten.
   */
  private async readConfiguration(configPath: string): Promise<ConfigRead> {
    let contents: string;
    try {
      contents = await this.fs.readFile(configPath, "utf8");
    } catch (error) {
      return isNotFound(error) ? { kind: "missing" } : { kind: "unsupported" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      return { kind: "unsupported" };
    }
    if (!isJsonObject(parsed)) {
      return { kind: "unsupported" };
    }
    try {
      const file = await this.fs.stat(configPath);
      return { kind: "document", contents, document: parsed, mode: file.mode & 0o777 };
    } catch {
      return { kind: "unsupported" };
    }
  }

  private async matches(configPath: string, contents: string): Promise<boolean> {
    try {
      return (await this.fs.readFile(configPath, "utf8")) === contents;
    } catch (error) {
      return contents === "" && isNotFound(error);
    }
  }

  private async atomicReplace(configPath: string, contents: string, mode: number | undefined): Promise<boolean> {
    const path = this.platform === "win32" ? win32 : posix;
    const temporaryPath = path.join(
      path.dirname(configPath),
      `.${path.basename(configPath) || "hooks.json"}.${this.now()}.tmp`,
    );
    try {
      await this.fs.mkdir(path.dirname(configPath), { recursive: true });
      await this.fs.writeFile(temporaryPath, contents, { encoding: "utf8", mode: mode ?? 0o600 });
      if (mode !== undefined) {
        await this.fs.chmod(temporaryPath, mode);
      }
      await this.replace(temporaryPath, configPath);
      return true;
    } catch {
      await this.fs.unlink(temporaryPath).catch(() => undefined);
      return false;
    }
  }

  private command(): string {
    return managedWrapperCommand(this.adapter, { ...this.options, platform: this.platform });
  }
}

/**
 * The exact command this build writes for an agent. Exported because the ledger
 * has to be seeded with it before an installer exists (D12) — the installer
 * takes its ownership as an input, so it cannot also be the source of the seed.
 */
export function managedWrapperCommand(adapter: AgentConfigAdapter, options: ManagedConfigInstallerOptions): string {
  const platform = options.platform ?? hostPlatform();
  const { directoryName, fileName } = adapter.wrapperLocation(platform);
  const wrapper = join(options.storageRoot, directoryName, fileName);
  return platform === "win32" ? `"${wrapper.replaceAll('"', '""')}"` : posixShellQuote(wrapper);
}

function hostPlatform(): Platform {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isEmptyJson(stdout: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isJsonObject(parsed) && Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}
