// src/agentHooks/install/agentHookTransitions.ts — One owner for every change to
// an agent's hook installation (D13). Enable, disable and destination-move are
// the same operation on a per-agent serial queue, so two configuration events
// can never interleave into a state neither of them asked for, and a cleanup
// that failed is carried in the ledger until it succeeds — including across a
// restart, which the previous in-memory destination map could not survive.

import type { VaultAgentId } from "../../vault/types";
import {
  type AgentHookEnvironment,
  type AgentHookRegistryEntry,
  isAgentHookEnabled,
  type SettingsReader,
} from "./agentHookRegistry";
import type { ManagedEntryLedger } from "./managedEntryLedger";
import type { AgentConfigAdapter, HookRemoveOutcome } from "./types";

export interface AgentHookUninstaller {
  uninstall(): Promise<HookRemoveOutcome>;
}

export interface AgentHookTransitionsOptions {
  registry: readonly AgentHookRegistryEntry[];
  settings: SettingsReader;
  ledger: ManagedEntryLedger;
  location?: AgentHookEnvironment;
  /** Builds the uninstaller for one exact destination the settings may no longer name. */
  createUninstaller: (adapter: AgentConfigAdapter, agent: VaultAgentId) => AgentHookUninstaller;
  /** The controller's serialized enable/disable. Called forced, never assumed. */
  setDesiredEnabled: (agent: VaultAgentId, enabled: boolean) => Promise<void>;
  onWarning?: (agent: VaultAgentId, message: string) => void;
}

export interface AgentUninstallResult extends HookRemoveOutcome {
  agent: VaultAgentId;
  /** Every destination this agent's entries were cleared from. */
  destinations: string[];
}

export interface TransitionOutcome {
  agent: VaultAgentId;
  destination: string;
  /** Destinations still holding our entries after this transition. */
  pending: string[];
  reconciled: boolean;
}

export class AgentHookTransitions {
  private readonly queues = new Map<VaultAgentId, Promise<unknown>>();

  public constructor(private readonly options: AgentHookTransitionsOptions) {}

  /**
   * Queues one transition for an agent. `force` reconciles even when the desired
   * value is unchanged, which a location-only edit needs: skipping it there would
   * leave the agent installed nowhere (round-2 B1).
   */
  public submit(entry: AgentHookRegistryEntry, force = false): Promise<TransitionOutcome> {
    return this.enqueue(entry.agent, () => this.transition(entry, force));
  }

  /** Every agent, at activation: retries what a previous session could not clean. */
  public reconcileAll(): Promise<TransitionOutcome[]> {
    return Promise.all(this.options.registry.map((entry) => this.submit(entry)));
  }

  /**
   * "Remove everything" (D9), now including what a failed cleanup left behind:
   * the case a user actually hits is a setting already false and a config file
   * still carrying our entries — sometimes more than one.
   */
  public uninstallEverything(): Promise<AgentUninstallResult[]> {
    return Promise.all(
      this.options.registry.map((entry) =>
        this.enqueue(entry.agent, async (): Promise<AgentUninstallResult> => {
          const destinations = [
            ...new Set([
              entry.createAdapter(this.options.settings, this.options.location).configPath(),
              ...this.destinationsToClean(entry.agent),
            ]),
          ];
          let removed = false;
          let reason: HookRemoveOutcome["reason"];
          for (const destination of destinations) {
            const outcome = await this.clean(entry, destination);
            removed = removed || outcome.removed;
            reason = outcome.removed ? reason : (outcome.reason ?? reason);
            if (outcome.removed || outcome.reason === "not-installed") {
              await this.options.ledger.clearPending(entry.agent, destination);
            }
          }
          return { agent: entry.agent, destinations, removed, reason };
        }),
      ),
    );
  }

  private enqueue<T>(agent: VaultAgentId, work: () => Promise<T>): Promise<T> {
    // Chained onto the agent's tail, never onto a shared one: a slow cursor
    // transition must not delay claude's.
    const next = (this.queues.get(agent) ?? Promise.resolve()).then(work, work);
    this.queues.set(
      agent,
      next.catch(() => undefined),
    );
    return next;
  }

  private async transition(entry: AgentHookRegistryEntry, force: boolean): Promise<TransitionOutcome> {
    const { ledger, settings, location } = this.options;
    const destination = entry.createAdapter(settings, location).configPath();
    const recorded = ledger.destination(entry.agent);
    const stale = this.destinationsToClean(entry.agent).filter((candidate) => candidate !== destination);
    let moved = false;

    for (const candidate of stale) {
      const outcome = await this.clean(entry, candidate);
      // "Nothing was there" is a clean outcome, not a failure.
      if (outcome.removed || outcome.reason === "not-installed") {
        await ledger.clearPending(entry.agent, candidate);
      } else {
        await ledger.recordPending(entry.agent, candidate);
        this.options.onWarning?.(entry.agent, `hooks left behind in ${candidate} (${outcome.reason ?? "unknown"})`);
      }
      moved = moved || candidate === recorded;
    }

    const reconciled = force || moved;
    if (reconciled) {
      // Forced through false first: the desired value is usually unchanged by a
      // location edit, and a no-op would leave nothing installed anywhere.
      await this.options.setDesiredEnabled(entry.agent, false);
      await this.options.setDesiredEnabled(entry.agent, isAgentHookEnabled(entry, settings));
    }
    return { agent: entry.agent, destination, pending: ledger.pending(entry.agent), reconciled };
  }

  /** The recorded destination plus anything a previous attempt could not clear. */
  private destinationsToClean(agent: VaultAgentId): string[] {
    const { ledger } = this.options;
    const recorded = ledger.destination(agent);
    return [...new Set([...(recorded ? [recorded] : []), ...ledger.pending(agent)])];
  }

  private clean(entry: AgentHookRegistryEntry, destination: string): Promise<HookRemoveOutcome> {
    return this.options
      .createUninstaller(entry.createAdapterForPath(destination), entry.agent)
      .uninstall()
      .catch(() => ({ removed: false, reason: "write-failed" }) as HookRemoveOutcome);
  }
}

export function summarizeUninstall(results: readonly AgentUninstallResult[]): string {
  return results
    .map(({ agent, removed, reason }) =>
      removed
        ? `${agent}: removed`
        : `${agent}: ${reason === "not-installed" ? "nothing to remove" : (reason ?? "failed")}`,
    )
    .join(" · ");
}
