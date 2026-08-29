// @vitest-environment jsdom

// The two answers to "remove this worktree?", against docs/ui/worktree.html § 11
// (one confirmation naming every blocker) and § 12 (refused outright).

import { afterEach, describe, expect, it } from "vitest";
import { isRemoveRefused, openWorktreeRemoveDialog } from "./WorktreeRemoveDialog";
import { agentRow, confirmableBlocker, refusedBlocker, worktree } from "./worktreeFixtures";
import { CONFIRMATION_CEILING_MS } from "./worktreeFormat";
import type { PresenceDegradation, WorktreeAgentRow, WorktreeInfo, WorktreeRemoveBlocker } from "./worktreeViewTypes";

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

function open(
  blocker: WorktreeRemoveBlocker,
  over: {
    info?: WorktreeInfo;
    agentRows?: WorktreeAgentRow[];
    degradedSources?: PresenceDegradation[];
    now?: number;
  } = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const confirmed: string[] = [];
  const shown: string[] = [];
  openWorktreeRemoveDialog(host, {
    info: over.info ?? SPIKE,
    blocker,
    agentRows: over.agentRows,
    degradedSources: over.degradedSources ?? [],
    now: over.now,
    onConfirm: (fingerprint) => confirmed.push(fingerprint),
    onShowAgent: (row) => shown.push(row.rowId),
  });
  return { host, confirmed, shown };
}

const NESTED = [{ worktreeId: "/repo-wt/spike/inner", displayPath: "/repo-wt/spike/inner" }];

describe("isRemoveRefused", () => {
  it("refuses on a busy agent, the main worktree, or a nested worktree, and nothing else", () => {
    expect(isRemoveRefused(refusedBlocker)).toBe(true);
    expect(isRemoveRefused({ ...refusedBlocker, busyAgents: 0, isMain: true })).toBe(true);
    // D4: git's `remove --force` would delete the child's files and leave a
    // prunable child record behind, and no confirmation about THIS worktree can
    // honestly describe losing that one.
    expect(isRemoveRefused({ ...refusedBlocker, busyAgents: 0, containsWorktrees: NESTED })).toBe(true);
    expect(isRemoveRefused(confirmableBlocker)).toBe(false);
  });
});

