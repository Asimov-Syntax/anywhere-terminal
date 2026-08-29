// src/webview/worktree/worktreeFormat.ts — Pure, DOM-free derivations for the
// Worktree view: the age clock, the branch label, which markers a row earns, and
// how agent rows group by state. No `this`, no side effects — independently
// unit-testable, mirroring src/webview/vault/format.ts.

import type { WorktreeActivity, WorktreeActivitySource, WorktreeAgentRow, WorktreeInfo } from "./worktreeViewTypes";

/**
 * Decorative animation frames agents print in front of a pane title. Stripped
 * before display AND before the render signature, so a spinner tick can never
 * repaint the tree at animation rate (worktree-panel-ui § 4.6).
 *
 * The host strips these too (worktree-agent-presence § 3.4); the view repeats it
 * because the signature guard is only as honest as its own input.
 */
const GLYPH_FRAMES = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒◜◝◞◟✻✽✢✶✳*\s]+/;

/**
 * `|`, `/`, `\` and `-` are also spinner frames, but they are ordinary title
 * characters too — a title that starts `/Users/…` is a path, not an animation. Only
 * a lone one followed by whitespace is treated as a frame.
 */
const ASCII_FRAME = /^[|/\\-]\s+/;

/** Drop a leading run of decorative frames. A title that is ONLY frames becomes "". */
export function stripDecorations(title: string | undefined): string {
  if (!title) {
    return "";
  }
  return title.replace(GLYPH_FRAMES, "").replace(ASCII_FRAME, "").trim();
}

/**
 * Which clock the age column reads, per activity (worktree-panel-ui § 3.3):
 * a finished row counts from when it finished, a working row from when the
 * current state began. Conflating them lets a stale row rank as freshly done.
 */
export function ageTimestamp(row: WorktreeAgentRow): number | undefined {
  if (row.activity === "running" || row.activity === "waiting") {
    return row.stateStartedAt ?? row.lastActivityAt ?? row.startedAt;
  }
  return row.finishedAt ?? row.lastActivityAt ?? row.stateStartedAt ?? row.startedAt;
}

/**
 * Fixed-width relative age: `now` / `5m` / `1h` / `3d` / `Jan 5`. Deliberately
 * terser than the vault list's `5m ago` — this column is a stable right edge that
 * titles truncate against, so every extra character costs title width.
 */
