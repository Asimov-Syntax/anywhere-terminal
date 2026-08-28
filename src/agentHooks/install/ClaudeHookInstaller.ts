import { lstat, readFile, stat } from "node:fs/promises";
import type { HookInstallOutcome, HookRemoveOutcome } from "../AgentHookController";
import {
  type ClaudeConfigLocation,
  type JsonObject,
  reconcileClaudeSettings,
  resolveClaudeConfigPath,
} from "./claudeConfig";
import { isNotFound, LockedFile, type LockedFileSystem, type Platform } from "./lockedJsonFile";

type FileSystem = Pick<typeof import("node:fs/promises"), "lstat" | "readFile" | "stat"> & LockedFileSystem;

/**
 * D7: the one frozen POSIX shell literal registered on Darwin and Linux. It consumes stdin,
 * emits neutral JSON, drains and exits on background jobs, validates the loopback URL with awk
 * before any network attempt, and sends the payload only to that validated coordinate.
 */
export const CLAUDE_HOOK_COMMAND =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: frozen POSIX parameter expansions are literal command bytes
  'set +e +x 2>/dev/null; trap \'\' PIPE 2>/dev/null; unset -f command awk cat curl printf read 2>/dev/null || :; printf \'{}\\n\'; payload=$(command -p cat 2>/dev/null) || { while IFS= read -r _; do :; done; exit 0; }; case ${CLAUDE_JOB_DIR:-} in \'\') ;; *) exit 0 ;; esac; url=${ANYWHERE_TERMINAL_CLAUDE_URL:-}; command -p awk \'BEGIN { u=ARGV[1]; if (u !~ /^http:\\/\\/127[.]0[.]0[.]1:[0-9]+\\/[^\\/?#]+\\/[0-9a-f]+$/) exit 1; n=split(u,p,"/"); split(p[3],a,":"); port=a[2]+0; s=p[4]; if (n != 5 || port < 1 || port > 65535 || length(p[5]) != 64) exit 1; for (i=1; i<=length(s); i++) { c=substr(s,i,1); if (c == "%") { h=substr(s,i+1,2); if (h !~ /^[0-9A-F]{2}$/) exit 1; i += 2 } else if (c !~ /^[A-Za-z0-9_.!~*()-]$/ && c != sprintf("%c",39)) exit 1 } }\' "$url" 2>/dev/null || exit 0; printf \'%s\' "$payload" | command -p curl --disable --silent --noproxy \'*\' --globoff --proto \'=http\' --output /dev/null --connect-timeout 0.5 --max-time 1.5 --request POST --header "content-type: application/json" --data-binary @- -- "$url/claude" 2>/dev/null || :; exit 0';

export interface ClaudeHookInstallerOptions extends ClaudeConfigLocation {
  command?: string;
  platform?: Platform;
}

export interface ClaudeHookInstallerDependencies {
  fs?: Partial<FileSystem>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  beforeReplace?: () => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
}

type ReadResult =
  | { kind: "missing" }
  | { kind: "document"; contents: string; document: JsonObject; mode: number }
  | { kind: "unsupported" };

/** Destination-local Claude settings reconciler. It intentionally owns no history or ledger. */
export class ClaudeHookInstaller {
  private readonly fs: FileSystem;
  private readonly platform: Platform;
  private readonly command: string;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly beforeReplace: () => Promise<void>;
  private readonly rename?: (oldPath: string, newPath: string) => Promise<void>;

  public constructor(
    private readonly options: ClaudeHookInstallerOptions = {},
    dependencies: ClaudeHookInstallerDependencies = {},
  ) {
    this.fs = { lstat, readFile, stat, ...dependencies.fs } as FileSystem;
    this.platform = options.platform ?? hostPlatform();
    this.command = options.command ?? CLAUDE_HOOK_COMMAND;
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.beforeReplace = dependencies.beforeReplace ?? (async () => undefined);
    this.rename = dependencies.rename;
  }

  public async install(): Promise<HookInstallOutcome> {
    if (this.platform === "win32") {
      return { installed: false, reason: "unsupported-platform" };
    }
    const path = resolveClaudeConfigPath(this.options);
    if (await this.isSymlink(path)) {
      return { installed: false, reason: "unsupported-config" };
    }
    const unresolved: string[] = [];
    const outcome = await this.locked(path).withLock<HookInstallOutcome>(
      async () => this.reconcile(path, "install") as Promise<HookInstallOutcome>,
      { installed: false, reason: "lock-unavailable" },
      { installed: false, reason: "write-failed" },
      (lockPath) => unresolved.push(lockPath),
    );
    return unresolved.length === 0 ? outcome : { ...outcome, unresolved };
  }

