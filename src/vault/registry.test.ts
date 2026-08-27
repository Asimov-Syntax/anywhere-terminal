// src/vault/registry.test.ts — Unit tests for the agent registry.

import { describe, expect, it, vi } from "vitest";
import { AGENT_ICONS } from "../webview/vault/agentIcons";
import {
  AGENT_DEFINITIONS,
  AGENT_REGISTRY,
  agentKindForExecutable,
  CLAUDE_AUTH_ENV_ALLOWLIST,
  detectContinuationTargets,
  detectLaunchTargets,
  getAgentDefinition,
  VAULT_AGENT_IDS,
} from "./registry";
import type { CommandTemplate } from "./types";

function staticTokens(t: CommandTemplate): string[] {
  return t.args.filter((a): a is string => typeof a === "string");
}

describe("AGENT_REGISTRY", () => {
  it("ships records for claude, codex, opencode, and cursor", () => {
    expect(Object.keys(AGENT_REGISTRY).sort()).toEqual(["claude", "codex", "cursor", "opencode"]);
    expect(AGENT_DEFINITIONS.map((d) => d.id)).toEqual(["claude", "codex", "opencode", "cursor"]);
  });

  it("every VAULT_AGENT_IDS entry has a registry definition (single source, no gap)", () => {
    expect([...VAULT_AGENT_IDS]).toEqual(["claude", "codex", "opencode", "cursor"]);
    for (const id of VAULT_AGENT_IDS) {
      expect(getAgentDefinition(id)).toBeDefined();
    }
    // AGENT_DEFINITIONS is derived from VAULT_AGENT_IDS, so order tracks it.
    expect(AGENT_DEFINITIONS.map((d) => d.id)).toEqual([...VAULT_AGENT_IDS]);
  });

  it("each record's id equals its registry key (W2 — satisfies checks keys, not id===key)", () => {
    for (const id of VAULT_AGENT_IDS) {
      expect(getAgentDefinition(id)?.id).toBe(id);
    }
  });

  it("no agent id contains the entryId separator ':' (S1 — formatEntryId/parseEntryId invariant)", () => {
    for (const id of VAULT_AGENT_IDS) {
      expect(id).not.toContain(":");
    }
  });

  it("webview displayName matches the host registry displayName for every agent (W1)", () => {
    // displayName lives in two places (host registry + webview AGENT_ICONS); this
    // pins them so they can't silently diverge.
    for (const id of VAULT_AGENT_IDS) {
      expect(AGENT_ICONS[id]?.displayName).toBe(getAgentDefinition(id)?.displayName);
    }
  });

  it("every record's resume template carries the {{sessionId}} token", () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(staticTokens(def.resumeCommand)).toContain("{{sessionId}}");
    }
  });

  it("claude carries the exact 8-var auth allowlist", () => {
    const claude = getAgentDefinition("claude");
    expect(claude?.authEnvAllowlist).toEqual([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_MODEL",
      "ANTHROPIC_SMALL_FAST_MODEL",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CONFIG_DIR",
    ]);
    expect(CLAUDE_AUTH_ENV_ALLOWLIST).toHaveLength(8);
  });

  it("claude resume injects model + permission-mode flags; fork uses --fork-session", () => {
    const claude = getAgentDefinition("claude");
    expect(claude?.resumeCommand.args).toContainEqual({ flag: "--model", from: "model" });
    expect(claude?.resumeCommand.args).toContainEqual({ flag: "--permission-mode", from: "permissionMode" });
    expect(staticTokens(claude?.forkCommand as CommandTemplate)).toContain("--fork-session");
  });

  it("codex resume preserves flag order m,a,s and templates reasoning effort", () => {
    const codex = getAgentDefinition("codex");
    const flags = codex?.resumeCommand.args.filter((a) => typeof a !== "string");
    expect(flags).toEqual([
      { flag: "-m", from: "model" },
      { flag: "-a", from: "approval" },
      { flag: "-s", from: "sandbox" },
      { flag: "-c", from: "reasoningEffort", valueTemplate: "model_reasoning_effort={{value}}" },
    ]);
    expect(staticTokens(codex?.resumeCommand as CommandTemplate)).toEqual(["resume", "{{sessionId}}"]);
  });

  it("opencode carries forkMinVersion 1.1.54 and a --fork command", () => {
    const opencode = getAgentDefinition("opencode");
    expect(opencode?.forkMinVersion).toBe("1.1.54");
    expect(staticTokens(opencode?.forkCommand as CommandTemplate)).toContain("--fork");
    expect(opencode?.resumeCommand.args).toContainEqual({ flag: "--agent", from: "agent" });
  });

  it("cursor keeps provider identity separate from ordered executable candidates", () => {
    const cursor = getAgentDefinition("cursor");
    expect(cursor?.detect).toEqual({
      executable: "agent",
      aliases: ["cursor-agent"],
      requiredHelpTokens: ["prompt", "--resume", "--mode", "plan", "--force"],
    });
    expect(cursor?.sessionStore.format).toBe("metadata-json");
    expect(cursor?.resumeCommand).toEqual({ executable: "{{executable}}", args: ["--resume", "{{sessionId}}"] });
    expect(cursor?.forkCommand).toBeUndefined();
  });

  it("codex has no forkMinVersion (fork supported whenever a command exists)", () => {
    expect(getAgentDefinition("codex")?.forkMinVersion).toBeUndefined();
  });

  it("getAgentDefinition returns undefined for unknown agents", () => {
    expect(getAgentDefinition("nope")).toBeUndefined();
  });
});

