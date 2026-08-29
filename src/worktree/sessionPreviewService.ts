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
import { claudeRoots } from "../vault/readers/claudePaths";
import { codexStoreDirs, pickRolloutPath } from "../vault/readers/codexReader";
import { type LastActivityFormat, readLastActivityLine } from "../vault/readers/lastActivity";
import type { VaultAgentId } from "../vault/types";

/** What the service needs to know about a session to find its transcript. */
export interface PreviewEntry {
  /** The vault's own union, so a new provider is a compile-time decision rather
   *  than a silent gap in D1a's stated coverage. */
  agent: VaultAgentId;
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
  roots?: { claudeProjectsDir?: string; codexSessionsDir?: string };
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

/**
 * Resolving and re-checking are different questions and must not share one
 * interval. Re-checking a known file is a `stat`; resolving a Codex session that
 * has no rollout yet is a walk of `~/.codex/sessions/**`, a tree that grows with
 * history and is never pruned. On the freshness cadence that walk would recur at
 * 0.5 Hz forever for a single unresolvable row (round-2 B1-R2), so consecutive
 * failures decay their own retry and a success puts the entry back on the cadence.
 */
const MAX_BACKOFF_SHIFT = 8;

/**
 * A look that rejected is just an unproductive look. It takes the same ladder as
 * every other one: round 2 gave it a 250 ms floor, which re-examined a
 * persistently rejecting session eight times inside one interval and so broke
 * `worktree-agent-presence` § "a session is re-examined at most once per
 * interval" (round-3 W2-R3). The accepted requirement outranks the faster-retry
 * suggestion that produced the floor.
 */

type Target =
  /** This source keeps no transcript at all — never worth another syscall. */
  | { kind: "uncovered" }
  /** File-backed, but no transcript found yet. Retried on the ordinary cadence:
   *  Codex writes its rollout after the thread row exists, and a Claude session
   *  moves project dir when its cwd changes, so "not there" is a moment, not a
   *  verdict (round-1 B2). */
  | { kind: "unresolved" }
  | { kind: "resolved"; path: string; format: LastActivityFormat };

interface Held {
  target: Target;
  /**
   * The vault entry that produced `target`, held beside it.
   *
   * The entry is what a RE-resolve needs; re-checking a known file does not need
   * it at all. Asking for it every look sent a Codex row through `readCodexEntry`,
   * whose no-SQLite branch is the same history-sized tree walk the retry ladder
   * exists to bound — and a healthy row never engages that ladder, so the walk
   * ran at the freshness cadence forever (round-3 B1-R3).
   */
  entry?: PreviewEntry;
  /** Whether the look in progress achieved anything: an unchanged stamp confirmed,
   *  or a read completed. The retry ladder keys off this rather than off what the
   *  target happens to say, so a lookup that returns nothing over a stale resolved
   *  target cannot reset it (round-3 W1-R3). */
  progressed?: boolean;
  stamp?: FileStamp;
  line?: string;
  /** Earliest time another look may run. Every outcome sets it, so no path is ungated. */
  nextAt: number;
  /** Consecutive resolution failures, for the backoff above. */
  misses: number;
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

  /**
   * Both branches hand the decision to the store's own resolver rather than
   * re-deriving containment here — `pickRolloutPath` already owns "the index's
   * path when it is contained, else a scan by filename", and dropping half of it
   * left a Codex session with a stale `rollout_path` permanently blank (W2).
   */
  async function resolve(entry: PreviewEntry, useHint: boolean): Promise<Target> {
    if (entry.agent === "claude") {
      // The path the entry already carries, containment-checked — which is also
      // what makes the spec's "a transcript it can locate" true of this branch
      // rather than of a projects-wide scan (W6).
      const file = useHint ? entry.sessionPath : undefined;
      const projectsDir = deps.roots?.claudeProjectsDir ?? claudeRoots({}).projectsDir;
      return file && isInside(file, projectsDir)
        ? { kind: "resolved", path: file, format: "claude" }
        : { kind: "unresolved" };
    }
    if (entry.agent === "codex") {
      const sessionsDir = deps.roots?.codexSessionsDir ?? codexStoreDirs().sessionsDir;
      const file = await pickRolloutPath(
        useHint && entry.sessionPath ? { rolloutPath: entry.sessionPath } : null,
        entry.sessionId,
        sessionsDir,
      );
      return file ? { kind: "resolved", path: file, format: "codex" } : { kind: "unresolved" };
    }
    // OpenCode keeps its content in SQLite rows with no transcript path, and
    // Cursor's own requirements forbid a listing from opening its store. Neither
    // is a failure — answered without touching the filesystem at all.
    return { kind: "uncovered" };
  }

