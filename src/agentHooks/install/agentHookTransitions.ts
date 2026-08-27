// src/agentHooks/install/agentHookTransitions.ts — One owner for every change to
// an agent's hook installation (D13). Enable, disable and destination-move are
// the same operation on a per-agent serial queue, so two configuration events
// can never interleave into a state neither of them asked for, and a cleanup
// that failed is carried in the ledger until it succeeds — including across a
// restart, which the previous in-memory destination map could not survive.

import { resolve } from "node:path";
import { createKeyedSerialQueue } from "../../utils/keyedSerialQueue";
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
  /** Every destination that was attempted. */
  destinations: string[];
  /** Those still holding our entries afterwards. */
  left: string[];
}

export interface TransitionOutcome {
  agent: VaultAgentId;
  destination: string;
  /** Destinations still holding our entries after this transition. */
  pending: string[];
  reconciled: boolean;
  /** Set when a destination that could neither be cleaned nor tracked stopped the move (round-5 B8). */
  blockedBy?: string;
}

export class AgentHookTransitions {
  /** The repository's own keyed serialization (round-4 S4) — one lane per agent. */
  private readonly queue = createKeyedSerialQueue();

  public constructor(private readonly options: AgentHookTransitionsOptions) {}

  /**
   * Queues one transition for an agent. `force` reconciles even when the desired
   * value is unchanged, which a location-only edit needs: skipping it there would
   * leave the agent installed nowhere (round-2 B1).
   */
  public submit(entry: AgentHookRegistryEntry, force = false): Promise<TransitionOutcome> {
    return this.queue.run(entry.agent, () => this.transition(entry, force));
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
        this.queue.run(entry.agent, async (): Promise<AgentUninstallResult> => {
          const destinations = [
            ...new Set([
              entry.createAdapter(this.options.settings, this.options.location).configPath(),
              ...this.destinationsToClean(entry.agent),
            ]),
          ];
          const left: string[] = [];
          let cleared = 0;
          let reason: HookRemoveOutcome["reason"];
          for (const destination of destinations) {
            const outcome = await this.clean(entry, destination);
            if (outcome.removed || outcome.reason === "not-installed") {
              cleared += outcome.removed ? 1 : 0;
              await this.options.ledger.clearPending(entry.agent, destination);
              continue;
            }
            // Kept, not forgotten: a destination we failed to clear is exactly
            // what the next attempt has to find (round-4 B8).
            left.push(destination);
            reason = outcome.reason ?? reason;
            await this.trackPending(entry.agent, destination, outcome.reason);
          }
          // Success is EVERY destination clean. Reporting a partial sweep as
          // removed told the user their configuration was clean when it was not.
          return {
            agent: entry.agent,
            destinations,
            left,
            removed: left.length === 0 && cleared > 0,
            reason: left.length === 0 && cleared === 0 ? "not-installed" : reason,
          };
        }),
      ),
    );
  }

  private async transition(entry: AgentHookRegistryEntry, force: boolean): Promise<TransitionOutcome> {
    const { ledger, settings, location } = this.options;
    const destination = entry.createAdapter(settings, location).configPath();
    const recorded = ledger.destination(entry.agent);
    // Canonicalized on both sides: the ledger stores resolved paths, so a
    // settings value spelled with a `..` would otherwise look like a move away
    // from the very file it names.
    const stale = this.destinationsToClean(entry.agent).filter(
      (candidate) => resolve(candidate) !== resolve(destination),
    );
    let moved = false;

    for (const candidate of stale) {
      const outcome = await this.clean(entry, candidate);
      // "Nothing was there" is a clean outcome, not a failure.
      if (outcome.removed || outcome.reason === "not-installed") {
        await ledger.clearPending(entry.agent, candidate);
      } else if (!(await this.trackPending(entry.agent, candidate, outcome.reason))) {
        // Neither cleaned nor tracked. Continuing would install at the new
        // destination and overwrite the only record naming this one, leaving a
        // file we modified with nothing pointing at it (round-5 B8). The agent
        // stays where it is instead, which is recoverable.
        return {
          agent: entry.agent,
          destination: recorded ?? candidate,
          pending: ledger.pending(entry.agent),
          reconciled: false,
          blockedBy: candidate,
        };
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

  /** False when the ceiling refused the destination — the caller decides what that costs. */
  private async trackPending(
    agent: VaultAgentId,
    destination: string,
    reason: HookRemoveOutcome["reason"],
  ): Promise<boolean> {
    const tracked = await this.options.ledger.recordPending(agent, destination);
    this.options.onWarning?.(
      agent,
      tracked
        ? `hooks left behind in ${destination} (${reason ?? "unknown"})`
        : `hooks left behind in ${destination}; too many destinations already await cleanup, so this agent stays where it is until one is cleared`,
    );
    return tracked;
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
    .map(({ agent, removed, reason, left }) => {
      if (removed) {
        return `${agent}: removed`;
      }
      // The destinations are named because "failed" alone leaves the user with
      // no way to find what is still in their configuration.
      if (left.length > 0) {
        return `${agent}: still in ${left.join(", ")} (${reason ?? "failed"})`;
      }
      return `${agent}: ${reason === "not-installed" ? "nothing to remove" : (reason ?? "failed")}`;
    })
    .join(" · ");
}
