import type { CursorHookInstaller, CursorHookInstallResult, CursorHookRemoveResult } from "./CursorHookInstaller";
import type { CursorHookRuntime } from "./CursorHookRuntime";

type HookInstaller = Pick<CursorHookInstaller, "install" | "uninstall">;
type WarningOperation = "runtime" | "install" | "uninstall";

export interface CursorHookControllerOptions {
  initialEnabled: boolean;
  /** Another agent wants the receiver up, without owning Cursor's hook file. */
  initialReceiverEnabled?: boolean;
  installer: HookInstaller;
  createRuntime: () => Promise<CursorHookRuntime>;
  setContributor: (contributor: CursorHookRuntime | undefined) => void;
  onWarning?: (operation: WarningOperation, reason: string) => void;
}

/** Owns serialized Cursor hook configuration and runtime authority as one lifecycle. */
export class CursorHookController {
  private desiredEnabled: boolean;
  private receiverWanted: boolean;
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
    this.receiverWanted = options.initialReceiverEnabled ?? false;
  }

  /**
   * Say whether an agent other than Cursor needs the receiver running.
   *
   * Cursor's authority waits on its hook file reconciling, because accepting a
   * Cursor event means owning the config that produced it. A reporting agent
   * installs nothing there, so its reporting must not be hostage to that file.
   */
  public setDesiredReceiverEnabled(enabled: boolean): void {
    this.receiverWanted = enabled;
    // Pushed even when authority does not move: Cursor may be holding the
    // receiver up on its own, and reporting is a switch of its own
    // (.reviews/round-3.md B8).
    this.runtime?.setReportingEnabled(enabled);
    this.applyReconciledAuthority();
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
      this.dropCursorAuthority();
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
        this.dropCursorAuthority();
      }

      const outcome = enabled ? await this.install() : await this.uninstall();
      if (this.disposed) {
        return;
      }
      if (revision !== this.desiredRevision) {
        this.dropCursorAuthority();
        continue;
      }

      this.reconciledRevision = revision;
      this.reconciledEnabled = enabled;
      this.reconciledSuccessfully = outcome.success;
      this.applyReconciledAuthority();
      if (!outcome.success) {
        this.options.onWarning?.(enabled ? "install" : "uninstall", outcome.reason);
      }
      return;
    }
  }

  private async install(): Promise<{ success: boolean; reason: string }> {
    try {
      const result: CursorHookInstallResult = await this.options.installer.install();
      return result.installed
        ? { success: true, reason: "" }
        : { success: false, reason: result.reason ?? "install-failed" };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private async uninstall(): Promise<{ success: boolean; reason: string }> {
    try {
      const result: CursorHookRemoveResult = await this.options.installer.uninstall();
      return result.removed || result.reason === "not-installed"
        ? { success: true, reason: "" }
        : { success: false, reason: result.reason ?? "uninstall-failed" };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Cursor's own authority: reconciled, current, and the hook file actually written. */
  private cursorAuthorized(): boolean {
    return this.reconciledRevision === this.desiredRevision && this.reconciledEnabled && this.reconciledSuccessfully;
  }

  private applyReconciledAuthority(): void {
    if (this.runtime && (this.cursorAuthorized() || this.receiverWanted)) {
      this.runtime.setReportingEnabled(this.receiverWanted);
      if (!this.authorityGranted) {
        this.runtime.setEnabled(true);
        this.options.setContributor(this.runtime);
        this.authorityGranted = true;
      }
      return;
    }
    this.revokeAuthority();
  }

  /** Cursor lost its claim; the receiver stays up if another agent still wants it. */
  private dropCursorAuthority(): void {
    this.reconciledSuccessfully = false;
    if (this.receiverWanted) {
      return;
    }
    this.revokeAuthority();
  }

  private revokeAuthority(): void {
    this.options.setContributor(undefined);
    this.runtime?.setReportingEnabled(false);
    this.runtime?.setEnabled(false);
    this.authorityGranted = false;
  }
}
