import type { CursorHookInstaller, CursorHookInstallResult, CursorHookRemoveResult } from "./CursorHookInstaller";
import type { CursorHookRuntime } from "./CursorHookRuntime";

type HookInstaller = Pick<CursorHookInstaller, "install" | "uninstall">;
type WarningOperation = "runtime" | "install" | "uninstall";

export interface CursorHookControllerOptions {
  initialEnabled: boolean;
  installer: HookInstaller;
  createRuntime: () => Promise<CursorHookRuntime>;
  setContributor: (contributor: CursorHookRuntime | undefined) => void;
  onWarning?: (operation: WarningOperation, reason: string) => void;
}

/** Owns serialized Cursor hook configuration and runtime authority as one lifecycle. */
export class CursorHookController {
  private desiredEnabled: boolean;
  private desiredRevision = 0;
  private runtime: CursorHookRuntime | null = null;
  private startPromise: Promise<void> | null = null;
  private reconcilePromise: Promise<void> | null = null;
  private reconciledRevision = -1;
  private reconciledEnabled = false;
  private reconciledSuccessfully = false;
  private authorityGranted = false;
  private started = false;
  private disposed = false;

  public constructor(private readonly options: CursorHookControllerOptions) {
    this.desiredEnabled = options.initialEnabled;
  }

  public start(): Promise<void> {
    if (!this.startPromise) {
      this.started = true;
      this.startPromise = this.initialize();
    }
    return this.startPromise;
  }

  public setDesiredEnabled(enabled: boolean): Promise<void> {
    this.desiredEnabled = enabled;
    this.desiredRevision += 1;
    if (!enabled) {
      this.revokeAuthority();
    }
    return this.started ? this.reconcileLatest() : Promise.resolve();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.desiredEnabled = false;
    this.desiredRevision += 1;
    this.revokeAuthority();
    this.runtime?.dispose();
    this.runtime = null;
  }

  private async initialize(): Promise<void> {
    const runtimePromise = this.options.createRuntime().then(
      (runtime) => ({ runtime }),
      (error: unknown) => ({ error }),
    );
    const reconciliation = this.reconcileLatest();
    const runtimeResult = await runtimePromise;
    if ("error" in runtimeResult) {
      await reconciliation;
      this.options.onWarning?.(
        "runtime",
        runtimeResult.error instanceof Error ? runtimeResult.error.message : String(runtimeResult.error),
      );
      return;
    }
    if (this.disposed) {
      runtimeResult.runtime.dispose();
      return;
    }

    this.runtime = runtimeResult.runtime;
    this.revokeAuthority();
    await reconciliation;
    this.applyReconciledAuthority();
  }

  private reconcileLatest(): Promise<void> {
    if (this.reconcilePromise) {
      return this.reconcilePromise;
    }
    this.reconcilePromise = this.runReconciliation().finally(() => {
      this.reconcilePromise = null;
    });
    return this.reconcilePromise;
  }

  private async runReconciliation(): Promise<void> {
    while (!this.disposed) {
      const revision = this.desiredRevision;
      const enabled = this.desiredEnabled;

      if (!enabled) {
        this.revokeAuthority();
      }

      const outcome = enabled ? await this.install() : await this.uninstall();
      if (this.disposed) {
        return;
      }
      if (revision !== this.desiredRevision) {
        this.revokeAuthority();
        continue;
      }

      this.reconciledRevision = revision;
      this.reconciledEnabled = enabled;
      this.reconciledSuccessfully = outcome.success;
      this.applyReconciledAuthority();
      if (outcome.warning) {
        this.options.onWarning?.(enabled ? "install" : "uninstall", outcome.warning);
      }
      if (!outcome.success) {
        this.options.onWarning?.(enabled ? "install" : "uninstall", outcome.reason);
      }
      return;
    }
  }

  private async install(): Promise<{ success: boolean; reason: string; warning?: string }> {
    try {
      const result: CursorHookInstallResult = await this.options.installer.install();
      if (result.installed) {
        return {
          success: true,
          reason: "",
          ...(result.reason ? { warning: formatOutcome(result.reason, result.unresolved) } : {}),
        };
      }
      return {
        success: false,
        reason: formatOutcome(result.reason ?? "install-failed", result.unresolved),
      };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private async uninstall(): Promise<{ success: boolean; reason: string; warning?: string }> {
    try {
      const result: CursorHookRemoveResult = await this.options.installer.uninstall();
      const clean = !result.unresolved || result.unresolved.length === 0;
      const success = clean && (result.removed || result.reason === "not-installed");
      return {
        success,
        reason: success ? "" : formatOutcome(result.reason ?? "uninstall-failed", result.unresolved),
      };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private applyReconciledAuthority(): void {
    if (
      this.runtime &&
      this.reconciledRevision === this.desiredRevision &&
      this.reconciledEnabled &&
      this.reconciledSuccessfully
    ) {
      if (!this.authorityGranted) {
        this.runtime.setEnabled(true);
        this.options.setContributor(this.runtime);
        this.authorityGranted = true;
      }
      return;
    }
    this.revokeAuthority();
  }

  private revokeAuthority(): void {
    this.options.setContributor(undefined);
    this.runtime?.setEnabled(false);
    this.authorityGranted = false;
  }
}

function formatOutcome(reason: string, unresolved: readonly string[] | undefined): string {
  return unresolved && unresolved.length > 0 ? `${reason}: ${unresolved.join(", ")}` : reason;
}
