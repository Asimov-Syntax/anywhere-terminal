// src/webview/paneAttribution.ts — pane→worktree attribution, and its one canonical form.
//
// Two places decide whether attribution "moved": the controller, which suppresses
// a duplicate report, and the coordinator, which suppresses a duplicate render.
// They were byte-identical copies of the same encoding, which is one edit away
// from disagreeing about the same question (round-1 W3).

/**
 * paneId → worktreeId. An ABSENT key means the evidence does not place that pane,
 * which is presented in every scope; there is no third value, because one would
 * invite a fourth outcome (design.md D2).
 */
export type PaneAttribution = ReadonlyMap<string, string>;

/**
 * One presence scan's answer about panes, reported together (design.md D1).
 *
 * Together rather than in two calls: both halves come out of the same walk, and
 * the seam renders synchronously inside the controller's delivery — two callbacks
 * would mean two draws for one scan, and a window in which the badge counts panes
 * the filter has already stopped agreeing about.
 */
export interface PaneReport {
  /** paneId → worktreeId, as `PaneAttribution` above. */
  placement: PaneAttribution;
  /** Panes presence says are waiting on a human. Independent of placement. */
  waiting: ReadonlySet<string>;
}

const UNIT = "\u0000";
const RECORD = "\u0001";

/** One string per distinct attribution, insertion order ignored. */
export function attributionKey(attribution: PaneAttribution): string {
  return [...attribution]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([paneId, worktreeId]) => `${paneId}${UNIT}${worktreeId}`)
    .join(RECORD);
}

/** One string per distinct waiting set, insertion order ignored. */
export function waitingKey(waiting: ReadonlySet<string>): string {
  return [...waiting].sort().join(RECORD);
}