  async function look(entryId: string, current: Held): Promise<string | undefined> {
    if (current.target.kind === "uncovered") {
      return undefined;
    }
    // Only when there is no target to re-check. A resolved one already has the
    // entry that produced it, and re-checking is a `stat` (B1-R3).
    if (current.target.kind !== "resolved" || current.entry === undefined) {
      const fresh = await deps.entry(entryId);
      if (!fresh) {
        return forget(current);
      }
      current.entry = fresh;
    }
    const entry = current.entry;
    if (current.target.kind === "unresolved") {
      current.target = await resolve(entry, true);
    }
    const target = current.target;
    if (target.kind !== "resolved") {
      return forget(current);
    }
    let stamp = await stat(target.path);
    if (!stamp) {
      // The path we held is gone. Containment is lexical, so the entry's own
      // hint keeps pointing at the dead path and resolving from it again would
      // loop — ask the store WITHOUT the hint, which is what runs the filename
      // fallback and finds where the transcript moved to (round-1 B2/W2).
      // Codex only, and deliberately: `resolve(entry, false)` drops the hint, and
      // the hint is ALL the Claude branch has, so there it would always answer
      // `unresolved`. A Claude row recovers a moved transcript on the next ask
      // instead — `deps.entry()` re-derives its path by id every look (S1-R2).
      const again = entry.agent === "codex" ? await resolve(entry, false) : { kind: "unresolved" as const };
      stamp = again.kind === "resolved" && again.path !== target.path ? await stat(again.path) : null;
      if (!stamp) {
        // Nothing readable now. Unresolved rather than uncovered, so a transcript
        // that reappears is found — and no line, because the spec says one that
        // cannot be read carries no preview at all (W1). The entry goes too: the
        // next look must ask the vault where this session lives now.
        current.target = { kind: "unresolved" };
        current.entry = undefined;
        return forget(current);
      }
      current.target = again;
      current.stamp = undefined;
    }
    const resolved = current.target;
    if (resolved.kind !== "resolved") {
      return forget(current);
    }
    const previous = current.stamp;
    if (previous && previous.mtimeMs === stamp.mtimeMs && previous.size === stamp.size) {
      current.progressed = true;
      return current.line; // nothing wrote to it — do not open
    }
    const line = await read(resolved.path, resolved.format);
    current.stamp = stamp;
    current.line = line ?? undefined;
    current.progressed = true;
    return current.line;
  }

  /** No preview, and none remembered — a row must not keep text whose source it
   *  can no longer read. */
  function forget(current: Held): undefined {
    current.stamp = undefined;
    current.line = undefined;
    return undefined;
  }

  return {
    async preview(entryId: string): Promise<string | undefined> {
      const current = held.get(entryId) ?? {
        target: { kind: "unresolved" as const },
        nextAt: Number.NEGATIVE_INFINITY,
        misses: 0,
      };
      touch(entryId, current);
      const schedule = (): void => {
        current.nextAt = now() + recheckMs * 2 ** Math.min(current.misses, MAX_BACKOFF_SHIFT);
      };
      if (current.inflight) {
        return current.inflight; // one read per session, however many rows ask
      }
      if (now() < current.nextAt) {
        return current.line;
      }
      current.progressed = false;
      const inflight = look(entryId, current).then(
        (line) => {
          // Progress, not the target's state: a look that paid for resolution and
          // found nothing waits longer, and one that merely reports a stale
          // target cannot pretend it achieved something (W1-R3).
          current.misses = current.progressed === true ? 0 : current.misses + 1;
          schedule();
          return line;
        },
        () => {
          current.misses += 1;
          schedule();
          return forget(current);
        },
      );
      current.inflight = inflight;
      try {
        return await inflight;
      } finally {
        current.inflight = undefined;
        // Re-seat only when the id is genuinely unmapped: eviction mid-read would
        // otherwise strand this result, but a NEWER entry for the same id must
        // win rather than be overwritten by this stale one (S6, corrected by
        // round-2 W2-R2).
        if (!held.has(entryId)) {
          touch(entryId, current);
        }
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
