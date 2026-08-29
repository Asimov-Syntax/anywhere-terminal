// @vitest-environment jsdom
// src/webview/worktree/worktreeTreeView.test.ts — the agent row's two lines, and
// which of them is title-shaped (source-the-agent-row-preview 1_4).

import { describe, expect, it } from "vitest";
import { agentRow } from "./worktreeFixtures";
import { renderAgentRow } from "./worktreeTreeView";
import type { WorktreeAgentRow } from "./worktreeViewTypes";

const NOW = 1_700_000_000_000;

function render(over: Partial<WorktreeAgentRow>): HTMLElement {
  return renderAgentRow(agentRow({ rowId: "row-1", title: "Building", ...over }), { activity: "idle", now: NOW }, {
    onActivate: () => undefined,
  });
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
