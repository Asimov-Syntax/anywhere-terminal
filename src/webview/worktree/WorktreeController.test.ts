// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type {
  VaultLaunchTargetsMessage,
  WebViewToExtensionMessage,
  WorktreeCreateDefaultsMessage,
  WorktreeTreeResponseMessage,
} from "../../types/messages";
import type { PaneAttribution, PaneReport } from "../paneAttribution";
import { WorktreeController, worktreeMenuActions } from "./WorktreeController";
import {
  agentRow,
  noRepoTree,
  provisionModel,
  singleRepoPresence,
  singleRepoTree,
  twoRepoTree,
  worktree,
} from "./worktreeFixtures";
import type {
  RemovalCheck,
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeCreateDefaults,
  WorktreeInfo,
  WorktreeLaunchAgent,
  WorktreePresence,
  WorktreeRemoveReport,
  WorktreeRowActivation,
} from "./worktreeViewTypes";

interface Harness {
  controller: WorktreeController;
  posts: WebViewToExtensionMessage[];
  state: Record<string, unknown>;
}

function mount(
  over: {
    workspaceRoot?: string | null;
    rowActivation?: WorktreeRowActivation;
    onSelectWorktree?: (worktreeId: string | null) => void;
    onAttribution?: (report: PaneReport) => void;
    showPreview?: (entryId: string) => boolean;
    activatePane?: (paneId: string) => boolean;
    /** Persisted before mount — the view reads it once, at construction. */
    expandedRows?: string[];
  } = {},
): Harness {
  const posts: WebViewToExtensionMessage[] = [];
  const state: Record<string, unknown> = over.expandedRows ? { worktreeExpandedRows: over.expandedRows } : {};
  const controller = WorktreeController.mount({
    host: document.body,
    postMessage: (msg) => posts.push(msg),
    store: {
      getState: () => state as never,
      updateState: (patch) => Object.assign(state, patch),
    },
    init: {
      workspaceRoot: over.workspaceRoot === undefined ? "/repo" : over.workspaceRoot,
      rowActivation: over.rowActivation ?? "focus",
    },
    onSelectWorktree: over.onSelectWorktree,
    onAttribution: over.onAttribution,
    showPreview: over.showPreview,
    activatePane: over.activatePane,
    now: () => 1_000_000,
  });
  document.body.appendChild(controller.element);
  return { controller, posts, state };
}

/** The menu callbacks the controller actually handed the view. */
function menuActions(h: Harness) {
  return (h.controller as unknown as { view: { deps: { actions: Record<string, (i: WorktreeInfo) => void> } } }).view
    .deps.actions;
}

/**
 * Open an agent row's menu, which is what captures the values its items act on.
 * Clicking an item without this is not a path the UI has.
 */
function openAgentMenu(h: Harness, row: WorktreeAgentRow): void {
  (menuActions(h).captureTarget as unknown as (r: WorktreeAgentRow) => void)(row);
}

/** The first worktree of the fixture tree — any row resolves the same repo. */
function firstWorktree(): WorktreeInfo {
  const first = singleRepoTree().repos[0]?.worktrees[0];
  if (!first) {
    throw new Error("fixture lost its worktrees");
  }
  return first;
}

/** A button in whatever dialog is currently mounted on the document. */
function pruneButton(label: RegExp): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => label.test(b.textContent ?? ""));
}

/** Confirm the open prune dialog. Throws when none is open — that IS the assertion. */
function clickPruneConfirm(): void {
  const confirm = pruneButton(/^Prune \d+$/);
  if (!confirm) {
    throw new Error("no prune confirmation was open");
  }
  confirm.click();
}

/** A response carrying the fixture tree — the shape the host really sends. */
function response(): WorktreeTreeResponseMessage {
  return { type: "worktreeTreeResponse", tree: singleRepoTree(), presence: singleRepoPresence(1_000_000) };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("visibility", () => {
  it("declares the view visible and asks for the tree on the way in", () => {
    const { controller, posts } = mount();
    controller.setVisible(true);
    // Which agents resolve is a property of the machine, so the panel asks on
    // every way in rather than once at mount.
    expect(posts).toEqual([
      // The level says the rail is drawing rows; a scope-only subscriber sends
      // "presence" instead.
      { type: "worktreeViewVisibility", visible: true, level: "rows" },
      { type: "requestWorktreeTree" },
      { type: "requestVaultLaunchTargets", capability: "start" },
    ]);
  });

  it("says nothing when the value has not moved", () => {
    const { controller, posts } = mount();
    controller.setVisible(true);
    posts.length = 0;
    controller.setVisible(true);
    expect(posts).toEqual([]);
  });

  it("declares the view hidden without asking for anything", () => {
    const { controller, posts } = mount();
    controller.setVisible(true);
    posts.length = 0;
    controller.setVisible(false);
    expect(posts).toEqual([{ type: "worktreeViewVisibility", visible: false }]);
  });
});

describe("the tree", () => {
  it("renders the pushed tree rather than sample data", () => {
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    // Every pushed worktree is accounted for — drawn, or counted by the idle
    // disclosure that hides it. Four of this fixture's six hold no agents.
    const drawn = document.querySelectorAll(".wt-row").length;
    const hidden = Number(/^(\d+) idle/.exec(document.querySelector(".wt-idle-label")?.textContent ?? "")?.[1] ?? 0);
    expect(drawn + hidden).toBe(singleRepoTree().repos[0]?.worktrees.length);
  });

  it("renders placeholder rows until the first push arrives", () => {
    const { controller } = mount();
    controller.setVisible(true);
    expect(document.querySelector(".wt-skel")).not.toBeNull();
    controller.handleTreeResponse(response());
    expect(document.querySelector(".wt-skel")).toBeNull();
  });

  it("renders an unsolicited push the same as an answered one", () => {
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const first = document.querySelectorAll(".wt-row").length;
    controller.handleTreeResponse(response());
    expect(document.querySelectorAll(".wt-row").length).toBe(first);
  });

  it("says the workspace has no folder instead of loading forever", () => {
    const { controller } = mount({ workspaceRoot: null });
    controller.setVisible(true);
    expect(document.querySelector(".wt-skel")).toBeNull();
    expect(document.body.textContent).toContain("No folder open");
  });
});

describe("the worktree the panel has selected", () => {
  /** The row for a branch, from whatever the controller drew. */
  function row(branch: string): HTMLElement | undefined {
    return [...document.querySelectorAll<HTMLElement>(".wt-row")].find(
      (r) => r.querySelector(".wt-branch")?.textContent === branch,
    );
  }

  it("holds nothing until the user selects, then relays what they picked", () => {
    const picked: (string | null)[] = [];
    const { controller } = mount({ onSelectWorktree: (id) => picked.push(id) });
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    expect(controller.selectedWorktree()).toBeNull();
    expect(picked).toEqual([]);

    row("main")?.click();
    expect(controller.selectedWorktree()).toBe("/Users/dev/Projects/ai-oss/anywhere-terminal");
    expect(picked).toEqual(["/Users/dev/Projects/ai-oss/anywhere-terminal"]);
  });

  it("relays the drop when the selected worktree leaves the tree", () => {
    const picked: (string | null)[] = [];
    const { controller } = mount({ onSelectWorktree: (id) => picked.push(id) });
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    row("main")?.click();
    picked.length = 0;

    const tree = singleRepoTree();
    const repo = tree.repos[0];
    if (!repo) {
      throw new Error("fixture lost its repo");
    }
    repo.worktrees = repo.worktrees.filter((w) => w.branch !== "main");
    controller.handleTreeResponse({ ...response(), tree });
    expect(controller.selectedWorktree()).toBeNull();
    expect(picked).toEqual([null]);
  });
});

describe("which worktree each of this window's panes is in", () => {
  const MAIN = "/Users/dev/Projects/ai-oss/anywhere-terminal";
  const PANEL = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel";

  /** A presence envelope built from `worktreeId → rows` alone. */
  function presenceOf(rowsByWorktreeId: Record<string, WorktreeAgentRow[]>, degraded = false): WorktreePresence {
    return {
      scannedAt: 1_000_000,
      degradedSources: degraded ? [{ source: "registry", reason: "unreadable", since: 999_000 }] : [],
      rowsByWorktreeId,
    };
  }

  function pane(
    rowId: string,
    paneId: string | undefined,
    scope: "window" | "external" = "window",
    activity: WorktreeAgentRow["activity"] = "running",
  ): WorktreeAgentRow {
    const row = agentRow({ rowId, agent: "claude", activity, title: rowId });
    return { ...row, scope, ...(paneId === undefined ? {} : { paneId }) };
  }

  function capture(rowsByWorktreeId: Record<string, WorktreeAgentRow[]>, degraded = false) {
    const reports: PaneReport[] = [];
    // `maps` is the placement half, which most of these cases are about; the
    // waiting half has its own block below. Filled in the SAME callback rather
    // than derived at return — a later push has to grow both, not just one.
    const maps: PaneAttribution[] = [];
    const { controller } = mount({
      onAttribution: (r) => {
        reports.push(r);
        maps.push(r.placement);
      },
    });
    controller.setVisible(true);
    controller.handleTreeResponse({ ...response(), presence: presenceOf(rowsByWorktreeId, degraded) });
    return { controller, reports, maps };
  }

  it("places every window pane under the worktree that published it", () => {
    const { maps } = capture({
      [MAIN]: [pane("a", "pane-1"), pane("b", "pane-2")],
      [PANEL]: [pane("c", "pane-3")],
    });
    expect([...(maps.at(-1) ?? [])]).toEqual([
      ["pane-1", MAIN],
      ["pane-2", MAIN],
      ["pane-3", PANEL],
    ]);
  });

  it("places nothing for a row this window does not host, or one with no pane", () => {
    // An external row names an agent in another window and a row with no paneId
    // names no tab at all — neither says where any of THIS surface's tabs belongs.
    const { maps } = capture({
      [MAIN]: [pane("ext", "pane-9", "external"), pane("nopane", undefined), pane("ok", "pane-1")],
    });
    expect([...(maps.at(-1) ?? [])]).toEqual([["pane-1", MAIN]]);
  });

  it("omits a pane two worktrees both claim", () => {
    // Two answers to a question the evidence did not settle is not proof, so the
    // pane is left unplaced rather than resolved by whichever row came last.
    const { maps } = capture({
      [MAIN]: [pane("a", "pane-1"), pane("b", "pane-2")],
      [PANEL]: [pane("c", "pane-1")],
    });
    expect([...(maps.at(-1) ?? [])]).toEqual([["pane-2", MAIN]]);
  });

  it("keeps a pane two rows in the SAME worktree both name", () => {
    const { maps } = capture({ [MAIN]: [pane("a", "pane-1"), pane("b", "pane-1")] });
    expect([...(maps.at(-1) ?? [])]).toEqual([["pane-1", MAIN]]);
  });

  it("says nothing a second time when the attribution did not move", () => {
    const rows = { [MAIN]: [pane("a", "pane-1")] };
    const { controller, maps } = capture(rows);
    expect(maps).toHaveLength(1);

    // A fresh envelope, a later scan, the same placement: a presence push must not
    // be a reason to redraw the tab bar on its own.
    controller.handleTreeResponse({
      ...response(),
      presence: { ...presenceOf(rows), scannedAt: 2_000_000 },
    });
    expect(maps).toHaveLength(1);

    controller.handleTreeResponse({ ...response(), presence: presenceOf({ [PANEL]: [pane("a", "pane-1")] }) });
    expect(maps).toHaveLength(2);
    expect([...(maps.at(-1) ?? [])]).toEqual([["pane-1", PANEL]]);
  });

  it("reports which panes presence says are waiting, in the same report", () => {
    const { reports } = capture({
      [MAIN]: [pane("a", "pane-1", "window", "waiting"), pane("b", "pane-2")],
    });
    expect([...(reports.at(-1)?.waiting ?? [])]).toEqual(["pane-1"]);
  });

  it("raises no waiting pane for a row this window does not host", () => {
    // An external row's agent waits in ANOTHER window, on a pane that is not one
    // of our tabs. Counting it would put a mark on an escape hatch that leads
    // nowhere (spec: the count and what clearing produces cannot disagree).
    const { reports } = capture({
      [MAIN]: [pane("ext", "pane-9", "external", "waiting"), pane("ok", "pane-1")],
    });
    expect([...(reports.at(-1)?.waiting ?? [])]).toEqual([]);
  });

  it("keeps a contested pane's waiting even though its placement is dropped", () => {
    // "We cannot say which worktree this is in" is not a claim about whether it
    // needs a human. The pane is unplaced, so it is presented in every scope and
    // never counted — but the two halves answer different questions.
    const { reports } = capture({
      [MAIN]: [pane("a", "pane-1", "window", "waiting")],
      [PANEL]: [pane("c", "pane-1")],
    });
    const last = reports.at(-1);
    expect([...(last?.placement ?? [])]).toEqual([]);
    expect([...(last?.waiting ?? [])]).toEqual(["pane-1"]);
  });

  it("reports again when only the waiting half moved", () => {
    const rows = { [MAIN]: [pane("a", "pane-1")] };
    const { controller, reports } = capture(rows);
    expect(reports).toHaveLength(1);

    controller.handleTreeResponse({
      ...response(),
      presence: presenceOf({ [MAIN]: [pane("a", "pane-1", "window", "waiting")] }),
    });
    expect(reports).toHaveLength(2);
    expect([...(reports.at(-1)?.waiting ?? [])]).toEqual(["pane-1"]);
  });

  it("reports what a degraded envelope still carries", () => {
    // A failed source weakens what a row says about its AGENT; it does not remove
    // the row or move it between worktrees, so attribution stands (design.md D7).
    const { maps } = capture({ [MAIN]: [pane("a", "pane-1")] }, true);
    expect([...(maps.at(-1) ?? [])]).toEqual([["pane-1", MAIN]]);
  });

  it("says the scope was cleared, through the panel's own notice list", () => {
    // One place notices appear. A dropped scope is not a failed mutation, so it
    // reads as a statement rather than an error, and it names the worktree the
    // scope had — which by then is no longer in the tree to name itself.
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());

    controller.reportScopeCleared("/wt/gone", "feat/gone");
    const notice = [...document.querySelectorAll(".wt-notice")].find((n) => n.textContent?.includes("Scope cleared"));
    expect(notice).toBeDefined();
    expect(notice?.textContent).toContain("feat/gone");
    expect(notice?.classList.contains("wt-notice--error")).toBe(false);

    // A second drop of the same worktree replaces the first rather than stacking.
    controller.reportScopeCleared("/wt/gone", "feat/gone");
    expect(
      [...document.querySelectorAll(".wt-notice")].filter((n) => n.textContent?.includes("Scope cleared")),
    ).toHaveLength(1);
  });
});

