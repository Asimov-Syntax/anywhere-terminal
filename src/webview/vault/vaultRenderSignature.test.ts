// src/webview/vault/vaultRenderSignature.test.ts — the no-op render guard's key
// (cache-vault-load 5_1 / D6).

import { describe, expect, it } from "vitest";
import type { VaultSessionEntry } from "../../vault/types";
import { entriesSignature } from "./vaultRenderSignature";

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:c1",
    agent: "claude",
    sessionId: "c1",
    title: "hello",
    cwd: "/work",
    modified: 100,
    flags: { model: "opus" },
    canFork: false,
    ...over,
  };
}

describe("entriesSignature", () => {
  it("is equal for identical lists", () => {
    expect(entriesSignature([entry(), entry({ id: "codex:x1", agent: "codex" })])).toBe(
      entriesSignature([entry(), entry({ id: "codex:x1", agent: "codex" })]),
    );
  });

  it("is empty for an empty list and differs from a non-empty list", () => {
    expect(entriesSignature([])).toBe("");
    expect(entriesSignature([])).not.toBe(entriesSignature([entry()]));
  });

  it("changes when canFork flips (would otherwise be masked)", () => {
    expect(entriesSignature([entry({ canFork: false })])).not.toBe(entriesSignature([entry({ canFork: true })]));
  });

  it("changes when selected resume capability is explicitly disabled", () => {
    const disabled = entriesSignature([entry({ canResume: false })]);
    expect(entriesSignature([entry()])).not.toBe(disabled);
    expect(entriesSignature([entry({ canResume: true })])).not.toBe(disabled);
  });

  it("changes when cwd changes (affects the folder filter)", () => {
    expect(entriesSignature([entry({ cwd: "/a" })])).not.toBe(entriesSignature([entry({ cwd: "/b" })]));
  });

  it("changes when title, modified, sessionPath, or flags change", () => {
    const base = entriesSignature([entry()]);
    expect(entriesSignature([entry({ title: "other" })])).not.toBe(base);
    expect(entriesSignature([entry({ modified: 999 })])).not.toBe(base);
    expect(entriesSignature([entry({ sessionPath: "/p.jsonl" })])).not.toBe(base);
    expect(entriesSignature([entry({ flags: { model: "sonnet" } })])).not.toBe(base);
  });

  it("changes when customName is set/cleared (a rename-only delta must re-render)", () => {
    const base = entriesSignature([entry()]);
    expect(entriesSignature([entry({ customName: "My session" })])).not.toBe(base);
    // Two different custom names differ; clearing returns to the base signature.
    expect(entriesSignature([entry({ customName: "A" })])).not.toBe(entriesSignature([entry({ customName: "B" })]));
    expect(entriesSignature([entry({ customName: undefined })])).toBe(base);
  });

  it("changes when gitBranch changes (drives the header chip)", () => {
    const base = entriesSignature([entry()]);
    expect(entriesSignature([entry({ gitBranch: "main" })])).not.toBe(base);
    expect(entriesSignature([entry({ gitBranch: "main" })])).not.toBe(entriesSignature([entry({ gitBranch: "dev" })]));
  });

  it("changes when source changes (drives Cursor badges and capability-gated actions)", () => {
    const base = entriesSignature([entry()]);
    expect(entriesSignature([entry({ source: "cli" })])).not.toBe(base);
    expect(entriesSignature([entry({ source: "ide" })])).not.toBe(entriesSignature([entry({ source: "cli" })]));
  });

  it("changes when the order changes", () => {
    const a = entry({ id: "claude:c1" });
    const b = entry({ id: "codex:x1", agent: "codex" });
    expect(entriesSignature([a, b])).not.toBe(entriesSignature([b, a]));
  });

  it("does not collide across field boundaries", () => {
    // ["ab", ""] vs ["a", "b"] must not produce the same signature.
    expect(entriesSignature([entry({ id: "ab", agent: "" })])).not.toBe(
      entriesSignature([entry({ id: "a", agent: "b" })]),
    );
  });
});
