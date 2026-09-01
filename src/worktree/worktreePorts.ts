import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, open } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import type { ProvisionPort, ProvisionPortResult, ProvisionPortWarning } from "../types/messages";
import { LockedFile, type StagedReplacement } from "../utils/lockedFile";
import { addToGitExclude, type ExcludeResult } from "./gitExclude";

const CLAIM_FILE = ".env.worktree";
const EXCLUDE_PATTERN = "/.env.worktree";
const MAX_CLAIM_BYTES = 64 * 1024;
const MAX_SIBLINGS = 512;
const MAX_PROBES_PER_NAME = 32;
const TRANSACTION_MS = 5_000;
const PROBE_MS = 1_000;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([1-9][0-9]{0,4})$/;

interface StatLike {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly size: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface HandleLike {
  stat(): Promise<StatLike>;
  readFile(options: { encoding: "utf8" }): Promise<string>;
  close(): Promise<void>;
}

interface PortLockedFile {
  withLock<T>(
    work: () => Promise<T>,
    lockUnavailable: T,
    failed: T,
    onLockReleaseFailed?: (lockPath: string) => void,
  ): Promise<T>;
  stageReplacement(contents: string, mode: number | undefined): Promise<StagedReplacement | undefined>;
}

export interface PortWorktreeListing {
  readonly worktrees: readonly { readonly id: string; readonly path: string }[];
  readonly reasons: readonly string[];
  readonly skipped: number;
  readonly degraded?: string;
}

export interface PreviewPortsDeps {
  readonly lstat?: (target: string) => Promise<StatLike>;
  readonly open?: (target: string, flags: number) => Promise<HandleLike>;
  readonly probe?: () => Promise<number>;
}

export interface WorktreePortsDeps extends PreviewPortsDeps {
  readonly listWorktrees: (repoPath: string) => Promise<PortWorktreeListing>;
  readonly lockedFile?: (target: string) => PortLockedFile;
  readonly addExclude?: (gitDir: string, entry: string) => Promise<ExcludeResult>;
  readonly now?: () => number;
  readonly warn?: (message: string) => void;
}

export interface AllocateWorktreePortsInput {
  readonly repoId: string;
  readonly repoPath: string;
  readonly worktreePath: string;
  readonly ports: readonly ProvisionPort[];
}

export interface WorktreePortApplyResult {
  readonly ports: readonly ProvisionPortResult[];
  readonly warnings: readonly ProvisionPortWarning[];
}

type ClaimRead =
  | { readonly kind: "absent"; readonly contents: ""; readonly mode: 0o600 }
  | {
      readonly kind: "valid";
      readonly contents: string;
      readonly mode: number;
      readonly identity: { readonly dev: number | bigint; readonly ino: number | bigint };
      readonly claims: ReadonlyMap<string, number>;
    }
  | { readonly kind: "invalid" };

const nodeFs = {
  lstat: (target: string) => lstat(target),
  open: (target: string, flags: number) => open(target, flags) as unknown as Promise<FileHandle>,
};

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function sameIdentity(left: { dev: number | bigint; ino: number | bigint }, right: StatLike): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function parseClaims(contents: string): ReadonlyMap<string, number> | undefined {
  const claims = new Map<string, number>();
  const values = new Set<number>();
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    const match = ASSIGNMENT.exec(line);
    if (!match) {
      return undefined;
    }
    const name = match[1] as string;
    const value = Number(match[2]);
    if (value > 65_535 || claims.has(name) || values.has(value)) {
      return undefined;
    }
    claims.set(name, value);
    values.add(value);
  }
  return claims;
}

