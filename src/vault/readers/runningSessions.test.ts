// src/vault/readers/runningSessions.test.ts — Unit tests for the PID-registry reader.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  indexRunningSessions,
  isHeadlessSession,
  listRunningClaudeSessions,
  MAX_SESSION_NAME_CHARS,
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

/** The `ok` sessions, failing the test rather than the assertion if the read did not conclude. */
async function liveSessions(
  options: Parameters<typeof listRunningClaudeSessions>[0],
  deps: RunningSessionsDeps,
): Promise<RunningClaudeSession[]> {
  const outcome = await listRunningClaudeSessions(options, deps);
  if (outcome.kind !== "ok") {
    throw new Error(`expected a readable registry, got: ${outcome.reason}`);
  }
  return outcome.sessions;
}

describe("listRunningClaudeSessions", () => {
  it("returns one entry per live pid file, keyed fields intact", async () => {
    await writePidFile(100, { pid: 100, sessionId: "sess-a", cwd: "/work/a", startedAt: 111 });
    await writePidFile(200, { pid: 200, sessionId: "sess-b", cwd: "/work/b", startedAt: 222 });

    const result = await liveSessions(opts(), aliveDeps([100, 200]));

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

    const result = await liveSessions(opts(), aliveDeps([100]));

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("live");
  });

  it("omits startedAt when absent and tolerates missing optional fields", async () => {
    await writePidFile(100, { pid: 100, sessionId: "live", cwd: "/work/a" });
    const [entry] = await liveSessions(opts(), aliveDeps([100]));
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

    const result = await liveSessions(opts(), aliveDeps([100, 300, 1]));

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("ok");
  });

  it("skips files missing required fields (no sessionId / cwd / pid)", async () => {
    await writePidFile(100, { pid: 100, cwd: "/work/a" }); // no sessionId
    await writePidFile(200, { pid: 200, sessionId: "no-cwd" }); // no cwd
    await writePidFile(300, { sessionId: "no-pid", cwd: "/work/c" }); // no pid

    const result = await liveSessions(opts(), aliveDeps([100, 200, 300]));
    expect(result).toHaveLength(0);
  });

  it("dedupes by sessionId, keeping the newest startedAt", async () => {
    await writePidFile(100, { pid: 100, sessionId: "dup", cwd: "/work/a", startedAt: 10 });
    await writePidFile(200, { pid: 200, sessionId: "dup", cwd: "/work/a2", startedAt: 99 });

    const result = await liveSessions(opts(), aliveDeps([100, 200]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 200, startedAt: 99 });
  });

  it("returns [] when the registry dir does not exist", async () => {
    // A machine where the agent has never run genuinely has no sessions; calling
    // that a failed read would degrade every such window forever.
    await fs.rm(sessionsDir, { recursive: true, force: true });
    expect(await listRunningClaudeSessions(opts(), aliveDeps([]))).toEqual({ kind: "ok", sessions: [] });
  });

  it("reports a registry it could not read, with a reason, rather than reporting none", async () => {
    // The silent clear this replaces: `catch { return [] }` made a permissions
    // error indistinguishable from an empty machine.
    await fs.rm(sessionsDir, { recursive: true, force: true });
    await fs.writeFile(sessionsDir, "not a directory", "utf8");

    const outcome = await listRunningClaudeSessions(opts(), aliveDeps([]));

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toMatch(/ENOTDIR|not a directory/i);
    }
  });
});

