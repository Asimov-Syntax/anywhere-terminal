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
function stubService(
  entries: VaultSessionEntry[],
  verify: (entry: VaultSessionEntry) => Promise<boolean> = async () => true,
): VaultService {
  return {
    getLaunchTarget: async (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId);
      return entry ? { entry, verify: () => verify(entry) } : null;
    },
    getEntry: async (entryId: string) => entries.find((e) => e.id === entryId) ?? null,
  } as unknown as VaultService;
}

/** The real service's launch-target resolver is CLI-only: a Cursor IDE entry or an
 *  issued child locator resolves through getEntry but has NO launch target (B18). */
function cliOnlyService(entry: VaultSessionEntry): VaultService {
  return {
    getLaunchTarget: async () => null,
    getEntry: async (entryId: string) => (entryId === entry.id ? entry : null),
  } as unknown as VaultService;
}

function cursorCliEntry(): VaultSessionEntry {
  return makeEntry({
    id: "cursor:chat-1",
    agent: "cursor",
    sessionId: "chat-1",
    source: "cli",
    canFork: false,
    canResume: true,
  });
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
      // Source-qualified and marked resumable, but a forged path-traversing chat id —
      // the canonical isSafeCursorChatId validator must still reject it at this boundary.
      makeEntry({
        id: "cursor:../../etc/passwd",
        agent: "cursor",
        sessionId: "../../etc/passwd",
        source: "cli",
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

  it("refuses a Cursor resume whose stored identity fails the proof, before any executable probe", async () => {
    const verify = vi.fn(async () => false);
    const launcher = new VaultLauncher(stubService([cursorCliEntry()], verify), {});
    await expect(launcher.resolve("cursor:chat-1", "resume")).rejects.toMatchObject({
      code: "resume-unsupported",
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(resolveAgentExecutable).not.toHaveBeenCalled();
  });

  it("skips the resume proof for continue and fork", async () => {
    const verify = vi.fn(async () => false);
    const launcher = new VaultLauncher(stubService([cursorCliEntry()], verify), {});
    await expect(launcher.resolve("cursor:chat-1", "continue", "carry on")).resolves.toMatchObject({
      shell: "cursor-agent",
    });
    expect(verify).not.toHaveBeenCalled();
  });

  /** B17: the launch target carries the proof for the location it resolved, so
   *  Resume never re-discovers the candidate and can't bind to a different one. */
  it("resolves the launch target once and proves that same target", async () => {
    const entry = cursorCliEntry();
    const verify = vi.fn(async () => true);
    let resolutions = 0;
    const service = {
      getLaunchTarget: async (entryId: string) => {
        resolutions++;
        return entryId === entry.id ? { entry, verify } : null;
      },
      getEntry: () => {
        throw new Error("Resume must not fall back to a second discovery");
      },
    } as unknown as VaultService;

    await new VaultLauncher(service, {}).resolve("cursor:chat-1", "resume");
    expect(resolutions).toBe(1);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  /** B18: Continue/Fork must not require a CLI launch target — a Cursor IDE
   *  entry and an issued child locator resolve only through getEntry. */
  it("continues a Cursor IDE entry that has no CLI launch target", async () => {
    const ide = makeEntry({
      id: "cursor:ide:d29ya3NwYWNlLTE:composer-1",
      agent: "cursor",
      sessionId: "ide:d29ya3NwYWNlLTE:composer-1",
      source: "ide",
      canFork: false,
      canResume: false,
    });
    const launcher = new VaultLauncher(cliOnlyService(ide), {});
    await expect(launcher.resolve(ide.id, "continue", "carry on")).resolves.toMatchObject({
      shell: "cursor-agent",
      shellArgs: ["carry on"],
    });
  });

  it("continues an issued Cursor child entry that has no CLI launch target", async () => {
    const child = makeEntry({
      id: "cursor:child:0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
      agent: "cursor",
      sessionId: "child:0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
      source: "cli",
      canFork: false,
      canResume: false,
    });
    const launcher = new VaultLauncher(cliOnlyService(child), {});
    await expect(launcher.resolve(child.id, "continue", "carry on")).resolves.toMatchObject({
      shell: "cursor-agent",
    });
  });

  it("still refuses Resume when only getEntry can resolve the entry", async () => {
    const launcher = new VaultLauncher(cliOnlyService(cursorCliEntry()), {});
    await expect(launcher.resolve("cursor:chat-1", "resume")).rejects.toMatchObject({ code: "unknown-entry" });
  });

  it("throws unknown-entry for an id not in the list", async () => {
    const launcher = new VaultLauncher(stubService([]), {});
    await expect(launcher.resolve("claude:nope", "resume")).rejects.toBeInstanceOf(VaultLaunchError);
    await expect(launcher.resolve("claude:nope", "resume")).rejects.toMatchObject({ code: "unknown-entry" });
  });
});

describe("VaultLauncher.buildResumeCommand", () => {
  it("builds the Cursor resume command once the stored identity is proven", async () => {
    const verify = vi.fn(async () => true);
    const launcher = new VaultLauncher(stubService([cursorCliEntry()], verify), {});
    await expect(launcher.buildResumeCommand("cursor:chat-1")).resolves.toBe("cursor-agent --resume chat-1");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("refuses the command when the proof fails, without probing an executable", async () => {
    const launcher = new VaultLauncher(
      stubService([cursorCliEntry()], async () => false),
      {},
    );
    await expect(launcher.buildResumeCommand("cursor:chat-1")).rejects.toMatchObject({
      code: "resume-unsupported",
    });
    expect(resolveAgentExecutable).not.toHaveBeenCalled();
  });

  it("refuses non-resumable Cursor sources and unknown entries", async () => {
    const ide = makeEntry({
      id: "cursor:ide:d29ya3NwYWNlLTE:composer-1",
      agent: "cursor",
      sessionId: "ide:d29ya3NwYWNlLTE:composer-1",
      source: "ide",
      canFork: false,
      canResume: false,
    });
    const launcher = new VaultLauncher(stubService([ide]), {});
    await expect(launcher.buildResumeCommand(ide.id)).rejects.toMatchObject({ code: "resume-unsupported" });
    await expect(launcher.buildResumeCommand("cursor:missing")).rejects.toMatchObject({ code: "unknown-entry" });
  });

  it("keeps non-Cursor command copy unchanged", async () => {
    const launcher = new VaultLauncher(stubService([makeEntry()]), {});
    await expect(launcher.buildResumeCommand("claude:sess-1")).resolves.toBe("claude --resume sess-1");
  });
});

describe("VaultLauncher — launching somewhere else", () => {
  it("runs a resume in the directory the caller named, not the one recorded", async () => {
    const launcher = new VaultLauncher(stubService([makeEntry({ cwd: "/recorded/proj" })]), {});
    await expect(launcher.resolve("claude:sess-1", "resume", undefined, undefined, "/wt/feat")).resolves.toMatchObject({
      cwd: "/wt/feat",
    });
  });

  it("still honours the recorded directory when none is named", async () => {
    const launcher = new VaultLauncher(stubService([makeEntry({ cwd: "/recorded/proj" })]), {});
    await expect(launcher.resolve("claude:sess-1", "resume")).resolves.toMatchObject({ cwd: "/recorded/proj" });
  });

  it("overrides the directory for a fork too — the override is the mode's, not resume's", async () => {
    const launcher = new VaultLauncher(stubService([makeEntry({ cwd: "/recorded/proj" })]), {});
    await expect(launcher.resolve("claude:sess-1", "fork", undefined, undefined, "/wt/feat")).resolves.toMatchObject({
      cwd: "/wt/feat",
    });
  });
});

describe("VaultLauncher.startAgent", () => {
  const launcher = () => new VaultLauncher(stubService([]), { ANTHROPIC_API_KEY: "sk-1" });

  it("starts a fresh session with no stored entry at all", async () => {
    const opts = await launcher().startAgent("claude", "/wt/feat", {});
    expect(opts).toMatchObject({ shell: "claude", shellArgs: [], cwd: "/wt/feat", isAgentLaunch: true });
  });

  it("carries the posture and prompt the caller chose", async () => {
    const opts = await launcher().startAgent("claude", "/wt/feat", {
      permissionChoiceId: "plan",
      prompt: "read the design doc",
    });
    expect(opts.shellArgs).toEqual(["--permission-mode", "plan", "read the design doc"]);
  });

  it("forwards Claude's auth allowlist so the fresh session targets the same account", async () => {
    expect((await launcher().startAgent("claude", "/wt/feat", {})).env).toEqual({ ANTHROPIC_API_KEY: "sk-1" });
  });

  it("refuses a prompt the agent would read as an option", async () => {
    await expect(launcher().startAgent("claude", "/wt/feat", { prompt: "--force" })).rejects.toMatchObject({
      code: "prompt-reads-as-flag",
    });
  });

  it("refuses an agent it does not know", async () => {
    await expect(launcher().startAgent("nosuch", "/wt/feat", {})).rejects.toBeInstanceOf(VaultLaunchError);
  });

  it("fails the launch when a templated executable cannot be found", async () => {
    // cursor's start template names `{{executable}}`. An unresolved probe used
    // to fall through and spawn that placeholder verbatim.
    resolveAgentExecutable.mockResolvedValueOnce(null);
    await expect(launcher().startAgent("cursor", "/wt/feat", {})).rejects.toMatchObject({
      code: "executable-not-found",
    });
  });

  it("probes only the agents whose template asks to be resolved", async () => {
    resolveAgentExecutable.mockClear();
    await launcher().startAgent("claude", "/wt/feat", {});
    expect(resolveAgentExecutable).not.toHaveBeenCalled();
  });
});
