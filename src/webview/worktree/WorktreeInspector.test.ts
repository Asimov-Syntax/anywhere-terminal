// @vitest-environment jsdom
//
// The inspector drawer (worktree-panel-ui § 3.7, DESIGN.md D29). Most of what is
// asserted here is what the drawer must NOT do: take focus, offer an action it
// cannot perform, name a model it was never told, or rebuild itself — and throw
// the user out of a control — on a push about something else.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { WorktreeInspector, type WorktreeInspectorDeps } from "./WorktreeInspector";
import { agentRow, worktree } from "./worktreeFixtures";
import { RosterRequests } from "./worktreeRosterRequests";
import type {
  DelegationRoster,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreePresence,
  WorktreeTree,
} from "./worktreeViewTypes";

const NOW = 1_700_000_000_000;
const WT = "/repo/wt";

afterEach(() => {
  document.body.replaceChildren();
});

function treeWith(...worktrees: WorktreeInfo[]): WorktreeTree {
  return {
    gitAvailable: true,
    unreadable: { count: 0, reasons: [] },
    repos: [{ repoId: "/repo/.git", label: "repo", mainPath: "/repo", worktrees }],
  };
}

function presenceWith(rowsByWorktreeId: Record<string, WorktreeAgentRow[]>): WorktreePresence {
  return { scannedAt: NOW, degradedSources: [], rowsByWorktreeId };
}

/** Every capability supplied, so an absent button is always a decision. */
function allActions(calls: string[]): WorktreeMenuActions {
  const record =
    (name: string) =>
    (target: { id?: string }): void => {
      calls.push(`${name}:${target.id ?? ""}`);
    };
  return {
    openFolderInNewWindow: record("openFolderInNewWindow"),
    addFolderToWorkspace: record("addFolderToWorkspace"),
    openTerminalHere: record("openTerminalHere"),
    revealWorktree: record("revealWorktree"),
    copyWorktreePath: record("copyWorktreePath"),
    toggleLock: record("toggleLock"),
    removeWorktree: record("removeWorktree"),
    createWorktree: record("createWorktree"),
    pruneRepo: record("pruneRepo"),
    launchAgentHere: record("launchAgentHere"),
  };
}

interface Mounted {
  inspector: WorktreeInspector;
  calls: string[];
  asked: string[];
  activated: { rowId: string; activation: string }[];
}

function mount(over: Partial<WorktreeInspectorDeps> = {}): Mounted {
  const calls: string[] = [];
  const asked: string[] = [];
  const activated: { rowId: string; activation: string }[] = [];
  const inspector = WorktreeInspector.mount({
    actions: allActions(calls),
    rosters: new RosterRequests(),
    onRequestSubagents: (row) => asked.push(row.rowId),
    onActivateAgent: (row, activation) => activated.push({ rowId: row.rowId, activation }),
    now: () => NOW,
    ...over,
  });
  document.body.appendChild(inspector.element);
  return { inspector, calls, asked, activated };
}

const labels = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll<HTMLElement>(".wt-ibtn")).map((b) => b.dataset.act ?? "");

const button = (el: HTMLElement, label: string): HTMLButtonElement | null =>
  el.querySelector<HTMLButtonElement>(`.wt-ibtn[data-act="${label}"]`);

