// src/worktree/presenceProjector.test.ts — the window's panes becoming rows.
//
// Every dependency is injected, so the whole projection — attribution, the
// resolution slot, timestamps and degradation — is exercised without a process
// table, a registry, or a SessionManager.

import { describe, expect, it, vi } from "vitest";
import type { AgentTurnReport } from "../agentHooks/AgentHookRuntime";
import { TURN_FRESHNESS_MS } from "../session/PaneEvidenceStore";
import type { ActivityRule, PaneActivity } from "../shared/paneEvidence";
import { ResolvedPathMemo } from "../utils/resolvedPathMemo";
import type { RunningClaudeSession, RunningSessionsOutcome } from "../vault/readers/runningSessions";
import type { VaultAgentId } from "../vault/types";
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
  let vaultPreview: ((entryId: string) => Promise<string | undefined>) | undefined;
  let vaultUnderCwd: ((agent: VaultAgentId, cwd: string) => Promise<string | undefined>) | undefined;
  let standingReport: ((paneId: string) => { agent: VaultAgentId; entryId: string } | undefined) | undefined;
  let snapshots = 0;
  let resolves = 0;
  let underCwdCalls = 0;
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
        sessionUnderCwd: async (agent, cwd) => {
          underCwdCalls += 1;
          return vaultUnderCwd ? await vaultUnderCwd(agent, cwd) : undefined;
        },
      };
    },
    normalize: (p) => p,
    sessionTitle: (entryId) => (vaultTitle ? vaultTitle(entryId) : Promise.resolve(undefined)),
    sessionPreview: (entryId) => (vaultPreview ? vaultPreview(entryId) : Promise.resolve(undefined)),
    resolveReportedSession: async (sessionId) => {
      reportedAsked.push(sessionId);
      return reportedSessions[sessionId] ?? null;
    },
    reportedSession: (paneId) => standingReport?.(paneId),
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
    setVaultPreview(next: (entryId: string) => Promise<string | undefined>) {
      vaultPreview = next;
    },
    setVaultUnderCwd(next: (agent: VaultAgentId, cwd: string) => Promise<string | undefined>) {
      vaultUnderCwd = next;
    },
    setReportedSession(next: (paneId: string) => { agent: VaultAgentId; entryId: string } | undefined) {
      standingReport = next;
    },
    setReportedSessions(next: Record<string, ReportedSessionEntry>) {
      reportedSessions = next;
    },
    reportedAsked: () => reportedAsked,
    counts: () => ({ snapshots, resolves, underCwdCalls }),
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
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
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
    h.setLookup(() => ({ kind: "resolved", agent: "codex", sessionId: "s9", evidence: "process" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row).toMatchObject({ agent: "codex", agentSource: "registry", entryId: "codex:s9" });
  });

  it("re-reads once the pane changes directory", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
    await h.projector.project([WT]);
    const before = h.counts().resolves;
    h.panes[0] = pane({ paneId: "a", ptyPid: 42, cwd: `${WT}/deeper` });
    await h.projector.project([WT]);
    expect(h.counts().resolves).toBe(before + 1);
  });

  it("evicts a closed pane's slot instead of holding it forever", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
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
  it("[I1] keeps the proven agent and source when the read fails", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
    await h.projector.project([WT]);

    h.panes[0] = pane({ paneId: "a", ptyPid: 43 });
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "`ps` timed out" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row).toMatchObject({ agent: "claude", agentSource: "registry", entryId: "claude:s1" });
  });

  it("[I1] does not let a failure flip the row to a less active state", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setActivity("a", "running");
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
    await h.projector.project([WT]);

    h.panes[0] = pane({ paneId: "a", ptyPid: 43 });
    h.setLookup(() => ({ kind: "failed", source: "panes", reason: "unreadable" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.activity).toBe("running");
  });

  it("clears the agent on a conclusive empty read, so a real exit is seen", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 42 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
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
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
    const started = clock;
    await h.projector.project([WT]);

    clock += 3_600_000;
    h.panes[0] = pane({ paneId: "a", ptyPid: 2 });
    h.setLookup(() => ({ kind: "resolved", agent: "codex", sessionId: "s2", evidence: "process" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    expect(row.startedAt).toBe(clock);
    expect(row.startedAt).not.toBe(started);
  });

  it("resets the age for a new session of the same agent", async () => {
    const h = makeProjector([pane({ paneId: "a", ptyPid: 1 })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
    await h.projector.project([WT]);

    clock += 60_000;
    h.panes[0] = pane({ paneId: "a", ptyPid: 2 });
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s2", evidence: "process" }));
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
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
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
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s9", evidence: "process" }));

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
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.rowId)).toEqual(["window:a"]);
  });

  it("yields even when the claiming pane is inside no worktree", async () => {
    // The pane produces no row, so the session would otherwise be free — and
    // labelled as running in another window, in the window running it.
    const h = makeProjector([pane({ paneId: "a", cwd: "/somewhere/else" })]);
    h.setRegistry({ kind: "ok", sessions: [session({ sessionId: "s1", cwd: WT })] });
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));

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

  describe("the row's preview line", () => {
    it("carries the session's last activity", async () => {
      const h = makeProjector();
      h.setRegistry({ kind: "ok", sessions: [named()] });
      h.setVaultPreview(async (entryId) => (entryId === "claude:s1" ? "- Approve the git worktree add?" : undefined));

      const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

      expect(row.preview).toBe("- Approve the git worktree add?");
    });

    it("leaves a row the reader does not cover with no preview key at all", async () => {
      // Absent, not empty: an empty string is a placeholder, and the layout draws
      // a second line's worth of height for one.
      const h = makeProjector();
      h.setRegistry({ kind: "ok", sessions: [named()] });
      h.setVaultPreview(async () => undefined);

      const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

      expect("preview" in row).toBe(false);
    });

    it("never asks about a row with no resolved session", async () => {
      const asked: string[] = [];
      const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
      h.setVaultPreview(async (entryId) => {
        asked.push(entryId);
        return "should not appear";
      });

      const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

      expect(row.entryId).toBeUndefined();
      expect("preview" in row).toBe(false);
      expect(asked).toEqual([]);
    });

    it("reports no degraded source for rows it cannot preview", async () => {
      const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
      h.setRegistry({ kind: "ok", sessions: [named()] });
      h.setVaultPreview(async () => undefined);

      const presence = await h.projector.project([WT]);

      expect(presence.degradedSources).toEqual([]);
    });

    it("leaves identity, activity and ranking untouched either way", async () => {
      const withPreview = makeProjector([pane({ paneId: "a" })]);
      const without = makeProjector([pane({ paneId: "a" })]);
      for (const h of [withPreview, without]) {
        h.setRegistry({ kind: "ok", sessions: [named()] });
        h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
      }
      withPreview.setVaultPreview(async () => "a line of transcript");

      const a = (await withPreview.projector.project([WT])).rowsByWorktreeId[WT];
      const b = (await without.projector.project([WT])).rowsByWorktreeId[WT];

      expect(a.map((r) => ({ ...r, preview: undefined }))).toEqual(b.map((r) => ({ ...r, preview: undefined })));
      expect(a[0].preview).toBe("a line of transcript");
    });

    it("projects at all with no preview dep supplied", async () => {
      const panes = [pane({ paneId: "a" })];
      const projector = createPresenceProjector({
        panes: () => panes,
        activityFor: () => ({ activity: "idle", rule: "quiet" }),
        openSnapshot: async () => ({
          resolve: async () => ({ kind: "absent" }),
          sessions: async () => ({ kind: "ok", sessions: [] }),
          sessionUnderCwd: async () => undefined,
        }),
        normalize: (path) => path,
        now: () => clock,
      });

      const [row] = (await projector.project([WT])).rowsByWorktreeId[WT];

      expect("preview" in row).toBe(false);
    });
  });

  it("titles a row from the vault, not from the slug the registry derived", async () => {
    // `nameSource: "derived"` is a slug off the directory: every session in one
    // repo gets the same one, which is what the reporter was looking at.
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named({ name: "cyberk-skills-f9" })] });
    h.setVaultTitle(async (entryId) => (entryId === "claude:s1" ? "Hadern attribution analysis" : undefined));

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("Hadern attribution analysis");
  });

  it("titles a pane from its session, not from the title its shell left behind", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
    h.setRegistry({ kind: "ok", sessions: [named()] });
    h.setLookup(() => ({
      kind: "resolved",
      agent: "claude",
      sessionId: "s1",
      name: "cyberk-skills-f9",
      evidence: "process",
    }));
    h.setVaultTitle(async () => "Fix the worktree row titles");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("Fix the worktree row titles");
  });

  it("falls back to the registry name when the vault cannot title the session", async () => {
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named()] });
    h.setVaultTitle(async () => undefined);

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("hadern-analysis-a7");
  });

  it("keeps the pane's own title when nothing else named the session", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "npm run watch" })]);

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("npm run watch");
  });

  it("reads the vault once per session across passes inside the refresh window", async () => {
    // The read opens a transcript and the poll runs every five seconds.
    let reads = 0;
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named()] });
    h.setVaultTitle(async () => `title ${(reads += 1)}`);

    await h.projector.project([WT]);
    await h.projector.project([WT]);
    const [row] = (await h.projector.project([WT], { external: true })).rowsByWorktreeId[WT];

    expect(reads).toBe(1);
    expect(row.title).toBe("title 1");
  });

  it("re-reads once the cached title has aged out, so a rename reaches the row", async () => {
    let reads = 0;
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named()] });
    h.setVaultTitle(async () => `title ${(reads += 1)}`);

    await h.projector.project([WT]);
    clock += 61_000;
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(reads).toBe(2);
    expect(row.title).toBe("title 2");
  });

  it("keeps the last title it read when a later read fails, rather than demoting the row", async () => {
    // An unreadable transcript is not a session that lost its name.
    let reads = 0;
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named()] });
    h.setVaultTitle(async () => {
      if ((reads += 1) === 1) {
        return "Hadern attribution analysis";
      }
      throw new Error("transcript unreadable");
    });

    await h.projector.project([WT]);
    clock += 61_000;
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("Hadern attribution analysis");
  });

  it("survives a vault read that throws with nothing cached, leaving the fallback in place", async () => {
    const h = makeProjector();
    h.setRegistry({ kind: "ok", sessions: [named()] });
    h.setVaultTitle(async () => {
      throw new Error("transcript unreadable");
    });

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.title).toBe("hadern-analysis-a7");
  });
});

