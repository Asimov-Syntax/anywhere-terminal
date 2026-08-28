import { describe, expect, it } from "vitest";
import { canonicalManagedGroup, reconcileClaudeSettings, resolveClaudeConfigPath } from "./claudeConfig";

const COMMAND = "true";

describe("resolveClaudeConfigPath", () => {
  it("falls through relative setting and environment values", () => {
    expect(
      resolveClaudeConfigPath({
        configuredDirectory: () => "relative",
        environment: { CLAUDE_CONFIG_DIR: "also-relative" },
        homeDirectory: () => "/home/a",
      }),
    ).toBe("/home/a/.claude/settings.json");
  });

  it("uses the first absolute override", () => {
    expect(
      resolveClaudeConfigPath({
        configuredDirectory: () => "/configured",
        environment: { CLAUDE_CONFIG_DIR: "/environment" },
      }),
    ).toBe("/configured/settings.json");
  });
});

describe("reconcileClaudeSettings", () => {
  it("preserves unrelated groups and installs canonical groups", () => {
    const source = {
      keep: true,
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user" }] }] },
    };
    const result = reconcileClaudeSettings(source, "install", COMMAND);
    expect(result.kind).toBe("changed");
    if (result.kind === "changed") {
      expect(result.document.keep).toBe(true);
      expect((result.document.hooks as Record<string, unknown[]>).PreToolUse).toEqual([
        source.hooks.PreToolUse[0],
        canonicalManagedGroup("PreToolUse", COMMAND),
      ]);
    }
  });

  it("refuses the exact handler in a noncanonical group without mutation", () => {
    const source = {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: COMMAND, timeout: 2 }] }] },
    };
    expect(reconcileClaudeSettings(source, "install", COMMAND)).toEqual({ kind: "ownership-conflict" });
    expect(source.hooks.PreToolUse[0].matcher).toBe("Bash");
  });

  it("refuses the exact handler under an unregistered event without mutation", () => {
    const source = {
      hooks: { PreCompact: [{ hooks: [{ type: "command", command: COMMAND, timeout: 2 }] }] },
    };
    const before = structuredClone(source);
    expect(reconcileClaudeSettings(source, "install", COMMAND)).toEqual({ kind: "ownership-conflict" });
    expect(source).toEqual(before);
  });
});
