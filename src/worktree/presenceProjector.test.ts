// src/worktree/presenceProjector.test.ts — the window's panes becoming rows.
//
// Every dependency is injected, so the whole projection — attribution, the
// resolution slot, timestamps and degradation — is exercised without a process
// table, a registry, or a SessionManager.

import { describe, expect, it, vi } from "vitest";
import type { AgentTurnReport } from "../agentHooks/AgentHookRuntime";
import { TURN_FRESHNESS_MS } from "../session/PaneEvidenceStore";
import type { ActivityRule, PaneActivity } from "../shared/paneEvidence";
import type { RunningClaudeSession, RunningSessionsOutcome } from "../vault/readers/runningSessions";
import type { SessionLookup } from "./agentIdentity";
import {
  createPresenceProjector,
  type Pane,
  type PresenceProjectorDeps,
  type ReportedSessionEntry,
} from "./presenceProjector";

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
  let registry: RunningSessionsOutcome = { kind: "ok", sessions: [] };
  let vaultTitle: ((entryId: string) => Promise<string | undefined>) | undefined;
  let snapshots = 0;
  let resolves = 0;
  let reportedSessions: Record<string, ReportedSessionEntry> = {};
  const reportedAsked: string[] = [];

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
        sessions: async () => registry,
      };
    },
    normalize: (p) => p,
    sessionTitle: (entryId) => (vaultTitle ? vaultTitle(entryId) : Promise.resolve(undefined)),
    resolveReportedSession: async (sessionId) => {
      reportedAsked.push(sessionId);
      return reportedSessions[sessionId] ?? null;
    },
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
    setRegistry(next: RunningSessionsOutcome) {
      registry = next;
    },
    setVaultTitle(next: (entryId: string) => Promise<string | undefined>) {
      vaultTitle = next;
    },
    setReportedSessions(next: Record<string, ReportedSessionEntry>) {
      reportedSessions = next;
    },
    reportedAsked: () => reportedAsked,
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
      openSnapshot: async () => ({
        resolve: async () => ({ kind: "absent" }),
        sessions: async () => ({ kind: "ok", sessions: [] }),
      }),
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
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "`ps` timed out" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row).toMatchObject({ agent: "claude", agentSource: "registry", entryId: "claude:s1" });
  });

  it("does not let a failure flip the row to a less active state", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setActivity("a", "running");
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);

    h.panes[0] = pane({ paneId: "a", ptyPid: 43 });
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "unreadable" }));
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
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "`ps` timed out" }));
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
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "unreadable" }));
    await h.projector.project([WT]);
    h.setLookup(() => ({ kind: "absent" }));
    expect((await h.projector.project([WT])).degradedSources).toEqual([]);
  });

  it("names a source once however many panes it failed for", async () => {
    const h = makeProjector([pane({ paneId: "a" }), pane({ paneId: "b" })]);
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "unreadable" }));
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
          sessions: async () => ({ kind: "ok", sessions: [] }),
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
      openSnapshot: async () => ({
        resolve: async () => ({ kind: "absent" }),
        sessions: async () => ({ kind: "ok", sessions: [] }),
      }),
      normalize: (p) => p,
      now,
    });
    const presence = await projector.project([WT]);
    expect(now).toHaveBeenCalledTimes(1);
    expect(presence.scannedAt).toBe(clock);
  });
});

