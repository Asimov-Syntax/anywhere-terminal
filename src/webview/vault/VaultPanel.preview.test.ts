// @vitest-environment jsdom

// The worktree panel's route into the preview overlay it does not own. Round-1
// B1: the vault list is fetched independently of the worktree tree, so a preview
// the HOST already resolved could arrive before the list holding its entry.

import { afterEach, describe, expect, it } from "vitest";
import type { VaultListResult, VaultSessionEntry } from "../../vault/types";
import { resetTooltipForTests } from "../ui/Tooltip";
import { VaultPanel } from "./VaultPanel";

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  resetTooltipForTests();
  document.body.replaceChildren();
});

function entry(id: string): VaultSessionEntry {
  return {
    id,
    agent: "claude",
    sessionId: id.split(":")[1] ?? id,
    title: `Session ${id}`,
    cwd: "/repo",
    modified: 1_700_000_000_000,
    flags: {},
    canFork: true,
  } as VaultSessionEntry;
}

function list(...ids: string[]): VaultListResult {
  return { entries: ids.map(entry), unreadable: { count: 0, reasons: [] } };
}

function panel(): { panel: VaultPanel } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { panel: new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false }) };
}

/** The overlay's own record of what it is showing. */
function shownEntryId(p: VaultPanel): string | null {
  return (p as unknown as { preview: { activeEntryId: string | null } }).preview.activeEntryId;
}

describe("openPreviewById", () => {
  it("opens straight away when the list already holds the entry", () => {
    const { panel: p } = panel();
    p.render(list("claude:s1", "claude:s2"));
    expect(p.openPreviewById("claude:s2")).toBe(true);
    expect(shownEntryId(p)).toBe("claude:s2");
  });

  it("opens on the arriving list when the entry was not there yet", () => {
    // Reporting false and forgetting would drop a preview the host approved.
    const { panel: p } = panel();
    expect(p.openPreviewById("claude:s2")).toBe(false);
    expect(shownEntryId(p)).toBeNull();

    p.render(list("claude:s1", "claude:s2"));
    expect(shownEntryId(p)).toBe("claude:s2");
  });

  it("keeps only the newest pending request", () => {
    // One slot, not a queue: a second request supersedes the first, exactly as
    // opening two previews in a row would.
    const { panel: p } = panel();
    p.openPreviewById("claude:s1");
    p.openPreviewById("claude:s2");
    p.render(list("claude:s1", "claude:s2"));
    expect(shownEntryId(p)).toBe("claude:s2");
  });

  it("does not reopen the pending entry on a later list", () => {
    const { panel: p } = panel();
    p.openPreviewById("claude:s2");
    p.render(list("claude:s2"));
    expect(shownEntryId(p)).toBe("claude:s2");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(shownEntryId(p)).toBeNull();
    p.render(list("claude:s2"));
    expect(shownEntryId(p)).toBeNull();
  });

  it("waits rather than opening the wrong entry when the list never brings it", () => {
    const { panel: p } = panel();
    p.openPreviewById("claude:gone");
    p.render(list("claude:s1"));
    expect(shownEntryId(p)).toBeNull();
  });

  it("expands the panel, because a preview inside a collapsed section is invisible", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const p = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => true });
    p.render(list("claude:s1"));
    p.openPreviewById("claude:s1");
    expect(p.isCollapsed()).toBe(false);
  });
});

describe("a surface that cannot perform vault actions", () => {
  function readOnly(): VaultPanel {
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      actionsAvailable: false,
    });
  }

  it("still opens the preview, which is the read the worktree panel asked for", () => {
    // 6_3 exists so a preview raised from an editor surface opens there. Hiding
    // the actions must not take the preview with them.
    const p = readOnly();
    p.render(list("claude:s1"));
    expect(p.openPreviewById("claude:s1")).toBe(true);
    expect(shownEntryId(p)).toBe("claude:s1");
  });

  it("offers no Resume in the preview header either", () => {
    // The overlay is a read and still opens; the controls inside it post actions
    // and must not (round-2 B4).
    const p = readOnly();
    p.render(list("claude:s1"));
    p.openPreviewById("claude:s1");
    expect(document.querySelectorAll(".vault-preview-resume")).toHaveLength(0);
  });

  it("keeps Resume in the preview header on an action-capable surface", () => {
    const { panel: p } = panel();
    p.render(list("claude:s1"));
    p.openPreviewById("claude:s1");
    expect(document.querySelectorAll(".vault-preview-resume").length).toBeGreaterThan(0);
  });

  it("offers no Resume button on a row that would otherwise have one", () => {
    const p = readOnly();
    p.render(list("claude:s1"));
    expect(document.querySelectorAll(".vault-action--resume")).toHaveLength(0);
  });

  it("keeps the Resume button on an action-capable surface", () => {
    // The negative above is only meaningful if the positive holds on the default.
    const { panel: p } = panel();
    p.render(list("claude:s1"));
    expect(document.querySelectorAll(".vault-action--resume").length).toBeGreaterThan(0);
  });
});

describe("[1_5] whether a preview is open over the panel", () => {
  it("reads false before an open, true while open, false after Escape", () => {
    // The Worktree drawer's Escape handler defers to this. The shell never moves
    // focus, so an Escape with the preview up still targets the row underneath —
    // without this the drawer would close instead of the preview, and its
    // stopPropagation would keep the preview open.
    const { panel: p } = panel();
    expect(p.isPreviewOpen()).toBe(false);

    p.openPreviewById("claude:s1");
    p.render(list("claude:s1"));
    expect(shownEntryId(p)).toBe("claude:s1");
    expect(p.isPreviewOpen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(p.isPreviewOpen()).toBe(false);
  });

  it("stays false for an entry the list never brought", () => {
    // Pending is not open: the drawer must not defer to an overlay that is not
    // on screen, or Escape would do nothing at all.
    const { panel: p } = panel();
    p.openPreviewById("claude:gone");
    p.render(list("claude:s1"));
    expect(p.isPreviewOpen()).toBe(false);
  });
});
