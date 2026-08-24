import type * as vscode from "vscode";
import type { VaultRefreshHint } from "../vault/cacheTypes";
import type { VaultSessionDetail } from "../vault/types";
import type { VaultService, VaultWatchTarget } from "../vault/VaultService";
import type { WatcherPool } from "./fsWatcherPool";

const STORE_REFRESH_DEBOUNCE_MS = 300;
const STORE_REFRESH_MAX_WAIT_MS = 1000;
const FOLLOW_REFRESH_DEBOUNCE_MS = 400;
const MAX_TARGETED_REFRESH_PATHS = 128;

type VaultWatchService = Pick<VaultService, "getStoreWatchTargets" | "resolveSessionWatchTargets" | "getDetail">;
type PatternWatcherPool = Pick<WatcherPool, "subscribePattern">;
type Disposable = { dispose(): void };

export interface VaultWatchCallbacks {
  refreshList(hint?: VaultRefreshHint): void;
  postFollowDetail(entryId: string, detail: VaultSessionDetail): void;
}

export interface VaultWatchClient extends Disposable {
  watchSession(entryId: string | null): Promise<void>;
}

export interface VaultWatchCoordinatorDeps {
  watcherPool: PatternWatcherPool;
  vaultService: VaultWatchService;
}

const NOOP_CLIENT: VaultWatchClient = {
  watchSession: async () => {},
  dispose: () => {},
};

function subscribeTargets(
  watcherPool: PatternWatcherPool,
  targets: VaultWatchTarget[],
  onEvent: (target: VaultWatchTarget, uri: vscode.Uri) => void,
  onError: (target: VaultWatchTarget, error: unknown) => void,
): Disposable[] {
  const watchers: Disposable[] = [];
  for (const target of targets) {
    try {
      const events = target.events ?? ["create", "change", "delete"];
      watchers.push(
        watcherPool.subscribePattern(target.baseDir, target.glob, {
          ...(events.includes("create") ? { create: (uri: vscode.Uri) => onEvent(target, uri) } : {}),
          ...(events.includes("change") ? { change: (uri: vscode.Uri) => onEvent(target, uri) } : {}),
          ...(events.includes("delete") ? { delete: (uri: vscode.Uri) => onEvent(target, uri) } : {}),
        }),
      );
    } catch (error) {
      onError(target, error);
    }
  }
  return watchers;
}

class StoreWatchLifecycle implements Disposable {
  private watchers: Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingAgent: VaultRefreshHint["agent"] | undefined;
  private readonly pendingPaths = new Set<string>();
  private fullRefreshPending = false;
  private disposed = false;

  constructor(
    deps: VaultWatchCoordinatorDeps,
    private readonly refreshList: VaultWatchCallbacks["refreshList"],
  ) {
    this.watchers = subscribeTargets(
      deps.watcherPool,
      deps.vaultService.getStoreWatchTargets(),
      (target, uri) => this.scheduleRefresh(target, uri),
      (target, error) => {
        console.error("[AnyWhere Terminal] Failed to watch vault store:", target.baseDir, error);
      },
    );
  }

  private scheduleRefresh(target: VaultWatchTarget, uri: vscode.Uri | undefined): void {
    if (this.disposed) {
      return;
    }
    if (!target.agent || !uri?.fsPath || (this.pendingAgent && this.pendingAgent !== target.agent)) {
      this.fullRefreshPending = true;
      this.pendingAgent = undefined;
      this.pendingPaths.clear();
    } else if (!this.fullRefreshPending) {
      this.pendingAgent = target.agent;
      this.pendingPaths.add(uri.fsPath);
      if (this.pendingPaths.size > MAX_TARGETED_REFRESH_PATHS) {
        this.fullRefreshPending = true;
        this.pendingAgent = undefined;
        this.pendingPaths.clear();
      }
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => this.flushRefresh(), STORE_REFRESH_DEBOUNCE_MS);
    this.maxWaitTimer ??= setTimeout(() => this.flushRefresh(), STORE_REFRESH_MAX_WAIT_MS);
  }

