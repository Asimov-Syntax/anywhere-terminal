// src/vault/readers/claudePaths.ts — Claude store roots, session-id safety, and
// containment-checked path resolution (claudeReader split).
//
// The host NEVER trusts a webview-supplied path: every session/subagent/workflow
// file is located by id under the projects root and containment-checked before it
// is read (design.md D3/D6). All id parts are validated against fixed patterns.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { provesAbsence } from "../../utils/fsPresence";
import { isResolvedPathInsideRoot, type PreparedRoot, prepareResolvedRoot } from "../../utils/pathBoundary";

/** Separates a parent session id from a subagent file stem in an entry id:
 *  `claude:<parentSessionId>:subagent:<agent-stem>`. */
export const SUBAGENT_MARKER = ":subagent:";

/** Workflow run id / agent stem patterns — re-validated before any path join as
 *  defense-in-depth (the dispatch already parsed them via claudeChildIds). */
export const WORKFLOW_ID_RE = /^wf_[A-Za-z0-9_-]+$/;
export const WORKFLOW_AGENT_STEM_RE = /^agent-[A-Za-z0-9]+$/;

export interface ClaudeReaderOptions {
  /** `$CLAUDE_CONFIG_DIR` override; defaults to the env var. */
  configDir?: string;
  /** Home dir; defaults to `os.homedir()`. */
  home?: string;
}

/** Decode an encoded project dir back to a cwd (lossy, fallback only — D7). */
export function decodeProjectDir(dirName: string): string {
  return dirName.replace(/-/g, "/");
}

export async function listJsonlFiles(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names.filter((n) => n.endsWith(".jsonl")).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/** Resolve the store root + projects dir (shared by list + detail paths). */
export function claudeRoots(options: ClaudeReaderOptions): { configDir?: string; projectsDir: string } {
  const configDir = options.configDir ?? process.env.CLAUDE_CONFIG_DIR;
  const home = options.home ?? os.homedir();
  const root = configDir ? configDir : path.join(home, ".claude");
  return { configDir, projectsDir: path.join(root, "projects") };
}

/** Session ids are filename stems — reject anything that could escape the dir. */
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.includes("..");
}

/**
 * Locate the unique session file by id with a metadata-only directory scan
 * (each `<projects>/<dir>/<sessionId>.jsonl`) — no transcript content is read.
 * The candidate is containment-checked under the projects dir on RESOLVED paths
 * before being returned, and the host never trusts a webview-supplied path (D3).
 */
/**
 * What a by-id path scan established. `exhaustive` is the only thing that lets a
 * caller say the session is not there: a scan that could not list a project
 * directory, or could not establish the store root, searched less than it looks
 * (tell-an-absent-session-from-an-unknown-one D4).
 */
export interface ClaudeSessionPathScan {
  path: string | null;
  exhaustive: boolean;
}

export async function scanClaudeSessionPath(
  sessionId: string,
  options: ClaudeReaderOptions = {},
): Promise<ClaudeSessionPathScan> {
  if (!isSafeSessionId(sessionId)) {
    // No store can carry this id, which is a conclusive answer, not a failed look.
    return { path: null, exhaustive: true };
  }
  const { projectsDir } = claudeRoots(options);
  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    // A projects dir that is not there means no session is either; any other
    // failure means this process could not look.
    return { path: null, exhaustive: provesAbsence(err) };
  }
  // Once for the scan, not once per project directory (D8).
  const root = await prepareResolvedRoot(projectsDir);
  if (root === null) {
    // Containment could not be established, so nothing was searched at all.
    return { path: null, exhaustive: false };
  }
  let exhaustive = true;
  for (const dir of projectDirs) {
    const candidate = path.join(projectsDir, dir, `${sessionId}.jsonl`);
    if (!(await isResolvedPathInsideRoot(candidate, root))) {
      // Never read it. But a false here has two causes the predicate does not
      // separate: the path resolves outside the store root, or the filesystem
      // declined to answer (EACCES/ELOOP — pathBoundary.ts). Only the first
      // proves the candidate is not a legitimate session file, so a scan that
      // saw either can no longer call itself exhaustive. Conservative on
      // purpose: it costs an unproven absence, never a false one (D2).
      exhaustive = false;
      continue;
    }
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return { path: candidate, exhaustive: true };
      }
    } catch (err) {
      // Not in this project dir — but only when the error says so. The permission
      // case never arrives here: without execute on the directory, `realpath`
      // fails inside the containment check above and the candidate is skipped
      // there. This covers a transient failure (EIO, ENOMEM) on a path that
      // resolved fine, which no test can provoke through chmod.
      if (!provesAbsence(err)) {
        exhaustive = false;
      }
    }
  }
  return { path: null, exhaustive };
}

