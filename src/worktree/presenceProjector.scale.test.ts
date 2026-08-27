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
import type { RunningSessionsOutcome } from "../vault/readers/runningSessions";
import { PROCESS_TABLE_READS } from "../test/invariants/budgets";
import { createPresenceProjectorDeps } from "./presenceDeps";
import { createPresenceProjector } from "./presenceProjector";

const NOW = 1_700_000_000_000;
/** worktree-agent-presence.md § 7 publishes the budget at this size; it does not move. */
const WORKTREES = 10;
const PANES = 10;

const worktreeIds = Array.from({ length: WORKTREES }, (_, i) => `/repo/wt-${i}`);

function wireAtScale() {
  const outcome: DescendantsOutcome = { kind: "ok", pids: [] };
  const open = vi.fn(async () => ({ descendantsOf: () => outcome }));
  const descendantsOf = vi.fn(async (): Promise<DescendantsOutcome> => outcome);
  const processTable = { open, descendantsOf } as unknown as ProcessTableSnapshot;

  const listRunning = vi.fn(async (): Promise<RunningSessionsOutcome> => ({ kind: "ok", sessions: [] }));
  const sessionMtime = vi.fn(async () => 1);
  const sessionPath = vi.fn(async () => null);

  const store = createPaneEvidenceStore({ now: () => NOW });
  for (let i = 0; i < PANES; i++) {
    store.create(`pane-${i}`, { viewId: "sidebar", cwd: worktreeIds[i % WORKTREES], ptyPid: 1000 + i, shell: "claude" });
  }

  const deps = createPresenceProjectorDeps({
    store,
    table: processTable,
    listRunning,
    sessionMtime,
    sessionPath,
    now: () => NOW,
  });
  return { open, listRunning, sessionMtime, projector: createPresenceProjector(deps) };
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

  it("charges each rebuild once rather than carrying a read across them", async () => {
    const { open, listRunning, projector } = wireAtScale();

    await projector.project(worktreeIds);
    await projector.project(worktreeIds);

    expect(open).toHaveBeenCalledTimes(2 * PROCESS_TABLE_READS.exactly);
    expect(listRunning).toHaveBeenCalledTimes(2);
  });
});