describe("every pane claims its session, whether or not it produces a row", () => {
  it("resolves a pane whose directory is inside no worktree", async () => {
    // Resolution ordered after attribution would leave this pane unresolved, and
    // the session it is running would then be free to surface as an external row
    // labelled "other window" — in the very window that owns it (design.md D3).
    const h = makeProjector([pane({ paneId: "elsewhere", cwd: "/somewhere/else" })]);

    const presence = await h.projector.project([WT]);

    expect(presence.rowsByWorktreeId).toEqual({});
    expect(h.counts().resolves).toBe(1);
  });

  it("resolves a pane whose directory is not known yet", async () => {
    const h = makeProjector([pane({ paneId: "nocwd", cwd: undefined })]);

    const presence = await h.projector.project([WT]);

    expect(presence.rowsByWorktreeId).toEqual({});
    expect(h.counts().resolves).toBe(1);
  });

  it("keeps the identity it proved for an unattributed pane, so a later rebuild reuses it", async () => {
    const h = makeProjector([pane({ paneId: "elsewhere", cwd: "/somewhere/else" })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s9" }));

    await h.projector.project([WT]);
    await h.projector.project([WT]);

    expect(h.counts().resolves).toBe(1);
  });
});

describe("external rows — agents running outside this window", () => {
  function session(over: Partial<RunningClaudeSession> = {}): RunningClaudeSession {
    return { sessionId: "s1", cwd: WT, pid: 4242, startedAt: 1_600_000_000_000, ...over };
  }

  function withRegistry(...sessions: RunningClaudeSession[]) {
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions });
    return h;
  }

  it("renders a live registry session under the worktree holding its directory", async () => {
    const h = withRegistry(session({ cwd: `${WT}/src` }));

    const presence = await h.projector.project([WT]);

    expect(presence.rowsByWorktreeId[WT]).toEqual([
      {
        rowId: "external:claude:s1",
        scope: "external",
        agent: "claude",
        agentSource: "registry",
        activity: "running",
        activitySource: "registry",
        entryId: "claude:s1",
        pid: 4242,
        startedAt: 1_600_000_000_000,
        stateStartedAt: 1_600_000_000_000,
        lastActivityAt: 1_600_000_000_000,
      },
    ]);
  });

  it("carries no pane and no view, which is what makes the scope trustworthy", async () => {
    const h = withRegistry(session());
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.paneId).toBeUndefined();
    expect(row.viewId).toBeUndefined();
    expect(row.finishedAt).toBeUndefined();
  });

  it("yields to the pane that already claims the session", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    h.setRegistry({ kind: "ok", sessions: [session({ sessionId: "s1" })] });
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.rowId)).toEqual(["window:a"]);
  });

  it("yields even when the claiming pane is inside no worktree", async () => {
    // The pane produces no row, so the session would otherwise be free — and
    // labelled as running in another window, in the window running it.
    const h = makeProjector([pane({ paneId: "a", cwd: "/somewhere/else" })]);
    h.setRegistry({ kind: "ok", sessions: [session({ sessionId: "s1", cwd: WT })] });
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));

    expect((await h.projector.project([WT])).rowsByWorktreeId).toEqual({});
  });

  it("drops a session no worktree contains", async () => {
    const h = withRegistry(session({ cwd: "/elsewhere" }));
    expect((await h.projector.project([WT])).rowsByWorktreeId).toEqual({});
  });

  it("gives a nested worktree the session, not the tree containing it", async () => {
    const h = withRegistry(session({ cwd: `${NESTED}/src` }));

    const presence = await h.projector.project([WT, NESTED]);

    expect(presence.rowsByWorktreeId[NESTED]).toHaveLength(1);
    expect(presence.rowsByWorktreeId[WT]).toBeUndefined();
  });

  it("orders external rows by rowId, so the same set never re-renders", async () => {
    // The reader's order follows readdir and Map insertion, and the render
    // signature is row-order sensitive.
    const h = withRegistry(session({ sessionId: "zzz", pid: 3 }), session({ sessionId: "aaa", pid: 4 }));

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.rowId)).toEqual(["external:claude:aaa", "external:claude:zzz"]);
  });

  it("stamps a session with no launch time when first seen, and keeps that stamp", async () => {
    const h = withRegistry(session({ startedAt: undefined }));

    const first = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];
    clock += 60_000;
    const second = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    expect(first.startedAt).toBe(second.startedAt);
    expect(second.lastActivityAt).toBe(first.startedAt);
  });

  it("does not move the ordering key when a later scan finds the same session", async () => {
    // Stamping the scan would re-sort the listing every poll and claim activity
    // the registry never gave.
    const h = withRegistry(session());

    const first = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];
    clock += 5_000;
    const second = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    expect(second.lastActivityAt).toBe(first.lastActivityAt);
  });

  it("ranks the worktree it is under", async () => {
    const h = withRegistry(session({ startedAt: 1_650_000_000_000 }));
    await h.projector.project([WT]);
    expect(h.projector.rank(WT)).toBe(1_650_000_000_000);
  });

  it("clears its rows when a readable registry finds nothing", async () => {
    const h = withRegistry(session());
    expect((await h.projector.project([WT])).rowsByWorktreeId[WT]).toHaveLength(1);

    h.setRegistry({ kind: "ok", sessions: [] });

    expect((await h.projector.project([WT])).rowsByWorktreeId).toEqual({});
  });
});

