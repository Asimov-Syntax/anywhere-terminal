// src/vault/VaultService.test.ts — Unit tests for aggregation + fork resolution.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ReaderListCache,
  type ReaderResultWithState,
  VAULT_CACHE_VERSION,
  type VaultListCacheFileV1,
} from "./cacheTypes";
import { __resetForkSupportCache, canForkOpenCode, gte, parseFirstSemver } from "./forkSupport";
import type { CursorDetailReaderOptions } from "./readers/cursorReader";
import type { VaultSessionDetail, VaultSessionEntry } from "./types";
import type { VaultCacheStore } from "./VaultCacheStore";
import {
  MAX_PENDING_VAULT_REFRESH_PATHS,
  type VaultEntryReaders,
  type VaultReaders,
  VaultService,
} from "./VaultService";

function entry(agent: string, sessionId: string, modified: number): VaultSessionEntry {
  return {
    id: `${agent}:${sessionId}`,
    agent,
    sessionId,
    title: sessionId,
    cwd: "/x",
    modified,
    flags: {},
    canFork: false,
  };
}

function result(entries: VaultSessionEntry[], unreadable = 0): ReaderResultWithState {
  return { entries, unreadable, cache: { kind: "store", sources: {}, entries, unreadable } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function makeReaders(overrides: Partial<VaultReaders> = {}): VaultReaders {
  return {
    claude: vi.fn(async () => result([])),
    codex: vi.fn(async () => result([])),
    opencode: vi.fn(async () => result([])),
    cursor: vi.fn(async () => result([])),
    ...overrides,
  };
}

function makeEntryReaders(overrides: Partial<VaultEntryReaders> = {}): VaultEntryReaders {
  return {
    claude: vi.fn(async () => null),
    codex: vi.fn(async () => null),
    opencode: vi.fn(async () => null),
    cursor: vi.fn(async () => null),
    ...overrides,
  };
}

describe("VaultService.list: aggregation", () => {
  it("merges entries from all readers sorted by modified desc", async () => {
    const readers = makeReaders({
      claude: async () => result([entry("claude", "c1", 100)]),
      codex: async () => result([entry("codex", "x1", 300)]),
      opencode: async () => result([entry("opencode", "o1", 200)]),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => true });
    const { entries } = await svc.list();
    expect(entries.map((e) => e.id)).toEqual(["codex:x1", "opencode:o1", "claude:c1"]);
  });

  it("sums unreadable across readers", async () => {
    const readers = makeReaders({
      claude: async () => result([entry("claude", "c1", 1)], 2),
      codex: async () => result([], 1),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });
    const { unreadable } = await svc.list();
    expect(unreadable.count).toBe(3);
  });

  it("a reader that throws contributes 0 entries + 1 unreadable, others survive", async () => {
    const readers = makeReaders({
      claude: async () => {
        throw new Error("reader blew up");
      },
      codex: async () => result([entry("codex", "x1", 5)]),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });
    const { entries, unreadable } = await svc.list();
    expect(entries.map((e) => e.id)).toEqual(["codex:x1"]);
    expect(unreadable.count).toBe(1);
  });

  it("a reader that throws synchronously does not abort aggregation", async () => {
    const readers = makeReaders({
      claude: () => {
        throw new Error("sync reader blew up");
      },
      codex: async () => result([entry("codex", "x1", 5)]),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });
    const { entries, unreadable } = await svc.list();
    expect(entries.map((e) => e.id)).toEqual(["codex:x1"]);
    expect(unreadable.count).toBe(1);
  });
});

describe("VaultService.list: fork resolution", () => {
  it("claude + codex are forkable (forkCommand present, no version gate)", async () => {
    const readers = makeReaders({
      claude: async () => result([entry("claude", "c1", 2)]),
      codex: async () => result([entry("codex", "x1", 1)]),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });
    const { entries } = await svc.list();
    expect(entries.every((e) => e.canFork)).toBe(true);
  });

  it("opencode canFork follows the version probe (true)", async () => {
    const readers = makeReaders({ opencode: async () => result([entry("opencode", "o1", 1)]) });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => true });
    const { entries } = await svc.list();
    expect(entries[0].canFork).toBe(true);
  });

  it("opencode canFork is false when the probe says so", async () => {
    const probe = vi.fn(async () => false);
    const readers = makeReaders({ opencode: async () => result([entry("opencode", "o1", 1)]) });
    const svc = new VaultService({ readers, canForkOpenCodeFn: probe });
    const { entries } = await svc.list();
    expect(entries[0].canFork).toBe(false);
    expect(probe).toHaveBeenCalledWith("1.1.54");
  });

  it("opencode canFork is false when the probe rejects", async () => {
    const probe = vi.fn(async () => {
      throw new Error("probe failed");
    });
    const readers = makeReaders({ opencode: async () => result([entry("opencode", "o1", 1)]) });
    const svc = new VaultService({ readers, canForkOpenCodeFn: probe });
    const { entries } = await svc.list();
    expect(entries[0].canFork).toBe(false);
  });

  it("does NOT spawn the opencode probe when there are no opencode entries", async () => {
    const probe = vi.fn(async () => true);
    const readers = makeReaders({ claude: async () => result([entry("claude", "c1", 1)]) });
    const svc = new VaultService({ readers, canForkOpenCodeFn: probe });
    await svc.list();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("VaultService.getEntry: single-entry resolve", () => {
  it("resolves ONLY the matching agent's reader (others not called) — the fast launch path", async () => {
    const claude = vi.fn(async () => entry("claude", "c1", 1));
    const codex = vi.fn(async () => null);
    const opencode = vi.fn(async () => null);
    const cursor = vi.fn(async () => null);
    const svc = new VaultService({
      entryReaders: { claude, codex, opencode, cursor },
      canForkOpenCodeFn: async () => false,
    });
    const e = await svc.getEntry("claude:c1");
    expect(e?.id).toBe("claude:c1");
    expect(claude).toHaveBeenCalledWith("c1");
    expect(codex).not.toHaveBeenCalled();
    expect(opencode).not.toHaveBeenCalled();
    expect(cursor).not.toHaveBeenCalled();
  });

  it("says absent for an id no store could carry — an unknown agent or a malformed id", async () => {
    // The two the service itself decides, before any reader is consulted.
    const svc = new VaultService({ entryReaders: makeEntryReaders(), canForkOpenCodeFn: async () => false });
    for (const id of ["bogus:x", "no-colon"]) {
      expect(await svc.lookupEntry(id)).toEqual({ status: "absent" });
      expect(await svc.getEntry(id)).toBeNull();
    }
  });

  it("still rejects a synthetic nesting id, which vault-session-launch requires", async () => {
    // Its status stays `unknown` until the reader tasks classify their own safety
    // check; what the accepted requirement pins is the null, and that is unchanged.
    const svc = new VaultService({ entryReaders: makeEntryReaders(), canForkOpenCodeFn: async () => false });
    for (const id of ["claude:c1:subagent:2", "claude:m1:turn:3"]) {
      expect(await svc.getEntry(id)).toBeNull();
    }
  });

  it("says unknown — not absent — when a reader could not resolve the session", async () => {
    // The wrapped legacy seam is nullable, and a null there has never been proof
    // of anything. Reporting `absent` would let a consumer retire a live row.
    const svc = new VaultService({
      entryReaders: makeEntryReaders({ codex: vi.fn(async () => null) }),
      canForkOpenCodeFn: async () => false,
    });
    expect(await svc.lookupEntry("codex:missing")).toEqual({ status: "unknown" });
    expect(await svc.getEntry("codex:missing")).toBeNull();
  });

  it("says unknown for a cursor child locator this process cannot decode", async () => {
    // The locator registry is per-process and evicts its oldest key on capacity,
    // so a miss can be a restart or an eviction while the transcript still exists.
    const cursor = vi.fn(async () => null);
    const svc = new VaultService({
      entryReaders: makeEntryReaders({ cursor }),
      canForkOpenCodeFn: async () => false,
    });
    expect(await svc.lookupEntry("cursor:child:never-issued")).toEqual({ status: "unknown" });
    expect(cursor).not.toHaveBeenCalled();
  });

  it("carries the enriched entry on the found branch", async () => {
    const svc = new VaultService({
      entryReaders: makeEntryReaders({ opencode: vi.fn(async () => entry("opencode", "o1", 1)) }),
      canForkOpenCodeFn: async () => true,
    });
    const found = await svc.lookupEntry("opencode:o1");
    expect(found.status).toBe("found");
    expect(found.status === "found" && found.entry.canFork).toBe(true);
  });

  it("returns null for an unknown agent or a malformed id", async () => {
    const svc = new VaultService({ entryReaders: makeEntryReaders(), canForkOpenCodeFn: async () => false });
    expect(await svc.getEntry("bogus:x")).toBeNull();
    expect(await svc.getEntry("no-colon")).toBeNull();
  });

  it("returns null when the agent reader can't resolve the session", async () => {
    const svc = new VaultService({
      entryReaders: makeEntryReaders({ codex: vi.fn(async () => null) }),
      canForkOpenCodeFn: async () => false,
    });
    expect(await svc.getEntry("codex:missing")).toBeNull();
  });

  it("resolves canFork for claude WITHOUT spawning the opencode probe", async () => {
    const probe = vi.fn(async () => true);
    const svc = new VaultService({
      entryReaders: makeEntryReaders({ claude: vi.fn(async () => entry("claude", "c1", 1)) }),
      canForkOpenCodeFn: probe,
    });
    const e = await svc.getEntry("claude:c1");
    expect(e?.canFork).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it("opencode canFork follows the probe (and only opencode triggers it)", async () => {
    const probe = vi.fn(async () => true);
    const svc = new VaultService({
      entryReaders: makeEntryReaders({ opencode: vi.fn(async () => entry("opencode", "o1", 1)) }),
      canForkOpenCodeFn: probe,
    });
    const e = await svc.getEntry("opencode:o1");
    expect(e?.canFork).toBe(true);
    expect(probe).toHaveBeenCalledWith("1.1.54");
  });

  it("opencode canFork is false when the probe says so", async () => {
    const svc = new VaultService({
      entryReaders: makeEntryReaders({ opencode: vi.fn(async () => entry("opencode", "o1", 1)) }),
      canForkOpenCodeFn: async () => false,
    });
    const e = await svc.getEntry("opencode:o1");
    expect(e?.canFork).toBe(false);
  });
});

describe("VaultService.getLaunchTarget: D14 explicit proof, resolved once", () => {
  const cursorTarget = (sessionId: string) => ({
    entry: entry("cursor", sessionId, 1),
    dbPath: `/chats/bucket/${sessionId}/store.db`,
  });

  it("proves the Cursor target the resolver returned, without re-resolving it", async () => {
    const resolve = vi.fn(async (sessionId: string) => cursorTarget(sessionId));
    const verify = vi.fn(async () => true);
    const svc = new VaultService({ resolveCursorLaunchTargetFn: resolve, verifyCursorLaunchTargetFn: verify });

    const target = await svc.getLaunchTarget("cursor:chat-1");
    await expect(target?.verify()).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledExactlyOnceWith("chat-1", {});
    expect(verify).toHaveBeenCalledWith({ entry: target?.entry, dbPath: "/chats/bucket/chat-1/store.db" }, {});
  });

  it("rejects a mismatched or unavailable Cursor store identity", async () => {
    const svc = new VaultService({
      resolveCursorLaunchTargetFn: async (sessionId: string) => cursorTarget(sessionId),
      verifyCursorLaunchTargetFn: vi.fn(async () => false),
    });
    const target = await svc.getLaunchTarget("cursor:chat-1");
    await expect(target?.verify()).resolves.toBe(false);
  });

  it("returns nothing when the Cursor candidate does not resolve", async () => {
    const svc = new VaultService({ resolveCursorLaunchTargetFn: async () => null });
    await expect(svc.getLaunchTarget("cursor:chat-missing")).resolves.toBeNull();
  });

  it("passes through non-Cursor entries without invoking the Cursor resolver", async () => {
    const resolve = vi.fn(async () => null);
    const svc = new VaultService({
      entryReaders: makeEntryReaders({ claude: vi.fn(async () => entry("claude", "session-1", 1)) }),
      resolveCursorLaunchTargetFn: resolve,
    });
    const target = await svc.getLaunchTarget("claude:session-1");
    await expect(target?.verify()).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });
});

/** B14: a child transcript is reachable only through a locator this process
 *  issued with a parent detail — never by naming its project id on the wire. */
describe("VaultService: Cursor child-transcript locators", () => {
  const CHILD_PROJECT_ID = "project:cHJvamVjdC0x:child-1";

  /** Stands in for the real Cursor detail decoder: a parent read emits one child
   *  stub through whatever issuer the service supplied; a child read echoes the
   *  id it was opened with. */
  function cursorDetailStub(children: Array<{ childAgentId: string; projectSessionId: string }> = []) {
    const reads: string[] = [];
    const fn = vi.fn(
      async (
        sessionId: string,
        _limit: number | undefined,
        options: CursorDetailReaderOptions,
      ): Promise<VaultSessionDetail> => {
        reads.push(sessionId);
        return {
          entryId: `cursor:${sessionId}`,
          recentActivity: [],
          timeline: children.map((child) => ({
            kind: "subagentSession" as const,
            entryId: `cursor:${options.issueChildLocator?.({ parentSessionId: sessionId, ...child }) ?? "unissued"}`,
            title: child.childAgentId,
          })),
          stats: { messageCount: 0, toolCount: 0, subagentCount: children.length },
          partial: false,
          contentKind: "timeline",
        };
      },
    );
    return { fn, reads };
  }

  async function issuedChildId(svc: VaultService, parentEntryId = "cursor:parent-1"): Promise<string | undefined> {
    const parent = await svc.getDetail(parentEntryId);
    const item = parent?.timeline[0];
    return item && item.kind === "subagentSession" ? item.entryId : undefined;
  }

  it("issues an opaque locator that resolves to the child transcript", async () => {
    const stub = cursorDetailStub([{ childAgentId: "child-1", projectSessionId: CHILD_PROJECT_ID }]);
    const svc = new VaultService({ readCursorDetailFn: stub.fn });

    const childId = await issuedChildId(svc);
    expect(childId).toMatch(/^cursor:child:[0-9a-f]{32}$/);
    expect(childId).not.toContain("project");

    const child = await svc.getDetail(childId ?? "");
    // The locator is what the caller asked for, so it stays the answer's identity.
    expect(child?.entryId).toBe(childId);
    expect(stub.reads).toEqual(["parent-1", CHILD_PROJECT_ID]);
  });

  it("refuses a locator it never issued and a raw project id", async () => {
    const stub = cursorDetailStub([{ childAgentId: "child-1", projectSessionId: CHILD_PROJECT_ID }]);
    const svc = new VaultService({
      readCursorDetailFn: stub.fn,
      entryReaders: makeEntryReaders({ cursor: vi.fn(async () => entry("cursor", "child-1", 1)) }),
    });
    await issuedChildId(svc);
    stub.reads.length = 0;

    await expect(svc.getDetail(`cursor:child:${"0".repeat(32)}`)).resolves.toBeNull();
    await expect(svc.getDetail(`cursor:${CHILD_PROJECT_ID}`)).resolves.toBeNull();
    await expect(svc.getEntry(`cursor:${CHILD_PROJECT_ID}`)).resolves.toBeNull();
    expect(stub.reads).toEqual([]);
  });

  it("re-issues the same locator when the parent detail is re-read", async () => {
    const stub = cursorDetailStub([{ childAgentId: "child-1", projectSessionId: CHILD_PROJECT_ID }]);
    const svc = new VaultService({ readCursorDetailFn: stub.fn });
    expect(await issuedChildId(svc)).toBe(await issuedChildId(svc));
  });

  it("gives two parents distinct locators for the same child agent id", async () => {
    const stub = cursorDetailStub([{ childAgentId: "child-1", projectSessionId: CHILD_PROJECT_ID }]);
    const svc = new VaultService({ readCursorDetailFn: stub.fn });
    expect(await issuedChildId(svc, "cursor:parent-1")).not.toBe(await issuedChildId(svc, "cursor:parent-2"));
  });

  it("evicts the oldest locators past the registry bound", async () => {
    const stub = cursorDetailStub([{ childAgentId: "child-1", projectSessionId: CHILD_PROJECT_ID }]);
    const svc = new VaultService({ readCursorDetailFn: stub.fn });

    const first = await issuedChildId(svc, "cursor:parent-0");
    for (let index = 1; index <= 256; index++) {
      await issuedChildId(svc, `cursor:parent-${index}`);
    }
    await expect(svc.getDetail(first ?? "")).resolves.toBeNull();

    const last = await issuedChildId(svc, "cursor:parent-256");
    await expect(svc.getDetail(last ?? "")).resolves.not.toBeNull();
  });
});

describe("VaultService cache: listCached + refresh", () => {
  function makeCacheStore(initial: VaultListCacheFileV1 | null = null) {
    let stored = initial;
    const store = {
      load: vi.fn(() => stored),
      save: vi.fn(async (doc: VaultListCacheFileV1) => {
        stored = doc;
      }),
    };
    return {
      store,
      get current() {
        return stored;
      },
    };
  }

  function cacheDoc(entries: VaultSessionEntry[]): VaultListCacheFileV1 {
    return {
      version: VAULT_CACHE_VERSION,
      savedAt: 1,
      agents: {},
      entries,
      unreadable: { count: 0, reasons: [] },
    };
  }

  it("listCached returns null without a cache store", () => {
    const svc = new VaultService({ readers: makeReaders(), canForkOpenCodeFn: async () => false });
    expect(svc.listCached()).toBeNull();
  });

  it("listCached serves the persisted list (loaded once)", () => {
    const { store } = makeCacheStore(cacheDoc([entry("claude", "c1", 7)]));
    const svc = new VaultService({
      readers: makeReaders(),
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });
    expect(svc.listCached()?.entries.map((e) => e.id)).toEqual(["claude:c1"]);
    svc.listCached();
    expect(store.load).toHaveBeenCalledTimes(1); // lazy-loaded once, then memoized
  });

  it("refresh persists the merged+sorted doc and returns it", async () => {
    const { store, current } = makeCacheStore(null);
    const readers = makeReaders({
      claude: async () => result([entry("claude", "c1", 100)]),
      codex: async () => result([entry("codex", "x1", 300)]),
    });
    const svc = new VaultService({
      readers,
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });
    const { entries } = await svc.refresh();
    expect(entries.map((e) => e.id)).toEqual(["codex:x1", "claude:c1"]);
    expect(store.save).toHaveBeenCalledTimes(1);
    // After refresh, listCached serves the freshly persisted list.
    expect(svc.listCached()?.entries.map((e) => e.id)).toEqual(["codex:x1", "claude:c1"]);
    void current;
  });

  it("a second refresh feeds each reader its prior per-agent cache (incremental)", async () => {
    const claude = vi.fn(async (_prev?: ReaderListCache) => result([entry("claude", "c1", 1)]));
    const { store } = makeCacheStore(null);
    const svc = new VaultService({
      readers: makeReaders({ claude }),
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });
    await svc.refresh();
    await svc.refresh();
    // First call: no prior cache (undefined). Second: the cache the reader returned
    // last time, carried back as `prev` (canFork already resolved on the entry).
    expect(claude.mock.calls[0][0]).toBeUndefined();
    const prev = claude.mock.calls[1][0];
    expect(prev?.kind).toBe("store");
    expect(prev?.kind === "store" && prev.entries.map((e) => e.id)).toEqual(["claude:c1"]);
  });

  it("targets only the hinted reader and carries untouched cached segments + unreadable state", async () => {
    const claude = vi.fn(async () => result([entry("claude", "c1", 30)], 2));
    const codex = vi.fn(async () => result([entry("codex", "x1", 20)]));
    const opencode = vi.fn(async () => result([entry("opencode", "o1", 10)]));
    const cursor = vi.fn(async () => result([entry("cursor", "chat-old", 1)]));
    const cache = makeCacheStore(null);
    const svc = new VaultService({
      readers: { claude, codex, opencode, cursor },
      canForkOpenCodeFn: async () => false,
      cacheStore: cache.store as unknown as VaultCacheStore,
    });
    const seeded = await svc.refresh();
    const priorClaudeCache = cache.current?.agents.claude;
    claude.mockClear();
    codex.mockClear();
    opencode.mockClear();
    cursor.mockClear();
    cursor.mockResolvedValue(result([entry("cursor", "chat-new", 40)]));

    const refreshed = await svc.refresh({
      hint: { agent: "cursor", paths: ["/cursor/a/chat-new/meta.json"] },
    });

    expect(cursor).toHaveBeenCalledWith(expect.anything(), { paths: ["/cursor/a/chat-new/meta.json"] });
    expect(claude).not.toHaveBeenCalled();
    expect(codex).not.toHaveBeenCalled();
    expect(opencode).not.toHaveBeenCalled();
    expect(refreshed.entries.map((e) => e.id)).toEqual(["cursor:chat-new", "claude:c1", "codex:x1", "opencode:o1"]);
    expect(refreshed.unreadable).toEqual(seeded.unreadable);
    expect(cache.current?.agents.claude).toBe(priorClaudeCache);
    expect(cache.current?.entries.map((e) => e.id)).toEqual(refreshed.entries.map((e) => e.id));
  });

  it("promotes a cold hinted refresh to a complete read", async () => {
    const readers = makeReaders({
      claude: vi.fn(async () => result([entry("claude", "c1", 4)])),
      codex: vi.fn(async () => result([entry("codex", "x1", 3)])),
      opencode: vi.fn(async () => result([entry("opencode", "o1", 2)])),
      cursor: vi.fn(async () => result([entry("cursor", "chat", 1)])),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });

    const refreshed = await svc.refresh({
      hint: { agent: "cursor", paths: ["/cursor/a/chat/meta.json"] },
    });

    expect(refreshed.entries.map((e) => e.id)).toEqual(["claude:c1", "codex:x1", "opencode:o1", "cursor:chat"]);
    for (const reader of Object.values(readers)) {
      expect(reader).toHaveBeenCalledTimes(1);
      expect(vi.mocked(reader).mock.calls[0][1]).toBeUndefined();
    }
  });

  it("promotes an oversized pending path set to one complete refresh", async () => {
    const activeRead = deferred<ReaderResultWithState>();
    const cursor = vi
      .fn()
      .mockResolvedValueOnce(result([entry("cursor", "seed", 1)]))
      .mockImplementationOnce(() => activeRead.promise)
      .mockResolvedValueOnce(result([entry("cursor", "complete", 3)]));
    const readers = makeReaders({
      cursor,
      claude: vi.fn(async () => result([entry("claude", "complete", 2)])),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });
    await svc.refresh();
    for (const reader of Object.values(readers)) {
      vi.mocked(reader).mockClear();
    }

    const active = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/active/meta.json"] } });
    await Promise.resolve();
    const overflow = svc.refresh({
      hint: {
        agent: "cursor",
        paths: Array.from({ length: MAX_PENDING_VAULT_REFRESH_PATHS + 1 }, (_, index) => `/cursor/${index}/meta.json`),
      },
    });
    activeRead.resolve(result([entry("cursor", "active", 2)]));

    await active;
    const completed = await overflow;
    expect(completed.entries.map((e) => e.id)).toEqual(["cursor:complete", "claude:complete"]);
    expect(cursor).toHaveBeenCalledTimes(2);
    expect(cursor.mock.calls[1][1]).toBeUndefined();
    expect(readers.claude).toHaveBeenCalledTimes(1);
    expect(readers.codex).toHaveBeenCalledTimes(1);
    expect(readers.opencode).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate client delivery before I/O but retains a later same-path hint", async () => {
    const activeRead = deferred<ReaderResultWithState>();
    const cursor = vi
      .fn()
      .mockResolvedValueOnce(result([entry("cursor", "seed", 1)]))
      .mockImplementationOnce(() => activeRead.promise)
      .mockResolvedValueOnce(result([entry("cursor", "follow-up", 3)]));
    const svc = new VaultService({ readers: makeReaders({ cursor }), canForkOpenCodeFn: async () => false });
    await svc.refresh();
    cursor.mockClear();

    const hint = { agent: "cursor" as const, paths: ["/cursor/a/meta.json"] };
    const active = svc.refresh({ hint });
    const duplicateClient = svc.refresh({ hint });
    await Promise.resolve();
    const genuinelyLater = svc.refresh({ hint });
    activeRead.resolve(result([entry("cursor", "active", 2)]));

    const [activeResult, duplicateResult, laterResult] = await Promise.all([active, duplicateClient, genuinelyLater]);
    expect(duplicateResult).toEqual(activeResult);
    expect(laterResult.entries[0].id).toBe("cursor:follow-up");
    expect(cursor).toHaveBeenCalledTimes(2);
    expect(cursor.mock.calls[1][1]).toEqual({ paths: hint.paths });
  });

  it("retains a hint that arrives after its reader snapshots during a complete refresh", async () => {
    const completeClaude = deferred<ReaderResultWithState>();
    const cursor = vi
      .fn()
      .mockResolvedValueOnce(result([entry("cursor", "old", 1)]))
      .mockResolvedValueOnce(result([entry("cursor", "new", 3)]));
    const readers = makeReaders({
      cursor,
      claude: vi.fn(() => completeClaude.promise),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });

    const complete = svc.refresh();
    await vi.waitFor(() => expect(cursor).toHaveBeenCalledTimes(1));
    const hinted = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/new/meta.json"] } });
    completeClaude.resolve(result([entry("claude", "complete", 2)]));

    expect((await complete).entries.map((e) => e.id)).toEqual(["claude:complete", "cursor:old"]);
    expect((await hinted).entries.map((e) => e.id)).toEqual(["cursor:new", "claude:complete"]);
    expect(cursor).toHaveBeenCalledTimes(2);
    expect(cursor.mock.calls[1][1]).toEqual({ paths: ["/cursor/new/meta.json"] });
  });

  it("coalesces duplicate same-agent paths into one follow-up hinted refresh", async () => {
    const activeRead = deferred<ReaderResultWithState>();
    const cursor = vi
      .fn()
      .mockResolvedValueOnce(result([entry("cursor", "seed", 1)]))
      .mockImplementationOnce(() => activeRead.promise)
      .mockResolvedValueOnce(result([entry("cursor", "follow-up", 3)]));
    const readers = makeReaders({ cursor });
    const { store } = makeCacheStore(null);
    const svc = new VaultService({
      readers,
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });
    await svc.refresh();
    for (const reader of Object.values(readers)) {
      vi.mocked(reader).mockClear();
    }

    const active = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/a/meta.json"] } });
    await Promise.resolve();
    const queuedA = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/b/meta.json"] } });
    const queuedB = svc.refresh({
      hint: { agent: "cursor", paths: ["/cursor/b/meta.json", "/cursor/c/meta.json"] },
    });
    activeRead.resolve(result([entry("cursor", "active", 2)]));

    const [, followA, followB] = await Promise.all([active, queuedA, queuedB]);
    expect(cursor).toHaveBeenCalledTimes(2);
    expect(cursor.mock.calls[1][1]).toEqual({ paths: ["/cursor/b/meta.json", "/cursor/c/meta.json"] });
    expect(followA.entries[0].id).toBe("cursor:follow-up");
    expect(followB).toEqual(followA);
    expect(readers.claude).not.toHaveBeenCalled();
    expect(readers.codex).not.toHaveBeenCalled();
    expect(readers.opencode).not.toHaveBeenCalled();
  });

  it("queues arrivals behind a blocked hinted follow-up without overlapping persistence", async () => {
    const activeRead = deferred<ReaderResultWithState>();
    const followUpRead = deferred<ReaderResultWithState>();
    let activeReaders = 0;
    let maxActiveReaders = 0;
    const cursor = vi
      .fn()
      .mockImplementationOnce(async () => {
        activeReaders++;
        maxActiveReaders = Math.max(maxActiveReaders, activeReaders);
        const value = await activeRead.promise;
        activeReaders--;
        return value;
      })
      .mockImplementationOnce(async () => {
        activeReaders++;
        maxActiveReaders = Math.max(maxActiveReaders, activeReaders);
        const value = await followUpRead.promise;
        activeReaders--;
        return value;
      })
      .mockResolvedValueOnce(result([entry("cursor", "complete", 4)]));
    const readers = makeReaders({
      cursor,
      claude: vi.fn(async () => result([entry("claude", "complete", 3)])),
    });
    const { store } = makeCacheStore(cacheDoc([]));
    const svc = new VaultService({
      readers,
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });

    const active = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/a/meta.json"] } });
    const queued = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/b/meta.json"] } });
    activeRead.resolve(result([entry("cursor", "active", 1)]));
    await vi.waitFor(() => expect(cursor).toHaveBeenCalledTimes(2));

    const lateHint = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/c/meta.json"] } });
    const complete = svc.refresh();
    expect(cursor).toHaveBeenCalledTimes(2);
    followUpRead.resolve(result([entry("cursor", "follow-up", 2)]));

    expect((await active).entries[0].id).toBe("cursor:active");
    expect((await queued).entries[0].id).toBe("cursor:follow-up");
    const [lateResult, completeResult] = await Promise.all([lateHint, complete]);
    expect(lateResult.entries.map((e) => e.id)).toEqual(["cursor:complete", "claude:complete"]);
    expect(completeResult).toEqual(lateResult);
    expect(cursor).toHaveBeenCalledTimes(3);
    expect(cursor.mock.calls[2][1]).toBeUndefined();
    expect(maxActiveReaders).toBe(1);
  });

  it("promotes overlapping hints for different agents to one complete refresh", async () => {
    const activeRead = deferred<ReaderResultWithState>();
    const cursor = vi
      .fn()
      .mockResolvedValueOnce(result([entry("cursor", "seed", 1)]))
      .mockImplementationOnce(() => activeRead.promise)
      .mockResolvedValueOnce(result([entry("cursor", "complete", 4)]));
    const readers = makeReaders({
      cursor,
      claude: vi.fn(async () => result([entry("claude", "complete", 3)])),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });
    await svc.refresh();
    for (const reader of Object.values(readers)) {
      vi.mocked(reader).mockClear();
    }

    const active = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/a/meta.json"] } });
    await Promise.resolve();
    const overlapping = svc.refresh({ hint: { agent: "claude", paths: ["/claude/a.jsonl"] } });
    activeRead.resolve(result([entry("cursor", "active", 2)]));

    await active;
    const completed = await overlapping;
    expect(completed.entries.map((e) => e.id)).toEqual(["cursor:complete", "claude:complete"]);
    expect(readers.claude).toHaveBeenCalledTimes(1);
    expect(readers.codex).toHaveBeenCalledTimes(1);
    expect(readers.opencode).toHaveBeenCalledTimes(1);
    expect(cursor).toHaveBeenCalledTimes(2);
    expect(cursor.mock.calls[1][1]).toBeUndefined();
  });

  it("a complete caller drains an in-flight hinted refresh instead of joining it", async () => {
    const activeRead = deferred<ReaderResultWithState>();
    const cursor = vi
      .fn()
      .mockImplementationOnce(() => activeRead.promise)
      .mockResolvedValueOnce(result([entry("cursor", "complete", 2)]));
    const claude = vi.fn(async () => result([entry("claude", "complete", 3)]));
    const readers = makeReaders({ claude, cursor });
    const { store } = makeCacheStore(cacheDoc([]));
    const svc = new VaultService({
      readers,
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });

    const hinted = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/a/meta.json"] } });
    await Promise.resolve();
    const complete = svc.refresh();
    activeRead.resolve(result([entry("cursor", "hinted", 1)]));

    expect((await hinted).entries.map((e) => e.id)).toEqual(["cursor:hinted"]);
    expect((await complete).entries.map((e) => e.id)).toEqual(["claude:complete", "cursor:complete"]);
    expect(claude).toHaveBeenCalledTimes(1);
    expect(cursor).toHaveBeenCalledTimes(2);
  });

  it("single-flight: concurrent refresh calls share one read + one save", async () => {
    const claude = vi.fn(async () => result([entry("claude", "c1", 1)]));
    const { store } = makeCacheStore(null);
    const svc = new VaultService({
      readers: makeReaders({ claude }),
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });
    await Promise.all([svc.refresh(), svc.refresh()]);
    expect(claude).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("F1: a transient reader failure preserves that agent's last-cached entries + cache", async () => {
    let claudeOk = true;
    const claude = vi.fn(async (_prev?: ReaderListCache) => {
      if (!claudeOk) {
        throw new Error("transient fs error");
      }
      return result([entry("claude", "c1", 100)]);
    });
    const { store } = makeCacheStore(null);
    const svc = new VaultService({
      readers: makeReaders({ claude, codex: async () => result([entry("codex", "x1", 50)]) }),
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });
    await svc.refresh(); // first read succeeds → claude:c1 cached
    claudeOk = false;
    const res = await svc.refresh(); // claude reader now fails transiently
    // claude:c1 survives from the prior snapshot instead of vanishing; codex still reads fresh.
    expect(res.entries.map((e) => e.id).sort()).toEqual(["claude:c1", "codex:x1"]);
    expect(res.unreadable.reasons.some((r) => r.includes("showing last cached"))).toBe(true);
    // The persisted snapshot keeps the agent so the next open still shows it.
    expect(
      svc
        .listCached()
        ?.entries.map((e) => e.id)
        .sort(),
    ).toEqual(["claude:c1", "codex:x1"]);
  });

  it("F1: a reader failing on the FIRST read (nothing to carry) just surfaces unreadable", async () => {
    const { store } = makeCacheStore(null);
    const svc = new VaultService({
      readers: makeReaders({
        claude: async () => {
          throw new Error("boom");
        },
        codex: async () => result([entry("codex", "x1", 50)]),
      }),
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });
    const res = await svc.refresh();
    expect(res.entries.map((e) => e.id)).toEqual(["codex:x1"]);
    expect(res.unreadable.reasons.some((r) => r.includes("reader failed"))).toBe(true);
    expect(res.unreadable.reasons.some((r) => r.includes("showing last cached"))).toBe(false);
  });

  it("a save failure does not fail the refresh (fresh list still returned)", async () => {
    const store = {
      load: vi.fn(() => null),
      save: vi.fn(async () => {
        throw new Error("disk full");
      }),
    };
    const svc = new VaultService({
      readers: makeReaders({ claude: async () => result([entry("claude", "c1", 1)]) }),
      canForkOpenCodeFn: async () => false,
      cacheStore: store as unknown as VaultCacheStore,
    });
    const { entries } = await svc.refresh();
    expect(entries.map((e) => e.id)).toEqual(["claude:c1"]);
  });
});

describe("forkSupport helpers", () => {
  beforeEach(() => __resetForkSupportCache());

  it("parseFirstSemver extracts the first X.Y.Z", () => {
    expect(parseFirstSemver("opencode 1.14.50 (build)")).toEqual([1, 14, 50]);
    expect(parseFirstSemver("no version here")).toBeUndefined();
  });

  it("gte compares semvers", () => {
    expect(gte([1, 14, 50], [1, 14, 50])).toBe(true);
    expect(gte([1, 14, 51], [1, 14, 50])).toBe(true);
    expect(gte([1, 14, 49], [1, 14, 50])).toBe(false);
    expect(gte([2, 0, 0], [1, 99, 99])).toBe(true);
  });

  it("canForkOpenCode is true when the probe reports a high-enough version", async () => {
    const deps = { exec: vi.fn(async () => ({ stdout: "1.20.0", stderr: "" })) };
    expect(await canForkOpenCode("1.14.50", deps)).toBe(true);
  });

  it("canForkOpenCode is false for an older version", async () => {
    const deps = { exec: vi.fn(async () => ({ stdout: "1.10.0", stderr: "" })) };
    expect(await canForkOpenCode("1.14.50", deps)).toBe(false);
  });

  it("canForkOpenCode is false when the probe throws (binary missing)", async () => {
    const deps = {
      exec: vi.fn(async () => {
        throw new Error("not found");
      }),
    };
    expect(await canForkOpenCode("1.14.50", deps)).toBe(false);
  });
});

describe("VaultService.writeNativeTitle (write-vault-rename-to-store 3_1)", () => {
  it("dispatches opencode/codex to their native renamer and propagates the result", async () => {
    const opencode = vi.fn(async () => true);
    const codex = vi.fn(async () => false);
    const svc = new VaultService({ nativeRenamers: { opencode, codex } });

    expect(await svc.writeNativeTitle("opencode:o1", "Name")).toBe(true);
    expect(opencode).toHaveBeenCalledWith("o1", "Name");

    expect(await svc.writeNativeTitle("codex:x1", "Name")).toBe(false);
    expect(codex).toHaveBeenCalledWith("x1", "Name");
  });

  it("returns false for claude (no native renamer) without calling any writer", async () => {
    const opencode = vi.fn(async () => true);
    const svc = new VaultService({ nativeRenamers: { opencode } });
    expect(await svc.writeNativeTitle("claude:c1", "Name")).toBe(false);
    expect(opencode).not.toHaveBeenCalled();
  });

  it("returns false for an unparseable or unknown-agent entry id", async () => {
    const svc = new VaultService({ nativeRenamers: { opencode: vi.fn(async () => true) } });
    expect(await svc.writeNativeTitle("garbage-no-colon", "Name")).toBe(false);
    expect(await svc.writeNativeTitle("bogus:sess", "Name")).toBe(false);
  });

  it("normalizes the name (trim + cap) before dispatching, and rejects empty (review S1)", async () => {
    const opencode = vi.fn(async (_id: string, _name: string) => true);
    const svc = new VaultService({ nativeRenamers: { opencode } });

    expect(await svc.writeNativeTitle("opencode:o1", "   ")).toBe(false);
    expect(opencode).not.toHaveBeenCalled();

    await svc.writeNativeTitle("opencode:o1", `  ${"x".repeat(200)}  `);
    const written = opencode.mock.calls[0][1];
    expect(written).toHaveLength(80);
  });
});

describe("VaultService.refresh: force bypasses in-flight (write-vault-rename-to-store 3_2/D4)", () => {
  it("force refresh reads AFTER the in-flight refresh, never joining its pre-write result", async () => {
    let call = 0;
    const readers = makeReaders({
      claude: vi.fn(async () => {
        call++;
        return result([entry("claude", call === 1 ? "old" : "new", call)]);
      }),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });

    const p1 = svc.refresh({ hint: { agent: "claude", paths: ["/claude/old.jsonl"] } });
    const forced = await svc.refresh({ force: true }); // waits for hinted run1, then reads "new"
    expect(forced.entries.map((e) => e.sessionId)).toEqual(["new"]);

    const first = await p1;
    expect(first.entries.map((e) => e.sessionId)).toEqual(["old"]);
    expect(call).toBe(2);
  });

  it("force drains an active hinted read and its queued follow-up", async () => {
    const activeRead = deferred<ReaderResultWithState>();
    const queuedRead = deferred<ReaderResultWithState>();
    const claude = vi
      .fn()
      .mockImplementationOnce(() => activeRead.promise)
      .mockImplementationOnce(() => queuedRead.promise)
      .mockResolvedValueOnce(result([entry("claude", "forced", 3)]));
    const svc = new VaultService({ readers: makeReaders({ claude }), canForkOpenCodeFn: async () => false });

    const active = svc.refresh({ hint: { agent: "claude", paths: ["/claude/a.jsonl"] } });
    const queued = svc.refresh({ hint: { agent: "claude", paths: ["/claude/b.jsonl"] } });
    const forced = svc.refresh({ force: true });
    activeRead.resolve(result([entry("claude", "active", 1)]));
    await vi.waitFor(() => expect(claude).toHaveBeenCalledTimes(2));
    expect(claude).toHaveBeenCalledTimes(2);
    queuedRead.resolve(result([entry("claude", "queued", 2)]));

    expect((await active).entries[0].sessionId).toBe("active");
    expect((await queued).entries[0].sessionId).toBe("queued");
    expect((await forced).entries[0].sessionId).toBe("forced");
    expect(claude).toHaveBeenCalledTimes(3);
  });

  it("establishes a force barrier before draining sustained later hints", async () => {
    const activeRead = deferred<ReaderResultWithState>();
    const forcedRead = deferred<ReaderResultWithState>();
    const followUpRead = deferred<ReaderResultWithState>();
    const cursor = vi
      .fn()
      .mockResolvedValueOnce(result([entry("cursor", "seed", 0)]))
      .mockImplementationOnce(() => activeRead.promise)
      .mockImplementationOnce(() => forcedRead.promise)
      .mockImplementationOnce(() => followUpRead.promise);
    const svc = new VaultService({ readers: makeReaders({ cursor }), canForkOpenCodeFn: async () => false });
    await svc.refresh();
    cursor.mockClear();

    const active = svc.refresh({ hint: { agent: "cursor", paths: ["/cursor/active/meta.json"] } });
    await Promise.resolve();
    const forced = svc.refresh({ force: true });
    const earlyHints = Array.from({ length: 6 }, (_, index) =>
      svc.refresh({ hint: { agent: "cursor", paths: [`/cursor/early-${index}/meta.json`] } }),
    );
    activeRead.resolve(result([entry("cursor", "active", 1)]));
    await vi.waitFor(() => expect(cursor).toHaveBeenCalledTimes(2));
    const lateHints = Array.from({ length: 6 }, (_, index) =>
      svc.refresh({ hint: { agent: "cursor", paths: [`/cursor/late-${index}/meta.json`] } }),
    );

    forcedRead.resolve(result([entry("cursor", "forced", 2)]));
    expect((await forced).entries[0].sessionId).toBe("forced");
    await vi.waitFor(() => expect(cursor).toHaveBeenCalledTimes(3));
    expect(cursor.mock.calls[1][1]).toBeUndefined();
    expect(cursor.mock.calls[2][1]?.paths).toHaveLength(12);
    followUpRead.resolve(result([entry("cursor", "follow-up", 3)]));

    await active;
    const queued = await Promise.all([...earlyHints, ...lateHints]);
    expect(queued.every((result) => result.entries[0].sessionId === "follow-up")).toBe(true);
    expect(cursor).toHaveBeenCalledTimes(3);
  });

  it("non-force concurrent refresh joins the single in-flight read", async () => {
    let call = 0;
    const readers = makeReaders({
      claude: vi.fn(async () => {
        call++;
        return result([entry("claude", "c", call)]);
      }),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });

    const [a, b] = await Promise.all([svc.refresh(), svc.refresh()]);
    expect(call).toBe(1);
    expect(a).toEqual(b);
  });

  it("two concurrent force refreshes serialize — no interleaved reads (review W1)", async () => {
    let active = 0;
    let maxActive = 0;
    let call = 0;
    const readers = makeReaders({
      claude: vi.fn(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return result([entry("claude", `r${++call}`, call)]);
      }),
    });
    const svc = new VaultService({ readers, canForkOpenCodeFn: async () => false });

    const p0 = svc.refresh(); // seed one in-flight read
    const [f1, f2] = await Promise.all([svc.refresh({ force: true }), svc.refresh({ force: true })]);
    await p0;

    // Never two reads running at once; both force reads produced fresh, distinct lists.
    expect(maxActive).toBe(1);
    expect(f1.entries[0].sessionId).not.toEqual(f2.entries[0].sessionId);
  });
});