async function readClaims(
  target: string,
  deps: Required<Pick<PreviewPortsDeps, "lstat" | "open">>,
): Promise<ClaimRead> {
  let entry: StatLike;
  try {
    entry = await deps.lstat(target);
  } catch (error) {
    return isNotFound(error) ? { kind: "absent", contents: "", mode: 0o600 } : { kind: "invalid" };
  }
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size > MAX_CLAIM_BYTES) {
    return { kind: "invalid" };
  }
  let handle: HandleLike;
  try {
    handle = await deps.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return { kind: "invalid" };
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(entry, opened) || opened.size > MAX_CLAIM_BYTES) {
      return { kind: "invalid" };
    }
    const contents = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(contents) > MAX_CLAIM_BYTES) {
      return { kind: "invalid" };
    }
    const claims = parseClaims(contents);
    return claims === undefined
      ? { kind: "invalid" }
      : {
          kind: "valid",
          contents,
          mode: opened.mode,
          identity: { dev: opened.dev, ino: opened.ino },
          claims,
        };
  } catch {
    return { kind: "invalid" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function sourceStillMatches(
  target: string,
  source: Extract<ClaimRead, { kind: "absent" | "valid" }>,
  deps: Required<Pick<PreviewPortsDeps, "lstat" | "open">>,
): Promise<boolean> {
  if (source.kind === "absent") {
    try {
      await deps.lstat(target);
      return false;
    } catch (error) {
      return isNotFound(error);
    }
  }
  let entry: StatLike;
  try {
    entry = await deps.lstat(target);
  } catch {
    return false;
  }
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    !sameIdentity(source.identity, entry) ||
    entry.mode !== source.mode
  ) {
    return false;
  }
  let handle: HandleLike;
  try {
    handle = await deps.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return false;
  }
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      !sameIdentity(source.identity, opened) ||
      opened.mode !== source.mode ||
      opened.size > MAX_CLAIM_BYTES
    ) {
      return false;
    }
    const contents = await handle.readFile({ encoding: "utf8" });
    return Buffer.byteLength(contents) <= MAX_CLAIM_BYTES && contents === source.contents;
  } catch {
    return false;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function groupPorts(ports: readonly ProvisionPort[]): ReadonlyMap<string, readonly ProvisionPort[]> {
  const groups = new Map<string, ProvisionPort[]>();
  for (const item of ports) {
    const group = groups.get(item.name) ?? [];
    group.push(item);
    groups.set(item.name, group);
  }
  return groups;
}

function withoutPreview(item: ProvisionPort): ProvisionPort {
  const { port: _preview, ...rest } = item;
  return rest;
}

async function nodeProbe(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("port probe timed out"));
    }, PROBE_MS);
    const finish = (error?: Error, value?: number) => {
      clearTimeout(timer);
      server.removeAllListeners();
      if (error) {
        reject(error);
      } else if (value !== undefined) {
        resolve(value);
      }
    };
    server.once("error", (error) => finish(error));
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => finish(new Error("port probe returned no IPv4 address")));
        return;
      }
      server.close((error) => finish(error ?? undefined, address.port));
    });
  });
}

function failedResults(ports: readonly ProvisionPort[], reason: string): readonly ProvisionPortResult[] {
  return ports.map((item) => ({
    id: item.id,
    name: item.name,
    ...(item.port === undefined ? {} : { preview: item.port }),
    outcome: { kind: "failed" as const, reason },
  }));
}

