// src/worktree/deleteBranch.ts — Guarded post-removal branch deletion.

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { GitCommandRunner } from "./gitCommandRunner";
import { resolveDefaultBranch } from "./orphanProofs";

export interface DeleteBranchEvidence {
  branch: string;
  branchOid: string;
  defaultBranch: string;
  defaultOid: string;
}

export type DeleteBranchOutcome =
  | { kind: "deleted"; branch: string }
  | {
      kind: "refused";
      reason: "branch-in-use" | "default-branch" | "holders-unavailable" | "refs-moved";
    };

export interface DeleteBranchFsDeps {
  readdir(absPath: string): Promise<readonly string[]>;
  lstat(absPath: string): Promise<{ isDirectory(): boolean }>;
  stat(absPath: string): Promise<unknown>;
  readFile(absPath: string): Promise<string>;
}

const nodeFs: DeleteBranchFsDeps = {
  readdir: (absPath) => fsp.readdir(absPath),
  lstat: (absPath) => fsp.lstat(absPath),
  stat: (absPath) => fsp.stat(absPath),
  readFile: (absPath) => fsp.readFile(absPath, "utf8"),
};

interface PorcelainWorktree {
  path: string;
  branch?: string;
  bare: boolean;
}

type HolderRead = "held" | "clear" | "unavailable";

function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function validOid(value: string, length: number): boolean {
  return value.length === length && /^[0-9a-f]+$/.test(value);
}

function validFullRef(value: string): boolean {
  if (!value.startsWith("refs/") || value.endsWith("/") || value.endsWith(".")) {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 32 || code === 127 || "~^:?*[\\".includes(character)) {
      return false;
    }
  }
  if (value.includes("..") || value.includes("@{") || value.includes("//")) {
    return false;
  }
  return value.split("/").every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"));
}

function parsePorcelain(output: Buffer, oidLength: number): PorcelainWorktree[] | null {
  const text = output.toString("utf8");
  if (!text.endsWith("\0\0")) {
    return null;
  }
  const records = text
    .split("\0\0")
    .slice(0, -1)
    .map((record) => record.split("\0"));
  if (records.length === 0) {
    return null;
  }

  const paths = new Set<string>();
  const parsed: PorcelainWorktree[] = [];
  for (const fields of records) {
    const first = fields[0];
    if (first === undefined || !first.startsWith("worktree ") || first.length === "worktree ".length) {
      return null;
    }
    const worktreePath = path.resolve(first.slice("worktree ".length));
    if (paths.has(worktreePath)) {
      return null;
    }
    paths.add(worktreePath);

    let head = 0;
    let branch: string | undefined;
    let detached = 0;
    let bare = 0;
    for (const field of fields.slice(1)) {
      if (field.startsWith("HEAD ")) {
        if (++head !== 1 || !validOid(field.slice("HEAD ".length), oidLength)) {
          return null;
        }
      } else if (field.startsWith("branch ")) {
        const ref = field.slice("branch ".length);
        if (branch !== undefined || !validFullRef(ref)) {
          return null;
        }
        branch = ref;
      } else if (field === "detached") {
        detached++;
      } else if (field === "bare") {
        bare++;
      } else if (
        field !== "locked" &&
        !field.startsWith("locked ") &&
        field !== "prunable" &&
        !field.startsWith("prunable ")
      ) {
        return null;
      }
    }
    if (bare > 1 || detached > 1 || Number(branch !== undefined) + detached + bare !== 1) {
      return null;
    }
    if ((bare === 0 && head !== 1) || (bare === 1 && head !== 0)) {
      return null;
    }
    parsed.push({ path: worktreePath, ...(branch === undefined ? {} : { branch }), bare: bare === 1 });
  }
  return parsed;
}

async function optionalFile(fs: DeleteBranchFsDeps, absPath: string): Promise<string | null | undefined> {
  try {
    return await fs.readFile(absPath);
  } catch (error) {
    return isAbsent(error) ? null : undefined;
  }
}

async function optionalExists(fs: DeleteBranchFsDeps, absPath: string): Promise<boolean | undefined> {
  try {
    await fs.stat(absPath);
    return true;
  } catch (error) {
    return isAbsent(error) ? false : undefined;
  }
}

function oneLine(contents: string): string | null {
  const value = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  return value.includes("\n") ? null : value;
}

function parseRebaseHead(contents: string): string | null | undefined {
  const value = oneLine(contents);
  if (value === "detached HEAD") {
    return undefined;
  }
  return value !== null && validFullRef(value) ? value : null;
}

