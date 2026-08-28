import { describe, expect, it, vi } from "vitest";
import { AgentHookLifecycle } from "./agentHookLifecycle";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function lifecycleDouble(enabled: { cursor: boolean; claude: boolean }) {
  const controller = { setDesiredEnabled: vi.fn(async () => undefined) };
  const lifecycle = new AgentHookLifecycle({
    controller,
    readEnabled: (agent) => enabled[agent],
  });
  return { controller, lifecycle };
}

describe("AgentHookLifecycle", () => {
  it("reads the enabled setting when its queued reconciliation begins", async () => {
    const enabled = { cursor: true, claude: false };
    const first = deferred();
    const firstStarted = deferred();
    const controller = {
      setDesiredEnabled: vi.fn(async () => {
        if (controller.setDesiredEnabled.mock.calls.length === 1) {
          firstStarted.resolve();
          await first.promise;
        }
      }),
    };
    const lifecycle = new AgentHookLifecycle({ controller, readEnabled: (agent) => enabled[agent] });

    const firstReconcile = lifecycle.reconcile("claude");
    await firstStarted.promise;
    expect(controller.setDesiredEnabled).toHaveBeenCalledWith("claude", false);
    enabled.claude = true;
    const secondReconcile = lifecycle.reconcile("claude");
    first.resolve();
    await Promise.all([firstReconcile, secondReconcile]);

    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["claude", false],
      ["claude", true],
    ]);
  });

  it("keeps agent queues independent while preserving each agent's event order", async () => {
    const enabled = { cursor: true, claude: true };
    const cursor = deferred();
    const cursorStarted = deferred();
    const controller = {
      setDesiredEnabled: vi.fn(async (agent: "cursor" | "claude") => {
        if (agent === "cursor" && controller.setDesiredEnabled.mock.calls.length === 1) {
          cursorStarted.resolve();
          await cursor.promise;
        }
      }),
    };
    const lifecycle = new AgentHookLifecycle({ controller, readEnabled: (agent) => enabled[agent] });

    const firstCursor = lifecycle.reconcile("cursor");
    const claude = lifecycle.reconcile("claude");
    await cursorStarted.promise;
    expect(controller.setDesiredEnabled).toHaveBeenCalledWith("cursor", true);
    enabled.cursor = false;
    const secondCursor = lifecycle.reconcile("cursor");
    await claude;
    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["cursor", true],
      ["claude", true],
    ]);

    cursor.resolve();
    await Promise.all([firstCursor, secondCursor]);
    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["cursor", true],
      ["claude", true],
      ["cursor", false],
    ]);
  });

  it("submits enabled and location changes for Claude, and only enabled changes for Cursor", async () => {
    const enabled = { cursor: false, claude: true };
    const { controller, lifecycle } = lifecycleDouble(enabled);

    await lifecycle.handleConfigurationChange((key) => key === "anywhereTerminal.agentHooks.claudeConfigDir");
    expect(controller.setDesiredEnabled).toHaveBeenCalledWith("claude", true);

    controller.setDesiredEnabled.mockClear();
    await lifecycle.handleConfigurationChange((key) => key === "anywhereTerminal.cursorAgent.hooks.enabled");
    expect(controller.setDesiredEnabled).toHaveBeenCalledWith("cursor", false);
  });

  it("remove-all revokes each agent against only its currently derivable destination", async () => {
    const enabled = { cursor: true, claude: true };
    const { controller, lifecycle } = lifecycleDouble(enabled);

    await lifecycle.removeAll();
    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["cursor", false],
      ["claude", false],
    ]);

    controller.setDesiredEnabled.mockClear();
    await lifecycle.reconcile("claude");
    expect(controller.setDesiredEnabled).toHaveBeenCalledWith("claude", true);
  });
});
