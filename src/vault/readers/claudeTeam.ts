// src/vault/readers/claudeTeam.ts — Claude multi-agent TEAM threading
// (nest-workflow-team-sessions D5/D13/D14/D16). Conceptually separate from basic
// Claude session reading: parse `<teammate-message>` coordination tags, decide
// team membership, scan member siblings, and thread per-turn communication into
// the leader's timeline.

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { boundedPreview } from "../preview";
import { formatEntryId, type VaultSessionDetail, type VaultTimelineItem } from "../types";
import { formatTeamTurnSessionId } from "./claudeChildIds";
import { type ClaudeReaderOptions, isSafeSessionId, resolveClaudeSessionPath } from "./claudePaths";
import { coerceTimestamp, extractUserText, rawUserText } from "./claudeRecords";
import { classifyClaudeStyleEvents, createBoundedRecordBuffer, finalizeDetail, MAX_TIMELINE_ITEMS } from "./detail";

/**
 * The SINGLE team-member predicate (D5, review W2): a record carries a team
 * identity iff it has BOTH a non-empty `agentName` and `teamName`. Membership is
 * decided on the session's FIRST text-bearing, non-meta, non-sidechain user
 * record — used identically by the list-exclusion path (`parseClaudeFile`) and
 * the grouping path (`readTeamMemberInfo`) so a session can never be both listed
 * and grouped.
 */
export function recordTeamIdentity(obj: Record<string, unknown>): { agentName: string; teamName: string } | null {
  const an = obj.agentName;
  const tn = obj.teamName;
  if (typeof an === "string" && an.trim() !== "" && typeof tn === "string" && tn.trim() !== "") {
    return { agentName: an.trim(), teamName: tn.trim() };
  }
  return null;
}

/**
 * A team coordination tag: `<teammate-message teammate_id="X" color? summary?>
 * BODY</teammate-message>`. In a MEMBER file each incoming message is one such
 * record (the turn boundary, D14); in the LEADER file the delivered replies carry
 * the member's `color`. `teammateId="team-lead"` ⇒ from the leader, otherwise a
 * peer member. Returns null when the text carries no tag.
 */
function parseTeammateTag(
  text: string,
): { teammateId: string; from: "leader" | "peer"; body: string; color?: string; summary?: string } | null {
  const open = /<teammate-message\b([^>]*)>/.exec(text);
  if (!open) {
    return null;
  }
  const attrs = open[1];
  const id = /\bteammate_id="([^"]*)"/.exec(attrs)?.[1];
  if (!id) {
    return null;
  }
  const after = text.slice(open.index + open[0].length);
  const closeAt = after.indexOf("</teammate-message>");
  const body = (closeAt >= 0 ? after.slice(0, closeAt) : after).trim();
  const color = /\bcolor="([^"]*)"/.exec(attrs)?.[1];
  const summary = /\bsummary="([^"]*)"/.exec(attrs)?.[1];
  return {
    teammateId: id,
    from: id === "team-lead" ? "leader" : "peer",
    body,
    ...(color ? { color } : {}),
    ...(summary ? { summary } : {}),
  };
}

/**
 * Adapter passed to {@link classifyClaudeStyleEvents} so an incoming
 * `<teammate-message …>` `user` record is emitted as a `teammateMessage` item
 * (clean body + sender) rather than a raw "USER" bubble (D16). Reuses the single
 * source of truth `parseTeammateTag`; null when the text bears no tag.
 */
export function teammateMessageHook(
  rawText: string,
): { agentName: string; from: string; color?: string; body: string } | null {
  const tag = parseTeammateTag(rawText);
  if (!tag) {
    return null;
  }
  // Fall back to the tag's `summary` when the body is empty (a notification-style
  // `<teammate-message summary="…"></teammate-message>`): without this the empty
  // body unwraps to nothing and the record is dropped from BOTH the teammate path
  // and the plain-message path — a silent omission of a real on-disk message (R5).
  // Mirrors collectMemberTurns' `body || summary` preview.
  const body = tag.body || tag.summary || "";
  return { agentName: tag.teammateId, from: tag.from, ...(tag.color ? { color: tag.color } : {}), body };
}