describe("refresh", () => {
  it("forces a rebuild and marks the tree as refreshing until it answers", () => {
    const { controller, posts } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    posts.length = 0;

    controller.requestRefresh();
    expect(posts).toEqual([{ type: "requestWorktreeTree", force: true }]);
    expect(document.querySelector(".wt-refreshing")).not.toBeNull();
    expect(document.querySelectorAll(".wt-row").length).toBeGreaterThan(0);

    controller.handleTreeResponse(response());
    expect(document.querySelector(".wt-refreshing")).toBeNull();
  });

  it("drops the refreshing mark when the view stops being shown", () => {
    // The host skips pushes to a surface that stopped showing the view, so the
    // answer to this force is never coming back.
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    controller.requestRefresh();
    controller.setVisible(false);
    expect(document.querySelector(".wt-refreshing")).toBeNull();
  });

  it("asks for nothing while the view is not shown", () => {
    const { controller, posts } = mount();
    controller.requestRefresh();
    expect(posts).toEqual([]);
  });
});

describe("actions it cannot perform", () => {
  it("opens the worktree context menu, now that its actions post something", () => {
    // This replaces the case that asserted NO menu: it encoded the state before
    // the controller had any action path, which task 3_2 is what ends.
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const row = document.querySelector<HTMLElement>(".wt-row");
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const items = Array.from(document.querySelectorAll(".vault-context-menu button")).map((b) => b.textContent);
    expect(items).toContain("Copy Path");
  });

  it("opens no create form, because nothing would run it", () => {
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    expect(document.querySelector(".wt-dialog")).toBeNull();
  });
});

describe("persisted disclosure state", () => {
  it("writes a collapse the user made back to the store", () => {
    const { controller, state } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const toggled = document.querySelector<HTMLElement>(".wt-row");
    toggled?.click();
    expect(Array.isArray(state.worktreeCollapsed)).toBe(true);
  });

  it("restores a persisted collapse set on mount", () => {
    const tree = singleRepoTree();
    const first = tree.repos[0]?.worktrees[0];
    expect(first).toBeDefined();
    const posts: WebViewToExtensionMessage[] = [];
    const state: Record<string, unknown> = { worktreeCollapsed: [first?.id] };
    const controller = WorktreeController.mount({
      host: document.body,
      postMessage: (msg) => posts.push(msg),
      store: { getState: () => state as never, updateState: (patch) => Object.assign(state, patch) },
      init: { workspaceRoot: "/repo", rowActivation: "focus" },
      now: () => 1_000_000,
    });
    document.body.appendChild(controller.element);
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const row = document.querySelector<HTMLElement>(`.wt-row[data-worktree-id="${first?.id}"]`);
    expect(row?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("row activation is posted as a request the host resolves", () => {
  /** The fixture's own rows, so paneId/entryId are the shapes the host really sends. */
  function activateFirstAgent(rowId: string): void {
    document.querySelector<HTMLButtonElement>(".wt-presence")?.click();
    document.querySelector<HTMLElement>(`.wt-arow[data-row-id="${rowId}"]`)?.click();
  }

  function firstWindowRow(): WorktreeAgentRow {
    const row = Object.values(singleRepoPresence(1_000_000).rowsByWorktreeId)
      .flat()
      .find((r) => r.scope === "window" && r.paneId !== undefined && r.entryId !== undefined);
    if (!row) {
      throw new Error("fixture lost its window row");
    }
    return row;
  }

  it("posts a focus request under the focus setting, and a preview request under preview", () => {
    const row = firstWindowRow();
    for (const [setting, expected] of [
      ["focus", { type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId }],
      ["preview", { type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId }],
    ] as const) {
      document.body.replaceChildren();
      const { controller, posts } = mount({ rowActivation: setting });
      controller.setVisible(true);
      controller.handleTreeResponse(response());
      posts.length = 0;
      activateFirstAgent(row.rowId);
      expect(posts).toEqual([expected]);
    }
  });

  it("follows an update that arrives after init", () => {
    // The setting is live host-side, so a view already painted must obey the new
    // value without being reopened.
    const row = firstWindowRow();
    const { controller, posts } = mount({ rowActivation: "focus" });
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    controller.setRowActivation("preview");
    posts.length = 0;
    activateFirstAgent(row.rowId);
    expect(posts).toEqual([{ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId }]);
  });
});

describe("the halves only a surface can perform", () => {
  it("hands a preview to the thing that owns the overlay, and a pane to the thing that owns panes", () => {
    const previews: string[] = [];
    const panes: string[] = [];
    const { controller } = mount({
      showPreview: (entryId) => {
        previews.push(entryId);
        return true;
      },
      activatePane: (paneId) => {
        panes.push(paneId);
        return true;
      },
    });
    controller.showPreview("claude:s1");
    controller.activatePane("pane-1");
    expect(previews).toEqual(["claude:s1"]);
    expect(panes).toEqual(["pane-1"]);
  });

  it("does nothing when this surface holds neither the entry nor the pane", () => {
    // The host sends to the surface that HOLDS the target; a surface that does
    // not must stay silent rather than post an error the user cannot act on.
    const { controller, posts } = mount({
      showPreview: () => false,
      activatePane: () => false,
    });
    controller.setVisible(true);
    posts.length = 0;
    controller.showPreview("claude:missing");
    controller.activatePane("pane-missing");
    expect(posts).toEqual([]);
    expect(document.querySelector(".vault-context-menu")).toBeNull();
  });

  it("survives a surface that supplied neither capability", () => {
    // A webview with no vault panel mounted still receives these messages.
    const { controller } = mount();
    expect(() => {
      controller.showPreview("claude:s1");
      controller.activatePane("pane-1");
    }).not.toThrow();
  });
});

describe("a subagent row's activation is its parent's", () => {
  it("focuses the PARENT's pane — a subagent has none of its own", () => {
    // Anywhere else is a dead click, and the row is presented as actionable
    // (design.md D9).
    const parent = Object.values(singleRepoPresence(1_000_000).rowsByWorktreeId)
      .flat()
      .find((r) => r.scope === "window" && r.paneId !== undefined && r.delegations?.kind === "ok");
    if (!parent) {
      throw new Error("fixture lost a window row carrying delegations");
    }
    const { controller, posts } = mount({ expandedRows: [parent.rowId] });
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    document.querySelector<HTMLButtonElement>(".wt-presence")?.click();
    posts.length = 0;
    document.querySelector<HTMLElement>(".wt-srow")?.click();
    expect(posts).toEqual([{ type: "worktreeFocusPane", rowId: parent.rowId, paneId: parent.paneId }]);
  });
});

describe("the mutating capabilities WT-005.2 supplies", () => {
  function controllerActions(repoFor?: Parameters<typeof worktreeMenuActions>[1]) {
    const posted: WebViewToExtensionMessage[] = [];
    const confirmed: string[] = [];
    return {
      actions: worktreeMenuActions(
        (m) => posted.push(m),
        repoFor,
        undefined,
        (repoId) => confirmed.push(repoId),
      ),
      posted,
      confirmed,
    };
  }

  it("offers no prune at all when nothing can answer which repository it is", () => {
    // A prune posted against a guessed repo id is not recoverable by
    // re-confirming, so absence is the only safe default (round-1 B1).
    const { actions } = controllerActions();
    expect(actions.pruneRepo).toBeUndefined();
  });

  it("asks the repository's prune to be CONFIRMED rather than posting it", () => {
    // D13: the count is the entire content of that confirmation, so a prune
    // that skips it is a different action, not a faster one (round-3 B9).
    const { actions, posted, confirmed } = controllerActions(() => ({ repoId: "/repo/.git", prunableCount: 3 }));
    actions.pruneRepo?.(worktree({ id: "/wt" }));
    expect(confirmed).toEqual(["/repo/.git"]);
    expect(posted).toEqual([]);
  });

  it("offers no prune at all when nothing can confirm it", () => {
    const posted: WebViewToExtensionMessage[] = [];
    const actions = worktreeMenuActions(
      (m) => posted.push(m),
      () => ({ repoId: "/repo/.git", prunableCount: 3 }),
    );
    expect(actions.pruneRepo).toBeUndefined();
  });

  it("confirms nothing when the count is zero, because there is nothing to confirm", () => {
    const { actions, posted, confirmed } = controllerActions(() => ({ repoId: "/repo/.git", prunableCount: 0 }));
    actions.pruneRepo?.(worktree({ id: "/wt" }));
    expect(confirmed).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("locks an unlocked worktree", () => {
    const { actions, posted } = controllerActions();
    actions.toggleLock?.(worktree({ id: "/wt", locked: false }));
    expect(posted).toEqual([{ type: "worktreeLock", worktreeId: "/wt" }]);
  });

  it("unlocks a locked one — one item, two meanings", () => {
    const { actions, posted } = controllerActions();
    actions.toggleLock?.(worktree({ id: "/wt", locked: true }));
    expect(posted).toEqual([{ type: "worktreeUnlock", worktreeId: "/wt" }]);
  });

  it("ASKS what a removal would cost, and posts no removal at all", () => {
    // The webview never decides a removal is safe, and it no longer starts one to
    // find out: the unforced `worktreeRemove` this used to post is answered by
    // deleting a clean worktree, because the host reports only from the path that
    // already attempted it (round-3 B1, design.md D6).
    const { actions, posted } = controllerActions();
    actions.removeWorktree?.(worktree({ id: "/wt" }));
    expect(posted).toEqual([{ type: "worktreeRemoveAssess", worktreeId: "/wt", token: expect.any(String) }]);
    expect(
      posted.some((m) => m.type === "worktreeRemove"),
      "the menu click posted a removal",
    ).toBe(false);
  });

  it("offers neither launch item to a caller that supplied no launch", () => {
    // WT-005.3 supplies them, but the factory still leaves both ABSENT for a
    // caller with nothing behind them — the controller lights them only once the
    // host has named an agent that can start a session.
    const { actions } = controllerActions();
    expect(actions.resumeHere).toBeUndefined();
    expect(actions.launchAgentHere).toBeUndefined();
  });

  it("hands the view both halves of create's entry path", () => {
    // The submit half is round-1 B1. The OPEN half arrived with the host's
    // defaults message: the spec says a create names the destination it will
    // actually use, so the seed is the host's answer, never a path derived here.
    const view = (mount().controller as unknown as { view: { deps: Record<string, unknown> } }).view;
    expect(typeof view.deps.onCreateSubmit).toBe("function");
    expect(typeof view.deps.createDialogDeps).toBe("function");
  });

  it("[3_1] retires the opening the form was riding, not a fresh one", () => {
    // The retirement has to name the SAME opening the form's defaults, refs and
    // offer rode, or the host refuses it as a replay from a form it replaced —
    // and refusing it is exactly right, which is what makes a wrong number here
    // silently do nothing (D1, D2).
    const h = mount();
    const view = (
      h.controller as unknown as {
        view: { deps: { createOpening(): number; onCreateClosed(opening: number): void } };
      }
    ).view;
    h.controller.openCreate();
    const opening = liveOpening(h.posts);

    // Through the same seam the view uses: it reads the opening as the form
    // opens and hands that value back at close, rather than the controller
    // resolving its own current token when the callback runs (round-1 B6).
    view.deps.onCreateClosed(view.deps.createOpening());

    expect(h.posts.filter((m) => m.type === "worktreeCreateClosed")).toEqual([
      { type: "worktreeCreateClosed", opening },
    ]);
  });

  it("maps a new-branch draft onto the create request", () => {
    const posted: WebViewToExtensionMessage[] = [];
    const h = mount();
    // Opened for real rather than driving `onCreateSubmit` on a bare mount: the
    // submit now carries the opening it was composed in, and `refsToken` starts
    // at 0 while `openCreateForRepo` advances it BEFORE it asks — so a form that
    // was never opened posts `opening: 0`, a value production can never produce
    // and the host refuses outright. Asserting it would pin a fiction (W1).
    h.controller.handleTreeResponse(response());
    h.controller.openCreate();
    h.posts.length = 0;
    const view = (
      h.controller as unknown as {
        view: { deps: { onCreateSubmit(d: unknown): void } };
      }
    ).view;
    void posted;
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "new",
      branchName: "feat",
      baseRef: "main",
      path: "/repo/.claude/worktrees/feat",
      openAfter: "none",
    });

    expect(h.posts).toEqual([
      {
        type: "worktreeCreate",
        repoId: "/repo/.git",
        opening: 1,
        path: "/repo/.claude/worktrees/feat",
        mode: { kind: "fresh", branch: "feat", baseRef: "main" },
        disposition: { kind: "free" },
        afterCreate: { kind: "none" },
      },
    ]);
  });

  it("omits an optional base ref the user left blank", () => {
    // Round-3 B11: the draft seeds `baseRef` to "", and git reads an explicit
    // empty ref as a ref — `fatal: invalid reference:`. The DEFAULT new-branch
    // create is the one this broke, so it is the one asserted here.
    const h = mount();
    // Opened for real rather than driving `onCreateSubmit` on a bare mount: the
    // submit now carries the opening it was composed in, and `refsToken` starts
    // at 0 while `openCreateForRepo` advances it BEFORE it asks — so a form that
    // was never opened posts `opening: 0`, a value production can never produce
    // and the host refuses outright. Asserting it would pin a fiction (W1).
    h.controller.handleTreeResponse(response());
    h.controller.openCreate();
    h.posts.length = 0;
    const view = (h.controller as unknown as { view: { deps: { onCreateSubmit(d: unknown): void } } }).view;
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "new",
      branchName: "feat",
      baseRef: "",
      path: "/wt",
      openAfter: "none",
    });

    expect(h.posts).toEqual([
      {
        type: "worktreeCreate",
        repoId: "/repo/.git",
        opening: 1,
        path: "/wt",
        // No `baseRef` key at all, and `fresh` rather than `reuse` — the two
        // halves of the defect this pair of properties exists to stop.
        mode: { kind: "fresh", branch: "feat" },
        disposition: { kind: "free" },
        afterCreate: { kind: "none" },
      },
    ]);
  });

  it("omits a base ref that is only whitespace", () => {
    const h = mount();
    // Opened for real rather than driving `onCreateSubmit` on a bare mount: the
    // submit now carries the opening it was composed in, and `refsToken` starts
    // at 0 while `openCreateForRepo` advances it BEFORE it asks — so a form that
    // was never opened posts `opening: 0`, a value production can never produce
    // and the host refuses outright. Asserting it would pin a fiction (W1).
    h.controller.handleTreeResponse(response());
    h.controller.openCreate();
    h.posts.length = 0;
    const view = (h.controller as unknown as { view: { deps: { onCreateSubmit(d: unknown): void } } }).view;
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "detached",
      branchName: "",
      baseRef: "   ",
      path: "/wt",
      openAfter: "none",
    });

    expect(h.posts).toEqual([
      {
        type: "worktreeCreate",
        repoId: "/repo/.git",
        opening: 1,
        path: "/wt",
        // Whitespace is not a ref, so the mode's required field takes the
        // default the host used to substitute.
        mode: { kind: "fresh-detached", baseRef: "HEAD" },
        disposition: { kind: "free" },
        afterCreate: { kind: "none" },
      },
    ]);
  });

  it("still carries a base ref the user actually typed", () => {
    // The negative that gives the two above their meaning.
    const h = mount();
    const view = (h.controller as unknown as { view: { deps: { onCreateSubmit(d: unknown): void } } }).view;
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "new",
      branchName: "feat",
      baseRef: "origin/main",
      path: "/wt",
      openAfter: "none",
    });

    expect(h.posts[0]).toMatchObject({ mode: { kind: "fresh", baseRef: "origin/main" } });
  });

  it("posts no create for a branch name that is blank", () => {
    // `-b ""` is a guaranteed git failure, and the form's own field is optional
    // only for the detached mode.
    const h = mount();
    const view = (h.controller as unknown as { view: { deps: { onCreateSubmit(d: unknown): void } } }).view;
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "new",
      branchName: "   ",
      baseRef: "main",
      path: "/wt",
      openAfter: "none",
    });

    expect(h.posts).toEqual([]);
  });

  it("[5_3] never applies an answer an earlier probe of the same opening produced", () => {
    // `token` separates two OPENINGS and `query` separates two edits, but an
    // A → B → A sequence puts two answers on the wire identical in both. The
    // late one carried a repair the newest classification had withdrawn
    // (round-1 B5).
    const h = mount();
    const ask = (branch: string): void => {
      (
        h.controller as unknown as {
          view: { deps: { createDialogDeps(): { onSelectionChange(s: { repoId: string; branch: string }): void } } };
        }
      ).view.deps
        .createDialogDeps()
        .onSelectionChange({ repoId: "/repo/.git", branch });
    };
    // Two questions, so the second is the one an answer has to match. Injecting
    // a resolution nobody asked for cannot see this rule at all.
    ask("feat");
    ask("feat");
    h.controller.handleCreateResolution({
      type: "worktreeCreateResolution",
      repoId: "/repo/.git",
      token: 0,
      seq: 2,
      query: "feat",
      mode: { kind: "fresh" },
      freePath: "/trees/repo-feat",
    });
    expect(h.controller.resolutionFor("/repo/.git")?.seq, "the setup stored no newer answer").toBe(2);

    h.controller.handleCreateResolution({
      type: "worktreeCreateResolution",
      repoId: "/repo/.git",
      token: 0,
      seq: 1,
      query: "feat",
      mode: { kind: "reattach", repairPath: "/trees/stale", expectedOid: "abc123" },
      freePath: "/trees/repo-feat",
    });

    expect(h.controller.resolutionFor("/repo/.git")?.seq).toBe(2);
    expect(h.controller.resolutionFor("/repo/.git")?.mode).toEqual({ kind: "fresh" });
  });

  it("[B9] never applies an answer older than the question now on the wire", () => {
    // `appliedSeq` compared against the newest ANSWER, so an answer for base A
    // landing after base B was asked was newer than anything applied and older
    // than the question on screen — and cleared the gate with A's verdict on B.
    // The form cannot detect it: the branch, and so `query`, is identical
    // (round-4 B9).
    const h = mount();
    const deps = (
      h.controller as unknown as {
        view: {
          deps: {
            createDialogDeps(): {
              onSelectionChange(s: { repoId: string; branch: string; base?: { kind: "ref"; ref: string } }): void;
            };
          };
        };
      }
    ).view.deps.createDialogDeps();
    deps.onSelectionChange({ repoId: "/repo/.git", branch: "feat", base: { kind: "ref", ref: "a" } });
    deps.onSelectionChange({ repoId: "/repo/.git", branch: "feat", base: { kind: "ref", ref: "b" } });

    h.controller.handleCreateResolution({
      type: "worktreeCreateResolution",
      repoId: "/repo/.git",
      token: 0,
      seq: 1,
      query: "feat",
      mode: { kind: "fresh" },
      freePath: "/trees/repo-feat",
      baseValid: { ok: true, oid: "aaa" },
    });

    expect(h.controller.resolutionFor("/repo/.git"), "base A's verdict was applied to base B").toBeUndefined();

    // The answer for the question actually on the wire still lands, so this is
    // a gate on staleness and not a controller that stopped applying answers.
    h.controller.handleCreateResolution({
      type: "worktreeCreateResolution",
      repoId: "/repo/.git",
      token: 0,
      seq: 2,
      query: "feat",
      mode: { kind: "fresh" },
      freePath: "/trees/repo-feat",
      baseValid: { ok: false, reason: '"b" does not name a commit in this repository.' },
    });
    expect(h.controller.resolutionFor("/repo/.git")?.baseValid).toEqual({
      ok: false,
      reason: '"b" does not name a commit in this repository.',
    });
  });

  it("[2_2] submits a repair the resolution corroborated, not a second worktree", () => {
    // 3_1 executes a repair and 2_1 offers one. Without this seam the form
    // could never reach either, and a stale registration would be answered by
    // a near-duplicate beside the checkout that is already there.
    const h = mount();
    const view = (h.controller as unknown as { view: { deps: { onCreateSubmit(d: unknown): void } } }).view;
    // The classification travels ON the draft — the form submits the answer it
    // was showing, rather than this controller re-reading its own copy of one
    // (round-3 B3).
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "reattach",
      branchName: "feat",
      baseRef: "",
      path: "/trees/stale",
      openAfter: "none",
      resolved: { kind: "reattach", repairPath: "/trees/stale", expectedOid: "abc123" },
    });

    expect(h.posts.find((m) => m.type === "worktreeCreate")).toMatchObject({
      mode: { kind: "reattach", branch: "feat", repairPath: "/trees/stale", expectedOid: "abc123" },
    });
  });

  it("[2_2] falls back to reuse when the submission carries no corroborated repair", () => {
    // A form saying `reattach` while carrying no repair — a resolution that
    // never arrived, or one that classified the selection as something else —
    // is describing a repair nobody corroborated. `git worktree add` against a
    // branch that exists is the honest thing to ask for instead.
    const h = mount();
    const view = (h.controller as unknown as { view: { deps: { onCreateSubmit(d: unknown): void } } }).view;
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "reattach",
      branchName: "feat",
      baseRef: "",
      path: "/trees/stale",
      openAfter: "none",
      resolved: { kind: "reuse", branch: "feat" },
    });

    expect(h.posts.find((m) => m.type === "worktreeCreate")).toMatchObject({ mode: { kind: "reuse", branch: "feat" } });
  });

  it("posts no create for an agent mode naming no agent", () => {
    // The mode and its launch details are one thing on the wire; a mode with no
    // agent would ask the host for a launch it must refuse.
    const h = mount();
    const view = (
      h.controller as unknown as {
        view: { deps: { onCreateSubmit(d: unknown): void } };
      }
    ).view;
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "existing",
      branchName: "feat",
      baseRef: "",
      path: "/wt",
      openAfter: "agent",
    });

    expect(h.posts.filter((m) => m.type === "worktreeCreate")).toEqual([]);
  });

  it("carries the launch details with the agent mode and with no other", () => {
    const h = mount();
    // Opened for real rather than driving `onCreateSubmit` on a bare mount: the
    // submit now carries the opening it was composed in, and `refsToken` starts
    // at 0 while `openCreateForRepo` advances it BEFORE it asks — so a form that
    // was never opened posts `opening: 0`, a value production can never produce
    // and the host refuses outright. Asserting it would pin a fiction (W1).
    h.controller.handleTreeResponse(response());
    h.controller.openCreate();
    h.posts.length = 0;
    const view = (
      h.controller as unknown as {
        view: { deps: { onCreateSubmit(d: unknown): void } };
      }
    ).view;
    view.deps.onCreateSubmit({
      repoId: "/repo/.git",
      branchMode: "existing",
      branchName: "feat",
      baseRef: "",
      path: "/wt",
      openAfter: "agent",
      agentId: "claude",
      permissionChoiceId: "plan",
      prompt: "read the failing test",
    });

    expect(h.posts).toEqual([
      {
        type: "worktreeCreate",
        repoId: "/repo/.git",
        opening: 1,
        path: "/wt",
        // `existing` is `reuse`, not `fresh` — the distinction the wire could
        // not carry before.
        mode: { kind: "reuse", branch: "feat" },
        disposition: { kind: "free" },
        afterCreate: {
          kind: "agent",
          waitForSetup: false,
          agent: "claude",
          permissionChoiceId: "plan",
          prompt: "read the failing test",
        },
      },
    ]);
  });
});

