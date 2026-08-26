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
import type { RunningClaudeSession } from "../vault/readers/runningSessions";
import { createPresenceProjectorDeps, type PresenceDepsOptions } from "./presenceDeps";
import { createPresenceProjector } from "./presenceProjector";

const NOW = 1_700_000_000_000;

function running(over: Partial<RunningClaudeSession> = {}): RunningClaudeSession {
  return { pid: 4242, sessionId: "s1", cwd: "/repo", ...over } as RunningClaudeSession;
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

function wire(over: Partial<PresenceDepsOptions> = {}) {
  const store = createPaneEvidenceStore({ now: () => NOW });
  const processTable = table();
  const listRunning = vi.fn(async () => [] as RunningClaudeSession[]);
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
      listRunning: async () => [],
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
    const listRunning = vi.fn(async () => [running(), running({ pid: 4343, sessionId: "s2", cwd: "/repo/app" })]);
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
      listRunning: async () => [running(), running({ pid: 4343, sessionId: "s2" })],
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
      listRunning: async () => [running()],
    });
    store.create("a", { cwd: "/repo", ptyPid: 10 });

    const [row] = (await projector.project(["/repo"])).rowsByWorktreeId["/repo"];
    expect(row).toMatchObject({ agent: "claude", agentSource: "registry", entryId: "claude:s1" });
  });

  it("degrades rather than clearing when the process table cannot be read", async () => {
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
    const { store, projector } = wire({ listRunning: async () => [] });
    store.create("a", { cwd: "/repo", ptyPid: 10 });

    const [row] = (await projector.project(["/repo"])).rowsByWorktreeId["/repo"];
    expect(row.agent).toBeUndefined();
    expect(row.agentSource).toBe("none");
  });

  it("still resolves by cwd when the subtree lookup finds nothing", async () => {
    const { store, projector } = wire({ listRunning: async () => [running({ pid: 999, cwd: "/repo/app" })] });
    store.create("a", { cwd: "/repo/app", ptyPid: 10 });

    const [row] = (await projector.project(["/repo"])).rowsByWorktreeId["/repo"];
    expect(row).toMatchObject({ agent: "claude", agentSource: "registry" });
  });

  it("lets the launch record beat the registry, keeping the session handle", async () => {
    const { store, projector } = wire({
      table: table({ kind: "ok", pids: [4242] }),
      listRunning: async () => [running()],
    });
    store.create("a", { cwd: "/repo", ptyPid: 10, shell: "claude", isAgentLaunch: true });

    const [row] = (await projector.project(["/repo"])).rowsByWorktreeId["/repo"];
    expect(row).toMatchObject({ agentSource: "launch", entryId: "claude:s1" });
  });
});
