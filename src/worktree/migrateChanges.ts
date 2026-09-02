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
import { normalizePathForCompare } from "../utils/pathBoundary";
import { type OpenLike, openRegularFile } from "../utils/regularFileRead";
import { afterDelay, type Deadline } from "./deadline";
import type { GitCommandRunner } from "./gitCommandRunner";

export const MIGRATION_DEADLINE_MS = 10_000;
export const MIGRATION_MAX_BYTES = 512 * 1024 * 1024;
export const MIGRATION_MAX_GITFILE_BYTES = 1024 * 1024;

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
  readonly commonPath?: string;
  readonly commonIdentity?: FileIdentity;
  readonly backPointerPath?: string;
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

export interface MigrationRepositoryBinding {
  readonly registration: AuthorizedDirectory;
  readonly sourceKind: "main" | "linked";
}

export type MigrateChangesOutcome =
  | { readonly kind: "moved" }
  | { readonly kind: "indeterminate"; readonly reason: string };

interface MigrationFs {
  lstat(path: string): Promise<Stats>;
  readlink(path: string): Promise<string>;
  realpath?(path: string): Promise<string>;
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
  realpath: (target) => fs.realpath(target),
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
  maxBytes = MIGRATION_MAX_GITFILE_BYTES,
): Promise<Buffer> {
  const { handle, stat } = await openBoundedRegularFile(target, expected, budget, io);
  let failed = false;
  let failure: unknown;
  let content = Buffer.alloc(0);
  try {
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maxBytes || stat.size > budget.remaining) {
      throw new SnapshotFailure();
    }
    budget.take(stat.size);
    content = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const read = await budget.run(handle.read(content, offset, stat.size - offset, offset));
      if (read.bytesRead <= 0) {
        throw new SnapshotFailure();
      }
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
  return content;
}

async function authorizeExistingParent(
  root: string,
  parent: string,
  budget: SnapshotBudget,
  io: MigrationFs,
): Promise<{ directory: AuthorizedDirectory; complete: boolean } | undefined> {
  const relative = path.relative(root, parent);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  let current = root;
  let complete = true;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const candidate = path.join(current, segment);
    let stat: Stats;
    try {
      stat = await budget.run(io.lstat(candidate));
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      complete = false;
      break;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory() || fileIdentityOf(stat) === undefined) {
      return undefined;
    }
    current = candidate;
  }
  const directory = await authorizeDirectory(
    current,
    { lstat: io.lstat },
    { run: <T>(work: () => Promise<T>) => budget.run(work()) },
  );
  return directory === undefined ? undefined : { directory, complete };
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
  const parent = path.dirname(target);
  const parentBefore = await authorizeExistingParent(root, parent, budget, io);
  if (parentBefore === undefined) {
    throw new SnapshotFailure();
  }
  const finish = async <T extends MigrationPathState>(state: T): Promise<T> => {
    const parentAfter = await authorizeExistingParent(root, parent, budget, io);
    if (
      parentAfter === undefined ||
      parentAfter.complete !== parentBefore.complete ||
      !sameDirectory(parentBefore.directory, parentAfter.directory)
    ) {
      throw new SnapshotFailure();
    }
    return state;
  };
  let stat: Stats;
  try {
    stat = await budget.run(io.lstat(target));
  } catch (error) {
    if (isNotFound(error)) {
      return finish({ path: relativePath, kind: "absent" });
    }
    throw error;
  }
  if (!parentBefore.complete) {
    throw new SnapshotFailure();
  }
  const mode = stat.mode & 0o7777;
  if (stat.isSymbolicLink()) {
    const link = await budget.run(io.readlink(target));
    budget.take(Buffer.byteLength(link));
    return finish({ path: relativePath, kind: "symlink", mode, target: link });
  }
  if (stat.isFile()) {
    const opened = await hashFile(target, stat, budget, io);
    return finish({ path: relativePath, kind: "file", mode: opened.mode, hash: opened.hash });
  }
  return finish({ path: relativePath, kind: stat.isDirectory() ? "directory" : "other", mode });
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

interface CapturedAdminFile {
  readonly evidence: AdminFileEvidence;
  readonly text?: string;
}

async function evidenceFile(
  adminPath: string,
  name: string,
  budget: SnapshotBudget,
  io: MigrationFs,
  retainText = false,
): Promise<CapturedAdminFile> {
  const target = path.join(adminPath, name);
  let stat: Stats;
  try {
    stat = await budget.run(io.lstat(target));
  } catch (error) {
    if (isNotFound(error)) {
      return { evidence: { name, kind: "absent" } };
    }
    throw error;
  }
  const identity = fileIdentityOf(stat);
  if (!stat.isFile() || stat.isSymbolicLink() || identity === undefined) {
    throw new SnapshotFailure();
  }
  if (retainText) {
    const content = await readBoundedFile(target, stat, budget, io);
    const text = decode(content);
    if (text === undefined) {
      throw new SnapshotFailure();
    }
    return {
      evidence: { name, kind: "file", identity, hash: createHash("sha256").update(content).digest("hex") },
      text,
    };
  }
  return { evidence: { name, kind: "file", identity, hash: (await hashFile(target, stat, budget, io)).hash } };
}