/** A teammate-message turn boundary on a parsed record, or null. A boundary is a
 *  non-meta `user` record whose text bears a `<teammate-message>` tag. */
function teammateBoundary(rec: Record<string, unknown>): ReturnType<typeof parseTeammateTag> {
  if (rec.type !== "user" || rec.isMeta === true) {
    return null;
  }
  const text = rawUserText((rec as { message?: unknown }).message);
  return text ? parseTeammateTag(text) : null;
}

/**
 * A streaming side-collector for a parent session's team context (review W3/N1):
 * the `teamName`s it recorded (collected across the whole stream) and whether it
 * is itself a non-lead member (decided on the first text-bearing user record, the
 * same predicate as the list/grouping paths). Pass `.onRecord` to
 * `streamClaudeRecords`, then read `.ctx`. Centralizes the predicate so the
 * parent-detail path and the team-group resolver agree on leadership.
 */
export function teamContextCollector(): {
  ctx: { teamNames: Set<string>; selfIsMember: boolean; colorByMember: Map<string, string> };
  onRecord: (rec: Record<string, unknown>) => void;
} {
  const ctx = { teamNames: new Set<string>(), selfIsMember: false, colorByMember: new Map<string, string>() };
  let firstUserSeen = false;
  return {
    ctx,
    onRecord: (rec) => {
      if (typeof rec.teamName === "string" && rec.teamName.trim() !== "") {
        ctx.teamNames.add(rec.teamName.trim());
      }
      // Leader-side delivered replies carry the member's color
      // (`<teammate-message teammate_id="X" color="Y">`) — collect a member→color
      // map so the thread highlights each teammate consistently (D14). First write
      // wins; `team-lead` is the leader itself (no member color).
      const tag = teammateBoundary(rec);
      if (tag && tag.teammateId !== "team-lead" && tag.color && !ctx.colorByMember.has(tag.teammateId)) {
        ctx.colorByMember.set(tag.teammateId, tag.color);
      }
      if (!firstUserSeen && rec.type === "user" && rec.isMeta !== true && rec.isSidechain !== true) {
        if (extractUserText(rec)) {
          firstUserSeen = true;
          ctx.selfIsMember = recordTeamIdentity(rec) !== null;
        }
      }
    },
  };
}

/**
 * Open ONE communication turn of a member session (D12): the records from the
 * n-th `<teammate-message>` boundary up to the next boundary (or EOF) — i.e. from
 * receiving the request through the member's response. The member file is located
 * by id under the projects root (containment-checked); only the target window is
 * retained (boundaries elsewhere are counted, not buffered). An out-of-range turn
 * or unsafe id → null. View-only: the `:turn:` id is never launchable.
 */
export async function readClaudeTeamSegment(
  memberId: string,
  turn: number,
  options: ClaudeReaderOptions,
  limit: number | undefined,
): Promise<VaultSessionDetail | null> {
  if (!isSafeSessionId(memberId) || !Number.isInteger(turn) || turn < 0) {
    return null;
  }
  const filePath = await resolveClaudeSessionPath(memberId, options);
  if (!filePath) {
    return null;
  }
  // A single turn (a long-running member's whole response between two boundaries)
  // can span most of the file, so the collected window is head+tail bounded like
  // any detail read (R5) — never the full remainder materialized at once.
  const buffer = createBoundedRecordBuffer();
  let boundaryCount = 0;
  let collecting = false;
  let found = false;
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let rec: Record<string, unknown>;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object") {
          continue;
        }
        rec = parsed as Record<string, unknown>;
      } catch {
        continue; // skip a corrupt line, keep counting (D8)
      }
      if (teammateBoundary(rec) !== null) {
        if (boundaryCount === turn) {
          collecting = true;
          found = true;
        } else if (collecting) {
          break; // reached the next boundary — the target turn ends here
        }
        boundaryCount++;
      }
      if (collecting) {
        buffer.push(rec);
      }
    }
  } catch {
    return null;
  } finally {
    rl?.close();
    stream?.destroy();
  }
  if (!found) {
    return null; // turn out of range
  }
  const { records, truncated } = buffer.result();
  const detail = classifyClaudeStyleEvents(records, {
    limit,
    includeSidechain: true,
    teammateMessage: teammateMessageHook,
  });
  return finalizeDetail(formatEntryId("claude", formatTeamTurnSessionId(memberId, turn)), detail, truncated);
}

