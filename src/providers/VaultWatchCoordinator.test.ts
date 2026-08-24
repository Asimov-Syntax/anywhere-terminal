import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { VaultSessionDetail } from "../vault/types";
import type { VaultWatchTarget } from "../vault/VaultService";
import type { WatcherPool } from "./fsWatcherPool";
import { VaultWatchCoordinator } from "./VaultWatchCoordinator";

type PatternHandlers = {
  create?: (uri: vscode.Uri) => void;
  change?: (uri: vscode.Uri) => void;
  delete?: (uri: vscode.Uri) => void;
};

function uri(fsPath: string): vscode.Uri {
  return { fsPath } as vscode.Uri;
}

function createHarness() {
  const subscriptions: Array<{
    baseDir: string;
    glob: string;
    handlers: PatternHandlers;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const watcherPool = {
    subscribePattern: vi.fn((baseDir: string, glob: string, handlers: PatternHandlers) => {
      const dispose = vi.fn();
      subscriptions.push({ baseDir, glob, handlers, dispose });
      return { dispose };
    }),
  } as unknown as Pick<WatcherPool, "subscribePattern">;
  const detail = { entryId: "claude:s1", timeline: [] } as unknown as VaultSessionDetail;
  const vaultService = {
    getStoreWatchTargets: vi.fn((): VaultWatchTarget[] => [
      { baseDir: "/claude", glob: "**/*.jsonl" },
      { baseDir: "/opencode", glob: "opencode.db*" },
      { baseDir: "/cursor", glob: "**/store.db", events: ["create", "delete"], agent: "cursor" },
      { baseDir: "/cursor-projects", glob: "**/*.jsonl", agent: "cursor" },
      { baseDir: "/cursor-ide", glob: "state.vscdb*", agent: "cursor" },
    ]),
    resolveSessionWatchTargets: vi.fn(async (entryId: string) => [{ baseDir: "/sessions", glob: `${entryId}.jsonl` }]),
    getDetail: vi.fn(async () => detail),
  };
  const coordinator = new VaultWatchCoordinator({ watcherPool, vaultService });
  return { coordinator, subscriptions, vaultService, detail };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("VaultWatchCoordinator", () => {
  it("preserves independent store subscriptions for each attached client", () => {
    const { coordinator, subscriptions } = createHarness();
    const a = coordinator.attach({ refreshList: vi.fn(), postFollowDetail: vi.fn() });
    const b = coordinator.attach({ refreshList: vi.fn(), postFollowDetail: vi.fn() });

    expect(subscriptions).toHaveLength(10);
    a.dispose();
    expect(subscriptions.slice(0, 5).every((sub) => sub.dispose.mock.calls.length === 1)).toBe(true);
    expect(subscriptions.slice(5).every((sub) => sub.dispose.mock.calls.length === 0)).toBe(true);

    b.dispose();
    coordinator.dispose();
  });

  it("coalesces store events through the existing 300 ms debounce", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    coordinator.attach({ refreshList, postFollowDetail: vi.fn() });

    subscriptions[0].handlers.create?.(uri("/claude/a.jsonl"));
    subscriptions[0].handlers.change?.(uri("/claude/a.jsonl"));
    subscriptions[1].handlers.delete?.(uri("/opencode/opencode.db-wal"));
    vi.advanceTimersByTime(299);
    expect(refreshList).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refreshList).toHaveBeenCalledTimes(1);

    coordinator.dispose();
  });

  it("subscribes Cursor databases only to eligibility events, ignoring active writes", () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    coordinator.attach({ refreshList, postFollowDetail: vi.fn() });

    expect(subscriptions[0].handlers).toEqual({
      create: expect.any(Function),
      change: expect.any(Function),
      delete: expect.any(Function),
    });
    expect(subscriptions[2].handlers).toEqual({ create: expect.any(Function), delete: expect.any(Function) });
    subscriptions[2].handlers.change?.(uri("/cursor/a/chat-1/store.db"));
    vi.advanceTimersByTime(300);
    expect(refreshList).not.toHaveBeenCalled();

    subscriptions[2].handlers.create?.(uri("/cursor/a/chat-1/store.db"));
    vi.advanceTimersByTime(300);
    expect(refreshList).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("coalesces Cursor event paths into a targeted refresh hint", () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    coordinator.attach({ refreshList, postFollowDetail: vi.fn() });

    subscriptions[2].handlers.create?.(uri("/cursor/a/chat-1/store.db"));
    subscriptions[2].handlers.delete?.(uri("/cursor/b/chat-2/store.db"));
    vi.advanceTimersByTime(300);

    expect(refreshList).toHaveBeenCalledWith({
      agent: "cursor",
      paths: ["/cursor/a/chat-1/store.db", "/cursor/b/chat-2/store.db"],
    });
    coordinator.dispose();
  });

  it("coalesces project JSONL and IDE database paths into one Cursor hint", () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    coordinator.attach({ refreshList, postFollowDetail: vi.fn() });

    subscriptions[3].handlers.change?.(uri("/cursor-projects/a/agent-transcripts/chat.jsonl"));
    subscriptions[4].handlers.change?.(uri("/cursor-ide/state.vscdb-wal"));
    vi.advanceTimersByTime(300);

    expect(refreshList).toHaveBeenCalledWith({
      agent: "cursor",
      paths: ["/cursor-projects/a/agent-transcripts/chat.jsonl", "/cursor-ide/state.vscdb-wal"],
    });
    coordinator.dispose();
  });

  it("flushes continuous targeted and full-fallback store streams within the maximum wait", () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    coordinator.attach({ refreshList, postFollowDetail: vi.fn() });

    for (let i = 0; i < 5; i++) {
      subscriptions[2].handlers.create?.(uri(`/cursor/a/chat-${i}/store.db`));
      vi.advanceTimersByTime(200);
    }
    expect(refreshList).toHaveBeenCalledWith({
      agent: "cursor",
      paths: [
        "/cursor/a/chat-0/store.db",
        "/cursor/a/chat-1/store.db",
        "/cursor/a/chat-2/store.db",
        "/cursor/a/chat-3/store.db",
        "/cursor/a/chat-4/store.db",
      ],
    });

    for (let i = 0; i < 5; i++) {
      subscriptions[0].handlers.change?.(uri(`/claude/a-${i}.jsonl`));
      vi.advanceTimersByTime(200);
    }
    expect(refreshList).toHaveBeenCalledTimes(2);
    expect(refreshList).toHaveBeenLastCalledWith(undefined);
    coordinator.dispose();
  });

  it("falls back to a full refresh when a targeted path batch exceeds its cap", () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    coordinator.attach({ refreshList, postFollowDetail: vi.fn() });

    for (let i = 0; i < 129; i++) {
      subscriptions[2].handlers.create?.(uri(`/cursor/a/chat-${i}/store.db`));
    }
    vi.advanceTimersByTime(300);

    expect(refreshList).toHaveBeenCalledWith(undefined);
    coordinator.dispose();
  });

  it("follows one session per client and pushes a debounced detail", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions, vaultService, detail } = createHarness();
    const postFollowDetail = vi.fn();
    const client = coordinator.attach({ refreshList: vi.fn(), postFollowDetail });

    await client.watchSession("claude:s1");
    const follow = subscriptions.at(-1);
    expect(follow?.glob).toBe("claude:s1.jsonl");
    follow?.handlers.change?.(uri("/sessions/claude:s1.jsonl"));
    vi.advanceTimersByTime(399);
    expect(vaultService.getDetail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(vaultService.getDetail).toHaveBeenCalledWith("claude:s1");
    expect(postFollowDetail).toHaveBeenCalledWith("claude:s1", detail);

    coordinator.dispose();
  });

  it("serializes active detail reads and coalesces newer events into one stale-safe follow-up", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions, vaultService } = createHarness();
    let resolveOld: ((detail: VaultSessionDetail) => void) | undefined;
    const oldDetail = { entryId: "cursor:chat", timeline: [{ kind: "message", text: "old" }] } as VaultSessionDetail;
    const newDetail = { entryId: "cursor:chat", timeline: [{ kind: "message", text: "new" }] } as VaultSessionDetail;
    vaultService.getDetail
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce(newDetail);
    const postFollowDetail = vi.fn();
    const client = coordinator.attach({ refreshList: vi.fn(), postFollowDetail });
    await client.watchSession("cursor:chat");
    const follow = subscriptions.at(-1);

    follow?.handlers.change?.(uri("/cursor/chat/store.db-wal"));
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    follow?.handlers.change?.(uri("/cursor/chat/store.db-wal"));
    vi.advanceTimersByTime(400);
    follow?.handlers.change?.(uri("/cursor/chat/store.db-wal"));
    vi.advanceTimersByTime(400);

    expect(vaultService.getDetail).toHaveBeenCalledTimes(1);
    resolveOld?.(oldDetail);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(vaultService.getDetail).toHaveBeenCalledTimes(2);
    expect(postFollowDetail).toHaveBeenCalledTimes(1);
    expect(postFollowDetail).toHaveBeenCalledWith("cursor:chat", newDetail);
    coordinator.dispose();
  });

  it("runs a coalesced follow-up after an active detail read fails", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions, vaultService, detail } = createHarness();
    let rejectFirst: ((error: Error) => void) | undefined;
    vaultService.getDetail
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)))
      .mockResolvedValueOnce(detail);
    const postFollowDetail = vi.fn();
    const client = coordinator.attach({ refreshList: vi.fn(), postFollowDetail });
    await client.watchSession("claude:s1");
    const follow = subscriptions.at(-1);

    follow?.handlers.change?.(uri("/sessions/claude:s1.jsonl"));
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    follow?.handlers.change?.(uri("/sessions/claude:s1.jsonl"));
    vi.advanceTimersByTime(400);
    rejectFirst?.(new Error("read failed"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(vaultService.getDetail).toHaveBeenCalledTimes(2);
    expect(postFollowDetail).toHaveBeenCalledWith("claude:s1", detail);
    coordinator.dispose();
  });

  it("does not let an active old entry block a newly watched entry", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions, vaultService, detail } = createHarness();
    let resolveOld: ((detail: VaultSessionDetail) => void) | undefined;
    vaultService.getDetail.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve))).mockResolvedValueOnce(detail);
    const postFollowDetail = vi.fn();
    const client = coordinator.attach({ refreshList: vi.fn(), postFollowDetail });
    await client.watchSession("claude:old");
    const oldFollow = subscriptions.at(-1);

    oldFollow?.handlers.change?.(uri("/sessions/claude:old.jsonl"));
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await client.watchSession("claude:new");
    const newFollow = subscriptions.at(-1);
    newFollow?.handlers.change?.(uri("/sessions/claude:new.jsonl"));
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();

    expect(vaultService.getDetail).toHaveBeenNthCalledWith(1, "claude:old");
    expect(vaultService.getDetail).toHaveBeenNthCalledWith(2, "claude:new");
    resolveOld?.(detail);
    await Promise.resolve();
    await Promise.resolve();
    expect(postFollowDetail).toHaveBeenCalledTimes(1);
    expect(postFollowDetail).toHaveBeenCalledWith("claude:new", detail);
    coordinator.dispose();
  });

  it("does not post or follow up after disposal during an active detail read", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions, vaultService, detail } = createHarness();
    let resolveDetail: ((detail: VaultSessionDetail) => void) | undefined;
    vaultService.getDetail.mockImplementationOnce(() => new Promise((resolve) => (resolveDetail = resolve)));
    const postFollowDetail = vi.fn();
    const client = coordinator.attach({ refreshList: vi.fn(), postFollowDetail });
    await client.watchSession("claude:s1");
    const follow = subscriptions.at(-1);

    follow?.handlers.change?.(uri("/sessions/claude:s1.jsonl"));
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    follow?.handlers.change?.(uri("/sessions/claude:s1.jsonl"));
    vi.advanceTimersByTime(400);
    client.dispose();
    resolveDetail?.(detail);
    await Promise.resolve();
    await Promise.resolve();

    expect(vaultService.getDetail).toHaveBeenCalledTimes(1);
    expect(postFollowDetail).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("keeps follow timers, generations, watchers, and callbacks isolated between clients", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions, detail } = createHarness();
    const postFirst = vi.fn();
    const postSecond = vi.fn();
    const first = coordinator.attach({ refreshList: vi.fn(), postFollowDetail: postFirst });
    const second = coordinator.attach({ refreshList: vi.fn(), postFollowDetail: postSecond });

    await first.watchSession("claude:first");
    await second.watchSession("claude:second");
    const firstFollow = subscriptions[10];
    const secondFollow = subscriptions[11];
    firstFollow.handlers.change?.(uri("/sessions/claude:first.jsonl"));
    secondFollow.handlers.change?.(uri("/sessions/claude:second.jsonl"));

    first.dispose();
    expect(firstFollow.dispose).toHaveBeenCalledTimes(1);
    expect(secondFollow.dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();

    expect(postFirst).not.toHaveBeenCalled();
    expect(postSecond).toHaveBeenCalledWith("claude:second", detail);
    expect(secondFollow.dispose).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("does not publish a follow watcher resolved after a newer session wins", async () => {
    const { coordinator, subscriptions, vaultService } = createHarness();
    let resolveFirst: ((targets: Array<{ baseDir: string; glob: string }>) => void) | undefined;
    vaultService.resolveSessionWatchTargets
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([{ baseDir: "/sessions", glob: "new.jsonl" }]);
    const client = coordinator.attach({ refreshList: vi.fn(), postFollowDetail: vi.fn() });

    const first = client.watchSession("claude:old");
    const second = client.watchSession("claude:new");
    await second;
    resolveFirst?.([{ baseDir: "/sessions", glob: "old.jsonl" }]);
    await first;

    expect(subscriptions.map((sub) => sub.glob)).toEqual([
      "**/*.jsonl",
      "opencode.db*",
      "**/store.db",
      "**/*.jsonl",
      "state.vscdb*",
      "new.jsonl",
    ]);
    coordinator.dispose();
  });

  it("client disposal clears pending timers and every owned watcher exactly once", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    const postFollowDetail = vi.fn();
    const client = coordinator.attach({ refreshList, postFollowDetail });
    await client.watchSession("claude:s1");

    subscriptions[0].handlers.change?.(uri("/claude/a.jsonl"));
    subscriptions.at(-1)?.handlers.change?.(uri("/sessions/claude:s1.jsonl"));
    client.dispose();
    client.dispose();
    vi.runAllTimers();

    expect(refreshList).not.toHaveBeenCalled();
    expect(postFollowDetail).not.toHaveBeenCalled();
    expect(subscriptions.every((sub) => sub.dispose.mock.calls.length === 1)).toBe(true);
    coordinator.dispose();
  });

  it("coordinator disposal releases every client and rejects later attachment work", async () => {
    const { coordinator, subscriptions } = createHarness();
    coordinator.attach({ refreshList: vi.fn(), postFollowDetail: vi.fn() });
    coordinator.attach({ refreshList: vi.fn(), postFollowDetail: vi.fn() });

    coordinator.dispose();
    coordinator.dispose();
    expect(subscriptions.every((sub) => sub.dispose.mock.calls.length === 1)).toBe(true);

    const late = coordinator.attach({ refreshList: vi.fn(), postFollowDetail: vi.fn() });
    await late.watchSession("claude:late");
    expect(subscriptions).toHaveLength(10);
  });
});
