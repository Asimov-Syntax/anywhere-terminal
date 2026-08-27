// src/agentHooks/install/uninstallAllAgents.ts — "Remove everything" (D9).
// Calls each adapter's removal path directly rather than reconciling from
// settings, because the case a user actually hits is an agent whose setting is
// already false and whose config file still carries our entries.

import type { VaultAgentId } from "../../vault/types";
import { AGENT_HOOK_REGISTRY, type AgentHookEnvironment, type SettingsReader } from "./agentHookRegistry";
import { ManagedConfigInstaller } from "./ManagedConfigInstaller";
import type { AgentConfigAdapter, HookRemoveOutcome } from "./types";

export interface AgentUninstallResult extends HookRemoveOutcome {
  agent: VaultAgentId;
  configPath: string;
}

export interface UninstallAllOptions {
  storageRoot: string;
  settings: SettingsReader;
  location?: AgentHookEnvironment;
  createInstaller?: (storageRoot: string, adapter: AgentConfigAdapter) => { uninstall(): Promise<HookRemoveOutcome> };
}

export async function uninstallAllAgents(options: UninstallAllOptions): Promise<AgentUninstallResult[]> {
  const results: AgentUninstallResult[] = [];
  for (const entry of AGENT_HOOK_REGISTRY) {
    const adapter = entry.createAdapter(options.settings, options.location);
    const installer =
      options.createInstaller?.(options.storageRoot, adapter) ??
      new ManagedConfigInstaller(adapter, { storageRoot: options.storageRoot });
    // One agent's failure must not strand the next one's entries.
    const outcome = await installer
      .uninstall()
      .catch((): HookRemoveOutcome => ({ removed: false, reason: "write-failed" }));
    results.push({ agent: entry.agent, configPath: adapter.configPath(), ...outcome });
  }
  return results;
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