describe("what the drawer shows", () => {
  it("names the branch and states the path in full", () => {
    // The path lives in exactly two places, and rows are not one of them (D16).
    const { inspector } = mount();
    inspector.setData(treeWith(worktree({ id: WT, displayPath: "/a/very/long/repo/wt", branch: "feat/x" })), null);
    inspector.open(WT);
    expect(inspector.element.querySelector(".wt-ibranch")?.textContent).toBe("feat/x");
    expect(inspector.element.querySelector(".wt-ipath")?.textContent).toBe("/a/very/long/repo/wt");
  });

  it("is not shown at all until a worktree is selected", () => {
    const { inspector } = mount();
    inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    expect(inspector.element.hidden).toBe(true);
    expect(inspector.element.children.length).toBe(0);
  });

  it("replaces its contents rather than stacking on a second selection", () => {
    const { inspector } = mount();
    inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" }), worktree({ id: "/repo/b", branch: "feat/y" })),
      null,
    );
    inspector.open(WT);
    inspector.open("/repo/b");
    expect(inspector.element.querySelectorAll(".wt-ibranch").length).toBe(1);
    expect(inspector.element.querySelector(".wt-ibranch")?.textContent).toBe("feat/y");
  });

  it("says so when the worktree holds no agents", () => {
    const { inspector } = mount();
    inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), presenceWith({}));
    inspector.open(WT);
    expect(inspector.element.querySelector(".wt-iagents")?.textContent).toContain("No agents");
  });
});

describe("the actions it offers", () => {
  const open = (info: WorktreeInfo): Mounted => {
    const m = mount();
    m.inspector.setData(treeWith(info), null);
    m.inspector.open(info.id);
    return m;
  };

  it("offers no action that targets the repository rather than this worktree", () => {
    // Create and prune act on the repo. Offering them from a surface about one
    // worktree would be the same false claim as an item that cannot act at all.
    const { inspector } = open(worktree({ id: WT, branch: "feat/x" }));
    expect(labels(inspector.element)).not.toContain("New Worktree…");
    expect(labels(inspector.element).some((l) => /^Prune /.test(l))).toBe(false);
  });

  it("withdraws the openers for a directory that is gone, and keeps Copy Path", () => {
    // Copy Path is how the user goes and looks at what happened to it.
    const { inspector } = open(worktree({ id: WT, branch: "feat/x", missing: true }));
    expect(labels(inspector.element)).not.toContain("Open Terminal Here");
    expect(labels(inspector.element)).not.toContain("Reveal in Finder");
    expect(labels(inspector.element)).toContain("Copy Path");
  });

  it("offers no removal for the main worktree", () => {
    const { inspector } = open(worktree({ id: "/repo", kind: "main", branch: "main" }));
    expect(labels(inspector.element)).not.toContain("Remove Worktree…");
  });

  it("offers nothing at all when no capability was supplied", () => {
    // Absent, never present and inert.
    const inspector = WorktreeInspector.mount({ rosters: new RosterRequests(), now: () => NOW });
    document.body.appendChild(inspector.element);
    inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    inspector.open(WT);
    expect(labels(inspector.element)).toEqual([]);
  });

  it("raises the same capability the menu raises, on the worktree the user saw", () => {
    const info = worktree({ id: WT, branch: "feat/x" });
    const m = open(info);
    button(m.inspector.element, "Remove Worktree…")?.click();
    button(m.inspector.element, "Copy Path")?.click();
    // The host resolves both from the id — the view never supplies a path.
    expect(m.calls).toEqual([`removeWorktree:${WT}`, `copyWorktreePath:${WT}`]);
  });
});

describe("the agents it presents", () => {
  const withAgents = (...rows: WorktreeAgentRow[]): Mounted => {
    const m = mount();
    m.inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), presenceWith({ [WT]: rows }));
    m.inspector.open(WT);
    return m;
  };

  it("names the model here, where there is room for it", () => {
    const { inspector } = withAgents(agentRow({ rowId: "a", agent: "claude", model: "claude-opus-5" }));
    expect(inspector.element.querySelector(".wt-amodel")?.textContent).toBe("claude-opus-5");
  });

  it("names nothing when the model is unknown", () => {
    // A placeholder would claim we asked and were told.
    const { inspector } = withAgents(agentRow({ rowId: "a", agent: "claude" }));
    expect(inspector.element.querySelector(".wt-amodel")).toBeNull();
  });

  it("never offers focus for an agent running outside this window", () => {
    // There is no pane in this window to reveal (§ 4).
    const m = withAgents(agentRow({ rowId: "ext", scope: "external", entryId: "claude:s1" }));
    m.inspector.element.querySelector<HTMLElement>(".wt-arow")?.click();
    expect(m.activated).toEqual([{ rowId: "ext", activation: "preview" }]);
  });

  it("presents rows as list items that a keyboard can reach", () => {
    // `treeitem` outside a tree is invalid, and the drawer has no roving stop.
    const { inspector } = withAgents(agentRow({ rowId: "a", entryId: "claude:s1" }));
    const row = inspector.element.querySelector<HTMLElement>(".wt-arow");
    expect(row?.getAttribute("role")).toBe("listitem");
    expect(row?.tabIndex).toBe(0);
    expect(row?.hasAttribute("aria-expanded")).toBe(false);
  });
});