describe("what a row is called", () => {
  // Claude sets no OSC title at all, so a row sourced only from the pane's
  // terminal title renders the placeholder for every claude session on screen.
  const named = (over: Partial<RunningClaudeSession> = {}): RunningClaudeSession => ({
    sessionId: "s1",
    cwd: WT,
    pid: 4242,
    startedAt: 1_600_000_000_000,
    name: "hadern-analysis-a7",
    ...over,
  });

  it("titles an external row from the name the registry published", async () => {
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named()] });

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("hadern-analysis-a7");
  });

  it("titles a pane from its session's name, not from the title its shell left behind", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
    h.setRegistry({ kind: "ok", sessions: [named({ name: "cyberk-skills-f9" })] });
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", name: "cyberk-skills-f9" }));

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("cyberk-skills-f9");
  });

  it("keeps the pane's own title when no session named it", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "npm run watch" })]);

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("npm run watch");
  });

  it("falls back to the vault for a session the registry left unnamed", async () => {
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named({ name: undefined })] });
    h.setVaultTitle(async (entryId) => (entryId === "claude:s1" ? "fix the worktree rows" : undefined));

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("fix the worktree rows");
  });

  it("never asks the vault about a session the registry already named", async () => {
    // The fallback opens a transcript, so a registry-named row must not pay for
    // it — and the poll re-runs the external pass every five seconds.
    const asked: string[] = [];
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named()] });
    h.setVaultTitle(async (entryId) => {
      asked.push(entryId);
      return "should never be read";
    });

    await h.projector.project([WT]);

    expect(asked).toEqual([]);
  });

  it("reads the vault once per session however many passes run", async () => {
    let reads = 0;
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named({ name: undefined })] });
    h.setVaultTitle(async () => {
      reads += 1;
      return "fix the worktree rows";
    });

    await h.projector.project([WT]);
    await h.projector.project([WT]);
    await h.projector.project([WT], { external: true });

    expect(reads).toBe(1);
  });

  it("survives a vault read that throws, leaving the row untitled rather than the pass dead", async () => {
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named({ name: undefined })] });
    h.setVaultTitle(async () => {
      throw new Error("transcript unreadable");
    });

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBeUndefined();
  });
});

describe("an unreadable registry is not an empty one", () => {
  function session(over: Partial<RunningClaudeSession> = {}): RunningClaudeSession {
    return { sessionId: "s1", cwd: WT, pid: 4242, startedAt: 1_600_000_000_000, ...over };
  }

  const UNREADABLE = { kind: "failed", reason: "registry unreadable (EACCES)" } as const;

  async function afterOneGoodScan(...sessions: RunningClaudeSession[]) {
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: sessions.length ? sessions : [session()] });
    await h.projector.project([WT]);
    return h;
  }

  it("keeps the rows the last readable scan produced", async () => {
    const h = await afterOneGoodScan();
    h.setRegistry(UNREADABLE);

    const presence = await h.projector.project([WT]);

    expect(presence.rowsByWorktreeId[WT].map((r) => r.rowId)).toEqual(["external:claude:s1"]);
  });

  it("names the registry, with the reason, rather than showing the rows as fresh", async () => {
    const h = await afterOneGoodScan();
    h.setRegistry(UNREADABLE);

    const presence = await h.projector.project([WT]);

    expect(presence.degradedSources).toEqual([{ source: "registry", reason: UNREADABLE.reason, since: clock }]);
  });

  it("reports the epoch of the first failure, not the latest", async () => {
    const h = await afterOneGoodScan();
    h.setRegistry(UNREADABLE);
    await h.projector.project([WT]);
    const first = clock;

    clock += 30_000;
    const presence = await h.projector.project([WT]);

    expect(presence.degradedSources[0]).toMatchObject({ since: first });
  });

  it("drops the degradation once the registry answers again", async () => {
    const h = await afterOneGoodScan();
    h.setRegistry(UNREADABLE);
    await h.projector.project([WT]);

    h.setRegistry({ kind: "ok", sessions: [session()] });
    const presence = await h.projector.project([WT]);

    expect(presence.degradedSources).toEqual([]);
    expect(presence.rowsByWorktreeId[WT]).toHaveLength(1);
  });

  it("re-attributes the retained sessions against the tree it is published with", async () => {
    // Rows are not cached; the session list is. A worktree that went away between
    // the good scan and the failed one must not still be named by presence.
    const h = await afterOneGoodScan();
    h.setRegistry(UNREADABLE);

    const presence = await h.projector.project([]);

    expect(presence.rowsByWorktreeId).toEqual({});
    expect(presence.degradedSources).toHaveLength(1);
  });

  it("does not evict first-seen state on a failed read", async () => {
    const h = await afterOneGoodScan(session({ startedAt: undefined }));
    const stamped = (await h.projector.project([WT])).rowsByWorktreeId[WT][0].startedAt;

    h.setRegistry(UNREADABLE);
    clock += 60_000;
    const retained = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    expect(retained.startedAt).toBe(stamped);
  });

  it("names nothing when a readable registry is simply empty", async () => {
    const h = await afterOneGoodScan();
    h.setRegistry({ kind: "ok", sessions: [] });

    const presence = await h.projector.project([WT]);

    expect(presence.rowsByWorktreeId).toEqual({});
    expect(presence.degradedSources).toEqual([]);
  });
});

