// src/agentHooks/AgentHookController.ts — Serializes hook configuration and
// runtime authority per agent, over one shared runtime and one contributor.
// Each agent reconciles independently; the contributor is an aggregate, so
// disabling one agent never revokes another's live panes
// (generalize-agent-hook-runtime D6).

import type { VaultAgentId } from "../vault/types";
import type { AgentHookRuntime } from "./AgentHookRuntime";

export interface HookInstallOutcome {
  installed: boolean;
  reason?: string;
  /** Exact lock paths a committed install could not clean up (D5, D9). */
  unresolved?: string[];
}

export interface HookRemoveOutcome {
  removed: boolean;
  reason?: string;
  /** Exact lock paths a committed removal could not clean up (D5, D9). */
  unresolved?: string[];
}

export interface HookInstaller {
  install(): Promise<HookInstallOutcome>;
  uninstall(): Promise<HookRemoveOutcome>;
}

export type WarningOperation = "runtime" | "install" | "uninstall";

export interface AgentHookSlot {
  agent: VaultAgentId;
  installer: HookInstaller;
  initialEnabled: boolean;
}

export interface AgentHookControllerOptions {
  agents: AgentHookSlot[];
  createRuntime: () => Promise<AgentHookRuntime>;
  setContributor: (contributor: AgentHookRuntime | undefined) => void;
  /** `agent` is null for a runtime-level failure that belongs to no single agent. */
  onWarning?: (agent: VaultAgentId | null, operation: WarningOperation, reason: string) => void;
}

interface AgentState {
  installer: HookInstaller;
  desiredEnabled: boolean;
  desiredRevision: number;
  reconcilePromise: Promise<void> | null;
  reconciledRevision: number;
  reconciledEnabled: boolean;
  reconciledSuccessfully: boolean;
  authorityGranted: boolean;
  /** Keeps the unregistered-agent warning to one per agent, not one per reconcile. */
  registrationWarned: boolean;
}

/** Owns serialized per-agent hook configuration and runtime authority as one lifecycle. */
export class AgentHookController {
  private readonly states = new Map<VaultAgentId, AgentState>();
  private runtime: AgentHookRuntime | null = null;
  private startPromise: Promise<void> | null = null;
  private attached = false;
  private started = false;
  private disposed = false;

  public constructor(private readonly options: AgentHookControllerOptions) {
    for (const slot of options.agents) {
      if (this.states.has(slot.agent)) {
        throw new Error(`duplicate agent hook slot: ${slot.agent}`);
      }
      this.states.set(slot.agent, {
        installer: slot.installer,
        desiredEnabled: slot.initialEnabled,
        desiredRevision: 0,
        reconcilePromise: null,
        reconciledRevision: -1,
        reconciledEnabled: false,
        reconciledSuccessfully: false,
        authorityGranted: false,
        registrationWarned: false,
      });
    }
  }

  public start(): Promise<void> {
    if (!this.startPromise) {
      this.started = true;
      this.startPromise = this.initialize();
    }
    return this.startPromise;
  }

