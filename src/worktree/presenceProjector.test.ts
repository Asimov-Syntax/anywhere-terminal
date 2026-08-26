// src/worktree/presenceProjector.test.ts — the window's panes becoming rows.
//
// Every dependency is injected, so the whole projection — attribution, the
// resolution slot, timestamps and degradation — is exercised without a process
// table, a registry, or a SessionManager.

import { describe, expect, it, vi } from "vitest";
import type { ActivityRule, PaneActivity } from "../shared/paneEvidence";
import type { SessionLookup } from "./agentIdentity";
import { createPresenceProjector, type Pane, type PresenceProjectorDeps } from "./presenceProjector";

const WT = "/repo";
const NESTED = "/repo/worktrees/feature";

let clock = 1_700_000_000_000;

function pane(over: Partial<Pane> & { paneId: string }): Pane {
  return { exited: false, cwd: WT, ...over };
}

function makeProjector(initial: Pane[] = []) {
  const panes = [...initial];
  const activity = new Map<string, { activity: PaneActivity; rule: ActivityRule }>();
  let lookup: (paneId: string) => SessionLookup = () => ({ kind: "absent" });
  let snapshots = 0;
  let resolves = 0;

  const deps: PresenceProjectorDeps = {
    panes: () => panes,
    activityFor: (paneId) => activity.get(paneId) ?? { activity: "idle", rule: "quiet" },
    openSnapshot: async () => {
      snapshots += 1;
      return {
        resolve: async (p) => {
          resolves += 1;
          return lookup(p.paneId);
        },
      };
    },
    normalize: (p) => p,
    now: () => clock,
  };

  return {
    projector: createPresenceProjector(deps),
    panes,
    activity,
    /** Set a pane's activity and the rule that produced it. */
    setActivity(paneId: string, next: PaneActivity, rule: ActivityRule = next === "running" ? "working" : "quiet") {
      activity.set(paneId, { activity: next, rule });
    },
    setLookup(next: (paneId: string) => SessionLookup) {
      lookup = next;
    },
    counts: () => ({ snapshots, resolves }),
  };
}

describe("attribution", () => {
  it("puts a pane under the worktree it is inside", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: `${WT}/src` })]);
    const presence = await h.projector.project([WT]);
    expect(presence.rowsByWorktreeId[WT]).toHaveLength(1);
    expect(presence.rowsByWorktreeId[WT][0]).toMatchObject({ rowId: "window:a", scope: "window", paneId: "a" });
  });

  it("gives a nested worktree the pane, not the tree containing it", async () => {
    // Longest match, as matchRepository does. A prefix test picking the first
    // hit would file every nested-worktree pane under the parent repo.
    const h = makeProjector([pane({ paneId: "a", cwd: `${NESTED}/src` })]);
    const presence = await h.projector.project([WT, NESTED]);
    expect(presence.rowsByWorktreeId[WT]).toBeUndefined();
    expect(presence.rowsByWorktreeId[NESTED]).toHaveLength(1);
  });

  it("refuses a sibling whose path merely shares a prefix", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: "/repo-two/src" })]);
    expect(await h.projector.project([WT])).toMatchObject({ rowsByWorktreeId: {} });
  });

  it("drops a pane whose directory is unknown rather than guessing one", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: undefined })]);
    expect(await h.projector.project([WT])).toMatchObject({ rowsByWorktreeId: {} });
  });

  it("normalizes the pane cwd into the form the worktree id is in", async () => {
    const panes = [pane({ paneId: "a", cwd: "/REPO/src" })];
    const projector = createPresenceProjector({
      panes: () => panes,
      activityFor: () => ({ activity: "idle", rule: "quiet" }),
      openSnapshot: async () => ({ resolve: async () => ({ kind: "absent" }) }),
      normalize: (p) => p.toLowerCase(),
      now: () => clock,
    });
    expect(Object.keys((await projector.project([WT])).rowsByWorktreeId)).toEqual([WT]);
  });
});

describe("identity and activity are qualified independently", () => {
  it("carries an authoritative identity beside a fallback activity", async () => {
    const h = makeProjector([pane({ paneId: "a", isAgentLaunch: true, shell: "claude" })]);
    h.setActivity("a", "running");
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row).toMatchObject({
      agent: "claude",
      agentSource: "launch",
      activity: "running",
      activitySource: "output",
    });
  });

  it("leaves the agent off a pane nothing proved, without hiding its activity", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setActivity("a", "running");
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.agent).toBeUndefined();
    expect(row).toMatchObject({ agentSource: "none", activity: "running" });
  });

  it("names the title as the source when a shell name is what forced idle", async () => {
    // The shell rule overrules live output, so calling it `output` would name
    // the evidence it beat.
    const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
    h.setActivity("a", "idle", "shell-title");
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.activitySource).toBe("title");
  });

  it("does not credit the title on a pane that was idle anyway", async () => {
    // Same final state, same shell title, but nothing was overruled — reading
    // the cause off the outcome reports a provenance that is false.
    const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
    h.setActivity("a", "idle", "quiet");
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.activitySource).toBe("output");
  });

  it("keeps output as the source for a pane waiting on the user", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setActivity("a", "waiting", "waiting");
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row).toMatchObject({ activity: "waiting", activitySource: "output" });
  });

  it("keeps output as the source for an ordinary idle pane", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "fix the projector" })]);
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.activitySource).toBe("output");
  });
});

