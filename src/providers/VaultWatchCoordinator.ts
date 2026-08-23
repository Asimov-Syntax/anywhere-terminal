import type { VaultSessionDetail } from "../vault/types";
import type { VaultService, VaultWatchTarget } from "../vault/VaultService";
import type { WatcherPool } from "./fsWatcherPool";

const STORE_REFRESH_DEBOUNCE_MS = 300;
const FOLLOW_REFRESH_DEBOUNCE_MS = 400;

type VaultWatchService = Pick<VaultService, "getStoreWatchTargets" | "resolveSessionWatchTargets" | "getDetail">;
type PatternWatcherPool = Pick<WatcherPool, "subscribePattern">;
type Disposable = { dispose(): void };

export interface VaultWatchCallbacks {
  refreshList(): void;
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
  onEvent: () => void,
  onError: (target: VaultWatchTarget, error: unknown) => void,
): Disposable[] {
  const watchers: Disposable[] = [];
  for (const target of targets) {
    try {
      watchers.push(
        watcherPool.subscribePattern(target.baseDir, target.glob, {
          create: onEvent,
          change: onEvent,
          delete: onEvent,
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
  private disposed = false;

  constructor(
    deps: VaultWatchCoordinatorDeps,
    private readonly refreshList: () => void,
  ) {
    this.watchers = subscribeTargets(
      deps.watcherPool,
      deps.vaultService.getStoreWatchTargets(),
      () => this.scheduleRefresh(),
      (target, error) => {
        console.error("[AnyWhere Terminal] Failed to watch vault store:", target.baseDir, error);
      },
    );
  }

  private scheduleRefresh(): void {
    if (this.disposed) {
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (!this.disposed) {
        this.refreshList();
      }
    }, STORE_REFRESH_DEBOUNCE_MS);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
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
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.pushDetail(entryId, seq);
    }, FOLLOW_REFRESH_DEBOUNCE_MS);
  }

  private async pushDetail(entryId: string, seq: number): Promise<void> {
    if (this.disposed || seq !== this.seq) {
      return;
    }
    try {
      const detail = await this.deps.vaultService.getDetail(entryId);
      if (this.disposed || seq !== this.seq) {
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
