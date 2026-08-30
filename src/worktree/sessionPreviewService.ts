// src/worktree/sessionPreviewService.ts — the one owner of when a transcript is
// worth opening (source-the-agent-row-preview D1a/D2).
//
// The projector asks `sessionPreview(entryId)` and holds nothing. Freshness, the
// re-check rate, in-flight de-duplication and eviction all live here, because a
// full pane projection can run at the 150 ms coalescing cap and presence rebuilds
// far faster than a session says anything new. Split across two owners, neither
// could answer "should this file be opened right now" on its own.

import * as fs from "node:fs/promises";
import { isResolvedPathInside } from "../utils/resolvedPathBoundary";
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

/**
 * What a by-id lookup established, mirroring `VaultEntryLookup`
 * (`src/vault/types.ts`) with the preview's narrower entry shape. The asymmetry
 * is the whole point: `absent` is a PROOF the session is not there and retires
 * the row's line, while every path that merely failed to find out is `unknown`
 * and changes nothing. Collapsing the two — which is what a `null` return did —
 * retires a live session's line whenever a store hiccups.
 */
export type PreviewLookup = { status: "found"; entry: PreviewEntry } | { status: "absent" } | { status: "unknown" };

export interface SessionPreviewDeps {
  /** The vault entry by id, answered conclusively — see {@link PreviewLookup}. */
  entry(entryId: string): Promise<PreviewLookup>;
  /** Overridable so a test can count real opens; defaults to the tail reader. */
  read?(transcriptPath: string, format: LastActivityFormat): Promise<string | null>;
  /** Overridable for the same reason; defaults to a real `stat`. */
  stat?(transcriptPath: string): Promise<FileStamp | null>;
  /** Store roots, overridable so a test can point resolution at a real temporary tree. */
  roots?: { claudeProjectsDir?: string; codexSessionsDir?: string };
  now?(): number;
  /** Minimum gap between two looks at one session. */
  recheckMs?: number;
  /** How long one look may run before the row is answered without it. */
  lookTimeoutMs?: number;
  /** The deadline's clock, overridable so a test resolves it rather than waiting. */
  wait?(ms: number): Deadline;
  /** Most sessions held at once; the least recently asked for is dropped past it. */
  cap?: number;
  /** Minimum gap between two lookups of one session in its agent's store. */
  entryRecheckMs?: number;
}

/**
 * A deadline that can be called off. Cancellation is not symmetry with the read it
 * races: `outstanding` releases a look the moment it settles, so nothing else bounds
 * the timer that look outran, and a healthy projection would arm one per row and free
 * none of them for the whole timeout (round-1 B1-R1). The read has no such handle and
 * keeps its slot until it settles instead.
 */
export interface Deadline {
  readonly elapsed: Promise<void>;
  cancel(): void;
}

