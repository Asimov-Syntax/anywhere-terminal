import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { API, Repository } from "../providers/git";
import {
  type AuthorizedDirectory,
  authorizeDirectory,
  type FileIdentity,
  fileIdentityOf,
} from "../utils/authorizedDirectory";
import { type OpenLike, openRegularFile } from "../utils/regularFileRead";
import { afterDelay, type Deadline } from "./deadline";
import type { GitCommandRunner } from "./gitCommandRunner";

export const MIGRATION_DEADLINE_MS = 10_000;
export const MIGRATION_MAX_BYTES = 512 * 1024 * 1024;

export type MigrationRecord =
  | { readonly kind: "ordinary" | "untracked"; readonly path: string; readonly signature: string }
  | {
      readonly kind: "rename" | "copy";
      readonly path: string;
      readonly originalPath: string;
      readonly signature: string;
    };

export type MigrationPathState =
  | { readonly path: string; readonly kind: "absent" }
  | { readonly path: string; readonly kind: "file"; readonly mode: number; readonly hash: string }
  | { readonly path: string; readonly kind: "symlink"; readonly mode: number; readonly target: string }
  | { readonly path: string; readonly kind: "directory" | "other"; readonly mode: number };

export interface MigrationSnapshot {
  readonly count: number;
  readonly records: readonly MigrationRecord[];
  readonly states: readonly MigrationPathState[];
}

interface AdminFileEvidence {
  readonly name: string;
  readonly kind: "absent" | "file";
  readonly identity?: FileIdentity;
  readonly hash?: string;
}

interface GitEntryEvidence {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly identity: FileIdentity;
  readonly contentHash?: string;
  readonly adminPath: string;
  readonly adminIdentity: FileIdentity;
  readonly adminFiles: readonly AdminFileEvidence[];
}

export interface MigrationSourceEvidence {
  readonly path: string;
  readonly directory: AuthorizedDirectory;
  readonly git: GitEntryEvidence;
}

export interface MigrationOfferEvidence {
  readonly source: MigrationSourceEvidence;
  readonly snapshot: MigrationSnapshot;
}

export type MigrateChangesOutcome =
  | { readonly kind: "moved" }
  | { readonly kind: "indeterminate"; readonly reason: string };

interface MigrationFs {
  lstat(path: string): Promise<Stats>;
  readlink(path: string): Promise<string>;
  open: OpenLike;
}

export interface MigrationDeps {
  readonly runner: GitCommandRunner;
  readonly uri: (path: string) => Repository["rootUri"];
  readonly api?: API;
  readonly fs?: MigrationFs;
  readonly makeDeadline?: () => Deadline;
  readonly maxBytes?: number;
}

class SnapshotFailure extends Error {}

class SnapshotBudget {
  private used = 0;

  constructor(
    private readonly deadline: Deadline,
    private readonly maxBytes: number,
  ) {}

  get remaining(): number {
    return Math.max(0, this.maxBytes - this.used);
  }

  take(bytes: number): void {
    this.used += bytes;
    if (this.used > this.maxBytes || this.deadline.expired) {
      throw new SnapshotFailure();
    }
  }

  async run<T>(work: Promise<T>): Promise<T> {
    const outcome = await Promise.race([
      work.then(
        (value) => ({ kind: "value" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error }),
      ),
      this.deadline.elapsed.then(() => ({ kind: "expired" as const })),
    ]);
    if (this.deadline.expired || outcome.kind === "expired") {
      throw new SnapshotFailure();
    }
    if (outcome.kind === "error") {
      throw outcome.error;
    }
    return outcome.value;
  }
}

const nodeFs: MigrationFs = {
  lstat: (target) => fs.lstat(target),
  readlink: (target) => fs.readlink(target),
  open: (target, flags) => fs.open(target, flags),
};

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"
  );
}

function decode(raw: Buffer): string | undefined {
  const value = raw.toString("utf8");
  return Buffer.from(value, "utf8").equals(raw) ? value : undefined;
}