describe("the launch entry paths WT-005.3 supplies", () => {
  const STARTABLE: VaultLaunchTargetsMessage = {
    type: "vaultLaunchTargets",
    capability: "start",
    targets: [
      {
        agent: "claude",
        displayName: "Claude Code",
        canSeedPrompt: true,
        permissionChoices: [
          { id: "default", label: "Ask for permission" },
          { id: "bypassPermissions", label: "Bypass permission checks", dangerous: true },
        ],
      },
    ],
  };

  /** A mounted panel that has been told which agents can start a session. */
  function launchable(): Harness {
    const h = mount();
    h.controller.handleTreeResponse(response());
    h.controller.handleLaunchTargets(STARTABLE);
    return h;
  }

  it("offers neither launch item until the host names an agent that can start one", () => {
    const h = mount();
    h.controller.handleTreeResponse(response());
    const actions = menuActions(h);
    expect(actions.launchAgentHere).toBeUndefined();
    expect(actions.resumeHere).toBeUndefined();
  });

  it("lights both once an agent that can start a session is reported", () => {
    const actions = menuActions(launchable());
    expect(actions.launchAgentHere).toBeInstanceOf(Function);
    expect(actions.resumeHere).toBeInstanceOf(Function);
  });

  it("asks for start targets once at a time, however often the view is shown", () => {
    // Two answers to the same question carry nothing that orders them, so the
    // older one could land last and withdraw actions that are available.
    const h = mount();
    const asks = () => h.posts.filter((m) => m.type === "requestVaultLaunchTargets").length;
    h.controller.setVisible(true);
    h.controller.setVisible(false);
    h.controller.setVisible(true);
    expect(asks()).toBe(1);
    // Answered, so the next way in is a fresh question rather than a duplicate.
    h.controller.handleLaunchTargets(STARTABLE);
    h.controller.setVisible(false);
    h.controller.setVisible(true);
    expect(asks()).toBe(2);
  });

  it("ignores the continuation answer — the other question, and a different set", () => {
    const h = mount();
    h.controller.handleTreeResponse(response());
    h.controller.handleLaunchTargets({ ...STARTABLE, capability: "continue" });
    expect(menuActions(h).launchAgentHere).toBeUndefined();
  });

  it("withdraws the items again when the host reports nothing startable", () => {
    const h = launchable();
    h.controller.handleLaunchTargets({ ...STARTABLE, targets: [] });
    expect(menuActions(h).launchAgentHere).toBeUndefined();
  });

  it("offers a launch to the empty-scope region only when one can happen", () => {
    // The region's offer and the menu's ride the same host answer, so a region
    // can never show an offer the menu has already withdrawn.
    const h = mount();
    h.controller.handleTreeResponse(response());
    expect(h.controller.launchOfferFor(firstWorktree().id)).toBeUndefined();
    h.controller.handleLaunchTargets(STARTABLE);
    expect(h.controller.launchOfferFor(firstWorktree().id)).toBeInstanceOf(Function);
    h.controller.handleLaunchTargets({ ...STARTABLE, targets: [] });
    expect(h.controller.launchOfferFor(firstWorktree().id)).toBeUndefined();
  });

  it("offers no launch for a worktree the tree does not carry", () => {
    expect(launchable().controller.launchOfferFor("/wt/not-in-the-tree")).toBeUndefined();
  });

  it("opens the dialog for the worktree the region names, not the last menu target", () => {
    const h = launchable();
    const info = firstWorktree();
    h.controller.launchOfferFor(info.id)?.();
    const subject = document.querySelector(".wt-dialog-subject");
    expect(subject?.textContent).toBe(info.branch ?? info.displayPath);
  });

  it("posts what the dialog collected against the worktree the menu was opened on", () => {
    const h = launchable();
    const info = firstWorktree();
    (menuActions(h).launchAgentHere as (i: WorktreeInfo) => void)(info);
    const agent = document.querySelector<HTMLSelectElement>("#wt-agent");
    expect(agent?.value).toBe("claude");
    const prompt = document.querySelector<HTMLTextAreaElement>("#wt-prompt");
    if (prompt) {
      prompt.value = "look at the diff";
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /^Start agent/.test(b.textContent ?? ""),
    );
    start?.click();

    expect(h.posts.filter((m) => m.type === "worktreeLaunchAgent")).toEqual([
      {
        type: "worktreeLaunchAgent",
        worktreeId: info.id,
        agent: "claude",
        permissionChoiceId: "default",
        prompt: "look at the diff",
      },
    ]);
  });

  it("submits the offer the dialog rendered, not the one that landed while it was open", () => {
    // A dialog is open for as long as the user takes to answer it. An answer
    // arriving in that window used to relabel the earlier choice as a choice
    // made from the new list, because the submit read the panel's current
    // offer rather than the dialog's own (round-4 B1).
    const h = launchable();
    h.controller.handleLaunchTargets({ ...STARTABLE, offerId: "offer-1" });
    (menuActions(h).launchAgentHere as (i: WorktreeInfo) => void)(firstWorktree());
    h.controller.handleLaunchTargets({ ...STARTABLE, offerId: "offer-2" });
    const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /^Start agent/.test(b.textContent ?? ""),
    );
    start?.click();
    const posted = h.posts.filter((m) => m.type === "worktreeLaunchAgent")[0] as { offerId?: string } | undefined;
    expect(posted?.offerId).toBe("offer-1");
  });

  it("submits the registration the dialog rendered, not the one the tree now holds", () => {
    // The other half of the same freeze: a rebuild landing under an open dialog
    // must not let the choice be admitted against whatever now occupies the
    // path (design.md D10).
    const h = launchable();
    const stamped = (generation: number): WorktreeTreeResponseMessage => {
      const base = response();
      return { ...base, tree: { ...base.tree, repos: base.tree.repos.map((r) => ({ ...r, generation })) } };
    };
    h.controller.handleTreeResponse(stamped(4));
    (menuActions(h).launchAgentHere as (i: WorktreeInfo) => void)(firstWorktree());
    h.controller.handleTreeResponse(stamped(5));
    const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /^Start agent/.test(b.textContent ?? ""),
    );
    start?.click();
    const posted = h.posts.filter((m) => m.type === "worktreeLaunchAgent")[0] as { generation?: number } | undefined;
    expect(posted?.generation).toBe(4);
  });

  const CREATE_REPO = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";

  it("submits the create against the offer the FORM was opened under", () => {
    // The create form has the same shape of exposure as the launch dialog and
    // was left out of the first freeze: it too renders one offer and is
    // answered later (round-5 W6).
    const h = launchable();
    h.controller.handleLaunchTargets({ ...STARTABLE, offerId: "offer-1" });
    (menuActions(h).createWorktree as (i: WorktreeInfo) => void)(firstWorktree());
    h.controller.handleCreateDefaults({
      type: "worktreeCreateDefaults",
      repoId: CREATE_REPO,
      opening: 1,
      root: "/trees",
      prefix: "anywhere-terminal",
      path: "/trees/anywhere-terminal",
    });
    h.controller.handleLaunchTargets({ ...STARTABLE, offerId: "offer-2" });
    const view = (h.controller as unknown as { view: { deps: { onCreateSubmit(d: unknown): void } } }).view;
    view.deps.onCreateSubmit({
      repoId: CREATE_REPO,
      branchMode: "new",
      branchName: "feat",
      baseRef: "",
      path: "/wt",
      openAfter: "agent",
      agentId: "claude",
    });
    const created = h.posts.filter((m) => m.type === "worktreeCreate")[0] as
      | { afterCreate?: { offerId?: string } }
      | undefined;
    expect(created?.afterCreate?.offerId).toBe("offer-1");
  });

  it("resumes a row's session in the worktree that row is published under", () => {
    // The worktree is the panel's own answer, from the presence envelope — a
    // resume can never land in a worktree the row was not published under.
    const h = launchable();
    const rows = singleRepoPresence(1_000_000).rowsByWorktreeId;
    const [worktreeId, published] = Object.entries(rows)[0] as [string, WorktreeAgentRow[]];
    const row = published.find((r) => r.entryId !== undefined);
    if (!row) {
      throw new Error("fixture lost its session rows");
    }
    // Through the menu, as the only reachable path: the item is built by a menu
    // open, and the open is what captures what it is being built against.
    openAgentMenu(h, row);
    (menuActions(h).resumeHere as unknown as (r: WorktreeAgentRow) => void)(row);

    expect(h.posts.filter((m) => m.type === "worktreeResumeHere")).toEqual([
      { type: "worktreeResumeHere", worktreeId, rowId: row.rowId, entryId: row.entryId },
    ]);
  });

  it("resumes against the registration its MENU was built under, not the tree's current one", () => {
    // The exact race D10 creates on purpose: a generation-only update replaces
    // the tree and repaints nothing, so the menu on screen still belongs to the
    // registration it was opened under. Reading the tree at click time posts the
    // replacement's token and the host admits it (round-7 B5).
    const h = launchable();
    const stamped = (generation: number): WorktreeTreeResponseMessage => {
      const base = response();
      return { ...base, tree: { ...base.tree, repos: base.tree.repos.map((r) => ({ ...r, generation })) } };
    };
    h.controller.handleTreeResponse(stamped(4));
    const rows = singleRepoPresence(1_000_000).rowsByWorktreeId;
    const published = Object.values(rows)[0] as WorktreeAgentRow[];
    const row = published.find((r) => r.entryId !== undefined);
    if (!row) {
      throw new Error("fixture lost its session rows");
    }
    openAgentMenu(h, row);
    h.controller.handleTreeResponse(stamped(5));
    (menuActions(h).resumeHere as unknown as (r: WorktreeAgentRow) => void)(row);
    const posted = h.posts.filter((m) => m.type === "worktreeResumeHere")[0] as { generation?: number } | undefined;
    expect(posted?.generation).toBe(4);
  });

  it("posts no resume for a row the presence envelope never published", () => {
    const h = launchable();
    (menuActions(h).resumeHere as unknown as (r: WorktreeAgentRow) => void)({
      rowId: "ghost",
      entryId: "claude:ghost",
    } as WorktreeAgentRow);
    expect(h.posts.filter((m) => m.type === "worktreeResumeHere")).toEqual([]);
  });
});

