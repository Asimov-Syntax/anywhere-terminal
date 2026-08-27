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
  /**
   * Set when the ledger could not be read at all. A read failure is not a write
   * failure and must not be reported as one — and it must not escape as a
   * rejection either, which is how one transient failure disabled reconciliation
   * for an agent until restart (round-9 B16).
   */
  unavailable?: true;
}

/** One running transition per agent, plus at most one rerun carrying what arrived meanwhile. */
interface CoalescedTransitions {
  force: boolean;
  rerun: boolean;
  settled: Promise<TransitionOutcome>;
}

export class AgentHookTransitions {
  /** The repository's own keyed serialization (round-4 S4) — one lane per agent. */
  private readonly queue = createKeyedSerialQueue();
  private readonly coalesced = new Map<VaultAgentId, CoalescedTransitions>();

  public constructor(private readonly options: AgentHookTransitionsOptions) {}

  /**
   * Queues one transition for an agent. `force` reconciles even when the desired
   * value is unchanged, which a location-only edit needs: skipping it there would
   * leave the agent installed nowhere (round-2 B1).
   *
   * A burst collapses to the state it ended on: while one transition runs, later
   * submissions mark a single rerun rather than each queueing a body of their own,
   * so N events cost at most two transitions instead of N (round-7 B13). Nothing
   * is dropped — the rerun is the obligation to converge, and every caller is
   * answered by the run that settles after their intent was folded in.
   */
  public submit(entry: AgentHookRegistryEntry, force = false): Promise<TransitionOutcome> {
    const running = this.coalesced.get(entry.agent);
    if (running) {
      running.force = running.force || force;
      running.rerun = true;
      return running.settled;
    }
    const state: CoalescedTransitions = { force, rerun: false, settled: Promise.resolve() as never };
    state.settled = this.queue.run(entry.agent, () => this.converge(entry, state));
    this.coalesced.set(entry.agent, state);
    return state.settled;
  }

  /** Runs until nothing arrived while the last run was in flight. */
  private async converge(entry: AgentHookRegistryEntry, state: CoalescedTransitions): Promise<TransitionOutcome> {
    try {
      for (;;) {
        const force = state.force;
        state.force = false;
        state.rerun = false;
        const outcome = await this.transition(entry, force);
        // Checked in the same synchronous step the await resumes in, so a
        // submission cannot land between the check and the release and be lost.
        if (!state.rerun) {
          return outcome;
        }
      }
    } finally {
      // Released however the run ends. Leaving it behind on a throw cached a
      // rejected promise that every later submission for this agent got back,
      // so one unreadable ledger stopped the agent reconciling for the rest of
      // the session (round-9 B16).
      this.coalesced.delete(entry.agent);
    }
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
  public async uninstallEverything(): Promise<AgentUninstallResult[]> {
    // Settled, not all: one agent whose ledger cannot be read used to discard
    // every other agent's result, so the user was shown no summary at all for
    // work that did happen (round-9 B16).
    const settled = await Promise.allSettled(
      this.options.registry.map((entry) =>
        this.queue.run(entry.agent, async (): Promise<AgentUninstallResult> => {
          // Same reason as `transition`: "remove everything" is exactly the claim
          // a stale inventory makes falsely (round-7 B5).
          await this.options.ledger.refresh(entry.agent);
          // The one place a claim we do not hold is ours to drop: "remove
          // everything" means every installation's registration, which is what
          // the user asked for (D9, D18).
          await this.options.ledger.releaseEverything(entry.agent);
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
    return settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            agent: this.options.registry[index]?.agent as VaultAgentId,
            destinations: [],
            left: [],
            removed: false,
            reason: "write-failed" as const,
          },
    );
  }

  private async transition(entry: AgentHookRegistryEntry, force: boolean): Promise<TransitionOutcome> {
    const { ledger, settings, location } = this.options;
    // This operation's own read. Everything below freezes an inventory from it,
    // and an inventory built from a view another window has already changed
    // reports a cleanup done that never ran (round-7 B5).
    const destination = entry.createAdapter(settings, location).configPath();
    try {
      await ledger.refresh(entry.agent);
    } catch {
      // Nothing below may run on an inventory we could not read: that is the
      // stale-view cleanup claim round-7 B5 removed. Reported, not thrown.
      this.options.onWarning?.(entry.agent, "the hook record could not be read, so nothing was reconciled");
      return { agent: entry.agent, destination, pending: [], reconciled: false, unavailable: true };
    }
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

  /**
   * What THIS installation may clean: where it installed, plus anything nobody
   * claims any more. A path another installation still claims is deliberately
   * absent — it is a live registration belonging to a different profile, and
   * sweeping it was how two of them removed each other (round-9 B14).
   */
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