describe("agentKindForExecutable", () => {
  it("maps bare command names and aliases to the agent id", () => {
    expect(agentKindForExecutable("claude")).toBe("claude");
    expect(agentKindForExecutable("codex")).toBe("codex");
    expect(agentKindForExecutable("opencode")).toBe("opencode");
    expect(agentKindForExecutable("agent")).toBe("cursor");
    expect(agentKindForExecutable("cursor-agent")).toBe("cursor");
  });

  it("strips directories and platform suffixes", () => {
    expect(agentKindForExecutable("/usr/local/bin/codex")).toBe("codex");
    expect(agentKindForExecutable("C:\\Program Files\\opencode\\opencode.cmd")).toBe("opencode");
    expect(agentKindForExecutable("Claude.EXE")).toBe("claude");
  });

  it("returns undefined for shells, empty, or unknown commands", () => {
    expect(agentKindForExecutable("/bin/zsh")).toBeUndefined();
    expect(agentKindForExecutable("grok")).toBeUndefined();
    expect(agentKindForExecutable("")).toBeUndefined();
    expect(agentKindForExecutable(undefined)).toBeUndefined();
  });
});

// improve-vault-transcript-messages 8_2 — the continuation dialog offers agents
// and permission postures; both are registry data the host filters by PATH (D11).
describe("permissionChoices", () => {
  it("gives claude one axis whose ids are its own permission modes", () => {
    const ids = getAgentDefinition("claude")?.permissionChoices?.map((c) => c.id);
    expect(ids).toContain("bypassPermissions");
    expect(ids).toContain("plan");
  });

  it("marks a bypassing choice as dangerous, and an ordinary one not", () => {
    const choices = getAgentDefinition("claude")?.permissionChoices ?? [];
    expect(choices.find((c) => c.id === "bypassPermissions")?.dangerous).toBe(true);
    expect(choices.find((c) => c.id === "plan")?.dangerous).toBeUndefined();
  });

  it("folds codex's two axes into one choice each", () => {
    const choice = getAgentDefinition("codex")?.permissionChoices?.find((c) => c.id === "workspace-write");
    expect(choice?.args).toEqual(["-a", "on-request", "-s", "workspace-write"]);
  });

  it("gives opencode none, so the dialog shows no permission control", () => {
    expect(getAgentDefinition("opencode")?.permissionChoices).toBeUndefined();
  });

  it("offers Cursor default, plan-only, and explicit full-access postures", () => {
    expect(getAgentDefinition("cursor")?.permissionChoices).toEqual([
      { id: "default", label: "Ask for permission", args: [] },
      { id: "plan", label: "Plan only", args: ["--mode", "plan"] },
      { id: "force", label: "Full access, no approvals", dangerous: true, args: ["--force"] },
    ]);
  });
});