describe("a pane whose agent keeps no PID registry", () => {
  // Only claude publishes `~/.claude/sessions`, so resolution never returns an
  // entryId for opencode — but the vault has its transcript, filed under the
  // directory the pane is sitting in.
  it("titles a proven pane from the newest vault session under its directory", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setLookup(() => ({ kind: "absent" }));
    h.setVaultUnderCwd(async (agent, cwd) => (agent === "opencode" && cwd === WT ? "opencode:ses_abc123" : undefined));
    h.setVaultTitle(async (entryId) => (entryId === "opencode:ses_abc123" ? "Port the pty layer to bun" : undefined));

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBe("opencode:ses_abc123");
    expect(row.title).toBe("Port the pty layer to bun");
  });

  it("leaves the pane's own title alone when the vault has nothing under the directory", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setVaultUnderCwd(async () => undefined);

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBeUndefined();
    expect(row.title).toBe("opencode");
  });

  it("does not scan every vault store for Claude, whose registry owns session lookup", async () => {
    const h = makeProjector([pane({ paneId: "a", shell: "claude", isAgentLaunch: true })]);
    h.setVaultUnderCwd(async () => "claude:stale");

    await h.projector.project([WT]);

    expect(h.counts().underCwdCalls).toBe(0);
  });
});

describe("the agent said which session it is on", () => {
  it("takes the reported session over the one recorded under the directory", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setVaultUnderCwd(async () => "opencode:ses_stale");
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_live" }));
    h.setVaultTitle(async (entryId) => (entryId === "opencode:ses_live" ? "Port the pty layer to bun" : "An old one"));

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBe("opencode:ses_live");
    expect(row.title).toBe("Port the pty layer to bun");
  });

  it("does not go looking under the directory once a pane has reported", async () => {
    let lookups = 0;
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setVaultUnderCwd(async () => {
      lookups += 1;
      return "opencode:ses_stale";
    });
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_live" }));

    await h.projector.project([WT]);

    expect(lookups).toBe(0);
  });

  it("keeps the reported session when a second pane only shares the directory", async () => {
    const h = makeProjector([
      pane({ paneId: "reporter", title: "opencode" }),
      pane({ paneId: "bystander", title: "zsh" }),
    ]);
    h.setReportedSession((paneId) =>
      paneId === "reporter" ? { agent: "opencode", entryId: "opencode:ses_live" } : undefined,
    );
    h.setVaultUnderCwd(async () => "opencode:ses_live");
    h.setVaultTitle(async () => "Port the pty layer to bun");

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.find((r) => r.paneId === "reporter")?.entryId).toBe("opencode:ses_live");
    expect(rows.find((r) => r.paneId === "bystander")?.entryId).toBeUndefined();
  });

  // The report cannot arrive before the pane is proven: the agent has to start
  // before it can say anything, and nothing about the pane moves in between —
  // same pty, same directory — so a cache keyed on those two would answer from
  // the guess forever (.reviews/round-1.md B1).
  it("takes the report that arrives after the pane was already proven", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setVaultUnderCwd(async () => "opencode:ses_stale");
    h.setVaultTitle(async (entryId) => (entryId === "opencode:ses_live" ? "Port the pty layer to bun" : "An old one"));

    const first = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_live" }));
    const second = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    expect(first.entryId).toBe("opencode:ses_stale");
    expect(second.entryId).toBe("opencode:ses_live");
    expect(second.title).toBe("Port the pty layer to bun");
  });

  // A pane is one pty and one directory, and neither moves when the user quits
  // one agent and starts another in it. The report is the only source that
  // notices (.reviews/round-3.md B1).
  it("hands the pane over when the report names a different agent", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_one" }));
    await h.projector.project([WT]);

    h.setReportedSession(() => ({ agent: "codex", entryId: "codex:ses_two" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ agent: "codex", agentSource: "report", entryId: "codex:ses_two" });
  });

  // `agentSource` is what the affordances read: a titled pane that has since
  // reported is proven, and leaving it at `title` withholds the proof it gave.
  it("names the report as the source, not the title it was recognised by", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    await h.projector.project([WT]);

    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_live" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.agentSource).toBe("report");
  });

  // A read that did not conclude says nothing about this pane — but the agent
  // already did, and that answer needs no read at all.
  it("still answers from the report when the registry read fails", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
    h.setLookup(() => ({ kind: "failed", source: "registry", reason: "EACCES" }));
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_live" }));

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ agent: "opencode", agentSource: "report", entryId: "opencode:ses_live" });
  });

  // Reporting can be switched off under a live pane, and the receiver forgets
  // what it held. An identity that rested on a report must go with it.
  it("gives up a report-derived identity once no report stands", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_live" }));
    const first = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    h.setReportedSession(() => undefined);
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(first.agent).toBe("opencode");
    expect(row.agent).toBeUndefined();
    expect(row.agentSource).toBe("none");
  });

  // The guess being right is the dangerous case, not the harmless one: a tie on
  // rank means `settleContestedSessions` gives the session to nobody, so the
  // pane that actually reported loses it (.reviews/round-2.md B1).
  it("still ranks as reported when the report only confirms the guess", async () => {
    const h = makeProjector([
      pane({ paneId: "reporter", title: "opencode" }),
      pane({ paneId: "bystander", title: "opencode" }),
    ]);
    h.setVaultUnderCwd(async () => "opencode:ses_live");
    await h.projector.project([WT]);

    h.setReportedSession((paneId) =>
      paneId === "reporter" ? { agent: "opencode", entryId: "opencode:ses_live" } : undefined,
    );
    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.find((r) => r.paneId === "reporter")?.entryId).toBe("opencode:ses_live");
    expect(rows.find((r) => r.paneId === "bystander")?.entryId).toBeUndefined();
  });

  // A plugin only runs inside the agent, and the credential it posts under was
  // issued to this terminal for this run — so a report is proof the agent is
  // here, not merely a guess about which session it is on.
  it("proves the agent in a pane nothing else recognised", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_live" }));
    h.setVaultTitle(async () => "Port the pty layer to bun");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ agent: "opencode", agentSource: "report", entryId: "opencode:ses_live" });
    expect(row.title).toBe("Port the pty layer to bun");
  });

  // The pane did not restart; only what we know about it changed. Resetting the
  // epoch would show an hour-old session as newly started (.reviews/round-2.md W3).
  it("keeps the row's age when a report corrects the guess", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setVaultUnderCwd(async () => "opencode:ses_stale");
    const first = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    clock += 3_600_000;
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_live" }));
    const second = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    expect(second.entryId).toBe("opencode:ses_live");
    expect(second.startedAt).toBe(first.startedAt);
  });

  it("starts a new epoch when the terminal reports a genuinely different session", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_one" }));
    const first = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    clock += 3_600_000;
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_two" }));
    const second = (await h.projector.project([WT])).rowsByWorktreeId[WT][0];

    expect(second.startedAt).toBe(first.startedAt! + 3_600_000);
  });

  it("moves to the second session the same terminal reports", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "opencode" })]);
    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_one" }));
    await h.projector.project([WT]);

    h.setReportedSession(() => ({ agent: "opencode", entryId: "opencode:ses_two" }));
    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBe("opencode:ses_two");
  });
});