describe("the delegation history", () => {
  const historyOf = (roster: DelegationRoster | undefined, entryId?: string): string => {
    const m = mount();
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" })),
      presenceWith({ [WT]: [agentRow({ rowId: "a", ...(entryId ? { entryId } : {}), delegations: roster })] }),
    );
    m.inspector.open(WT);
    return m.inspector.element.querySelector(".wt-hist")?.textContent ?? "";
  };

  it("is shown without a second disclosure", () => {
    const text = historyOf({ kind: "ok", rows: [{ name: "reviewer", status: "completed", live: false }] }, "claude:s1");
    expect(text).toContain("reviewer");
  });

  it("distinguishes a history not yet read from one that is empty", () => {
    expect(historyOf(undefined, "claude:s1")).toContain("Reading…");
    expect(historyOf({ kind: "ok", rows: [] }, "claude:s1")).toContain("No delegations found");
  });

  it("distinguishes one that could not be read, and one that was incomplete", () => {
    expect(historyOf({ kind: "failed", reason: "EACCES" }, "claude:s1")).toContain("EACCES");
    expect(historyOf({ kind: "ok", rows: [], incomplete: true }, "claude:s1")).toContain("could not be read");
  });

  it("says a row with no session has nothing to read, rather than waiting for ever", () => {
    // Nothing will ever be asked for it, so "Reading…" would promise an answer
    // that cannot arrive.
    expect(historyOf(undefined)).not.toContain("Reading…");
    expect(historyOf(undefined)).toContain("No session");
  });

  it("asks for a roster it does not hold, once, after the DOM is built", () => {
    // A host that answered synchronously would otherwise re-enter a half-built
    // render, so what matters is the DOM as seen FROM the request.
    const drawnAtRequest: boolean[] = [];
    let inspector: WorktreeInspector | undefined;
    const m = mount({
      onRequestSubagents: () => drawnAtRequest.push(inspector?.element.querySelector(".wt-arow") !== null),
    });
    inspector = m.inspector;
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" })),
      presenceWith({ [WT]: [agentRow({ rowId: "a", entryId: "claude:s1" })] }),
    );
    m.inspector.open(WT);
    expect(drawnAtRequest).toEqual([true]);
  });

  it("does not ask twice for the same session", () => {
    const m = mount();
    const data = (): void =>
      m.inspector.setData(
        treeWith(worktree({ id: WT, branch: "feat/x" })),
        presenceWith({ [WT]: [agentRow({ rowId: "a", entryId: "claude:s1" })] }),
      );
    data();
    m.inspector.open(WT);
    m.inspector.close();
    m.inspector.open(WT);
    expect(m.asked).toEqual(["a"]);
  });
});

