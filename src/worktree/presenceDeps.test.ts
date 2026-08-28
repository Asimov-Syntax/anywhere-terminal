// src/worktree/presenceDeps.test.ts — the production wiring, driven with a real
// evidence store and faked external readers.
//
// What matters here is that the projector's sources are the window's real ones
// and that one rebuild costs one read of each shared source, whatever the pane
// count. The projector's own rules are covered in presenceProjector.test.ts.

import { describe, expect, it, vi } from "vitest";
import type { DescendantsOutcome, ProcessTableSnapshot } from "../pty/processTableSnapshot";
import { createProcessTableSnapshot } from "../pty/processTableSnapshot";
import { createPaneEvidenceStore } from "../session/PaneEvidenceStore";
import type { RunningClaudeSession, RunningSessionsOutcome } from "../vault/readers/runningSessions";
import type { VaultAgentId, VaultSessionEntry } from "../vault/types";
import { createPresenceProjectorDeps, type PresenceDepsOptions, REPORTED_SESSION_CACHE_CAP } from "./presenceDeps";
import { createPresenceProjector } from "./presenceProjector";

const NOW = 1_700_000_000_000;

function running(over: Partial<RunningClaudeSession> = {}): RunningClaudeSession {
  return { pid: 4242, sessionId: "s1", cwd: "/repo", ...over } as RunningClaudeSession;
}

function entry(over: Partial<VaultSessionEntry> & { id: string; agent: VaultAgentId; cwd: string; modified: number }) {
  return { sessionId: over.id, title: "", flags: {}, canFork: false, ...over } as VaultSessionEntry;
}

/**
 * A table that counts the reads it is asked for.
 *
 * `open` is what the projection must use: one table per rebuild, however many
 * panes look at it and however long the rebuild takes.
 */
function table(outcome: DescendantsOutcome = { kind: "ok", pids: [] }) {
  const descendantsOf = vi.fn(async (): Promise<DescendantsOutcome> => outcome);
  const open = vi.fn(async () => ({ descendantsOf: () => outcome }));
  return { descendantsOf, open } as ProcessTableSnapshot & { descendantsOf: typeof descendantsOf; open: typeof open };
}

/** A readable registry holding exactly these sessions. */
function ok(...sessions: RunningClaudeSession[]): RunningSessionsOutcome {
  return { kind: "ok", sessions };
}

function wire(over: Partial<PresenceDepsOptions> = {}) {
  const store = createPaneEvidenceStore({ now: () => NOW });
  const processTable = table();
  const listRunning = vi.fn(async (): Promise<RunningSessionsOutcome> => ok());
  const deps = createPresenceProjectorDeps({
    store,
    table: processTable,
    listRunning,
    sessionMtime: async () => 1,
    now: () => NOW,
    ...over,
  });
  return { store, processTable, listRunning, deps, projector: createPresenceProjector(deps) };
}

describe("the pane set comes from the store", () => {
  it("enumerates each pane with the facts the projection reads", () => {
    const { store, deps } = wire();
    store.create("a", { viewId: "sidebar", cwd: "/repo", ptyPid: 10, shell: "claude", isAgentLaunch: true });

    expect(deps.panes()).toEqual([
      expect.objectContaining({
        paneId: "a",
        viewId: "sidebar",
        cwd: "/repo",
        ptyPid: 10,
        shell: "claude",
        isAgentLaunch: true,
      }),
    ]);
  });

  it("reads activity through the store, so both surfaces answer alike", () => {
    const { store, deps } = wire();
    store.create("a", { cwd: "/repo" });
    store.markExited("a", true);
    expect(deps.activityFor("a")).toMatchObject({ activity: "exited" });
  });

  it("omits a pane with no directory rather than attributing it anywhere", async () => {
    const { store, projector } = wire();
    store.create("a", { ptyPid: 10 });
    expect((await projector.project(["/repo"])).rowsByWorktreeId).toEqual({});
  });

  it("resolves a relative or dot-laden cwd against the worktree it is in", async () => {
    const { store, projector } = wire();
    store.create("a", { cwd: "/repo/src/../src/lib" });
    expect(Object.keys((await projector.project(["/repo"])).rowsByWorktreeId)).toEqual(["/repo"]);
  });
});