export interface SessionPreviewService {
  preview(entryId: string): Promise<string | undefined>;
  /**
   * The line this session already has, or nothing. Never creates state, never
   * starts work, and never stands in for a confirmation — but it DOES touch what
   * it returns, which is what keeps an excluded row's line: every drawn row is
   * either asked or read on every projection, so the least recently touched
   * entries are the ones the window has stopped drawing (D8).
   *
   * A caller that bounds how many sessions it asks about needs the rest of them
   * to keep drawing what they last said. Skipping them would cost each one its
   * line, and asking them would defeat the bound — so they are read.
   */
  line(entryId: string): string | undefined;
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

/**
 * Long enough that a healthy but cold read is never abandoned, short enough that a
 * sleeping volume does not hold a row for the life of the window. The row is
 * answered at the first opportunity AFTER this elapses — `setTimeout` schedules a
 * minimum delay, and a busy extension host can only make it later.
 */
export const DEFAULT_LOOK_TIMEOUT_MS = 5000;

export const DEFAULT_PREVIEW_CACHE_CAP = 256;

/**
 * How long a session's store answer stands before it is worth asking again.
 *
 * An order of magnitude slower than the freshness check beside it, and
 * deliberately: the lookup is resolve-by-id with no cache, and for a Codex row
 * without SQLite it reaches the same history-sized tree walk the retry ladder
 * exists to bound. Chosen against what the staleness costs rather than what the
 * check costs — the line is historical text either way.
 *
 * This is the gap between two lookups, NOT a wall-clock bound on a stale line.
 * The service is pull-based: nothing asks, nothing is re-confirmed. What it
 * promises is that the first eligible look after the interval consults the store.
 */
export const DEFAULT_ENTRY_RECHECK_MS = 30_000;

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
  /** The session was PROVEN gone from its agent's store. No syscall is worth
   *  making for it — not a resolve, not a `stat`, not a read — but unlike
   *  `uncovered` it is not final: the store is re-consulted on
   *  `entryRecheckMs`, so a session that comes back previews again. */
  | { kind: "gone" }
  | { kind: "resolved"; path: string; format: LastActivityFormat };

/**
 * The five fields one look reads and writes. A look owns a *copy* of them and
 * `preview` commits it back only while that look is still the current attempt —
 * a look does not confine its writes to its return value (it calls `forget` and
 * `clearTarget` on its own resolved paths), so an attempt abandoned at its
 * deadline would otherwise go on to blank the line the deadline promised to keep.
 */
interface LookState {
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
  /**
   * When the store last answered CONCLUSIVELY about this session — `found` or
   * `absent`. An `unknown` establishes nothing, so leaving the stamp where it
   * was makes the next eligible look ask again rather than wait out another
   * interval on a store that has already failed once.
   */
  confirmedAt?: number;
  /** Whether the look in progress achieved anything: an unchanged stamp confirmed,
   *  or a read completed. The retry ladder keys off this rather than off what the
   *  target happens to say, so a lookup that returns nothing over a stale resolved
   *  target cannot reset it (round-3 W1-R3). */
  progressed?: boolean;
  stamp?: FileStamp;
  line?: string;
}

interface Held extends LookState {
  /** Earliest time another look may run. Every outcome sets it, so no path is ungated. */
  nextAt: number;
  /** Consecutive resolution failures, for the backoff above. */
  misses: number;
  /** Which attempt owns this entry. A look captures it on the way in; the deadline
   *  bumps it; a settlement commits and scores only while it still matches. */
  generation: number;
  inflight?: Promise<string | undefined>;
}

function snapshot(current: Held): LookState {
  return {
    target: current.target,
    entry: current.entry,
    confirmedAt: current.confirmedAt,
    stamp: current.stamp,
    line: current.line,
    progressed: false,
  };
}

function commit(current: Held, draft: LookState): void {
  current.target = draft.target;
  current.entry = draft.entry;
  current.confirmedAt = draft.confirmedAt;
  current.stamp = draft.stamp;
  current.line = draft.line;
  current.progressed = draft.progressed;
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
  const lookTimeoutMs = deps.lookTimeoutMs ?? DEFAULT_LOOK_TIMEOUT_MS;
  const wait = deps.wait ?? defaultWait;
  const cap = Math.max(1, deps.cap ?? DEFAULT_PREVIEW_CACHE_CAP);
  const entryRecheckMs = deps.entryRecheckMs ?? DEFAULT_ENTRY_RECHECK_MS;
  // Insertion-ordered, and re-inserted on every ask OR read, so the front of the
  // map is whatever the caller has gone longest without mentioning. A caller that
  // touches every row it draws therefore evicts only rows it has stopped drawing.
  const held = new Map<string, Held>();
  // Every look that has not settled, abandoned ones included, keyed by entry id and
  // holding the entry that owns it. Deliberately NOT keyed off `held`: eviction
  // drops the object an abandoned look's generation lives on, so a promise-only
  // registry would let the next ask rebuild a blank entry — losing the row's line,
  // unfencing the look, and starting a second read against the same stalled path
  // once per cadence tick for as long as it stayed stalled.
  const outstanding = new Map<string, Held>();

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
      // The path the entry already carries, containment-checked on RESOLVED
      // paths — which is also what makes the spec's "a transcript it can locate"
      // true of this branch rather than of a projects-wide scan (W6). A hint
      // that resolves out of the store leaves the row unresolved, so the
      // ordinary cadence retries it rather than recording it as uncovered.
      const file = useHint ? entry.sessionPath : undefined;
      const projectsDir = deps.roots?.claudeProjectsDir ?? claudeRoots({}).projectsDir;
      return file && (await isResolvedPathInside(file, projectsDir))
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

  async function look(entryId: string, current: LookState): Promise<string | undefined> {
    if (current.target.kind === "uncovered") {
      return undefined;
    }
    const due = current.confirmedAt === undefined || now() - current.confirmedAt >= entryRecheckMs;
    if (current.target.kind === "gone" && !due) {
      // A retired row is not a failed resolution — it is a row correctly showing
      // nothing — so it scores as progress and keeps the ordinary spacing rather
      // than decaying up a ladder that bounds work this look never performs.
      current.progressed = true;
      return undefined;
    }
    // Only when there is no target to re-check, or the store's answer has stood
    // long enough. A resolved target already has the entry that produced it, and
    // re-checking is a `stat` (B1-R3).
    if (current.target.kind !== "resolved" || current.entry === undefined || due) {
      const fresh = await deps.entry(entryId);
      if (fresh.status === "absent") {
        current.target = { kind: "gone" };
        current.entry = undefined;
        current.confirmedAt = now();
        current.progressed = true;
        return forget(current);
      }
      if (fresh.status === "unknown") {
        // Established nothing, so it changes nothing — the same shape a timeout
        // takes, and for the same reason (D33). The row keeps whatever it holds
        // and the look scores no progress, so the ladder backs the next attempt
        // off.
        //
        // Returning here rather than carrying on with the held entry is what
        // bounds the store: an `unknown` deliberately does not stamp
        // `confirmedAt`, so the row stays permanently due, and a fall-through
        // that reached an unchanged `stat` would set `progressed`, reset the
        // ladder, and re-ask the store on the ORDINARY cadence — the
        // history-sized Codex walk at 0.5 Hz that D2 exists to prevent
        // (round-1 B1). The cost is one skipped freshness check per inconclusive
        // lookup, on a row that is already showing its last known line.
        return current.line;
      }
      current.entry = fresh.entry;
      current.confirmedAt = now();
      if (current.target.kind === "gone") {
        // gone → unresolved → resolved: the ordinary resolve path recovers it.
        current.target = { kind: "unresolved" };
      }
    }
    const entry = current.entry;
    if (entry === undefined) {
      return current.line;
    }
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
      // `unresolved`. A Claude row recovers on the NEXT ask instead, and only
      // because the branch below clears `current.entry` — that is what sends the
      // next look back to the vault for a freshly derived path (S1-R2, S2-R4).
      const again = entry.agent === "codex" ? await resolve(entry, false) : { kind: "unresolved" as const };
      stamp = again.kind === "resolved" && again.path !== target.path ? await stat(again.path) : null;
      if (!stamp) {
        // Nothing readable now. Unresolved rather than uncovered, so a transcript
        // that reappears is found — and no line, because the spec says one that
        // cannot be read carries no preview at all (W1).
        //
        // Dropping the target is what carries recovery: the guard at the top of
        // `look` re-fetches the entry whenever the target is not resolved, so the
        // next look asks the vault for a freshly derived path rather than
        // re-resolving from a hint already known to be dead. Clearing the cached
        // entry alongside it is tidiness, not the mechanism — the two fields
        // simply must not be left disagreeing (S2-R4).
        clearTarget(current);
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

  /**
   * Give up on where this session's transcript is. A held entry is only
   * meaningful beside the resolved target it produced, so they are dropped
   * together — the target is the half `look`'s guard actually reads.
   */
  function clearTarget(current: LookState): void {
    current.target = { kind: "unresolved" };
    current.entry = undefined;
  }

  /** No preview, and none remembered — a row must not keep text whose source it
   *  can no longer read. */
  function forget(current: LookState): undefined {
    current.stamp = undefined;
    current.line = undefined;
    return undefined;
  }

  return {
    line(entryId: string): string | undefined {
      // `held` only. An abandoned look keeps its entry in `outstanding` with the
      // line it had before it stalled, and reading through to it would present
      // text whose source the service has since failed to reach.
      const current = held.get(entryId);
      if (current === undefined) {
        return undefined;
      }
      touch(entryId, current);
      return current.line;
    },

    async preview(entryId: string): Promise<string | undefined> {
      const current = held.get(entryId) ??
        outstanding.get(entryId) ?? {
          target: { kind: "unresolved" as const },
          nextAt: Number.NEGATIVE_INFINITY,
          misses: 0,
          generation: 0,
        };
      touch(entryId, current);
      const schedule = (): void => {
        current.nextAt = now() + recheckMs * 2 ** Math.min(current.misses, MAX_BACKOFF_SHIFT);
      };
      if (current.inflight) {
        return current.inflight; // one read per session, however many rows ask
      }
      // A look already abandoned at its deadline is still holding a filesystem
      // operation open. Retrying into it is the unbounded behaviour being removed:
      // the session waits on the one attempt it has, showing what it last knew.
      if (outstanding.has(entryId) || outstanding.size >= cap) {
        return current.line;
      }
      if (now() < current.nextAt) {
        return current.line;
      }
      const generation = ++current.generation;
      const draft = snapshot(current);
      outstanding.set(entryId, current);
      // Inert: the attempt reports what it found and changes nothing on the entry.
      // Committing inside these handlers meant committing BEFORE the race had said
      // who won, and `Promise.race` picks whichever array promise settles first
      // rather than whichever event fired first — so a further `.then` on this side
      // handed a same-tick race to the deadline even when the look finished first,
      // and a healthy read was scored a miss (round-3 B1-R3). Tagged here, both
      // sides are one microtask from settling and nothing is written until the
      // continuation below knows which happened.
      const attempt = look(entryId, draft).then(
        (line) => ({ expired: false as const, ok: true as const, line }),
        () => ({ expired: false as const, ok: false as const, line: undefined }),
      );
      // Cleanup rides the SCORED promise, whose two handlers make it unrejectable,
      // and never a bare `finally` on the look: that returns a fresh promise which
      // adopts the rejection, and nothing observes it — so a read that throws after
      // its deadline would surface as an unhandled rejection in the extension host.
      void attempt.then(() => {
        if (outstanding.get(entryId) === current) {
          outstanding.delete(entryId);
        }
      });
      // Tagged rather than compared against a sentinel: a look that answered
      // `undefined` and a look that never answered are different outcomes, and only
      // a discriminant keeps them apart once both are `string | undefined`.
      const deadline = wait(lookTimeoutMs);
      const inflight = Promise.race([attempt, deadline.elapsed.then(() => ({ expired: true as const }))]).then(
        (outcome) => {
          if (outcome.expired) {
            // A timeout is the absence of evidence, not evidence of absence: score
            // it as a look that achieved nothing so it takes the same ladder, and
            // hand back the line already on the row rather than blanking it (D33).
            current.generation += 1;
            current.misses += 1;
            schedule();
            return current.line;
          }
          deadline.cancel();
          // Redundant now that nothing commits before the race has chosen, and kept
          // deliberately: a second, independent guard on the property round 3 showed
          // can fall to promise plumbing alone, for the cost of one comparison.
          if (current.generation !== generation) {
            return outcome.line;
          }
          commit(current, draft);
          if (outcome.ok) {
            // Progress, not the target's state: a look that paid for resolution and
            // found nothing waits longer, and one that merely reports a stale target
            // cannot pretend it achieved something (W1-R3).
            current.misses = draft.progressed === true ? 0 : current.misses + 1;
            schedule();
            return outcome.line;
          }
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

/** Unref'd: a deadline still pending must never hold the extension host open. */
function defaultWait(ms: number): Deadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return {
    elapsed,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
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