/** A discovered non-lead team member (sibling session sharing a `teamName`). */
interface TeamMemberInfo {
  sessionId: string;
  agentName: string;
  teamName: string;
  /** First user text (collapsed-block preview for the member node). */
  firstMessage?: string;
  /** First-record timestamp (coerced; placement of the team group). */
  timestamp?: number;
}

/**
 * Read a sibling session's team identity, decided on its FIRST text-bearing,
 * non-meta, non-sidechain user record — the EXACT same record + predicate the
 * list-exclusion path uses (W2), so a session can't be both listed and grouped.
 * Returns null when that record carries no team identity (not a member). Bounded
 * to that first user record — a non-member is never read to EOF.
 */
async function readTeamMemberInfo(filePath: string, sessionId: string): Promise<TeamMemberInfo | null> {
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  let result: TeamMemberInfo | null = null;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let obj: Record<string, unknown>;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object") {
          continue;
        }
        obj = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      if (obj.type !== "user" || obj.isMeta === true || obj.isSidechain === true) {
        continue;
      }
      const text = extractUserText(obj);
      if (!text) {
        continue; // a pure tool_result user record is not the identity record
      }
      // First identity record reached: membership is decided here and nowhere else.
      const identity = recordTeamIdentity(obj);
      if (identity) {
        result = {
          sessionId,
          agentName: identity.agentName,
          teamName: identity.teamName,
          firstMessage: text,
          timestamp: coerceTimestamp(obj.timestamp),
        };
      }
      break;
    }
  } catch {
    return null;
  } finally {
    rl?.close();
    stream?.destroy();
  }
  return result;
}

/**
 * Scan a project dir for the parent's team members: each OTHER `<id>.jsonl`
 * whose first identity record's `teamName` is one the parent participated in.
 * Returns members grouped by `teamName`. Drives the threaded teammate timeline
 * (buildTeamThread, D14).
 */
async function scanTeamMembers(
  projectDir: string,
  parentId: string,
  teamNames: Set<string>,
): Promise<Map<string, TeamMemberInfo[]>> {
  const byTeam = new Map<string, TeamMemberInfo[]>();
  if (teamNames.size === 0) {
    return byTeam;
  }
  let files: string[];
  try {
    files = await fs.readdir(projectDir);
  } catch {
    return byTeam;
  }
  for (const name of files) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const stem = name.slice(0, -".jsonl".length);
    if (stem === parentId || !isSafeSessionId(stem)) {
      continue;
    }
    const info = await readTeamMemberInfo(path.join(projectDir, name), stem);
    if (!info || !teamNames.has(info.teamName)) {
      continue;
    }
    const arr = byTeam.get(info.teamName) ?? [];
    arr.push(info);
    byTeam.set(info.teamName, arr);
  }
  return byTeam;
}

/** Fixed accent palette for members whose color the leader never recorded (D14).
 *  Names map to concrete CSS colors webview-side; raw names are also accepted. */
const TEAMMATE_PALETTE = ["blue", "green", "yellow", "purple", "cyan", "orange", "pink", "red"] as const;