describe("two panes, one session", () => {
  // Resolution's cwd step matches on the directory alone, so every pane sitting
  // where an agent runs resolves to that agent's session — the reporter saw two
  // rows wearing one delegation's title.
  const bothResolve = (
    h: ReturnType<typeof makeProjector>,
    evidence: Record<string, "reported" | "process" | "directory">,
  ) => {
    h.setLookup((paneId) => ({
      kind: "resolved",
      agent: "claude",
      sessionId: "s1",
      evidence: evidence[paneId] ?? "directory",
    }));
    h.setVaultTitle(async () => "Adversarial review of Q3 options");
  };

  it("gives the session to the pane whose process subtree holds it", async () => {
    const h = makeProjector([
      pane({ paneId: "claude-pane", title: "zsh" }),
      pane({ paneId: "shell-pane", title: "npm run watch" }),
    ]);
    bothResolve(h, { "claude-pane": "process" });

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    const claude = rows.find((r) => r.paneId === "claude-pane");
    const shell = rows.find((r) => r.paneId === "shell-pane");

    expect(claude?.entryId).toBe("claude:s1");
    expect(claude?.title).toBe("Adversarial review of Q3 options");
    expect(shell?.entryId).toBeUndefined();
    expect(shell?.title).toBe("npm run watch");
  });

  it("gives the session to the pane the agent itself reported, over the pane holding the process", async () => {
    // A report names one terminal; a process subtree is still only this
    // window's reading of the machine.
    const h = makeProjector([pane({ paneId: "reporter", title: "zsh" }), pane({ paneId: "holder", title: "zsh" })]);
    bothResolve(h, { reporter: "reported", holder: "process" });

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.find((r) => r.paneId === "reporter")?.entryId).toBe("claude:s1");
    expect(rows.find((r) => r.paneId === "holder")?.entryId).toBeUndefined();
  });

  it("gives it to nobody when two panes were both reported", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" }), pane({ paneId: "b", title: "zsh" })]);
    bothResolve(h, { a: "reported", b: "reported" });

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.entryId)).toEqual([undefined, undefined]);
  });

  it("gives it to the directory match when the other pane only had the weakest evidence", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" }), pane({ paneId: "b", title: "zsh" })]);
    h.setLookup((paneId) => ({
      kind: "resolved",
      agent: "claude",
      sessionId: "s1",
      evidence: paneId === "a" ? "directory" : "recent",
    }));
    h.setVaultTitle(async () => "Adversarial review of Q3 options");

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.find((r) => r.paneId === "a")?.entryId).toBe("claude:s1");
    expect(rows.find((r) => r.paneId === "b")?.entryId).toBeUndefined();
  });

  it("gives it to nobody when both panes only guessed from the directory", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" }), pane({ paneId: "b", title: "zsh" })]);
    bothResolve(h, {});

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.entryId)).toEqual([undefined, undefined]);
  });

  // Losing the session is a finding about OWNERSHIP. The name was never contested, and a shell
  // pane has no title of its own to fall back to, so discarding it rendered `(untitled)` for a
  // row whose session had just been resolved.
  it("still names a disowned row when the pane has no title of its own", async () => {
    const h = makeProjector([pane({ paneId: "a", title: undefined }), pane({ paneId: "b", title: undefined })]);
    bothResolve(h, {});

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.entryId)).toEqual([undefined, undefined]);
    expect(rows.map((r) => r.title)).toEqual(["Adversarial review of Q3 options", "Adversarial review of Q3 options"]);
  });

  // `unknown` is a pane nobody reported; `neutral` is a title that named nothing (paneEvidence.ts).
  // Asking whether a title EXISTS conflates them, and a cleared shell title is the live case.
  it("still names a disowned row whose pane reported an empty title", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "" }), pane({ paneId: "b", title: "   " })]);
    bothResolve(h, {});

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.title)).toEqual(["Adversarial review of Q3 options", "Adversarial review of Q3 options"]);
  });

  // The registry publishes cwd-derived slugs; the vault holds the session's real title. Losing the
  // contest must not freeze a row on the weaker of the two.
  it("upgrades a disowned row from the registry name to the vault's title", async () => {
    const h = makeProjector([pane({ paneId: "a", title: undefined }), pane({ paneId: "b", title: undefined })]);
    h.setLookup(() => ({
      kind: "resolved",
      agent: "claude",
      sessionId: "s1",
      name: "cyberk-skills-04",
      evidence: "directory",
    }));
    h.setVaultTitle(async () => "Adversarial review of Q3 options");

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.title)).toEqual(["Adversarial review of Q3 options", "Adversarial review of Q3 options"]);
  });

  it("keeps the registry name when the vault has no title for the session", async () => {
    const h = makeProjector([pane({ paneId: "a", title: undefined }), pane({ paneId: "b", title: undefined })]);
    h.setLookup(() => ({
      kind: "resolved",
      agent: "claude",
      sessionId: "s1",
      name: "cyberk-skills-04",
      evidence: "directory",
    }));
    h.setVaultTitle(async () => undefined);

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.map((r) => r.title)).toEqual(["cyberk-skills-04", "cyberk-skills-04"]);
  });

  it("still prefers the pane's own title over the session it lost", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" }), pane({ paneId: "b", title: "npm run watch" })]);
    bothResolve(h, {});

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(rows.find((r) => r.paneId === "b")?.title).toBe("npm run watch");
  });

  it("takes the agent away too when the session was the only thing naming it", async () => {
    // `agentSource: "registry"` means the row is an agent BECAUSE of the session
    // it just lost; a pane proven by its own process keeps what proved it.
    const h = makeProjector([pane({ paneId: "a", title: "zsh" }), pane({ paneId: "b", title: "zsh" })]);
    bothResolve(h, { a: "process" });

    const rows = (await h.projector.project([WT])).rowsByWorktreeId[WT];
    const disowned = rows.find((r) => r.paneId === "b");

    expect(disowned?.agent).toBeUndefined();
    expect(disowned?.agentSource).toBe("none");
  });

  it("leaves an uncontested session where it resolved, however weak the evidence", async () => {
    const h = makeProjector([pane({ paneId: "a", title: "zsh" })]);
    bothResolve(h, {});

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBe("claude:s1");
    expect(row.title).toBe("Adversarial review of Q3 options");
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
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "pane-session", evidence: "process" }));
    await h.projector.project([WT]);

    // Emptying the pane set is what makes this discriminating: a full pass would
    // now produce no window row at all, so a surviving row can only be a replay.
    h.panes.length = 0;
    const presence = await h.projector.project([WT], { external: true });

    expect(presence.rowsByWorktreeId[WT].map((r) => r.rowId)).toEqual(["window:a"]);
  });

  it("still refuses a session the replayed window rows already claim", async () => {
    const h = makeProjector([pane({ paneId: "a", cwd: WT })]);
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "s1", evidence: "process" }));
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

  it("[I1] keeps replaying a pane failure it genuinely did not re-check", async () => {
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
      return { kind: "resolved", agent: "claude", sessionId: "heuristic-1", evidence: "process" };
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

    expect(row).toMatchObject({ entryId: "claude:sess-1", agent: "claude", agentSource: "report" });
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
    h.setLookup(() => ({ kind: "resolved", agent: "claude", sessionId: "heuristic-1", evidence: "process" }));

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row.entryId).toBe("claude:heuristic-1");
    expect(row.agentSource).not.toBe("report");
  });

  it("[I16] never hands a reported path to the resolver, and never opens one", async () => {
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

  it("[I16] grants no identity when the reported path disagrees with the stored one", async () => {
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

    expect(row).toMatchObject({ entryId: "claude:sess-1", agentSource: "report" });
    expect(row.activitySource).toBe("output");
  });

  it("leaves a pane that reported nothing on the inference path", async () => {
    const h = makeProjector([pane({ paneId: "a" })]);
    h.setActivity("a", "running", "working");

    const [row] = (await h.projector.project([WT])).rowsByWorktreeId[WT];

    expect(row).toMatchObject({ activity: "running", activitySource: "output" });
  });
});

