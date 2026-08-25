// src/vault/VaultService.wiring.test.ts — the PRODUCTION per-agent registrations.
// Every other VaultService suite injects its own reader maps, so a default that
// points at the wrong agent's reader stays green everywhere else. These tests
// construct the service with no deps and assert each agent's key reaches that
// agent's module function.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderResultWithState } from "./cacheTypes";
import type { RecordLineResult } from "./readers/recordLine";
import type { VaultSessionDetail, VaultSessionEntry } from "./types";
import { VaultService } from "./VaultService";

const readerResult = (): ReaderResultWithState => ({
  entries: [],
  unreadable: 0,
  cache: { kind: "store", sources: {}, entries: [], unreadable: 0 },
});

const detail = (entryId: string): VaultSessionDetail => ({
  entryId,
  contentKind: "timeline",
  recentActivity: [],
  timeline: [],
  stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
});

const entry = (id: string): VaultSessionEntry => ({
  id,
  agent: "claude",
  sessionId: id,
  title: "",
  cwd: "/w",
  modified: 0,
  flags: {},
  canFork: false,
});

const record = (): RecordLineResult => ({ ok: true, line: "{}" });

const m = vi.hoisted(() => ({
  claudeSessions: vi.fn(),
  claudeDetail: vi.fn(),
  claudeEntry: vi.fn(),
  claudeRecord: vi.fn(),
  claudeSessionPath: vi.fn(),
  codexSessions: vi.fn(),
  codexDetail: vi.fn(),
  codexEntry: vi.fn(),
  codexRecord: vi.fn(),
  codexRename: vi.fn(),
  opencodeSessions: vi.fn(),
  opencodeDetail: vi.fn(),
  opencodeEntry: vi.fn(),
  opencodeRecord: vi.fn(),
  opencodeRename: vi.fn(),
  cursorSessions: vi.fn(),
  cursorDetail: vi.fn(),
  cursorEntry: vi.fn(),
  cursorRecord: vi.fn(),
  cursorWatchPaths: vi.fn(),
}));

vi.mock("./readers/claudeReader", () => ({
  readClaudeSessions: m.claudeSessions,
  readClaudeDetail: m.claudeDetail,
  readClaudeEntry: m.claudeEntry,
  readClaudeMessageRecord: m.claudeRecord,
}));
vi.mock("./readers/claudePaths", () => ({
  claudeRoots: () => ({ projectsDir: "/home/.claude/projects" }),
  resolveClaudeSessionPath: m.claudeSessionPath,
}));
vi.mock("./readers/codexReader", () => ({
  readCodexSessions: m.codexSessions,
  readCodexDetail: m.codexDetail,
  readCodexEntry: m.codexEntry,
  readCodexMessageRecord: m.codexRecord,
  renameCodexThread: m.codexRename,
  codexStoreDirs: () => ({ dbPath: "/home/.codex/state_5.sqlite", sessionsDir: "/home/.codex/sessions" }),
}));
vi.mock("./readers/opencodeReader", () => ({
  readOpenCodeSessions: m.opencodeSessions,
  readOpenCodeDetail: m.opencodeDetail,
  readOpenCodeEntry: m.opencodeEntry,
  readOpenCodeMessageRecord: m.opencodeRecord,
  renameOpenCodeSession: m.opencodeRename,
  opencodeStoreDirs: () => ({ dbPath: "/home/.local/share/opencode/opencode.db" }),
}));
vi.mock("./readers/cursorReader", () => ({
  readCursorSessions: m.cursorSessions,
  readCursorDetail: m.cursorDetail,
  readCursorEntry: m.cursorEntry,
  readCursorMessageRecord: m.cursorRecord,
  resolveCursorSessionWatchPaths: m.cursorWatchPaths,
  resolveCursorLaunchTarget: vi.fn(async () => null),
  verifyCursorLaunchTarget: vi.fn(async () => false),
}));

