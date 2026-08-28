import { describe, expect, it, vi } from "vitest";
import { AgentHookLifecycle, summarizeAgentHookRemoval } from "./agentHookLifecycle";

const successfulOutcome = { success: true, reason: "" } as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function lifecycleDouble(enabled: { cursor: boolean; claude: boolean }) {
  const controller = { setDesiredEnabled: vi.fn(async () => successfulOutcome) };
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
        return successfulOutcome;
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
        return successfulOutcome;
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

  it("revokes Claude before a slow failed reinstallation after a location change", async () => {
    const enabled = { cursor: false, claude: true };
    const reinstallation = deferred();
    const reinstallationStarted = deferred();
    const controller = {
      setDesiredEnabled: vi.fn(async (_agent: "cursor" | "claude", desired: boolean) => {
        if (desired) {
          reinstallationStarted.resolve();
          await reinstallation.promise;
          throw new Error("install failed");
        }
        return successfulOutcome;
      }),
    };
    const lifecycle = new AgentHookLifecycle({ controller, readEnabled: (agent) => enabled[agent] });

    const change = lifecycle.handleConfigurationChange((key) => key === "anywhereTerminal.agentHooks.claudeConfigDir");
    await reinstallationStarted.promise;
    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["claude", false],
      ["claude", true],
    ]);

    reinstallation.resolve();
    await expect(change).rejects.toThrow("install failed");
  });

  it("rereads Claude opt-in after location revocation", async () => {
    const enabled = { cursor: false, claude: false };
    const disable = deferred();
    const disableStarted = deferred();
    const controller = {
      setDesiredEnabled: vi.fn(async (_agent: "cursor" | "claude", desired: boolean) => {
        if (!desired) {
          disableStarted.resolve();
          await disable.promise;
        }
        return successfulOutcome;
      }),
    };
    const lifecycle = new AgentHookLifecycle({ controller, readEnabled: (agent) => enabled[agent] });

    const change = lifecycle.handleConfigurationChange((key) => key === "anywhereTerminal.agentHooks.claudeConfigDir");
    await disableStarted.promise;
    enabled.claude = true;
    disable.resolve();
    await change;

    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["claude", false],
      ["claude", true],
    ]);
  });

  it("runs the Claude location sequence once when enabled and location settings change together", async () => {
    const enabled = { cursor: false, claude: true };
    const { controller, lifecycle } = lifecycleDouble(enabled);

    await lifecycle.handleConfigurationChange(
      (key) =>
        key === "anywhereTerminal.agentHooks.claude.enabled" || key === "anywhereTerminal.agentHooks.claudeConfigDir",
    );

    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["claude", false],
      ["claude", true],
    ]);
  });

  it("orders racing Claude events and reads the location opt-in when its body begins", async () => {
    const enabled = { cursor: false, claude: true };
    const first = deferred();
    const firstStarted = deferred();
    const controller = {
      setDesiredEnabled: vi.fn(async (_agent: "cursor" | "claude", _desired: boolean) => {
        if (controller.setDesiredEnabled.mock.calls.length === 1) {
          firstStarted.resolve();
          await first.promise;
        }
        return successfulOutcome;
      }),
    };
    const lifecycle = new AgentHookLifecycle({ controller, readEnabled: (agent) => enabled[agent] });

    const initial = lifecycle.reconcile("claude");
    await firstStarted.promise;
    const location = lifecycle.handleConfigurationChange(
      (key) => key === "anywhereTerminal.agentHooks.claudeConfigDir",
    );
    enabled.claude = false;
    first.resolve();
    await Promise.all([initial, location]);

    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["claude", true],
      ["claude", false],
      ["claude", false],
    ]);
  });

  it("continues queued Claude work after a failed location reinstallation", async () => {
    const enabled = { cursor: false, claude: true };
    let failInstall = true;
    const controller = {
      setDesiredEnabled: vi.fn(async (_agent: "cursor" | "claude", desired: boolean) => {
        if (desired && failInstall) {
          failInstall = false;
          throw new Error("install failed");
        }
        return successfulOutcome;
      }),
    };
    const lifecycle = new AgentHookLifecycle({ controller, readEnabled: (agent) => enabled[agent] });

    const failedLocation = lifecycle.handleConfigurationChange(
      (key) => key === "anywhereTerminal.agentHooks.claudeConfigDir",
    );
    const recovery = lifecycle.reconcile("claude");
    await expect(failedLocation).rejects.toThrow("install failed");
    await recovery;

    expect(controller.setDesiredEnabled.mock.calls).toEqual([
      ["claude", false],
      ["claude", true],
      ["claude", true],
    ]);
  });

  it("submits only enabled changes for Cursor", async () => {
    const enabled = { cursor: false, claude: true };
    const { controller, lifecycle } = lifecycleDouble(enabled);

    await lifecycle.handleConfigurationChange((key) => key === "anywhereTerminal.cursorAgent.hooks.enabled");
    expect(controller.setDesiredEnabled).toHaveBeenCalledWith("cursor", false);
  });

  it("returns each settled per-agent removal outcome", async () => {
    const controller = {
      setDesiredEnabled: vi.fn(async (agent: "cursor" | "claude") =>
        agent === "cursor"
          ? successfulOutcome
          : {
              success: false,
              reason: "ownership-conflict",
              affected: ["/tmp/settings.json"],
            },
      ),
    };
    const lifecycle = new AgentHookLifecycle({
      controller,
      readEnabled: () => true,
    });

    await expect(lifecycle.removeAll()).resolves.toEqual([
      { agent: "cursor", success: true, reason: "" },
      {
        agent: "claude",
        success: false,
        reason: "ownership-conflict",
        affected: ["/tmp/settings.json"],
      },
    ]);
  });

  it("summarizes failed removals with agents, reasons, and exact paths", () => {
    expect(
      summarizeAgentHookRemoval([
        { agent: "cursor", success: true, reason: "" },
        {
          agent: "claude",
          success: false,
          reason: "ownership-conflict",
          affected: ["/tmp/settings.json"],
          unresolved: ["/tmp/settings.json.lock"],
        },
      ]),
    ).toEqual({
      success: false,
      message:
        "AnyWhere Terminal could not remove all agent hooks: claude (ownership-conflict: /tmp/settings.json, /tmp/settings.json.lock).",
    });
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