export function compactAge(epochMs: number | undefined, now: number = Date.now()): string {
  if (epochMs === undefined || !Number.isFinite(epochMs) || epochMs <= 0) {
    return "";
  }
  const diff = now - epochMs;
  if (diff < 0) {
    return "";
  }
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) {
    return "now";
  }
  if (diff < hour) {
    return `${Math.floor(diff / min)}m`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)}h`;
  }
  if (diff < 7 * day) {
    return `${Math.floor(diff / day)}d`;
  }
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The row's primary label: branch name, else the short sha, else `bare`. */
export function branchLabel(info: WorktreeInfo): { text: string; variant: "branch" | "sha" | "bare" } {
  if (info.bare) {
    return { text: "bare", variant: "bare" };
  }
  if (info.branch) {
    return { text: info.branch, variant: "branch" };
  }
  if (info.detached && info.head) {
    return { text: info.head.slice(0, 7), variant: "sha" };
  }
  // Detached with no commit yet (unborn) — there is no identity to shorten.
  return { text: info.detached ? "detached" : "(no branch)", variant: "sha" };
}

/** Pills name WHICH worktree this is. Never mixed with the state badges. */
export function worktreePills(info: WorktreeInfo): { text: string; kind: "main" | "open" }[] {
  const pills: { text: string; kind: "main" | "open" }[] = [];
  if (info.kind === "main") {
    pills.push({ text: "main", kind: "main" });
  }
  if (info.inWorkspace) {
    pills.push({ text: "open", kind: "open" });
  }
  return pills;
}

export type WorktreeBadgeKind = "locked" | "missing" | "prunable";

/**
 * Badges say HOW the worktree is. `missing` outranks `prunable` — a directory
 * that is gone is the fact worth reading; its registration being stale follows.
 */
export function worktreeBadges(info: WorktreeInfo): { kind: WorktreeBadgeKind; title?: string }[] {
  const badges: { kind: WorktreeBadgeKind; title?: string }[] = [];
  if (info.locked) {
    badges.push({ kind: "locked", title: info.lockReason ? `locked: ${info.lockReason}` : "locked" });
  }
  if (info.missing) {
    badges.push({ kind: "missing" });
  } else if (info.prunable) {
    badges.push({ kind: "prunable" });
  }
  return badges;
}

/** Loudest first: the state that needs a human wins the worktree row's glyph. */
const ACTIVITY_STRENGTH: readonly WorktreeActivity[] = ["waiting", "running", "idle", "exited"];

/**
 * The strongest state among a worktree's agents (§ 7.2). One waiting agent among
 * four running ones reads as waiting, because that is the one a human must act on.
 * Returns undefined for a worktree with no agents — that row keeps its branch glyph.
 */
export function strongestActivity(rows: readonly WorktreeAgentRow[]): WorktreeActivity | undefined {
  for (const activity of ACTIVITY_STRENGTH) {
    if (rows.some((r) => r.activity === activity)) {
      return activity;
    }
  }
  return undefined;
}

/** Icons carried per state group before the pill overflows to a count. */
export const PRESENCE_ICONS_PER_GROUP = 3;

export interface PresenceGroup {
  activity: WorktreeActivity;
  /** Up to PRESENCE_ICONS_PER_GROUP agent ids; a row with unproven identity contributes none. */
  agents: string[];
  /** Rows in this group beyond the ones whose icon is drawn. */
  overflow: number;
}

/**
 * Group the collapsed pill by state first, identity second — "2 waiting, 1 working"
 * is the question a user scanning the list is asking. Overflow is a count rather
 * than smaller icons, so nine agents occupy the same height as two.
 */
export function groupPresenceByActivity(rows: readonly WorktreeAgentRow[]): PresenceGroup[] {
  const groups: PresenceGroup[] = [];
  for (const activity of ACTIVITY_STRENGTH) {
    const inGroup = rows.filter((r) => r.activity === activity);
    if (inGroup.length === 0) {
      continue;
    }
    const agents: string[] = [];
    for (const row of inGroup) {
      if (agents.length >= PRESENCE_ICONS_PER_GROUP) {
        break;
      }
      // No icon without a proven identity (§ 4.4) — an unproven row still counts
      // toward the group, it just contributes no glyph.
      if (row.agent && row.agentSource !== "none" && row.agentSource !== "title") {
        agents.push(row.agent);
      }
    }
    groups.push({ activity, agents, overflow: inGroup.length - agents.length });
  }
  return groups;
}

/** `agentSource` is authoritative for `launch` / `process` / `registry` / `report` only. */
export function hasProvenIdentity(row: WorktreeAgentRow): boolean {
  return (
    row.agent !== undefined &&
    (row.agentSource === "launch" ||
      row.agentSource === "process" ||
      row.agentSource === "registry" ||
      row.agentSource === "report")
  );
}

/** `activitySource` is authoritative for `hook` / `registry`; everything else is a fallback. */
export function isFallbackActivity(source: WorktreeActivitySource): boolean {
  return source !== "hook" && source !== "registry";
}

/** Title shown on an agent row: the stripped pane title, else the raw one, else a placeholder. */
export function agentRowTitle(row: WorktreeAgentRow): string {
  return stripDecorations(row.title) || "(untitled)";
}

/**
 * Row tooltip: branch on the first line, the path git reported on the second —
 * the path is never a row element (§ 3.2), so this is one of the two places it lives.
 */
export function worktreeTooltip(info: WorktreeInfo): string {
  const lines = [branchLabel(info).text, info.displayPath];
  if (info.locked && info.lockReason) {
    lines.push(`locked: ${info.lockReason}`);
  }
  if (info.missing) {
    lines.push("directory is missing");
  }
  return lines.join("\n");
}

/** Plural-safe `N agents` header text. */
export function agentCountLabel(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"}`;
}