describe("headless one-shot sessions", () => {
  it("carries `entrypoint` through verbatim when the registry file has one", async () => {
    await writePidFile(100, { pid: 100, sessionId: "a", cwd: "/w", entrypoint: "cli" });
    await writePidFile(200, { pid: 200, sessionId: "b", cwd: "/w", entrypoint: "sdk-cli" });

    const result = await liveSessions(opts(), aliveDeps([100, 200]));

    expect(result.find((r) => r.sessionId === "a")?.entrypoint).toBe("cli");
    expect(result.find((r) => r.sessionId === "b")?.entrypoint).toBe("sdk-cli");
  });

  it("leaves `entrypoint` undefined when absent or not a string", async () => {
    await writePidFile(100, { pid: 100, sessionId: "absent", cwd: "/w" });
    await writePidFile(200, { pid: 200, sessionId: "nonstring", cwd: "/w", entrypoint: 42 });

    const result = await liveSessions(opts(), aliveDeps([100, 200]));

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

    const result = await liveSessions(opts(), aliveDeps([100, 200]));

    expect(result).toHaveLength(1);
    expect(result[0].pid).toBe(100);
    expect(result[0].entrypoint).toBe("cli");
  });

  it("still prefers the newer entry when both have the same headless-ness", async () => {
    await writePidFile(100, { pid: 100, sessionId: "shared", cwd: "/w", startedAt: 100, entrypoint: "cli" });
    await writePidFile(200, { pid: 200, sessionId: "shared", cwd: "/w", startedAt: 999, entrypoint: "cli" });

    const result = await liveSessions(opts(), aliveDeps([100, 200]));

    expect(result).toHaveLength(1);
    expect(result[0].pid).toBe(200);
  });
});

describe("dedupe tie-break", () => {
  it("resolves an exact tie by pid rather than readdir order", async () => {
    await writePidFile(100, { pid: 100, sessionId: "shared", cwd: "/w", startedAt: 500, entrypoint: "cli" });
    await writePidFile(200, { pid: 200, sessionId: "shared", cwd: "/w", startedAt: 500, entrypoint: "cli" });

    const result = await liveSessions(opts(), aliveDeps([100, 200]));

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
    expect(index.all()).toEqual([]);
  });

  it("exposes the same filtered set both lookups are built from", () => {
    // `all()` is what the external-row pass reads. Handing it the reader's raw
    // array instead would put every hook-spawned `claude -p` on screen.
    const index = indexRunningSessions([
      live("one-shot", 10, "/x", "sdk-cli"),
      live("real", 20, "/x", "cli"),
      live("other", 30, "/y"),
    ]);
    expect(index.all().map((s) => s.sessionId)).toEqual(["real", "other"]);
  });
});

