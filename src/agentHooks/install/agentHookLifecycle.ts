import { createKeyedSerialQueue } from "../../utils/keyedSerialQueue";

export const AGENT_HOOK_UNINSTALL_COMMAND = "anywhereTerminal.agentHooks.uninstall";

export const AGENT_HOOK_SETTINGS = {
  cursor: ["cursorAgent.hooks.enabled"],
  claude: ["agentHooks.claude.enabled", "agentHooks.claudeConfigDir"],
} as const satisfies Record<AgentHookLifecycleAgent, readonly string[]>;

export type AgentHookLifecycleAgent = "cursor" | "claude";

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
    return this.enqueue(agent, () => this.options.controller.setDesiredEnabled(agent, this.options.readEnabled(agent)));
  }

  public reconcileAll(): Promise<void> {
    return Promise.all(this.agents().map((agent) => this.reconcile(agent))).then(() => undefined);
  }

  /**
   * Removal has no historical sweep: each installer targets only the
   * destination it can resolve at the time this queued body starts.
   */
  public removeAll(): Promise<void> {
    return Promise.all(
      this.agents().map((agent) => this.enqueue(agent, () => this.options.controller.setDesiredEnabled(agent, false))),
    ).then(() => undefined);
  }

  public handleConfigurationChange(affectsConfiguration: (key: string) => boolean): Promise<void> {
    const cursorEnabled = affectsConfiguration("anywhereTerminal.cursorAgent.hooks.enabled");
    const claudeEnabled = affectsConfiguration("anywhereTerminal.agentHooks.claude.enabled");
    const claudeLocation = affectsConfiguration("anywhereTerminal.agentHooks.claudeConfigDir");
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

  private enqueue(agent: AgentHookLifecycleAgent, operation: () => Promise<void>): Promise<void> {
    return this.queue.run(agent, operation);
  }
}