beforeEach(() => {
  for (const fn of Object.values(m)) {
    fn.mockReset();
  }
  m.claudeSessions.mockResolvedValue(readerResult());
  m.codexSessions.mockResolvedValue(readerResult());
  m.opencodeSessions.mockResolvedValue(readerResult());
  m.cursorSessions.mockResolvedValue(readerResult());
  for (const fn of [m.claudeDetail, m.codexDetail, m.opencodeDetail, m.cursorDetail]) {
    fn.mockImplementation(async (id: string) => detail(id));
  }
  for (const fn of [m.claudeEntry, m.codexEntry, m.opencodeEntry, m.cursorEntry]) {
    fn.mockImplementation(async (id: string) => entry(id));
  }
  for (const fn of [m.claudeRecord, m.codexRecord, m.opencodeRecord, m.cursorRecord]) {
    fn.mockResolvedValue(record());
  }
  m.claudeSessionPath.mockResolvedValue(null);
  m.cursorWatchPaths.mockResolvedValue([]);
});

describe("production detail readers", () => {
  it.each([
    ["claude", "abc-123", () => m.claudeDetail],
    ["codex", "x1", () => m.codexDetail],
    ["opencode", "ses_9", () => m.opencodeDetail],
  ])("routes a %s id to that agent's detail reader", async (agent, sessionId, target) => {
    await new VaultService().getDetail(`${agent}:${sessionId}`);
    expect(target()).toHaveBeenCalledTimes(1);
    expect(target().mock.calls[0][0]).toBe(sessionId);
    for (const other of [m.claudeDetail, m.codexDetail, m.opencodeDetail, m.cursorDetail]) {
      if (other !== target()) {
        expect(other).not.toHaveBeenCalled();
      }
    }
  });

  it("routes a cursor id to the cursor detail reader", async () => {
    await new VaultService().getDetail("cursor:chat-1");
    expect(m.cursorDetail).toHaveBeenCalledTimes(1);
    expect(m.cursorDetail.mock.calls[0][0]).toBe("chat-1");
    expect(m.claudeDetail).not.toHaveBeenCalled();
  });
});

describe("adapter overrides that supply undefined", () => {
  // The two tiers read an absent override in OPPOSITE directions — the optional
  // three must drop (D6's absence-not-stubbed claim), the required four have no
  // absent state and dispatch calls them unguarded — and `Partial` cannot tell
  // them apart without `exactOptionalPropertyTypes`.

  it("keeps the production reader when a REQUIRED capability is overridden with undefined", async () => {
    const service = new VaultService({
      adapters: { claude: { detail: undefined, list: undefined, entry: undefined, record: undefined } },
    });

    await service.getDetail("claude:abc-123");
    await service.getEntry("claude:abc-123");
    await service.readMessageRecord("claude:abc-123", "ref-1");
    await service.list();

    expect(m.claudeDetail).toHaveBeenCalledTimes(1);
    expect(m.claudeEntry).toHaveBeenCalledTimes(1);
    expect(m.claudeRecord).toHaveBeenCalledTimes(1);
    expect(m.claudeSessions).toHaveBeenCalledTimes(1);
  });

  it("still drops an OPTIONAL capability overridden with undefined", async () => {
    const service = new VaultService({
      adapters: { claude: { sessionWatchTargets: undefined, renameNative: undefined } },
    });

    await expect(service.resolveSessionWatchTargets("claude:abc-123")).resolves.toEqual([]);
    await expect(service.writeNativeTitle("claude:abc-123", "New")).resolves.toBe(false);
    expect(m.claudeSessionPath).not.toHaveBeenCalled();
  });

  it("still lets a DEFINED override replace a required capability", async () => {
    const replacement = vi.fn(async () => null);
    const service = new VaultService({ adapters: { claude: { detail: replacement } } });

    await service.getDetail("claude:abc-123");

    expect(replacement).toHaveBeenCalledTimes(1);
    expect(m.claudeDetail).not.toHaveBeenCalled();
  });
});