  public async uninstall(): Promise<HookRemoveOutcome> {
    if (this.platform === "win32") {
      return { removed: false, reason: "unsupported-platform" };
    }
    const path = resolveClaudeConfigPath(this.options);
    if (await this.isSymlink(path)) {
      return { removed: false, reason: "unsupported-config" };
    }
    // Avoid creating a directory and lock just to report the absent current destination.
    if ((await this.readConfiguration(path)).kind === "missing") {
      return { removed: false, reason: "not-installed" };
    }
    const unresolved: string[] = [];
    const outcome = await this.locked(path).withLock<HookRemoveOutcome>(
      async () => this.reconcile(path, "remove") as Promise<HookRemoveOutcome>,
      { removed: false, reason: "lock-unavailable" },
      { removed: false, reason: "write-failed" },
      (lockPath) => unresolved.push(lockPath),
    );
    return unresolved.length === 0 ? outcome : { ...outcome, unresolved };
  }

  private async reconcile(
    path: string,
    operation: "install" | "remove",
  ): Promise<HookInstallOutcome | HookRemoveOutcome> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const source = await this.readConfiguration(path);
      if (source.kind === "unsupported") {
        return operation === "install"
          ? { installed: false, reason: "unsupported-config" }
          : { removed: false, reason: "unsupported-config" };
      }
      if (source.kind === "missing") {
        if (operation === "remove") {
          return { removed: false, reason: "not-installed" };
        }
        const desired = reconcileClaudeSettings({}, operation, this.command);
        const replacement =
          desired.kind === "changed" ? await this.replace(path, "", desired.document, undefined) : "failed";
        if (replacement === "mismatch") {
          continue;
        }
        return replacement === "replaced" || replacement === "unchanged"
          ? { installed: true }
          : { installed: false, reason: "write-failed" };
      }
      const desired = reconcileClaudeSettings(source.document, operation, this.command);
      if (desired.kind === "unsupported") {
        return operation === "install"
          ? { installed: false, reason: "unsupported-config" }
          : { removed: false, reason: "unsupported-config" };
      }
      if (desired.kind === "ownership-conflict") {
        return operation === "install"
          ? { installed: false, reason: "ownership-conflict" }
          : { removed: false, reason: "ownership-conflict" };
      }
      if (desired.kind === "unchanged") {
        return operation === "install" ? { installed: true } : { removed: false, reason: "not-installed" };
      }
      const replacement = await this.replace(path, source.contents, desired.document, source.mode);
      if (replacement === "mismatch") {
        continue;
      }
      if (replacement === "replaced" || replacement === "unchanged") {
        return operation === "install" ? { installed: true } : { removed: true };
      }
      return operation === "install"
        ? { installed: false, reason: "write-failed" }
        : { removed: false, reason: "write-failed" };
    }
    return operation === "install"
      ? { installed: false, reason: "write-failed" }
      : { removed: false, reason: "write-failed" };
  }

  private async replace(
    path: string,
    source: string,
    document: JsonObject,
    mode: number | undefined,
  ): Promise<"replaced" | "unchanged" | "mismatch" | "failed"> {
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    if (contents === source) {
      return "unchanged";
    }
    await this.beforeReplace();
    if (!(await this.matches(path, source))) {
      return "mismatch";
    }
    return (await this.locked(path).atomicReplace(contents, mode)) ? "replaced" : "failed";
  }

  private async isSymlink(path: string): Promise<boolean> {
    try {
      return (await this.fs.lstat(path)).isSymbolicLink();
    } catch (error) {
      return !isNotFound(error);
    }
  }

  private async readConfiguration(path: string): Promise<ReadResult> {
    let contents: string;
    try {
      contents = await this.fs.readFile(path, "utf8");
    } catch (error) {
      return isNotFound(error) ? { kind: "missing" } : { kind: "unsupported" };
    }
    try {
      const document: unknown = JSON.parse(contents);
      if (typeof document !== "object" || document === null || Array.isArray(document)) {
        return { kind: "unsupported" };
      }
      return {
        kind: "document",
        contents,
        document: document as JsonObject,
        mode: (await this.fs.stat(path)).mode & 0o777,
      };
    } catch {
      return { kind: "unsupported" };
    }
  }

  private async matches(path: string, source: string): Promise<boolean> {
    try {
      return (await this.fs.readFile(path, "utf8")) === source;
    } catch (error) {
      return source === "" && isNotFound(error);
    }
  }

  private locked(path: string): LockedFile {
    return new LockedFile(path, {
      fs: this.fs,
      now: this.now,
      sleep: this.sleep,
      rename: this.rename,
      platform: this.platform,
    });
  }
}

function hostPlatform(): Platform {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}
