import { describe, expect, it } from "vitest";
import { isShellName, matchTitleAgentName, TITLE_AGENT_NAMES } from "./agentNames";

describe("matchTitleAgentName", () => {
  it("matches a bare agent name", () => {
    expect(matchTitleAgentName("claude")).toBe("claude");
    expect(matchTitleAgentName("codex")).toBe("codex");
    expect(matchTitleAgentName("opencode")).toBe("opencode");
  });

  it("matches a name sitting among other words", () => {
    expect(matchTitleAgentName("claude — fix the presence projector")).toBe("claude");
    expect(matchTitleAgentName("run codex now")).toBe("codex");
  });

  it("refuses a name that is only a substring", () => {
    // The misfires the reference implementation documents: `openclaude ⊃ claude`
    // and `opencode-blinker ⊃ opencode`.
    expect(matchTitleAgentName("openclaude")).toBeUndefined();
    expect(matchTitleAgentName("opencode-blinker")).toBeUndefined();
    expect(matchTitleAgentName("claudette")).toBeUndefined();
    expect(matchTitleAgentName("precodex")).toBeUndefined();
  });

  it("refuses a name used as a path segment", () => {
    expect(matchTitleAgentName("/usr/local/bin/claude")).toBeUndefined();
    expect(matchTitleAgentName("C:\\tools\\codex")).toBeUndefined();
  });

  it("accepts a windows executable suffix", () => {
    expect(matchTitleAgentName("claude.exe")).toBe("claude");
    expect(matchTitleAgentName("codex.cmd")).toBe("codex");
    expect(matchTitleAgentName("opencode.ps1")).toBe("opencode");
  });

  it("does not admit every launchable agent — `cursor` alone is an ordinary word", () => {
    // D5: the title list is deliberately narrower than VAULT_AGENT_IDS. A bare
    // `cursor` in a title is far more likely to be English than an agent.
    expect(TITLE_AGENT_NAMES).not.toContain("cursor");
    expect(matchTitleAgentName("cursor")).toBeUndefined();
    expect(matchTitleAgentName("move the cursor left")).toBeUndefined();
    expect(matchTitleAgentName("cursor position")).toBeUndefined();
  });

  it("still recognises Cursor Agent by its distinctive token", () => {
    expect(matchTitleAgentName("cursor-agent")).toBe("cursor");
    expect(matchTitleAgentName("cursor-agent --resume")).toBe("cursor");
  });

  it("is case-insensitive", () => {
    expect(matchTitleAgentName("Claude")).toBe("claude");
    expect(matchTitleAgentName("CODEX")).toBe("codex");
  });

  it("returns undefined for nothing to match", () => {
    expect(matchTitleAgentName(undefined)).toBeUndefined();
    expect(matchTitleAgentName("")).toBeUndefined();
    expect(matchTitleAgentName("Terminal")).toBeUndefined();
  });

  it("prefers the longest matching token so a compound is not read as its prefix", () => {
    // `cursor-agent` must not be reported via some shorter accidental match.
    expect(matchTitleAgentName("cursor-agent")).toBe("cursor");
  });
});

describe("isShellName", () => {
  it("recognises the common interactive shells", () => {
    for (const shell of ["bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd", "nu", "dash", "ksh"]) {
      expect(isShellName(shell)).toBe(true);
    }
  });

  it("is case-insensitive and tolerates a windows suffix", () => {
    expect(isShellName("PowerShell")).toBe(true);
    expect(isShellName("cmd.exe")).toBe(true);
    expect(isShellName("pwsh.exe")).toBe(true);
  });

  it("refuses a shell name that is only a substring", () => {
    expect(isShellName("bashful")).toBe(false);
    expect(isShellName("rebash")).toBe(false);
    expect(isShellName("fisher")).toBe(false);
  });

  it("refuses a neutral title", () => {
    // `Terminal` is not proof the agent ended — only a named shell is.
    expect(isShellName("Terminal")).toBe(false);
    expect(isShellName("")).toBe(false);
    expect(isShellName(undefined)).toBe(false);
    expect(isShellName("claude")).toBe(false);
  });

  it("recognises a shell named inside a fuller title", () => {
    expect(isShellName("zsh — ~/Projects")).toBe(true);
  });
});
