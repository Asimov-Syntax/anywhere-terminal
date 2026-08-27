// src/agentHooks/install/agentHookEvents.ts — What one workspace configuration
// event means for each registered agent. Extracted from the activation listener
// so the decision can be tested without VS Code: the listener body is where a
// location change was detected and then submitted as "nothing to force", and no
// transition-level test could have caught it (round-9 B15).

import type { AgentHookRegistryEntry } from "./agentHookRegistry";

/** The one thing this decision needs from a `ConfigurationChangeEvent`. */
export type SettingChanged = (key: string) => boolean;

export interface AgentHookSubmission {
  entry: AgentHookRegistryEntry;
  /**
   * Reconcile even when the desired state did not change. A moved configuration
   * directory leaves enablement exactly as it was, so an unforced submission
   * finds nothing to do and the hooks stay at the old path — or nowhere.
   */
  force: boolean;
}

const SETTING_PREFIX = "anywhereTerminal.";

/**
 * The agents an event concerns, and whether each must reconcile regardless of
 * its desired state. Answering for every agent on every event was round-7 B13;
 * answering without forcing a move was round-9 B15.
 */
export function agentHookSubmissions(
  registry: readonly AgentHookRegistryEntry[],
  changed: SettingChanged,
): AgentHookSubmission[] {
  return registry.flatMap((entry) => {
    const enabled = changed(`${SETTING_PREFIX}${entry.enabledSettingKey}`);
    const moved = entry.locationSettingKeys.some((key) => changed(`${SETTING_PREFIX}${key}`));
    return enabled || moved ? [{ entry, force: moved }] : [];
  });
}