/** One incoming-message turn discovered in a member file. */
interface MemberTurn {
  idx: number;
  from: string; // "leader" | "<peerName>"
  preview: string;
  timestamp: number;
}

/** Stream a member file once and emit one {@link MemberTurn} per
 *  `<teammate-message>` boundary (D14). Retains only per-boundary metadata, never
 *  the full transcript. */
async function collectMemberTurns(filePath: string): Promise<MemberTurn[]> {
  const turns: MemberTurn[] = [];
  let idx = 0;
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let rec: Record<string, unknown>;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object") {
          continue;
        }
        rec = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const tag = teammateBoundary(rec);
      if (tag) {
        turns.push({
          idx,
          from: tag.from === "leader" ? "leader" : tag.teammateId,
          preview: tag.body || tag.summary || "",
          timestamp: coerceTimestamp(rec.timestamp) ?? 0,
        });
        idx++;
        // Keep only the most-recent window in memory (R5). `idx` keeps counting,
        // so each retained turn's true boundary ordinal — the `:turn:<n>` id used
        // to re-open it — is unchanged; only old, beyond-the-cap turns are dropped
        // (they would not survive the leader timeline's final tail bound anyway).
        if (turns.length > MAX_TIMELINE_ITEMS) {
          turns.shift();
        }
      }
    }
  } catch {
    return turns; // partial is fine — defensive (D8)
  } finally {
    rl?.close();
    stream?.destroy();
  }
  return turns;
}

/**
 * Peer-aware team thread (D14): scan each member sibling of the leader and emit a
 * `teammateTurn` per incoming `<teammate-message>` boundary. `from` is `"leader"`
 * (sender `team-lead`) or the peer member name; `color` comes from the leader's
 * delivered-reply records, else a fixed palette by index. Each message is recorded
 * once (in its recipient's file), so leader↔member AND member↔member turns are
 * covered with no double-count. Empty when the leader recorded no `teamName`
 * (gated by the caller). Returned UNSORTED — the caller merges by timestamp.
 */
export async function buildTeamThread(
  leaderPath: string,
  teamNames: Set<string>,
  colorByMember: Map<string, string>,
): Promise<VaultTimelineItem[]> {
  if (teamNames.size === 0) {
    return [];
  }
  const projectDir = path.dirname(leaderPath);
  const leaderId = path.basename(leaderPath).replace(/\.jsonl$/, "");
  const byTeam = await scanTeamMembers(projectDir, leaderId, teamNames);
  const items: VaultTimelineItem[] = [];
  let paletteIdx = 0;
  for (const members of byTeam.values()) {
    for (const m of members) {
      let color = colorByMember.get(m.agentName);
      if (!color) {
        color = TEAMMATE_PALETTE[paletteIdx % TEAMMATE_PALETTE.length];
        paletteIdx++;
      }
      const turns = await collectMemberTurns(path.join(projectDir, `${m.sessionId}.jsonl`));
      for (const t of turns) {
        items.push({
          kind: "teammateTurn",
          entryId: formatEntryId("claude", formatTeamTurnSessionId(m.sessionId, t.idx)),
          agentName: m.agentName,
          ...(color ? { color } : {}),
          from: t.from,
          preview: boundedPreview(t.preview),
          timestamp: t.timestamp,
        });
      }
    }
  }
  // Globally bound the thread before it is merged into the leader timeline (R5):
  // each member is already tail-capped, but a many-member team could still sum to
  // a large array. Keep the most-recent window by timestamp — exactly the slice
  // the caller's final tail bound would retain anyway.
  if (items.length > MAX_TIMELINE_ITEMS) {
    items.sort(
      (a, b) => ((a as { timestamp?: number }).timestamp ?? 0) - ((b as { timestamp?: number }).timestamp ?? 0),
    );
    return items.slice(items.length - MAX_TIMELINE_ITEMS);
  }
  return items;
}