  private flushRefresh(): void {
    if (!this.refreshTimer && !this.maxWaitTimer) {
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = undefined;
    }
    if (this.disposed) {
      return;
    }
    const hint =
      !this.fullRefreshPending && this.pendingAgent
        ? { agent: this.pendingAgent, paths: [...this.pendingPaths] }
        : undefined;
    this.pendingAgent = undefined;
    this.pendingPaths.clear();
    this.fullRefreshPending = false;
    this.refreshList(hint);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.flushRefresh();
    this.pendingAgent = undefined;
    this.pendingPaths.clear();
    this.fullRefreshPending = false;
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }
}

class FollowWatchLifecycle implements Disposable {
  private watchers: Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;
  private refreshSeq = 0;
  private disposed = false;

  constructor(
    private readonly deps: VaultWatchCoordinatorDeps,
    private readonly postDetail: VaultWatchCallbacks["postFollowDetail"],
  ) {}

  async watchSession(entryId: string | null): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposeWatchers();
    const seq = ++this.seq;
    if (!entryId) {
      return;
    }
    const targets = await this.deps.vaultService.resolveSessionWatchTargets(entryId);
    if (this.disposed || seq !== this.seq) {
      return;
    }
    this.watchers = subscribeTargets(
      this.deps.watcherPool,
      targets,
      () => this.scheduleRefresh(entryId, seq),
      (_target, error) => {
        console.error("[AnyWhere Terminal] Failed to watch vault session:", entryId, error);
      },
    );
  }

  private scheduleRefresh(entryId: string, seq: number): void {
    if (this.disposed || seq !== this.seq) {
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const refreshSeq = ++this.refreshSeq;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.pushDetail(entryId, seq, refreshSeq);
    }, FOLLOW_REFRESH_DEBOUNCE_MS);
  }

  private async pushDetail(entryId: string, seq: number, refreshSeq: number): Promise<void> {
    if (this.disposed || seq !== this.seq || refreshSeq !== this.refreshSeq) {
      return;
    }
    try {
      const detail = await this.deps.vaultService.getDetail(entryId);
      if (this.disposed || seq !== this.seq || refreshSeq !== this.refreshSeq) {
        return;
      }
      if (detail) {
        this.postDetail(entryId, detail);
      }
    } catch (err) {
      console.error("[AnyWhere Terminal] Vault follow re-read failed:", entryId, err);
    }
  }

  private disposeWatchers(): void {
    this.refreshSeq++;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.seq++;
    this.disposeWatchers();
  }
}

class AttachedVaultWatchClient implements VaultWatchClient {
  private readonly store: StoreWatchLifecycle;
  private readonly follow: FollowWatchLifecycle;
  private disposed = false;

  constructor(
    deps: VaultWatchCoordinatorDeps,
    callbacks: VaultWatchCallbacks,
    private readonly onDispose: () => void,
  ) {
    this.store = new StoreWatchLifecycle(deps, callbacks.refreshList);
    this.follow = new FollowWatchLifecycle(deps, callbacks.postFollowDetail);
  }

  watchSession(entryId: string | null): Promise<void> {
    return this.follow.watchSession(entryId);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.store.dispose();
    this.follow.dispose();
    this.onDispose();
  }
}

export class VaultWatchCoordinator implements Disposable {
  private readonly clients = new Set<AttachedVaultWatchClient>();
  private disposed = false;

  constructor(private readonly deps: VaultWatchCoordinatorDeps) {}

  attach(callbacks: VaultWatchCallbacks): VaultWatchClient {
    if (this.disposed) {
      return NOOP_CLIENT;
    }
    let client: AttachedVaultWatchClient;
    client = new AttachedVaultWatchClient(this.deps, callbacks, () => this.clients.delete(client));
    this.clients.add(client);
    return client;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const client of [...this.clients]) {
      client.dispose();
    }
    this.clients.clear();
  }
}