/** The path-or-nothing view, for the callers that cannot act on the difference. */
export async function resolveClaudeSessionPath(
  sessionId: string,
  options: ClaudeReaderOptions = {},
): Promise<string | null> {
  return (await scanClaudeSessionPath(sessionId, options)).path;
}

/**
 * Resolve a subagent transcript at `<projects>/<dir>/<parentId>/subagents/<stem>.jsonl`.
 * Both id parts are filename-safe (no traversal) and the candidate is
 * containment-checked on resolved paths under the projects dir — the host never
 * trusts the webview-supplied composite id (D3).
 */
export async function resolveClaudeSubagentPath(
  parentId: string,
  stem: string,
  options: ClaudeReaderOptions = {},
): Promise<string | null> {
  const { projectsDir } = claudeRoots(options);
  const root = await prepareResolvedRoot(projectsDir);
  return root === null ? null : resolveClaudeSubagentPathUnder(parentId, stem, projectsDir, root);
}

/**
 * The same resolution against an ALREADY-prepared projects root, for a caller
 * holding several candidates at once — picking among tied subagents resolves the
 * same root per candidate otherwise (design.md D8, review round-2 W1). Every
 * candidate still resolves; only the root is shared.
 */
export async function resolveClaudeSubagentPathUnder(
  parentId: string,
  stem: string,
  projectsDir: string,
  root: PreparedRoot,
): Promise<string | null> {
  if (!isSafeSessionId(parentId) || !isSafeSessionId(stem)) {
    return null;
  }
  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  for (const dir of projectDirs) {
    const candidate = path.join(projectsDir, dir, parentId, "subagents", `${stem}.jsonl`);
    if (!(await isResolvedPathInsideRoot(candidate, root))) {
      continue;
    }
    try {
      if ((await fs.stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // not under this project dir — keep scanning
    }
  }
  return null;
}

/**
 * Resolve a workflow agent transcript at
 * `<projects>/<dir>/<parentId>/subagents/workflows/<wfId>/<stem>.jsonl`. All id
 * parts are validated against fixed patterns and the candidate is
 * containment-checked on resolved paths under the projects root — the host never
 * trusts the webview-supplied composite id (D6).
 */
export async function resolveClaudeWorkflowAgentPath(
  parentId: string,
  wfId: string,
  stem: string,
  options: ClaudeReaderOptions,
): Promise<string | null> {
  if (!isSafeSessionId(parentId) || !WORKFLOW_ID_RE.test(wfId) || !WORKFLOW_AGENT_STEM_RE.test(stem)) {
    return null;
  }
  const parentPath = await resolveClaudeSessionPath(parentId, options);
  if (!parentPath) {
    return null;
  }
  const candidate = path.join(path.dirname(parentPath), parentId, "subagents", "workflows", wfId, `${stem}.jsonl`);
  const { projectsDir } = claudeRoots(options);
  const root = await prepareResolvedRoot(projectsDir);
  if (root === null || !(await isResolvedPathInsideRoot(candidate, root))) {
    return null;
  }
  try {
    return (await fs.stat(candidate)).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * mtime (epoch ms) of `<sessionId>.jsonl`, or `undefined` when it cannot be read.
 *
 * The tie-break among several live sessions claiming one pane, and previously a
 * copy per caller — the two terminal providers and the presence projection all
 * needed the same resolve-then-stat, and drift between them would make the same
 * pane resolve differently depending on which flow asked
 * (.reviews/round-1.md S2).
 */
export async function claudeSessionMtime(
  sessionId: string,
  options: ClaudeReaderOptions = {},
): Promise<number | undefined> {
  const filePath = await resolveClaudeSessionPath(sessionId, options);
  if (!filePath) {
    return undefined;
  }
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return undefined;
  }
}