describe("detectContinuationTargets", () => {
  it("lists only agents whose executable passes its probe, with their choices", async () => {
    const exec = vi.fn(async (file: string, args: string[]) => {
      if (file === "opencode") {
        throw new Error("command not found");
      }
      if (file === "agent" && args[0] === "--help") {
        return {
          stdout: "Cursor Agent\nUsage: agent [prompt]\n--resume <id>\n--mode <mode> plan\n--force",
          stderr: "",
        };
      }
      return { stdout: "1.0.0", stderr: "" };
    });
    const targets = await detectContinuationTargets({ exec });
    expect(targets.map((t) => t.agent)).toEqual(["claude", "codex", "cursor"]);
    expect(targets[0]).toMatchObject({ displayName: "Claude Code" });
    expect(targets[0].permissionChoices.length).toBeGreaterThan(0);
  });

  it("does not list Cursor for branded --prompt-only help", async () => {
    const exec = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === "--help") {
        return {
          stdout: "Cursor Agent\nUsage: agent [options]\n--prompt <prompt>\n--resume <id>\n--mode <mode> plan\n--force",
          stderr: "",
        };
      }
      return { stdout: "1.0.0", stderr: "" };
    });

    const targets = await detectContinuationTargets({ exec });
    expect(targets.map((target) => target.agent)).toEqual(["claude", "codex", "opencode"]);
  });

  it("reports nothing rather than throwing when no agent is installed", async () => {
    const exec = vi.fn(async () => {
      throw new Error("command not found");
    });
    expect(await detectContinuationTargets({ exec })).toEqual([]);
  });
});

describe("start capability", () => {
  it("every agent declares a start command, so a fresh launch never assembles argv", () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def.startCommand, def.id).toBeDefined();
    }
  });

  it("a start command's prompt is a fragment, so a promptless launch emits no empty token", () => {
    for (const def of AGENT_DEFINITIONS) {
      const args = def.startCommand?.args ?? [];
      // `{{prompt}}` is the CONTINUE token — mandatory there, unrepresentable-as-absent here.
      expect(staticTokens({ executable: "x", args }), def.id).not.toContain("{{prompt}}");
      expect(
        args.some((a) => typeof a === "object" && "prompt" in a),
        def.id,
      ).toBe(true);
    }
  });

  it("opencode seeds through --prompt; claude, codex and cursor seed positionally", () => {
    const flagOf = (id: string): string | undefined => {
      const part = getAgentDefinition(id)?.startCommand?.args.find((a) => typeof a === "object" && "prompt" in a);
      return part && typeof part === "object" && "prompt" in part ? part.flag : undefined;
    };
    expect(flagOf("opencode")).toBe("--prompt");
    expect(flagOf("claude")).toBeUndefined();
    expect(flagOf("codex")).toBeUndefined();
    expect(flagOf("cursor")).toBeUndefined();
  });
});

describe("detectLaunchTargets", () => {
  const installed = vi.fn(async (file: string, args: string[]) => {
    if (file === "agent" && args[0] === "--help") {
      return { stdout: "Cursor Agent\nUsage: agent [prompt]\n--resume <id>\n--mode <mode> plan\n--force", stderr: "" };
    }
    return { stdout: "1.0.0", stderr: "" };
  });

  it("answers the start capability with start-capable installed agents", async () => {
    const targets = await detectLaunchTargets("start", { exec: installed });
    expect(targets.map((t) => t.agent)).toEqual(["claude", "codex", "opencode", "cursor"]);
  });

  it("reports whether each target can be seeded, derived from its own template", async () => {
    const targets = await detectLaunchTargets("start", { exec: installed });
    for (const target of targets) {
      expect(target.canSeedPrompt, target.agent).toBe(true);
    }
  });

  it("omits an agent that declares no command for the capability asked about", async () => {
    // opencode's executable resolves here; only the CAPABILITY filter may drop it.
    const targets = await detectLaunchTargets("continue", { exec: installed });
    expect(targets.map((t) => t.agent)).toContain("opencode");
  });

  it("never publishes the argv a posture contributes — the webview sends back an id", async () => {
    const targets = await detectLaunchTargets("start", { exec: installed });
    const claude = targets.find((t) => t.agent === "claude");
    expect(claude?.permissionChoices.length).toBeGreaterThan(0);
    for (const choice of claude?.permissionChoices ?? []) {
      expect(Object.keys(choice)).not.toContain("args");
    }
  });

  it("drops an agent whose executable does not resolve", async () => {
    const exec = vi.fn(async (file: string, args: string[]) => {
      if (file === "opencode") {
        throw new Error("command not found");
      }
      return installed(file, args);
    });
    const targets = await detectLaunchTargets("start", { exec });
    expect(targets.map((t) => t.agent)).not.toContain("opencode");
  });
});
