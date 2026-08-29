// src/webview/emptyScopeRegion.test.ts — the region a scope with nothing in it shows.
//
// WHEN it appears is the wiring seam's and is tested there; this file covers what
// it says, what its offers do, and the two things it must not do — carry error
// treatment, or clear the scope by itself (design.md D4).

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mountEmptyScopeRegion, renderEmptyScopeRegion } from "./emptyScopeRegion";

function labels(region: HTMLElement): string[] {
  return [...region.querySelectorAll("button")].map((b) => b.textContent ?? "");
}

function click(region: HTMLElement, label: string): void {
  const btn = [...region.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(btn, `no offer labelled ${label}`).toBeDefined();
  btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("renderEmptyScopeRegion", () => {
  it("offers both actions and the way out, naming the scoped worktree", () => {
    const region = renderEmptyScopeRegion({
      label: "feat/worktree-panel",
      onOpenTerminal: vi.fn(),
      onLaunchAgent: vi.fn(),
      onClear: vi.fn(),
    });

    expect(region.textContent).toContain("feat/worktree-panel");
    expect(labels(region)).toEqual(["Open a terminal", "Launch an agent", "Show all tabs"]);
  });

  it("posts each offer for the scoped worktree", () => {
    const onOpenTerminal = vi.fn();
    const onLaunchAgent = vi.fn();
    const region = renderEmptyScopeRegion({
      label: "feat/x",
      onOpenTerminal,
      onLaunchAgent,
      onClear: vi.fn(),
    });

    click(region, "Open a terminal");
    click(region, "Launch an agent");
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
    expect(onLaunchAgent).toHaveBeenCalledTimes(1);
  });

  it("omits the launch offer entirely when nothing can be launched", () => {
    // Omitted rather than disabled: an inert button claims a capability the host
    // has already answered it does not have.
    const region = renderEmptyScopeRegion({ label: "feat/x", onOpenTerminal: vi.fn(), onClear: vi.fn() });

    expect(labels(region)).toEqual(["Open a terminal", "Show all tabs"]);
  });

  it("calls back from the clearing control rather than clearing anything itself", () => {
    const onClear = vi.fn();
    const region = renderEmptyScopeRegion({ label: "feat/x", onOpenTerminal: vi.fn(), onClear });

    click(region, "Show all tabs");
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("clears no scope while merely being rendered", () => {
    const onClear = vi.fn();
    renderEmptyScopeRegion({ label: "feat/x", onOpenTerminal: vi.fn(), onLaunchAgent: vi.fn(), onClear });

    expect(onClear).not.toHaveBeenCalled();
  });

  it("carries no error treatment — an empty worktree is a normal selection", () => {
    const region = renderEmptyScopeRegion({ label: "feat/x", onOpenTerminal: vi.fn(), onClear: vi.fn() });

    expect(region.className).toContain("empty-scope");
    expect(region.outerHTML).not.toMatch(/error|danger|warning/i);
    expect(region.getAttribute("role")).toBe("region");
  });
});

describe("mountEmptyScopeRegion", () => {
  function surface(): HTMLElement {
    document.body.innerHTML = "";
    const container = document.createElement("div");
    container.id = "terminal-container";
    container.appendChild(document.createElement("canvas"));
    document.body.appendChild(container);
    return container;
  }

  const deps = { label: "feat/x", onOpenTerminal: () => {}, onClear: () => {} };

  it("hides the container it stands in front of, so the hidden worktree is not still on screen", () => {
    const container = surface();
    mountEmptyScopeRegion(container, deps);

    expect(container.style.display).toBe("none");
    expect(document.querySelector(".empty-scope")).not.toBeNull();
  });

  it("leaves the container MOUNTED, with its terminal intact", () => {
    // Unmounting would discard xterm's viewport state and make clearing the scope
    // a rebuild rather than a reveal.
    const container = surface();
    const canvas = container.firstElementChild;
    mountEmptyScopeRegion(container, deps);

    expect(container.isConnected).toBe(true);
    expect(canvas?.isConnected).toBe(true);
  });

  it("gives the container back, and takes the region away, when the scope goes", () => {
    const container = surface();
    mountEmptyScopeRegion(container, deps);
    mountEmptyScopeRegion(container, null);

    expect(container.style.display).toBe("");
    expect(document.querySelector(".empty-scope")).toBeNull();
  });

  it("stands one region however often it is asked for", () => {
    const container = surface();
    mountEmptyScopeRegion(container, deps);
    mountEmptyScopeRegion(container, { ...deps, label: "feat/y" });

    expect(document.querySelectorAll(".empty-scope")).toHaveLength(1);
    expect(document.querySelector(".empty-scope")?.textContent).toContain("feat/y");
  });
});
