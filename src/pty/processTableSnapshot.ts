// src/pty/processTableSnapshot.ts — One process-table read, shared by every
// caller inside a window.
//
// Exists for two reasons `descendantPids` cannot serve:
//
//   - It shares the in-flight read, so resolving N panes costs one `ps` rather
//     than N.
//   - It reports failure AS failure. `descendantPids` maps a missing `ps`, a
//     timeout, and "this pid has no children" all to `[]`, so a caller cannot
//     tell "no agent here" from "we could not look" — and a presence row that
//     cannot tell those apart silently downgrades a proven agent to a plain
//     terminal on a transient timeout. Same outcome shape as repoRoots.ts.
//
// The TTL paces repeat reads; it never defines a rebuild boundary (design.md D9).
//
// See: docs/design/worktree-agent-presence.md § 7;
//      asimov/changes/project-worktree-agent-presence/design.md D9, D10.

import {
  collectDescendants,
  defaultProcessTreeDeps,
  type ProcessTreeDeps,
  PS_TIMEOUT_MS,
  parseProcessTable,
  psTableArgs,
} from "./processTree";

/** How long one read is reused before another is allowed. */
export const DEFAULT_SNAPSHOT_TTL_MS = 1_000;

/**
 * What a descendant lookup can conclude.
 *
 * `ok` with an empty list is a real answer — this pid has no children. It is
 * NOT the same claim as `unsupported` or `failed`, and collapsing the three is
 * the bug this type exists to make unrepresentable.
 */
export type DescendantsOutcome =
  | { kind: "ok"; pids: readonly number[] }
  | { kind: "unsupported" }
  | { kind: "failed"; reason: string };

/**
 * One process table, already read, answering from that read alone.
 *
 * The TTL paces repeat reads; it cannot bound a rebuild. Pane resolutions are
 * sequential and awaited, so a projection slow enough to cross the TTL between
 * two panes issues a second `ps` — and resolves those two panes against
 * different moments. Pinning the table is what makes "one read per rebuild" an
 * absolute bound rather than a usually (.reviews/round-1.md B2).
 */
export interface ProcessTableReading {
  descendantsOf(rootPid: number): DescendantsOutcome;
}

export interface ProcessTableSnapshot {
  descendantsOf(rootPid: number): Promise<DescendantsOutcome>;
  /** Take one table now; every lookup on the result derives from it. */
  open(): Promise<ProcessTableReading>;
}

export interface ProcessTableSnapshotOptions {
  /** Reuse window for one read. Defaults to `DEFAULT_SNAPSHOT_TTL_MS`. */
  ttlMs?: number;
  now?(): number;
  exec?: ProcessTreeDeps["exec"];
  platform?: NodeJS.Platform;
}

/** What one completed read produced — a parsed table, or why there isn't one. */
type TableOutcome = { kind: "ok"; table: Map<number, number[]> } | { kind: "failed"; reason: string };

function describeExecFailure(err: unknown): string {
  if (err instanceof Error && err.message) {
    return `\`ps\` failed: ${err.message}`;
  }
  return "`ps` failed for an unknown reason.";
}

export function createProcessTableSnapshot(options: ProcessTableSnapshotOptions = {}): ProcessTableSnapshot {
  const ttlMs = options.ttlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
  const now = options.now ?? Date.now;
  const platform = options.platform ?? process.platform;
  const run = options.exec ?? defaultProcessTreeDeps.exec;

  let inFlight: Promise<TableOutcome> | undefined;
  /** The last SUCCESSFUL read and when it landed. A failure caches nothing. */
  let cached: { table: Map<number, number[]>; at: number } | undefined;

  async function read(args: string[]): Promise<TableOutcome> {
    try {
      const { stdout } = await run("ps", args, { timeout: PS_TIMEOUT_MS });
      return { kind: "ok", table: parseProcessTable(stdout) };
    } catch (err) {
      return { kind: "failed", reason: describeExecFailure(err) };
    }
  }

  async function table(args: string[]): Promise<TableOutcome> {
    if (cached && now() - cached.at < ttlMs) {
      return { kind: "ok", table: cached.table };
    }
    // A read already running is the read this caller wants: starting a second
    // would defeat the whole point of the snapshot.
    if (!inFlight) {
      inFlight = read(args).then((outcome) => {
        // Only a success is cached. Caching a failure would hold the window
        // open on an answer that is not an answer, and the next rebuild —
        // which is the one that would have recovered — would be served it.
        if (outcome.kind === "ok") {
          cached = { table: outcome.table, at: now() };
        }
        inFlight = undefined;
        return outcome;
      });
    }
    return inFlight;
  }

  /** Shared by both entry points so they cannot disagree about a pid. */
  function lookup(rootPid: number, outcome: TableOutcome | { kind: "unsupported" }): DescendantsOutcome {
    if (!Number.isInteger(rootPid) || rootPid <= 0) {
      // Conclusive: no such process, therefore no descendants. Not a failure
      // to look — there was nothing to look for.
      return { kind: "ok", pids: [] };
    }
    if (outcome.kind !== "ok") {
      return outcome;
    }
    return { kind: "ok", pids: collectDescendants(rootPid, outcome.table) };
  }

  async function readTable(): Promise<TableOutcome | { kind: "unsupported" }> {
    const args = psTableArgs(platform);
    return args === undefined ? { kind: "unsupported" } : table(args);
  }

  return {
    async descendantsOf(rootPid) {
      // Short-circuited before the read: an invalid pid is answered without
      // asking the platform anything.
      if (!Number.isInteger(rootPid) || rootPid <= 0) {
        return { kind: "ok", pids: [] };
      }
      return lookup(rootPid, await readTable());
    },

    async open() {
      const outcome = await readTable();
      return { descendantsOf: (rootPid) => lookup(rootPid, outcome) };
    },
  };
}
