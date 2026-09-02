import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import type { HookInstallOutcome, HookRemoveOutcome } from "../AgentHookController";
import {
  type ClaudeConfigLocation,
  type JsonObject,
  reconcileClaudeSettings,
  resolveClaudeConfigPath,
} from "./claudeConfig";
import { isNotFound, LockedFile, type LockedFileSystem, type Platform } from "./lockedJsonFile";

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
  sleep?: (milliseconds: number) => Promise<void>;
  beforeReplace?: () => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  randomBytes?: (size: number) => Uint8Array;
}

type FileSystem = LockedFileSystem;

type Identity = { dev: number | bigint; ino: number | bigint };
type ComponentIdentity = Identity & { path: string };
type FinalIdentity = { kind: "missing" } | ({ kind: "file" } & Identity);
interface PathAuthorization {
  components: readonly ComponentIdentity[];
  final: FinalIdentity;
}

type AuthorizedRead =
  | { kind: "mismatch" }
  | { kind: "missing" }
  | { kind: "document"; contents: string; document: JsonObject; mode: number }
  | { kind: "unsupported" };

type Operation = "install" | "remove";
type OperationOutcome = HookInstallOutcome | HookRemoveOutcome;

/** Destination-local Claude settings reconciler. It intentionally owns no history or ledger. */
export class ClaudeHookInstaller {
  private readonly fs: FileSystem;
  private readonly platform: Platform;
  private readonly command: string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly beforeReplace: () => Promise<void>;
  private readonly rename?: (oldPath: string, newPath: string) => Promise<void>;
  private readonly createRandomBytes?: (size: number) => Uint8Array;

  public constructor(
    private readonly options: ClaudeHookInstallerOptions = {},
    dependencies: ClaudeHookInstallerDependencies = {},
  ) {
    this.fs = { chmod, link, lstat, mkdir, open, readFile, rename, unlink, writeFile, ...dependencies.fs };
    this.platform = options.platform ?? hostPlatform();
    this.command = options.command ?? CLAUDE_HOOK_COMMAND;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.beforeReplace = dependencies.beforeReplace ?? (async () => undefined);
    this.rename = dependencies.rename;
    this.createRandomBytes = dependencies.randomBytes;
  }

  public async install(): Promise<HookInstallOutcome> {
    if (this.platform === "win32") {
      return { installed: false, reason: "unsupported-platform" };
    }
    return (await this.run(resolveClaudeConfigPath(this.options), "install")) as HookInstallOutcome;
  }

  public async uninstall(): Promise<HookRemoveOutcome> {
    if (this.platform === "win32") {
      return { removed: false, reason: "unsupported-platform" };
    }
    return (await this.run(resolveClaudeConfigPath(this.options), "remove")) as HookRemoveOutcome;
  }

  private async run(path: string, operation: Operation): Promise<OperationOutcome> {
    const locked = this.locked(path);
    // A path is collected ONLY for the one release this process can vouch for.
    // `AgentHookController.formatWarning` joins these straight into the user's
    // warning, and a name that now identifies another writer's live lock must
    // never arrive there (design.md D1, D2).
    const unresolved: string[] = [];
    let unreleased = false;
    const outcome = await locked.withLock<OperationOutcome>(
      async () => {
        const authorization = await this.authorize(path);
        if (!authorization) {
          return this.failure(operation, "unsupported-config", path);
        }
        return this.reconcile(path, operation, authorization);
      },
      this.failure(operation, "lock-unavailable", path, [path, locked.lockPath]),
      this.failure(operation, "write-failed", path),
      (lockPath, release) => {
        unreleased = true;
        if (release === "stuck") {
          unresolved.push(lockPath);
        }
      },
    );
    if (!unreleased) {
      return outcome;
    }
    const committedOrAbsent =
      ("installed" in outcome && outcome.installed) ||
      ("removed" in outcome && (outcome.removed || outcome.reason === "not-installed"));
    return {
      ...outcome,
      reason: committedOrAbsent ? "lock-release-failed" : outcome.reason,
      affected: uniquePaths([...(outcome.affected ?? []), path]),
      unresolved: uniquePaths([...(outcome.unresolved ?? []), ...unresolved]),
    };
  }

  private async reconcile(
    path: string,
    operation: Operation,
    authorization: PathAuthorization,
  ): Promise<OperationOutcome> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const source = await this.readAuthorized(path, authorization);
      if (source.kind === "mismatch") {
        continue;
      }
      if (source.kind === "unsupported") {
        return this.failure(operation, "unsupported-config", path);
      }
      if (source.kind === "missing") {
        if (operation === "remove") {
          return { removed: false, reason: "not-installed" };
        }
        const desired = reconcileClaudeSettings({}, operation, this.command);
        if (desired.kind !== "changed") {
          return this.failure(operation, "write-failed", path);
        }
        const replacement = await this.replace(path, authorization, source, desired.document, undefined);
        if (replacement === "mismatch") {
          continue;
        }
        return replacement === "replaced" ? { installed: true } : this.failure(operation, "write-failed", path);
      }

