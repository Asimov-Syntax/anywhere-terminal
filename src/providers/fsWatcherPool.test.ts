// Unit tests for `createWatcherPool`.
//
// We inject a fake `createFileSystemWatcher` factory + fake window-state
// event source so the lifecycle, debounce, fanout, focus rehydrate, and
// soft-cap behaviors can be driven deterministically without standing up a
// real VS Code extension host.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { createWatcherPool, DEBOUNCE_MS, SOFT_CAP } from "./fsWatcherPool";

type Listener<T> = (value: T) => void;

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    event: ((l: Listener<T>) => {
      listeners.add(l);
      return { dispose: () => listeners.delete(l) };
    }) as vscode.Event<T>,
    fire: (v: T) => {
      for (const l of [...listeners]) {
        l(v);
      }
    },
    listenerCount: () => listeners.size,
  };
}

interface FakeWatcher {
  onDidCreate: vscode.Event<vscode.Uri>;
  onDidChange: vscode.Event<vscode.Uri>;
  onDidDelete: vscode.Event<vscode.Uri>;
  dispose: ReturnType<typeof vi.fn>;
  fireCreate: (fsPath?: string) => void;
  fireDelete: (fsPath?: string) => void;
  fireChange: (fsPath?: string) => void;
}

function makeFakeWatcher(): FakeWatcher {
  const createEm = createEmitter<vscode.Uri>();
  const changeEm = createEmitter<vscode.Uri>();
  const deleteEm = createEmitter<vscode.Uri>();
  return {
    onDidCreate: createEm.event,
    onDidChange: changeEm.event,
    onDidDelete: deleteEm.event,
    dispose: vi.fn(),
    fireCreate: (fsPath = "/fake") => createEm.fire({ fsPath } as vscode.Uri),
    fireDelete: (fsPath = "/fake") => deleteEm.fire({ fsPath } as vscode.Uri),
    fireChange: (fsPath = "/fake") => changeEm.fire({ fsPath } as vscode.Uri),
  };
}

interface FakeFactory {
  /** Spy-style fn that the pool calls; returns a FakeWatcher per call. */
  fn: (
    glob: vscode.GlobPattern,
    ignoreCreate?: boolean,
    ignoreChange?: boolean,
    ignoreDelete?: boolean,
  ) => vscode.FileSystemWatcher;
  calls: Array<{
    glob: vscode.GlobPattern;
    ignoreCreate: boolean | undefined;
    ignoreChange: boolean | undefined;
    ignoreDelete: boolean | undefined;
    watcher: FakeWatcher;
  }>;
}

function makeFakeFactory(): FakeFactory {
  const calls: FakeFactory["calls"] = [];
  return {
    calls,
    fn: (glob, ignoreCreate, ignoreChange, ignoreDelete) => {
      const watcher = makeFakeWatcher();
      calls.push({ glob, ignoreCreate, ignoreChange, ignoreDelete, watcher });
      return watcher as unknown as vscode.FileSystemWatcher;
    },
  };
}

