// src/webview/vault/grouping.test.ts — Pure grouping (redesign-vault-panel-ui 4_2).

import { describe, expect, it } from "vitest";
import type { VaultSessionEntry } from "../../vault/types";
import { groupEntries } from "./grouping";

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:a",
    agent: "claude",
    sessionId: "a",
    title: "t",
    cwd: "/work/repo",
    modified: 1,
    flags: {},
    canFork: false,
    ...over,
  };
}

describe("groupEntries", () => {
  it("Recent → one flat group ordered by modified desc, cwd chip kept", () => {
    const groups = groupEntries(
      [entry({ id: "a", modified: 10 }), entry({ id: "b", modified: 30 }), entry({ id: "c", modified: 20 })],
      "recent",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].mode).toBe("recent");
    expect(groups[0].hideCwd).toBe(false);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("Agent → one group per agent with display label, accent, and count", () => {
    const groups = groupEntries(
      [
        entry({ id: "c1", agent: "claude", modified: 5 }),
        entry({ id: "x1", agent: "codex", modified: 50 }),
        entry({ id: "c2", agent: "claude", modified: 9 }),
      ],
      "agent",
    );
    // Codex group is first (its newest entry, t=50, beats claude's t=9).
    expect(groups.map((g) => g.key)).toEqual(["codex", "claude"]);
    const claude = groups.find((g) => g.key === "claude");
    expect(claude?.label).toBe("Claude Code");
    expect(claude?.accent).toBe("claude");
    expect(claude?.entries.map((e) => e.id)).toEqual(["c2", "c1"]);
    expect(claude?.hideCwd).toBe(false);
  });

  it("Cursor → uses the registered display label and accent", () => {
    const groups = groupEntries([entry({ id: "cursor:c1", agent: "cursor" })], "agent");
    expect(groups[0]).toMatchObject({ key: "cursor", label: "Cursor Agent", accent: "cursor" });
  });

  it("Folder → group per cwd, leaf label, cwd chip suppressed", () => {
    const groups = groupEntries(
      [
        entry({ id: "a", cwd: "/work/anywhere-terminal", modified: 100 }),
        entry({ id: "b", cwd: "/work/bootstrap-agent", modified: 40 }),
        entry({ id: "c", cwd: "/work/anywhere-terminal", modified: 60 }),
      ],
      "folder",
    );
    expect(groups.map((g) => g.label)).toEqual(["anywhere-terminal", "bootstrap-agent"]);
    expect(groups[0].hideCwd).toBe(true);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupEntries([], "agent")).toEqual([]);
    expect(groupEntries([], "recent")).toEqual([
      { mode: "recent", key: "recent", label: "", hideCwd: false, entries: [] },
    ]);
  });

  it("falls back to the raw agent id as label for an unknown agent", () => {
    const groups = groupEntries([entry({ id: "z", agent: "mystery" })], "agent");
    expect(groups[0].label).toBe("mystery");
    expect(groups[0].accent).toBeUndefined();
  });
});
