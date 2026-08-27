// @vitest-environment jsdom

// src/webview/worktree/worktreeAgentBox.test.ts — the launch block both dialogs
// mount (design.md D7).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorktreeAgentBox } from "./worktreeAgentBox";
import type { WorktreeLaunchAgent } from "./worktreeViewTypes";

const CLAUDE: WorktreeLaunchAgent = {
  id: "claude",
  label: "Claude Code",
  canSeedPrompt: true,
  permissionChoices: [
    { id: "default", label: "Ask for permission" },
    { id: "acceptEdits", label: "Accept edits" },
    { id: "bypassPermissions", label: "Bypass permission checks", dangerous: true },
  ],
};
const CODEX: WorktreeLaunchAgent = {
  id: "codex",
  label: "Codex",
  canSeedPrompt: true,
  permissionChoices: [
    { id: "read-only", label: "Read only" },
    { id: "danger-full-access", label: "Full access, no approvals", dangerous: true },
  ],
};
/** No postures at all, and cannot be seeded. */
const BARE: WorktreeLaunchAgent = { id: "bare", label: "Bare", canSeedPrompt: false, permissionChoices: [] };
/** Declares its dangerous posture FIRST — position is not the rule. */
const DANGER_FIRST: WorktreeLaunchAgent = {
  id: "df",
  label: "Danger First",
  canSeedPrompt: true,
  permissionChoices: [
    { id: "full", label: "Full access", dangerous: true },
    { id: "safe", label: "Ask first" },
  ],
};

beforeEach(() => {
  document.body.replaceChildren();
});

function mount(agents: WorktreeLaunchAgent[], onChange?: () => void) {
  const box = createWorktreeAgentBox(agents, onChange);
  document.body.appendChild(box.element);
  const sel = (id: string) => document.getElementById(id) as HTMLSelectElement;
  const change = (id: string, value: string): void => {
    const el = sel(id);
    el.value = value;
    el.dispatchEvent(new Event("change"));
  };
  return { box, sel, change, prompt: () => document.getElementById("wt-prompt") as HTMLTextAreaElement };
}

describe("createWorktreeAgentBox", () => {
  it("offers the agents it was given, in the order it was given them", () => {
    const { sel } = mount([CLAUDE, CODEX]);
    expect([...sel("wt-agent").options].map((o) => o.value)).toEqual(["claude", "codex"]);
  });

  it("shows the chosen agent's own postures, and swaps them when the agent changes", () => {
    const { sel, change } = mount([CLAUDE, CODEX]);
    expect([...sel("wt-perm").options].map((o) => o.value)).toEqual(["default", "acceptEdits", "bypassPermissions"]);
    change("wt-agent", "codex");
    expect([...sel("wt-perm").options].map((o) => o.value)).toEqual(["read-only", "danger-full-access"]);
  });

  it("never preselects a dangerous posture, even when the agent declares it first", () => {
    const { box } = mount([DANGER_FIRST]);
    expect(box.read().permissionChoiceId).toBe("safe");
  });

  it("labels a dangerous posture as dangerous", () => {
    const { sel } = mount([CLAUDE]);
    const danger = [...sel("wt-perm").options].find((o) => o.value === "bypassPermissions");
    expect(danger?.textContent).toContain("dangerous");
  });

  it("resets the posture with the agent rather than carrying an id across", () => {
    const { box, change } = mount([CLAUDE, CODEX]);
    change("wt-perm", "acceptEdits");
    expect(box.read().permissionChoiceId).toBe("acceptEdits");
    change("wt-agent", "codex");
    // "acceptEdits" means nothing to codex — carrying it would launch under a
    // posture the user never saw offered.
    expect(box.read().permissionChoiceId).toBe("read-only");
  });

  it("hides the posture control for an agent that declares none", () => {
    const { box, sel } = mount([BARE]);
    expect((sel("wt-perm").parentElement as HTMLElement).hidden).toBe(true);
    expect(box.read().permissionChoiceId).toBeUndefined();
  });

  it("offers no prompt for an agent that cannot be seeded, and drops any text with it", () => {
    const { box, prompt, change } = mount([CLAUDE, BARE]);
    prompt().value = "do the thing";
    prompt().dispatchEvent(new Event("input"));
    expect(box.read().prompt).toBe("do the thing");
    change("wt-agent", "bare");
    expect((prompt().parentElement as HTMLElement).hidden).toBe(true);
    expect(box.read().prompt).toBeUndefined();
  });

  it("reads a blank prompt as absent, not as an empty first turn", () => {
    const { box, prompt } = mount([CLAUDE]);
    prompt().value = "   ";
    prompt().dispatchEvent(new Event("input"));
    expect(box.read()).not.toHaveProperty("prompt");
  });

  it("renders nothing to choose from when no agent is offered", () => {
    const { box } = mount([]);
    expect(box.element.hidden).toBe(true);
    expect(box.read().agentId).toBeUndefined();
  });

  it("keeps the chosen agent across a swap that still offers it, and drops one that is gone", () => {
    const { box, change } = mount([CLAUDE, CODEX]);
    change("wt-agent", "codex");
    box.setAgents([CODEX, CLAUDE]);
    expect(box.read().agentId).toBe("codex");
    box.setAgents([CLAUDE]);
    expect(box.read().agentId).toBe("claude");
  });

  it("reports every edit, so a dialog can recompute its submit state", () => {
    const onChange = vi.fn();
    const { change, prompt } = mount([CLAUDE, CODEX], onChange);
    change("wt-agent", "codex");
    change("wt-perm", "danger-full-access");
    prompt().value = "x";
    prompt().dispatchEvent(new Event("input"));
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
