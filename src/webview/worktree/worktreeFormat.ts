// src/webview/worktree/worktreeFormat.ts — Pure, DOM-free derivations for the
// Worktree view: the age clock, the branch label, which markers a row earns, and
// how agent rows group by state. No `this`, no side effects — independently
// unit-testable, mirroring src/webview/vault/format.ts.

import { ACTIVITY_EVIDENCE } from "../../worktree/presenceTypes";
import type {
  PresenceDegradation,
  WorktreeActivity,
  WorktreeActivitySource,
  WorktreeAgentRow,
  WorktreeInfo,
} from "./worktreeViewTypes";

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

/**
 * The activity a row is DRAWN with (§ 7.2): the wire vocabulary plus the two states
 * the view derives. Presentation only — derived on every render, never stored and
 * never sent.
 */
export type PresentedActivity = WorktreeActivity | "unknown" | "running-unconfirmed";

/**
 * How long an inferred `running` may stand unchanged before it stops claiming to be
 * confirmed (worktree-activity-ceiling.md § 2).
 */
export const CONFIRMATION_CEILING_MS = 5 * 60_000;

/**
 * `unknown` when no source spoke for the row, or when the source that would have
 * decided it is currently failing. A failed source is labelled, never quietly
 * drawn as `idle` — `idle` is a positive claim that this agent is at rest.
 *
 * Only `WorktreePresence.degradedSources` participates. A repo's own `degraded`
 * flag says the worktree LISTING failed, which is a claim about which worktrees
 * exist rather than about what any agent is doing; reading it here would turn
 * every row in the repo unknown on one failed git listing.
 */
export function presentedActivity(
  row: WorktreeAgentRow,
  degradedSources: readonly PresenceDegradation[],
  now: number,
): PresentedActivity {
  // The mapping is `ACTIVITY_EVIDENCE`, shared with the host so the glyph and
  // delegation decay cannot disagree about which failure undermines which row.
  const deciding: PresenceDegradation["source"] | undefined = ACTIVITY_EVIDENCE[row.activitySource];
  if (deciding === undefined) {
    return "unknown";
  }
  // `unknown` outranks the ceiling: a source that failed cannot support a claim of
  // running at all, so there is nothing left to qualify as unconfirmed.
  if (degradedSources.some((d) => d.source === deciding)) {
    return "unknown";
  }
  return isUnconfirmed(row, now) ? "running-unconfirmed" : row.activity;
}

/**
 * A `running` claim that has outlived what its evidence can support: all three of
 * running, inferred from output, and standing unchanged past the ceiling.
 *
 * The clock is `stateStartedAt`, which moves only when the projected activity
 * CHANGES. It measures how long this row has claimed the same activity — not time
 * since confirmation, which is a different rule needing a field the host does not
 * keep. `lastActivityAt` is the wrong clock and must never be substituted: it
 * advances on every byte, including the bytes of the animation this ceiling exists
 * to see through, so a ceiling built on it would never fire in its own case.
 *
 * An absent clock, or one in the future, is confirmed. Neither is proof of
 * staleness, and a negative age must never manufacture it.
 */
function isUnconfirmed(row: WorktreeAgentRow, now: number): boolean {
  return (
    row.activity === "running" &&
    row.activitySource === "output" &&
    row.stateStartedAt !== undefined &&
    now - row.stateStartedAt >= CONFIRMATION_CEILING_MS
  );
}

/**
 * How long the row has been claiming this activity, for a hint that must not
 * understate it. Undefined when there is no clock to read.
 */
export function unchangedFor(row: WorktreeAgentRow, now: number): number | undefined {
  if (row.stateStartedAt === undefined) {
    return undefined;
  }
  const elapsed = now - row.stateStartedAt;
  return elapsed >= 0 ? elapsed : undefined;
}

/**
 * Every presented state, in display order. This is the EXACT vocabulary: the
 * collapsed pill groups by it, so a state missing from here is a set of rows the
 * pill silently drops.
 */
export const PRESENTED_ORDER: readonly PresentedActivity[] = [
  "waiting",
  "running",
  "running-unconfirmed",
  "unknown",
  "idle",
  "exited",
];

/**
 * Loudest first: the state that needs a human wins the glyph (§ 7.2). `unknown`
 * sits above `idle` — a row nothing could read is a louder fact than one settled
 * at rest — and below `running`, which is still an evidenced claim.
 *
 * A separate order from `PRESENTED_ORDER`, because these answer different
 * questions. `running-unconfirmed` is a confidence ON `running`, not a rank of its
 * own: it sits directly below it, so a worktree holding one confirmed run reads as
 * running, and one whose every run is unconfirmed reads as unconfirmed.
 */
export const PRESENTED_STRENGTH: readonly PresentedActivity[] = [
  "waiting",
  "running",
  "running-unconfirmed",
  "unknown",
  "idle",
  "exited",
];

/**
 * The strongest state among a worktree's agents (§ 7.2). One waiting agent among
 * four running ones reads as waiting, because that is the one a human must act on.
 * Returns undefined for a worktree with no agents — that row keeps its branch glyph.
 *
 * Ranks what is SHOWN, not what was sent: a running row whose source is failing
 * ranks as `unknown`, the same value its own glyph draws.
 */
export function strongestActivity(
  rows: readonly WorktreeAgentRow[],
  degradedSources: readonly PresenceDegradation[],
  now: number,
): PresentedActivity | undefined {
  const presented = rows.map((r) => presentedActivity(r, degradedSources, now));
  for (const activity of PRESENTED_STRENGTH) {
    if (presented.includes(activity)) {
      return activity;
    }
  }
  return undefined;
}

/** Icons carried per state group before the pill overflows to a count. */
export const PRESENCE_ICONS_PER_GROUP = 3;

export interface PresenceGroup {
  activity: PresentedActivity;
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
export function groupPresenceByActivity(
  rows: readonly WorktreeAgentRow[],
  degradedSources: readonly PresenceDegradation[],
  now: number,
): PresenceGroup[] {
  const groups: PresenceGroup[] = [];
  // Grouped on the PRESENTED state: the pill is what a collapsed worktree shows,
  // so a row no source could read must not be counted into `idle` here either.
  const presented = rows.map((r) => [r, presentedActivity(r, degradedSources, now)] as const);
  // The exact vocabulary, not the rank order — a summary that folded unconfirmed
  // into `running` would report a confidence the row does not have.
  for (const activity of PRESENTED_ORDER) {
    const inGroup = presented.filter(([, a]) => a === activity).map(([r]) => r);
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
