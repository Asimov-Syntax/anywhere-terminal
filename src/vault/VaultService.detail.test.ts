// src/vault/VaultService.detail.test.ts — getDetail dispatch + unreadable reasons (redesign-vault-panel-ui 2_5).

import { describe, expect, it, vi } from "vitest";
import type { ReaderResultWithState } from "./cacheTypes";
import type { RecordLineResult } from "./readers/recordLine";
import type { VaultSessionDetail } from "./types";
import { type VaultDetailReaders, type VaultReaders, type VaultRecordReaders, VaultService } from "./VaultService";

/** A reader result with the (empty) cache state the incremental contract requires. */
function readerResult(entries: ReaderResultWithState["entries"], unreadable = 0): ReaderResultWithState {
  return { entries, unreadable, cache: { kind: "store", sources: {}, entries, unreadable } };
}

function detail(entryId: string): VaultSessionDetail {
  return { entryId, recentActivity: [], timeline: [], stats: { messageCount: 0, toolCount: 0, subagentCount: 0 } };
}

function emptyReaders(over: Partial<VaultReaders> = {}): VaultReaders {
  const empty = async (): Promise<ReaderResultWithState> => readerResult([]);
  return { claude: empty, codex: empty, opencode: empty, cursor: empty, ...over };
}

function makeDetailReaders(over: Partial<VaultDetailReaders> = {}): VaultDetailReaders {
  const none = vi.fn(async () => null);
  return { claude: none, codex: none, opencode: none, cursor: none, ...over };
}

describe("VaultService.getDetail", () => {
  it("dispatches to the agent's detail reader with the bare session id", async () => {
    const claude = vi.fn(async (id: string) => detail(`claude:${id}`));
    const svc = new VaultService({ detailReaders: makeDetailReaders({ claude }) });

    const result = await svc.getDetail("claude:abc-123");
    expect(claude).toHaveBeenCalledWith("abc-123", undefined);
    expect(result?.entryId).toBe("claude:abc-123");
  });

  it("routes codex and opencode ids to their readers", async () => {
    const codex = vi.fn(async (id: string) => detail(`codex:${id}`));
    const opencode = vi.fn(async (id: string) => detail(`opencode:${id}`));
    const svc = new VaultService({ detailReaders: makeDetailReaders({ codex, opencode }) });

    await svc.getDetail("codex:x1");
    await svc.getDetail("opencode:ses_9");
    expect(codex).toHaveBeenCalledWith("x1", undefined);
    expect(opencode).toHaveBeenCalledWith("ses_9", undefined);
  });

  it("preserves a session id that itself contains a colon", async () => {
    const opencode = vi.fn(async (id: string) => detail(`opencode:${id}`));
    const svc = new VaultService({ detailReaders: makeDetailReaders({ opencode }) });
    await svc.getDetail("opencode:ses:with:colons");
    expect(opencode).toHaveBeenCalledWith("ses:with:colons", undefined);
  });

  it("forwards the timeline limit to the reader (incremental load-more)", async () => {
    const claude = vi.fn(async (id: string) => detail(`claude:${id}`));
    const svc = new VaultService({ detailReaders: makeDetailReaders({ claude }) });
    await svc.getDetail("claude:abc", 800);
    expect(claude).toHaveBeenCalledWith("abc", 800);
  });

  it("clamps a garbage or oversized limit so it can't disable the bound (W2)", async () => {
    const claude = vi.fn(async (id: string, _limit?: number) => detail(`claude:${id}`));
    const svc = new VaultService({ detailReaders: makeDetailReaders({ claude }) });
    await svc.getDetail("claude:a", Number.POSITIVE_INFINITY);
    await svc.getDetail("claude:a", Number.NaN);
    await svc.getDetail("claude:a", -10);
    await svc.getDetail("claude:a", 999999);
    expect(claude.mock.calls.map((c) => c[1])).toEqual([undefined, undefined, undefined, 5000]);
  });

  it("returns null for an unknown agent or a malformed id", async () => {
    const svc = new VaultService({ detailReaders: makeDetailReaders() });
    expect(await svc.getDetail("mystery:1")).toBeNull();
    expect(await svc.getDetail("nocolon")).toBeNull();
    expect(await svc.getDetail("claude:")).toBeNull();
  });
});