      const desired = reconcileClaudeSettings(source.document, operation, this.command);
      if (desired.kind === "unsupported") {
        return this.failure(operation, "unsupported-config", path);
      }
      if (desired.kind === "ownership-conflict") {
        return this.failure(operation, "ownership-conflict", path);
      }
      if (desired.kind === "unchanged") {
        if (!(await this.matchesAuthorizedSource(path, authorization, source))) {
          continue;
        }
        return operation === "install" ? { installed: true } : { removed: false, reason: "not-installed" };
      }
      const replacement = await this.replace(path, authorization, source, desired.document, source.mode);
      if (replacement === "mismatch") {
        continue;
      }
      if (replacement === "replaced") {
        return operation === "install" ? { installed: true } : { removed: true };
      }
      return this.failure(operation, "write-failed", path);
    }
    return this.failure(operation, "write-failed", path);
  }

  private async replace(
    path: string,
    authorization: PathAuthorization,
    source: Extract<AuthorizedRead, { kind: "missing" | "document" }>,
    document: JsonObject,
    mode: number | undefined,
  ): Promise<"replaced" | "mismatch" | "failed"> {
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    const staged = await this.locked(path).stageReplacement(contents, mode);
    if (!staged) {
      return "failed";
    }
    try {
      await this.beforeReplace();
      if (!(await this.matchesAuthorizedSource(path, authorization, source))) {
        return "mismatch";
      }
      return (await staged.commit(source.kind === "missing" ? "create" : "replace")) ? "replaced" : "mismatch";
    } finally {
      await staged.discard();
    }
  }

  /** Freezes every ancestor and the final regular-file identity under the sibling lock. */
  private async authorize(path: string): Promise<PathAuthorization | undefined> {
    const components: ComponentIdentity[] = [];
    for (const componentPath of parentComponents(path)) {
      try {
        const entry = await this.fs.lstat(componentPath);
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          return undefined;
        }
        components.push({ path: componentPath, dev: entry.dev, ino: entry.ino });
      } catch {
        return undefined;
      }
    }
    let entry: Awaited<ReturnType<FileSystem["lstat"]>>;
    try {
      entry = await this.fs.lstat(path);
    } catch (error) {
      return isNotFound(error) ? { components, final: { kind: "missing" } } : undefined;
    }
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return undefined;
    }
    try {
      const handle = await this.fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || !sameIdentity(entry, opened)) {
          return undefined;
        }
        return { components, final: { kind: "file", dev: opened.dev, ino: opened.ino } };
      } finally {
        await handle.close();
      }
    } catch {
      return undefined;
    }
  }

  private async readAuthorized(path: string, authorization: PathAuthorization): Promise<AuthorizedRead> {
    if (!(await this.componentsMatch(authorization.components))) {
      return { kind: "mismatch" };
    }
    if (authorization.final.kind === "missing") {
      try {
        await this.fs.lstat(path);
        return { kind: "mismatch" };
      } catch (error) {
        return isNotFound(error) ? { kind: "missing" } : { kind: "mismatch" };
      }
    }
    const opened = await this.openAuthorized(path, authorization.final);
    if (!opened) {
      return { kind: "mismatch" };
    }
    try {
      const contents = await opened.handle.readFile("utf8");
      let document: unknown;
      try {
        document = JSON.parse(contents);
      } catch {
        return { kind: "unsupported" };
      }
      if (typeof document !== "object" || document === null || Array.isArray(document)) {
        return { kind: "unsupported" };
      }
      return {
        kind: "document",
        contents,
        document: document as JsonObject,
        mode: opened.mode,
      };
    } finally {
      await opened.handle.close();
    }
  }

  private async matchesAuthorizedSource(
    path: string,
    authorization: PathAuthorization,
    source: Extract<AuthorizedRead, { kind: "missing" | "document" }>,
  ): Promise<boolean> {
    if (!(await this.componentsMatch(authorization.components))) {
      return false;
    }
    if (source.kind === "missing") {
      try {
        await this.fs.lstat(path);
        return false;
      } catch (error) {
        return isNotFound(error);
      }
    }
    if (authorization.final.kind !== "file") {
      return false;
    }
    const opened = await this.openAuthorized(path, authorization.final);
    if (!opened) {
      return false;
    }
    try {
      return opened.mode === source.mode && (await opened.handle.readFile("utf8")) === source.contents;
    } finally {
      await opened.handle.close();
    }
  }

  private async componentsMatch(components: readonly ComponentIdentity[]): Promise<boolean> {
    for (const expected of components) {
      try {
        const current = await this.fs.lstat(expected.path);
        if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(expected, current)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  private async openAuthorized(
    path: string,
    expected: Identity,
  ): Promise<{ handle: Awaited<ReturnType<FileSystem["open"]>>; mode: number } | undefined> {
    let handle: Awaited<ReturnType<FileSystem["open"]>> | undefined;
    try {
      const entry = await this.fs.lstat(path);
      if (entry.isSymbolicLink() || !entry.isFile() || !sameIdentity(expected, entry)) {
        return undefined;
      }
      handle = await this.fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || !sameIdentity(expected, opened) || !sameIdentity(entry, opened)) {
        await handle.close();
        return undefined;
      }
      return { handle, mode: opened.mode & 0o777 };
    } catch {
      await handle?.close().catch(() => undefined);
      return undefined;
    }
  }

  private failure(operation: Operation, reason: string, path: string, affected = [path]): OperationOutcome {
    return operation === "install" ? { installed: false, reason, affected } : { removed: false, reason, affected };
  }

  private locked(path: string): LockedFile {
    return new LockedFile(path, {
      fs: this.fs,
      sleep: this.sleep,
      rename: this.rename,
      randomBytes: this.createRandomBytes,
      platform: this.platform,
    });
  }
}

function parentComponents(path: string): string[] {
  const parent = posix.dirname(path);
  const root = posix.parse(parent).root;
  const result = [root];
  let current = root;
  for (const segment of parent.slice(root.length).split("/").filter(Boolean)) {
    current = posix.join(current, segment);
    result.push(current);
  }
  return result;
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function hostPlatform(): Platform {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}
