// src/vault/readers/runningSessions.test.ts — Unit tests for the PID-registry reader.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  indexRunningSessions,
  isHeadlessSession,
  listRunningClaudeSessions,
  type RunningClaudeSession,
  type RunningSessionsDeps,
} from "./runningSessions";

let tmpRoot: string;
let sessionsDir: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anywhere-running-"));
  sessionsDir = path.join(tmpRoot, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** Write a `<pid>.json` registry file. */
async function writePidFile(pid: number, body: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(sessionsDir, `${pid}.json`), JSON.stringify(body), "utf8");
}

/** configDir points claudeRoots at our temp `.claude`-equivalent; sessions sit beside projects. */
function opts() {
  return { configDir: tmpRoot };
}

function aliveDeps(alivePids: number[]): RunningSessionsDeps {
  return { isAlive: vi.fn((pid: number) => alivePids.includes(pid)) };
}

describe("listRunningClaudeSessions", () => {
  it("returns one entry per live pid file, keyed fields intact", async () => {
    await writePidFile(100, { pid: 100, sessionId: "sess-a", cwd: "/work/a", startedAt: 111 });
    await writePidFile(200, { pid: 200, sessionId: "sess-b", cwd: "/work/b", startedAt: 222 });

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 200]));

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { pid: 100, sessionId: "sess-a", cwd: "/work/a", startedAt: 111 },
        { pid: 200, sessionId: "sess-b", cwd: "/work/b", startedAt: 222 },
      ]),
    );
  });

  it("skips stale (dead-pid) files", async () => {
    await writePidFile(100, { pid: 100, sessionId: "live", cwd: "/work/a" });
    await writePidFile(200, { pid: 200, sessionId: "dead", cwd: "/work/b" });

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100]));

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("live");
  });

  it("omits startedAt when absent and tolerates missing optional fields", async () => {
    await writePidFile(100, { pid: 100, sessionId: "live", cwd: "/work/a" });
    const [entry] = await listRunningClaudeSessions(opts(), aliveDeps([100]));
    expect(entry).toEqual({ pid: 100, sessionId: "live", cwd: "/work/a" });
    expect("startedAt" in entry).toBe(false);
  });

  it("skips malformed JSON and non-<pid>.json names without failing the scan", async () => {
    await writePidFile(100, { pid: 100, sessionId: "ok", cwd: "/work/a" });
    await fs.writeFile(path.join(sessionsDir, "300.json"), "{ not json", "utf8");
    await fs.writeFile(
      path.join(sessionsDir, "notes.json"),
      JSON.stringify({ pid: 1, sessionId: "x", cwd: "/y" }),
      "utf8",
    );
    await fs.writeFile(path.join(sessionsDir, "999.txt"), "ignored", "utf8");

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 300, 1]));

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("ok");
  });

  it("skips files missing required fields (no sessionId / cwd / pid)", async () => {
    await writePidFile(100, { pid: 100, cwd: "/work/a" }); // no sessionId
    await writePidFile(200, { pid: 200, sessionId: "no-cwd" }); // no cwd
    await writePidFile(300, { sessionId: "no-pid", cwd: "/work/c" }); // no pid

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 200, 300]));
    expect(result).toHaveLength(0);
  });

  it("dedupes by sessionId, keeping the newest startedAt", async () => {
    await writePidFile(100, { pid: 100, sessionId: "dup", cwd: "/work/a", startedAt: 10 });
    await writePidFile(200, { pid: 200, sessionId: "dup", cwd: "/work/a2", startedAt: 99 });

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 200]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 200, startedAt: 99 });
  });

  it("returns [] when the registry dir does not exist", async () => {
    await fs.rm(sessionsDir, { recursive: true, force: true });
    expect(await listRunningClaudeSessions(opts(), aliveDeps([]))).toEqual([]);
  });
});

describe("headless one-shot sessions", () => {
  it("carries `entrypoint` through verbatim when the registry file has one", async () => {
    await writePidFile(100, { pid: 100, sessionId: "a", cwd: "/w", entrypoint: "cli" });
    await writePidFile(200, { pid: 200, sessionId: "b", cwd: "/w", entrypoint: "sdk-cli" });

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 200]));

    expect(result.find((r) => r.sessionId === "a")?.entrypoint).toBe("cli");
    expect(result.find((r) => r.sessionId === "b")?.entrypoint).toBe("sdk-cli");
  });

  it("leaves `entrypoint` undefined when absent or not a string", async () => {
    await writePidFile(100, { pid: 100, sessionId: "absent", cwd: "/w" });
    await writePidFile(200, { pid: 200, sessionId: "nonstring", cwd: "/w", entrypoint: 42 });

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 200]));

    expect(result.find((r) => r.sessionId === "absent")?.entrypoint).toBeUndefined();
    expect(result.find((r) => r.sessionId === "nonstring")?.entrypoint).toBeUndefined();
  });

  it("classifies only known headless entrypoints", () => {
    // Measured against claude 2.1.239: `claude -p` writes entrypoint "sdk-cli"
    // while an interactive session writes "cli".
    expect(isHeadlessSession({ pid: 1, sessionId: "s", cwd: "/w", entrypoint: "sdk-cli" })).toBe(true);
    expect(isHeadlessSession({ pid: 1, sessionId: "s", cwd: "/w", entrypoint: "cli" })).toBe(false);
  });

  it("keeps a session whose entrypoint is unknown, empty, or absent", () => {
    // Allow-list, never `!== "cli"`: a future Claude release adding a new
    // entrypoint value must degrade to today's behaviour, not silently stop
    // resolving the user's real session. See design.md D2.
    expect(isHeadlessSession({ pid: 1, sessionId: "s", cwd: "/w", entrypoint: "vscode" })).toBe(false);
    expect(isHeadlessSession({ pid: 1, sessionId: "s", cwd: "/w", entrypoint: "" })).toBe(false);
    expect(isHeadlessSession({ pid: 1, sessionId: "s", cwd: "/w" })).toBe(false);
  });
});