describe("WatcherPool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(a) first subscriber creates one watcher; second subscriber reuses; last unsubscribe disposes", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const sub1 = pool.subscribe("/foo", cb1);
    expect(factory.calls.length).toBe(1);
    const sub2 = pool.subscribe("/foo", cb2);
    expect(factory.calls.length).toBe(1); // reused
    expect(factory.calls[0].watcher.dispose).not.toHaveBeenCalled();

    sub1.dispose();
    expect(factory.calls[0].watcher.dispose).not.toHaveBeenCalled();
    sub2.dispose();
    expect(factory.calls[0].watcher.dispose).toHaveBeenCalledTimes(1);

    pool.dispose();
  });

  it("(b) onDidCreate/onDidDelete arm 150ms debounce; collapse; reset on each event", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    const cb = vi.fn();
    pool.subscribe("/foo", cb);
    const w = factory.calls[0].watcher;

    w.fireCreate();
    w.fireDelete();
    w.fireCreate();
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);

    // Timer reset: fire again, then advance LESS than the window after another
    // fire — the first fire's window restarts.
    w.fireCreate();
    vi.advanceTimersByTime(100);
    w.fireCreate();
    vi.advanceTimersByTime(100);
    // 100 + 100 = 200 ms total, but the second fire reset; only 100 ms since
    // the last event → still pending.
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(2);

    pool.dispose();
  });

  it("(c) fanout invokes every subscriber; throwing one does not stop the rest", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    const throwingCb = vi.fn(() => {
      throw new Error("boom");
    });
    const okCb = vi.fn();
    pool.subscribe("/foo", throwingCb);
    pool.subscribe("/foo", okCb);
    const w = factory.calls[0].watcher;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    w.fireCreate();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(throwingCb).toHaveBeenCalledTimes(1);
    expect(okCb).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    pool.dispose();
  });

  it("(c2) fanout re-checks membership — a callback that disposes another mid-loop suppresses the latter (review S1)", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    const cbB = vi.fn();
    // cbA disposes cbB's subscription mid-fanout. After this point, the
    // snapshot still contains cbB but membership has been removed —
    // the per-iteration membership check must skip the invocation.
    let subB: { dispose(): void } | null = null;
    const cbA = vi.fn(() => {
      subB?.dispose();
    });
    pool.subscribe("/foo", cbA);
    subB = pool.subscribe("/foo", cbB);
    const w = factory.calls[0].watcher;

    w.fireCreate();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(0);

    pool.dispose();
  });

  it("(d) ENOSPC from createFileSystemWatcher is caught; subscriber still gets a Disposable", () => {
    const error = Object.assign(new Error("no space"), { code: "ENOSPC" });
    const fn = vi.fn(() => {
      throw error;
    });
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: fn as unknown as typeof import("vscode").workspace.createFileSystemWatcher,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const cb = vi.fn();
    const sub = pool.subscribe("/foo", cb);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain("ENOSPC");
    expect(typeof sub.dispose).toBe("function");

    // No events ever fire (no real watcher), but unsubscribe must not throw.
    sub.dispose();

    pool.dispose();
  });

  it("(e) initial focus=true + subsequent focused:true does NOT trigger rehydrate", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    const onRehydrate = vi.fn();
    pool.onDidRequestRehydrate(onRehydrate);

    focusEm.fire({ focused: true });
    expect(onRehydrate).not.toHaveBeenCalled();

    pool.dispose();
  });

  it("(f) initial focus=false + first focused:true triggers exactly one rehydrate", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: false,
    });
    const onRehydrate = vi.fn();
    pool.onDidRequestRehydrate(onRehydrate);

    focusEm.fire({ focused: true });
    expect(onRehydrate).toHaveBeenCalledTimes(1);

    pool.dispose();
  });

  it("(g) sustained false→true→false→true produces exactly two rehydrates (rising edges only)", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: false,
    });
    const onRehydrate = vi.fn();
    pool.onDidRequestRehydrate(onRehydrate);

    focusEm.fire({ focused: true });
    focusEm.fire({ focused: false });
    focusEm.fire({ focused: true });
    expect(onRehydrate).toHaveBeenCalledTimes(2);

    pool.dispose();
  });

  it("(h) soft-cap warning fires exactly once when path count first reaches 500", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const subs: Array<{ dispose(): void }> = [];
    for (let i = 0; i < SOFT_CAP - 1; i++) {
      subs.push(pool.subscribe(`/p${i}`, () => {}));
    }
    expect(warn).not.toHaveBeenCalled();
    subs.push(pool.subscribe(`/p${SOFT_CAP - 1}`, () => {}));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`${SOFT_CAP}`);
    // Subsequent subscribes never emit a second warning.
    subs.push(pool.subscribe(`/p${SOFT_CAP}`, () => {}));
    subs.push(pool.subscribe(`/p${SOFT_CAP + 1}`, () => {}));
    expect(warn).toHaveBeenCalledTimes(1);
    // Drop a few and add others — still one-shot.
    subs[0].dispose();
    subs[1].dispose();
    pool.subscribe("/another", () => {});
    expect(warn).toHaveBeenCalledTimes(1);

    pool.dispose();
  });

  it("(i) dispose() releases watchers + timers; post-dispose subscribe returns no-op", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: false,
    });
    const cb = vi.fn();
    pool.subscribe("/foo", cb);
    pool.subscribe("/bar", cb);
    expect(factory.calls.length).toBe(2);

    // Arm a pending fanout in each.
    factory.calls[0].watcher.fireCreate();
    factory.calls[1].watcher.fireDelete();

    pool.dispose();
    expect(factory.calls[0].watcher.dispose).toHaveBeenCalledTimes(1);
    expect(factory.calls[1].watcher.dispose).toHaveBeenCalledTimes(1);

    // Pending timers must have been cleared; advance well past debounce.
    vi.advanceTimersByTime(DEBOUNCE_MS * 4);
    expect(cb).not.toHaveBeenCalled();

    // Post-dispose subscribe returns a Disposable but creates no new watcher.
    const sub = pool.subscribe("/baz", cb);
    expect(factory.calls.length).toBe(2);
    expect(typeof sub.dispose).toBe("function");
    sub.dispose();

    // Post-dispose focus events do NOT trigger rehydrate.
    const onRehydrate = vi.fn();
    pool.onDidRequestRehydrate(onRehydrate);
    focusEm.fire({ focused: true });
    expect(onRehydrate).not.toHaveBeenCalled();
  });

  it("(j) re-root thrash: subscribe → unsubscribe → re-subscribe creates a NEW watcher (no grace period)", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    const cb = vi.fn();
    const sub1 = pool.subscribe("/projA", cb);
    expect(factory.calls.length).toBe(1);
    sub1.dispose();
    expect(factory.calls[0].watcher.dispose).toHaveBeenCalledTimes(1);

    // Re-subscribe within the same tick — new watcher must be created
    // because v1 has no deferred-dispose grace period.
    pool.subscribe("/projA", cb);
    expect(factory.calls.length).toBe(2);
    expect(factory.calls[1].watcher.dispose).not.toHaveBeenCalled();

    pool.dispose();
  });

  it("(k) watcher created with RelativePattern(Uri.file(absPath), '*') + flags (false, true, false)", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    pool.subscribe("/some/abs/path", () => {});
    expect(factory.calls.length).toBe(1);
    const call = factory.calls[0];

    // Pattern is a RelativePattern with base=Uri.file('/some/abs/path') and
    // pattern='*'. We test the shape because the real `vscode.RelativePattern`
    // class is constructed from the actual vscode module (vi __mocks__ shim).
    expect(call.glob).toBeDefined();
    const glob = call.glob as { pattern?: string; base?: unknown; baseUri?: { fsPath?: string } };
    expect(glob.pattern).toBe("*");
    const fsPath = glob.baseUri?.fsPath || ((glob.base as { fsPath?: string } | undefined)?.fsPath ?? undefined);
    expect(fsPath).toBe("/some/abs/path");

    // Flags: ignoreCreate=false, ignoreChange=true, ignoreDelete=false.
    expect(call.ignoreCreate).toBe(false);
    expect(call.ignoreChange).toBe(true);
    expect(call.ignoreDelete).toBe(false);

    pool.dispose();
  });

  it("passes the affected URI through debounced pattern handlers", () => {
    const factory = makeFakeFactory();
    const focusEm = createEmitter<{ focused: boolean }>();
    const pool = createWatcherPool({
      createFileSystemWatcher: factory.fn,
      onDidChangeWindowState: focusEm.event,
      initialWindowFocused: true,
    });
    const create = vi.fn();
    const change = vi.fn();
    const remove = vi.fn();
    pool.subscribePattern("/cursor", "**/meta.json", { create, change, delete: remove });
    const watcher = factory.calls[0].watcher;

    watcher.fireCreate("/cursor/a/chat-1/meta.json");
    watcher.fireChange("/cursor/a/chat-2/meta.json");
    watcher.fireChange("/cursor/a/chat-4/meta.json");
    watcher.fireDelete("/cursor/a/chat-3/meta.json");
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/cursor/a/chat-1/meta.json" }));
    expect(change).toHaveBeenCalledTimes(2);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/cursor/a/chat-2/meta.json" }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/cursor/a/chat-4/meta.json" }));
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/cursor/a/chat-3/meta.json" }));
    pool.dispose();
  });
});