describe("an external-only projection", () => {
  function session(over: Partial<RunningClaudeSession> = {}): RunningClaudeSession {
    return { sessionId: "s1", cwd: WT, pid: 4242, startedAt: 1_600_000_000_000, ...over };
  }

  it("resolves no pane — that is the whole point of pacing it at 5 s", async () => {
    // A full pass re-resolves every pane with no proven identity, because
    // negatives are deliberately not cached. Polling that would shell out to
    // `ps` every five seconds forever (design.md D6).
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    await h.projector.project([WT]);
    const before = h.counts().resolves;

    await h.projector.project([WT], { external: true });

    expect(h.counts().resolves).toBe(before);
  });

  it("replays the window rows the last full pass produced", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "pane-session" }));
    await h.projector.project([WT]);

    // Emptying the pane set is what makes this discriminating: a full pass would
    // now produce no window row at all, so a surviving row can only be a replay.
    h.panes.length = 0;
    const presence = await h.projector.project([WT], { external: true });

    expect(presence.rowsByWorktreeId[WT].map((r) => r.rowId)).toEqual(["window:a"]);
  });

  it("still refuses a session the replayed window rows already claim", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1" }));
    await h.projector.project([WT]);

    // The claim has to survive into the replay: with the pane no longer resolved,
    // a lost claim would put the same session on screen as "other window".
    h.setLookup(() => ({ kind: "absent" }));
    h.setRegistry({ kind: "ok", sessions: [session({ sessionId: "s1" })] });
    const presence = await h.projector.project([WT], { external: true });

    expect(presence.rowsByWorktreeId[WT].map((r) => r.rowId)).toEqual(["window:a"]);
  });

  it("picks up a session that appeared since the last full pass", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    await h.projector.project([WT]);

    h.setLookup(() => ({ kind: "absent" }));
    h.setRegistry({ kind: "ok", sessions: [session()] });
    const presence = await h.projector.project([WT], { external: true });

    expect(presence.rowsByWorktreeId[WT].map((r) => r.rowId)).toEqual(["window:a", "external:claude:s1"]);
  });

  it("keeps a pane degradation it did not re-check rather than reporting it healed", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "`ps` timed out" }));
    await h.projector.project([WT]);

    // A full pass here would find the table healthy and drop the entry; only a
    // pass that never re-checked it can honestly keep saying it is out.
    h.setLookup(() => ({ kind: "absent" }));
    const presence = await h.projector.project([WT], { external: true });

    expect(presence.degradedSources).toEqual([{ source: "panes", reason: "`ps` timed out", since: clock }]);
  });

  it("keeps the window rows' ranking contribution", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT, lastOutputAt: 1_690_000_000_000 })]);
    await h.projector.project([WT]);
    const ranked = h.projector.rank(WT);

    h.panes.length = 0;
    await h.projector.project([WT], { external: true });

    expect(h.projector.rank(WT)).toBe(ranked);
  });

  it("runs a full pass instead when the worktree set has moved under it", async () => {
    // A replay attributed against a different tree could name a worktree the
    // tree no longer holds.
    const h = makeProjector([pane({ paneId: "a", cwd: `${NESTED}/src` })]);
    await h.projector.project([WT]);
    const before = h.counts().resolves;

    const presence = await h.projector.project([WT, NESTED], { external: true });

    expect(h.counts().resolves).toBeGreaterThan(before);
    expect(presence.rowsByWorktreeId[NESTED].map((r) => r.rowId)).toEqual(["window:a"]);
  });

  it("runs a full pass when no full pass has happened yet", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);

    const presence = await h.projector.project([WT], { external: true });

    expect(h.counts().resolves).toBe(1);
    expect(presence.rowsByWorktreeId[WT].map((r) => r.rowId)).toEqual(["window:a"]);
  });
});