function listingIsComplete(listing: PortWorktreeListing): boolean {
  return listing.degraded === undefined && listing.skipped === 0 && listing.reasons.length === 0;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

export async function previewWorktreePorts(
  ports: readonly ProvisionPort[],
  worktreePaths: readonly string[],
  dependencies: PreviewPortsDeps = {},
): Promise<readonly ProvisionPort[]> {
  if (ports.length === 0) {
    return [];
  }
  const deps = {
    lstat: dependencies.lstat ?? nodeFs.lstat,
    open: dependencies.open ?? nodeFs.open,
    probe: dependencies.probe ?? nodeProbe,
  };
  if (worktreePaths.length > MAX_SIBLINGS) {
    return ports.map(withoutPreview);
  }
  const claimed = new Set<number>();
  for (const worktreePath of worktreePaths) {
    const read = await readClaims(path.join(worktreePath, CLAIM_FILE), deps);
    if (read.kind === "invalid") {
      return ports.map(withoutPreview);
    }
    if (read.kind === "valid") {
      for (const value of read.claims.values()) {
        claimed.add(value);
      }
    }
  }

  const previews = new Map<string, number>();
  for (const name of groupPorts(ports).keys()) {
    if (!NAME.test(name)) {
      continue;
    }
    for (let attempt = 0; attempt < MAX_PROBES_PER_NAME; attempt += 1) {
      try {
        const candidate = await deps.probe();
        if (Number.isSafeInteger(candidate) && candidate > 0 && candidate <= 65_535 && !claimed.has(candidate)) {
          claimed.add(candidate);
          previews.set(name, candidate);
          break;
        }
      } catch {
        break;
      }
    }
  }
  return ports.map((item) => {
    const preview = previews.get(item.name);
    return preview === undefined ? withoutPreview(item) : { ...withoutPreview(item), port: preview };
  });
}

export async function allocateWorktreePorts(
  input: AllocateWorktreePortsInput,
  dependencies: WorktreePortsDeps,
): Promise<WorktreePortApplyResult> {
  if (input.ports.length === 0) {
    return { ports: [], warnings: [] };
  }
  const deps = {
    lstat: dependencies.lstat ?? nodeFs.lstat,
    open: dependencies.open ?? nodeFs.open,
    probe: dependencies.probe ?? nodeProbe,
    lockedFile: dependencies.lockedFile ?? ((target: string) => new LockedFile(target)),
    addExclude: dependencies.addExclude ?? addToGitExclude,
    now: dependencies.now ?? Date.now,
    warn: dependencies.warn ?? ((message: string) => console.warn(message)),
  };
  const lock = deps.lockedFile(path.join(input.repoId, "anywhere-terminal-port-claims"));
  const warnings: ProvisionPortWarning[] = [];
  const lockFailure = (): WorktreePortApplyResult => ({
    ports: failedResults(input.ports, "port claims could not be locked"),
    warnings: [],
  });

  const result = await lock.withLock<WorktreePortApplyResult>(
    async () => {
      const deadline = deps.now() + TRANSACTION_MS;
      const listing = await dependencies.listWorktrees(input.repoPath);
      if (!listingIsComplete(listing) || listing.worktrees.length > MAX_SIBLINGS || deps.now() > deadline) {
        return { ports: failedResults(input.ports, "sibling port claims could not be proven"), warnings: [] };
      }

      const siblingClaims = new Set<number>();
      for (const worktree of listing.worktrees) {
        if (samePath(worktree.path, input.worktreePath)) {
          continue;
        }
        if (deps.now() > deadline) {
          return { ports: failedResults(input.ports, "sibling port claims could not be proven"), warnings: [] };
        }
        const read = await readClaims(path.join(worktree.path, CLAIM_FILE), deps);
        if (read.kind === "invalid") {
          return { ports: failedResults(input.ports, "sibling port claims could not be proven"), warnings: [] };
        }
        if (read.kind === "valid") {
          for (const value of read.claims.values()) {
            siblingClaims.add(value);
          }
        }
      }

      const target = path.join(input.worktreePath, CLAIM_FILE);
      const source = await readClaims(target, deps);
      if (source.kind === "invalid") {
        return { ports: failedResults(input.ports, "the existing port claim file is not supported"), warnings: [] };
      }
      const existing = source.kind === "valid" ? source.claims : new Map<string, number>();
      const claimed = new Set<number>([...siblingClaims, ...existing.values()]);
      const results = new Map<string, ProvisionPortResult>();
      const pending = new Map<string, number>();
      const groups = groupPorts(input.ports);

      for (const [name, items] of groups) {
        const put = (outcome: ProvisionPortResult["outcome"]) => {
          for (const item of items) {
            results.set(item.id, {
              id: item.id,
              name,
              ...(item.port === undefined ? {} : { preview: item.port }),
              outcome,
            });
          }
        };
        if (!NAME.test(name)) {
          put({ kind: "failed", reason: "the port name is not a valid environment identifier" });
          continue;
        }
        const retained = existing.get(name);
        if (retained !== undefined) {
          put(
            siblingClaims.has(retained)
              ? { kind: "failed", reason: "a sibling worktree already claims the existing value" }
              : { kind: "reused", port: retained },
          );
          continue;
        }
        let allocated: number | undefined;
        for (let attempt = 0; attempt < MAX_PROBES_PER_NAME && deps.now() <= deadline; attempt += 1) {
          try {
            const candidate = await deps.probe();
            if (Number.isSafeInteger(candidate) && candidate > 0 && candidate <= 65_535 && !claimed.has(candidate)) {
              allocated = candidate;
              claimed.add(candidate);
              break;
            }
          } catch {
            break;
          }
        }
        if (allocated === undefined) {
          put({ kind: "failed", reason: "no distinct port could be allocated" });
        } else {
          pending.set(name, allocated);
        }
      }

      if (pending.size > 0) {
        const prefix = source.contents.length > 0 && !source.contents.endsWith("\n") ? "\n" : "";
        const appended = [...pending].map(([name, value]) => `${name}=${value}`).join("\n");
        const contents = `${source.contents}${prefix}${appended}\n`;
        const staged = await deps.lockedFile(target).stageReplacement(contents, source.mode);
        let committed = false;
        if (staged !== undefined) {
          try {
            committed =
              (await sourceStillMatches(target, source, deps)) &&
              (await staged.commit(source.kind === "absent" ? "create" : "replace"));
          } finally {
            await staged.discard();
          }
        }
        for (const [name, value] of pending) {
          for (const item of groups.get(name) ?? []) {
            results.set(item.id, {
              id: item.id,
              name,
              ...(item.port === undefined ? {} : { preview: item.port }),
              outcome: committed
                ? { kind: "allocated", port: value }
                : { kind: "failed", reason: "the port claim file changed before it could be updated" },
            });
          }
        }
      }

      return {
        ports: input.ports.map(
          (item) =>
            results.get(item.id) ?? {
              id: item.id,
              name: item.name,
              ...(item.port === undefined ? {} : { preview: item.port }),
              outcome: { kind: "failed" as const, reason: "the port allocation produced no result" },
            },
        ),
        warnings: [],
      };
    },
    lockFailure(),
    lockFailure(),
    (lockPath) => {
      warnings.push("lockReleaseFailed");
      deps.warn(`[AnyWhere Terminal] could not release port-claim lock: ${lockPath}`);
    },
  );

  try {
    const excluded = await deps.addExclude(input.repoId, EXCLUDE_PATTERN);
    if ("failed" in excluded) {
      warnings.push("excludeFailed");
    }
  } catch {
    warnings.push("excludeFailed");
  }
  return { ports: result.ports, warnings: [...result.warnings, ...warnings] };
}