describe("what a push does to an open drawer", () => {
  function openedOnFocusedButton(): Mounted {
    const m = mount();
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" }), worktree({ id: "/repo/b", branch: "feat/y" })),
      presenceWith({ [WT]: [agentRow({ rowId: "a", agent: "claude", title: "Building" })] }),
    );
    m.inspector.open(WT);
    button(m.inspector.element, "Copy Path")?.focus();
    return m;
  }

  it("leaves the very same node focused when nothing it draws moved", () => {
    // Node identity, not a same-labelled replacement: rebuilding and refocusing
    // would pass a weaker assertion while still having destroyed the DOM.
    const m = openedOnFocusedButton();
    const before = document.activeElement;
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" }), worktree({ id: "/repo/b", branch: "feat/y" })),
      presenceWith({ [WT]: [agentRow({ rowId: "a", agent: "claude", title: "Building" })] }),
    );
    expect(document.activeElement).toBe(before);
  });

  it("ignores a change to another worktree, a repo label, and the listing's health", () => {
    // Guarding on the full-tree signature would rebuild the drawer for all three.
    const m = openedOnFocusedButton();
    const before = document.activeElement;
    m.inspector.setData(
      {
        gitAvailable: false,
        unreadable: { count: 4, reasons: ["EACCES"] },
        repos: [
          {
            repoId: "/repo/.git",
            label: "renamed",
            mainPath: "/repo",
            degraded: "listing failed",
            worktrees: [
              worktree({ id: WT, branch: "feat/x" }),
              worktree({ id: "/repo/b", branch: "feat/y", locked: true }),
            ],
          },
        ],
      },
      presenceWith({
        [WT]: [agentRow({ rowId: "a", agent: "claude", title: "Building" })],
        "/repo/b": [agentRow({ rowId: "z", agent: "codex", title: "Elsewhere" })],
      }),
    );
    expect(document.activeElement).toBe(before);
  });

  it("keeps the focused control focused across a redraw it did perform", () => {
    // The redraw detaches whatever holds focus and focus falls to <body>, which
    // would throw a keyboard user out of the drawer on an unrelated agent's tick.
    const m = openedOnFocusedButton();
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" }), worktree({ id: "/repo/b", branch: "feat/y" })),
      presenceWith({ [WT]: [agentRow({ rowId: "a", agent: "claude", title: "Building something else" })] }),
    );
    expect(document.activeElement).toBe(button(m.inspector.element, "Copy Path"));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("does redraw when the worktree it is describing changes", () => {
    // The guard has to be a scope, not a freeze.
    const m = openedOnFocusedButton();
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/renamed" })),
      presenceWith({ [WT]: [agentRow({ rowId: "a", agent: "claude", title: "Building" })] }),
    );
    expect(m.inspector.element.querySelector(".wt-ibranch")?.textContent).toBe("feat/renamed");
  });

  it("redraws a claim that changed with the clock alone", () => {
    // Confidence crosses the ceiling with no push behind it, so `refresh` is what
    // keeps the drawer agreeing with the tree about the same row.
    let now = NOW;
    const m = mount({ now: () => now });
    const row = agentRow({
      rowId: "a",
      agent: "claude",
      activity: "running",
      activitySource: "output",
      stateStartedAt: NOW,
    });
    m.inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), presenceWith({ [WT]: [row] }));
    m.inspector.open(WT);
    const before = m.inspector.element.querySelector(".wt-state")?.className;

    now = NOW + 6 * 60_000;
    m.inspector.refresh();
    expect(m.inspector.element.querySelector(".wt-state")?.className).not.toBe(before);
  });
});

