// src/vault/VaultLauncher.test.ts — Unit tests for entry→createSession resolution.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveAgentExecutable } = vi.hoisted(() => ({ resolveAgentExecutable: vi.fn() }));

vi.mock("../cursor/CursorExecutableResolver", () => ({ resolveAgentExecutable }));

import { VaultLaunchError } from "./LaunchBuilder";
import type { VaultSessionEntry } from "./types";
import { VaultLauncher } from "./VaultLauncher";
import type { VaultService } from "./VaultService";

beforeEach(() => {
  resolveAgentExecutable.mockResolvedValue("cursor-agent");
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeEntry(overrides: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:sess-1",
    agent: "claude",
    sessionId: "sess-1",
    title: "t",
    cwd: "/Users/me/proj",
    modified: 1,
    flags: {},
    canFork: true,
    canResume: true,
    ...overrides,
  };
}

// The launcher resolves the single entry by id via getEntry (not the full list);
// the stub returns the matching entry as-is, preserving the test's canFork.
function stubService(entries: VaultSessionEntry[]): VaultService {
  return {
    getEntry: async (entryId: string): Promise<VaultSessionEntry | null> =>
      entries.find((e) => e.id === entryId) ?? null,
  } as unknown as VaultService;
}

describe("VaultLauncher.resolve", () => {
  it("maps a claude resume to createSession options (agent as PTY root) with the auth env override", async () => {
    const launcher = new VaultLauncher(stubService([makeEntry({ flags: { model: "claude-opus-4-7" } })]), {
      ANTHROPIC_API_KEY: "sk-1",
    });
    const opts = await launcher.resolve("claude:sess-1", "resume");
    // The agent CLI is the terminal's process; the session manager respawns a
    // shell in-tab on exit (isAgentLaunch).
    expect(opts.shell).toBe("claude");
    expect(opts.shellArgs).toEqual(["--resume", "sess-1", "--model", "claude-opus-4-7"]);
    expect(opts.isAgentLaunch).toBe(true);
    expect(opts.cwd).toBe("/Users/me/proj");
    expect(opts.env).toEqual({ ANTHROPIC_API_KEY: "sk-1" });
  });

  it("omits env for non-claude agents", async () => {
    const entry = makeEntry({ id: "codex:t1", agent: "codex", sessionId: "t1", cwd: "/c" });
    const launcher = new VaultLauncher(stubService([entry]), {});
    const opts = await launcher.resolve("codex:t1", "resume");
    expect(opts.shell).toBe("codex");
    expect(opts.shellArgs).toEqual(["resume", "t1"]);
    expect(opts.isAgentLaunch).toBe(true);
    expect(opts.env).toBeUndefined();
  });

  it("resolves a fork when the entry is forkable", async () => {
    const launcher = new VaultLauncher(stubService([makeEntry({ canFork: true })]), {});
    const opts = await launcher.resolve("claude:sess-1", "fork");
    expect(opts.shellArgs).toContain("--fork-session");
  });

  it("throws fork-unsupported when forking a non-forkable entry", async () => {
    const launcher = new VaultLauncher(stubService([makeEntry({ canFork: false })]), {});
    await expect(launcher.resolve("claude:sess-1", "fork")).rejects.toMatchObject({ code: "fork-unsupported" });
  });

  it("throws resume-unsupported when selected resume compatibility is unproven", async () => {
    const entry = makeEntry({
      id: "cursor:chat-1",
      agent: "cursor",
      sessionId: "chat-1",
      canFork: false,
      canResume: false,
    });
    const launcher = new VaultLauncher(stubService([entry]), {});
    await expect(launcher.resolve("cursor:chat-1", "resume")).rejects.toMatchObject({ code: "resume-unsupported" });
  });

  it("resumes a compatible Cursor chat through the resolved agent executable", async () => {
    const entry = makeEntry({
      id: "cursor:chat-1",
      agent: "cursor",
      sessionId: "chat-1",
      source: "cli",
      canFork: false,
      canResume: true,
    });
    const launcher = new VaultLauncher(stubService([entry]), {});

    await expect(launcher.resolve("cursor:chat-1", "resume")).resolves.toMatchObject({
      shell: "cursor-agent",
      shellArgs: ["--resume", "chat-1"],
      cwd: "/Users/me/proj",
    });
  });

  it("rejects IDE, project, and forged Cursor Resume capabilities", async () => {
    const entries = [
      makeEntry({
        id: "cursor:ide:d29ya3NwYWNlLTE:composer-1",
        agent: "cursor",
        sessionId: "ide:d29ya3NwYWNlLTE:composer-1",
        source: "ide",
        canFork: false,
        canResume: false,
      }),
      makeEntry({
        id: "cursor:project:cHJvamVjdC0x:chat-1",
        agent: "cursor",
        sessionId: "project:cHJvamVjdC0x:chat-1",
        canFork: false,
        canResume: false,
      }),
      makeEntry({
        id: "cursor:stale",
        agent: "cursor",
        sessionId: "stale",
        canFork: false,
        canResume: true,
      }),
      makeEntry({
        id: "cursor:forged",
        agent: "cursor",
        sessionId: "forged",
        source: "ide",
        canFork: false,
        canResume: true,
      }),
    ];
    const launcher = new VaultLauncher(stubService(entries), {});

    for (const unsupported of entries) {
      await expect(launcher.resolve(unsupported.id, "resume")).rejects.toMatchObject({ code: "resume-unsupported" });
    }
    expect(resolveAgentExecutable).not.toHaveBeenCalled();
  });

  it("allows legacy entries with no resume compatibility field", async () => {
    const entry = makeEntry();
    delete entry.canResume;
    const launcher = new VaultLauncher(stubService([entry]), {});
    await expect(launcher.resolve("claude:sess-1", "resume")).resolves.toMatchObject({ shell: "claude" });
  });

  it("launches Cursor continuation with the resolved executable", async () => {
    const entry = makeEntry({
      id: "cursor:chat-1",
      agent: "cursor",
      sessionId: "chat-1",
      canFork: false,
      canResume: false,
    });
    const launcher = new VaultLauncher(stubService([entry]), {});
    await expect(
      launcher.resolve("cursor:chat-1", "continue", "continue this work", { permissionChoiceId: "force" }),
    ).resolves.toMatchObject({
      shell: "cursor-agent",
      shellArgs: ["--force", "continue this work"],
      cwd: "/Users/me/proj",
    });
  });

  it("fails Cursor launch when no executable resolves", async () => {
    resolveAgentExecutable.mockResolvedValueOnce(null);
    const entry = makeEntry({
      id: "cursor:chat-1",
      agent: "cursor",
      sessionId: "chat-1",
      canFork: false,
      canResume: false,
    });
    const launcher = new VaultLauncher(stubService([entry]), {});
    await expect(launcher.resolve("cursor:chat-1", "continue", "continue this work")).rejects.toMatchObject({
      code: "executable-not-found",
    });
  });

  it("keeps unsupported Cursor fork refused", async () => {
    const entry = makeEntry({
      id: "cursor:chat-1",
      agent: "cursor",
      sessionId: "chat-1",
      canFork: false,
    });
    const launcher = new VaultLauncher(stubService([entry]), {});
    await expect(launcher.resolve("cursor:chat-1", "fork")).rejects.toMatchObject({ code: "fork-unsupported" });
  });

  it("throws unknown-entry for an id not in the list", async () => {
    const launcher = new VaultLauncher(stubService([]), {});
    await expect(launcher.resolve("claude:nope", "resume")).rejects.toBeInstanceOf(VaultLaunchError);
    await expect(launcher.resolve("claude:nope", "resume")).rejects.toMatchObject({ code: "unknown-entry" });
  });
});
