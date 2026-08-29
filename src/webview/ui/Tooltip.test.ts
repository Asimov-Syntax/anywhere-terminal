// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachTooltip, attachTooltipDelegate, resetTooltipForTests } from "./Tooltip";

function makeTarget(title: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = title;
  document.body.appendChild(btn);
  return btn;
}

function widget(): HTMLDivElement | null {
  return document.body.querySelector<HTMLDivElement>(".webview-tooltip");
}

describe("attachTooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetTooltipForTests();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("strips native title to avoid double-tooltip", () => {
    const btn = makeTarget("Search files");
    expect(btn.getAttribute("title")).toBe("Search files");
    attachTooltip(btn);
    expect(btn.hasAttribute("title")).toBe(false);
  });

  it("shows after 300ms hover and hides on mouseleave", () => {
    const btn = makeTarget("Open Folder");
    attachTooltip(btn);
    // Widget is created eagerly at attach time (so aria-describedby resolves
    // immediately for screen readers), but stays display:none until shown.
    expect(widget()?.style.display ?? "none").toBe("none");
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    expect(widget()?.style.display ?? "none").toBe("none");
    vi.advanceTimersByTime(300);
    const tip = widget();
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toBe("Open Folder");
    expect(tip?.style.display).toBe("block");
    btn.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tip?.style.display).toBe("none");
  });

  it("cancels pending show if mouse leaves before delay elapses", () => {
    const btn = makeTarget("Move tree");
    attachTooltip(btn);
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(100);
    btn.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(500);
    expect(widget()?.style.display ?? "none").toBe("none");
  });

  it("hides on mousedown (click suppresses tooltip while menu opens)", () => {
    const btn = makeTarget("Move tree");
    attachTooltip(btn);
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(widget()?.style.display).toBe("block");
    btn.dispatchEvent(new MouseEvent("mousedown"));
    expect(widget()?.style.display).toBe("none");
  });

  it("disposer removes listeners so later hovers do nothing", () => {
    const btn = makeTarget("Search");
    const dispose = attachTooltip(btn);
    dispose();
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(500);
    expect(widget()?.style.display ?? "none").toBe("none");
  });

  it("uses opts.text when provided and leaves explicit-text targets without prior title alone", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, { text: "Custom" });
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(widget()?.textContent).toBe("Custom");
  });

  it("is a no-op when neither title nor opts.text provided (no listeners attached)", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn);
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(500);
    // The singleton widget may exist from a prior call in this test file but
    // it must NOT have been shown for this hover. Check display state, not
    // presence in the DOM.
    expect(widget()?.style.display ?? "none").toBe("none");
  });

  it("Escape key hides the visible tooltip", () => {
    const btn = makeTarget("Search");
    attachTooltip(btn);
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(widget()?.style.display).toBe("block");
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(widget()?.style.display).toBe("none");
  });

  it("dynamic getText is re-read on every show so state changes are reflected", () => {
    const btn = makeTarget("ignored");
    let label = "First";
    attachTooltip(btn, { getText: () => label });
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(widget()?.textContent).toBe("First");
    btn.dispatchEvent(new MouseEvent("mouseleave"));
    label = "Second";
    btn.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(widget()?.textContent).toBe("Second");
  });

  it("attaches aria-describedby to target on attach and removes it on dispose (WCAG 1.4.13 / F3)", () => {
    const btn = makeTarget("Search");
    const dispose = attachTooltip(btn);
    expect(btn.getAttribute("aria-describedby")).toBe("webview-tooltip-widget");
    dispose();
    expect(btn.hasAttribute("aria-describedby")).toBe(false);
  });

  it("focus triggers show (keyboard-only users get the hint — WCAG 1.4.13)", () => {
    const btn = makeTarget("Move tree");
    attachTooltip(btn);
    btn.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(300);
    expect(widget()?.style.display).toBe("block");
    expect(widget()?.textContent).toBe("Move tree");
    btn.dispatchEvent(new Event("blur"));
    expect(widget()?.style.display).toBe("none");
  });
});

describe("attachTooltipDelegate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetTooltipForTests();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function container(): HTMLElement {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return el;
  }

  function row(host: HTMLElement, tip: string): HTMLElement {
    const el = document.createElement("div");
    el.tabIndex = 0;
    el.dataset.tip = tip;
    host.appendChild(el);
    return el;
  }

  function hover(el: HTMLElement): void {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }

  it("serves a descendant created after the delegate was attached", () => {
    const host = container();
    attachTooltipDelegate(host);
    // The point of delegation: rows are rebuilt constantly and never re-attached.
    const late = row(host, "main\n/work/repo");
    hover(late);
    vi.advanceTimersByTime(300);
    expect(widget()?.textContent).toBe("main\n/work/repo");
  });

  it("resolves the hint from the nearest ancestor carrying one", () => {
    const host = container();
    attachTooltipDelegate(host);
    const r = row(host, "branch\n/work/repo");
    const child = document.createElement("span");
    r.appendChild(child);
    hover(child);
    vi.advanceTimersByTime(300);
    expect(widget()?.textContent).toBe("branch\n/work/repo");
  });

  it("leaves nothing on screen when the container is rebuilt mid-hover", async () => {
    const host = container();
    attachTooltipDelegate(host);
    const r = row(host, "feat/x");
    hover(r);
    vi.advanceTimersByTime(300);
    expect(widget()?.style.display).toBe("block");
    // A tree push replaces every row. No mouseout fires for a node that was
    // removed under a stationary cursor, so the tooltip would otherwise persist
    // pointing at a row that no longer exists.
    host.replaceChildren();
    await Promise.resolve();
    expect(widget()?.style.display).toBe("none");
  });

  it("shows on keyboard focus as it does on hover", () => {
    const host = container();
    attachTooltipDelegate(host);
    const r = row(host, "worker-1");
    r.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(widget()?.textContent).toBe("worker-1");
    expect(r.getAttribute("aria-describedby")).toBe("webview-tooltip-widget");
    r.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(widget()?.style.display).toBe("none");
    expect(r.hasAttribute("aria-describedby")).toBe(false);
  });

  it("swaps the hint when the pointer moves to another row", () => {
    const host = container();
    attachTooltipDelegate(host);
    const a = row(host, "alpha");
    const b = row(host, "beta");
    hover(a);
    vi.advanceTimersByTime(300);
    expect(widget()?.textContent).toBe("alpha");
    hover(b);
    vi.advanceTimersByTime(300);
    expect(widget()?.textContent).toBe("beta");
  });

  it("hides when the pointer moves to a descendant with no hint", () => {
    const host = container();
    attachTooltipDelegate(host);
    const r = row(host, "alpha");
    hover(r);
    vi.advanceTimersByTime(300);
    const bare = document.createElement("div");
    host.appendChild(bare);
    hover(bare);
    expect(widget()?.style.display).toBe("none");
  });

  it("stops serving hints once disposed", () => {
    const host = container();
    const dispose = attachTooltipDelegate(host);
    const r = row(host, "alpha");
    dispose();
    hover(r);
    vi.advanceTimersByTime(300);
    expect(widget()?.style.display ?? "none").toBe("none");
  });
});
