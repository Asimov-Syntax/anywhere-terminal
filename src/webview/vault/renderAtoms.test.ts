// src/webview/vault/renderAtoms.test.ts — the empty-state atom's action parameter.
//
// It accepts one action or a list. Nine callers pass one, so the single-action
// form is a shipped contract and not merely the convenient case (design.md D4).

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { emptyState } from "./renderAtoms";

const ICON = "<svg></svg>";

describe("emptyState", () => {
  it("renders no action when none is given", () => {
    expect(emptyState(ICON, "Nothing", "Nothing here.").querySelectorAll("button")).toHaveLength(0);
  });

  it("renders a single action passed on its own, as its existing callers pass it", () => {
    const onClick = vi.fn();
    const el = emptyState(ICON, "Nothing", "Nothing here.", { label: "Do it", onClick });

    const buttons = [...el.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Do it"]);
    buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a list in order, each wired to its own handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    const el = emptyState(ICON, "Nothing", "Nothing here.", [
      { label: "First", onClick: first },
      { label: "Second", onClick: second },
    ]);

    const buttons = [...el.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["First", "Second"]);
    buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("treats an empty list as no action at all", () => {
    expect(emptyState(ICON, "Nothing", "Nothing here.", []).querySelectorAll("button")).toHaveLength(0);
  });
});