describe("dismissal", () => {
  it("takes no focus when it opens", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.focus();

    const m = mount();
    m.inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    m.inspector.open(WT);
    expect(document.activeElement).toBe(anchor);
  });

  it("reports whether focus was inside when it closed", () => {
    // The owner returns focus to the row — but only when the drawer had it, or
    // closing would steal focus from wherever the user actually was.
    const closed: { worktreeId: string; focusWasInside: boolean }[] = [];
    const m = mount({ onClosed: (worktreeId, focusWasInside) => closed.push({ worktreeId, focusWasInside }) });
    m.inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);

    m.inspector.open(WT);
    m.inspector.close();
    expect(closed).toEqual([{ worktreeId: WT, focusWasInside: false }]);

    m.inspector.open(WT);
    button(m.inspector.element, "Copy Path")?.focus();
    m.inspector.close();
    expect(closed[1]).toEqual({ worktreeId: WT, focusWasInside: true });
  });

  it("closes from its own control, and reopens on the same worktree afterwards", () => {
    const m = mount();
    m.inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    m.inspector.open(WT);
    m.inspector.element.querySelector<HTMLButtonElement>(".wt-idismiss")?.click();
    expect(m.inspector.isOpen()).toBe(false);
    expect(m.inspector.element.hidden).toBe(true);

    // The guard must not treat a reopen on the same worktree as a no-op.
    m.inspector.open(WT);
    expect(m.inspector.isOpen()).toBe(true);
    expect(m.inspector.element.querySelector(".wt-ibranch")?.textContent).toBe("feat/x");
  });

  it("shows nothing once the worktree it described has left the tree", () => {
    const m = mount();
    m.inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    m.inspector.open(WT);
    m.inspector.setData(treeWith(worktree({ id: "/repo/b", branch: "feat/y" })), null);
    expect(m.inspector.element.hidden).toBe(true);
  });

  it("draws again when that worktree comes back unchanged", () => {
    // A listing that briefly failed returns the same worktree, so the signature
    // matches the one the emptied DOM was built from — and the drawer would stay
    // blank for a selection it still holds.
    const m = mount();
    const envelope = (): void => m.inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    envelope();
    m.inspector.open(WT);
    m.inspector.setData(treeWith(), null);
    envelope();
    expect(m.inspector.element.hidden).toBe(false);
    expect(m.inspector.element.querySelector(".wt-ibranch")?.textContent).toBe("feat/x");
  });
});

describe("[3_1] focus survives a redraw of any row kind", () => {
  const roster = {
    kind: "ok" as const,
    rows: [{ name: "reviewer", status: "completed" as const, live: false }],
  };

  function openedOn(title: string): Mounted {
    const m = mount();
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" })),
      presenceWith({
        [WT]: [agentRow({ rowId: "a", agent: "claude", entryId: "claude:s1", title, delegations: roster })],
      }),
    );
    m.inspector.open(WT);
    return m;
  }

  const redrawWith = (m: Mounted, title: string): void =>
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" })),
      presenceWith({
        [WT]: [agentRow({ rowId: "a", agent: "claude", entryId: "claude:s1", title, delegations: roster })],
      }),
    );

  it("keeps a focused agent row focused", () => {
    // The rows are tab stops the drawer created; restoring only its own buttons
    // left every one of them unrestorable (round-1 B1).
    const m = openedOn("Building");
    m.inspector.element.querySelector<HTMLElement>(".wt-arow")?.focus();
    redrawWith(m, "Building something else");
    expect(document.activeElement).toBe(m.inspector.element.querySelector(".wt-arow"));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("keeps a focused delegation row focused", () => {
    const m = openedOn("Building");
    m.inspector.element.querySelector<HTMLElement>(".wt-srow")?.focus();
    redrawWith(m, "Building something else");
    expect(document.activeElement).toBe(m.inspector.element.querySelector(".wt-srow"));
  });

  it("does not confuse an action key with a row of the same name", () => {
    // Three vocabularies share one restore pass, so the keys are namespaced.
    const m = openedOn("Building");
    const btn = button(m.inspector.element, "Copy Path");
    btn?.focus();
    redrawWith(m, "Building something else");
    expect(document.activeElement).toBe(button(m.inspector.element, "Copy Path"));
  });
});

