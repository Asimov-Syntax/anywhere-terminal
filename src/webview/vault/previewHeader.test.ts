// @vitest-environment jsdom
// previewHeader — the single header builder for both consumers. Verifies the
// vault shape (badge + all actions + meta) and the subagent shape (badge + chip
// + maximize/close only, no resume/nav, no meta) render from one builder.

import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentIcon } from "./agentIcons";
import { buildPreviewHeader, type PreviewHeaderCallbacks } from "./previewHeader";

afterEach(() => {
  document.body.innerHTML = "";
});

function baseCb(over: Partial<PreviewHeaderCallbacks> = {}): PreviewHeaderCallbacks {
  return {
    isMaximized: () => false,
    onMovePointerDown: () => {},
    onToggleMaximize: () => {},
    onClose: () => {},
    ...over,
  };
}

function metaDl(): HTMLElement {
  const dl = document.createElement("dl");
  dl.className = "vault-preview-meta";
  return dl;
}

describe("buildPreviewHeader: vault shape", () => {
  it("renders badge (accent), title, meta, and all three actions in order", () => {
    const { element } = buildPreviewHeader(
      {
        badge: { icon: getAgentIcon("claude"), ariaLabel: "Claude Code", fallbackText: "Cl" },
        title: "My session",
        meta: metaDl(),
      },
      baseCb({ onResume: () => {} }),
    );
    const badge = element.querySelector(".vault-badge");
    expect(badge?.classList.contains("vault-badge--claude")).toBe(true);
    expect(badge?.getAttribute("aria-label")).toBe("Claude Code");
    expect(element.querySelector(".vault-preview-title")?.textContent).toBe("My session");
    expect(element.querySelector(".vault-preview-meta")).not.toBeNull();
    const actions = Array.from(element.querySelectorAll(".vault-preview-title-actions > button")).map((b) =>
      (b as HTMLElement).className.replace("vault-preview-icon-btn ", ""),
    );
    expect(actions).toEqual(["vault-preview-resume", "vault-preview-maximize", "vault-preview-close"]);
  });

  it("the title row carries no branch chip and no per-message navigation", () => {
    const { element } = buildPreviewHeader(
      { badge: { fallbackText: "Cl" }, title: "My session", meta: metaDl() },
      baseCb({ onResume: () => {} }),
    );
    const row = element.querySelector(".vault-preview-title-row") as HTMLElement;
    expect(row.querySelector(".vault-preview-branch-chip")).toBeNull();
    expect(row.querySelector(".vault-preview-nav-prev")).toBeNull();
    expect(row.querySelector(".vault-preview-nav-next")).toBeNull();
  });

  it("falls back to text when no icon is resolved", () => {
    const { element } = buildPreviewHeader({ badge: { fallbackText: "CX" }, title: "x" }, baseCb());
    expect(element.querySelector(".vault-badge")?.textContent).toBe("CX");
  });

  it("reflects maximized state on the maximize button", () => {
    const { element } = buildPreviewHeader({ badge: {}, title: "x" }, baseCb({ isMaximized: () => true }));
    const max = element.querySelector(".vault-preview-maximize");
    expect(max?.getAttribute("aria-pressed")).toBe("true");
    expect(max?.getAttribute("aria-label")).toBe("Restore size");
  });
});

describe("buildPreviewHeader: subagent shape", () => {
  it("renders chip + maximize/close only — no resume, no prev/next, no meta", () => {
    const { element } = buildPreviewHeader(
      {
        badge: { icon: getAgentIcon("claude"), fallbackText: "CL" },
        chip: { text: "@Explore", className: "vault-preview-subagent-agent" },
        title: "Find the auth middleware",
      },
      baseCb(), // no onResume
    );
    expect(element.querySelector(".vault-preview-subagent-agent")?.textContent).toBe("@Explore");
    expect(element.querySelector(".vault-preview-title")?.textContent).toBe("Find the auth middleware");
    expect(element.querySelector(".vault-preview-resume")).toBeNull();
    expect(element.querySelector(".vault-preview-nav-prev")).toBeNull();
    expect(element.querySelector(".vault-preview-nav-next")).toBeNull();
    expect(element.querySelector(".vault-preview-meta")).toBeNull();
    const actions = Array.from(element.querySelectorAll(".vault-preview-title-actions > button")).map((b) =>
      (b as HTMLElement).className.replace("vault-preview-icon-btn ", ""),
    );
    expect(actions).toEqual(["vault-preview-maximize", "vault-preview-close"]);
  });

  it("places the chip between badge and title", () => {
    const { element } = buildPreviewHeader(
      {
        badge: { fallbackText: "CL" },
        chip: { text: "@Plan", className: "vault-preview-subagent-agent" },
        title: "t",
      },
      baseCb(),
    );
    const row = element.querySelector(".vault-preview-title-row") as HTMLElement;
    const classes = Array.from(row.children).map((c) => c.className.split(" ")[0]);
    expect(classes).toEqual([
      "vault-badge",
      "vault-preview-subagent-agent",
      "vault-preview-title",
      "vault-preview-title-actions",
    ]);
  });
});

describe("buildPreviewHeader: callbacks", () => {
  it("wires close, maximize, and resume", () => {
    const onClose = vi.fn();
    const onToggleMaximize = vi.fn();
    const onResume = vi.fn();
    const { element } = buildPreviewHeader({ badge: {}, title: "x" }, baseCb({ onClose, onToggleMaximize, onResume }));
    element.querySelector<HTMLButtonElement>(".vault-preview-close")?.click();
    element.querySelector<HTMLButtonElement>(".vault-preview-maximize")?.click();
    element.querySelector<HTMLButtonElement>(".vault-preview-resume")?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
