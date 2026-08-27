// src/agentHooks/install/agentHookRegistry.ts — One list of hook-capable agents.
// Activation and the uninstall command both read it, so an agent cannot be
// installable from a setting yet invisible to "remove everything" (D9).

import { homedir } from "node:os";
import { join } from "node:path";
import type { VaultAgentId } from "../../vault/types";
import type { AgentHookRegistration } from "../AgentHookRuntime";
import { claudeAgentRegistration } from "../agents/claude";
import { cursorAgentRegistration } from "../agents/cursor";
import { claudeConfigAdapter } from "./claudeConfigAdapter";
import { cursorConfigAdapter } from "./cursorConfigAdapter";
import type { AgentConfigAdapter } from "./types";

/** Reads one `anywhereTerminal.*` setting; injected so this module never imports vscode. */
export type SettingsReader = <T>(key: string) => T | undefined;

/** Ambient location inputs, injectable so a test never reaches a real user's config. */
export interface AgentHookEnvironment {
  homeDirectory?: () => string;
  environment?: NodeJS.ProcessEnv;
}

export interface AgentHookRegistryEntry {
  agent: VaultAgentId;
  /** Settings key, relative to the `anywhereTerminal` section. */
  enabledSettingKey: string;
  /**
   * Adapters resolve their config path per call, so a location setting takes
   * effect on the next window reload (D4) rather than mid-session — moving an
   * agent's file live would leave our entries in the old one.
   */
  createAdapter: (settings: SettingsReader, location?: AgentHookEnvironment) => AgentConfigAdapter;
  /**
   * An adapter pinned to one config file. Used to clean up the destination an
   * agent was previously installed into when its location setting moves, which
   * `createAdapter` can no longer reach (round-1 B1).
   */
  createAdapterForPath: (configPath: string) => AgentConfigAdapter;
  createRegistration: () => AgentHookRegistration;
}

export const AGENT_HOOK_UNINSTALL_COMMAND = "anywhereTerminal.agentHooks.uninstall";

export const AGENT_HOOK_REGISTRY: readonly AgentHookRegistryEntry[] = [
  {
    agent: "cursor",
    // Shipped before the `agentHooks.*` family existed and deliberately not
    // renamed: § 4.7 requires it stay put under the user.
    enabledSettingKey: "cursorAgent.hooks.enabled",
    createAdapter: (_settings, location) =>
      cursorConfigAdapter(join((location?.homeDirectory ?? homedir)(), ".cursor", "hooks.json")),
    createAdapterForPath: (configPath) => cursorConfigAdapter(configPath),
    createRegistration: cursorAgentRegistration,
  },
  {
    agent: "claude",
    enabledSettingKey: "agentHooks.claude.enabled",
    createAdapter: (settings, location) =>
      claudeConfigAdapter({
        configuredDirectory: () => settings<string>("agentHooks.claudeConfigDir"),
        environment: location?.environment,
        homeDirectory: location?.homeDirectory,
      }),
    createAdapterForPath: (configPath) => claudeConfigAdapter({ configFile: configPath }),
    createRegistration: claudeAgentRegistration,
  },
];

export function isAgentHookEnabled(entry: AgentHookRegistryEntry, settings: SettingsReader): boolean {
  return settings<boolean>(entry.enabledSettingKey) ?? false;
}

export interface DestinationMigration {
  /** What the map should record afterwards — unchanged when cleanup failed. */
  destination: string;
  cleaned: boolean;
  /** True when the caller must reconcile the new destination. */
  reconcile: boolean;
}

/**
 * One awaited operation for a config destination that moved mid-session
 * (round-2 B1). Cleanup runs first and is *awaited*; the recorded destination
 * advances only when it succeeded, so a failure is retried on the next change
 * rather than stranding entries in a file nothing remembers. Either way the new
 * destination is reconciled — leaving the agent installed nowhere is worse than
 * leaving a stale entry behind.
 */
export async function migrateAgentDestination(options: {
  entry: AgentHookRegistryEntry;
  previous: string;
  current: string;
  storageRoot: string;
  uninstall: (adapter: AgentConfigAdapter) => Promise<{ removed: boolean; reason?: string }>;
}): Promise<DestinationMigration> {
  const { entry, previous, current } = options;
  if (previous === current) {
    return { destination: current, cleaned: true, reconcile: false };
  }
  const outcome = await options
    .uninstall(entry.createAdapterForPath(previous))
    .catch(() => ({ removed: false, reason: "write-failed" }));
  // "Nothing was there" is a clean outcome, not a failure.
  const cleaned = outcome.removed || outcome.reason === "not-installed";
  return { destination: cleaned ? current : previous, cleaned, reconcile: true };
}