describe("dedupe across two live entries sharing one sessionId", () => {
  it("keeps the interactive entry even when the headless one started later", async () => {
    // A `claude -p --resume <id>` child writes its own pid file for a session a
    // terminal is still showing. Preferring newer `startedAt` alone would drop
    // the interactive entry, and the caller's headless filter would then remove
    // the survivor — erasing the sessionId entirely. See .reviews/round-1.md [W2].
    await writePidFile(100, { pid: 100, sessionId: "shared", cwd: "/w", startedAt: 100, entrypoint: "cli" });
    await writePidFile(200, { pid: 200, sessionId: "shared", cwd: "/w", startedAt: 999, entrypoint: "sdk-cli" });

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 200]));

    expect(result).toHaveLength(1);
    expect(result[0].pid).toBe(100);
    expect(result[0].entrypoint).toBe("cli");
  });

  it("still prefers the newer entry when both have the same headless-ness", async () => {
    await writePidFile(100, { pid: 100, sessionId: "shared", cwd: "/w", startedAt: 100, entrypoint: "cli" });
    await writePidFile(200, { pid: 200, sessionId: "shared", cwd: "/w", startedAt: 999, entrypoint: "cli" });

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 200]));

    expect(result).toHaveLength(1);
    expect(result[0].pid).toBe(200);
  });
});

describe("dedupe tie-break", () => {
  it("resolves an exact tie by pid rather than readdir order", async () => {
    await writePidFile(100, { pid: 100, sessionId: "shared", cwd: "/w", startedAt: 500, entrypoint: "cli" });
    await writePidFile(200, { pid: 200, sessionId: "shared", cwd: "/w", startedAt: 500, entrypoint: "cli" });

    const result = await listRunningClaudeSessions(opts(), aliveDeps([100, 200]));

    expect(result).toHaveLength(1);
    expect(result[0].pid).toBe(200);
  });
});

describe("indexRunningSessions", () => {
  const live = (sessionId: string, pid: number, cwd: string, entrypoint?: string): RunningClaudeSession => ({
    sessionId,
    pid,
    cwd,
    ...(entrypoint === undefined ? {} : { entrypoint }),
  });

  it("looks up by pid without touching the sessions it was not asked about", () => {
    const index = indexRunningSessions([live("a", 10, "/x"), live("b", 20, "/y"), live("c", 30, "/z")]);
    expect(index.byPid(new Set([20, 999])).map((s) => s.sessionId)).toEqual(["b"]);
  });

  it("groups every session sharing a directory", () => {
    const index = indexRunningSessions([live("a", 10, "/x"), live("b", 20, "/x"), live("c", 30, "/y")]);
    expect(index.byCwd("/x").map((s) => s.sessionId)).toEqual(["a", "b"]);
    expect(index.byCwd("/nowhere")).toEqual([]);
  });

  it("drops headless runs once, so neither lookup can return one", () => {
    // A hook-spawned `claude -p` is a descendant of the pane's pty AND shares
    // its cwd, so it can hijack both lookups.
    const index = indexRunningSessions([live("one-shot", 10, "/x", "sdk-cli"), live("real", 20, "/x", "cli")]);
    expect(index.byPid(new Set([10, 20])).map((s) => s.sessionId)).toEqual(["real"]);
    expect(index.byCwd("/x").map((s) => s.sessionId)).toEqual(["real"]);
  });

  it("keeps an entrypoint it does not recognise, rather than assuming headless", () => {
    const index = indexRunningSessions([live("future", 10, "/x", "some-new-launcher")]);
    expect(index.byPid(new Set([10])).map((s) => s.sessionId)).toEqual(["future"]);
  });

  it("answers an empty registry without inventing anything", () => {
    const index = indexRunningSessions([]);
    expect(index.byPid(new Set([1]))).toEqual([]);
    expect(index.byCwd("/x")).toEqual([]);
  });
});

describe("indexRunningSessions — duplicate pids", () => {
  it("keeps every record claiming one pid, so the tie-break still sees them", () => {
    // The registry dedupes by sessionId and never checks that a `<pid>.json`
    // payload agrees with its filename, so two records can claim one pid. A map
    // keeping the last writer would decide pane identity by enumeration order.
    const index = indexRunningSessions([
      { sessionId: "a", pid: 10, cwd: "/x" },
      { sessionId: "b", pid: 10, cwd: "/y" },
    ]);
    expect(index.byPid(new Set([10])).map((s) => s.sessionId)).toEqual(["a", "b"]);
  });
});
