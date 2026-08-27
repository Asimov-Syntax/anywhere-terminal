// src/worktree/presenceProjector.scale.test.ts — The presence cost envelope, at the
// fixture size the design publishes. See design.md D2 and
// docs/design/worktree-agent-presence.md § 7.
//
// Counts, not milliseconds. A count is a property of the code and cannot flake; the two
// wall-clock budgets live in `pnpm run bench:scale` instead. The spies sit at the seams of
// the real `createPresenceProjectorDeps`, so what is measured is the production wiring
// rather than a hand-built projector that could be cheap for reasons the product is not.

import { describe, expect, it, vi } from "vitest";
import type { DescendantsOutcome, ProcessTableSnapshot } from "../pty/processTableSnapshot";
import { createPaneEvidenceStore } from "../session/PaneEvidenceStore";
import { PROCESS_TABLE_READS } from "../test/invariants/budgets";
import type { RunningSessionsOutcome } from "../vault/readers/runningSessions";
import { createPresenceProjectorDeps } from "./presenceDeps";
import { createPresenceProjector } from "./presenceProjector";

const NOW = 1_700_000_000_000;
/** worktree-agent-presence.md § 7 publishes the budget at this size; it does not move. */
const WORKTREES = 10;
const PANES = 10;

const worktreeIds = Array.from({ length: WORKTREES }, (_, i) => `/repo/wt-${i}`);

function wireAtScale() {
  const outcome: DescendantsOutcome = { kind: "ok", pids: [] };
  // Spied INSIDE the snapshot, because that is where per-pane resolution work happens:
  // `open` is once per rebuild by design, so counting it cannot see a per-pane regression.
  const descendantsFor = vi.fn(() => outcome);
  const open = vi.fn(async () => ({ descendantsOf: descendantsFor }));
  const descendantsOf = vi.fn(async (): Promise<DescendantsOutcome> => outcome);
  const processTable = { open, descendantsOf } as unknown as ProcessTableSnapshot;

  // A real running session for pane-0, so its identity RESOLVES — the proven cache is
  // deliberately not populated by a negative (presenceProjector.ts:178), so a test over
  // unresolvable panes would measure nothing.
  const listRunning = vi.fn(
    async (): Promise<RunningSessionsOutcome> => ({
      kind: "ok",
      sessions: [{ sessionId: "live-0", cwd: worktreeIds[0], pid: 1000 }],
    }),
  );
  const sessionMtime = vi.fn(async () => 1);
  // A path, not null: `presenceDeps` deliberately does NOT cache a miss (a session that
  // cannot be located yet may be locatable later), so a null-returning stub would measure
  // that eviction rather than the memo.
  const sessionPath = vi.fn(async (): Promise<string | null> => "/sessions/sess-1.jsonl");

  const store = createPaneEvidenceStore({ now: () => NOW });
  for (let i = 0; i < PANES; i++) {
    store.create(`pane-${i}`, {
      viewId: "sidebar",
      cwd: worktreeIds[i % WORKTREES],
      ptyPid: 1000 + i,
      shell: "claude",
    });
  }

  const deps = createPresenceProjectorDeps({
    store,
    table: processTable,
    listRunning,
    sessionMtime,
    sessionPath,
    now: () => NOW,
  });
  return {
    open,
    descendantsFor,
    listRunning,
    sessionMtime,
    sessionPath,
    store,
    projector: createPresenceProjector(deps),
  };
}

describe(`presence cost envelope — ${PANES} panes across ${WORKTREES} worktrees`, () => {
  it("opens the process table once per rebuild, however many panes read it", async () => {
    const { open, projector } = wireAtScale();

    await projector.project(worktreeIds);

    expect(open).toHaveBeenCalledTimes(PROCESS_TABLE_READS.exactly);
  });

  it("reads the running-session registry once per rebuild, not once per pane", async () => {
    const { listRunning, projector } = wireAtScale();

    await projector.project(worktreeIds);

    expect(listRunning).toHaveBeenCalledTimes(1);
  });

  it("costs the same per rebuild whether one pane or ten are looking", async () => {
    const ten = wireAtScale();
    await ten.projector.project(worktreeIds);

    expect(ten.open).toHaveBeenCalledTimes(PROCESS_TABLE_READS.exactly);
    expect(ten.listRunning).toHaveBeenCalledTimes(1);
  });

  it("does not re-resolve a pane whose id, pid and cwd are unchanged", async () => {
    // Round-2 B9: the first attempt at D2's third condition drove `reportTurn`, which
    // routes through `resolveReportedSession` and bypasses `identify()` entirely — so
    // deleting the pane-key cache did not fail it. This drives the cache D2 actually
    // names: `PaneState.proven`, keyed by pane id, PTY pid and cwd.
    const { descendantsFor, projector } = wireAtScale();

    await projector.project(worktreeIds);
    const afterFirst = descendantsFor.mock.calls.length;
    await projector.project(worktreeIds);

    expect(afterFirst, "no pane resolved, so caching a resolution proves nothing").toBeGreaterThan(0);
    expect(descendantsFor.mock.calls.length).toBeLessThan(2 * afterFirst);
  });

  it("does not re-resolve a reported session whose pane key has not changed", async () => {
    // Round-1 B9: D2's envelope has THREE conditions and the suite asserted two. This is
    // the third — "no re-resolution for unchanged pane keys" — and without it the memoized
    // resolution can regress to per-rebuild work while every other count stays flat.
    const { sessionPath, projector, store } = wireAtScale();
    // A reported session is what resolution is FOR: the pane's own agent names a session
    // id, and where that session LIVES has to be looked up rather than read off the pane.
    store.reportTurn("pane-0", {
      state: "working",
      stateStartedAt: NOW,
      agentSessionId: "sess-1",
      subagents: [],
    });

    await projector.project(worktreeIds);
    const afterFirst = sessionPath.mock.calls.length;
    await projector.project(worktreeIds);

    expect(afterFirst, "nothing was resolved, so caching it proves nothing").toBeGreaterThan(0);
    expect(sessionPath.mock.calls.length).toBe(afterFirst);
  });

  it("charges each rebuild once rather than carrying a read across them", async () => {
    const { open, listRunning, projector } = wireAtScale();

    await projector.project(worktreeIds);
    await projector.project(worktreeIds);

    expect(open).toHaveBeenCalledTimes(2 * PROCESS_TABLE_READS.exactly);
    expect(listRunning).toHaveBeenCalledTimes(2);
  });
});