describe("the create a toolbar with no repository opens", () => {
  const REPO_A = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";
  const REPO_B = "/Users/dev/Projects/cyberk-skills/.git";

  function answer(repoId: string, root: string): WorktreeCreateDefaultsMessage {
    return { type: "worktreeCreateDefaults", repoId, opening: 1, root, prefix: "p", path: `${root}/p-x` };
  }
  function ready(tree: WorktreeTreeResponseMessage) {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(tree);
    h.posts.length = 0;
    return h;
  }
  function twoRepoResponse(): WorktreeTreeResponseMessage {
    return { type: "worktreeTreeResponse", tree: twoRepoTree(), presence: singleRepoPresence(1_000_000) };
  }
  /** The asks a DOOR made. The open form asks for its own branch; those carry one. */
  const asks = (h: Harness) =>
    h.posts
      .filter((m) => m.type === "requestWorktreeCreateDefaults")
      .filter((m) => m.branch === undefined)
      .map((m) => m.repoId);
  const open = () => document.querySelector("#wt-branch") !== null;
  const offered = () =>
    [...(document.querySelectorAll<HTMLOptionElement>("#wt-repo-select option") ?? [])].map((o) => o.value);

  it("[1_1] asks every repository, not the one it happened to see first", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();

    expect(asks(h)).toEqual([REPO_A, REPO_B]);
  });

  it("[1_1] waits for every repository it asked before opening", () => {
    // The picker is built once, from the seed the form opened with. Opening on
    // the first reply offers a picker holding one repository and calls it the
    // whole workspace.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    expect(open()).toBe(false);

    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    expect(open()).toBe(true);
    expect(offered()).toEqual([REPO_A, REPO_B]);
  });

  it("[1_1] opens on answers that came back out of order", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));

    expect(offered()).toEqual([REPO_A, REPO_B]);
  });

  it("[1_1] a cold single-repo panel still opens", () => {
    const h = ready({ type: "worktreeTreeResponse", tree: singleRepoTree(), presence: singleRepoPresence(1_000_000) });
    h.controller.openCreate();
    expect(open()).toBe(false);
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));

    expect(open()).toBe(true);
  });

  it("[1_1] an answer that never arrives opens nothing, rather than a partial offer", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));

    expect(open()).toBe(false);
  });

  it("[B1] a branch-less answer does not unblock a form waiting on a branch", () => {
    // An opening ask carries no branch, so the form's staleness guard — which
    // compares the branch an answer is FOR — cannot catch its leftovers. One
    // arriving late cleared the wait and rewrote the derived destination for a
    // branch the user had already typed. Reachable while `pendingCreate` is
    // null: a repository answering twice, or a reconcile that opened the form
    // by dropping the repository still outstanding.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("expected the form to be open");
    }
    branch.value = "feat/x";
    branch.dispatchEvent(new Event("input", { bubbles: true }));
    branch.dispatchEvent(new Event("change", { bubbles: true }));
    const create = () => document.querySelector<HTMLButtonElement>(".wt-btn--primary");
    expect(create()?.disabled).toBe(true);

    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));

    // Still waiting on the destination for "feat/x" — nothing has answered it.
    expect(create()?.disabled).toBe(true);
  });

  it("[1_4] holds the offer and hands it to the form beside the destination", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    h.controller.handleProvisionOffer({
      type: "worktreeProvisionOffer",
      repoId: REPO_A,
      opening: 1,
      offerId: "provision-1",
      model: provisionModel(),
    });

    expect(document.querySelectorAll(".wt-brow")).toHaveLength(5);
  });

  it("[1_4] keeps the offer while the destination is re-answered per keystroke", () => {
    // The host issues ONE offer per form and answers the destination on every
    // settled edit. An offer folded into that reply would be dropped by the
    // second answer, taking the section with it.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    h.controller.handleProvisionOffer({
      type: "worktreeProvisionOffer",
      repoId: REPO_A,
      opening: 1,
      offerId: "provision-1",
      model: provisionModel(),
    });
    h.controller.handleCreateDefaults({ ...answer(REPO_A, "/trees/a"), branch: "feat/x" });

    expect(document.querySelectorAll(".wt-brow")).toHaveLength(5);
  });

  it("[r2 B6] opening a form drops the previous form's offer", () => {
    // A reopened dialog seeded from the cache showed the old model while its own
    // read was still outstanding — and if that read FAILED, kept showing it.
    const h = ready(twoRepoResponse());
    h.controller.handleProvisionOffer({
      type: "worktreeProvisionOffer",
      repoId: REPO_A,
      opening: 1,
      offerId: "provision-1",
      model: provisionModel(),
    });
    h.controller.openCreate();
    const held = (h.controller as unknown as { provisionOffers: Map<string, unknown> }).provisionOffers;

    expect(held.size).toBe(0);
  });

  // ── The branch list ────────────────────────────────────────────────────

  const refsAsks = (h: Harness) => h.posts.filter((m) => m.type === "requestWorktreeRefs").map((m) => m.repoId);
  const refsHeld = (h: Harness) => (h.controller as unknown as { repoRefs: Map<string, unknown> }).repoRefs;

  it("[1_2] asks every repository for its branches when a create opens", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();

    expect(refsAsks(h)).toEqual([REPO_A, REPO_B]);
  });

  it("[1_2] opens the form on the destination alone, before any branch list arrives", () => {
    // The list is not part of `pendingCreate`: a repository whose enumeration
    // is slow, or fails outright, must never hold the dialog shut.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));

    expect(open()).toBe(true);
    expect(refsHeld(h).size).toBe(0);
  });

  it("[1_2] gains the list when it lands, without disturbing the destination gate", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    const applied: { repoId: string; refs: unknown }[] = [];
    (h.controller as unknown as { applyRefs?: (r: string, x: unknown) => void }).applyRefs = (repoId, refs) =>
      applied.push({ repoId, refs });

    h.controller.handleRefs({
      type: "worktreeRefs",
      repoId: REPO_A,
      token: 1,
      refs: [{ name: "main" }],
      truncated: false,
    });

    expect(applied).toEqual([{ repoId: REPO_A, refs: { list: [{ name: "main" }], truncated: false } }]);
    expect(refsHeld(h).get(REPO_A)).toBeDefined();
  });

  it("[2_2] hands the forge's answer to the open form", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    const applied: { repoId: string; offer: unknown }[] = [];
    (h.controller as unknown as { applyPullRequests?: (r: string, x: unknown) => void }).applyPullRequests = (
      repoId,
      offer,
    ) => applied.push({ repoId, offer });

    h.controller.handlePullRequests({
      type: "worktreePullRequests",
      repoId: REPO_A,
      token: 1,
      pullRequests: [
        { number: 9, title: "Ship it", headRefName: "ship", baseRefName: "main", fromFork: false, headOwner: "acme" },
      ],
      truncated: false,
      available: true,
    });

    expect(applied).toEqual([
      {
        repoId: REPO_A,
        offer: {
          list: [
            {
              number: 9,
              title: "Ship it",
              headRefName: "ship",
              baseRefName: "main",
              fromFork: false,
              headOwner: "acme",
            },
          ],
          truncated: false,
          available: true,
        },
      },
    ]);
  });

  it("[2_2] carries the unavailable answer through rather than dropping it", () => {
    // § 5 has a row for "the forge could not answer". Swallowing it here would
    // leave the form on "not asked yet" forever, which says something else.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    const applied: unknown[] = [];
    (h.controller as unknown as { applyPullRequests?: (r: string, x: unknown) => void }).applyPullRequests = (
      _repoId,
      offer,
    ) => applied.push(offer);

    h.controller.handlePullRequests({
      type: "worktreePullRequests",
      repoId: REPO_A,
      token: 1,
      available: false,
    });

    // The union carries no list and no cap for unavailable (round-1 W2): those
    // fields belonged to an answer that did not happen, and an empty list beside
    // `available: false` is the "answered with nothing" the row must not mean.
    expect(applied).toEqual([{ available: false }]);
  });

  it("[2_2] drops a forge answer that outlived its opening", () => {
    // Same rule as the refs answer, and for the same reason: both answer one
    // opening's `requestWorktreeRefs`, so a predecessor's rows must not seed
    // the form the user has open now.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    const applied: string[] = [];
    (h.controller as unknown as { applyPullRequests?: (r: string, x: unknown) => void }).applyPullRequests = (repoId) =>
      applied.push(repoId);

    h.controller.handlePullRequests({
      type: "worktreePullRequests",
      repoId: REPO_A,
      token: 1,
      pullRequests: [],
      truncated: false,
      available: true,
    });

    expect(applied, "the first opening's forge answer reached the second opening's form").toEqual([]);

    h.controller.handlePullRequests({
      type: "worktreePullRequests",
      repoId: REPO_A,
      token: 2,
      pullRequests: [],
      truncated: false,
      available: true,
    });

    expect(applied).toEqual([REPO_A]);
  });

  it("[4_2][r2 W2] an answer to a PREVIOUS opening is dropped, and the current one still applies", () => {
    // `repoId` names a repository, not an opening. Reopened on the same
    // repository, the predecessor's answer is indistinguishable from the
    // successor's without the token — and it would overwrite the successor's
    // list, permanently if the successor's own read fails (round-2 W2).
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    const applied: string[] = [];
    (h.controller as unknown as { applyRefs?: (r: string, x: unknown) => void }).applyRefs = (repoId) =>
      applied.push(repoId);

    h.controller.handleRefs({
      type: "worktreeRefs",
      repoId: REPO_A,
      token: 1,
      refs: [{ name: "stale" }],
      truncated: false,
    });

    expect(applied, "the first opening's answer reached the second opening's form").toEqual([]);
    expect(refsHeld(h).get(REPO_A), "a superseded answer seeded the cache").toBeUndefined();

    h.controller.handleRefs({
      type: "worktreeRefs",
      repoId: REPO_A,
      token: 2,
      refs: [{ name: "main" }],
      truncated: false,
    });

    expect(applied).toEqual([REPO_A]);
  });

  it("[2_1] a resolution answering a PREVIOUS opening is dropped, and the current one is kept", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.openCreate();

    h.controller.handleCreateResolution({
      type: "worktreeCreateResolution",
      repoId: REPO_A,
      token: 1,
      seq: 0,
      query: "feat",
      mode: { kind: "reuse" },
      freePath: "/trees/stale",
    });

    expect(h.controller.resolutionFor(REPO_A), "a superseded resolution was kept").toBeUndefined();

    h.controller.handleCreateResolution({
      type: "worktreeCreateResolution",
      repoId: REPO_A,
      token: 2,
      seq: 0,
      query: "feat",
      mode: { kind: "fresh" },
      freePath: "/trees/fresh",
    });

    expect(h.controller.resolutionFor(REPO_A)).toMatchObject({ mode: { kind: "fresh" }, freePath: "/trees/fresh" });
  });

  it("[2_1] a reopening drops the resolution the previous form was holding", () => {
    // Kept on the same terms as the branch list: a resolution seeded from the
    // previous form describes a repository state that may have moved, and the
    // honest opening state is "not told yet".
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateResolution({
      type: "worktreeCreateResolution",
      repoId: REPO_A,
      token: 1,
      seq: 0,
      query: "feat",
      mode: { kind: "fresh" },
      freePath: "/trees/fresh",
    });
    expect(h.controller.resolutionFor(REPO_A), "the setup never stored anything to clear").toBeDefined();

    h.controller.openCreate();

    expect(h.controller.resolutionFor(REPO_A)).toBeUndefined();
  });

  it("[1_7] posts the authorization request the recover offer asked for, under the current opening", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    const deps = (
      h.controller as unknown as {
        view: { deps: { createDialogDeps(): { onAuthorizeDebris(r: { repoId: string; path: string }): void } } };
      }
    ).view.deps.createDialogDeps();

    deps.onAuthorizeDebris({ repoId: REPO_A, path: "/trees/debris" });

    expect(h.posts.find((m) => m.type === "worktreeAuthorizeDebris")).toMatchObject({
      repoId: REPO_A,
      path: "/trees/debris",
      token: 1,
    });
  });

  it("[1_7] drops an authorization answering a PREVIOUS opening", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    const answers: unknown[] = [];
    (
      h.controller as unknown as {
        view: { deps: { createDialogDeps(): { bindDebrisAuthorization(fn: (a: unknown) => void): void } } };
      }
    ).view.deps
      .createDialogDeps()
      .bindDebrisAuthorization((a) => answers.push(a));

    // Token 1 is this opening; the second opening moves it to 2, and an answer
    // for 1 authorizes nothing in the form now on screen.
    h.controller.openCreate();
    h.controller.handleDebrisAuthorized({
      type: "worktreeDebrisAuthorized",
      repoId: REPO_A,
      ask: 1,
      token: 1,
      path: "/trees/debris",
      granted: true,
      authorization: { path: "/trees/debris", fingerprint: "fp-stale" },
      entries: ["node_modules"],
    });
    expect(answers, "a superseded authorization reached the form").toEqual([]);

    h.controller.handleDebrisAuthorized({
      type: "worktreeDebrisAuthorized",
      repoId: REPO_A,
      ask: 1,
      token: 2,
      path: "/trees/debris",
      granted: true,
      authorization: { path: "/trees/debris", fingerprint: "fp-live" },
      entries: ["node_modules"],
    });
    expect(answers).toHaveLength(1);
  });

  it("[1_7] submits the disposition the form settled on, and free where it settled on none", () => {
    const h = mount();
    const view = (h.controller as unknown as { view: { deps: { onCreateSubmit(d: unknown): void } } }).view;
    const draft = {
      repoId: "/repo/.git",
      branchMode: "new" as const,
      branchName: "feat",
      baseRef: "",
      path: "/trees/debris",
      openAfter: "none" as const,
    };

    view.deps.onCreateSubmit({
      ...draft,
      disposition: { kind: "debris", authorization: { path: "/trees/debris", fingerprint: "fp-1" } },
    });
    expect(h.posts.find((m) => m.type === "worktreeCreate")).toMatchObject({
      path: "/trees/debris",
      disposition: { kind: "debris", authorization: { path: "/trees/debris", fingerprint: "fp-1" } },
    });

    view.deps.onCreateSubmit(draft);
    expect(h.posts.filter((m) => m.type === "worktreeCreate")[1]).toMatchObject({ disposition: { kind: "free" } });
  });

  it("[4_3] honours nothing that names the opening it just retired", () => {
    // The host posts and the panel receives asynchronously, so a reply already
    // in flight when the close was posted still carries the retired number.
    // Three channels, one retirement: the two this change added and the refs
    // enumeration that predates it.
    const h = mount();
    const view = (
      h.controller as unknown as {
        view: { deps: { createOpening(): number; onCreateClosed(opening: number): void } };
      }
    ).view;
    h.controller.openCreate();
    const opening = view.deps.createOpening();

    view.deps.onCreateClosed(opening);

    h.controller.handleCreateDefaults({ ...answer(REPO_A, "/trees/a"), opening });
    h.controller.handleProvisionOffer({
      type: "worktreeProvisionOffer",
      repoId: REPO_A,
      opening,
      offerId: "provision-1",
      model: provisionModel(),
    });
    h.controller.handleRefs({
      type: "worktreeRefs",
      repoId: REPO_A,
      token: opening,
      refs: [{ name: "main" }],
      truncated: false,
    });

    const defaults = (h.controller as unknown as { createDefaults: Map<string, unknown> }).createDefaults;
    const offers = (h.controller as unknown as { provisionOffers: Map<string, unknown> }).provisionOffers;
    expect(defaults.get(REPO_A), "a retired opening's destination was cached").toBeUndefined();
    expect(offers.get(REPO_A), "a retired opening's offer was cached").toBeUndefined();
    expect(refsHeld(h).get(REPO_A), "a retired opening's branch list was cached").toBeUndefined();
  });

  it("[1_2][r1 W2] a list that outlived a dialog that really opened and closed changes nothing", () => {
    // The round-1 version asserted this with no dialog ever opened, so
    // `applyRefs` was null for a reason the test did not name — it could not
    // have failed. This one opens a real form, closes it, and only then
    // delivers. The controller cannot unregister the applier (it learns a form
    // closed only through the view), so the FORM is what goes inert.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));
    expect(open(), "the form never opened, so closing it proves nothing").toBe(true);
    const bound = (h.controller as unknown as { applyRefs?: unknown }).applyRefs;
    expect(bound, "no applier was bound, so a drop is not what this measures").toBeDefined();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(open()).toBe(false);

    // Reaches the applier the closed form left behind, and must do nothing —
    // no throw, and no list rendered anywhere.
    h.controller.handleRefs({
      type: "worktreeRefs",
      repoId: REPO_A,
      token: 1,
      refs: [{ name: "main" }],
      truncated: false,
    });

    expect(document.querySelector("#wt-branch-list")).toBeNull();
    // NOT stored. This asserted the opposite until D5 was corrected: closing the
    // form retires its opening across every channel the token carries, and refs
    // is one of them, so an enumeration arriving after the close is a reply for
    // a conversation that ended (.reviews/round-1.md B6).
    expect(refsHeld(h).get(REPO_A)).toBeUndefined();
  });

  it("[1_2] opening a form drops the previous form's list", () => {
    // Same rule as r2 B6 for the offer: a list seeded from the last form
    // describes a repository state that may have moved, and would keep showing
    // if this form's own enumeration failed.
    //
    // The first open is what mints the token this answer carries. Delivering
    // one to a controller that never opened is dropped on the token, and the
    // map is then empty for a reason the assertion did not name — which is how
    // this stopped being able to fail (round-3 W4).
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleRefs({
      type: "worktreeRefs",
      repoId: REPO_A,
      token: 1,
      refs: [{ name: "main" }],
      truncated: false,
    });
    expect(refsHeld(h).get(REPO_A), "nothing was stored, so clearing it proves nothing").toBeDefined();

    h.controller.openCreate();

    expect(refsHeld(h).size).toBe(0);
  });

  it("[1_2] forgets the list for a repository that has left the workspace", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleRefs({
      type: "worktreeRefs",
      repoId: REPO_B,
      token: 1,
      refs: [{ name: "main" }],
      truncated: false,
    });
    expect(refsHeld(h).has(REPO_B), "repo B's list was never stored, so pruning it proves nothing").toBe(true);

    h.controller.handleTreeResponse({
      type: "worktreeTreeResponse",
      tree: singleRepoTree(),
      presence: singleRepoPresence(1_000_000),
    });

    expect(refsHeld(h).has(REPO_B)).toBe(false);
  });

  it("[1_4] forgets an offer for a repository that has left the workspace", () => {
    // The offer names a model the host holds for a repo it no longer answers
    // for. Kept, it would render a section for a repository that is gone.
    const h = ready(twoRepoResponse());
    h.controller.handleProvisionOffer({
      type: "worktreeProvisionOffer",
      repoId: REPO_B,
      opening: 1,
      offerId: "provision-1",
      model: provisionModel(),
    });
    h.controller.handleTreeResponse({
      type: "worktreeTreeResponse",
      tree: singleRepoTree(),
      presence: singleRepoPresence(1_000_000),
    });
    const held = (h.controller as unknown as { provisionOffers: Map<string, unknown> }).provisionOffers;

    expect(held.has(REPO_B)).toBe(false);
  });

  it("[B1] an answer that names the branch it is for still reaches the open form", () => {
    const h = ready(twoRepoResponse());
    const applied: unknown[] = [];
    (h.controller as unknown as { applyCreateDefaults?: (s: unknown) => void }).applyCreateDefaults = (seed) =>
      applied.push(seed);
    // Answering the controller's own live opening: this fixture opens no
    // door, so it is still the initial one (1_2's guard drops any other).
    h.controller.handleCreateDefaults({ ...answer(REPO_A, "/trees/a"), opening: 0, branch: "feat/x" });

    expect(applied).toHaveLength(1);
  });

  it("[W1] a repository that leaves mid-flight does not jam the create for the rest", () => {
    // The host answers only while the repo is in its cache and has no error
    // reply, so an unreconciled outstanding set waits forever with no notice.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleTreeResponse({
      type: "worktreeTreeResponse",
      tree: singleRepoTree(),
      presence: singleRepoPresence(1_000_000),
    });

    expect(document.querySelector("#wt-branch")).not.toBeNull();
  });

  it("[W2] a scoped door offers every repository, and differs only in which is selected", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreateForRepo(REPO_B);
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));

    expect(asks(h)).toEqual([REPO_A, REPO_B]);
    expect(offered()).toEqual([REPO_A, REPO_B]);
    expect(document.querySelector<HTMLSelectElement>("#wt-repo-select")?.value).toBe(REPO_B);
  });

  it("[W10] a create whose repositories changed under it says so, rather than evaporating", () => {
    // Round-1 S2 stopped the frozen offer for a form that never opened; the
    // other half — telling the user — did not land. W1's fix made `reconcile` a
    // completion path, so a folder swap mid-ask now reaches it: the defaults are
    // pruned, both outstanding ids are dropped, and nothing was ever asked of
    // the repository that arrived.
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.handleTreeResponse({
      type: "worktreeTreeResponse",
      tree: {
        gitAvailable: true,
        unreadable: { count: 0, reasons: [] },
        repos: [{ repoId: "/c/.git", label: "c", mainPath: "/c", worktrees: [] }],
      },
      presence: singleRepoPresence(1_000_000),
    });

    expect(document.querySelector("#wt-branch")).toBeNull();
    const results = (h.controller as unknown as { actionResults: { action: string; outcome: string }[] }).actionResults;
    expect(results).toEqual([expect.objectContaining({ action: "create", outcome: "unavailable" })]);
  });

  it("[W6] a create resolved after the panel left the worktree body opens nothing", () => {
    const h = ready(twoRepoResponse());
    h.controller.openCreate();
    h.controller.setVisible(false);
    h.controller.handleCreateDefaults(answer(REPO_A, "/trees/a"));
    h.controller.handleCreateDefaults(answer(REPO_B, "/trees/b"));

    expect(document.querySelector("#wt-branch")).toBeNull();
  });

  it("[1_2] the view is given a way to open a create for one repository", () => {
    // The header control is built only where this dep exists, so an unsupplied
    // one is the same silent absence the toolbar had.
    const h = ready(twoRepoResponse());
    const deps = (h.controller as unknown as { view: { deps: { onCreateForRepo?: (r: string) => void } } }).view.deps;
    deps.onCreateForRepo?.(REPO_B);

    expect(asks(h)).toEqual([REPO_A, REPO_B]);
  });

  it("[1_1] a repo-scoped create asks every repository too, and selects its own", () => {
    // Round-1 W2: asking only its own left a cold scoped door offering ONE
    // repository where the toolbar offered three, and the doors are required to
    // differ only in which repository the form opens on.
    const h = ready(twoRepoResponse());
    h.controller.openCreateForRepo(REPO_B);

    expect(asks(h)).toEqual([REPO_A, REPO_B]);
  });

  it("[1_1] reports whether there is any repository to create in", () => {
    // Absent, not inert: an action the view cannot perform is absent from the
    // toolbar, and only the controller knows whether a repo exists.
    const seen: boolean[] = [];
    const posts: WebViewToExtensionMessage[] = [];
    const state: Record<string, unknown> = {};
    const controller = WorktreeController.mount({
      host: document.body,
      postMessage: (msg) => posts.push(msg),
      store: { getState: () => state as never, updateState: (patch) => Object.assign(state, patch) },
      init: { workspaceRoot: "/repo", rowActivation: "focus" },
      onCreateAvailability: (available) => seen.push(available),
      now: () => 1_000_000,
    });
    controller.setVisible(true);
    controller.handleTreeResponse({
      type: "worktreeTreeResponse",
      tree: noRepoTree(),
      presence: singleRepoPresence(1_000_000),
    });
    controller.handleTreeResponse(twoRepoResponse());

    expect(seen).toEqual([false, true]);
  });
});

