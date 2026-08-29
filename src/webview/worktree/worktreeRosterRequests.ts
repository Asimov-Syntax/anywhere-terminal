// src/webview/worktree/worktreeRosterRequests.ts — Who has already been asked
// what a session delegated (worktree-panel-ui § 3.4, design.md D6).
//
// Shared by the tree and the inspector because "at most one request per row and
// session" is a claim about the WINDOW, not about a surface. Two instance-local
// sets would each ask once for the same key, which is two requests for one
// answer — and the second surface would then also have to re-implement the
// eviction below.
//
// Requests are queued and dispatched separately. `renderListing` warns that a
// dependency answering synchronously would re-enter a half-built render and
// place every notice twice; asking from inside the render loop is what made that
// only-theoretical. Collect during the render, dispatch after the DOM is
// committed, and the hazard stops depending on how the host happens to answer.

import type { WorktreeAgentRow } from "./worktreeViewTypes";

/**
 * One row's session, as the host keys its roster. Absent → nothing to ask for.
 *
 * A low control char separates the two: it cannot appear in either, so two
 * different pairs can never join into one key. The row id alone is not enough: the same pane can carry a different session
 * after a resume, and that is a different roster.
 */
export function rosterKey(row: WorktreeAgentRow): string | undefined {
  return row.entryId === undefined ? undefined : `${row.rowId}\u0000${row.entryId}`;
}

export class RosterRequests {
  private readonly asked = new Set<string>();
  /** Queued this render, keyed so one row wanted twice is asked once. */
  private pending = new Map<string, WorktreeAgentRow>();

  /** Ask for `row`'s roster, unless it has been asked already. */
  want(row: WorktreeAgentRow): void {
    const key = rosterKey(row);
    if (key === undefined || this.asked.has(key)) {
      return;
    }
    this.asked.add(key);
    this.pending.set(key, row);
  }

  /** Send what `want` queued. Call AFTER the DOM this render built is in place. */
  flush(send: (row: WorktreeAgentRow) => void): void {
    if (this.pending.size === 0) {
      return;
    }
    // Swapped before sending: `send` reaches the host, and a synchronous answer
    // would otherwise re-enter this while it is still iterating what it sent.
    const queued = this.pending;
    this.pending = new Map();
    for (const row of queued.values()) {
      send(row);
    }
  }

  /**
   * Forget keys that are no longer live.
   *
   * A row that left and returned under the same identity has had its roster
   * evicted host-side, so a set that remembers asking leaves it on "Reading…"
   * with nothing coming.
   */
  reconcile(liveKeys: ReadonlySet<string>): void {
    for (const key of this.asked) {
      if (!liveKeys.has(key)) {
        this.asked.delete(key);
      }
    }
  }
}