describe("the registry owns its own degradation entry", () => {
  function session(over: Partial<RunningClaudeSession> = {}): RunningClaudeSession {
    return { sessionId: "s1", cwd: WT, pid: 4242, startedAt: 1_600_000_000_000, ...over };
  }

  it("stops naming the registry as soon as an external-only pass reads it again", async () => {
    // The replay copies forward every failure the last full pass recorded. The
    // registry is not one of them: this pass re-read it, so its own outcome
    // decides — otherwise recovery can never be reported (.reviews/round-1.md B2).
    // Both halves fail together, the way production couples them: a registry
    // read that failed makes every pane lookup inconclusive and names `registry`
    // (D7), so the entry is in the pane pass's own failure set — which is what
    // the replay copies forward.
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    h.setLookup(() => ({ kind: "failed", source: "registry", reason: "registry unreadable (EACCES)" }));
    h.setRegistry({ kind: "failed", reason: "registry unreadable (EACCES)" });
    const failed = await h.projector.project([WT]);
    expect(failed.degradedSources.map((d) => d.source)).toEqual(["registry"]);

    h.setLookup(() => ({ kind: "absent" }));
    h.setRegistry({ kind: "ok", sessions: [session()] });
    const recovered = await h.projector.project([WT], { external: true });

    expect(recovered.degradedSources).toEqual([]);
    expect(recovered.rowsByWorktreeId[WT].map((r) => r.rowId)).toContain("external:claude:s1");
  });

  it("still names it when the external-only pass is the one that could not read it", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    h.setRegistry({ kind: "ok", sessions: [session()] });
    await h.projector.project([WT]);

    h.setRegistry({ kind: "failed", reason: "registry unreadable (EACCES)" });
    const presence = await h.projector.project([WT], { external: true });

    expect(presence.degradedSources.map((d) => d.source)).toEqual(["registry"]);
  });

  it("keeps replaying a pane failure it genuinely did not re-check", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "`ps` timed out" }));
    await h.projector.project([WT]);

    h.setLookup(() => ({ kind: "absent" }));
    const presence = await h.projector.project([WT], { external: true });

    expect(presence.degradedSources.map((d) => d.source)).toEqual(["panes"]);
  });
});

describe("replaying the last full pass", () => {
  it("still replays when the same worktrees arrive in a different order", async () => {
    // The host feeds `project()` the ids in CACHE order, and D12's reorder is
    // exactly what changes that order without changing membership. Comparing
    // positionally makes the first poll after every ranking change reject its
    // own replay and resolve panes — the work D6 exists to avoid
    // (.reviews/round-4.md W3).
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    await h.projector.project([WT, NESTED]);
    const before = h.counts().resolves;

    await h.projector.project([NESTED, WT], { external: true });

    expect(h.counts().resolves).toBe(before);
  });

  it("falls back to a full pass when a worktree was swapped for another", async () => {
    // Same count, different members — the case a length check alone cannot see.
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    await h.projector.project([WT, NESTED]);
    const before = h.counts().resolves;

    await h.projector.project([WT, "/repo-two"], { external: true });

    expect(h.counts().resolves).toBeGreaterThan(before);
  });

  it("still falls back to a full pass when the membership itself changed", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    await h.projector.project([WT, NESTED]);
    const before = h.counts().resolves;

    await h.projector.project([WT], { external: true });

    expect(h.counts().resolves).toBeGreaterThan(before);
  });
});