describe("production entry readers", () => {
  it.each([
    ["claude", () => m.claudeEntry],
    ["codex", () => m.codexEntry],
    ["opencode", () => m.opencodeEntry],
    // The Cursor positive case no other suite covers.
    ["cursor", () => m.cursorEntry],
  ])("resolves a %s entry through that agent's entry reader", async (agent, target) => {
    await new VaultService().getEntry(`${agent}:sid`);
    expect(target()).toHaveBeenCalledTimes(1);
    expect(target().mock.calls[0][0]).toBe("sid");
    for (const other of [m.claudeEntry, m.codexEntry, m.opencodeEntry, m.cursorEntry]) {
      if (other !== target()) {
        expect(other).not.toHaveBeenCalled();
      }
    }
  });

  it("hands the cursor entry reader the service's own reader options", async () => {
    const cursorReaderOptions = { chatsDir: "/tmp/chats" };
    await new VaultService({ cursorReaderOptions }).getEntry("cursor:sid");
    expect(m.cursorEntry).toHaveBeenCalledWith("sid", cursorReaderOptions);
  });
});

describe("production record readers", () => {
  it.each([
    ["claude", () => m.claudeRecord],
    ["codex", () => m.codexRecord],
    ["opencode", () => m.opencodeRecord],
    // The Cursor positive case no other suite covers.
    ["cursor", () => m.cursorRecord],
  ])("resolves a %s message record through that agent's record reader", async (agent, target) => {
    await new VaultService().readMessageRecord(`${agent}:sid`, "ref-1");
    expect(target()).toHaveBeenCalledWith("sid", "ref-1");
    for (const other of [m.claudeRecord, m.codexRecord, m.opencodeRecord, m.cursorRecord]) {
      if (other !== target()) {
        expect(other).not.toHaveBeenCalled();
      }
    }
  });
});

describe("production list readers", () => {
  it("reads every agent's store exactly once per list", async () => {
    await new VaultService().list();
    for (const fn of [m.claudeSessions, m.codexSessions, m.opencodeSessions, m.cursorSessions]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});

describe("production native renamers", () => {
  it("writes a codex title through renameCodexThread", async () => {
    m.codexRename.mockResolvedValue(true);
    await expect(new VaultService().writeNativeTitle("codex:x1", "New")).resolves.toBe(true);
    expect(m.codexRename).toHaveBeenCalledWith("x1", "New");
    expect(m.opencodeRename).not.toHaveBeenCalled();
  });

  it("writes an opencode title through renameOpenCodeSession", async () => {
    m.opencodeRename.mockResolvedValue(true);
    await expect(new VaultService().writeNativeTitle("opencode:ses_1", "New")).resolves.toBe(true);
    expect(m.opencodeRename).toHaveBeenCalledWith("ses_1", "New");
    expect(m.codexRename).not.toHaveBeenCalled();
  });

  it("has no writer for claude, which owns no writable title field", async () => {
    await expect(new VaultService().writeNativeTitle("claude:abc", "New")).resolves.toBe(false);
    expect(m.codexRename).not.toHaveBeenCalled();
    expect(m.opencodeRename).not.toHaveBeenCalled();
  });
});

describe("production session-watch resolution", () => {
  // The negative (unresolved file) case is covered elsewhere; the SUCCESSFUL
  // Claude resolution — the one that turns a resolved path into a watch target —
  // was not covered at all.
  it("watches the resolved Claude transcript file itself", async () => {
    m.claudeSessionPath.mockResolvedValue("/home/.claude/projects/-w/abc-123.jsonl");
    await expect(new VaultService().resolveSessionWatchTargets("claude:abc-123")).resolves.toEqual([
      { baseDir: "/home/.claude/projects/-w", glob: "abc-123.jsonl" },
    ]);
    expect(m.claudeSessionPath).toHaveBeenCalledWith("abc-123");
  });

  it("returns nothing when the Claude transcript cannot be resolved", async () => {
    m.claudeSessionPath.mockResolvedValue(null);
    await expect(new VaultService().resolveSessionWatchTargets("claude:abc-123")).resolves.toEqual([]);
  });
});