/**
 * The opening the controller is currently on, read where production reads it —
 * off the request the controller itself posted.
 *
 * A literal here would be a guess about how many doors a fixture opened, and
 * 1_2's guard drops a reply that guesses wrong. Reading it back is what keeps
 * these tests about what they are about.
 */
function liveOpening(posts: readonly { type: string }[]): number {
  for (let at = posts.length - 1; at >= 0; at -= 1) {
    const post = posts[at];
    if (post?.type === "requestWorktreeCreateDefaults") {
      return (post as unknown as { opening: number }).opening;
    }
  }
  return 0;
}

describe("the destination a create opens on", () => {
  /** The repo the fixture tree carries, and the host's answer for it. */
  const REPO = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";
  const MAIN = "/Users/dev/Projects/ai-oss/anywhere-terminal";
  function defaults(over: Partial<WorktreeCreateDefaultsMessage> = {}): WorktreeCreateDefaultsMessage {
    return {
      type: "worktreeCreateDefaults",
      repoId: REPO,
      // The opening these tests are answering. They exercise the seed without
      // going through a door, so the controller is still on its initial
      // opening — a reply naming any other one is now dropped, which is the
      // whole point of 1_2 and is asserted on its own below.
      opening: 0,
      root: "/trees",
      prefix: "anywhere-terminal",
      path: "/trees/anywhere-terminal",
      ...over,
    };
  }
  function ready() {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    h.posts.length = 0;
    return h;
  }
  function seed(h: Harness) {
    return (
      h.controller as unknown as { view: { deps: { createDialogDeps(): { repos: WorktreeCreateDefaults[] } } } }
    ).view.deps.createDialogDeps();
  }

  it("asks the host where the create would go rather than deriving a path", () => {
    const h = ready();
    const first = firstWorktree();
    menuActions(h).createWorktree?.(first);

    // Still exhaustive: the destination ask, and the branch list that opened
    // beside it. Nothing else — no path derived here, no third question.
    // Both name the SAME opening — the destination ask and the branch list are
    // one conversation, and a form that asked under two identities could have a
    // reply from each honoured against the other.
    expect(h.posts).toEqual([
      { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 },
      { type: "requestWorktreeRefs", repoId: REPO, token: 1 },
    ]);
  });

  it("seeds the form with nothing until the host has answered", () => {
    // An empty seed makes `openCreateDialog` a no-op, which is the point: a
    // form open on a guessed destination is worse than one that has not opened.
    expect(seed(ready()).repos).toEqual([]);
  });

  it("seeds the form from the host's answer, not from the tree", () => {
    const h = ready();
    h.controller.handleCreateDefaults(defaults());

    expect(seed(h).repos).toEqual([
      {
        repoId: REPO,
        repoLabel: "anywhere-terminal",
        mainPath: MAIN,
        pathParent: "/trees",
        pathPrefix: "anywhere-terminal",
        // The host's path, always — this is the destination the create takes.
        resolvedPath: "/trees/anywhere-terminal",
        agents: [],
      },
    ]);
  });

  it("names the taken candidate AND the free path only when the host collided", () => {
    const h = ready();
    h.controller.handleCreateDefaults(
      defaults({ path: "/trees/anywhere-terminal-2", collidedWith: "/trees/anywhere-terminal" }),
    );

    expect(seed(h).repos[0]).toMatchObject({
      collidedWith: "/trees/anywhere-terminal",
      resolvedPath: "/trees/anywhere-terminal-2",
    });
  });

  it("opens the form when the answer for the repo the user asked about arrives", () => {
    const h = ready();
    menuActions(h).createWorktree?.(firstWorktree());
    h.controller.handleCreateDefaults(defaults({ opening: liveOpening(h.posts) }));

    expect(document.querySelector(".wt-create-dialog, dialog, .wt-dialog")).not.toBeNull();
  });

  it("[1_2] drops a destination answer naming an opening that is no longer live", () => {
    // Both openings ask branch-less first, so a predecessor's answer is shaped
    // exactly like the live one's — the branch-versus-branch-less rule below
    // cannot tell them apart, and before this guard the predecessor seeded the
    // form (design.md D2).
    const h = ready();
    menuActions(h).createWorktree?.(firstWorktree());
    const live = liveOpening(h.posts);

    h.controller.handleCreateDefaults(defaults({ opening: live - 1 }));

    expect(seed(h).repos, "a superseded opening's answer seeded the form").toEqual([]);
  });

  it("[1_2] still seeds from the live opening's own answer", () => {
    // The pair. A guard that dropped everything would pass the test above and
    // leave the form permanently empty, which is the failure mode the proposal
    // names as this change's risk.
    const h = ready();
    menuActions(h).createWorktree?.(firstWorktree());

    h.controller.handleCreateDefaults(defaults({ opening: liveOpening(h.posts) }));

    expect(seed(h).repos).toHaveLength(1);
  });

  it("[1_2] drops a provisioning offer naming an opening that is no longer live", () => {
    // This site had no staleness rule at all: it cached whatever arrived, so a
    // predecessor's read landing after a reopening published its model into a
    // form that never asked for it.
    const h = ready();
    menuActions(h).createWorktree?.(firstWorktree());
    const live = liveOpening(h.posts);
    const held = (h.controller as unknown as { provisionOffers: Map<string, unknown> }).provisionOffers;

    h.controller.handleProvisionOffer({
      type: "worktreeProvisionOffer",
      repoId: REPO,
      opening: live - 1,
      offerId: "offer-stale",
      model: provisionModel(),
    });

    expect(held.size, "a superseded opening's offer was cached").toBe(0);
  });

  it("[1_2] still holds the live opening's own offer", () => {
    const h = ready();
    menuActions(h).createWorktree?.(firstWorktree());
    const held = (h.controller as unknown as { provisionOffers: Map<string, unknown> }).provisionOffers;

    h.controller.handleProvisionOffer({
      type: "worktreeProvisionOffer",
      repoId: REPO,
      opening: liveOpening(h.posts),
      offerId: "offer-live",
      model: provisionModel(),
    });

    expect(held.size).toBe(1);
  });

  it("does not open the form for an answer nobody asked for", () => {
    // Defaults also arrive unsolicited when another surface asked; storing them
    // is right, opening a dialog over this user's panel is not.
    const h = ready();
    h.controller.handleCreateDefaults(defaults());

    expect(document.querySelector(".wt-create-dialog, dialog, .wt-dialog")).toBeNull();
  });
});