  public setDesiredEnabled(agent: VaultAgentId, enabled: boolean): Promise<void> {
    const state = this.states.get(agent);
    if (!state) {
      return Promise.resolve();
    }
    state.desiredEnabled = enabled;
    state.desiredRevision += 1;
    if (!enabled) {
      this.revokeAgent(agent, state);
    }
    return this.started ? this.reconcileLatest(agent, state) : Promise.resolve();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const state of this.states.values()) {
      state.desiredEnabled = false;
      state.desiredRevision += 1;
    }
    this.revokeAll();
    this.runtime?.dispose();
    this.runtime = null;
  }

  private async initialize(): Promise<void> {
    const runtimePromise = this.options.createRuntime().then(
      (runtime) => ({ runtime }),
      (error: unknown) => ({ error }),
    );
    const reconciliation = Promise.all([...this.states].map(([agent, state]) => this.reconcileLatest(agent, state)));
    const runtimeResult = await runtimePromise;
    if ("error" in runtimeResult) {
      await reconciliation;
      this.options.onWarning?.(
        null,
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
    this.revokeAll();
    // Replay agents that finished reconciling before the runtime existed —
    // their `applyReconciledAuthority` found no runtime and revoked. Waiting
    // for `reconciliation` here would let one slow installer withhold an
    // already-installed agent's authority (D6).
    this.replayReconciledAuthority();
    await reconciliation;
    this.applyAllReconciledAuthority();
  }

  /**
   * Grant-only pass: agents still mid-reconcile are left exactly as
   * `revokeAll()` left them, so the replay adds no revocation of its own.
   */
  private replayReconciledAuthority(): void {
    for (const [agent, state] of this.states) {
      if (
        state.reconciledRevision === state.desiredRevision &&
        state.reconciledEnabled &&
        state.reconciledSuccessfully
      ) {
        this.applyReconciledAuthority(agent, state);
      }
    }
  }

  private reconcileLatest(agent: VaultAgentId, state: AgentState): Promise<void> {
    if (state.reconcilePromise) {
      return state.reconcilePromise;
    }
    state.reconcilePromise = this.runReconciliation(agent, state).finally(() => {
      state.reconcilePromise = null;
    });
    return state.reconcilePromise;
  }

  private async runReconciliation(agent: VaultAgentId, state: AgentState): Promise<void> {
    while (!this.disposed) {
      const revision = state.desiredRevision;
      const enabled = state.desiredEnabled;

      if (!enabled) {
        this.revokeAgent(agent, state);
      }

      const outcome = enabled ? await this.install(state) : await this.uninstall(state);
      if (this.disposed) {
        return;
      }
      if (revision !== state.desiredRevision) {
        this.revokeAgent(agent, state);
        continue;
      }

      state.reconciledRevision = revision;
      state.reconciledEnabled = enabled;
      state.reconciledSuccessfully = outcome.success;
      this.applyReconciledAuthority(agent, state);
      // A committed install still warns separately when cleanup left residue
      // behind (D9); a failed install or a removal carrying unresolved paths
      // both already report through `success: false`.
      if (!outcome.success || (outcome.unresolved && outcome.unresolved.length > 0)) {
        this.options.onWarning?.(agent, enabled ? "install" : "uninstall", outcome.reason);
      }
      return;
    }
  }

  private async install(state: AgentState): Promise<{ success: boolean; reason: string; unresolved?: string[] }> {
    try {
      const result = await state.installer.install();
      if (!result.installed) {
        return { success: false, reason: result.reason ?? "install-failed", unresolved: result.unresolved };
      }
      // Installed config plus cleanup warning still grants authority; the
      // warning is emitted separately by the caller (D9).
      const unresolved = result.unresolved;
      return unresolved && unresolved.length > 0
        ? { success: true, reason: `lock-release-failed: ${unresolved.join(", ")}`, unresolved }
        : { success: true, reason: "" };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private async uninstall(state: AgentState): Promise<{ success: boolean; reason: string; unresolved?: string[] }> {
    try {
      const result = await state.installer.uninstall();
      if (!result.removed && result.reason !== "not-installed") {
        return { success: false, reason: result.reason ?? "uninstall-failed", unresolved: result.unresolved };
      }
      // Any removal result carrying unresolved paths remains unsuccessful at
      // the controller boundary, even though the config write committed (D5, D9).
      const unresolved = result.unresolved;
      return unresolved && unresolved.length > 0
        ? { success: false, reason: `lock-release-failed: ${unresolved.join(", ")}`, unresolved }
        : { success: true, reason: "" };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private applyAllReconciledAuthority(): void {
    for (const [agent, state] of this.states) {
      this.applyReconciledAuthority(agent, state);
    }
  }

  private applyReconciledAuthority(agent: VaultAgentId, state: AgentState): void {
    if (
      this.runtime &&
      state.reconciledRevision === state.desiredRevision &&
      state.reconciledEnabled &&
      state.reconciledSuccessfully
    ) {
      if (!state.authorityGranted) {
        // `setAgentEnabled` ignores unknown ids, so granting authority for an
        // unregistered agent would install hooks and attach the contributor
        // while emitting no coordinates at all.
        if (!this.runtime.isAgentRegistered(agent)) {
          if (!state.registrationWarned) {
            state.registrationWarned = true;
            this.options.onWarning?.(agent, "runtime", "agent-not-registered");
          }
          this.revokeAgent(agent, state);
          return;
        }
        this.runtime.setAgentEnabled(agent, true);
        state.authorityGranted = true;
        this.attachContributor();
      }
      return;
    }
    this.revokeAgent(agent, state);
  }

  /**
   * Detaching releases every tracked session through the contributor, so it
   * happens only when the agent losing authority was the last one holding it.
   */
  private revokeAgent(agent: VaultAgentId, state: AgentState): void {
    state.authorityGranted = false;
    if (!this.hasAuthoritativeAgent()) {
      this.detachContributor();
    }
    this.runtime?.setAgentEnabled(agent, false);
  }

  private revokeAll(): void {
    for (const state of this.states.values()) {
      state.authorityGranted = false;
    }
    this.detachContributor();
    for (const agent of this.states.keys()) {
      this.runtime?.setAgentEnabled(agent, false);
    }
  }

  private hasAuthoritativeAgent(): boolean {
    for (const state of this.states.values()) {
      if (state.authorityGranted) {
        return true;
      }
    }
    return false;
  }

  private attachContributor(): void {
    if (this.attached || !this.runtime) {
      return;
    }
    this.options.setContributor(this.runtime);
    this.attached = true;
  }

  private detachContributor(): void {
    this.options.setContributor(undefined);
    this.attached = false;
  }
}