function parseHeldBranch(contents: string): string | null {
  const value = oneLine(contents);
  return value !== null && validFullRef(`refs/heads/${value}`) ? value : null;
}

function outputPath(contents: string): string | null {
  const value = contents.endsWith("\r\n")
    ? contents.slice(0, -2)
    : contents.endsWith("\n")
      ? contents.slice(0, -1)
      : contents;
  return value.length > 0 && !value.includes("\0") && !value.includes("\n") && !value.includes("\r") ? value : null;
}

function updateRefsHolds(contents: string, targetRef: string, oidLength: number): HolderRead {
  if (contents.length === 0) {
    return "clear";
  }
  const normalized = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  const lines = normalized.split("\n");
  if (lines.length % 3 !== 0) {
    return "unavailable";
  }
  let held = false;
  for (let index = 0; index < lines.length; index += 3) {
    const ref = lines[index];
    const before = lines[index + 1];
    const after = lines[index + 2];
    if (ref === undefined || before === undefined || after === undefined) {
      return "unavailable";
    }
    if (!validFullRef(ref) || !validOid(before, oidLength) || !validOid(after, oidLength)) {
      return "unavailable";
    }
    held ||= ref === targetRef;
  }
  return held ? "held" : "clear";
}

async function readAdministrativeHolders(
  fs: DeleteBranchFsDeps,
  gitDir: string,
  targetRef: string,
  oidLength: number,
): Promise<HolderRead> {
  const rebaseMerge = await optionalFile(fs, path.join(gitDir, "rebase-merge", "head-name"));
  if (rebaseMerge === undefined) {
    return "unavailable";
  }
  if (rebaseMerge !== null) {
    const ref = parseRebaseHead(rebaseMerge);
    if (ref === null) {
      return "unavailable";
    }
    if (ref === targetRef) {
      return "held";
    }
  }

  const rebaseApply = await optionalFile(fs, path.join(gitDir, "rebase-apply", "head-name"));
  if (rebaseApply === undefined) {
    return "unavailable";
  }
  if (rebaseApply !== null) {
    const applying = await optionalExists(fs, path.join(gitDir, "rebase-apply", "applying"));
    if (applying === undefined) {
      return "unavailable";
    }
    const ref = parseRebaseHead(rebaseApply);
    if (ref === null) {
      return "unavailable";
    }
    if (!applying && ref === targetRef) {
      return "held";
    }
  }

  const bisectStart = await optionalFile(fs, path.join(gitDir, "BISECT_START"));
  if (bisectStart === undefined) {
    return "unavailable";
  }
  if (bisectStart !== null) {
    const bisectLog = await optionalExists(fs, path.join(gitDir, "BISECT_LOG"));
    if (bisectLog === undefined) {
      return "unavailable";
    }
    if (bisectLog) {
      const origin = oneLine(bisectStart);
      if (origin === null || validOid(origin, oidLength)) {
        return "unavailable";
      }
      const ref = origin.startsWith("refs/heads/")
        ? origin
        : (() => {
            const branch = parseHeldBranch(bisectStart);
            return branch === null ? null : `refs/heads/${branch}`;
          })();
      if (ref === null || !validFullRef(ref)) {
        return "unavailable";
      }
      if (ref === targetRef) {
        return "held";
      }
    }
  }

  const updateRefs = await optionalFile(fs, path.join(gitDir, "rebase-merge", "update-refs"));
  if (updateRefs === undefined) {
    return "unavailable";
  }
  return updateRefs === null ? "clear" : updateRefsHolds(updateRefs, targetRef, oidLength);
}

async function readRawAdminDirs(
  fs: DeleteBranchFsDeps,
  commonGitDir: string,
): Promise<Array<{ adminDir: string; worktreePath: string }> | null> {
  const worktreesDir = path.join(commonGitDir, "worktrees");
  let names: readonly string[];
  try {
    names = await fs.readdir(worktreesDir);
  } catch (error) {
    if (isAbsent(error)) {
      return [];
    }
    return null;
  }

  const entries: Array<{ adminDir: string; worktreePath: string }> = [];
  for (const name of names) {
    if (name === "." || name === "..") {
      continue;
    }
    const adminDir = path.join(worktreesDir, name);
    try {
      if (!(await fs.lstat(adminDir)).isDirectory()) {
        return null;
      }
      const pointer = outputPath(await fs.readFile(path.join(adminDir, "gitdir")));
      if (pointer === null) {
        return null;
      }
      const gitFile = path.resolve(adminDir, pointer);
      entries.push({ adminDir, worktreePath: path.dirname(gitFile) });
    } catch {
      return null;
    }
  }
  return entries;
}

