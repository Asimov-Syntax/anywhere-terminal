import { randomBytes } from "node:crypto";
import { chmod, lstat, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { LockedFile } from "../agentHooks/install/lockedJsonFile";
import { posixShellQuote } from "../utils/posixShellQuote";

export const CURSOR_HOOK_EVENTS = [
  "sessionStart",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "afterAgentResponse",
  "stop",
  "sessionEnd",
] as const;

/** Frozen POSIX generation: the whole ownership key and the shell program Cursor executes. */
export const CURSOR_HOOK_COMMAND =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: frozen POSIX parameter expansion is a literal command byte sequence
  "set +e +x 2>/dev/null; trap '' PIPE 2>/dev/null; unset -f command awk cat curl printf read 2>/dev/null || :; printf '{}\\n'; payload=$(command -p cat 2>/dev/null) || { while IFS= read -r _; do :; done; exit 0; }; url=${ANYWHERE_TERMINAL_CURSOR_URL:-}; command -p awk 'BEGIN { u=ARGV[1]; if (u !~ /^http:\\/\\/127[.]0[.]0[.]1:[0-9]+\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[0-9a-f]+$/) exit 1; n=split(u,p,\"/\"); split(p[3],a,\":\"); port=a[2]+0; if (n != 5 || port < 1 || port > 65535 || length(p[5]) != 64) exit 1 }' \"$url\" 2>/dev/null || exit 0; printf '%s' \"$payload\" | command -p curl --disable --silent --noproxy '*' --globoff --proto '=http' --output /dev/null --connect-timeout 0.5 --max-time 1.5 --request POST --header \"content-type: application/json\" --data-binary @- -- \"$url/cursor\" 2>/dev/null || :; exit 0";

type JsonObject = Record<string, unknown>;

type FileSystem = Pick<
  typeof import("node:fs/promises"),
  "chmod" | "lstat" | "open" | "readFile" | "rename" | "stat" | "unlink" | "writeFile"
>;

export interface CursorHookInstallerOptions {
  configPath: string;
  storagePath: string;
  platform?: "darwin" | "linux" | "win32";
}

export interface CursorHookInstallerDependencies {
  fs?: Partial<FileSystem>;
  now?: () => number;
  /** Injectable so a test can be waiting at the staging name, as a guesser would be. */
  randomBytes?: (size: number) => Uint8Array;
  sleep?: (milliseconds: number) => Promise<void>;
  beforeReplace?: () => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
}

export interface CursorHookInstallResult {
  installed: boolean;
  reason?:
    | "unsupported-config"
    | "lock-unavailable"
    | "write-failed"
    | "unsupported-platform"
    | "legacy-wrapper-delete-failed"
    | "legacy-wrapper-referenced"
    | "lock-release-failed";
  unresolved?: readonly string[];
}

export interface CursorHookRemoveResult {
  removed: boolean;
  reason?:
    | "unsupported-config"
    | "lock-unavailable"
    | "write-failed"
    | "not-installed"
    | "legacy-wrapper-delete-failed"
    | "legacy-wrapper-referenced"
    | "lock-release-failed";
  unresolved?: readonly string[];
}

const MAX_RECONCILE_ATTEMPTS = 3;

/** Reconciles only AnyWhere Terminal's observational entries in Cursor's user hook file. */
export class CursorHookInstaller {
  private readonly fs: FileSystem;
  private readonly now: () => number;
  private readonly createRandomBytes: (size: number) => Uint8Array;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly replace: (oldPath: string, newPath: string) => Promise<void>;
  private readonly beforeReplace: () => Promise<void>;
  private readonly platform: "darwin" | "linux" | "win32";

  public constructor(
    private readonly options: CursorHookInstallerOptions,
    dependencies: CursorHookInstallerDependencies = {},
  ) {
    this.fs = {
      chmod,
      lstat,
      open,
      readFile,
      rename,
      stat,
      unlink,
      writeFile,
      ...dependencies.fs,
    };
    this.now = dependencies.now ?? Date.now;
    this.createRandomBytes = dependencies.randomBytes ?? randomBytes;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.replace = dependencies.rename ?? this.fs.rename;
    this.beforeReplace = dependencies.beforeReplace ?? (async () => undefined);
    this.platform =
      options.platform ?? (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
  }

  public async install(): Promise<CursorHookInstallResult> {
    // No Windows command is frozen until a real Cursor Agent executes it. An
    // enable request there is therefore a removal-only reconcile (D6), and its
    // cleanup answer wins over the generic platform result.
    if (this.platform === "win32") {
      const cleanup = await this.uninstall();
      if (cleanup.reason === "not-installed") {
        return { installed: false, reason: "unsupported-platform" };
      }
      // The reason as well as the list. Once a stuck release stopped naming its
      // lock, an empty `unresolved` no longer meant the cleanup resolved — it
      // read as clean and reported `unsupported-platform` over a lock still in
      // the way, which is the one thing the user needed to hear.
      const clean =
        (!cleanup.unresolved || cleanup.unresolved.length === 0) && cleanup.reason !== "lock-release-failed";
      if (clean && cleanup.removed) {
        return { installed: false, reason: "unsupported-platform" };
      }
      return {
        installed: false,
        reason: cleanup.reason ?? "write-failed",
        ...(cleanup.unresolved ? { unresolved: cleanup.unresolved } : {}),
      };
    }

    return this.withLock<CursorHookInstallResult>(
      async (): Promise<CursorHookInstallResult> => {
        let legacyReferenced = false;
        const reconciled = await this.reconcile((document, managedCommand, ownedCommands) => {
          const hooks = document.hooks as Record<string, JsonObject[]>;
          for (const event of CURSOR_HOOK_EVENTS) {
            const entries = hooks[event] ?? [];
            hooks[event] = [
              ...entries.filter((entry) => !isOwnedEntry(entry, ownedCommands)),
              ownedEntry(managedCommand),
            ];
          }
          legacyReferenced = hasCommandReference(hooks, this.legacyCommand());
          return true;
        });
        if (reconciled !== "success") {
          return {
            installed: false,
            reason: reconciled === "unsupported" ? "unsupported-config" : "write-failed",
            unresolved: this.unresolvedConfigPaths(),
          };
        }
        if (this.platform === "win32") {
          return { installed: true };
        }
        if (legacyReferenced) {
          return {
            installed: true,
            reason: "legacy-wrapper-referenced",
            unresolved: [this.wrapperPath()],
          };
        }
        const wrapper = await this.removeLegacyWrapper();
        return wrapper === "failed"
          ? {
              installed: true,
              reason: "legacy-wrapper-delete-failed",
              unresolved: [this.wrapperPath()],
            }
          : { installed: true };
      },
      {
        installed: false,
        reason: "lock-unavailable",
        unresolved: this.unresolvedConfigPaths(),
      },
      { installed: false, reason: "write-failed", unresolved: this.unresolvedConfigPaths() },
      // The reason alone. A lock pathname is never handed to the user: the name is
      // reboundable and the warning is read long after the release failed, so
      // acting on it can delete a live lock (say-which-lock-a-save-left-behind
      // design.md D1, and the spec's "in the panel or in any warning").
      (result) => ({ ...result, reason: "lock-release-failed" }),
    );
  }

  public async uninstall(): Promise<CursorHookRemoveResult> {
    return this.withLock<CursorHookRemoveResult>(
      async (): Promise<CursorHookRemoveResult> => {
        let legacyReferenced = false;
        let removed = false;
        const reconciled = await this.reconcile((document, _managedCommand, ownedCommands) => {
          const hooks = document.hooks as Record<string, JsonObject[]>;
          for (const event of CURSOR_HOOK_EVENTS) {
            const entries = hooks[event] ?? [];
            const retained = entries.filter((entry) => !isOwnedEntry(entry, ownedCommands));
            if (retained.length !== entries.length) {
              hooks[event] = retained;
              removed = true;
            }
          }
          legacyReferenced = hasCommandReference(hooks, this.legacyCommand());
          return removed;
        });
        if (reconciled !== "success") {
          return {
            removed: false,
            reason: reconciled === "unsupported" ? "unsupported-config" : "write-failed",
            unresolved: this.unresolvedConfigPaths(),
          };
        }
        if (legacyReferenced) {
          return {
            removed: false,
            reason: "legacy-wrapper-referenced",
            unresolved: [this.wrapperPath()],
          };
        }
        const wrapper = await this.removeLegacyWrapper();
        if (wrapper === "failed") {
          return {
            removed: false,
            reason: "legacy-wrapper-delete-failed",
            unresolved: [this.wrapperPath()],
          };
        }
        if (removed || wrapper === "removed") {
          return { removed: true };
        }
        return { removed: false, reason: "not-installed" };
      },
      {
        removed: false,
        reason: "lock-unavailable",
        unresolved: this.unresolvedConfigPaths(),
      },
      { removed: false, reason: "write-failed", unresolved: this.unresolvedConfigPaths() },
      // The reason alone. A lock pathname is never handed to the user: the name is
      // reboundable and the warning is read long after the release failed, so
      // acting on it can delete a live lock (say-which-lock-a-save-left-behind
      // design.md D1, and the spec's "in the panel or in any warning").
      (result) => ({ ...result, reason: "lock-release-failed" }),
    );
  }

  /**
   * The user's own files, and never the lock. A lock this process failed to
   * acquire is the one name it has least standing to vouch for — it belongs to
   * whoever is holding it, and by the time the warning is read it may belong to
   * someone else again.
   */
  private unresolvedConfigPaths(): readonly string[] {
    return [this.options.configPath, this.wrapperPath()];
  }

  private async removeLegacyWrapper(): Promise<"removed" | "missing" | "failed"> {
    try {
      await this.fs.unlink(this.wrapperPath());
      return "removed";
    } catch (error) {
      return isNotFound(error) ? "missing" : "failed";
    }
  }

  /**
   * The shared lock, not a second one.
   *
   * This class kept its own: it closed the acquired handle immediately, so it
   * held nothing to release AGAINST, and its release unlinked the pathname
   * unconditionally — destroying a different writer's live lock whenever ours had
   * been renamed away or replaced. `LockedFile` compares the held inode first and
   * refuses when the name is `notOurs` (install-claude-hooks-v1 D1, D3).
   *
   * The trade is not free and is stated in `docs/design/worktree-provisioning.md`
   * § 7 as R4, with what a user can do about it: where the name was replaced by
   * something abandoned, the old code unlinked it and freed the name, and this one
   * leaves it for a holder that may not exist. Nothing reclaims a lock by age.
   */
  private async withLock<T>(
    work: () => Promise<T>,
    lockUnavailable: T,
    writeFailed: T,
    lockReleaseFailed: (result: T) => T,
  ): Promise<T> {
    let releaseFailed = false;
    const result = await this.locked().withLock(work, lockUnavailable, writeFailed, () => {
      releaseFailed = true;
    });
    // The reason only — never the pathname. `LockedFile` hands the callback a
    // lock path and this deliberately drops it.
    return releaseFailed ? lockReleaseFailed(result) : result;
  }

  private async reconcile(
    change: (document: JsonObject, managedCommand: string, ownedCommands: readonly string[]) => boolean,
  ): Promise<"success" | "unsupported" | "failed"> {
    const managedCommand = this.managedCommand();
    const ownedCommands = this.ownedCommands();
    for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
      const source = await this.readConfiguration();
      if (!source || !isSupportedDocument(source.document)) {
        return source ? "unsupported" : "failed";
      }
      const desired = structuredClone(source.document);
      if (!change(desired, managedCommand, ownedCommands)) {
        return "success";
      }
      const serialized = `${JSON.stringify(desired, null, 2)}\n`;
      await this.beforeReplace();
      if (!(await this.matches(source.contents))) {
        continue;
      }
      return (await this.atomicReplace(serialized, source.mode)) ? "success" : "failed";
    }
    return "failed";
  }

  private async readConfiguration(): Promise<{ contents: string; document: JsonObject; mode?: number } | undefined> {
    try {
      if ((await this.fs.lstat(this.options.configPath)).isSymbolicLink()) {
        return { contents: "", document: {} };
      }
    } catch (error) {
      if (!isNotFound(error)) {
        return undefined;
      }
    }
    let contents: string;
    try {
      contents = await this.fs.readFile(this.options.configPath, "utf8");
    } catch (error) {
      return isNotFound(error) ? { contents: "", document: { version: 1, hooks: {} } } : undefined;
    }
    let document: unknown;
    try {
      document = JSON.parse(contents);
    } catch {
      return { contents, document: {} };
    }
    try {
      const file = await this.fs.stat(this.options.configPath);
      return { contents, document: isObject(document) ? document : {}, mode: file.mode & 0o777 };
    } catch {
      return undefined;
    }
  }

  private async matches(contents: string): Promise<boolean> {
    try {
      return (await this.fs.readFile(this.options.configPath, "utf8")) === contents;
    } catch (error) {
      return contents === "" && isNotFound(error);
    }
  }

  /**
   * The shared staging, not a copy of it.
   *
   * The copy cleaned up by PATHNAME: any failure after the exclusive create
   * unlinked the staging name outright, so an observer who moved the owned
   * temporary and left something else there had that something else deleted
   * (review round 1 F001). `stageReplacement` discards only a temporary whose
   * identity it still owns. It is also where the random name and the `wx` create
   * live, so there is one place for the next invariant to land rather than two.
   */
  private async atomicReplace(contents: string, mode: number | undefined): Promise<boolean> {
    return this.locked().atomicReplace(contents, mode);
  }

  private locked(): LockedFile {
    return new LockedFile(this.options.configPath, {
      fs: this.fs,
      sleep: this.sleep,
      platform: this.platform,
      rename: this.replace,
      randomBytes: this.createRandomBytes,
    });
  }

  private wrapperPath(): string {
    const path = this.platform === "win32" ? win32 : posix;
    return path.join(
      this.options.storagePath,
      this.platform === "win32" ? "cursor-hook-observer.cmd" : "cursor-hook-observer.sh",
    );
  }

  private managedCommand(): string {
    return this.platform === "win32" ? this.legacyCommand() : CURSOR_HOOK_COMMAND;
  }

  private ownedCommands(): readonly string[] {
    return this.platform === "win32" ? [this.legacyCommand()] : [CURSOR_HOOK_COMMAND, this.legacyCommand()];
  }

  private legacyCommand(): string {
    const wrapper = this.wrapperPath();
    return this.platform === "win32" ? `"${wrapper.replaceAll('"', '""')}"` : posixShellQuote(wrapper);
  }
}

function ownedEntry(command: string): JsonObject {
  return { command, timeout: 2 };
}

function hasCommandReference(hooks: Record<string, JsonObject[]>, command: string): boolean {
  return Object.values(hooks).some((entries) => entries.some((entry) => entry.command === command));
}

function isOwnedEntry(entry: JsonObject, commands: readonly string[]): boolean {
  const keys = Object.keys(entry).sort();
  return (
    keys.length === 2 &&
    keys[0] === "command" &&
    keys[1] === "timeout" &&
    typeof entry.command === "string" &&
    commands.includes(entry.command) &&
    entry.timeout === 2
  );
}

function isSupportedDocument(document: JsonObject): boolean {
  if (document.version !== 1 || !isObject(document.hooks)) {
    return false;
  }
  return Object.values(document.hooks).every(
    (entries) => Array.isArray(entries) && entries.every((entry) => isObject(entry)),
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
