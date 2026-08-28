import { chmod, lstat, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { posix, win32 } from "node:path";
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

const LOCK_WAIT_MS = 25;
const LOCK_MAX_WAIT_MS = 1_000;
const MAX_RECONCILE_ATTEMPTS = 3;

/** Reconciles only AnyWhere Terminal's observational entries in Cursor's user hook file. */
export class CursorHookInstaller {
  private readonly fs: FileSystem;
  private readonly now: () => number;
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
      const clean = !cleanup.unresolved || cleanup.unresolved.length === 0;
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
        unresolved: this.unresolvedConfigPaths(true),
      },
      { installed: false, reason: "write-failed", unresolved: this.unresolvedConfigPaths() },
      (result, lockPath) => ({
        ...result,
        reason: "lock-release-failed",
        unresolved: appendUnresolved(result.unresolved, lockPath),
      }),
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
        unresolved: this.unresolvedConfigPaths(true),
      },
      { removed: false, reason: "write-failed", unresolved: this.unresolvedConfigPaths() },
      (result, lockPath) => ({
        ...result,
        reason: "lock-release-failed",
        unresolved: appendUnresolved(result.unresolved, lockPath),
      }),
    );
  }

  private unresolvedConfigPaths(includeLock = false): readonly string[] {
    return [this.options.configPath, this.wrapperPath(), ...(includeLock ? [this.lockPath()] : [])];
  }

  private async removeLegacyWrapper(): Promise<"removed" | "missing" | "failed"> {
    try {
      await this.fs.unlink(this.wrapperPath());
      return "removed";
    } catch (error) {
      return isNotFound(error) ? "missing" : "failed";
    }
  }

  private async withLock<T>(
    work: () => Promise<T>,
    lockUnavailable: T,
    writeFailed: T,
    lockReleaseFailed: (result: T, lockPath: string) => T,
  ): Promise<T> {
    const lockPath = this.lockPath();
    if (!(await this.acquireLock(lockPath))) {
      return lockUnavailable;
    }
    let result: T;
    try {
      result = await work();
    } catch {
      result = writeFailed;
    }
    try {
      await this.fs.unlink(lockPath);
    } catch (error) {
      if (!isNotFound(error)) {
        return lockReleaseFailed(result, lockPath);
      }
    }
    return result;
  }

  private lockPath(): string {
    return `${this.options.configPath}.anywhere-terminal.lock`;
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
        // Age is not ownership. A paused extension host can legitimately hold
        // this lock beyond any wall-clock threshold; deleting it would let two
        // hosts replace the same user config concurrently. Fail closed after
        // the bounded wait instead (inline-cursor-hooks D8).
        await this.sleep(LOCK_WAIT_MS);
      }
    }
    return false;
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

  private async atomicReplace(contents: string, mode: number | undefined): Promise<boolean> {
    const path = this.platform === "win32" ? win32 : posix;
    const temporaryPath = path.join(
      path.dirname(this.options.configPath),
      `.${path.basename(this.options.configPath) || "hooks.json"}.${this.now()}.tmp`,
    );
    try {
      await this.fs.writeFile(temporaryPath, contents, { encoding: "utf8", mode: mode ?? 0o600 });
      if (mode !== undefined) {
        await this.fs.chmod(temporaryPath, mode);
      }
      await this.replace(temporaryPath, this.options.configPath);
      return true;
    } catch {
      await this.fs.unlink(temporaryPath).catch(() => undefined);
      return false;
    }
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

function appendUnresolved(paths: readonly string[] | undefined, path: string): readonly string[] {
  return paths?.includes(path) ? paths : [...(paths ?? []), path];
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

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