describe("what a mutation did comes back to the panel", () => {
  const REPO = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";
  function ready() {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    h.posts.length = 0;
    return h;
  }
  function results(h: Harness): WorktreeActionResult[] {
    return (h.controller as unknown as { actionResults: WorktreeActionResult[] }).actionResults;
  }

  it("attaches a worktree-scoped result to its row and keeps the repo for prune", () => {
    const h = ready();
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "lock",
      repoId: REPO,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
      result: { kind: "ok" },
    });

    expect(results(h)).toEqual([
      {
        action: "lock",
        repoId: REPO,
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        outcome: "ok",
      },
    ]);
  });

  it("attaches a repo-scoped result to the repo alone", () => {
    const h = ready();
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "prune",
      repoId: REPO,
      result: { kind: "error", message: "fatal: nope" },
    });

    expect(results(h)).toEqual([{ action: "prune", repoId: REPO, outcome: "error", error: "fatal: nope" }]);
  });

  it("carries the unreadable sources through, so the notice can name them", () => {
    const h = ready();
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "remove",
      repoId: REPO,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
      result: { kind: "unavailable", unreadable: ["status", "sessions"] },
    });

    expect(results(h)[0]).toMatchObject({ outcome: "unavailable", unreadable: ["status", "sessions"] });
  });

  it("turns a blocked removal into the confirmation the host's own set authorizes", () => {
    // Not a failure: the host declined and handed back what it assessed, so the
    // notice reopens the confirmation bound to that exact fingerprint.
    const h = ready();
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "remove",
      repoId: REPO,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
      result: {
        kind: "blocked",
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        fingerprint: "fp-1",
        assessment: {
          checks: [
            { id: "isMain", cls: "refusal", outcome: "passed" },
            { id: "busyAgents", cls: "refusal", outcome: "passed", count: 0 },
            { id: "containsWorktrees", cls: "refusal", outcome: "passed", count: 0 },
            { id: "dirty", cls: "confirmable", outcome: "failed", count: 1 },
            { id: "untracked", cls: "confirmable", outcome: "failed", count: 2 },
            { id: "idlePanes", cls: "confirmable", outcome: "failed", count: 1 },
            { id: "externalAgents", cls: "confirmable", outcome: "passed", count: 0 },
            { id: "locked", cls: "confirmable", outcome: "passed" },
          ],
          contained: [],
        },
      },
    });

    const confirmed = results(h)[0]?.needsConfirm;
    expect(confirmed?.fingerprint).toBe("fp-1");
    expect(confirmed?.checks).toEqual(
      expect.arrayContaining([
        { id: "dirty", cls: "confirmable", outcome: "failed", count: 1 },
        { id: "untracked", cls: "confirmable", outcome: "failed", count: 2 },
      ]),
    );
  });

  it("gives a refusal NO fingerprint, because nothing can authorize it", () => {
    const h = ready();
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "remove",
      repoId: REPO,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
      result: {
        kind: "blocked",
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        fingerprint: null,
        assessment: {
          checks: [
            { id: "isMain", cls: "refusal", outcome: "passed" },
            { id: "busyAgents", cls: "refusal", outcome: "failed", count: 1 },
            { id: "containsWorktrees", cls: "refusal", outcome: "passed", count: 0 },
          ],
          contained: [],
        },
      },
    });

    const refused = results(h)[0]?.needsConfirm;
    // `null`, not `""`: presence is the force authority (design.md D7), and an
    // empty string is present. Nothing can forward it — a refusal mounts no
    // confirm button — but a value that only fails to authorize by accident is
    // one edit away from authorizing.
    expect(refused?.fingerprint).toBeNull();
    expect(refused?.checks).toEqual(
      expect.arrayContaining([{ id: "busyAgents", cls: "refusal", outcome: "failed", count: 1 }]),
    );
  });

  it("replaces the previous result for the same verb and scope rather than stacking", () => {
    // The older notice no longer describes the tree, and two answers to one
    // question read as two separate events.
    const h = ready();
    const base = {
      type: "worktreeMutationResult",
      verb: "lock",
      repoId: REPO,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
    } as const;
    h.controller.handleMutationResult({ ...base, result: { kind: "error", message: "first" } });
    h.controller.handleMutationResult({ ...base, result: { kind: "ok" } });

    expect(results(h)).toEqual([
      {
        action: "lock",
        repoId: REPO,
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        outcome: "ok",
      },
    ]);
  });

  it("lets a later removal outcome replace the blocked one it answers", () => {
    // Round-3 W8: a blocked result that dropped `repoId` did not match the
    // replacement key of the forced removal that followed it, so the panel
    // showed the confirmation notice and its outcome at the same time.
    const h = ready();
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "remove",
      repoId: REPO,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
      result: {
        kind: "blocked",
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        fingerprint: "fp-1",
        assessment: {
          checks: [
            { id: "isMain", cls: "refusal", outcome: "passed" },
            { id: "busyAgents", cls: "refusal", outcome: "passed", count: 0 },
            { id: "containsWorktrees", cls: "refusal", outcome: "passed", count: 0 },
            { id: "dirty", cls: "confirmable", outcome: "failed", count: 1 },
            { id: "untracked", cls: "confirmable", outcome: "passed", count: 0 },
            { id: "idlePanes", cls: "confirmable", outcome: "passed", count: 0 },
            { id: "externalAgents", cls: "confirmable", outcome: "passed", count: 0 },
            { id: "locked", cls: "confirmable", outcome: "passed" },
          ],
          contained: [],
        },
      },
    });
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "remove",
      repoId: REPO,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
      result: { kind: "ok" },
    });

    expect(results(h)).toEqual([
      {
        action: "remove",
        repoId: REPO,
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        outcome: "ok",
      },
    ]);
  });

  it("keeps results for different worktrees side by side", () => {
    const h = ready();
    const base = { type: "worktreeMutationResult", verb: "lock", repoId: REPO } as const;
    h.controller.handleMutationResult({
      ...base,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel",
      result: { kind: "ok" },
    });
    h.controller.handleMutationResult({
      ...base,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/release",
      result: { kind: "ok" },
    });

    expect(results(h).map((r) => r.worktreeId)).toEqual([
      "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel",
      "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/release",
    ]);
  });

  it("retries only the removal an unreadable assessment names, by ASKING again", () => {
    // What could not be read may still be a blocker, so a retry re-asks the same
    // question rather than answering it. Posting a removal here would be a second
    // door onto the deletion D6 closed, reached from the one outcome where
    // nothing about this worktree's risk is known.
    const h = ready();
    const view = (h.controller as unknown as { view: { deps: { onRetryAction(r: WorktreeActionResult): void } } }).view;
    view.deps.onRetryAction({
      action: "remove",
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
      outcome: "unavailable",
      unreadable: ["status"],
    });

    expect(h.posts).toEqual([
      {
        type: "worktreeRemoveAssess",
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        token: expect.any(String),
      },
    ]);
  });

  it("drops a dismissed notice and leaves the rest", () => {
    const h = ready();
    const base = { type: "worktreeMutationResult", verb: "lock", repoId: REPO } as const;
    h.controller.handleMutationResult({
      ...base,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel",
      result: { kind: "ok" },
    });
    h.controller.handleMutationResult({
      ...base,
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/release",
      result: { kind: "ok" },
    });
    const view = (
      h.controller as unknown as { view: { deps: { onDismissActionResult(r: WorktreeActionResult): void } } }
    ).view;
    const first = results(h)[0] as WorktreeActionResult;
    view.deps.onDismissActionResult(first);

    expect(results(h).map((r) => r.worktreeId)).toEqual(["/Users/dev/Projects/ai-oss/anywhere-terminal-wt/release"]);
  });

  it("confirms the prune the indeterminate notice offers, on the count the tree's flags produce", () => {
    // D14: git's `prunable` rides on every worktree the panel renders, so the
    // count needs no protocol of its own. D13: it is still confirmed first.
    const h = ready();
    const view = (h.controller as unknown as { view: { deps: { onPrune(repoId: string): void } } }).view;
    view.deps.onPrune(REPO);
    expect(h.posts).toEqual([]);

    clickPruneConfirm();
    expect(h.posts).toEqual([{ type: "worktreePrune", repoId: REPO, confirmedCount: 1 }]);
  });

  it("opens the menu's prune on the count the tree's own flags produce", () => {
    // The controller's own `repoFor`, not an injected one: D14 says the count
    // is `prunable` on the rendered tree, and the fixture carries exactly one.
    const h = ready();
    menuActions(h).pruneRepo?.(firstWorktree());
    expect(h.posts).toEqual([]);

    clickPruneConfirm();
    expect(h.posts).toEqual([{ type: "worktreePrune", repoId: REPO, confirmedCount: 1 }]);
  });

  it("posts nothing when the prune confirmation is cancelled", () => {
    const h = ready();
    menuActions(h).pruneRepo?.(firstWorktree());
    pruneButton(/^Cancel$/)?.click();

    expect(h.posts).toEqual([]);
  });

  it("forces a removal with the fingerprint the user was actually shown", () => {
    const h = ready();
    const view = (h.controller as unknown as { view: { deps: { onForceRemove(i: { id: string }, fp: string): void } } })
      .view;
    view.deps.onForceRemove({ id: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator" }, "fp-9");

    expect(h.posts).toEqual([
      {
        type: "worktreeRemove",
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        force: true,
        fingerprint: "fp-9",
      },
    ]);
  });

  // The other half of the same rule: a report that carried NO fingerprint carried
  // no force authority, so answering it sends the ordinary removal — which the
  // host re-evaluates, and blocks if the worktree stopped being clean while the
  // user was reading it (design.md D7).
  it("answers a report that authorized no force with an ordinary removal", () => {
    const h = ready();
    const view = (
      h.controller as unknown as { view: { deps: { onForceRemove(i: { id: string }, fp: string | null): void } } }
    ).view;
    view.deps.onForceRemove({ id: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator" }, null);

    expect(h.posts).toEqual([
      {
        type: "worktreeRemove",
        worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
        force: false,
      },
    ]);
    // Not `fingerprint: undefined`: the key is ABSENT. A present-but-undefined key
    // survives a structured clone as a present key, and the host reads presence.
    expect(Object.hasOwn(h.posts[0] as object, "fingerprint")).toBe(false);
  });
});

describe("the destination follows the branch the user typed", () => {
  const REPO = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";
  /** The branch an answer was computed for, forwarded so a form can tell stale from current. */
  it("forwards the branch an answer was computed for", () => {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    h.controller.handleCreateDefaults({
      type: "worktreeCreateDefaults",
      repoId: REPO,
      // No door was opened here, so the controller is still on its initial
      // opening (1_2's guard drops any other).
      opening: 0,
      root: "/trees",
      prefix: "anywhere-terminal",
      path: "/trees/anywhere-terminal-feat-a",
      branch: "feat/a",
    });
    const seeded = (
      h.controller as unknown as {
        view: { deps: { createDialogDeps(): { repos: { repoId: string; answersBranch?: string }[] } } };
      }
    ).view.deps
      .createDialogDeps()
      .repos.find((r) => r.repoId === REPO);
    expect(seeded?.answersBranch).toBe("feat/a");
  });

  function ready() {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    h.posts.length = 0;
    return h;
  }
  function dialogDeps(h: Harness) {
    return (
      h.controller as unknown as {
        view: {
          deps: {
            createDialogDeps(): {
              repos: WorktreeCreateDefaults[];
              onSelectionChange(selection: {
                repoId: string;
                branch: string;
                base?: unknown;
                candidatePath?: string;
              }): void;
              bindDefaults(apply: (next: WorktreeCreateDefaults) => void): void;
            };
          };
        };
      }
    ).view.deps.createDialogDeps();
  }

  it("asks the host again, naming the branch, when the branch changes", () => {
    // Round-3 B12: the host proved `<root>/<label>` free while the form
    // submitted `<parent>/<prefix>-<branch>` — a different path nobody checked.
    const h = ready();
    dialogDeps(h).onSelectionChange({ repoId: REPO, branch: "feat/login" });

    // Two questions about one settled edit: where the create would GO, and
    // what it would DO. Still exhaustive — nothing else is asked.
    expect(h.posts).toEqual([
      { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 0, branch: "feat/login" },
      { type: "worktreeCreateProbe", repoId: REPO, token: 0, seq: 1, query: "feat/login" },
    ]);
  });

  it("forwards the base and the destination override, not just the branch", () => {
    // The sole production sender posted `{repoId, token, seq, query}` and
    // dropped both, so `baseValid` could only ever exist in a test that
    // injected it and an override was never resolved at all (round-3 B4).
    const h = ready();
    dialogDeps(h).onSelectionChange({
      repoId: REPO,
      branch: "feat/login",
      base: { kind: "ref", ref: "origin/main" },
      candidatePath: "/trees/mine",
    });

    expect(h.posts).toContainEqual({
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 0,
      seq: 1,
      query: "feat/login",
      base: { kind: "ref", ref: "origin/main" },
      candidatePath: "/trees/mine",
    });
  });

  it("mints a new sequence for a base edit under an unchanged branch", () => {
    // `seq` is what orders two answers, and a base edit that reused one would
    // let the earlier answer overwrite the later one (round-3 B4).
    const h = ready();
    dialogDeps(h).onSelectionChange({ repoId: REPO, branch: "feat/login" });
    dialogDeps(h).onSelectionChange({ repoId: REPO, branch: "feat/login", base: { kind: "ref", ref: "v1" } });

    const probes = h.posts.filter((m) => m.type === "worktreeCreateProbe");
    expect(probes.map((p) => (p as { seq: number }).seq)).toEqual([1, 2]);
  });

  it("[2_1] rides the OPENING's token, so a probe cannot be matched to the wrong form", () => {
    // `repoId` names a repository and `query` separates edits within one
    // opening. Neither separates two openings of the same dialog on the same
    // repository, which is what the token is for (design.md D1).
    const h = ready();
    h.controller.openCreate();
    h.controller.openCreate();
    h.posts.length = 0;
    dialogDeps(h).onSelectionChange({ repoId: REPO, branch: "feat/login" });

    expect(h.posts).toContainEqual({
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 2,
      seq: 1,
      query: "feat/login",
    });
  });

  it("pushes an unsolicited answer into the form the user already has open", () => {
    const h = ready();
    const applied: WorktreeCreateDefaults[] = [];
    dialogDeps(h).bindDefaults((next) => applied.push(next));

    h.controller.handleCreateDefaults({
      type: "worktreeCreateDefaults",
      repoId: REPO,
      // No door was opened here, so the controller is still on its initial
      // opening (1_2's guard drops any other).
      opening: 0,
      root: "/trees",
      prefix: "anywhere-terminal",
      path: "/trees/anywhere-terminal-feat-login",
      // The branch this answer is FOR. An open form always asks with one, so an
      // answer without one belongs to an OPENING ask and must not reach it
      // (round-1 B1).
      branch: "feat/login",
    });

    expect(applied.map((d) => d.resolvedPath)).toEqual(["/trees/anywhere-terminal-feat-login"]);
  });

  it("marks the collided candidate without ever presenting it as the destination", () => {
    const h = ready();
    h.controller.handleCreateDefaults({
      type: "worktreeCreateDefaults",
      repoId: REPO,
      // No door was opened here, so the controller is still on its initial
      // opening (1_2's guard drops any other).
      opening: 0,
      root: "/trees",
      prefix: "anywhere-terminal",
      path: "/trees/anywhere-terminal-2",
      collidedWith: "/trees/anywhere-terminal",
    });
    const seeded = dialogDeps(h).repos[0];

    expect(seeded).toMatchObject({
      resolvedPath: "/trees/anywhere-terminal-2",
      collidedWith: "/trees/anywhere-terminal",
    });
  });
});

describe("a notice outlives the row it was about", () => {
  /** The fixture tree minus one worktree — what a successful removal leaves. */
  function without(worktreeId: string): WorktreeTreeResponseMessage {
    const tree = singleRepoTree();
    const repo = tree.repos[0];
    if (!repo) {
      throw new Error("fixture lost its repo");
    }
    repo.worktrees = repo.worktrees.filter((w) => w.id !== worktreeId);
    return { type: "worktreeTreeResponse", tree, presence: singleRepoPresence(1_000_000) };
  }

  const GONE = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel";

  function removedNotice(h: Harness): void {
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "remove",
      repoId: "/Users/dev/Projects/ai-oss/anywhere-terminal/.git",
      worktreeId: GONE,
      result: { kind: "ok" },
    });
  }

  it("reports a removal in the order production produces — tree first, result second", () => {
    // The coordinator awaits `settle()` in a `finally`, so the rebuilt tree
    // reaches the surface BEFORE the promise resolves and `report()` runs. A
    // test that pushes the result first is testing an order production never
    // produces, which is how round 3's fix passed and still shipped broken.
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    h.controller.handleTreeResponse(without(GONE));
    removedNotice(h);
    expect(document.body.textContent).toContain("Remove done.");
    expect(document.body.textContent).toContain("worktree-panel");
  });

  it("does not orphan a result that arrives before the first tree does", () => {
    // No tree is not an empty tree — the same distinction B13 turned on. Every
    // notice would otherwise be re-scoped before the first rebuild lands.
    const h = mount();
    h.controller.setVisible(true);
    removedNotice(h);
    const results = (h.controller as unknown as { actionResults: WorktreeActionResult[] }).actionResults;
    expect(results[0]?.worktreeId).toBe(GONE);
    expect(results[0]?.orphanedLabel).toBeUndefined();
  });

  it("bounds orphan notices, which answer to no row that could retire them", () => {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    const repo = singleRepoTree().repos[0];
    if (!repo) {
      throw new Error("fixture lost its repo");
    }
    // One removal per row, all of them orphaned by the next rebuild.
    for (const w of repo.worktrees) {
      h.controller.handleMutationResult({
        type: "worktreeMutationResult",
        verb: "remove",
        repoId: "/Users/dev/Projects/ai-oss/anywhere-terminal/.git",
        worktreeId: w.id,
        result: { kind: "ok" },
      });
    }
    for (let i = 0; i < 4; i++) {
      h.controller.handleTreeResponse({
        type: "worktreeTreeResponse",
        tree: { ...singleRepoTree(), repos: [{ ...repo, worktrees: [] }] },
        presence: singleRepoPresence(1_000_000),
      });
    }
    const results = (h.controller as unknown as { actionResults: WorktreeActionResult[] }).actionResults;
    // Six rows removed; the bound is what stops this growing with history.
    expect(results.length).toBeLessThan(repo.worktrees.length);
    expect(results.every((r) => r.orphanedLabel !== undefined)).toBe(true);
  });

  it("names the departed row by the path git showed, not the resolved id", () => {
    // `id` is symlink-resolved and `displayPath` is git's own string, so a
    // notice falling back to the id would name a path the user never saw.
    const h = mount();
    h.controller.setVisible(true);
    const seeded = singleRepoTree();
    const repo = seeded.repos[0];
    if (!repo) {
      throw new Error("fixture lost its repo");
    }
    repo.worktrees = [
      ...repo.worktrees,
      worktree({ id: "/private/var/wt/linked", displayPath: "/var/wt/linked", branch: "feat/sym" }),
    ];
    h.controller.handleTreeResponse({
      type: "worktreeTreeResponse",
      tree: seeded,
      presence: singleRepoPresence(1_000_000),
    });
    h.controller.handleTreeResponse(response());
    h.controller.handleMutationResult({
      type: "worktreeMutationResult",
      verb: "remove",
      repoId: "/Users/dev/Projects/ai-oss/anywhere-terminal/.git",
      worktreeId: "/private/var/wt/linked",
      result: { kind: "ok" },
    });
    const results = (h.controller as unknown as { actionResults: WorktreeActionResult[] }).actionResults;
    expect(results[0]?.orphanedLabel).toBe("/var/wt/linked");
  });

  it("still reports a removal after the row it removed has gone", () => {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    removedNotice(h);
    // While the row is still there the notice hangs on it, unlabelled.
    expect(document.body.textContent).toContain("Remove done.");

    h.controller.handleTreeResponse(without(GONE));
    expect(document.body.textContent).toContain("Remove done.");
    // Re-scoped to the repo, it names what it was about.
    expect(document.body.textContent).toContain("worktree-panel");
  });

  it("does not hand a recreated row someone else's result", () => {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    removedNotice(h);
    h.controller.handleTreeResponse(without(GONE));
    // Recreated at the same id. The old notice must not climb back onto it.
    h.controller.handleTreeResponse(response());
    const results = (h.controller as unknown as { actionResults: WorktreeActionResult[] }).actionResults;
    expect(results).toEqual([expect.objectContaining({ action: "remove", orphanedLabel: expect.any(String) })]);
    expect(results[0]?.worktreeId).toBeUndefined();
  });

  it("drops a result whose repository left the workspace", () => {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    removedNotice(h);
    h.controller.handleTreeResponse({
      type: "worktreeTreeResponse",
      tree: { gitAvailable: true, unreadable: { count: 0, reasons: [] }, repos: [] },
      presence: singleRepoPresence(1_000_000),
    });
    expect((h.controller as unknown as { actionResults: WorktreeActionResult[] }).actionResults).toEqual([]);
    expect(document.body.textContent).not.toContain("Remove done.");
  });

  it("forgets a create default for a repository that is no longer there", () => {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    const defaults: WorktreeCreateDefaultsMessage = {
      type: "worktreeCreateDefaults",
      repoId: "/Users/dev/Projects/ai-oss/anywhere-terminal/.git",
      // No door was opened here, so the controller is still on its initial
      // opening (1_2's guard drops any other). The `held.size` assertion below
      // is what proves this setup actually landed.
      opening: 0,
      root: "/trees",
      prefix: "anywhere-terminal",
      path: "/trees/anywhere-terminal",
    };
    h.controller.handleCreateDefaults(defaults);
    const held = (h.controller as unknown as { createDefaults: Map<string, unknown> }).createDefaults;
    expect(held.size).toBe(1);

    h.controller.handleTreeResponse({
      type: "worktreeTreeResponse",
      tree: { gitAvailable: true, unreadable: { count: 0, reasons: [] }, repos: [] },
      presence: singleRepoPresence(1_000_000),
    });
    expect(held.size).toBe(0);
  });

  it("keeps a still-present row's notice on its row", () => {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    removedNotice(h);
    h.controller.handleTreeResponse(response());
    const results = (h.controller as unknown as { actionResults: WorktreeActionResult[] }).actionResults;
    expect(results).toEqual([expect.objectContaining({ worktreeId: GONE })]);
    expect(results[0]?.orphanedLabel).toBeUndefined();
  });
});

