// src/agentHooks/install/ManagedConfigInstaller.ts — Reconciles only AnyWhere
// Terminal's observational entries in an agent's user hook configuration.
// One reconciler serves every agent (install-claude-hooks D1): it owns the
// cross-process lock, the classified read, compare-and-retry, atomic rename,
// and the wrapper script's lifecycle. What the document looks like belongs to
// the AgentConfigAdapter it is constructed with.

import { chmod, lstat, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { posixShellQuote } from "../../utils/posixShellQuote";
import { isNotFound, LockedFile } from "./lockedJsonFile";
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

    return this.locked(configPath).withLock<HookInstallOutcome>(
      async (): Promise<HookInstallOutcome> => {
        // The command is recorded BEFORE the file changes (round-4 B6). Owning a
        // command we never wrote costs nothing — there is nothing to remove —
        // while writing one we never recorded puts it beyond our own reach.
        // A record that reached only this session is not enough: the window can
        // close, and the command in the user's file would then be unrecognisable
        // to every later session (round-7 B6).
        // Reserved against the destination it is about to be written to, so the
        // record names a write rather than a command adrift from its path (D17).
        const reservation = await this.ownership.reserve(configPath, this.command());
        if (!reservation.ok) {
          return reservation.reason === "at-capacity"
            ? { installed: false, reason: "at-capacity", blockedBy: reservation.blockedBy }
            : { installed: false, reason: "write-failed" };
        }
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
    return this.locked(configPath).withLock<HookRemoveOutcome>(
      async (): Promise<HookRemoveOutcome> => {
        // Taken inside the configuration lock so nothing can record a command
        // between this read and the sweep it decides (round-7 B5). Install has
        // its own fresh read through `recordCommand` above.
        await this.ownership.refresh();
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
    // Same write-temp, set-mode, rename, clean-up-on-failure sequence the
    // configuration takes, so there is one implementation of it rather than two
    // that can drift (round-7 reuse). No lock: nothing else writes this path.
    const executable = this.platform === "win32" ? undefined : 0o700;
    if (!(await this.locked(wrapper).atomicReplace(this.adapter.wrapperScript(this.platform), executable))) {
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

  /** The same file, addressed through the shared lock-and-replace discipline (D15). */
  private locked(configPath: string): LockedFile {
    return new LockedFile(configPath, {
      fs: this.fs,
      now: this.now,
      sleep: this.sleep,
      rename: this.replace,
      platform: this.platform,
    });
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
      // An install over an installation already in the desired shape changes
      // nothing, and writing anyway costs the user's file a rewrite plus an
      // mtime bump — and hands a concurrent editor something to collide with
      // for no reason (round-7 W6). The adapters report "changed" after every
      // sweep-and-append, so the bytes are the only honest comparison.
      if (serialized === contents) {
        return "success";
      }
      await this.beforeReplace();
      if (!(await this.matches(configPath, contents))) {
        continue;
      }
      return (await this.locked(configPath).atomicReplace(
        serialized,
        source.kind === "document" ? source.mode : undefined,
      ))
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

function isEmptyJson(stdout: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isJsonObject(parsed) && Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}