describe("remove worktree — refused for containment (design.md D4)", () => {
  function openNested(children = NESTED) {
    return open({ ...refusedBlocker, busyAgents: 0, containsWorktrees: children });
  }

  it("offers no confirm button", () => {
    const { host } = openNested();
    expect(host.querySelector(".wt-dialog-confirm")).toBeNull();
  });

  it("does NOT explain the refusal as a busy agent", () => {
    // The refusal box used to be a two-branch if/else, so a third reason fell
    // into the agent branch and told the user to stop an agent that is not
    // running. That is worse than saying nothing.
    const { host } = openNested();
    const text = host.querySelector(".wt-refusebox")?.textContent ?? "";
    expect(text).not.toMatch(/agent/i);
  });

  it("names the worktree that would be destroyed with it", () => {
    const { host } = openNested();
    expect(host.querySelector(".wt-refusebox")?.textContent).toContain("/repo-wt/spike/inner");
  });

  it("names every nested worktree, not only the first", () => {
    const { host } = openNested([
      { worktreeId: "/repo-wt/spike/a", displayPath: "/repo-wt/spike/a" },
      { worktreeId: "/repo-wt/spike/b", displayPath: "/repo-wt/spike/b" },
    ]);
    const text = host.querySelector(".wt-refusebox")?.textContent ?? "";
    expect(text).toContain("/repo-wt/spike/a");
    expect(text).toContain("/repo-wt/spike/b");
  });

  it("still explains the main worktree as the main worktree when both apply", () => {
    // isMain is the more fundamental refusal and stays the headline.
    const { host } = open({ ...refusedBlocker, busyAgents: 0, isMain: true, containsWorktrees: NESTED });
    expect(host.querySelector(".wt-refusebox")?.textContent).toContain("main worktree");
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

  // The dialog borrows `renderAgentRow`, so the row's second line arrives here too.
  it("carries the row's preview line into the dialog unchanged", () => {
    const { host } = open(refusedBlocker, { agentRows: [{ ...busy, preview: "⠋ Approve the git worktree add?" }] });
    expect(host.querySelector(".wt-arow .wt-apreview")?.textContent).toBe("Approve the git worktree add?");
    expect(host.querySelector(".wt-arow .wt-model")).toBeNull();
  });

  it("stops asserting a turn is in progress when every readable row is unconfirmed", () => {
    const NOW = 1_700_000_000_000;
    const stale = agentRow({
      rowId: "stale",
      agent: "claude",
      activity: "running",
      activitySource: "output",
      title: "worker",
      stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
    });
    const { host } = open(refusedBlocker, { agentRows: [stale], now: NOW });
    const copy = host.querySelector(".wt-refusebox")?.textContent ?? "";
    // The refusal STAYS — warning about a possibly-working agent is the safe side
    // of deleting a folder. What must not stay is the certainty: this same dialog
    // draws that row with the `~` hint saying a busy terminal is not proof of a
    // turn in progress, and the lead sentence sat directly above it saying it was.
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
    expect(copy).toContain("may be mid-turn");
    expect(copy).toContain("outlived what can confirm it");
    expect(copy).not.toContain("An agent is mid-turn");
  });

  it("keeps naming the unreadable rows while softening the certainty", () => {
    const NOW = 1_700_000_000_000;
    const stale = agentRow({
      rowId: "stale",
      agent: "claude",
      activity: "running",
      activitySource: "output",
      title: "worker",
      stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
    });
    const dark = agentRow({ rowId: "dark", agent: "codex", activity: "running", activitySource: "hook" });
    const { host } = open(refusedBlocker, {
      agentRows: [stale, dark],
      degradedSources: [{ source: "hook", reason: "endpoint down", since: NOW }],
      now: NOW,
    });
    const copy = host.querySelector(".wt-refusebox")?.textContent ?? "";
    // Softening the claim must not silently drop what the previous chain said.
    expect(copy).toContain("may be mid-turn");
    expect(copy).toContain("outlived what can confirm it");
    expect(copy).toContain("cannot be read at all");
  });

  it("names the unconfirmed part of a list it can otherwise vouch for", () => {
    const NOW = 1_700_000_000_000;
    const live = agentRow({
      rowId: "live",
      agent: "claude",
      activity: "running",
      activitySource: "hook",
      title: "reported",
    });
    const stale = agentRow({
      rowId: "stale",
      agent: "codex",
      activity: "running",
      activitySource: "output",
      title: "worker",
      stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
    });
    const { host } = open(refusedBlocker, { agentRows: [live, stale], now: NOW });
    const copy = host.querySelector(".wt-refusebox")?.textContent ?? "";
    // The vouched-for row earns the flat claim, and the stale one still has to be
    // accounted for: a sentence that mentions only the strongest evidence drops
    // the row whose glyph is drawn qualified two lines below it.
    expect(copy).toContain("An agent is mid-turn in this worktree");
    expect(copy).toContain("outlived what can confirm it");
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

describe("the confirmation states what it destroys and what it spares", () => {
  it("names all three consequences in one reading, not one at a time", () => {
    // An invariant-level check: each clause is asserted elsewhere, but a user
    // reads the box once. Losing any one of them turns the confirmation into a
    // partial account of what force does.
    const { host } = open({ ...confirmableBlocker, idlePanes: 2 });
    const text = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(text).toMatch(/irreversibl/i);
    expect(text).toMatch(/branch/i);
    expect(text).toMatch(/is kept/i);
    expect(text).toMatch(/running in a deleted directory/i);
  });

  it("does not claim the losses were reviewed, because they can still change", () => {
    const { host } = open(confirmableBlocker);
    const text = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(text).toMatch(/files written after you confirm/i);
  });
});
