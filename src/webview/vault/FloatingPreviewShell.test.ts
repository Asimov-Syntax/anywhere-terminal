// @vitest-environment jsdom
// FloatingPreviewShell — the shared preview chrome. Covers the render assembly,
// show/hide lifecycle + document close-listener attach/detach, the Escape guard,
// the outside-click exclusion, tooltip disposal, and dispose().

import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingPreviewShell, type FloatingPreviewShellDeps } from "./FloatingPreviewShell";

let shell: FloatingPreviewShell | undefined;

afterEach(() => {
  // jsdom isolation: tear down + scrub so document listeners don't leak (project memory).
  shell?.dispose();
  shell = undefined;
  document.body.innerHTML = "";
});

function make(overrides: Partial<FloatingPreviewShellDeps> = {}) {
  const onRequestClose = vi.fn();
  const s = new FloatingPreviewShell({
    ariaLabel: "Test preview",
    onScrollTop: () => {},
    onRequestClose,
    ...overrides,
  });
  document.body.appendChild(s.el);
  return { s, onRequestClose };
}

function body(child = "hi"): HTMLElement {
  const b = document.createElement("div");
  b.className = "vault-preview-body";
  b.textContent = child;
  return b;
}

describe("FloatingPreviewShell: onKeyDown hook", () => {
  it("delivers keys in the CAPTURE phase, ahead of a bubble-phase document listener", () => {
    const seen: string[] = [];
    const r = make({ onKeyDown: () => seen.push("shell") });
    shell = r.s;
    const bubble = () => seen.push("document");
    document.addEventListener("keydown", bubble);
    try {
      r.s.render(body());
      r.s.show();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
      // The terminal's own key router is capture-phase; the shell must see the
      // event first so it can stop the key reaching the pty.
      expect(seen).toEqual(["shell", "document"]);
    } finally {
      document.removeEventListener("keydown", bubble);
    }
  });

  it("attaches only while open — no delivery before show() or after hide()", () => {
    const onKeyDown = vi.fn();
    const r = make({ onKeyDown });
    shell = r.s;
    const press = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true }));

    press();
    expect(onKeyDown).not.toHaveBeenCalled();

    r.s.render(body());
    r.s.show();
    press();
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    r.s.hide();
    press();
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("a shell with no onKeyDown (the subagent popup) attaches no key listener", () => {
    const r = make();
    shell = r.s;
    r.s.render(body());
    r.s.show();
    // Escape still closes — the close listeners are independent of the hook.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(r.onRequestClose).toHaveBeenCalledTimes(1);
  });
});

describe("FloatingPreviewShell: construction", () => {
  it("creates a .vault-preview aside with aria-label, role, and extra classes", () => {
    const r = make({ role: "dialog", classNames: ["vault-preview--claude"] });
    shell = r.s;
    expect(r.s.el.tagName).toBe("ASIDE");
    expect(r.s.el.classList.contains("vault-preview")).toBe(true);
    expect(r.s.el.classList.contains("vault-preview--claude")).toBe(true);
    expect(r.s.el.getAttribute("aria-label")).toBe("Test preview");
    expect(r.s.el.getAttribute("role")).toBe("dialog");
  });

  it("seeds FloatingWindow from initialGeometry (resolved once)", () => {
    const initialGeometry = vi.fn(() => ({ top: 10, left: 20, width: 300, height: 200, maximized: true }));
    const r = make({ initialGeometry });
    shell = r.s;
    expect(initialGeometry).toHaveBeenCalledTimes(1);
    expect(r.s.floatingWindow.isMaximized()).toBe(true);
  });
});

describe("FloatingPreviewShell: render assembly", () => {
  it("lays out content → resize handles → scroll nav and wires the body", () => {
    const r = make();
    shell = r.s;
    const header = document.createElement("header");
    r.s.render(header, body());
    expect(r.s.el.firstChild).toBe(header);
    expect(r.s.el.contains(r.s.scrollNav.element)).toBe(true);
    // 8 resize handles sit between the content and the scroll nav.
    expect(r.s.el.querySelectorAll(".vault-preview-resize")).toHaveLength(8);
    expect(r.s.el.lastChild).toBe(r.s.scrollNav.element);
    expect(r.s.scrollNav.element.classList.contains("is-empty")).toBe(false);
  });
});

describe("FloatingPreviewShell: show / hide", () => {
  it("show() marks is-open; hide() clears content + is-open", () => {
    const r = make();
    shell = r.s;
    r.s.render(body());
    r.s.show();
    expect(r.s.isOpen()).toBe(true);
    expect(r.s.el.classList.contains("is-open")).toBe(true);
    r.s.hide();
    expect(r.s.isOpen()).toBe(false);
    expect(r.s.el.childNodes).toHaveLength(0);
  });
});

describe("FloatingPreviewShell: dismissal", () => {
  it("Escape requests close when unguarded", () => {
    const r = make();
    shell = r.s;
    r.s.show();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(r.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("Escape is suppressed when shouldCloseOnEscape() is false", () => {
    const r = make({ shouldCloseOnEscape: () => false });
    shell = r.s;
    r.s.show();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(r.onRequestClose).not.toHaveBeenCalled();
  });

  it("outside mousedown requests close, inside does not", () => {
    const r = make();
    shell = r.s;
    r.s.render(body());
    r.s.show();
    r.s.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(r.onRequestClose).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(r.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("outsideCloseExclude keeps matching targets from closing", () => {
    const r = make({ outsideCloseExclude: [".vault-row"] });
    shell = r.s;
    r.s.show();
    const row = document.createElement("div");
    row.className = "vault-row";
    document.body.appendChild(row);
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(r.onRequestClose).not.toHaveBeenCalled();
  });

  it("detaches listeners on hide so a later document event is inert", () => {
    const r = make();
    shell = r.s;
    r.s.show();
    r.s.hide();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(r.onRequestClose).not.toHaveBeenCalled();
  });
});

describe("FloatingPreviewShell: tooltips + dispose", () => {
  it("flushes tracked tooltip disposers on hide", () => {
    const r = make();
    shell = r.s;
    const d1 = vi.fn();
    const d2 = vi.fn();
    r.s.trackTooltips([d1, d2]);
    r.s.hide();
    expect(d1).toHaveBeenCalledTimes(1);
    expect(d2).toHaveBeenCalledTimes(1);
  });

  it("dispose removes the element from the DOM", () => {
    const r = make();
    shell = r.s;
    expect(document.body.contains(r.s.el)).toBe(true);
    r.s.dispose();
    expect(document.body.contains(r.s.el)).toBe(false);
    shell = undefined; // already disposed
  });
});
