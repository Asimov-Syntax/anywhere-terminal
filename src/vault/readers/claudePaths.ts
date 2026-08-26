// src/vault/readers/claudePaths.ts — Claude store roots, session-id safety, and
// containment-checked path resolution (claudeReader split).
//
// The host NEVER trusts a webview-supplied path: every session/subagent/workflow
// file is located by id under the projects root and containment-checked before it
// is read (design.md D3/D6). All id parts are validated against fixed patterns.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

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
 * The candidate is containment-checked under the projects dir before being
 * returned, and the host never trusts a webview-supplied path (D3).
 */
export async function resolveClaudeSessionPath(
  sessionId: string,
  options: ClaudeReaderOptions = {},
): Promise<string | null> {
  if (!isSafeSessionId(sessionId)) {
    return null;
  }
  const { projectsDir } = claudeRoots(options);
  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  for (const dir of projectDirs) {
    const candidate = path.join(projectsDir, dir, `${sessionId}.jsonl`);
    const rel = path.relative(projectsDir, candidate);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      continue; // outside the store root — never read it
    }
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // not in this project dir — keep scanning
    }
  }
  return null;
}

/**
 * Resolve a subagent transcript at `<projects>/<dir>/<parentId>/subagents/<stem>.jsonl`.
 * Both id parts are filename-safe (no traversal) and the resolved path is
 * containment-checked under the projects dir — the host never trusts the
 * webview-supplied composite id (D3).
 */
export async function resolveClaudeSubagentPath(
  parentId: string,
  stem: string,
  options: ClaudeReaderOptions = {},
): Promise<string | null> {
  if (!isSafeSessionId(parentId) || !isSafeSessionId(stem)) {
    return null;
  }
  const { projectsDir } = claudeRoots(options);
  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  for (const dir of projectDirs) {
    const candidate = path.join(projectsDir, dir, parentId, "subagents", `${stem}.jsonl`);
    const rel = path.relative(projectsDir, candidate);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
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
 * parts are validated against fixed patterns and the resolved path is
 * containment-checked under the projects root — the host never trusts the
 * webview-supplied composite id (D6).
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
  const rel = path.relative(projectsDir, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
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