describe("[1_2] enrichment is work only rows consume", () => {
  const named = (over: Partial<RunningClaudeSession> = {}): RunningClaudeSession => ({
    sessionId: "s1",
    cwd: WT,
    pid: 4242,
    startedAt: 1_600_000_000_000,
    name: "hadern-analysis-a7",
    ...over,
  });

  function scoped() {
    const h = makeProjector();
    const titled: string[] = [];
    const previewed: string[] = [];
    h.setRegistry({ kind: "ok", sessions: [named(), named({ sessionId: "s2" })] });
    h.setVaultTitle(async (entryId) => {
      titled.push(entryId);
      return "a title";
    });
    h.setVaultPreview(async (entryId) => {
      previewed.push(entryId);
      return "a line of transcript";
    });
    return { h, titled, previewed };
  }

  it("reads no title and no preview when nobody is drawing rows", async () => {
    // The cost this option exists to remove: roughly one lookup and stat per
    // live external session per poll, for a body drawing no rows at all.
    const { h, titled, previewed } = scoped();

    await h.projector.project([WT], { external: true, enrich: false });

    expect(titled, "titles were read for rows nobody draws").toEqual([]);
    expect(previewed, "previews were read for rows nobody draws").toEqual([]);
  });

  it("still reports the rows and their waiting states", async () => {
    // Presence is exactly what a presence-only subscriber is there for: the
    // count on a scope's escape control is built from these rows.
    const { h } = scoped();

    const enriched = (await h.projector.project([WT], { external: true })).rowsByWorktreeId[WT];
    const bare = (await h.projector.project([WT], { external: true, enrich: false })).rowsByWorktreeId[WT];

    expect(bare.length).toBe(enriched.length);
    expect(bare.map((r) => r.activity)).toEqual(enriched.map((r) => r.activity));
  });

  it("keeps ranking current, so reopening the rail does not reorder every group", async () => {
    // Asserting the VALUE moved, not merely that one is defined: the old rank
    // stays defined and the revision stays equal when ranking goes stale, so
    // both of those hold on exactly the behaviour this forbids (round-1 S1).
    const { h } = scoped();
    await h.projector.project([WT], { external: true });
    const before = h.projector.rank(WT);
    const beforeRevision = h.projector.rankRevision();

    const newer = 1_700_000_000_000;
    h.setRegistry({
      kind: "ok",
      sessions: [named(), named({ sessionId: "s3", startedAt: newer })],
    });
    await h.projector.project([WT], { external: true, enrich: false });

    expect(h.projector.rank(WT), "ranking went stale while enrichment was off").toBe(newer);
    expect(h.projector.rank(WT)).not.toBe(before);
    expect(h.projector.rankRevision()).toBeGreaterThan(beforeRevision);
  });

  it("enriches by default, so every existing caller is unchanged", async () => {
    const { h, previewed } = scoped();
    await h.projector.project([WT], { external: true });
    expect(previewed.length).toBeGreaterThan(0);
  });
});

