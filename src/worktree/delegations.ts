// src/worktree/delegations.ts — One session's transcript, as the delegations it
// recorded. See: docs/design/worktree-agent-presence.md § 3.6;
//      asimov/changes/surface-subagent-history-rows/design.md D5, D6, D7.
//
// This is where "what the source recorded" becomes "what presence claims", so
// the mapping's whole job is refusing to claim more: never live, never complete
// on the absence of evidence, and never an outcome the transcript did not state.

import type { VaultSessionDetail } from "../vault/types";
import type { DelegationRoster, WorktreeSubagentRow } from "./presenceTypes";

/**
 * The delegations one session detail recorded.
 *
 * Both timeline kinds count. A `Task` call whose child transcript was matched is
 * folded into a `subagentSession`; one that was not stays a plain `subagent`
 * step — a delegation that happened, with nothing to open. Taking only the
 * richer kind would drop exactly the delegations whose evidence is thinnest, and
 * a timeline carries one item per call, so the two cannot double-count one.
 *
 * Nesting stays one level: a child's own delegations are never read (§ 3.6).
 */
export function rosterFromDetail(detail: VaultSessionDetail): DelegationRoster {
  const rows: WorktreeSubagentRow[] = [];
  for (const item of detail.timeline) {
    if (item.kind === "subagentSession") {
      rows.push({
        name: item.agent ?? item.title,
        ...(item.title !== undefined ? { title: item.title } : {}),
        status: item.status ?? "unknown",
        live: false,
        ...(item.entryId !== undefined ? { entryId: item.entryId } : {}),
      });
    } else if (item.kind === "subagent") {
      // `title` OR `prompt`: neither producer sets `title` on the unmatched path
      // — both emit the delegated task as `prompt` (detail.ts, opencodeReader.ts).
      // Reading only `title` would leave exactly the delegations with the least
      // evidence showing a role name where the task belongs (design.md D6).
      const label = item.title ?? item.prompt;
      rows.push({
        name: item.name,
        ...(label !== undefined ? { title: label } : {}),
        status: item.status ?? "unknown",
        live: false,
      });
    }
  }
  return { kind: "ok", rows, ...(incomplete(detail, rows.length) ? { incomplete: true } : {}) };
}

/**
 * Did anything the reader reported prove it withheld delegations?
 *
 * Three independent signals, none of which can prove the opposite: an equal
 * count is consistent with a reader that undercounted, so "complete" is only
 * ever the absence of evidence of omission (design.md D5).
 *
 * `truncated` counts here where it would not elsewhere: the read asks for the
 * reader's maximum, so "a larger limit would return more" names an omission
 * nothing at this seam can recover.
 */
function incomplete(detail: VaultSessionDetail, mapped: number): boolean {
  return detail.partial === true || detail.truncated === true || detail.stats.subagentCount > mapped;
}