async function holders(
  runner: GitCommandRunner,
  repoPath: string,
  targetRef: string,
  oidLength: number,
  fs: DeleteBranchFsDeps,
): Promise<HolderRead> {
  const listing = await runner.run(["worktree", "list", "--porcelain", "-z"], repoPath);
  if (listing.code !== 0 || listing.timedOut || listing.failedToSpawn) {
    return "unavailable";
  }
  const worktrees = parsePorcelain(listing.stdout, oidLength);
  if (worktrees === null) {
    return "unavailable";
  }
  if (worktrees.some((worktree) => worktree.branch === targetRef)) {
    return "held";
  }

  const common = await runner.run(["rev-parse", "--git-common-dir"], repoPath);
  if (common.code !== 0 || common.timedOut || common.failedToSpawn) {
    return "unavailable";
  }
  const commonOutput = outputPath(common.stdout.toString("utf8"));
  if (commonOutput === null) {
    return "unavailable";
  }
  const commonGitDir = path.resolve(repoPath, commonOutput);
  try {
    await fs.stat(commonGitDir);
  } catch {
    return "unavailable";
  }
  const rawEntries = await readRawAdminDirs(fs, commonGitDir);
  if (rawEntries === null) {
    return "unavailable";
  }

  const byPath = new Map(worktrees.map((worktree) => [worktree.path, worktree]));
  const matched = new Set<string>();
  for (const entry of rawEntries) {
    if (!byPath.has(entry.worktreePath) || matched.has(entry.worktreePath)) {
      return "unavailable";
    }
    matched.add(entry.worktreePath);
    const holder = await readAdministrativeHolders(fs, entry.adminDir, targetRef, oidLength);
    if (holder !== "clear") {
      return holder;
    }
  }

  const main = worktrees.filter((worktree) => !matched.has(worktree.path));
  if (main.length !== 1 || main[0]?.bare) {
    return "unavailable";
  }
  return readAdministrativeHolders(fs, commonGitDir, targetRef, oidLength);
}

/**
 * Delete the recorded branch only while both recorded refs still hold and no
 * worktree or Git operation currently reports the branch as held.
 */
export async function deleteBranch(
  runner: GitCommandRunner,
  repoPath: string,
  evidence: DeleteBranchEvidence,
  fs: DeleteBranchFsDeps = nodeFs,
): Promise<DeleteBranchOutcome> {
  const targetRef = `refs/heads/${evidence.branch}`;
  const defaultRef = `refs/heads/${evidence.defaultBranch}`;
  if (!validFullRef(targetRef) || !validFullRef(defaultRef)) {
    return { kind: "refused", reason: "holders-unavailable" };
  }

  const currentDefault = await resolveDefaultBranch(repoPath, (args, cwd) => runner.run(args, cwd));
  if (currentDefault === undefined) {
    return { kind: "refused", reason: "holders-unavailable" };
  }
  if (currentDefault === evidence.branch) {
    return { kind: "refused", reason: "default-branch" };
  }

  const format = await runner.run(["rev-parse", "--show-object-format=storage"], repoPath);
  if (format.code !== 0 || format.timedOut || format.failedToSpawn) {
    return { kind: "refused", reason: "holders-unavailable" };
  }
  const oidLength = format.stdout.toString("utf8").trim() === "sha1" ? 40 : 64;
  if (
    !["sha1", "sha256"].includes(format.stdout.toString("utf8").trim()) ||
    !validOid(evidence.branchOid, oidLength) ||
    !validOid(evidence.defaultOid, oidLength)
  ) {
    return { kind: "refused", reason: "holders-unavailable" };
  }

  const holder = await holders(runner, repoPath, targetRef, oidLength, fs);
  if (holder === "held") {
    return { kind: "refused", reason: "branch-in-use" };
  }
  if (holder === "unavailable") {
    return { kind: "refused", reason: "holders-unavailable" };
  }

  const transaction = [
    "start",
    `verify ${defaultRef} ${evidence.defaultOid}`,
    "option no-deref",
    `delete ${targetRef} ${evidence.branchOid}`,
    "commit",
    "",
  ].join("\n");
  const result = await runner.run(["update-ref", "--stdin"], repoPath, { input: transaction });
  if (result.code !== 0 || result.timedOut || result.failedToSpawn) {
    return { kind: "refused", reason: "refs-moved" };
  }
  return { kind: "deleted", branch: evidence.branch };
}
