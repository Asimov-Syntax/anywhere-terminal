import { describe, expect, it, vi } from "vitest";
import { getAgentDefinition } from "../vault/registry";
import { resolveAgentExecutable } from "./CursorExecutableResolver";

const CURSOR_HELP = `
Cursor Agent
Usage: agent [options] [prompt]
  --resume <chatId>
  --mode <mode> (plan)
  --force
`;

const CURSOR_ALIAS_HELP = `
Usage: cursor-agent [options] <prompt>
  --resume <chatId>
  --mode <mode> (plan)
  --force
`;

const INSTALLED_CURSOR_HELP = `
Usage: agent [options] [command] [prompt...]

Start the Cursor Agent

Arguments:
  prompt                       Initial prompt for the agent

Options:
  --mode <mode>                Start in the given execution mode. plan:
                               read-only/planning. (choices: "plan", "ask")
  --resume [chatId]            Select a session to resume (default: false)
  -f, --force                  Force allow commands unless explicitly denied
`;

describe("resolveAgentExecutable", () => {
  it("prefers agent when it exposes the required Cursor capabilities", async () => {
    const exec = vi.fn(async () => ({ stdout: CURSOR_HELP, stderr: "" }));

    await expect(resolveAgentExecutable(getAgentDefinition("cursor")!, { exec })).resolves.toBe("agent");
    expect(exec).toHaveBeenCalledOnce();
    expect(exec).toHaveBeenCalledWith("agent", ["--help"], { timeout: 2000 });
  });

  it("accepts the installed official help shape with variadic prompt and optional chatId", async () => {
    const exec = vi.fn(async () => ({ stdout: INSTALLED_CURSOR_HELP, stderr: "" }));

    await expect(resolveAgentExecutable(getAgentDefinition("cursor")!, { exec })).resolves.toBe("agent");
  });

  it("rejects an unrelated agent binary and falls back to cursor-agent", async () => {
    const exec = vi.fn(async (file: string) => ({
      stdout: file === "agent" ? "Usage: agent run <task>" : CURSOR_HELP,
      stderr: "",
    }));

    await expect(resolveAgentExecutable(getAgentDefinition("cursor")!, { exec })).resolves.toBe("cursor-agent");
    expect(exec.mock.calls.map(([file]) => file)).toEqual(["agent", "cursor-agent"]);
  });

  it("falls back when the preferred candidate is absent", async () => {
    const exec = vi.fn(async (file: string) => {
      if (file === "agent") {
        throw new Error("command not found");
      }
      return { stdout: "", stderr: CURSOR_ALIAS_HELP };
    });

    await expect(resolveAgentExecutable(getAgentDefinition("cursor")!, { exec })).resolves.toBe("cursor-agent");
  });

  it("rejects unrelated help even when it exposes matching positional and option shapes", async () => {
    const exec = vi.fn(async () => ({
      stdout: "Acme Agent\nUsage: agent [options] [prompt]\n--resume <id>\n--mode <mode> (plan)\n--force",
      stderr: "",
    }));

    await expect(resolveAgentExecutable(getAgentDefinition("cursor")!, { exec })).resolves.toBeNull();
  });

  it("rejects --prompt-only help even when it identifies Cursor Agent", async () => {
    const exec = vi.fn(async () => ({
      stdout: "Cursor Agent\nUsage: agent [options]\n--prompt <prompt>\n--resume <id>\n--mode <mode> (plan)\n--force",
      stderr: "",
    }));

    await expect(resolveAgentExecutable(getAgentDefinition("cursor")!, { exec })).resolves.toBeNull();
  });

  it.each([
    ["resume without an operand", "Cursor Agent\nUsage: agent [prompt]\n--resume\n--mode <mode> plan\n--force"],
    [
      "plan detached from mode",
      "Cursor Agent\nUsage: agent [prompt]\n--resume <id>\n--mode <mode>\nplan mode\n--force",
    ],
    [
      "force mentioned only in prose",
      "Cursor Agent\nUsage: agent [prompt]\n--resume <id>\n--mode <mode> plan\nUse --force carefully",
    ],
  ])("rejects help with an invalid %s shape", async (_label, stdout) => {
    const exec = vi.fn(async () => ({ stdout, stderr: "" }));

    await expect(resolveAgentExecutable(getAgentDefinition("cursor")!, { exec })).resolves.toBeNull();
  });

  it("keeps non-Cursor executables on the version probe", async () => {
    const exec = vi.fn(async () => ({ stdout: "1.0.0", stderr: "" }));

    await expect(resolveAgentExecutable(getAgentDefinition("claude")!, { exec })).resolves.toBe("claude");
    expect(exec).toHaveBeenCalledWith("claude", ["--version"], { timeout: 2000 });
  });

  it("returns null when no candidate passes every required capability", async () => {
    const exec = vi.fn(async () => ({
      stdout: "Usage: agent [prompt]\n--resume <chatId>\n--mode <mode> plan",
      stderr: "",
    }));

    await expect(resolveAgentExecutable(getAgentDefinition("cursor")!, { exec })).resolves.toBeNull();
  });
});
