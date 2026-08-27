// src/extension.crossLayer.test.ts — The invariants no single layer can prove.
// See asimov/changes/verify-cross-layer-scale/design.md D5.
//
// Each scenario below runs a real hook event through the real Claude reducer, the real
// pane-evidence store, and the real presence projector. Unit tests at either END of that
// pipeline can both pass while the composition is broken — which is what "cross-layer
// verification cannot live inside any single feature task" (docs/PLAN.md WT-007.1) means.
//
// One seam is mirrored rather than imported: the routing branch in src/extension.ts:418-431
// that sends a structured turn to `reportTurn` and a null to `expireTurn`. It is three lines
// of dispatch inside `activate()`, reachable only by standing up the whole extension host.
// Mirroring it is stated here rather than hidden, and it is the one link these tests do not
// own.

import { afterEach, describe, expect, it } from "vitest";
import { type AgentActivityUpdate, type AgentTurnReport, createAgentHookRuntime } from "./agentHooks/AgentHookRuntime";
import { CLAUDE_HOOK_ENV_VAR, CLAUDE_HOOK_SLUG, claudeAgentRegistration } from "./agentHooks/agents/claude";
import { createProcessTableSnapshot } from "./pty/processTableSnapshot";
import { createPaneEvidenceStore, type PaneEvidenceStore } from "./session/PaneEvidenceStore";
import type { RunningSessionsOutcome } from "./vault/readers/runningSessions";
import { createPresenceProjectorDeps } from "./worktree/presenceDeps";
import { createPresenceProjector } from "./worktree/presenceProjector";

const WT = "/repo";
const NOW = 1_700_000_000_000;

const runtimes: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.dispose();
  }
});

function post(url: string, body: string): Promise<{ status: number }> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }).then((r) => ({
    status: r.status,
  }));
}

function eventBody(hook_event_name: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ hook_event_name, session_id: "abc", ...extra });
}

/**
 * The routing rule of src/extension.ts:418-431, applied to whatever the runtime publishes.
 * Structured turn → the pane's evidence. Null from a revoked source → retire the turn now,
 * rather than letting it ride out its freshness deadline.
 */
function route(store: PaneEvidenceStore, update: AgentActivityUpdate): void {
  if (typeof update.state === "object" && update.state !== null) {
    store.reportTurn(update.sessionId, update.state as AgentTurnReport);
    return;
  }
  if (update.state === null && update.agent !== "cursor") {
    store.expireTurn(update.sessionId);
  }
}

/** Real reducer → real store → real projector, wired the way the extension wires them. */
async function pipeline() {
  const store = createPaneEvidenceStore({ now: () => NOW });
  const published: AgentActivityUpdate[] = [];
  const runtime = await createAgentHookRuntime(
    [claudeAgentRegistration()],
    {},
    {
      onStatus: (update) => {
        published.push(update);
        route(store, update);
      },
      onReasonCode: () => {},
    },
  );
  runtimes.push(runtime);
  runtime.setAgentEnabled("claude", true);

  const projector = createPresenceProjector(
    createPresenceProjectorDeps({
      store,
      table: createProcessTableSnapshot(),
      listRunning: async (): Promise<RunningSessionsOutcome> => ({ kind: "ok", sessions: [] }),
      sessionMtime: async () => 1,
      sessionPath: async () => null,
      now: () => NOW,
    }),
  );

  /** A pane whose id is the hook session id, so the routed report lands on it. */
  store.create("abc", { viewId: "sidebar", cwd: WT, ptyPid: 4242, shell: "claude", isAgentLaunch: true });
  const env = runtime.create("abc");
  const url = `${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`;

  return {
    store,
    runtime,
    published,
    send: (event: string, extra: Record<string, unknown> = {}) => post(url, eventBody(event, extra)),
    row: async () => (await projector.project([WT])).rowsByWorktreeId[WT]?.[0],
  };
}

describe("[I6] a resumed or cleared session lands idle without claiming a completed turn", () => {
  it("[I6] stamps no finish for a session boundary, though the pane does read idle", async () => {
    const p = await pipeline();
    await p.send("UserPromptSubmit");
    // Projected between the events: the finish rule is a TRANSITION (running → idle),
    // so a single projection at the end would never see one and the check would pass
    // for the wrong reason.
    expect((await p.row())?.activity).toBe("running");
    await p.send("SessionStart", { source: "resume" });

    const row = await p.row();

    expect(row?.activity).toBe("idle");
    expect(row?.finishedAt, "a boundary was recorded as a finished turn").toBeUndefined();
  });

  it("[I6] does stamp a finish for a turn that actually ended, so the check above is not vacuous", async () => {
    const p = await pipeline();
    await p.send("UserPromptSubmit");
    expect((await p.row())?.activity).toBe("running");
    await p.send("Stop");

    const row = await p.row();

    expect(row?.activity).toBe("idle");
    expect(row?.finishedAt).toBeDefined();
  });
});

describe("[I7] hook status is never carried across a window reload", () => {
  it("[I7] returns the pane to inference when the source that published it goes away", async () => {
    const p = await pipeline();
    await p.send("UserPromptSubmit");
    expect((await p.row())?.activitySource).toBe("hook");

    // Round-1 B4: this used to call `setAgentEnabled(false)`, which is entitlement
    // revocation — a user turning the agent off, not a window going away. A reload
    // DISPOSES the runtime: it closes the server and marks itself disposed, and the
    // question I7 asks is whether the status it published survives that.
    p.runtime.dispose();
    await new Promise((resolve) => setImmediate(resolve));

    expect((await p.row())?.activitySource).not.toBe("hook");

    // And it cannot come back: a disposed runtime republishing is the same defect from
    // the other side, so the socket it minted must no longer accept a turn.
    await expect(p.send("UserPromptSubmit")).rejects.toThrow();
    expect((await p.row())?.activitySource).not.toBe("hook");
  });
});
