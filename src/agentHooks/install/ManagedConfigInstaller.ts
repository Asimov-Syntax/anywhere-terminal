// src/agentHooks/install/ManagedConfigInstaller.ts — Reconciles only AnyWhere
// Terminal's observational entries in an agent's user hook configuration.
// One reconciler serves every agent (install-claude-hooks D1): it owns the
// cross-process lock, the classified read, compare-and-retry, atomic rename,
// and the wrapper script's lifecycle. What the document looks like belongs to
// the AgentConfigAdapter it is constructed with.

import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { posixShellQuote } from "../../utils/posixShellQuote";
import {
  type AgentConfigAdapter,
  type ConfigRead,
  type HookInstallOutcome,
  type HookRemoveOutcome,
  isJsonObject,
  type JsonObject,
  type OwnershipTest,
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
}

export interface ManagedConfigInstallerDependencies {
  fs?: Partial<FileSystem>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  run?: (file: string, args: string[]) => Promise<{ exitCode: number; stdout: string }>;
  beforeReplace?: () => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
}

const LOCK_WAIT_MS = 25;
const LOCK_MAX_WAIT_MS = 1_000;
const STALE_LOCK_MS = 30_000;
const MAX_RECONCILE_ATTEMPTS = 3;
const WINDOWS_PROBE_DEADLINE_MS = 2_000;
const REAP_GRACE_MS = 500;

export class ManagedConfigInstaller {
  private readonly fs: FileSystem;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly run: (file: string, args: string[]) => Promise<{ exitCode: number; stdout: string }>;
  private readonly replace: (oldPath: string, newPath: string) => Promise<void>;
  private readonly beforeReplace: () => Promise<void>;
  private readonly platform: Platform;

  public constructor(
    private readonly adapter: AgentConfigAdapter,
    private readonly options: ManagedConfigInstallerOptions,
    dependencies: ManagedConfigInstallerDependencies = {},
  ) {
    this.fs = { chmod, lstat, mkdir, open, readFile, rename, stat, unlink, writeFile, ...dependencies.fs };
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.run = dependencies.run ?? runCommand;
    this.replace = dependencies.rename ?? this.fs.rename;
    this.beforeReplace = dependencies.beforeReplace ?? (async () => undefined);
    this.platform =
      options.platform ?? (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
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
        const reconciled = await this.reconcile(configPath, (document, command) =>
          this.adapter.applyManagedEntries(document, command, this.ownershipTest()),
        );
        return reconciled === "success"
          ? { installed: true }
          : { installed: false, reason: reconciled === "unsupported" ? "unsupported-config" : "write-failed" };
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
          removed = this.adapter.removeManagedEntries(document, this.ownershipTest());
          return removed;
        });
        if (reconciled !== "success") {
          return { removed: false, reason: reconciled === "unsupported" ? "unsupported-config" : "write-failed" };
        }
        return removed ? { removed: true } : { removed: false, reason: "not-installed" };
      },
      { removed: false, reason: "lock-unavailable" },
      { removed: false, reason: "write-failed" },
    );
  }

  /**
   * Ownership is the extension-owned directory plus the wrapper filename as the
   * final two path components of the *invoked* command (D3). A substring test
   * would claim `not-cursor-hooks/cursor-hook-observer.sh`, a `.backup` suffix,
   * or the text appearing as somebody else's argument (round-1 B2).
   */
  private ownershipTest(): OwnershipTest {
    const { directoryName, fileName } = this.adapter.wrapperLocation(this.platform);
    return (command: unknown) => {
      if (typeof command !== "string") {
        return false;
      }
      const segments = normalizeSeparators(invokedPath(command, this.platform))
        .split("/")
        .filter((segment) => segment !== "");
      return segments.at(-1) === fileName && segments.at(-2) === directoryName;
    };
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
    // Two deadlines, deliberately. `runCommand` kills and reaps its own child;
    // this one bounds the installer against any injected runner that does not
    // (round-1 W1 — the extraction had only the outer one, which cancels the
    // wait without ending the process).
    const result = await withDeadline(this.run("cmd.exe", ["/d", "/s", "/c", wrapper]), WINDOWS_PROBE_DEADLINE_MS, {
      exitCode: 1,
      stdout: "",
    });
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
    const wrapper = this.wrapperPath();
    return this.platform === "win32" ? `"${wrapper.replaceAll('"', '""')}"` : posixShellQuote(wrapper);
  }
}

function normalizeSeparators(value: string): string {
  return value.replaceAll("\\", "/");
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

/**
 * The deadline lives here so a hung probe is killed and reaped rather than
 * merely stopped being waited on (round-1 W1), and the timeout path waits for
 * `close` before reporting rather than reporting on `kill` (round-2 W1).
 * Termination targets the process group: the probe runs `cmd.exe /c <wrapper>`
 * and the wrapper spawns curl, so killing only the leader leaves a descendant.
 */
export function runCommand(
  file: string,
  args: string[],
  deadlineMs: number = WINDOWS_PROBE_DEADLINE_MS,
): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let settled = false;
    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      clearTimeout(reapDeadline);
      resolve({ exitCode, stdout });
    };
    let reapDeadline: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => {
      terminateTree(child);
      // Report only once the child is actually gone; a second deadline keeps an
      // unkillable process from holding the install open indefinitely.
      reapDeadline = setTimeout(() => finish(1), REAP_GRACE_MS);
      child.once("close", () => finish(1));
    }, deadlineMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      stdout = "";
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

function terminateTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    }
    // Negative pid addresses the group the `detached` spawn created.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The path a stored hook command actually invokes: its first shell word, with
 * quoting resolved the way the shell resolves it. Adjacent runs concatenate, so
 * `'/x/claude-hooks/observer.sh'.bak` yields the `.bak` path the shell would
 * really execute rather than the owned-looking prefix (round-2 B2). An
 * unterminated quote yields nothing, which fails the ownership test — the safe
 * direction, since we decline to claim a command instead of sweeping it.
 */
function invokedPath(command: string, platform: Platform): string {
  return platform === "win32" ? firstWindowsToken(command) : firstPosixWord(command);
}

function firstPosixWord(command: string): string {
  let word = "";
  let index = 0;
  while (index < command.length && isBlank(command[index])) {
    index += 1;
  }
  while (index < command.length) {
    const character = command[index];
    if (isBlank(character)) {
      break;
    }
    if (character === "\\") {
      if (index + 1 >= command.length) {
        return "";
      }
      word += command[index + 1];
      index += 2;
      continue;
    }
    if (character === "'" || character === '"') {
      const closing = command.indexOf(character, index + 1);
      if (closing === -1) {
        return "";
      }
      word += command.slice(index + 1, closing);
      index = closing + 1;
      continue;
    }
    word += character;
    index += 1;
  }
  return word;
}

/** cmd.exe: `"` toggles quoting and `""` inside quotes is one literal quote. */
function firstWindowsToken(command: string): string {
  let token = "";
  let index = 0;
  let quoted = false;
  while (index < command.length && isBlank(command[index])) {
    index += 1;
  }
  while (index < command.length) {
    const character = command[index];
    if (character === '"') {
      if (quoted && command[index + 1] === '"') {
        token += '"';
        index += 2;
        continue;
      }
      quoted = !quoted;
      index += 1;
      continue;
    }
    if (!quoted && isBlank(character)) {
      break;
    }
    token += character;
    index += 1;
  }
  return quoted ? "" : token;
}

function isBlank(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}