describe("one read of each shared source per rebuild", () => {
  it("reads the process table and the registry once across many panes", async () => {
    const { store, processTable, listRunning, projector } = wire();
    for (const id of ["a", "b", "c", "d"]) {
      store.create(id, { cwd: "/repo", ptyPid: Number(`1${id.charCodeAt(0)}`) });
    }

    await projector.project(["/repo"]);

    expect(listRunning).toHaveBeenCalledTimes(1);
    expect(processTable.open).toHaveBeenCalledTimes(1);
    // Never the per-call form: that one re-checks the TTL on every pane.
    expect(processTable.descendantsOf).not.toHaveBeenCalled();
  });

  it("reads the vault once however many panes fall back to it", async () => {
    const listSessions = vi.fn(async () => [
      entry({ id: "opencode:ses_one", agent: "opencode", cwd: "/repo", modified: 10 }),
      entry({ id: "opencode:ses_two", agent: "opencode", cwd: "/repo", modified: 20 }),
      entry({ id: "codex:ses_three", agent: "codex", cwd: "/repo", modified: 5 }),
    ]);
    const { deps } = wire({ listSessions });
    const snapshot = await deps.openSnapshot();

    const answers = [
      await snapshot.sessionUnderCwd?.("opencode", "/repo"),
      await snapshot.sessionUnderCwd?.("opencode", "/repo"),
      await snapshot.sessionUnderCwd?.("codex", "/repo"),
    ];

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(answers).toEqual(["opencode:ses_two", "opencode:ses_two", "codex:ses_three"]);
  });

  it("gives a directory nothing when the vault recorded nothing for that agent there", async () => {
    const { deps } = wire({
      listSessions: async () => [entry({ id: "opencode:ses_one", agent: "opencode", cwd: "/elsewhere", modified: 10 })],
    });

    expect(await (await deps.openSnapshot()).sessionUnderCwd?.("opencode", "/repo")).toBeUndefined();
  });

  it("still reads once when a slow rebuild crosses the table's TTL between panes", async () => {
    // Pane resolutions are sequential and awaited. A TTL that expires between
    // two of them is exactly how a rebuild grows a second `ps` — and resolves
    // its panes against two different moments.
    let millis = 0;
    const exec = vi.fn(async () => ({ stdout: "  PID  PPID\n", stderr: "" }));
    const store = createPaneEvidenceStore({ now: () => NOW });
    const base = createPresenceProjectorDeps({
      store,
      table: createProcessTableSnapshot({ exec, platform: "darwin", ttlMs: 1_000, now: () => millis }),
      listRunning: async () => ok(),
      sessionMtime: async () => 1,
      now: () => NOW,
    });
    // The clock crosses the TTL between one pane's resolution and the next.
    const projector = createPresenceProjector({
      ...base,
      activityFor: (paneId, at) => {
        millis += 60_000;
        return base.activityFor(paneId, at);
      },
    });
    for (const id of ["a", "b", "c"]) {
      store.create(id, { cwd: "/repo", ptyPid: 100 + id.charCodeAt(0) });
    }

    await projector.project(["/repo"]);

    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("indexes the registry once, however many panes resolve against it", async () => {
    // `~/.claude/sessions` is user-wide, so a per-pane filter grows with every
    // live Claude session on the machine, not with this window.
    const listRunning = vi.fn(async () => ok(running(), running({ pid: 4343, sessionId: "s2", cwd: "/repo/app" })));
    const { store, projector } = wire({ table: table({ kind: "ok", pids: [] }), listRunning });
    for (const id of ["a", "b", "c", "d", "e"]) {
      store.create(id, { cwd: "/repo", ptyPid: 100 + id.charCodeAt(0) });
    }

    await projector.project(["/repo"]);

    expect(listRunning).toHaveBeenCalledTimes(1);
  });

  it("does not touch the process table for a pane with no pty", async () => {
    const { store, processTable, projector } = wire();
    store.create("a", { cwd: "/repo" });
    await projector.project(["/repo"]);
    expect(processTable.open).not.toHaveBeenCalled();
    expect(processTable.descendantsOf).not.toHaveBeenCalled();
  });

  it("resolves each transcript's mtime once, not once per pane that tie-breaks on it", async () => {
    // `resolveClaudeSessionPath` scans every Claude project directory, so an
    // un-memoized tie-break is O(panes x sessions x dirs) filesystem probes on
    // the 150 ms projection path.
    const sessionMtime = vi.fn(async (_sessionId: string) => 1);
    const { store, projector } = wire({
      table: table({ kind: "ok", pids: [4242, 4343] }),
      listRunning: async () => ok(running(), running({ pid: 4343, sessionId: "s2" })),
      sessionMtime,
    });
    for (const id of ["a", "b", "c", "d"]) {
      store.create(id, { cwd: "/repo", ptyPid: 100 + id.charCodeAt(0) });
    }

    await projector.project(["/repo"]);

    expect(new Set(sessionMtime.mock.calls.map((c) => c[0]))).toEqual(new Set(["s1", "s2"]));
    expect(sessionMtime).toHaveBeenCalledTimes(2);
  });
});

describe("resolution", () => {
  it("proves the pane's agent from a live session inside its process subtree", async () => {
    const { store, projector } = wire({
      table: table({ kind: "ok", pids: [4242] }),
      listRunning: async () => ok(running()),
    });
    store.create("a", { cwd: "/repo", ptyPid: 10 });

    const [row] = (await projector.project(["/repo"])).rowsByWorktreeId["/repo"];
    expect(row).toMatchObject({ agent: "claude", agentSource: "registry", entryId: "claude:s1" });
  });

  it("[I1] degrades rather than clearing when the process table cannot be read", async () => {
    const { store, projector } = wire({ table: table({ kind: "failed", reason: "`ps` timed out" }) });
    store.create("a", { cwd: "/repo", ptyPid: 10 });

    const presence = await projector.project(["/repo"]);
    expect(presence.degradedSources).toEqual([
      { source: "panes", reason: "`ps` timed out", since: expect.any(Number) },
    ]);
  });

  it("treats an unsupported platform as a real empty subtree, not a failure", async () => {
    const { store, projector } = wire({ table: table({ kind: "unsupported" }) });
    store.create("a", { cwd: "/repo", ptyPid: 10 });

    const presence = await projector.project(["/repo"]);
    expect(presence.degradedSources).toEqual([]);
    expect(presence.rowsByWorktreeId["/repo"][0].agentSource).toBe("none");
  });

  it("refuses to claim an agent from a transcript left behind under the directory", async () => {
    // The newest session recorded under a cwd proves an agent ran there once,
    // never that one is in this pane now — a plain shell would inherit it.
    const { store, projector } = wire({ listRunning: async () => ok() });
    store.create("a", { cwd: "/repo", ptyPid: 10 });

    const [row] = (await projector.project(["/repo"])).rowsByWorktreeId["/repo"];
    expect(row.agent).toBeUndefined();
    expect(row.agentSource).toBe("none");
  });

  it("still resolves by cwd when the subtree lookup finds nothing", async () => {
    const { store, projector } = wire({ listRunning: async () => ok(running({ pid: 999, cwd: "/repo/app" })) });
    store.create("a", { cwd: "/repo/app", ptyPid: 10 });

    const [row] = (await projector.project(["/repo"])).rowsByWorktreeId["/repo"];
    expect(row).toMatchObject({ agent: "claude", agentSource: "registry" });
  });

  it("lets the launch record beat the registry, keeping the session handle", async () => {
    const { store, projector } = wire({
      table: table({ kind: "ok", pids: [4242] }),
      listRunning: async () => ok(running()),
    });
    store.create("a", { cwd: "/repo", ptyPid: 10, shell: "claude", isAgentLaunch: true });

    const [row] = (await projector.project(["/repo"])).rowsByWorktreeId["/repo"];
    expect(row).toMatchObject({ agentSource: "launch", entryId: "claude:s1" });
  });
});

describe("the rebuild's registry read, exposed intact", () => {
  it("hands the external pass the headless-filtered set, not the reader's array", async () => {
    // The headless drop lives in `indexRunningSessions`. Exposing the reader's
    // array here would put every hook-spawned `claude -p` on screen as an agent.
    const listRunning = vi.fn(async () =>
      ok(
        running({ sessionId: "real", pid: 10, entrypoint: "cli" }),
        running({ sessionId: "one-shot", pid: 11, entrypoint: "sdk-cli" }),
      ),
    );
    const { deps } = wire({ listRunning });

    const snapshot = await deps.openSnapshot();
    const outcome = await snapshot.sessions();

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.sessions.map((s) => s.sessionId)).toEqual(["real"]);
    }
    expect(listRunning).toHaveBeenCalledTimes(1);
  });

  it("serves the external pass and pane resolution from one read", async () => {
    const listRunning = vi.fn(async () => ok(running({ pid: 4242, sessionId: "s1", cwd: "/repo" })));
    const { store, deps } = wire({ listRunning });
    store.create("a", { cwd: "/repo", ptyPid: 10 });

    const snapshot = await deps.openSnapshot();
    await snapshot.sessions();
    await snapshot.resolve({ paneId: "a", ptyPid: 10, cwd: "/repo" });
    await snapshot.sessions();

    expect(listRunning).toHaveBeenCalledTimes(1);
  });

  it("[I1] reports a registry it could not read rather than an empty one", async () => {
    const { deps } = wire({ listRunning: async () => ({ kind: "failed", reason: "EACCES on the registry" }) });

    const outcome = await (await deps.openSnapshot()).sessions();

    expect(outcome).toEqual({ kind: "failed", reason: "EACCES on the registry" });
  });

  it("[I1] makes pane identity inconclusive when that read failed, naming the registry", async () => {
    // Without this the failure degrades to an empty index, resolution finds
    // nothing, and the projector reads that as a CONCLUSIVE absence — clearing
    // the identity of every pane it had proven (design.md D7).
    const { deps } = wire({ listRunning: async () => ({ kind: "failed", reason: "EACCES on the registry" }) });

    const lookup = await (await deps.openSnapshot()).resolve({ paneId: "a", ptyPid: 10, cwd: "/repo" });

    expect(lookup).toEqual({ kind: "failed", source: "registry", reason: "EACCES on the registry" });
  });

  it("still reports the process table when that is the half that failed", async () => {
    const { deps } = wire({ table: table({ kind: "failed", reason: "`ps` timed out" }) });

    const lookup = await (await deps.openSnapshot()).resolve({ paneId: "a", ptyPid: 10, cwd: "/repo" });

    expect(lookup).toEqual({ kind: "failed", source: "panes", reason: "`ps` timed out" });
  });
});