describe("VaultService.list: unreadable.reasons", () => {
  it("aggregates per-source skip reasons with the count", async () => {
    const readers = emptyReaders({
      claude: async () => readerResult([], 2),
      codex: async () => readerResult([], 1),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });
    const { unreadable } = await svc.list();
    expect(unreadable.count).toBe(3);
    expect(unreadable.reasons).toEqual([
      "Claude Code: 2 sessions couldn't be read",
      "Codex: 1 session couldn't be read",
    ]);
  });

  it("reports a whole reader failing as its own reason", async () => {
    const readers = emptyReaders({
      opencode: async () => {
        throw new Error("db locked");
      },
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });
    const { unreadable } = await svc.list();
    expect(unreadable.count).toBe(1);
    expect(unreadable.reasons).toEqual(["OpenCode: reader failed"]);
  });

  it("has no reasons when nothing was unreadable", async () => {
    const svc = new VaultService({ readers: emptyReaders(), canForkOpenCodeFn: async () => false });
    const { unreadable } = await svc.list();
    expect(unreadable).toEqual({ count: 0, reasons: [] });
  });
});

// improve-vault-transcript-messages 3_2 — the Raw-copy round-trip.
describe("VaultService.readMessageRecord", () => {
  function makeRecordReaders(over: Partial<VaultRecordReaders> = {}): VaultRecordReaders {
    const none = vi.fn(async (): Promise<RecordLineResult> => ({ ok: false, reason: "not-found" }));
    return { claude: none, codex: none, opencode: none, cursor: none, ...over };
  }

  it("dispatches to the agent's record reader with the bare session id and the locator", async () => {
    const claude = vi.fn(async (): Promise<RecordLineResult> => ({ ok: true, line: '{"uuid":"u-1"}' }));
    const svc = new VaultService({ recordReaders: makeRecordReaders({ claude }) });

    expect(await svc.readMessageRecord("claude:abc-123", "u-1")).toEqual({ ok: true, line: '{"uuid":"u-1"}' });
    expect(claude).toHaveBeenCalledWith("abc-123", "u-1");
  });

  it("routes codex and opencode ids to their own readers", async () => {
    const codex = vi.fn(async (): Promise<RecordLineResult> => ({ ok: true, line: "codex-line" }));
    const opencode = vi.fn(async (): Promise<RecordLineResult> => ({ ok: true, line: "oc-row" }));
    const svc = new VaultService({ recordReaders: makeRecordReaders({ codex, opencode }) });

    expect(await svc.readMessageRecord("codex:t1", "#4")).toEqual({ ok: true, line: "codex-line" });
    expect(await svc.readMessageRecord("opencode:s1", "m2")).toEqual({ ok: true, line: "oc-row" });
    expect(codex).toHaveBeenCalledWith("t1", "#4");
    expect(opencode).toHaveBeenCalledWith("s1", "m2");
  });

  it("passes an oversized record through as a refusal, not as content", async () => {
    const claude = vi.fn(async (): Promise<RecordLineResult> => ({ ok: false, reason: "too-large" }));
    const svc = new VaultService({ recordReaders: makeRecordReaders({ claude }) });
    expect(await svc.readMessageRecord("claude:abc", "u-1")).toEqual({ ok: false, reason: "too-large" });
  });

  it("reports not-found for an unknown agent without consulting any reader", async () => {
    const claude = vi.fn(async (): Promise<RecordLineResult> => ({ ok: true, line: "x" }));
    const svc = new VaultService({ recordReaders: makeRecordReaders({ claude }) });
    expect(await svc.readMessageRecord("gemini:abc", "u-1")).toEqual({ ok: false, reason: "not-found" });
    expect(claude).not.toHaveBeenCalled();
  });
});
