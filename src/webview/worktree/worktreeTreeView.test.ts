// @vitest-environment jsdom
// src/webview/worktree/worktreeTreeView.test.ts — the agent row's two lines, and
// which of them is title-shaped (source-the-agent-row-preview 1_4).

import { describe, expect, it } from "vitest";
import { agentRow } from "./worktreeFixtures";
import { type AgentRowOptions, renderAgentRow, renderSubagentSection } from "./worktreeTreeView";
import type { WorktreeAgentRow } from "./worktreeViewTypes";

const NOW = 1_700_000_000_000;

function render(over: Partial<WorktreeAgentRow>): HTMLElement {
  return renderAgentRow(
    agentRow({ rowId: "row-1", title: "Building", ...over }),
    { activity: "idle", now: NOW },
    { onActivate: () => undefined },
  );
}

const previewOf = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>(".wt-apreview");

describe("the agent row's preview line", () => {
  it.each([
    ["- run the migration first", "a markdown bullet"],
    ["* run the migration first", "an asterisk bullet"],
    ["/ divided by zero", "a leading slash"],
    ["| a table row |", "a leading pipe"],
  ])("keeps %s intact (%s)", (text) => {
    const el = render({ preview: text });
    expect(previewOf(el)?.textContent).toBe(text);
    expect(previewOf(el)?.dataset.tip).toBe(text);
    expect(el.dataset.tip).toContain(text);
  });

  it("draws a line for a preview that is only a marker", () => {
    // The title stripper turns this into "" and the row then draws no second line
    // at all. In message text it is content, so the line stays.
    const el = render({ preview: "-" });
    expect(previewOf(el)?.textContent).toBe("-");
  });

  it("draws no second line when there is no preview", () => {
    expect(previewOf(render({}))).toBeNull();
    expect(previewOf(render({ preview: "" }))).toBeNull();
  });

  it("still strips the title beside it", () => {
    const el = render({ title: "⠋ Building", preview: "- a bullet" });
    expect(el.querySelector(".wt-atitle")?.textContent).toBe("Building");
    expect(previewOf(el)?.textContent).toBe("- a bullet");
  });
});

// -- The options the inspector drawer needs (1_2) ---------------------------
//
// Every one defaults to what the tree already did, so the list rows above stay
// byte-identical; only the drawer opts in.

function renderWith(over: Partial<WorktreeAgentRow>, opts: Partial<AgentRowOptions>): HTMLElement {
  return renderAgentRow(
    agentRow({ rowId: "row-1", title: "Building", ...over }),
    { activity: "idle", now: NOW, ...opts },
    { onActivate: () => undefined, onToggleSubagents: () => undefined },
  );
}

describe("[1_2] an agent row outside a tree", () => {
  it("is a treeitem at -1 by default, which is what the tree's roving stop needs", () => {
    const el = renderWith({ entryId: "claude:s1" }, {});
    expect(el.getAttribute("role")).toBe("treeitem");
    expect(el.tabIndex).toBe(-1);
  });

  it("takes the role and the tab stop the caller asks for", () => {
    // `treeitem` outside `role="tree"` is invalid ARIA, and a row left at -1 in a
    // surface with no roving machinery is unreachable by keyboard.
    const el = renderWith({ entryId: "claude:s1" }, { role: "listitem", focusable: true });
    expect(el.getAttribute("role")).toBe("listitem");
    expect(el.tabIndex).toBe(0);
  });

  it("offers no disclosure when it does not own one", () => {
    // The drawer draws the history unconditionally. A chevron and an
    // `aria-expanded` beside content the row does not govern are inert whichever
    // way they read.
    const el = renderWith({ entryId: "claude:s1" }, { disclosure: false });
    expect(el.hasAttribute("aria-expanded")).toBe(false);
    expect(el.querySelector(".wt-gutter")?.innerHTML).toBe("");
  });

  it("still offers one by default, so the tree is untouched", () => {
    const el = renderWith({ entryId: "claude:s1" }, {});
    expect(el.getAttribute("aria-expanded")).toBe("false");
    expect(el.querySelector(".wt-gutter")?.innerHTML).not.toBe("");
  });

  it("claims no collapsed children where nothing is collapsed", () => {
    // `+2` beside two visible delegations counts them twice.
    const roster = { kind: "ok" as const, rows: [
      { name: "a", status: "completed" as const, live: false },
      { name: "b", status: "completed" as const, live: false },
    ] };
    expect(renderWith({ entryId: "claude:s1", delegations: roster }, {}).querySelector(".wt-count")?.textContent).toBe(
      "+2",
    );
    // Unclassed when it has nothing to say, so the selector finds nothing at all.
    expect(
      renderWith({ entryId: "claude:s1", delegations: roster }, { disclosure: false }).querySelector(".wt-count"),
    ).toBeNull();
  });
});

describe("[1_2] the model the list row will not name", () => {
  const modelOf = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>(".wt-amodel");

  it("names it only where it was asked for", () => {
    expect(modelOf(renderWith({ model: "claude-opus-5" }, {}))).toBeNull();
    expect(modelOf(renderWith({ model: "claude-opus-5" }, { showModel: true }))?.textContent).toBe("claude-opus-5");
  });

  it("draws nothing at all when the model is unknown", () => {
    // A placeholder would claim we asked and were told (§ 3.3).
    expect(modelOf(renderWith({}, { showModel: true }))).toBeNull();
    expect(modelOf(renderWith({ model: "" }, { showModel: true }))).toBeNull();
  });

  it("rides inside the title cell rather than becoming an eighth column", () => {
    // `.wt-arow` declares exactly seven grid tracks and pins every non-preview
    // root child to row 1, so a root-level model span would add an implicit
    // column on exactly the rows the drawer draws.
    const bare = renderWith({ preview: "p" }, {});
    const withModel = renderWith({ model: "claude-opus-5", preview: "p" }, { showModel: true });
    expect(withModel.children.length).toBe(bare.children.length);
    expect(modelOf(withModel)?.parentElement?.className).toBe("wt-atitle");
  });
});

describe("[1_2] a delegation section outside a tree", () => {
  const parent = agentRow({ rowId: "row-1", entryId: "claude:s1" });

  it("keeps the tree's roles by default", () => {
    const el = renderSubagentSection(undefined, parent, () => undefined, NOW);
    expect(el.getAttribute("role")).toBe("group");
  });

  it("takes list roles and a tab stop when asked", () => {
    const roster = { kind: "ok" as const, rows: [{ name: "a", status: "completed" as const, live: false }] };
    const el = renderSubagentSection(roster, parent, () => undefined, NOW, {
      role: "list",
      rowRole: "listitem",
      focusable: true,
    });
    expect(el.getAttribute("role")).toBe("list");
    const row = el.querySelector<HTMLElement>(".wt-srow");
    expect(row?.getAttribute("role")).toBe("listitem");
    expect(row?.tabIndex).toBe(0);
  });

  it("says a row with no session has nothing to read, rather than waiting for ever", () => {
    // An unread roster and an unreadable one look identical from here. A surface
    // that draws the section unconditionally would otherwise leave a
    // sessionless row on "Reading…" with nothing coming.
    const waiting = renderSubagentSection(undefined, parent, () => undefined, NOW);
    expect(waiting.textContent).toContain("Reading…");
    const never = renderSubagentSection(undefined, agentRow({ rowId: "row-2" }), () => undefined, NOW, {
      noSession: true,
    });
    expect(never.textContent).not.toContain("Reading…");
    expect(never.textContent).toContain("No session");
  });
});