describe("attribution through a symlink", () => {
  // These build the projector over a REAL `ResolvedPathMemo` with a fake
  // `realpath`, not over a stub `normalize`. The bug this change fixes lived in
  // the seam — the memo, `prepareCwds` and `normalize` agreeing about which
  // side of the comparison is resolved — so a test that stubs `normalize`
  // proves nothing about it.
  const PHYSICAL = "/private/repo/feature";
  const SPELLED = "/link/feature";

  function symlinked(links: Record<string, string>, initial: Pane[]) {
    const memo = new ResolvedPathMemo({
      realpath: async (p) => {
        realpaths.push(p);
        const hit = links[p];
        if (hit === undefined) {
          const error: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
          error.code = "ENOENT";
          throw error;
        }
        return hit;
      },
    });
    const realpaths: string[] = [];
    const panes = [...initial];
    const deps: PresenceProjectorDeps = {
      panes: () => panes,
      activityFor: () => ({ activity: "idle", rule: "quiet" }),
      openSnapshot: async () => ({
        resolve: async () => ({ kind: "absent" }) as SessionLookup,
        sessions: async () => ({ kind: "ok", sessions: [] }),
      }),
      prepareCwds: (paths) => memo.prepare(paths),
      normalize: (p) => memo.resolvedOr(p),
      forgetCwd: (p) => memo.invalidate(p),
      now: () => clock,
    };
    return { projector: createPresenceProjector(deps), panes, realpaths, memo };
  }

  it("puts a pane under the worktree its cwd resolves into, however it is spelled", async () => {
    // Spec: "A pane whose shell reports a symlinked spelling of its worktree".
    // The worktree id arrives already realpathed by `normalizeWorktreePath`;
    // only the pane side was ever unresolved, which is why the row vanished.
    const h = symlinked({ [SPELLED]: PHYSICAL }, [pane({ paneId: "p1", cwd: SPELLED })]);

    const projection = await h.projector.project([PHYSICAL]);

    expect(projection.rowsByWorktreeId[PHYSICAL]?.map((r) => r.paneId)).toEqual(["p1"]);
  });

  it("keeps a pane out of a worktree it is merely spelled beneath", async () => {
    // Spec: "A pane spelled beneath a worktree that resolves elsewhere". The
    // lexical comparison alone says yes here, so this is the half that a
    // `path.resolve` fix would still get wrong.
    const h = symlinked({ "/repo/escape": "/elsewhere/real" }, [pane({ paneId: "p1", cwd: "/repo/escape" })]);

    const projection = await h.projector.project(["/repo"]);

    expect(projection.rowsByWorktreeId["/repo"]).toBeUndefined();
  });

  it("keeps the row it has today when the cwd cannot be resolved", async () => {
    // A worktree mid-creation fails `realpath`. Dropping the row would make
    // this fix a regression on the ordinary case to serve the exotic one.
    const h = symlinked({}, [pane({ paneId: "p1", cwd: "/repo/pending" })]);

    const projection = await h.projector.project(["/repo"]);

    expect(projection.rowsByWorktreeId["/repo"]?.map((r) => r.paneId)).toEqual(["p1"]);
  });

  it("costs one realpath per directory, not one per projection", async () => {
    // The acceptance's cost half: "the per-push paths do not gain an unbounded
    // syscall per comparison". Asserted as a count, because a type-check cannot
    // see it and a passing attribution test would hold either way.
    const h = symlinked({ [SPELLED]: PHYSICAL }, [
      pane({ paneId: "p1", cwd: SPELLED }),
      pane({ paneId: "p2", cwd: SPELLED }),
    ]);

    await h.projector.project([PHYSICAL]);
    await h.projector.project([PHYSICAL]);
    await h.projector.project([PHYSICAL]);

    expect(h.realpaths).toEqual([SPELLED]);
  });

  it("re-resolves a directory a pane has left, and only then", async () => {
    // A pane moving is the one signal that the directory it named may itself
    // have moved. Nothing else in the window observes that, and re-resolving
    // on every pass instead would be the unbounded syscall D1 forbids.
    const links: Record<string, string> = { [SPELLED]: PHYSICAL, "/link/other": "/private/repo/other" };
    const h = symlinked(links, [pane({ paneId: "p1", cwd: SPELLED })]);

    await h.projector.project([PHYSICAL]);
    await h.projector.project([PHYSICAL]);
    expect(h.realpaths).toEqual([SPELLED]);

    h.panes[0] = pane({ paneId: "p1", cwd: "/link/other" });
    await h.projector.project([PHYSICAL]);
    links[SPELLED] = "/private/repo/moved";
    h.panes[0] = pane({ paneId: "p1", cwd: SPELLED });
    await h.projector.project(["/private/repo/moved"]);

    expect(h.realpaths).toEqual([SPELLED, "/link/other", SPELLED]);
  });

  it("attributes a registry session by where its cwd resolves too", async () => {
    // External rows compare the same way, from a set the pane loop never
    // prepared — so they need their own bounded pass, not the pane one.
    const memo = new ResolvedPathMemo({
      realpath: async (p) => (p === SPELLED ? PHYSICAL : Promise.reject(new Error("ENOENT"))),
    });
    const projector = createPresenceProjector({
      panes: () => [],
      activityFor: () => ({ activity: "idle", rule: "quiet" }),
      openSnapshot: async () => ({
        resolve: async () => ({ kind: "absent" }) as SessionLookup,
        sessions: async () => ({
          kind: "ok",
          sessions: [
            {
              sessionId: "s1",
              cwd: SPELLED,
              startedAt: clock,
              pid: 1,
              name: "other window",
            } as unknown as RunningClaudeSession,
          ],
        }),
      }),
      prepareCwds: (paths) => memo.prepare(paths),
      normalize: (p) => memo.resolvedOr(p),
      now: () => clock,
    });

    const projection = await projector.project([PHYSICAL], { external: true });

    expect(projection.rowsByWorktreeId[PHYSICAL]?.map((r) => r.scope)).toEqual(["external"]);
  });
});