describe("[3_1] what the guard cannot see", () => {
  it("redraws its actions when told the capabilities moved", () => {
    // A launch target arriving mutates the shared action record and moves no
    // field in the key, so the drawer went on offering what it had (round-1 B3).
    const calls: string[] = [];
    const actions: WorktreeMenuActions = { copyWorktreePath: () => calls.push("copy") };
    const inspector = WorktreeInspector.mount({ actions, rosters: new RosterRequests(), now: () => NOW });
    document.body.appendChild(inspector.element);
    inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    inspector.open(WT);
    expect(labels(inspector.element)).not.toContain("Start an Agent Here…");

    actions.launchAgentHere = () => calls.push("launch");
    inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    expect(labels(inspector.element)).not.toContain("Start an Agent Here…");

    inspector.invalidate();
    inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    expect(labels(inspector.element)).toContain("Start an Agent Here…");
  });

  it("withdraws an action the same way when the capability goes", () => {
    const actions: WorktreeMenuActions = { launchAgentHere: () => {} };
    const inspector = WorktreeInspector.mount({ actions, rosters: new RosterRequests(), now: () => NOW });
    document.body.appendChild(inspector.element);
    inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    inspector.open(WT);
    expect(labels(inspector.element)).toContain("Start an Agent Here…");

    delete actions.launchAgentHere;
    inspector.invalidate();
    inspector.setData(treeWith(worktree({ id: WT, branch: "feat/x" })), null);
    expect(labels(inspector.element)).toEqual([]);
  });
});

describe("[3_1] a delegation history is a valid part of the list", () => {
  const listOf = (delegations: DelegationRoster | undefined): HTMLElement => {
    const m = mount();
    m.inspector.setData(
      treeWith(worktree({ id: WT, branch: "feat/x" })),
      presenceWith({ [WT]: [agentRow({ rowId: "a", entryId: "claude:s1", ...(delegations ? { delegations } : {}) })] }),
    );
    m.inspector.open(WT);
    const list = m.inspector.element.querySelector<HTMLElement>(".wt-iagents");
    if (list === null) {
      throw new Error("no agent list");
    }
    return list;
  };

  it("puts every direct child of the list in a list item", () => {
    // A `list` is not a valid child of a `list` (round-1 W1).
    const list = listOf({ kind: "ok", rows: [{ name: "reviewer", status: "completed", live: false }] });
    expect(list.getAttribute("role")).toBe("list");
    const roles = Array.from(list.children).map((c) => c.getAttribute("role"));
    expect(roles.every((r) => r === "listitem")).toBe(true);
  });

  it("claims to be a list only where there is something to list", () => {
    // Empty, unread and failed sections carry a note, not rows.
    for (const roster of [
      undefined,
      { kind: "ok" as const, rows: [] },
      { kind: "failed" as const, reason: "EACCES" },
    ]) {
      expect(listOf(roster).querySelector(".wt-hist")?.getAttribute("role")).not.toBe("list");
    }
    expect(
      listOf({ kind: "ok", rows: [{ name: "reviewer", status: "completed", live: false }] })
        .querySelector(".wt-hist")
        ?.getAttribute("role"),
    ).toBe("list");
  });
});

describe("the cap that keeps the tree scannable", () => {
  it("bounds the drawer and keeps the tree scrolling, per the stylesheet", () => {
    // jsdom applies no stylesheet, so the layout contract is read from source —
    // the technique the reduced-motion and focus-reveal contracts already use.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(here, "worktreePanel.css"), "utf8");

    const rule = (selector: string): string => {
      const found = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
      expect(found, `no rule for ${selector}`).not.toBeNull();
      return found?.[1] ?? "";
    };

    const inspector = rule(".wt-inspector");
    expect(inspector).toMatch(/max-height:\s*50%/);
    expect(inspector).toMatch(/overflow-y:\s*auto/);
    // It takes only what the cap allows; the tree keeps the rest.
    expect(inspector).toMatch(/flex:\s*0\s+0\s+auto/);

    // The wrapper has to REPEAT the flex contract `.wt-tree` used to get from
    // `.vault-body` directly. Without it those properties are inert and the tree
    // grows to content height and is clipped rather than scrolling.
    const body = rule(".wt-body");
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/flex:\s*1\s+1\s+auto/);
    expect(body).toMatch(/min-height:\s*0/);

    const tree = rule(".wt-tree");
    expect(tree).toMatch(/min-height:\s*0/);
    expect(tree).toMatch(/overflow-y:\s*auto/);
  });
});