describe("pane lifecycle", () => {
  it("keeps an exited pane's row and reports it exited", async () => {
    const h = makeProjector([pane({ paneId: "a", exited: true })]);
    h.setActivity("a", "exited");
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.activity).toBe("exited");
  });

  it("leaves no row behind once the pane is gone", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    await h.projector.project([WT]);
    h.panes.length = 0;
    expect((await h.projector.project([WT])).rowsByWorktreeId).toEqual({});
  });
});

describe("the resolution slot", () => {
  it("reuses a proven identity while the pane's process and directory hold", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);
    const first = h.counts().resolves;
    await h.projector.project([WT]);
    expect(h.counts().resolves).toBe(first);
  });

  it("retries a pane that resolved to nothing, so an agent starting in it is seen", async () => {
    // The pane keeps its pty pid and its cwd, so a negative cached on that
    // tuple would never be retried for the life of the pane.
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    await h.projector.project([WT]);
    h.setLookup(() => ({ kind: "resolved", agent: "codex", sessionId: "s9" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row).toMatchObject({ agent: "codex", agentSource: "registry", entryId: "codex:s9" });
  });

  it("re-reads once the pane changes directory", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);
    const before = h.counts().resolves;
    h.panes[0] = pane({ paneId: "a", ptyPid: 42, cwd: `${WT}/deeper` });
    await h.projector.project([WT]);
    expect(h.counts().resolves).toBe(before + 1);
  });

  it("evicts a closed pane's slot instead of holding it forever", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);
    h.panes.length = 0;
    await h.projector.project([WT]);
    h.panes.push(pane({ paneId: "a" }));
    const before = h.counts().resolves;
    await h.projector.project([WT]);
    expect(h.counts().resolves).toBe(before + 1);
  });
});

describe("an inconclusive read retains identity", () => {
  it("keeps the proven agent and source when the read fails", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);

    h.panes[0] = pane({ paneId: "a", ptyPid: 43 });
    h.setLookup(() => ({ kind: "failed", reason: "`ps` timed out" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row).toMatchObject({ agent: "claude", agentSource: "registry", entryId: "claude:s1" });
  });

  it("does not let a failure flip the row to a less active state", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setActivity("a", "running");
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);

    h.panes[0] = pane({ paneId: "a", ptyPid: 43 });
    h.setLookup(() => ({ kind: "failed", reason: "unreadable" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.activity).toBe("running");
  });

  it("clears the agent on a conclusive empty read, so a real exit is seen", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);

    h.panes[0] = pane({ paneId: "a", ptyPid: 43 });
    h.setLookup(() => ({ kind: "absent" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.agent).toBeUndefined();
    expect(row.agentSource).toBe("none");
  });
});

describe("a failed source degrades its scope", () => {
  it("names the source, the reason, and when it first failed", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setLookup(() => ({ kind: "failed", reason: "`ps` timed out" }));
    const first = await h.projector.project([WT]);
    expect(first.degradedSources).toEqual([{ source: "panes", reason: "`ps` timed out", since: clock }]);

    const failedAt = clock;
    clock += 5_000;
    const second = await h.projector.project([WT]);
    expect(second.degradedSources[0].since).toBe(failedAt);
  });

  it("reports nothing when every source answered, even with no agents to report", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    expect((await h.projector.project([WT])).degradedSources).toEqual([]);
  });

  it("clears the entry once the source answers again", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setLookup(() => ({ kind: "failed", reason: "unreadable" }));
    await h.projector.project([WT]);
    h.setLookup(() => ({ kind: "absent" }));
    expect((await h.projector.project([WT])).degradedSources).toEqual([]);
  });

  it("names a source once however many panes it failed for", async () => {
    const h = makeProjector([pane({ paneId: "a" }), pane({ paneId: "b" })]);
    h.setLookup(() => ({ kind: "failed", reason: "unreadable" }));
    expect((await h.projector.project([WT])).degradedSources).toHaveLength(1);
  });
});

