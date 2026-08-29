// @vitest-environment jsdom
//
// Selection and the inspector are two questions — what is scoped, and what is
// being read — and this is the seam where they stay separable: opening the
// drawer must not re-announce a scope, and dismissing it must not clear one.

import { afterEach, describe, expect, it } from "vitest";
import type { WebViewToExtensionMessage } from "../../types/messages";
import type { WebviewState } from "../state/WebviewState";
import { WorktreeController } from "./WorktreeController";
import { agentRow, singleRepoPresence, singleRepoTree } from "./worktreeFixtures";
import type { WorktreePresence, WorktreeTree } from "./worktreeViewTypes";

const NOW = 1_000_000;
const MAIN = "/Users/dev/Projects/ai-oss/anywhere-terminal";
const PANEL = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel";

afterEach(() => {
  document.body.replaceChildren();
});

interface Harness {
  controller: WorktreeController;
  posts: WebViewToExtensionMessage[];
  selections: (string | null)[];
  push: (tree?: WorktreeTree, presence?: WorktreePresence) => void;
}

function mount(
  over: { workbench?: boolean; overlayOpen?: () => boolean; expandedRows?: string[]; presence?: WorktreePresence } = {},
): Harness {
  const posts: WebViewToExtensionMessage[] = [];
  const selections: (string | null)[] = [];
  const state: WebviewState = { worktreeExpandedRows: over.expandedRows ?? [] } as WebviewState;
  const controller = WorktreeController.mount({
    host: document.body,
    postMessage: (msg) => posts.push(msg),
    store: { getState: () => state, updateState: (patch) => Object.assign(state, patch) },
    init: { workspaceRoot: "/repo", rowActivation: "focus", workbench: over.workbench ?? true },
    onSelectWorktree: (worktreeId) => selections.push(worktreeId),
    ...(over.overlayOpen ? { overlayOpen: over.overlayOpen } : {}),
    now: () => NOW,
  });
  document.body.replaceChildren(controller.element);
  controller.setVisible(true);
  const push = (tree: WorktreeTree = singleRepoTree(), presence = over.presence ?? singleRepoPresence(NOW)): void => {
    controller.handleTreeResponse({ type: "worktreeTreeResponse", tree, presence });
  };
  push();
  return { controller, posts, selections, push };
}

const drawer = (): HTMLElement | null => document.querySelector<HTMLElement>(".wt-inspector");

const row = (worktreeId: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`.wt-row[data-worktree-id="${worktreeId}"]`);
  if (el === null) {
    throw new Error(`no row for ${worktreeId}`);
  }
  return el;
};

const dismiss = (): void => drawer()?.querySelector<HTMLButtonElement>(".wt-idismiss")?.click();

const branchShown = (): string | undefined => drawer()?.querySelector(".wt-ibranch")?.textContent ?? undefined;

/** A tree with one linked worktree dropped, for the "it left" cases. */
function treeWithout(worktreeId: string): WorktreeTree {
  const base = singleRepoTree();
  return {
    ...base,
    repos: base.repos.map((repo) => ({ ...repo, worktrees: repo.worktrees.filter((w) => w.id !== worktreeId) })),
  };
}

/** Dispatch Escape from `el` and report whether it reached the document above. */
function escapeOn(el: HTMLElement): { escaped: boolean } {
  let escaped = false;
  const spy = (): void => {
    escaped = true;
  };
  document.addEventListener("keydown", spy);
  try {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  } finally {
    document.removeEventListener("keydown", spy);
  }
  return { escaped };
}

describe("opening", () => {
  it("opens the drawer on the worktree the user activated", () => {
    const h = mount();
    row(PANEL).click();
    expect(h.controller.isInspectorOpen()).toBe(true);
    expect(branchShown()).toBe("feat/worktree-panel");
  });

  it("leaves focus on the row, not in the drawer", () => {
    // Non-modal: the tree above stays where the user is (design.md D2).
    mount();
    row(PANEL).focus();
    row(PANEL).click();
    expect(document.activeElement).toBe(row(PANEL));
  });

  it("describes the second worktree after a second selection", () => {
    const h = mount();
    row(PANEL).click();
    row(MAIN).click();
    expect(branchShown()).toBe("main");
    expect(h.selections).toEqual([PANEL, MAIN]);
  });

  it("reopens on the row already selected, which announces no new scope", () => {
    // `select` returns early when the selection has not moved, so this is the
    // only way a dismissed drawer comes back (design.md D3).
    const h = mount();
    row(PANEL).click();
    dismiss();
    expect(h.controller.isInspectorOpen()).toBe(false);

    row(PANEL).click();
    expect(h.controller.isInspectorOpen()).toBe(true);
    expect(h.selections).toEqual([PANEL]);
  });

  it("opens nothing while the rollout is off", () => {
    const h = mount({ workbench: false });
    row(PANEL).click();
    expect(h.controller.isInspectorOpen()).toBe(false);
    expect(h.selections).toEqual([]);
  });

  it("stays mounted and hidden while the rollout is off", () => {
    // Hidden rather than unmounted, so turning the flag on needs no second
    // mounting path (design.md D12).
    mount({ workbench: false });
    expect(drawer()).not.toBeNull();
    expect(drawer()?.hidden).toBe(true);
  });
});

