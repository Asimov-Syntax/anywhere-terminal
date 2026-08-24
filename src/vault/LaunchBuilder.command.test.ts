// src/vault/LaunchBuilder.command.test.ts — Resume-command string (redesign-vault-panel-ui 3_1).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveAgentExecutable } = vi.hoisted(() => ({ resolveAgentExecutable: vi.fn() }));

vi.mock("../cursor/CursorExecutableResolver", () => ({ resolveAgentExecutable }));

import { buildResumeCommandString, VaultLaunchError } from "./LaunchBuilder";
import type { VaultSessionEntry } from "./types";

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:s1",
    agent: "claude",
    sessionId: "s1",
    title: "t",
    cwd: "/x",
    modified: 1,
    flags: {},
    canFork: false,
    ...over,
  };
}

describe("buildResumeCommandString", () => {
  beforeEach(() => {
    resolveAgentExecutable.mockReset();
    resolveAgentExecutable.mockResolvedValue("cursor-agent");
  });

  it("renders a minimal Claude resume command (no optional flags)", async () => {
    await expect(buildResumeCommandString(entry({ agent: "claude", sessionId: "abc-123" }))).resolves.toBe(
      "claude --resume abc-123",
    );
  });

  it("includes captured Claude flags when present", async () => {
    const cmd = await buildResumeCommandString(
      entry({ agent: "claude", sessionId: "abc", flags: { model: "claude-opus-4-7", permissionMode: "plan" } }),
    );
    expect(cmd).toBe("claude --resume abc --model claude-opus-4-7 --permission-mode plan");
  });

  it("renders Codex with its flags incl. the reasoning-effort -c template", async () => {
    const cmd = await buildResumeCommandString(
      entry({
        agent: "codex",
        sessionId: "x1",
        flags: { model: "gpt-5", approval: "on-request", sandbox: "workspace-write", reasoningEffort: "high" },
      }),
    );
    expect(cmd).toBe("codex resume x1 -m gpt-5 -a on-request -s workspace-write -c model_reasoning_effort=high");
  });

  it("renders OpenCode with model + agent flags", async () => {
    const cmd = await buildResumeCommandString(
      entry({ agent: "opencode", sessionId: "ses_9", flags: { model: "anthropic/claude", agent: "build" } }),
    );
    expect(cmd).toBe("opencode --session ses_9 -m anthropic/claude --agent build");
  });

  it("single-quote wraps a flag value containing a space", async () => {
    const cmd = await buildResumeCommandString(
      entry({ agent: "claude", sessionId: "abc", flags: { model: "my model" } }),
    );
    expect(cmd).toBe("claude --resume abc --model 'my model'");
  });

  it("resolves Cursor's executable before copying a CLI Resume command", async () => {
    await expect(
      buildResumeCommandString(
        entry({
          id: "cursor:chat-1",
          agent: "cursor",
          sessionId: "chat-1",
          source: "cli",
          canResume: true,
        }),
      ),
    ).resolves.toBe("cursor-agent --resume chat-1");
  });

  it("fails Cursor command copy when no compatible executable resolves", async () => {
    resolveAgentExecutable.mockResolvedValueOnce(null);
    await expect(
      buildResumeCommandString(
        entry({
          id: "cursor:chat-1",
          agent: "cursor",
          sessionId: "chat-1",
          source: "cli",
          canResume: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "executable-not-found" });
  });

  it("rejects IDE and forged Cursor Resume commands before executable probing", async () => {
    await expect(
      buildResumeCommandString(
        entry({
          id: "cursor:ide:d29ya3NwYWNlLTE:composer-1",
          agent: "cursor",
          sessionId: "ide:d29ya3NwYWNlLTE:composer-1",
          source: "ide",
          canResume: false,
        }),
      ),
    ).rejects.toMatchObject({ code: "resume-unsupported" });
    await expect(
      buildResumeCommandString(
        entry({ id: "cursor:chat-1", agent: "cursor", sessionId: "chat-1", source: "ide", canResume: true }),
      ),
    ).rejects.toMatchObject({ code: "resume-unsupported" });
    expect(resolveAgentExecutable).not.toHaveBeenCalled();
  });

  it("throws for an unknown agent", async () => {
    await expect(buildResumeCommandString(entry({ agent: "mystery" }))).rejects.toBeInstanceOf(VaultLaunchError);
  });
});