describe("the session's own name", () => {
  it("carries the registry's `name` through, so a presence row can be titled", async () => {
    await writePidFile(100, { pid: 100, sessionId: "sess-a", cwd: "/work/a", name: "hadern-analysis-a7" });

    const [session] = await liveSessions(opts(), aliveDeps([100]));

    expect(session.name).toBe("hadern-analysis-a7");
  });

  it("leaves a registry written without one absent, never an empty title", async () => {
    // A claude old enough not to publish `name` must stay distinguishable from
    // one that named the session nothing — the row falls back to the vault.
    await writePidFile(100, { pid: 100, sessionId: "sess-a", cwd: "/work/a" });
    await writePidFile(200, { pid: 200, sessionId: "sess-b", cwd: "/work/b", name: "   " });
    await writePidFile(300, { pid: 300, sessionId: "sess-c", cwd: "/work/c", name: 42 });

    const sessions = await liveSessions(opts(), aliveDeps([100, 200, 300]));

    expect(sessions.map((s) => s.name)).toEqual([undefined, undefined, undefined]);
  });

  it("bounds a name the registry made arbitrarily long", async () => {
    // Another product's format on a shared filesystem, rendered into a row and
    // folded into the tree's render signature.
    await writePidFile(100, { pid: 100, sessionId: "sess-a", cwd: "/work/a", name: "n".repeat(5_000) });

    const [session] = await liveSessions(opts(), aliveDeps([100]));

    expect(session.name).toHaveLength(MAX_SESSION_NAME_CHARS);
  });

  it("resolves one record by the id a pane resolution returned", () => {
    const index = indexRunningSessions([
      { sessionId: "a", pid: 10, cwd: "/x", name: "docs-54" },
      { sessionId: "b", pid: 20, cwd: "/y" },
    ]);

    expect(index.bySessionId("a")?.name).toBe("docs-54");
    expect(index.bySessionId("b")?.name).toBeUndefined();
    expect(index.bySessionId("nope")).toBeUndefined();
  });

  it("cannot resolve a headless run, which the index dropped before keying it", () => {
    const index = indexRunningSessions([{ sessionId: "one-shot", pid: 10, cwd: "/x", entrypoint: "sdk-cli" }]);

    expect(index.bySessionId("one-shot")).toBeUndefined();
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

describe("a record that cannot name a session is not a session", () => {
  it("skips an entry whose sessionId is empty", async () => {
    // An empty id would publish `external:claude:` as a row identity and
    // `claude:` as a vault entry id — an agent handle pointing at nothing.
    await writePidFile(100, { pid: 100, sessionId: "", cwd: "/work/a" });
    await writePidFile(200, { pid: 200, sessionId: "real", cwd: "/work/b" });

    const result = await liveSessions(opts(), aliveDeps([100, 200]));

    expect(result.map((s) => s.sessionId)).toEqual(["real"]);
  });

  it("skips an entry whose cwd is not absolute", async () => {
    // Attribution is a containment test against absolute worktree roots; a
    // relative cwd would be resolved against this process's directory.
    await writePidFile(100, { pid: 100, sessionId: "relative", cwd: "work/a" });
    await writePidFile(200, { pid: 200, sessionId: "real", cwd: "/work/b" });

    const result = await liveSessions(opts(), aliveDeps([100, 200]));

    expect(result.map((s) => s.sessionId)).toEqual(["real"]);
  });
});

describe("a pid file must be named after the process it describes", () => {
  it("skips a record whose filename stem names a different live process", async () => {
    // Claude writes `${process.pid}.json` carrying `pid: process.pid`, so two
    // correctly written live files cannot share one pid. A mismatch is malformed
    // by construction, and trusting the payload would let one impersonate a live
    // process and publish a running row (.reviews/round-2.md B2).
    await writePidFile(77777, { pid: 100, sessionId: "impostor", cwd: "/work/a" });
    await writePidFile(100, { pid: 100, sessionId: "real", cwd: "/work/b" });

    const result = await liveSessions(opts(), aliveDeps([100, 77777]));

    expect(result.map((s) => s.sessionId)).toEqual(["real"]);
  });

  it("keeps a record whose filename stem agrees with its payload", async () => {
    await writePidFile(100, { pid: 100, sessionId: "real", cwd: "/work/a" });
    expect((await liveSessions(opts(), aliveDeps([100]))).map((s) => s.sessionId)).toEqual(["real"]);
  });
});

describe("what a registry record has to prove about its own fields", () => {
  it("skips a record whose session id could not name a transcript", async () => {
    // The id becomes an `entryId` and a row identity, and every downstream
    // Claude reader resolves a transcript by it. "Non-empty" was the wrong bar
    // where a canonical guard already exists (.reviews/round-4.md W4).
    await writePidFile(1, { pid: 1, sessionId: "../../etc/passwd", cwd: "/repo" });
    expect(await liveSessions(opts(), aliveDeps([1]))).toEqual([]);
  });

  it("skips a session id carrying a path separator or a control character", async () => {
    await writePidFile(1, { pid: 1, sessionId: "a/b", cwd: "/repo" });
    await writePidFile(2, { pid: 2, sessionId: "a\u0000b", cwd: "/repo" });
    expect(await liveSessions(opts(), aliveDeps([1, 2]))).toEqual([]);
  });

  it("keeps a record whose launch time is missing, but drops an impossible one", async () => {
    // `typeof x === "number"` admits Infinity — `1e999` parses as one — and
    // negatives, and this value both orders rows and is published as a time.
    // Written as raw text: `1e999` is how the overflow reaches disk, and
    // JSON.stringify cannot express the Infinity it parses back to.
    await fs.writeFile(
      path.join(sessionsDir, "1.json"),
      '{"pid":1,"sessionId":"s1","cwd":"/repo","startedAt":1e999}',
      "utf8",
    );
    await writePidFile(2, { pid: 2, sessionId: "s2", cwd: "/repo", startedAt: -5 });
    await writePidFile(3, { pid: 3, sessionId: "s3", cwd: "/repo" });
    const sessions = await liveSessions(opts(), aliveDeps([1, 2, 3]));
    expect(sessions).toHaveLength(3);
    expect(sessions.every((one) => one.startedAt === undefined)).toBe(true);
  });
});
