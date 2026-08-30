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
import { agentRow, noRepoTree, singleRepoPresence, singleRepoTree, twoRepoTree, worktree } from "./worktreeFixtures";
import type {
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeCreateDefaults,
  WorktreeInfo,
  WorktreePresence,
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

  it("asks for a removal UNFORCED, so the host answers with blockers rather than acting", () => {
    // The webview never decides a removal is safe. Posting force:true here would
    // skip the blocker set and the fingerprint bound to it entirely.
    const { actions, posted } = controllerActions();
    actions.removeWorktree?.(worktree({ id: "/wt" }));
    expect(posted).toEqual([{ type: "worktreeRemove", worktreeId: "/wt", force: false }]);
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

  it("maps a new-branch draft onto the create request", () => {
    const posted: WebViewToExtensionMessage[] = [];
    const h = mount();
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

    expect(h.posts.filter((m) => m.type === "worktreeCreate")).toEqual([
      {
        type: "worktreeCreate",
        repoId: "/repo/.git",
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

    expect(h.posts.filter((m) => m.type === "worktreeCreate")).toEqual([
      {
        type: "worktreeCreate",
        repoId: "/repo/.git",
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
    return { type: "worktreeCreateDefaults", repoId, root, prefix: "p", path: `${root}/p-x` };
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

  it("[B1] an answer that names the branch it is for still reaches the open form", () => {
    const h = ready(twoRepoResponse());
    const applied: unknown[] = [];
    (h.controller as unknown as { applyCreateDefaults?: (s: unknown) => void }).applyCreateDefaults = (seed) =>
      applied.push(seed);
    h.controller.handleCreateDefaults({ ...answer(REPO_A, "/trees/a"), branch: "feat/x" });

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

describe("the destination a create opens on", () => {
  /** The repo the fixture tree carries, and the host's answer for it. */
  const REPO = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";
  const MAIN = "/Users/dev/Projects/ai-oss/anywhere-terminal";
  function defaults(over: Partial<WorktreeCreateDefaultsMessage> = {}): WorktreeCreateDefaultsMessage {
    return {
      type: "worktreeCreateDefaults",
      repoId: REPO,
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

    expect(h.posts).toEqual([{ type: "requestWorktreeCreateDefaults", repoId: REPO }]);
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
    h.controller.handleCreateDefaults(defaults());

    expect(document.querySelector(".wt-create-dialog, dialog, .wt-dialog")).not.toBeNull();
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

  it("gives a refusal an empty fingerprint, because nothing can authorize it", () => {
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
    expect(refused?.fingerprint).toBe("");
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

  it("retries only the removal an unreadable assessment names, unforced", () => {
    // Unforced: what could not be read may still be a blocker, so a retry asks
    // the same question again rather than answering it.
    const h = ready();
    const view = (h.controller as unknown as { view: { deps: { onRetryAction(r: WorktreeActionResult): void } } }).view;
    view.deps.onRetryAction({
      action: "remove",
      worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator",
      outcome: "unavailable",
      unreadable: ["status"],
    });

    expect(h.posts).toEqual([
      { type: "worktreeRemove", worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/validator", force: false },
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
              onBranchChange(repoId: string, branch: string): void;
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
    dialogDeps(h).onBranchChange(REPO, "feat/login");

    expect(h.posts).toEqual([{ type: "requestWorktreeCreateDefaults", repoId: REPO, branch: "feat/login" }]);
  });

  it("pushes an unsolicited answer into the form the user already has open", () => {
    const h = ready();
    const applied: WorktreeCreateDefaults[] = [];
    dialogDeps(h).bindDefaults((next) => applied.push(next));

    h.controller.handleCreateDefaults({
      type: "worktreeCreateDefaults",
      repoId: REPO,
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
