// @vitest-environment jsdom

// The standalone launch dialog (worktree-actions.md § 4). The agent/posture/prompt
// block itself is covered in worktreeAgentBox.test.ts — what this file owns is the
// request the dialog emits and when it emits nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openWorktreeLaunchDialog } from "./WorktreeLaunchDialog";
import type { WorktreeLaunchAgent } from "./worktreeViewTypes";

const CLAUDE: WorktreeLaunchAgent = {
  id: "claude",
  label: "Claude Code",
  canSeedPrompt: true,
  permissionChoices: [
    { id: "default", label: "Ask for permission" },
    { id: "bypassPermissions", label: "Bypass permission checks", dangerous: true },
  ],
};
const BARE: WorktreeLaunchAgent = { id: "bare", label: "Bare", canSeedPrompt: false, permissionChoices: [] };

let host: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  document.body.replaceChildren();
});

function open(agents: WorktreeLaunchAgent[] = [CLAUDE]) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  openWorktreeLaunchDialog(host, { worktreeLabel: "feat/login", agents, onConfirm, onCancel });
  const q = <T extends HTMLElement>(sel: string): T => document.body.querySelector<T>(sel) as T;
  return { onConfirm, onCancel, q };
}

describe("openWorktreeLaunchDialog", () => {
  it("names the worktree the launch will run in", () => {
    open();
    expect(document.body.textContent).toContain("feat/login");
  });

  it("submits the chosen agent, posture and prompt", () => {
    const { onConfirm, q } = open();
    const perm = q<HTMLSelectElement>("#wt-perm");
    perm.value = "bypassPermissions";
    perm.dispatchEvent(new Event("change"));
    const prompt = q<HTMLTextAreaElement>("#wt-prompt");
    prompt.value = "start on the login flow";
    prompt.dispatchEvent(new Event("input"));
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(onConfirm).toHaveBeenCalledWith({
      agent: "claude",
      permissionChoiceId: "bypassPermissions",
      prompt: "start on the login flow",
    });
  });

  it("omits a posture and a prompt the launch does not carry, rather than sending empties", () => {
    const { onConfirm, q } = open([BARE]);
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(onConfirm).toHaveBeenCalledWith({ agent: "bare" });
  });

  it("submits on the keyboard shortcut too", () => {
    const { onConfirm, q } = open();
    q<HTMLElement>(".wt-dialog").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("opens nothing at all when no agent can be started", () => {
    const { onConfirm } = open([]);
    expect(document.body.querySelector(".wt-dialog")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels without launching", () => {
    const { onConfirm, onCancel } = open();
    // `plain` renders as a bare `wt-btn`; the modifier classes are the other two.
    const [cancelBtn] = [...document.body.querySelectorAll<HTMLButtonElement>("button.wt-btn")].filter((b) =>
      b.textContent?.startsWith("Cancel"),
    );
    cancelBtn.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".wt-dialog")).toBeNull();
  });

  it("closes once, so a double submit cannot launch twice", () => {
    const { onConfirm, q } = open();
    const btn = q<HTMLButtonElement>(".wt-btn--primary");
    btn.click();
    btn.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
