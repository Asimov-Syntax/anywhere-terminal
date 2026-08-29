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

const UNIT = "\u0000";
const RECORD = "\u0001";

/** One string per distinct attribution, insertion order ignored. */
export function attributionKey(attribution: PaneAttribution): string {
  return [...attribution]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([paneId, worktreeId]) => `${paneId}${UNIT}${worktreeId}`)
    .join(RECORD);
}