describe("a row's age describes its agent", () => {
  it("resets the age when a different agent takes the pane over", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 1 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    const started = clock;
    await h.projector.project([WT]);

    clock += 3_600_000;
    h.panes[0] = pane({ paneId: "a", ptyPid: 2 });
    h.setLookup(() => ({ kind: "resolved", agent: "codex", sessionId: "s2" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.startedAt).toBe(clock);
    expect(row.startedAt).not.toBe(started);
  });

  it("resets the age for a new session of the same agent", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 1 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);

    clock += 60_000;
    h.panes[0] = pane({ paneId: "a", ptyPid: 2 });
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s2" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.startedAt).toBe(clock);
  });

  it("keeps the age when a stronger source proves the same agent", async () => {
    // A title confirming what the launch record already claimed is the same
    // agent, not a handover.
    const h = makeProjector([pane({ paneId: "a", ptyPid: 1, isAgentLaunch: true, shell: "claude" })]);
    const started = clock;
    await h.projector.project([WT]);

    clock += 60_000;
    h.panes[0] = pane({ paneId: "a", ptyPid: 1, isAgentLaunch: true, shell: "claude" });
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.startedAt).toBe(started);
  });

  it("moves stateStartedAt only when the activity actually changes", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setActivity("a", "running");
    const entered = clock;
    await h.projector.project([WT]);

    clock += 10_000;
    const [same] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(same.stateStartedAt).toBe(entered);

    h.setActivity("a", "idle");
    const [moved] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(moved.stateStartedAt).toBe(clock);
  });

  it("stamps finishedAt settling out of work and clears it on the next turn", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setActivity("a", "running");
    await h.projector.project([WT]);

    clock += 1_000;
    h.setActivity("a", "idle");
    const [settled] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(settled.finishedAt).toBe(clock);

    clock += 1_000;
    h.setActivity("a", "running");
    const [working] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(working.finishedAt).toBeUndefined();
  });

  it("leaves finishedAt unset on a pane that never worked", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.finishedAt).toBeUndefined();
  });
});

describe("ranking", () => {
  it("has no rank before the first projection", () => {
    expect(makeProjector().projector.rank(WT)).toBeUndefined();
  });

  it("ranks a worktree by the newest activity across its rows", async () => {
    const h = makeProjector([
      pane({ paneId: "old", lastOutputAt: clock - 60_000 }),
      pane({ paneId: "new", lastOutputAt: clock - 1_000 }),
    ]);
    await h.projector.project([WT]);
    expect(h.projector.rank(WT)).toBe(Math.floor(clock / 1000) * 1000);
  });

  it("quantizes lastActivityAt to whole seconds so a stream does not repaint per flush", async () => {
    const h = makeProjector([pane({ paneId: "a", lastOutputAt: clock + 400 })]);
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.lastActivityAt).toBe(Math.floor((clock + 400) / 1000) * 1000);
    expect((row.lastActivityAt ?? 0) % 1000).toBe(0);
  });

  it("has no rank for a worktree with no rows", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    await h.projector.project([WT, NESTED]);
    expect(h.projector.rank(NESTED)).toBeUndefined();
  });

  it("drops the rank of a worktree that no longer has rows", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    await h.projector.project([WT]);
    h.panes.length = 0;
    await h.projector.project([WT]);
    expect(h.projector.rank(WT)).toBeUndefined();
  });
});

describe("one read per rebuild", () => {
  it("opens a single snapshot however many panes resolve", async () => {
    const h = makeProjector([pane({ paneId: "a" }), pane({ paneId: "b" }), pane({ paneId: "c" })]);
    await h.projector.project([WT]);
    expect(h.counts().snapshots).toBe(1);
  });

  it("still reads once when the clock crosses a cache TTL mid-rebuild", async () => {
    // Pane resolutions are sequential and awaited, so a TTL expiring between
    // two of them is exactly how a rebuild grows a second `ps`. The snapshot is
    // taken at entry, so the boundary is the rebuild, not the TTL.
    const panes = [pane({ paneId: "a" }), pane({ paneId: "b" })];
    let opened = 0;
    const projector = createPresenceProjector({
      panes: () => panes,
      activityFor: () => ({ activity: "idle", rule: "quiet" }),
      openSnapshot: async () => {
        opened += 1;
        return {
          resolve: async () => {
            clock += 60_000;
            return { kind: "absent" };
          },
        };
      },
      normalize: (p) => p,
      now: () => clock,
    });
    await projector.project([WT]);
    expect(opened).toBe(1);
  });

  it("uses one clock reading for the whole rebuild", async () => {
    const now = vi.fn(() => clock);
    const panes = [pane({ paneId: "a" }), pane({ paneId: "b" })];
    const projector = createPresenceProjector({
      panes: () => panes,
      activityFor: () => ({ activity: "idle", rule: "quiet" }),
      openSnapshot: async () => ({ resolve: async () => ({ kind: "absent" }) }),
      normalize: (p) => p,
      now,
    });
    const presence = await projector.project([WT]);
    expect(now).toHaveBeenCalledTimes(1);
    expect(presence.scannedAt).toBe(clock);
  });
});