describe("[2_4] Remove Worktree opens the report before anything is deleted", () => {
  const VALIDATOR = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator";

  function ready() {
    const h = mount();
    h.controller.setVisible(true);
    h.controller.handleTreeResponse(response());
    h.posts.length = 0;
    return h;
  }

  const PASSING: RemovalCheck[] = [
    { id: "isMain", cls: "refusal", outcome: "passed" },
    { id: "busyAgents", cls: "refusal", outcome: "passed", count: 0 },
    { id: "containsWorktrees", cls: "refusal", outcome: "passed", count: 0 },
    { id: "dirty", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "untracked", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "idlePanes", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "externalAgents", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "locked", cls: "confirmable", outcome: "passed" },
  ];

  const danger = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>('[role="dialog"] button.wt-btn--danger');

  /**
   * Ask through the menu and return the token the panel actually minted. Replies
   * are answered under the live token only, so a test that invents one is
   * asserting against a reply production would discard (D11).
   */
  function ask(h: ReturnType<typeof ready>, id: string = VALIDATOR): string {
    menuActions(h).removeWorktree?.(worktree({ id }));
    const posted = h.posts.at(-1);
    if (posted?.type !== "worktreeRemoveAssess") {
      throw new Error("the menu item posted no assessment request");
    }
    h.posts.length = 0;
    return posted.token;
  }

  it("posts an assessment request and no removal when the menu item is chosen", () => {
    const h = ready();
    menuActions(h).removeWorktree?.(worktree({ id: VALIDATOR }));

    expect(h.posts).toEqual([{ type: "worktreeRemoveAssess", worktreeId: VALIDATOR, token: expect.any(String) }]);
  });

  it("answers a clean report with an ordinary removal, carrying no fingerprint", () => {
    const h = ready();
    const token = ask(h);
    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: null },
    });

    const button = danger();
    expect(button, "a clean assessment mounted no confirmation at all").not.toBeNull();
    expect(button?.textContent).toBe("Remove");
    button?.click();

    expect(h.posts).toEqual([{ type: "worktreeRemove", worktreeId: VALIDATOR, force: false }]);
  });

  it("answers a report with a failed risk using the fingerprint that report carried", () => {
    const h = ready();
    const token = ask(h);
    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token,
      result: {
        kind: "assessed",
        assessment: {
          checks: PASSING.map((c) => (c.id === "dirty" ? { ...c, outcome: "failed" as const, count: 3 } : c)),
          contained: [],
        },
        fingerprint: "fp-assess-1",
      },
    });

    const field = document.querySelector<HTMLInputElement>("#wt-confirm-name");
    expect(field, "a failed risk asked for no typed confirmation").not.toBeNull();
    if (field !== null) {
      field.value = "asimov-validator-autofix";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    danger()?.click();

    expect(h.posts).toEqual([
      { type: "worktreeRemove", worktreeId: VALIDATOR, force: true, fingerprint: "fp-assess-1" },
    ]);
  });

  it("routes an assessment the host could not make to the retry surface, not to a refusal", () => {
    // `checksFor` marks the WHOLE catalogue unproven for an unavailable read,
    // refusal-class checks included, so rendering it as a report would show a
    // worktree the host merely could not read as a hard refusal (design.md D8).
    const h = ready();
    const token = ask(h);
    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token,
      result: { kind: "unavailable", unreadable: ["status", "sessions"] },
    });

    expect(document.querySelector('[role="dialog"]'), "an unreadable assessment opened a confirmation").toBeNull();
    const results = (h.controller as unknown as { actionResults: WorktreeActionResult[] }).actionResults;
    expect(results).toEqual([
      expect.objectContaining({
        action: "remove",
        worktreeId: VALIDATOR,
        outcome: "unavailable",
        unreadable: ["status", "sessions"],
      }),
    ]);
    expect(h.posts).toEqual([]);
  });

  it("opens no report for a worktree that left the tree while the host was reading it", () => {
    const h = ready();
    const ghost = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/never-existed";
    const token = ask(h, ghost);
    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: ghost,
      token,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: "fp-ghost" },
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(h.posts).toEqual([]);
  });

  it("[W4] opens nothing for the first of two requests for the SAME worktree", () => {
    // The falsifier an id-only guard fails. Reply 1 arriving after request 2 was
    // made still matches an id-only intent, so it opens — and the user's latest
    // question is left with no visible answer (D11).
    const h = ready();
    const first = ask(h);
    // Through a real door, not by poking the field: opening any dialog retires
    // the outstanding assess, which is what lets the user ask a second time
    // rather than having the duplicate dropped (D11's table, D10's drop).
    (
      h.controller as unknown as {
        view: { openLaunchDialog(label: string, agents: readonly WorktreeLaunchAgent[]): void };
      }
    ).view.openLaunchDialog("feat/login", [
      { id: "claude", label: "Claude Code", canSeedPrompt: true, permissionChoices: [] },
    ]);
    const second = ask(h);
    expect(second).not.toBe(first);

    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token: first,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: null },
    });
    // The launch dialog is what the user is looking at, and a global
    // `closeDialog` is exactly how a stale report would take it down.
    expect(danger(), "the superseded reply opened a report over the launch dialog").toBeNull();

    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token: second,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: null },
    });
    expect(danger()?.textContent, "the live reply opened nothing either").toBe("Remove");
  });

  it("[W4] leaves the dialog the VIEW opened standing when a late reply lands", () => {
    // The refutation that put the token on the wire: the blocked notice's own
    // opener calls `openRemoveReport` from the view, so a guard only the
    // controller clears is not cleared here (WorktreeView.ts, D11).
    const h = ready();
    const token = ask(h);
    const view = (
      h.controller as unknown as {
        view: { openRemoveReport(info: WorktreeInfo, report: WorktreeRemoveReport): void };
      }
    ).view;
    view.openRemoveReport(worktree({ id: VALIDATOR }), {
      checks: PASSING.map((c) => (c.id === "dirty" ? { ...c, outcome: "failed" as const, count: 2 } : c)),
      contained: [],
      fingerprint: "fp-blocked",
    });
    expect(
      document.querySelector("#wt-confirm-name"),
      "the blocked report asked for no typed confirmation",
    ).not.toBeNull();

    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: null },
    });

    // Still the forced one. The clean report would have replaced its typed
    // field with an ordinary Remove button.
    expect(document.querySelector("#wt-confirm-name")).not.toBeNull();
  });

  it("[W4] drops a reply for a worktree that is not the one being asked about", () => {
    const h = ready();
    const token = ask(h);
    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel",
      token: `${token}-other`,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: null },
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("[D4] asks again rather than refusing, so a dropped answer costs a click and not the row", () => {
    // REPLACES the round-4 guard that dropped a same-worktree repeat. That guard
    // could never bound host work — it saw one surface and one worktree id, so
    // alternating rows walked straight past it (round-6 B5) — and refusing the
    // repeat is what made a lost reply permanent: the one gesture that would
    // recover the row was the one thing it suppressed (round-6 W6). The bound
    // now lives on the host, per repository.
    const h = ready();
    menuActions(h).removeWorktree?.(worktree({ id: VALIDATOR }));
    menuActions(h).removeWorktree?.(worktree({ id: VALIDATOR }));

    const asks = h.posts.filter((m) => m.type === "worktreeRemoveAssess");
    expect(asks).toHaveLength(2);
    // Distinct tokens, or the panel could not tell the two answers apart and
    // D11's ordering would be back where W4 found it.
    expect(new Set(asks.map((m) => (m as { token: string }).token)).size).toBe(2);
  });

  it("[D4] opens the later answer and never the one it superseded", () => {
    const h = ready();
    const first = ask(h);
    const second = ask(h);
    expect(second).not.toBe(first);

    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token: first,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: null },
    });
    expect(document.querySelector('[role="dialog"]'), "the superseded answer opened a report").toBeNull();

    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token: second,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: null },
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("[W6] still opens a report after an answer that never arrived", () => {
    // The strand round-6 W6 describes: the host posted, the transport dropped
    // it, and nothing will ever clear the slot. The recovery is the user's next
    // click, which the old guard refused.
    const h = ready();
    ask(h);

    const retried = ask(h);
    h.controller.handleRemoveAssessment({
      type: "worktreeRemoveAssessment",
      worktreeId: VALIDATOR,
      token: retried,
      result: { kind: "assessed", assessment: { checks: PASSING, contained: [] }, fingerprint: null },
    });

    expect(document.querySelector('[role="dialog"]'), "the row stayed dead after a dropped reply").not.toBeNull();
  });
});