describe("dismissal", () => {
  it("leaves the selection and the scope alone", () => {
    const h = mount();
    row(PANEL).click();
    const posted = h.posts.length;

    dismiss();
    expect(h.controller.selectedWorktree()).toBe(PANEL);
    expect(h.selections).toEqual([PANEL]);
    expect(h.posts.length).toBe(posted);
    expect(drawer()?.hidden).toBe(true);
  });

  it("closes on Escape inside the panel body", () => {
    const h = mount();
    row(PANEL).click();
    expect(escapeOn(row(PANEL)).escaped).toBe(false);
    expect(h.controller.isInspectorOpen()).toBe(false);
  });

  it("leaves Escape alone while an overlay above owns it", () => {
    // The vault preview closes first; swallowing the key here would leave it
    // open with nothing left to dismiss it (design.md D9).
    const h = mount({ overlayOpen: () => true });
    row(PANEL).click();
    expect(escapeOn(row(PANEL)).escaped).toBe(true);
    expect(h.controller.isInspectorOpen()).toBe(true);
  });

  it("leaves Escape alone when the drawer is already closed", () => {
    const h = mount();
    expect(escapeOn(h.controller.element).escaped).toBe(true);
  });

  it("returns focus to the row it was describing", () => {
    const h = mount();
    row(PANEL).click();
    drawer()?.querySelector<HTMLButtonElement>(".wt-idismiss")?.focus();
    dismiss();
    expect(h.controller.isInspectorOpen()).toBe(false);
    expect(document.activeElement).toBe(row(PANEL));
  });

  it("leaves focus where the user put it when the drawer never held it", () => {
    // Returning focus unconditionally would yank a keyboard user out of
    // wherever they actually were.
    mount();
    row(PANEL).click();
    row(MAIN).focus();
    dismiss();
    expect(document.activeElement).toBe(row(MAIN));
  });

  it("falls back to the tree when the row it described is no longer drawn", () => {
    const h = mount();
    row(PANEL).click();
    drawer()?.querySelector<HTMLButtonElement>(".wt-idismiss")?.focus();
    // The worktree leaves while the drawer holds focus: the close is the tree's
    // doing, and the row to hand focus back to no longer exists.
    h.push(treeWithout(PANEL));
    // Not `<body>`: the container carries no tab stop, so focus has to land on
    // a row the arrow keys can move from.
    expect(document.activeElement).not.toBe(document.body);
    expect((document.activeElement as HTMLElement | null)?.closest(".wt-tree")).not.toBeNull();
  });
});

describe("what closes it besides the user", () => {
  it("closes when the scope chip clears the selection", () => {
    const h = mount();
    row(PANEL).click();
    h.controller.clearSelection();
    expect(h.controller.isInspectorOpen()).toBe(false);
    expect(h.selections).toEqual([PANEL, null]);
  });

  it("closes when the selected worktree leaves the tree", () => {
    const h = mount();
    row(PANEL).click();
    h.push(treeWithout(PANEL));
    expect(h.controller.isInspectorOpen()).toBe(false);
    expect(h.selections).toEqual([PANEL, null]);
  });

  it("closes when the rollout is turned off under it", () => {
    const h = mount();
    row(PANEL).click();
    h.controller.setWorkbench(false);
    expect(h.controller.isInspectorOpen()).toBe(false);
    expect(drawer()?.hidden).toBe(true);
  });
});

describe("the drawer and the tree agree", () => {
  it("sits below the tree in one body, so the tree keeps the room above it", () => {
    const h = mount();
    const body = h.controller.element;
    expect(body.className).toBe("wt-body");
    expect(body.children[0]?.className).toContain("wt-tree");
    expect(body.children[1]).toBe(drawer());
  });

  it("never re-asks for a session the tree already asked about", () => {
    // One window-wide asked-once set, not one per surface: two sets would each
    // ask once for the same key, which is two requests for one answer (D6).
    const unread = agentRow({ rowId: "main-unread", agent: "claude", entryId: "claude:unread", paneId: "pane-9" });
    const h = mount({
      expandedRows: ["main-unread"],
      presence: { scannedAt: NOW, degradedSources: [], rowsByWorktreeId: { [MAIN]: [unread] } },
    });
    const asked = (): string[] => h.posts.flatMap((m) => (m.type === "requestWorktreeSubagents" ? [m.rowId] : []));
    // Expanded in the tree, so the tree has already asked — a drawer opened over
    // a row nobody asked about would prove nothing.
    expect(asked()).toEqual(["main-unread"]);

    row(MAIN).click();
    expect(drawer()?.querySelector<HTMLElement>(".wt-arow")?.dataset.rowId).toBe("main-unread");
    expect(asked()).toEqual(["main-unread"]);
  });

  it("raises the same host message a row in the tree raises", () => {
    const h = mount();
    row(MAIN).click();
    const before = h.posts.length;
    drawer()?.querySelector<HTMLElement>(".wt-arow")?.click();
    const sent = h.posts.slice(before);
    expect(sent.length).toBe(1);
    expect(sent[0]?.type === "worktreeFocusPane" || sent[0]?.type === "worktreeOpenPreview").toBe(true);
  });
});