// ── WT-006.3 — the reported-session cache ─────────────────────────────────

describe("resolving a session an agent reported", () => {
  it("asks once for a session it has already resolved", async () => {
    const calls: string[] = [];
    const { deps } = wire({
      sessionPath: async (sessionId) => {
        calls.push(sessionId);
        return "/vault/s1.jsonl";
      },
    });

    await deps.resolveReportedSession?.("s1");
    await deps.resolveReportedSession?.("s1");

    expect(calls).toEqual(["s1"]);
  });

  it("asks again after a miss, because the transcript may not have existed yet", async () => {
    // A pane can report its session before the file is written. Remembering the
    // miss would answer every later projection with that one moment (round-1 B6).
    let path: string | null = null;
    const calls: string[] = [];
    const { deps } = wire({
      sessionPath: async (sessionId) => {
        calls.push(sessionId);
        return path;
      },
    });

    expect(await deps.resolveReportedSession?.("s1")).toBeNull();
    path = "/vault/s1.jsonl";

    expect(await deps.resolveReportedSession?.("s1")).toEqual({
      entryId: "claude:s1",
      agent: "claude",
      transcriptPath: "/vault/s1.jsonl",
    });
    expect(calls).toEqual(["s1", "s1"]);
  });

  it("keeps the cache bounded by forgetting the oldest resolved session", async () => {
    const calls: string[] = [];
    const { deps } = wire({
      sessionPath: async (sessionId) => {
        calls.push(sessionId);
        return `/vault/${sessionId}.jsonl`;
      },
    });

    for (let i = 0; i <= REPORTED_SESSION_CACHE_CAP; i++) {
      await deps.resolveReportedSession?.(`s${i}`);
    }
    // The first is gone, so asking for it again costs a second read.
    await deps.resolveReportedSession?.("s0");

    expect(calls).toHaveLength(REPORTED_SESSION_CACHE_CAP + 2);
    expect(calls.at(-1)).toBe("s0");
  });

  it("does not let an evicted read's cleanup discard the read that replaced it", async () => {
    // The evicted promise settles LAST here. Deleting by id alone would drop the
    // live entry installed after it, defeating the deduplication the cache is
    // for (round-2.md W7).
    const calls: string[] = [];
    let releaseFirst: ((value: string | null) => void) | undefined;
    const { deps } = wire({
      sessionPath: async (sessionId) => {
        calls.push(sessionId);
        if (sessionId === "slow" && releaseFirst === undefined) {
          return new Promise<string | null>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return `/vault/${sessionId}.jsonl`;
      },
    });

    const first = deps.resolveReportedSession?.("slow");
    // Push it out of the cache while it is still in flight.
    for (let i = 0; i < REPORTED_SESSION_CACHE_CAP; i++) {
      await deps.resolveReportedSession?.(`filler${i}`);
    }
    // A second read for the same session installs a fresh, resolved entry.
    await deps.resolveReportedSession?.("slow");
    const callsBefore = calls.length;

    // Now let the evicted one settle as a miss.
    releaseFirst?.(null);
    await first;
    await deps.resolveReportedSession?.("slow");

    expect(calls).toHaveLength(callsBefore);
  });
});