describe("the rank revision the cache acknowledges", () => {
  it("does not advance when a projection reproduces the same ranks", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT, lastOutputAt: clock + 1_000 })]);
    await h.projector.project([WT]);
    const after = h.projector.rankRevision();

    await h.projector.project([WT]);

    expect(h.projector.rankRevision()).toBe(after);
  });

  it("advances when a worktree gains a row", async () => {
    const h = makeProjector();
    await h.projector.project([WT]);
    const before = h.projector.rankRevision();

    h.setRegistry({ kind: "ok", sessions: [{ sessionId: "s1", cwd: WT, pid: 1, startedAt: 1_600_000_000_000 }] });
    await h.projector.project([WT]);

    expect(h.projector.rankRevision()).toBeGreaterThan(before);
  });

  it("advances when a worktree loses its only row", async () => {
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [{ sessionId: "s1", cwd: WT, pid: 1, startedAt: 1_600_000_000_000 }] });
    await h.projector.project([WT]);
    const before = h.projector.rankRevision();

    h.setRegistry({ kind: "ok", sessions: [] });
    await h.projector.project([WT]);

    expect(h.projector.rankRevision()).toBeGreaterThan(before);
  });

  it("advances when a worktree's newest activity advances", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT, lastOutputAt: clock + 1_000 })]);
    await h.projector.project([WT]);
    const before = h.projector.rankRevision();

    h.panes[0] = pane({ paneId: "a", cwd: WT, lastOutputAt: clock + 99_000 });
    await h.projector.project([WT]);

    expect(h.projector.rankRevision()).toBeGreaterThan(before);
  });

  it("never goes backwards, so a consumer can compare it with what it applied", async () => {
    // The whole point of a revision over a boolean: a projection the host
    // DISCARDED still advanced it, and the identical rerun must not report the
    // ranking back to where the cache already is (.reviews/round-3.md B3).
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [{ sessionId: "s1", cwd: WT, pid: 1, startedAt: 1_600_000_000_000 }] });
    await h.projector.project([WT]);
    const moved = h.projector.rankRevision();

    await h.projector.project([WT]);

    expect(h.projector.rankRevision()).toBe(moved);
  });
});

// ─── WT-006.3 — a reported turn against the inference path ──────────

