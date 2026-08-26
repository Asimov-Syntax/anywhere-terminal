// @vitest-environment jsdom

// The two answers to "remove this worktree?", against docs/ui/worktree.html § 11
// (one confirmation naming every blocker) and § 12 (refused outright).

import { afterEach, describe, expect, it } from "vitest";
import { isRemoveRefused, openWorktreeRemoveDialog } from "./WorktreeRemoveDialog";
import { agentRow, confirmableBlocker, refusedBlocker, worktree } from "./worktreeFixtures";
import type { WorktreeAgentRow, WorktreeInfo, WorktreeRemoveBlocker } from "./worktreeViewTypes";

const SPIKE: WorktreeInfo = worktree({
  id: "/Volumes/ext/anywhere-terminal-wt/spike-hooks",
  branch: "spike/hooks",
  head: "e".repeat(40),
  locked: true,
  lockReason: "spike, keep until Friday",
});

afterEach(() => {
  document.body.replaceChildren();
});

function open(blocker: WorktreeRemoveBlocker, over: { info?: WorktreeInfo; agentRows?: WorktreeAgentRow[] } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const confirmed: string[] = [];
  const shown: string[] = [];
  openWorktreeRemoveDialog(host, {
    info: over.info ?? SPIKE,
    blocker,
    agentRows: over.agentRows,
    onConfirm: (fingerprint) => confirmed.push(fingerprint),
    onShowAgent: (row) => shown.push(row.rowId),
  });
  return { host, confirmed, shown };
}

describe("isRemoveRefused", () => {
  it("refuses on a busy agent or the main worktree, and nothing else", () => {
    expect(isRemoveRefused(refusedBlocker)).toBe(true);
    expect(isRemoveRefused({ ...refusedBlocker, busyAgents: 0, isMain: true })).toBe(true);
    expect(isRemoveRefused(confirmableBlocker)).toBe(false);
  });
});

describe("remove worktree — confirmation (§ 11)", () => {
  it("names the path and every blocker in one list", () => {
    const { host } = open(confirmableBlocker);
    expect(host.querySelector(".wt-dialog-path")?.textContent).toBe(SPIKE.id);
    const items = Array.from(host.querySelectorAll(".wt-blockers li")).map((li) => li.textContent);
    expect(items.some((t) => t?.includes("uncommitted changes"))).toBe(true);
    expect(items.some((t) => t?.includes("3 untracked files"))).toBe(true);
    expect(items.some((t) => t?.includes("2 idle terminals"))).toBe(true);
    expect(items.some((t) => t?.includes("1 session in another window"))).toBe(true);
    expect(items.some((t) => t?.includes("spike, keep until Friday"))).toBe(true);
  });

  it("stays at the reading measure — it is a question, not a form", () => {
    const { host } = open(confirmableBlocker);
    expect(host.querySelector(".wt-dialog")?.classList.contains("wt-dialog--wide")).toBe(false);
  });

  it("says what force authorizes, including files written after the confirmation", () => {
    const { host } = open(confirmableBlocker);
    const warn = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(warn).toContain("irreversibly");
    expect(warn).toContain("including files written after you confirm");
    expect(warn).toContain("The lock is overridden");
    expect(warn).toContain("running in a deleted directory");
    // Branch deletion is not part of removal, and the confirmation says so.
    expect(warn).toContain("The branch spike/hooks is kept.");
  });

  it("omits a clause for a blocker that is not present", () => {
    const { host } = open({ ...confirmableBlocker, locked: false, idlePanes: 0 });
    const warn = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(warn).not.toContain("The lock is overridden");
    expect(warn).not.toContain("deleted directory");
    expect(host.querySelectorAll(".wt-blockers li")).toHaveLength(3);
  });

  it("opens with focus on Cancel, never on the destructive button", () => {
    // A modal that opens with focus outside it is silent to a screen reader, and
    // landing on Force remove would make a stray Enter the authorization.
    const { host } = open(confirmableBlocker);
    const dialog = host.querySelector(".wt-dialog");
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("Cancel");
  });

  it("re-sends the fingerprint the user was shown", () => {
    const { host, confirmed } = open(confirmableBlocker);
    host.querySelector<HTMLButtonElement>(".wt-btn--danger")?.click();
    expect(confirmed).toEqual([confirmableBlocker.fingerprint]);
  });

  it("is not dismissed by a stray click on the scrim", () => {
    const { host, confirmed } = open(confirmableBlocker);
    host.querySelector<HTMLElement>(".wt-scrim")?.click();
    expect(host.querySelector(".wt-dialog")).not.toBeNull();
    expect(confirmed).toHaveLength(0);
  });
});

describe("remove worktree — refused (§ 12)", () => {
  const busy = agentRow({
    rowId: "busy",
    agent: "claude",
    activity: "waiting",
    title: "INTEGRATE-WORKTREE",
    preview: "Approve the git worktree add?",
  });

  it("offers no confirm button at all, not a disabled one", () => {
    const { host } = open(refusedBlocker, { agentRows: [busy] });
    expect(host.querySelector(".wt-refusebox")).not.toBeNull();
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
    expect(host.querySelectorAll(".wt-btn:disabled")).toHaveLength(0);
    expect(host.querySelector(".wt-blockers")).toBeNull();
  });

  it("also lands focus inside the refusal", () => {
    const { host } = open(refusedBlocker, { agentRows: [busy] });
    expect(host.querySelector(".wt-dialog")?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("Close");
  });

  it("names the agent that blocks it rather than just a count", () => {
    const { host, shown } = open(refusedBlocker, { agentRows: [busy] });
    expect(host.querySelector(".wt-arow .wt-atitle")?.textContent).toContain("INTEGRATE-WORKTREE");
    host.querySelector<HTMLButtonElement>(".wt-btn--primary")?.click();
    expect(shown).toEqual(["busy"]);
  });

  it("shows only the rows that are actually mid-turn", () => {
    const idle = agentRow({ rowId: "idle", agent: "codex", activity: "idle", title: "zsh" });
    const { host } = open(refusedBlocker, { agentRows: [busy, idle] });
    expect(host.querySelectorAll(".wt-arow")).toHaveLength(1);
  });

  it("explains the main worktree separately, since no confirmation overrides it", () => {
    const main = worktree({ id: "/repo", kind: "main", branch: "main" });
    const { host } = open({ ...refusedBlocker, busyAgents: 0, isMain: true }, { info: main });
    expect(host.querySelector(".wt-refusebox")?.textContent).toContain("main worktree");
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
  });
});