function fixedFields(value: string, count: number): { fields: string[]; rest: string } | undefined {
  const fields: string[] = [];
  let offset = 0;
  for (let i = 0; i < count; i += 1) {
    const next = value.indexOf(" ", offset);
    if (next < 0) {
      return undefined;
    }
    fields.push(value.slice(offset, next));
    offset = next + 1;
  }
  const rest = value.slice(offset);
  return rest.length === 0 ? undefined : { fields, rest };
}

function safeRelative(value: string): boolean {
  if (value.length === 0 || path.isAbsolute(value)) {
    return false;
  }
  const normalized = path.normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`) && !path.isAbsolute(normalized);
}

function validMode(value: string): boolean {
  return /^[0-7]{6}$/.test(value);
}

function validOid(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function validSubmodule(value: string): boolean {
  return value === "N..." || /^S[.C][.M][.U]$/.test(value);
}

function validTrackedFields(fields: readonly string[], type: "ordinary" | "changed"): boolean {
  const xy = fields[1];
  const allowed = type === "ordinary" ? /^[.MTAD]{2}$/ : /^[.MTADRC]{2}$/;
  return (
    fields[0] === (type === "ordinary" ? "1" : "2") &&
    xy !== undefined &&
    xy !== ".." &&
    allowed.test(xy) &&
    fields[2] !== undefined &&
    validSubmodule(fields[2]) &&
    fields.slice(3, 6).every(validMode) &&
    fields.slice(6, 8).every(validOid)
  );
}

function validScore(value: string | undefined, xy: string | undefined): value is string {
  if (value === undefined || xy === undefined || !/^[RC][0-9]{1,3}$/.test(value) || !xy.includes(value[0] as string)) {
    return false;
  }
  const score = Number(value.slice(1));
  return Number.isInteger(score) && score >= 0 && score <= 100;
}

function parseStatus(stdout: Buffer): readonly MigrationRecord[] | undefined {
  const parts: Buffer[] = [];
  let start = 0;
  for (let at = 0; at < stdout.length; at += 1) {
    if (stdout[at] === 0) {
      parts.push(stdout.subarray(start, at));
      start = at + 1;
    }
  }
  if (start !== stdout.length) {
    return undefined;
  }
  const records: MigrationRecord[] = [];
  for (let at = 0; at < parts.length; at += 1) {
    const value = decode(parts[at] as Buffer);
    if (value === undefined) {
      return undefined;
    }
    if (value.startsWith("1 ")) {
      const parsed = fixedFields(value, 8);
      if (parsed === undefined || !validTrackedFields(parsed.fields, "ordinary") || !safeRelative(parsed.rest)) {
        return undefined;
      }
      records.push({ kind: "ordinary", path: parsed.rest, signature: parsed.fields.join(" ") });
      continue;
    }
    if (value.startsWith("2 ")) {
      const parsed = fixedFields(value, 9);
      const original = parts[at + 1] === undefined ? undefined : decode(parts[at + 1] as Buffer);
      const score = parsed?.fields[8];
      if (
        parsed === undefined ||
        !validTrackedFields(parsed.fields, "changed") ||
        original === undefined ||
        !safeRelative(parsed.rest) ||
        !safeRelative(original) ||
        !validScore(score, parsed.fields[1])
      ) {
        return undefined;
      }
      records.push({
        kind: score.startsWith("R") ? "rename" : "copy",
        path: parsed.rest,
        originalPath: original,
        signature: parsed.fields.join(" "),
      });
      at += 1;
      continue;
    }
    if (value.startsWith("? ")) {
      const candidate = value.slice(2);
      if (!safeRelative(candidate)) {
        return undefined;
      }
      records.push({ kind: "untracked", path: candidate, signature: "?" });
      continue;
    }
    if (value.startsWith("u ")) {
      return undefined;
    }
    if (value.startsWith("! ") || value.startsWith("# ")) {
      continue;
    }
    return undefined;
  }
  return records;
}

function affectedPaths(records: readonly MigrationRecord[]): string[] {
  const paths = new Set<string>();
  for (const record of records) {
    paths.add(record.path);
    if (record.kind === "rename") {
      paths.add(record.originalPath);
    }
  }
  return [...paths].sort();
}

async function closeBounded(handle: FileHandle, budget: SnapshotBudget): Promise<boolean> {
  const closing = handle.close();
  try {
    await budget.run(closing);
    return true;
  } catch {
    void closing;
    return false;
  }
}

async function openBoundedRegularFile(
  target: string,
  expected: Stats,
  budget: SnapshotBudget,
  io: MigrationFs,
): Promise<{ handle: FileHandle; stat: Stats }> {
  let openedHandle: FileHandle | undefined;
  let abandoned = false;
  const opening = openRegularFile(
    target,
    (candidate, flags) => io.open(candidate, flags | (constants.O_NOFOLLOW ?? 0)),
    (handle) => {
      openedHandle = handle;
      if (abandoned) {
        void handle.close().catch(() => {});
      }
    },
  );
  let handle: FileHandle;
  try {
    handle = await budget.run(opening);
  } catch (error) {
    abandoned = true;
    if (openedHandle !== undefined) {
      void openedHandle.close().catch(() => {});
    }
    throw error;
  }
  try {
    const stat = await budget.run(handle.stat());
    const expectedIdentity = fileIdentityOf(expected);
    const openedIdentity = fileIdentityOf(stat);
    if (
      expectedIdentity === undefined ||
      openedIdentity === undefined ||
      !sameIdentity(expectedIdentity, openedIdentity)
    ) {
      throw new SnapshotFailure();
    }
    return { handle, stat };
  } catch (error) {
    await closeBounded(handle, budget);
    throw error;
  }
}

async function readRegularFile(
  target: string,
  expected: Stats,
  budget: SnapshotBudget,
  io: MigrationFs,
  consume: (chunk: Buffer) => void,
): Promise<Stats> {
  const { handle, stat } = await openBoundedRegularFile(target, expected, budget, io);
  let failed = false;
  let failure: unknown;
  try {
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > budget.remaining) {
      throw new SnapshotFailure();
    }
    budget.take(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, stat.size - offset));
      const read = await budget.run(handle.read(buffer, 0, buffer.length, offset));
      if (read.bytesRead <= 0) {
        throw new SnapshotFailure();
      }
      consume(buffer.subarray(0, read.bytesRead));
      offset += read.bytesRead;
    }
    const after = await budget.run(handle.stat());
    const pathAfter = await budget.run(io.lstat(target));
    if (
      after.size !== stat.size ||
      after.mode !== stat.mode ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      !sameIdentity(fileIdentityOf(stat), fileIdentityOf(after)) ||
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      !sameIdentity(fileIdentityOf(stat), fileIdentityOf(pathAfter))
    ) {
      throw new SnapshotFailure();
    }
  } catch (error) {
    failed = true;
    failure = error;
  }
  const closed = await closeBounded(handle, budget);
  if (!closed) {
    throw new SnapshotFailure();
  }
  if (failed) {
    throw failure;
  }
  return stat;
}

async function hashFile(
  target: string,
  expected: Stats,
  budget: SnapshotBudget,
  io: MigrationFs,
): Promise<{ hash: string; mode: number }> {
  const hash = createHash("sha256");
  const stat = await readRegularFile(target, expected, budget, io, (chunk) => hash.update(chunk));
  return { hash: hash.digest("hex"), mode: stat.mode & 0o7777 };
}

async function readBoundedFile(
  target: string,
  expected: Stats,
  budget: SnapshotBudget,
  io: MigrationFs,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await readRegularFile(target, expected, budget, io, (chunk) => chunks.push(Buffer.from(chunk)));
  return Buffer.concat(chunks);
}

async function pathState(
  root: string,
  relativePath: string,
  budget: SnapshotBudget,
  io: MigrationFs,
): Promise<MigrationPathState> {
  const target = path.resolve(root, relativePath);
  const inside = path.relative(root, target);
  if (inside === "" || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new SnapshotFailure();
  }
  let stat: Stats;
  try {
    stat = await budget.run(io.lstat(target));
  } catch (error) {
    if (isNotFound(error)) {
      return { path: relativePath, kind: "absent" };
    }
    throw error;
  }
  const mode = stat.mode & 0o7777;
  if (stat.isSymbolicLink()) {
    const link = await budget.run(io.readlink(target));
    budget.take(Buffer.byteLength(link));
    return { path: relativePath, kind: "symlink", mode, target: link };
  }
  if (stat.isFile()) {
    const opened = await hashFile(target, stat, budget, io);
    return { path: relativePath, kind: "file", mode: opened.mode, hash: opened.hash };
  }
  return { path: relativePath, kind: stat.isDirectory() ? "directory" : "other", mode };
}

function deadlineFrom(deps: Pick<MigrationDeps, "makeDeadline">): Deadline {
  return deps.makeDeadline?.() ?? afterDelay(MIGRATION_DEADLINE_MS);
}

interface SnapshotContext {
  readonly deadline: Deadline;
  readonly budget: SnapshotBudget;
  readonly io: MigrationFs;
  readonly maxBytes: number;
}

function snapshotContext(deps: Pick<MigrationDeps, "fs" | "makeDeadline" | "maxBytes">): SnapshotContext {
  const deadline = deadlineFrom(deps);
  const maxBytes = deps.maxBytes ?? MIGRATION_MAX_BYTES;
  return {
    deadline,
    budget: new SnapshotBudget(deadline, maxBytes),
    io: deps.fs ?? nodeFs,
    maxBytes,
  };
}

async function readMigrationSnapshotWithin(
  runner: GitCommandRunner,
  root: string,
  context: SnapshotContext,
): Promise<MigrationSnapshot | undefined> {
  const status = await context.budget.run(
    runner.run(["status", "--porcelain=v2", "-z", "--untracked-files=all"], root, {
      timeoutMs: MIGRATION_DEADLINE_MS,
      maxBufferBytes: context.maxBytes,
    }),
  );
  context.budget.take(status.stdout.length);
  if (status.code !== 0 || status.timedOut || status.failedToSpawn) {
    return undefined;
  }
  const records = parseStatus(status.stdout);
  if (records === undefined) {
    return undefined;
  }
  const states: MigrationPathState[] = [];
  for (const relativePath of affectedPaths(records)) {
    states.push(await pathState(root, relativePath, context.budget, context.io));
  }
  return { count: records.length, records, states };
}

export async function readMigrationSnapshot(
  runner: GitCommandRunner,
  root: string,
  deps: Pick<MigrationDeps, "fs" | "makeDeadline" | "maxBytes"> = {},
): Promise<MigrationSnapshot | undefined> {
  const context = snapshotContext(deps);
  try {
    return await readMigrationSnapshotWithin(runner, root, context);
  } catch {
    return undefined;
  } finally {
    context.deadline.cancel();
  }
}

async function evidenceFile(
  adminPath: string,
  name: string,
  budget: SnapshotBudget,
  io: MigrationFs,
): Promise<AdminFileEvidence> {
  const target = path.join(adminPath, name);
  let stat: Stats;
  try {
    stat = await budget.run(io.lstat(target));
  } catch (error) {
    if (isNotFound(error)) {
      return { name, kind: "absent" };
    }
    throw error;
  }
  const identity = fileIdentityOf(stat);
  if (!stat.isFile() || stat.isSymbolicLink() || identity === undefined) {
    throw new SnapshotFailure();
  }
  return { name, kind: "file", identity, hash: (await hashFile(target, stat, budget, io)).hash };
}

async function captureSourceEvidenceWithin(
  root: string,
  context: SnapshotContext,
): Promise<MigrationSourceEvidence | undefined> {
  const { budget, io } = context;
  const directory = await budget.run(authorizeDirectory(root, { lstat: io.lstat }));
  if (directory === undefined) {
    return undefined;
  }
  const gitPath = path.join(root, ".git");
  const entry = await budget.run(io.lstat(gitPath));
  const identity = fileIdentityOf(entry);
  if (entry.isSymbolicLink() || identity === undefined || (!entry.isFile() && !entry.isDirectory())) {
    return undefined;
  }

  let adminPath = gitPath;
  let contentHash: string | undefined;
  if (entry.isFile()) {
    const content = await readBoundedFile(gitPath, entry, budget, io);
    contentHash = createHash("sha256").update(content).digest("hex");
    const text = decode(content);
    const match = text?.trim().match(/^gitdir:\s*(.+)$/);
    if (match?.[1] === undefined) {
      return undefined;
    }
    adminPath = path.resolve(root, match[1]);
  }

  const admin = await budget.run(io.lstat(adminPath));
  const adminIdentity = fileIdentityOf(admin);
  if (!admin.isDirectory() || admin.isSymbolicLink() || adminIdentity === undefined) {
    return undefined;
  }
  const adminFiles: AdminFileEvidence[] = [];
  for (const name of ["HEAD", "gitdir", "commondir"]) {
    adminFiles.push(await evidenceFile(adminPath, name, budget, io));
  }
  return {
    path: root,
    directory,
    git: {
      path: gitPath,
      kind: entry.isFile() ? "file" : "directory",
      identity,
      ...(contentHash === undefined ? {} : { contentHash }),
      adminPath,
      adminIdentity,
      adminFiles,
    },
  };
}

async function captureSourceEvidence(
  root: string,
  deps: Pick<MigrationDeps, "fs" | "makeDeadline" | "maxBytes"> = {},
): Promise<MigrationSourceEvidence | undefined> {
  const context = snapshotContext(deps);
  try {
    return await captureSourceEvidenceWithin(root, context);
  } catch {
    return undefined;
  } finally {
    context.deadline.cancel();
  }
}

async function captureMigrationOfferEvidence(
  runner: GitCommandRunner,
  root: string,
  deps: Pick<MigrationDeps, "fs" | "makeDeadline" | "maxBytes"> = {},
): Promise<MigrationOfferEvidence | undefined> {
  const context = snapshotContext(deps);
  try {
    const snapshot = await readMigrationSnapshotWithin(runner, root, context);
    const source = snapshot === undefined ? undefined : await captureSourceEvidenceWithin(root, context);
    return snapshot === undefined || source === undefined ? undefined : { source, snapshot };
  } catch {
    return undefined;
  } finally {
    context.deadline.cancel();
  }
}

function sameIdentity(left: FileIdentity | undefined, right: FileIdentity | undefined): boolean {
  return left !== undefined && right !== undefined && left.dev === right.dev && left.ino === right.ino;
}

function sameAdminFiles(left: readonly AdminFileEvidence[], right: readonly AdminFileEvidence[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        item.name === other.name &&
        item.kind === other.kind &&
        item.hash === other.hash &&
        (item.kind === "absent" || sameIdentity(item.identity, other.identity))
      );
    })
  );
}

function sameDirectory(left: AuthorizedDirectory, right: AuthorizedDirectory): boolean {
  return (
    left.path === right.path &&
    left.platform === right.platform &&
    left.components.length === right.components.length &&
    left.components.every((component, index) => {
      const other = right.components[index];
      return other !== undefined && component.path === other.path && sameIdentity(component.identity, other.identity);
    })
  );
}

function sameSourceEvidence(left: MigrationSourceEvidence, right: MigrationSourceEvidence): boolean {
  return (
    left.path === right.path &&
    sameDirectory(left.directory, right.directory) &&
    left.git.path === right.git.path &&
    left.git.kind === right.git.kind &&
    left.git.contentHash === right.git.contentHash &&
    left.git.adminPath === right.git.adminPath &&
    sameIdentity(left.git.identity, right.git.identity) &&
    sameIdentity(left.git.adminIdentity, right.git.adminIdentity) &&
    sameAdminFiles(left.git.adminFiles, right.git.adminFiles)
  );
}

export async function migrationSourceStillAuthorized(
  evidence: MigrationSourceEvidence,
  deps: Pick<MigrationDeps, "fs" | "makeDeadline" | "maxBytes"> = {},
): Promise<boolean> {
  const current = await captureSourceEvidence(evidence.path, deps);
  return current !== undefined && sameSourceEvidence(current, evidence);
}

function sameSnapshot(left: MigrationSnapshot, right: MigrationSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStates(left: readonly MigrationPathState[], right: readonly MigrationPathState[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function openRepositories(
  api: API,
  paths: readonly string[],
  uri: MigrationDeps["uri"],
  deadline: Deadline,
): Promise<readonly (Repository | null)[] | undefined> {
  if (api.openRepository === undefined) {
    return undefined;
  }
  try {
    const opened = await Promise.race([
      Promise.all(
        paths.map(async (candidate) => {
          const repository = await api.openRepository?.(uri(candidate));
          return repository !== null &&
            repository !== undefined &&
            path.resolve(repository.rootUri.fsPath) === path.resolve(candidate)
            ? repository
            : null;
        }),
      ),
      deadline.elapsed.then(() => undefined),
    ]);
    return deadline.expired ? undefined : opened;
  } catch {
    return undefined;
  }
}

export async function probeMigrationSource(
  api: API | undefined,
  sourcePath: string,
  deps: Omit<MigrationDeps, "api">,
): Promise<MigrationOfferEvidence | undefined> {
  if (api === undefined) {
    return undefined;
  }
  const openDeadline = deadlineFrom(deps);
  try {
    const opened = await openRepositories(api, [sourcePath], deps.uri, openDeadline);
    const source = opened?.[0];
    if (source === null || source === undefined || source.migrateChanges === undefined) {
      return undefined;
    }
  } finally {
    openDeadline.cancel();
  }
  const offered = await captureMigrationOfferEvidence(deps.runner, sourcePath, deps);
  return offered === undefined || offered.snapshot.count === 0 ? undefined : offered;
}

function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim().slice(0, 1_000) || "the Git integration did not complete the migration";
}

export async function migrateChanges(
  input: {
    readonly sourcePath: string;
    readonly destinationPath: string;
    readonly source: MigrationSourceEvidence;
    readonly snapshot: MigrationSnapshot;
  },
  deps: MigrationDeps,
): Promise<MigrateChangesOutcome> {
  const api = deps.api;
  if (api === undefined) {
    return { kind: "indeterminate", reason: "the Git integration is unavailable" };
  }
  if (input.sourcePath !== input.source.path) {
    return { kind: "indeterminate", reason: "the migration source does not match its authorization" };
  }

  const openDeadline = deadlineFrom(deps);
  try {
    const opened = await openRepositories(api, [input.sourcePath, input.destinationPath], deps.uri, openDeadline);
    const source = opened?.[0];
    const openedDestination = opened?.[1];
    if (
      source === null ||
      source === undefined ||
      openedDestination === null ||
      openedDestination === undefined ||
      source.migrateChanges === undefined ||
      openedDestination.migrateChanges === undefined
    ) {
      return { kind: "indeterminate", reason: "the Git integration could not open both worktrees" };
    }
    const migrate = openedDestination.migrateChanges.bind(openedDestination);

    const [beforeSource, beforeDestination] = await Promise.all([
      captureMigrationOfferEvidence(deps.runner, input.sourcePath, deps),
      readMigrationSnapshot(deps.runner, input.destinationPath, deps),
    ]);
    if (
      beforeSource === undefined ||
      beforeDestination === undefined ||
      beforeDestination.count !== 0 ||
      !sameSnapshot(beforeSource.snapshot, input.snapshot) ||
      !sameSourceEvidence(beforeSource.source, input.source) ||
      openDeadline.expired
    ) {
      return { kind: "indeterminate", reason: "the source or destination changed before migration" };
    }

    let migration: Promise<void>;
    try {
      migration = migrate(input.sourcePath, {
        confirmation: false,
        deleteFromSource: true,
        untracked: true,
      });
    } catch (error) {
      return { kind: "indeterminate", reason: reasonOf(error) };
    }
    openDeadline.cancel();
    try {
      await migration;
    } catch (error) {
      return { kind: "indeterminate", reason: reasonOf(error) };
    }
  } finally {
    openDeadline.cancel();
  }

  const [afterSource, afterDestination] = await Promise.all([
    readMigrationSnapshot(deps.runner, input.sourcePath, deps),
    readMigrationSnapshot(deps.runner, input.destinationPath, deps),
  ]);
  return afterSource !== undefined &&
    afterDestination !== undefined &&
    afterSource.count === 0 &&
    sameStates(afterDestination.states, input.snapshot.states)
    ? { kind: "moved" }
    : { kind: "indeterminate", reason: "the migration result could not be verified" };
}
