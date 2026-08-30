// src/worktree/sessionViews.ts — The two views one registry scan yields.
// See: asimov/changes/prove-nobody-is-using-this-worktree/design.md D3

import { type ClaudeSessionRecord, canonicalLiveSessions } from "../vault/readers/runningSessions";
import { formatEntryId } from "../vault/types";
import type { SessionRead } from "./worktreeBlockers";

/** Resolves a cwd to its real path, or answers the spelling it was given. */
export interface SessionPathResolver {
  prepare(paths: readonly string[]): Promise<void>;
  resolvedOr(path: string): string;
}

/**
 * Both views the removal path needs, from ONE read.
 *
 * Its own module rather than a closure in `extension.ts` because it is the seam
 * every other test injects past: the blocker and proof suites are handed an
 * already-correct pair, so a composition that swapped the views, dropped
 * `partial`, or resumed resolving dead records left the suite green
 * (round-2 W3).
 *
 * `live` is undeduped: the ownership proof asks whether ANY live process is
 * rooted here, and a duplicate that loses the canonical selection is still a
 * live pid in that directory. `canonical` is the winner per session id chosen
 * over every live record user-wide, BEFORE anything asks about containment —
 * that order is what the refusal needs and cannot reconstruct itself (B2).
 */
export async function composeSessionViews(
  records: readonly ClaudeSessionRecord[],
  partial: boolean,
  paths: SessionPathResolver,
): Promise<SessionRead> {
  const live = records.filter((record) => record.alive);
  const canonicalPids = new Set(canonicalLiveSessions(records).map((session) => session.pid));
  // Only the live ones. A dead crash record is inert in both views, so
  // realpathing user-wide stale session history was unbounded work for an
  // answer nobody reads (round-1 B3a).
  await paths.prepare(live.map((record) => record.cwd));
  const asRecord = (record: ClaudeSessionRecord) => ({
    sessionId: record.sessionId,
    entryId: formatEntryId("claude", record.sessionId),
    cwd: paths.resolvedOr(record.cwd),
    // The registry records pid, cwd and identity — never activity. So this is
    // undefined rather than a guess, and undefined refuses: a session we cannot
    // ask about is not evidence of idleness (worktree-removal.md § 3).
    activity: undefined,
    alive: record.alive,
  });
  return {
    live: live.map(asRecord),
    canonical: live.filter((record) => canonicalPids.has(record.pid)).map(asRecord),
    partial,
  };
}
