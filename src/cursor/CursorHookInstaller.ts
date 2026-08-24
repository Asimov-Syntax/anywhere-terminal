import { spawn } from "node:child_process";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
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

type JsonObject = Record<string, unknown>;

type FileSystem = Pick<
  typeof import("node:fs/promises"),
  "chmod" | "mkdir" | "open" | "readFile" | "rename" | "stat" | "unlink" | "writeFile"
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
  run?: (file: string, args: string[]) => Promise<{ exitCode: number; stdout: string }>;
  beforeReplace?: () => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
}

export interface CursorHookInstallResult {
  installed: boolean;
  reason?: "unsupported-config" | "lock-unavailable" | "write-failed" | "windows-probe-failed";
}

export interface CursorHookRemoveResult {
  removed: boolean;
  reason?: "unsupported-config" | "lock-unavailable" | "write-failed" | "not-installed";
}

const LOCK_WAIT_MS = 25;
const LOCK_MAX_WAIT_MS = 1_000;
const STALE_LOCK_MS = 30_000;
const MAX_RECONCILE_ATTEMPTS = 3;
const WINDOWS_PROBE_DEADLINE_MS = 2_000;

/** Reconciles only AnyWhere Terminal's observational entries in Cursor's user hook file. */
export class CursorHookInstaller {
  private readonly fs: FileSystem;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly run: (file: string, args: string[]) => Promise<{ exitCode: number; stdout: string }>;
  private readonly replace: (oldPath: string, newPath: string) => Promise<void>;
  private readonly beforeReplace: () => Promise<void>;
  private readonly platform: "darwin" | "linux" | "win32";

