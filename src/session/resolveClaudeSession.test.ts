// src/session/resolveClaudeSession.test.ts — Unit tests for terminal→session mapping.

import { describe, expect, it, vi } from "vitest";
import type { RunningClaudeSession } from "../vault/readers/runningSessions";
import { indexRunningSessions } from "../vault/readers/runningSessions";
import { type ResolveClaudeSessionDeps, resolveClaudeSession } from "./resolveClaudeSession";

const TID = "term-1";

function run(sessionId: string, pid: number, cwd: string): RunningClaudeSession {
  return { sessionId, pid, cwd };
}

function makeDeps(overrides: Partial<ResolveClaudeSessionDeps> = {}): ResolveClaudeSessionDeps {
  return {
    getPtyPid: vi.fn(() => 1000),
    getCwd: vi.fn(async () => "/work/proj"),
    runningIndex: vi.fn(async () => indexRunningSessions([])),
    descendantPids: vi.fn(async () => []),
    sessionMtime: vi.fn(async () => 0),
    newestSessionUnderCwd: vi.fn(async () => null),
    ...overrides,
  };
}

describe("resolveClaudeSession — step 1 (process subtree ∩ registry)", () => {
  it("returns the exact session when one running pid is in the pty subtree", async () => {
    const deps = makeDeps({
      descendantPids: vi.fn(async () => [1001, 1002]),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([run("sess-x", 1002, "/launch/cwd"), run("sess-y", 5000, "/other")]),
      ),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "sess-x", cwd: "/launch/cwd", evidence: "process" });
    // An exact subtree hit must NOT consult the cwd fallbacks.
    expect(deps.getCwd).not.toHaveBeenCalled();
  });

  it("tie-breaks >1 subtree matches by newest <sessionId>.jsonl mtime", async () => {
    const deps = makeDeps({
      descendantPids: vi.fn(async () => [1001, 1002]),
      runningIndex: vi.fn(async () => indexRunningSessions([run("old", 1001, "/a"), run("new", 1002, "/b")])),
      sessionMtime: vi.fn(async (id: string) => (id === "new" ? 200 : 100)),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "new", cwd: "/b", evidence: "process" });
  });
});

describe("resolveClaudeSession — step 2 (running by cwd)", () => {
  it("falls back to a running entry whose cwd matches the pane cwd", async () => {
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      descendantPids: vi.fn(async () => [9999]), // no registry pid in subtree
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([run("sess-here", 4242, "/work/proj"), run("elsewhere", 4243, "/other")]),
      ),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "sess-here", cwd: "/work/proj", evidence: "directory" });
  });

  it("tie-breaks multiple cwd matches by newest mtime", async () => {
    const deps = makeDeps({
      descendantPids: vi.fn(async () => []),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("a", 1, "/work/proj"), run("b", 2, "/work/proj")])),
      sessionMtime: vi.fn(async (id: string) => (id === "b" ? 9 : 1)),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "b", cwd: "/work/proj", evidence: "directory" });
  });
});

describe("resolveClaudeSession — step 3 (newest under cwd) + null", () => {
  it("falls back to the newest session under cwd when no running entry matches", async () => {
    const deps = makeDeps({
      descendantPids: vi.fn(async () => []),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("running-elsewhere", 1, "/elsewhere")])),
      newestSessionUnderCwd: vi.fn(async () => ({ sessionId: "exited", cwd: "/work/proj" })),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "exited", cwd: "/work/proj", evidence: "recent" });
  });

  it("returns null when nothing resolves", async () => {
    const deps = makeDeps({
      descendantPids: vi.fn(async () => []),
      getCwd: vi.fn(async () => "/work/proj"),
      newestSessionUnderCwd: vi.fn(async () => null),
    });
    expect(await resolveClaudeSession(TID, deps)).toBeNull();
  });

  it("returns null when the pane has no cwd and no subtree match", async () => {
    const deps = makeDeps({
      getPtyPid: vi.fn(() => undefined), // unknown pane
      getCwd: vi.fn(async () => undefined),
    });
    expect(await resolveClaudeSession(TID, deps)).toBeNull();
    expect(deps.newestSessionUnderCwd).not.toHaveBeenCalled();
  });
});

describe("resolveClaudeSession — Windows / no pty pid", () => {
  it("uses cwd fallbacks when descendantPids returns [] (Windows no-op)", async () => {
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      descendantPids: vi.fn(async () => []), // Windows: empty subtree
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("by-cwd", 7, "/work/proj")])),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "by-cwd", cwd: "/work/proj", evidence: "directory" });
  });
});

describe("resolveClaudeSession — headless one-shot exclusion", () => {
  /** A headless `claude -p` registry entry (entrypoint measured as "sdk-cli"). */
  function headless(sessionId: string, pid: number, cwd: string): RunningClaudeSession {
    return { sessionId, pid, cwd, entrypoint: "sdk-cli" };
  }

  it("prefers the interactive session over a headless child with a newer transcript", async () => {
    // The hook-spawned `claude -p` writes its transcript at that instant, so it
    // wins pickNewest unless it is filtered out first.
    const deps = makeDeps({
      descendantPids: vi.fn(async () => [1001, 1002]),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([
          { ...run("interactive", 1001, "/work/proj"), entrypoint: "cli" },
          headless("one-shot", 1002, "/work/proj"),
        ]),
      ),
      sessionMtime: vi.fn(async (id: string) => (id === "one-shot" ? 999 : 100)),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "interactive", cwd: "/work/proj", evidence: "process" });
  });

  it("falls through to the cwd fallbacks when the subtree holds only a headless run", async () => {
    const deps = makeDeps({
      descendantPids: vi.fn(async () => [1002]),
      runningIndex: vi.fn(async () => indexRunningSessions([headless("one-shot", 1002, "/work/proj")])),
      newestSessionUnderCwd: vi.fn(async () => ({ sessionId: "on-disk", cwd: "/work/proj" })),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "on-disk", cwd: "/work/proj", evidence: "recent" });
  });

  it("excludes a headless run from the cwd fallback too", async () => {
    // Step 2 matches on cwd alone, so a headless run in the same directory can
    // hijack it just as easily as the subtree intersection.
    const deps = makeDeps({
      descendantPids: vi.fn(async () => []),
      runningIndex: vi.fn(async () => indexRunningSessions([headless("one-shot", 7777, "/work/proj")])),
      newestSessionUnderCwd: vi.fn(async () => ({ sessionId: "on-disk", cwd: "/work/proj" })),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "on-disk", cwd: "/work/proj", evidence: "recent" });
  });

  it("keeps a session whose entrypoint is unknown", async () => {
    const deps = makeDeps({
      descendantPids: vi.fn(async () => [1002]),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([{ ...run("future", 1002, "/work/proj"), entrypoint: "some-new-value" }]),
      ),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "future", cwd: "/work/proj", evidence: "process" });
  });
});
