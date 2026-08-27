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
    createRegistration: claudeAgentRegistration,
  },
];

export function isAgentHookEnabled(entry: AgentHookRegistryEntry, settings: SettingsReader): boolean {
  return settings<boolean>(entry.enabledSettingKey) ?? false;
}
