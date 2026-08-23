import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultSessionDetail } from "../vault/types";
import type { WatcherPool } from "./fsWatcherPool";
import { VaultWatchCoordinator } from "./VaultWatchCoordinator";

type PatternHandlers = { create?: () => void; change?: () => void; delete?: () => void };

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
    getStoreWatchTargets: vi.fn(() => [
      { baseDir: "/claude", glob: "**/*.jsonl" },
      { baseDir: "/opencode", glob: "opencode.db*" },
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

    expect(subscriptions).toHaveLength(4);
    a.dispose();
    expect(subscriptions.slice(0, 2).every((sub) => sub.dispose.mock.calls.length === 1)).toBe(true);
    expect(subscriptions.slice(2).every((sub) => sub.dispose.mock.calls.length === 0)).toBe(true);

    b.dispose();
    coordinator.dispose();
  });

  it("coalesces store events through the existing 300 ms debounce", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    coordinator.attach({ refreshList, postFollowDetail: vi.fn() });

    subscriptions[0].handlers.create?.();
    subscriptions[0].handlers.change?.();
    subscriptions[1].handlers.delete?.();
    vi.advanceTimersByTime(299);
    expect(refreshList).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refreshList).toHaveBeenCalledTimes(1);

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
    follow?.handlers.change?.();
    vi.advanceTimersByTime(399);
    expect(vaultService.getDetail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(vaultService.getDetail).toHaveBeenCalledWith("claude:s1");
    expect(postFollowDetail).toHaveBeenCalledWith("claude:s1", detail);

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
    const firstFollow = subscriptions[4];
    const secondFollow = subscriptions[5];
    firstFollow.handlers.change?.();
    secondFollow.handlers.change?.();

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

    expect(subscriptions.map((sub) => sub.glob)).toEqual(["**/*.jsonl", "opencode.db*", "new.jsonl"]);
    coordinator.dispose();
  });

  it("client disposal clears pending timers and every owned watcher exactly once", async () => {
    vi.useFakeTimers();
    const { coordinator, subscriptions } = createHarness();
    const refreshList = vi.fn();
    const postFollowDetail = vi.fn();
    const client = coordinator.attach({ refreshList, postFollowDetail });
    await client.watchSession("claude:s1");

    subscriptions[0].handlers.change?.();
    subscriptions.at(-1)?.handlers.change?.();
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
    expect(subscriptions).toHaveLength(4);
  });
});
