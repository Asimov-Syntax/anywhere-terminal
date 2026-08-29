// src/worktree/sessionPreviewService.ts — the one owner of when a transcript is
// worth opening (source-the-agent-row-preview D1a/D2).
//
// The projector asks `sessionPreview(entryId)` and holds nothing. Freshness, the
// re-check rate, in-flight de-duplication and eviction all live here, because a
// full pane projection can run at the 150 ms coalescing cap and presence rebuilds
// far faster than a session says anything new. Split across two owners, neither
// could answer "should this file be opened right now" on its own.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type ClaudeReaderOptions, resolveClaudeSessionPath } from "../vault/readers/claudePaths";
import { codexStoreDirs } from "../vault/readers/codexReader";
import { type LastActivityFormat, readLastActivityLine } from "../vault/readers/lastActivity";

/** What the service needs to know about a session to find its transcript. */
export interface PreviewEntry {
  agent: string;
  sessionId: string;
  /** The vault's file-backed hint. Accepted only after a containment check here. */
  sessionPath?: string;
}

export interface SessionPreviewDeps {
  /** The vault entry by id — the same lookup `sessionTitle` already does. */
  entry(entryId: string): Promise<PreviewEntry | null>;
  /** Overridable so a test can count real opens; defaults to the tail reader. */
  read?(transcriptPath: string, format: LastActivityFormat): Promise<string | null>;
  /** Overridable for the same reason; defaults to a real `stat`. */
  stat?(transcriptPath: string): Promise<FileStamp | null>;
  /** Store roots, overridable so a test can point resolution at a real temporary tree. */
  roots?: { claude?: ClaudeReaderOptions; codexSessionsDir?: string };
  now?(): number;
  /** Minimum gap between two looks at one session. */
  recheckMs?: number;
  /** Most sessions held at once; the least recently asked for is dropped past it. */
  cap?: number;
}

export interface SessionPreviewService {
  preview(entryId: string): Promise<string | undefined>;
}

interface FileStamp {
  mtimeMs: number;
  size: number;
}

/**
 * Freshness the user can perceive is seconds, not milliseconds. Below this the
 * syscall count would be set by how often presence rebuilds rather than by how
 * often a session speaks.
 */
export const DEFAULT_RECHECK_MS = 2000;

export const DEFAULT_PREVIEW_CACHE_CAP = 256;

interface Held {
  /** `null` once resolution has run and found nothing file-backed. */
  target: { path: string; format: LastActivityFormat } | null | undefined;
  stamp?: FileStamp;
  line?: string;
  checkedAt: number;
  inflight?: Promise<string | undefined>;
}

/**
 * A session's last activity, read at most once per `recheckMs` and only when the
 * transcript's `(mtimeMs, size)` has moved. `undefined` covers every way there can
 * be no preview — an unresolved session, a source with no transcript path, an
 * unreadable file — because the row treats them identically (D3).
 */
export function createSessionPreviewService(deps: SessionPreviewDeps): SessionPreviewService {
  const read = deps.read ?? readLastActivityLine;
  const stat = deps.stat ?? defaultStat;
  const now = deps.now ?? (() => Date.now());
  const recheckMs = deps.recheckMs ?? DEFAULT_RECHECK_MS;
  const cap = Math.max(1, deps.cap ?? DEFAULT_PREVIEW_CACHE_CAP);
  // Insertion-ordered, and re-inserted on every ask, so the front of the map is
  // the least recently asked for. The projector holds no alive set to evict by, so
  // the bound has to be the service's own.
  const held = new Map<string, Held>();

  function touch(entryId: string, entry: Held): void {
    held.delete(entryId);
    held.set(entryId, entry);
    while (held.size > cap) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      held.delete(oldest);
    }
  }

  async function resolve(entry: PreviewEntry): Promise<Held["target"]> {
    if (entry.agent === "claude") {
      const file = await resolveClaudeSessionPath(entry.sessionId, deps.roots?.claude ?? {});
      return file ? { path: file, format: "claude" } : null;
    }
    if (entry.agent === "codex") {
      // The vault's `sessionPath` is a UI hint, so it is re-checked here rather
      // than trusted: only a rollout inside Codex's own sessions dir is opened.
      const file = entry.sessionPath;
      const sessionsDir = deps.roots?.codexSessionsDir ?? codexStoreDirs().sessionsDir;
      return file && isInside(file, sessionsDir) ? { path: file, format: "codex" } : null;
    }
    // OpenCode keeps its content in SQLite rows with no transcript path, and
    // Cursor's own requirements forbid a listing from opening its store. Neither
    // is a failure — answered without touching the filesystem at all.
    return null;
  }

  async function look(entryId: string, current: Held): Promise<string | undefined> {
    const entry = await deps.entry(entryId);
    if (!entry) {
      return undefined;
    }
    if (current.target === undefined) {
      current.target = await resolve(entry);
    }
    const target = current.target;
    if (!target) {
      return undefined;
    }
    const stamp = await stat(target.path);
    if (!stamp) {
      return current.line;
    }
    const previous = current.stamp;
    if (previous && previous.mtimeMs === stamp.mtimeMs && previous.size === stamp.size) {
      return current.line; // nothing wrote to it — do not open
    }
    const line = await read(target.path, target.format);
    current.stamp = stamp;
    current.line = line ?? undefined;
    return current.line;
  }

  return {
    async preview(entryId: string): Promise<string | undefined> {
      const current = held.get(entryId) ?? { target: undefined, checkedAt: Number.NEGATIVE_INFINITY };
      touch(entryId, current);
      if (current.inflight) {
        return current.inflight; // one read per session, however many rows ask
      }
      if (now() - current.checkedAt < recheckMs) {
        return current.line;
      }
      const inflight = look(entryId, current).catch(() => current.line);
      current.inflight = inflight;
      try {
        return await inflight;
      } finally {
        current.checkedAt = now();
        current.inflight = undefined;
      }
    },
  };
}

async function defaultStat(transcriptPath: string): Promise<FileStamp | null> {
  try {
    const s = await fs.stat(transcriptPath);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

function isInside(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
