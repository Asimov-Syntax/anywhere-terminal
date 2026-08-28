import { createKeyedSerialQueue } from "../../utils/keyedSerialQueue";
import type { HookReconciliationOutcome } from "../AgentHookController";

export const AGENT_HOOK_UNINSTALL_COMMAND = "anywhereTerminal.agentHooks.uninstall";

export const AGENT_HOOK_SETTINGS = {
  cursor: { enabled: "anywhereTerminal.cursorAgent.hooks.enabled" },
  claude: {
    enabled: "anywhereTerminal.agentHooks.claude.enabled",
    configDir: "anywhereTerminal.agentHooks.claudeConfigDir",
  },
} as const;

export type AgentHookLifecycleAgent = keyof typeof AGENT_HOOK_SETTINGS;

export interface AgentHookRemovalResult extends HookReconciliationOutcome {
  agent: AgentHookLifecycleAgent;
}

export interface AgentHookRemovalSummary {
  success: boolean;
  message: string;
}

type AgentHookController = Pick<import("../AgentHookController").AgentHookController, "setDesiredEnabled">;

export interface AgentHookLifecycleOptions {
  controller: AgentHookController;
  /** Read inside the queued body, never while an event is being submitted. */
  readEnabled(agent: AgentHookLifecycleAgent): boolean;
}

/**
 * Serializes setting-driven reconciliation per agent without retaining a
 * destination, ownership record, or queued-event history. Installers resolve
 * their destination only after this lifecycle has read the current opt-in.
 */
export class AgentHookLifecycle {
  private readonly queue = createKeyedSerialQueue();

  public constructor(private readonly options: AgentHookLifecycleOptions) {}

  public reconcile(agent: AgentHookLifecycleAgent): Promise<void> {
    return this.enqueue(agent, () =>
      this.options.controller.setDesiredEnabled(agent, this.options.readEnabled(agent)),
    ).then(() => undefined);
  }

  public reconcileAll(): Promise<void> {
    return Promise.all(this.agents().map((agent) => this.reconcile(agent))).then(() => undefined);
  }

  /**
   * Removal has no historical sweep: each installer targets only the
   * destination it can resolve at the time this queued body starts.
   */
  public removeAll(): Promise<readonly AgentHookRemovalResult[]> {
    return Promise.all(
      this.agents().map((agent) =>
        this.enqueue(agent, async () => ({
          agent,
          ...(await this.options.controller.setDesiredEnabled(agent, false)),
        })),
      ),
    );
  }

  public handleConfigurationChange(affectsConfiguration: (key: string) => boolean): Promise<void> {
    const cursorEnabled = affectsConfiguration(AGENT_HOOK_SETTINGS.cursor.enabled);
    const claudeEnabled = affectsConfiguration(AGENT_HOOK_SETTINGS.claude.enabled);
    const claudeLocation = affectsConfiguration(AGENT_HOOK_SETTINGS.claude.configDir);
    const reconciliations: Promise<void>[] = [];

    if (cursorEnabled) {
      reconciliations.push(this.reconcile("cursor"));
    }
    if (claudeLocation) {
      reconciliations.push(this.reconcileClaudeLocation());
    } else if (claudeEnabled) {
      reconciliations.push(this.reconcile("claude"));
    }

    return Promise.all(reconciliations).then(() => undefined);
  }

  private agents(): readonly AgentHookLifecycleAgent[] {
    return ["cursor", "claude"];
  }

  private reconcileClaudeLocation(): Promise<void> {
    return this.enqueue("claude", async () => {
      await this.options.controller.setDesiredEnabled("claude", false);
      await this.options.controller.setDesiredEnabled("claude", this.options.readEnabled("claude"));
    });
  }

  private enqueue<T>(agent: AgentHookLifecycleAgent, operation: () => Promise<T>): Promise<T> {
    return this.queue.run(agent, operation);
  }
}

export function summarizeAgentHookRemoval(results: readonly AgentHookRemovalResult[]): AgentHookRemovalSummary {
  const failures = results.filter((result) => !result.success);
  if (failures.length === 0) {
    return { success: true, message: "AnyWhere Terminal agent hook removal completed." };
  }

  const details = failures.map((result) => {
    const paths = [...new Set([...(result.affected ?? []), ...(result.unresolved ?? [])])];
    const reason = paths.length === 0 ? result.reason : `${result.reason}: ${paths.join(", ")}`;
    return `${result.agent} (${reason})`;
  });
  return {
    success: false,
    message: `AnyWhere Terminal could not remove all agent hooks: ${details.join("; ")}.`,
  };
}
