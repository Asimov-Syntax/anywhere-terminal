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
  private readonly tails = new Map<AgentHookLifecycleAgent, Promise<void>>();

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
    const agents = this.agents().filter((agent) =>
      AGENT_HOOK_SETTINGS[agent].some((key) => affectsConfiguration(`anywhereTerminal.${key}`)),
    );
    return Promise.all(agents.map((agent) => this.reconcile(agent))).then(() => undefined);
  }

  private agents(): readonly AgentHookLifecycleAgent[] {
    return ["cursor", "claude"];
  }

  private enqueue(agent: AgentHookLifecycleAgent, operation: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(agent) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.tails.set(agent, next);
    void next.then(
      () => this.clearTail(agent, next),
      () => this.clearTail(agent, next),
    );
    return next;
  }

  private clearTail(agent: AgentHookLifecycleAgent, tail: Promise<void>): void {
    if (this.tails.get(agent) === tail) {
      this.tails.delete(agent);
    }
  }
}