function metadataPath(text: string | undefined): string | undefined {
  const value = text?.trim();
  return value === undefined ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r")
    ? undefined
    : value;
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
  let gitdirEvidence: AdminFileEvidence | undefined;
  let commondirEvidence: AdminFileEvidence | undefined;
  let gitdirText: string | undefined;
  let commondirText: string | undefined;
  for (const name of ["HEAD", "gitdir", "commondir"]) {
    const captured = await evidenceFile(adminPath, name, budget, io, name !== "HEAD");
    adminFiles.push(captured.evidence);
    if (name === "gitdir") {
      gitdirEvidence = captured.evidence;
      gitdirText = captured.text;
    } else if (name === "commondir") {
      commondirEvidence = captured.evidence;
      commondirText = captured.text;
    }
  }

  let commonPath = adminPath;
  let backPointerPath: string | undefined;
  if (entry.isFile()) {
    const standalone = gitdirEvidence?.kind === "absent" && commondirEvidence?.kind === "absent";
    if (!standalone) {
      const gitdir = metadataPath(gitdirText);
      const commondir = metadataPath(commondirText);
      if (
        gitdirEvidence?.kind !== "file" ||
        commondirEvidence?.kind !== "file" ||
        gitdir === undefined ||
        commondir === undefined
      ) {
        return undefined;
      }
      backPointerPath = path.resolve(adminPath, gitdir);
      commonPath = path.resolve(adminPath, commondir);
    }
  }
  const common = await budget.run(io.lstat(commonPath));
  const commonIdentity = fileIdentityOf(common);
  if (!common.isDirectory() || common.isSymbolicLink() || commonIdentity === undefined) {
    return undefined;
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
      commonPath,
      commonIdentity,
      ...(backPointerPath === undefined ? {} : { backPointerPath }),
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

export async function captureMigrationDestination(
  repoId: string,
  destinationPath: string,
  deps: Pick<MigrationDeps, "fs" | "makeDeadline" | "maxBytes"> = {},
  registration?: AuthorizedDirectory,
): Promise<MigrationSourceEvidence | undefined> {
  const evidence = await captureSourceEvidence(destinationPath, deps);
  if (
    evidence === undefined ||
    evidence.git.commonPath === undefined ||
    normalizePathForCompare(evidence.git.commonPath) !== normalizePathForCompare(repoId)
  ) {
    return undefined;
  }
  if (registration !== undefined) {
    const context = snapshotContext(deps);
    try {
      if (!(await evidenceMatchesBinding(evidence, { registration, sourceKind: "linked" }, context))) {
        return undefined;
      }
    } catch {
      return undefined;
    } finally {
      context.deadline.cancel();
    }
  }
  if (evidence.git.kind === "file") {
    if (
      evidence.git.backPointerPath === undefined ||
      normalizePathForCompare(evidence.git.backPointerPath) !== normalizePathForCompare(evidence.git.path) ||
      normalizePathForCompare(path.dirname(evidence.git.adminPath)) !==
        normalizePathForCompare(path.join(evidence.git.commonPath, "worktrees"))
    ) {
      return undefined;
    }
  }
  return evidence;
}

async function captureMigrationOfferEvidence(
  runner: GitCommandRunner,
  root: string,
  deps: Pick<MigrationDeps, "fs" | "makeDeadline" | "maxBytes"> = {},
  binding?: MigrationRepositoryBinding,
): Promise<MigrationOfferEvidence | undefined> {
  const context = snapshotContext(deps);
  try {
    const before = await captureSourceEvidenceWithin(root, context);
    const beforeOwned =
      before !== undefined && (binding === undefined || (await evidenceMatchesBinding(before, binding, context)));
    const snapshot = beforeOwned ? await readMigrationSnapshotWithin(runner, root, context) : undefined;
    const after = snapshot === undefined ? undefined : await captureSourceEvidenceWithin(root, context);
    const afterOwned =
      after !== undefined && (binding === undefined || (await evidenceMatchesBinding(after, binding, context)));
    return before === undefined ||
      snapshot === undefined ||
      after === undefined ||
      !beforeOwned ||
      !afterOwned ||
      !sameSourceEvidence(before, after)
      ? undefined
      : { source: after, snapshot };
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

async function evidenceMatchesBinding(
  evidence: MigrationSourceEvidence,
  binding: MigrationRepositoryBinding,
  context: SnapshotContext,
): Promise<boolean> {
  const currentRegistration = await context.budget.run(
    authorizeDirectory(binding.registration.path, { lstat: context.io.lstat }),
  );
  const commonIdentity = binding.registration.components.at(-1)?.identity;
  if (
    currentRegistration === undefined ||
    !sameDirectory(currentRegistration, binding.registration) ||
    evidence.git.commonPath === undefined ||
    normalizePathForCompare(evidence.git.commonPath) !== normalizePathForCompare(binding.registration.path) ||
    !sameIdentity(evidence.git.commonIdentity, commonIdentity)
  ) {
    return false;
  }

  if (binding.sourceKind === "main") {
    if (evidence.git.kind === "directory") {
      return (
        normalizePathForCompare(evidence.git.path) === normalizePathForCompare(binding.registration.path) &&
        normalizePathForCompare(evidence.git.adminPath) === normalizePathForCompare(binding.registration.path)
      );
    }
    return (
      evidence.git.backPointerPath === undefined &&
      normalizePathForCompare(evidence.git.adminPath) === normalizePathForCompare(binding.registration.path) &&
      evidence.git.adminFiles.every(
        (file) => (file.name !== "gitdir" && file.name !== "commondir") || file.kind === "absent",
      )
    );
  }

  if (
    evidence.git.kind !== "file" ||
    evidence.git.backPointerPath === undefined ||
    normalizePathForCompare(path.dirname(evidence.git.adminPath)) !==
      normalizePathForCompare(path.join(binding.registration.path, "worktrees"))
  ) {
    return false;
  }
  const resolve = context.io.realpath ?? fs.realpath;
  const [backPointer, gitEntry, backPointerStat] = await Promise.all([
    context.budget.run(resolve(evidence.git.backPointerPath)),
    context.budget.run(resolve(evidence.git.path)),
    context.budget.run(context.io.lstat(evidence.git.backPointerPath)),
  ]);
  return (
    normalizePathForCompare(backPointer) === normalizePathForCompare(gitEntry) &&
    sameIdentity(evidence.git.identity, fileIdentityOf(backPointerStat))
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
    left.git.commonPath === right.git.commonPath &&
    left.git.backPointerPath === right.git.backPointerPath &&
    sameIdentity(left.git.identity, right.git.identity) &&
    sameIdentity(left.git.adminIdentity, right.git.adminIdentity) &&
    sameIdentity(left.git.commonIdentity, right.git.commonIdentity) &&
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

function sameRecordTopology(left: readonly MigrationRecord[], right: readonly MigrationRecord[]): boolean {
  const topology = (records: readonly MigrationRecord[]) =>
    records
      .map((record) =>
        record.kind === "rename" || record.kind === "copy"
          ? [record.kind, record.path, record.originalPath]
          : [record.kind, record.path],
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(topology(left)) === JSON.stringify(topology(right));
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
  binding?: MigrationRepositoryBinding,
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
  const offered = await captureMigrationOfferEvidence(deps.runner, sourcePath, deps, binding);
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
    readonly destination?: MigrationSourceEvidence;
    readonly snapshot: MigrationSnapshot;
    readonly binding?: MigrationRepositoryBinding;
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
  if (input.destination === undefined || input.destinationPath !== input.destination.path) {
    return { kind: "indeterminate", reason: "the migration destination does not match its authorization" };
  }

  const destinationBinding =
    input.binding === undefined
      ? undefined
      : { registration: input.binding.registration, sourceKind: "linked" as const };
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
      captureMigrationOfferEvidence(deps.runner, input.sourcePath, deps, input.binding),
      captureMigrationOfferEvidence(deps.runner, input.destinationPath, deps, destinationBinding),
    ]);
    if (
      beforeSource === undefined ||
      beforeDestination === undefined ||
      beforeDestination.snapshot.count !== 0 ||
      !sameSnapshot(beforeSource.snapshot, input.snapshot) ||
      !sameSourceEvidence(beforeSource.source, input.source) ||
      !sameSourceEvidence(beforeDestination.source, input.destination) ||
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
    captureMigrationOfferEvidence(deps.runner, input.sourcePath, deps, input.binding),
    captureMigrationOfferEvidence(deps.runner, input.destinationPath, deps, destinationBinding),
  ]);
  return afterSource !== undefined &&
    afterDestination !== undefined &&
    afterSource.snapshot.count === 0 &&
    sameSourceEvidence(afterSource.source, input.source) &&
    sameSourceEvidence(afterDestination.source, input.destination) &&
    sameRecordTopology(afterDestination.snapshot.records, input.snapshot.records) &&
    sameStates(afterDestination.snapshot.states, input.snapshot.states)
    ? { kind: "moved" }
    : { kind: "indeterminate", reason: "the migration result could not be verified" };
}