describe("a reported turn decides activity", () => {
  const turn = (over: Partial<AgentTurnReport> = {}): AgentTurnReport => ({
    state: "working",
    stateStartedAt: clock,
    agentSessionId: "sess-1",
    subagents: [],
    ...over,
  });
  const reported = (over: Partial<AgentTurnReport> = {}, receivedAt = clock): Pane["turn"] => ({
    report: turn(over),
    receivedAt,
  });

  it("outranks the output evidence that contradicts it", async () => {
    const h = makeProjector([pane({ paneId: "a", turn: reported() })]);
    h.setActivity("a", "idle", "quiet");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ activity: "running", activitySource: "hook" });
  });

  it("[I13] lands each turn state on the activity the table names", async () => {
    for (const [state, activity] of [
      ["working", "running"],
      ["waiting", "waiting"],
      ["done", "idle"],
    ] as const) {
      const h = makeProjector([pane({ paneId: "a", turn: reported({ state }) })]);
      h.setActivity("a", "running", "working");

      const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

      expect(row).toMatchObject({ activity, activitySource: "hook" });
    }
  });

  it("[I13] never produces exited, and yields to a pty that did exit", async () => {
    const h = makeProjector([pane({ paneId: "a", exited: true, turn: reported({ state: "working" }) })]);
    h.setActivity("a", "exited", "quiet");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ activity: "exited" });
    expect(row.activitySource).not.toBe("hook");
  });

  it("yields to a shell that has reclaimed the pane", async () => {
    // The agent published `working` and then died without a Stop; the title is
    // the only evidence that anything changed.
    const h = makeProjector([pane({ paneId: "a", turn: reported({ state: "working" }) })]);
    h.setActivity("a", "idle", "shell-title");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ activity: "idle", activitySource: "title" });
  });

  it("falls back to inference once stale, keeping the identity it carried", async () => {
    const h = makeProjector([
      pane({ paneId: "a", turn: reported({ state: "working" }, clock - TURN_FRESHNESS_MS - 1) }),
    ]);
    h.setActivity("a", "idle", "quiet");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ activity: "idle", activitySource: "output" });
  });

  it("clears the prompt a stale report was still carrying", async () => {
    const asking = { state: "waiting" as const, interactivePrompt: '{"approval":{"tool":"Bash"}}' };
    const fresh = makeProjector([pane({ paneId: "a", turn: reported(asking) })]);
    const stale = makeProjector([pane({ paneId: "a", turn: reported(asking, clock - TURN_FRESHNESS_MS - 1) })]);

    const [live] = (await fresh.projector.project([WT])).rowsByWorktreeId[WT];
    const [expired] = (await stale.projector.project([WT])).rowsByWorktreeId[WT];

    expect(live.interactivePrompt).toBe('{"approval":{"tool":"Bash"}}');
    // A question card outliving the question is the bug this guard exists for.
    expect(expired.interactivePrompt).toBeUndefined();
  });

  it("turns a fresh report's delegations into live rows", async () => {
    const h = makeProjector([
      pane({
        paneId: "a",
        turn: reported({
          subagents: [
            { id: "c1", name: "code-reviewer", state: "working", startedAt: clock },
            { id: "c2", state: "done", startedAt: clock },
          ],
        }),
      }),
    ]);

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.delegations).toEqual({
      kind: "ok",
      reported: true,
      rows: [
        { name: "code-reviewer", status: "running", live: true },
        // A child with no reported type still needs a name to render as.
        { name: "subagent", status: "completed", live: true },
      ],
    });
  });

  it("leaves no live child behind once the parent's report is stale", async () => {
    const h = makeProjector([
      pane({
        paneId: "a",
        turn: reported(
          { subagents: [{ id: "c1", name: "code-reviewer", state: "working", startedAt: clock }] },
          clock - TURN_FRESHNESS_MS - 1,
        ),
      }),
    ]);

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.delegations).toBeUndefined();
  });

  it("reports an empty roster as read-and-empty, not as never read", async () => {
    // A fresh report listing no children IS a read that found none. Leaving it
    // absent lets the host reattach the transcript's history, putting finished
    // delegations back on a row whose agent just said it has none (round-1 W1).
    const h = makeProjector([pane({ paneId: "a", turn: reported({ subagents: [] }) })]);

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.delegations).toEqual({ kind: "ok", reported: true, rows: [] });
  });

  it("marks no turn complete when a session boundary lands idle", async () => {
    // § 4.5: a `sessionBoundary` done is recorded but completes nothing. A
    // resume, clear, or return from compaction lands idle without a turn having
    // ended, so it must not stamp a finish time (round-1 B5).
    const h = makeProjector([pane({ paneId: "a", turn: reported({ state: "working" }) })]);
    await h.projector.project([WT]);

    h.panes[0] = pane({ paneId: "a", turn: reported({ state: "done", sessionBoundary: true }) });
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.activity).toBe("idle");
    expect(row.finishedAt).toBeUndefined();
  });

  it("still marks a turn complete when an ordinary turn ends", async () => {
    // The companion to the boundary case: without this, suppressing the finish
    // time for a boundary could just as well be suppressing it for everything.
    const h = makeProjector([pane({ paneId: "a", turn: reported({ state: "working" }) })]);
    await h.projector.project([WT]);

    h.panes[0] = pane({ paneId: "a", turn: reported({ state: "done" }) });
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.activity).toBe("idle");
    expect(row.finishedAt).toBeDefined();
  });

  it("does not resolve a pane by inference once its report has identified it", async () => {
    // Both paths resolving would spend a process-table read on a row the report
    // already decided, and record that read's degradation against a row it did
    // not choose (round-1 W5).
    const h = makeProjector([pane({ paneId: "a", turn: reported({ agentSessionId: "sess-1" }) })]);
    h.setReportedSessions({
      "sess-1": { entryId: "claude:sess-1", agent: "claude", transcriptPath: "/vault/sess-1.jsonl" },
    });
    let inferred = 0;
    h.setLookup(() => {
      inferred += 1;
      return { kind: "resolved", agent: "claude", sessionId: "heuristic-1" };
    });

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBe("claude:sess-1");
    expect(inferred).toBe(0);
  });

  it("takes its identity from a reported session the vault already holds", async () => {
    const h = makeProjector([pane({ paneId: "a", turn: reported({ agentSessionId: "sess-1" }) })]);
    h.setReportedSessions({
      "sess-1": { entryId: "claude:sess-1", agent: "claude", transcriptPath: "/vault/sess-1.jsonl" },
    });

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ entryId: "claude:sess-1", agent: "claude", agentSource: "hook" });
  });

  it("creates nothing for a reported session that resolves to nothing", async () => {
    const h = makeProjector([pane({ paneId: "a", turn: reported({ agentSessionId: "ghost" }) })]);
    h.setReportedSessions({});

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBeUndefined();
    expect(row.agentSource).toBe("none");
  });

  it("falls back to the heuristics for a pane whose report resolves to nothing", async () => {
    const h = makeProjector([pane({ paneId: "a", turn: reported({ agentSessionId: "ghost" }) })]);
    h.setReportedSessions({});
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "heuristic-1" }));

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBe("claude:heuristic-1");
    expect(row.agentSource).not.toBe("hook");
  });

  it("never hands a reported path to the resolver, and never opens one", async () => {
    const h = makeProjector([
      pane({
        paneId: "a",
        turn: reported({ agentSessionId: "sess-1", transcriptPath: "/vault/sess-1.jsonl" }),
      }),
    ]);
    h.setReportedSessions({
      "sess-1": { entryId: "claude:sess-1", agent: "claude", transcriptPath: "/vault/sess-1.jsonl" },
    });

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    // Resolution is by id alone: a reported path is compared at most, and is
    // never the thing that decides what gets opened.
    expect(h.reportedAsked()).toEqual(["sess-1"]);
    expect(row.entryId).toBe("claude:sess-1");
  });

  it("grants no identity when the reported path disagrees with the stored one", async () => {
    // § 4.6: the reported path is compared against the path the store already
    // holds, and a mismatch is dropped. A report that does not agree with itself
    // identifies nothing, and the row falls back to the heuristics (round-1 B2).
    const h = makeProjector([
      pane({
        paneId: "a",
        turn: reported({ agentSessionId: "sess-1", transcriptPath: "/etc/passwd" }),
      }),
    ]);
    h.setReportedSessions({
      "sess-1": { entryId: "claude:sess-1", agent: "claude", transcriptPath: "/vault/sess-1.jsonl" },
    });

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBeUndefined();
    expect(row.agentSource).toBe("none");
  });

  it("accepts a reported path that differs only in how it is written", async () => {
    // The comparison is between paths, not between strings: a report that names
    // the very file the store holds must not be rejected over a separator.
    const h = makeProjector([
      pane({
        paneId: "a",
        turn: reported({ agentSessionId: "sess-1", transcriptPath: "/vault/./sess-1.jsonl" }),
      }),
    ]);
    h.setReportedSessions({
      "sess-1": { entryId: "claude:sess-1", agent: "claude", transcriptPath: "/vault/sess-1.jsonl" },
    });

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBe("claude:sess-1");
  });

  it("keeps a stale report's identity while its activity falls back to inference", async () => {
    // § 4.5: a stale status is identity-only. The pane is still that session —
    // what expired is the claim about what it is doing.
    const h = makeProjector([
      pane({ paneId: "a", turn: reported({ agentSessionId: "sess-1" }, clock - TURN_FRESHNESS_MS - 1) }),
    ]);
    h.setReportedSessions({
      "sess-1": { entryId: "claude:sess-1", agent: "claude", transcriptPath: "/vault/sess-1.jsonl" },
    });
    h.setActivity("a", "idle", "quiet");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ entryId: "claude:sess-1", agentSource: "hook" });
    expect(row.activitySource).toBe("output");
  });

  it("leaves a pane that reported nothing on the inference path", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setActivity("a", "running", "working");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ activity: "running", activitySource: "output" });
  });
});