  public constructor(
    private readonly options: CursorHookInstallerOptions,
    dependencies: CursorHookInstallerDependencies = {},
  ) {
    this.fs = {
      chmod,
      mkdir,
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
    this.run = dependencies.run ?? runCommand;
    this.replace = dependencies.rename ?? this.fs.rename;
    this.beforeReplace = dependencies.beforeReplace ?? (async () => undefined);
    this.platform =
      options.platform ?? (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
  }

  public async install(): Promise<CursorHookInstallResult> {
    const wrapper = await this.createWrapper();
    if (wrapper === "failed") {
      return { installed: false, reason: "write-failed" };
    }
    if (wrapper === "probe-failed") {
      return { installed: false, reason: "windows-probe-failed" };
    }

    return this.withLock<CursorHookInstallResult>(
      async (): Promise<CursorHookInstallResult> => {
        const reconciled = await this.reconcile((document, command) => {
          const hooks = document.hooks as Record<string, JsonObject[]>;
          for (const event of CURSOR_HOOK_EVENTS) {
            const entries = hooks[event] ?? [];
            hooks[event] = [...entries.filter((entry) => !isOwnedEntry(entry, command)), ownedEntry(command)];
          }
          return true;
        });
        return reconciled === "success"
          ? { installed: true }
          : { installed: false, reason: reconciled === "unsupported" ? "unsupported-config" : "write-failed" };
      },
      { installed: false, reason: "lock-unavailable" },
      { installed: false, reason: "write-failed" },
    );
  }

  public async uninstall(): Promise<CursorHookRemoveResult> {
    return this.withLock<CursorHookRemoveResult>(
      async (): Promise<CursorHookRemoveResult> => {
        let removed = false;
        const reconciled = await this.reconcile((document, command) => {
          const hooks = document.hooks as Record<string, JsonObject[]>;
          for (const [event, entries] of Object.entries(hooks)) {
            const retained = entries.filter((entry) => !isOwnedEntry(entry, command));
            if (retained.length !== entries.length) {
              hooks[event] = retained;
              removed = true;
            }
          }
          return removed;
        });
        if (reconciled !== "success") {
          return {
            removed: false,
            reason: reconciled === "unsupported" ? "unsupported-config" : "write-failed",
          };
        }
        return removed ? { removed: true } : { removed: false, reason: "not-installed" };
      },
      { removed: false, reason: "lock-unavailable" },
      { removed: false, reason: "write-failed" },
    );
  }

  private async createWrapper(): Promise<"ready" | "probe-failed" | "failed"> {
    try {
      await this.fs.mkdir(this.options.storagePath, { recursive: true });
      const wrapper = this.wrapperPath();
      await this.fs.writeFile(wrapper, this.platform === "win32" ? windowsWrapper() : posixWrapper(), "utf8");
      if (this.platform !== "win32") {
        await this.fs.chmod(wrapper, 0o700);
        return "ready";
      }

      const result = await withDeadline(this.run("cmd.exe", ["/d", "/s", "/c", wrapper]), WINDOWS_PROBE_DEADLINE_MS, {
        exitCode: 1,
        stdout: "",
      });
      return result.exitCode === 0 && isEmptyJson(result.stdout) ? "ready" : "probe-failed";
    } catch {
      return "failed";
    }
  }

  private async withLock<T>(work: () => Promise<T>, lockUnavailable: T, writeFailed: T): Promise<T> {
    const lockPath = `${this.options.configPath}.anywhere-terminal.lock`;
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
    change: (document: JsonObject, command: string) => boolean,
  ): Promise<"success" | "unsupported" | "failed"> {
    const command = this.command();
    for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
      const source = await this.readConfiguration();
      if (!source || !isSupportedDocument(source.document)) {
        return source ? "unsupported" : "failed";
      }
      const desired = structuredClone(source.document);
      if (!change(desired, command)) {
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
    return join(
      this.options.storagePath,
      this.platform === "win32" ? "cursor-hook-observer.cmd" : "cursor-hook-observer.sh",
    );
  }

  private command(): string {
    const wrapper = this.wrapperPath();
    return this.platform === "win32" ? `"${wrapper.replaceAll('"', '""')}"` : posixShellQuote(wrapper);
  }
}

function ownedEntry(command: string): JsonObject {
  return { command, timeout: 2 };
}

function isOwnedEntry(entry: JsonObject, command: string): boolean {
  const keys = Object.keys(entry).sort();
  return (
    keys.length === 2 &&
    keys[0] === "command" &&
    keys[1] === "timeout" &&
    entry.command === command &&
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

function isEmptyJson(stdout: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isObject(parsed) && Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}

function posixWrapper(): string {
  const url = "$" + "{ANYWHERE_TERMINAL_CURSOR_URL}";
  const optionalUrl = "$" + "{ANYWHERE_TERMINAL_CURSOR_URL:-}";
  return `${[
    "#!/bin/sh",
    "# Managed by AnyWhere Terminal. This observer is intentionally fail-open.",
    `if [ -n "${optionalUrl}" ] && command -v curl >/dev/null 2>&1; then`,
    "  curl --silent --output /dev/null --connect-timeout 0.5 --max-time 1.5 \\",
    '    --request POST --header "content-type: application/json" \\',
    `    --data-binary @- "${url}/cursor" || true`,
    "fi",
    "cat >/dev/null 2>&1 || true",
    'printf "{}\\n"',
  ].join("\n")}\n`;
}

function windowsWrapper(): string {
  return `@echo off
setlocal
if not defined ANYWHERE_TERMINAL_CURSOR_URL goto output
powershell -NoProfile -ExecutionPolicy Bypass -Command "$body=[Console]::In.ReadToEnd(); try { Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' -TimeoutSec 2 -Body $body ($env:ANYWHERE_TERMINAL_CURSOR_URL + '/cursor') ^| Out-Null } catch {}"
:output
more >nul 2>nul
echo {}
exit /b 0
`;
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function runCommand(file: string, args: string[]): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    let stdout = "";
    let settled = false;
    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(1);
    }, WINDOWS_PROBE_DEADLINE_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stdin.end();
    child.once("error", () => finish(1));
    child.once("close", (exitCode) => finish(exitCode ?? 1));
  });
}
