import { describe, expect, it, vi } from "vitest";
import type { VaultAgentId } from "../vault/types";
import { AgentHookController, type HookInstallOutcome, type HookRemoveOutcome } from "./AgentHookController";
import type { AgentHookRuntime } from "./AgentHookRuntime";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runtimeDouble(events: string[] = [], registered?: VaultAgentId[]) {
  return {
    // Cursor keeps the original `runtime:<bool>` label so the migrated
    // assertions read unchanged; other agents are labelled by id.
    setAgentEnabled: vi.fn((agent: VaultAgentId, enabled: boolean) =>
      events.push(agent === "cursor" ? `runtime:${enabled}` : `${agent}:${enabled}`),
    ),
    isAgentRegistered: vi.fn((agent: VaultAgentId) => registered?.includes(agent) ?? true),
    create: vi.fn(() => ({})),
    release: vi.fn(),
    dispose: vi.fn(() => events.push("dispose")),
  } as unknown as AgentHookRuntime;
}

function installerDouble(options: {
  install?: () => Promise<HookInstallOutcome>;
  uninstall?: () => Promise<HookRemoveOutcome>;
}) {
  return {
    install: vi.fn(options.install ?? (async () => ({ installed: true }))),
    uninstall: vi.fn(options.uninstall ?? (async () => ({ removed: true }))),
  };
}

function controllerDeps(options: {
  initialEnabled?: boolean;
  runtimePromise?: Promise<AgentHookRuntime>;
  install?: () => Promise<HookInstallOutcome>;
  uninstall?: () => Promise<HookRemoveOutcome>;
  events?: string[];
  secondAgent?: { agent: VaultAgentId; initialEnabled?: boolean; install?: () => Promise<HookInstallOutcome> };
}) {
  const events = options.events ?? [];
  const runtime = runtimeDouble(events);
  const installer = installerDouble(options);
  const secondInstaller = options.secondAgent ? installerDouble({ install: options.secondAgent.install }) : undefined;
  const setContributor = vi.fn((value?: AgentHookRuntime) => events.push(value ? "attach" : "detach"));
  const onWarning = vi.fn();
  const controller = new AgentHookController({
    agents: [
      { agent: "cursor", installer, initialEnabled: options.initialEnabled ?? false },
      ...(options.secondAgent && secondInstaller
        ? [
            {
              agent: options.secondAgent.agent,
              installer: secondInstaller,
              initialEnabled: options.secondAgent.initialEnabled ?? false,
            },
          ]
        : []),
    ],
    createRuntime: () => options.runtimePromise ?? Promise.resolve(runtime),
    setContributor,
    onWarning,
  });
  return { controller, events, installer, secondInstaller, onWarning, runtime, setContributor };
}

describe("AgentHookController", () => {
  it("attaches and enables authority only after installation succeeds", async () => {
    const install = deferred<HookInstallOutcome>();
    const { controller, events, runtime, setContributor } = controllerDeps({
      initialEnabled: true,
      install: () => install.promise,
    });

    const starting = controller.start();
    await vi.waitFor(() => expect(events).toContain("runtime:false"));
    expect(setContributor).not.toHaveBeenCalledWith(runtime);

    install.resolve({ installed: true });
    await starting;

    expect(events).toEqual(["detach", "runtime:false", "runtime:true", "attach"]);
  });

  it.each([
    "unsupported-config",
    "write-failed",
    "windows-probe-failed",
  ] as const)("detaches and disables after %s installation failure", async (reason) => {
    const { controller, events, onWarning, runtime, setContributor } = controllerDeps({
      initialEnabled: true,
      install: async () => ({ installed: false, reason }),
    });

    await controller.start();

    expect(runtime.setAgentEnabled).not.toHaveBeenCalledWith("cursor", true);
    expect(setContributor).not.toHaveBeenCalledWith(runtime);
    expect(events.at(-2)).toBe("detach");
    expect(events.at(-1)).toBe("runtime:false");
    expect(onWarning).toHaveBeenCalledWith("cursor", "install", reason);
  });

  it("uses a setting change made while runtime creation awaits", async () => {
    const runtimeReady = deferred<AgentHookRuntime>();
    const events: string[] = [];
    const runtime = runtimeDouble(events);
    const { controller, installer } = controllerDeps({
      initialEnabled: true,
      runtimePromise: runtimeReady.promise,
      events,
    });

    const starting = controller.start();
    const changing = controller.setDesiredEnabled("cursor", false);
    runtimeReady.resolve(runtime);
    await Promise.all([starting, changing]);

    expect(installer.install).toHaveBeenCalledTimes(1);
    expect(installer.uninstall).toHaveBeenCalled();
    expect(runtime.setAgentEnabled).not.toHaveBeenCalledWith("cursor", true);
  });

  it("revokes immediately and ignores a successful stale install when disabled mid-install", async () => {
    const install = deferred<HookInstallOutcome>();
    const { controller, events, installer, runtime } = controllerDeps({
      initialEnabled: true,
      install: () => install.promise,
    });

    const starting = controller.start();
    await vi.waitFor(() => expect(installer.install).toHaveBeenCalledTimes(1));
    const disabling = controller.setDesiredEnabled("cursor", false);
    expect(events.at(-1)).toBe("detach");

    install.resolve({ installed: true });
    await Promise.all([starting, disabling]);

    expect(installer.uninstall).toHaveBeenCalledTimes(1);
    expect(runtime.setAgentEnabled).toHaveBeenCalledWith("cursor", false);
    expect(runtime.setAgentEnabled).not.toHaveBeenCalledWith("cursor", true);
  });

  it("reconciles the latest re-enable before restoring authority", async () => {
    const firstInstall = deferred<HookInstallOutcome>();
    let installCount = 0;
    const { controller, events, installer } = controllerDeps({
      initialEnabled: true,
      install: () => {
        installCount += 1;
        return installCount === 1 ? firstInstall.promise : Promise.resolve({ installed: true });
      },
    });

    const starting = controller.start();
    await vi.waitFor(() => expect(installer.install).toHaveBeenCalledTimes(1));
    void controller.setDesiredEnabled("cursor", false);
    const reenabled = controller.setDesiredEnabled("cursor", true);
    firstInstall.resolve({ installed: true });
    await Promise.all([starting, reenabled]);

    expect(installer.install).toHaveBeenCalledTimes(2);
    expect(events.slice(-2)).toEqual(["runtime:true", "attach"]);
  });

  it("detaches before disabling and before runtime disposal", async () => {
    const events: string[] = [];
    const { controller } = controllerDeps({ initialEnabled: true, events });
    await controller.start();

    controller.dispose();

    expect(events.slice(-3)).toEqual(["detach", "runtime:false", "dispose"]);
  });

  describe("bind failure and disposal races", () => {
    it("leaves every pane on inference when the runtime cannot be created", async () => {
      const creation = deferred<AgentHookRuntime>();
      const { controller, events, onWarning, setContributor } = controllerDeps({
        initialEnabled: true,
        runtimePromise: creation.promise,
      });

      const starting = controller.start();
      creation.reject(new Error("EADDRINUSE"));
      await starting;

      expect(onWarning).toHaveBeenCalledWith(null, "runtime", "EADDRINUSE");
      expect(setContributor).not.toHaveBeenCalledWith(expect.anything());
      expect(events).not.toContain("attach");
    });

    it("disposes a runtime that resolves after disposal, and never attaches it", async () => {
      const creation = deferred<AgentHookRuntime>();
      const events: string[] = [];
      const late = runtimeDouble(events);
      const { controller, setContributor } = controllerDeps({
        initialEnabled: true,
        runtimePromise: creation.promise,
        events,
      });

      const starting = controller.start();
      controller.dispose();
      creation.resolve(late);
      await starting;

      expect(late.dispose).toHaveBeenCalledTimes(1);
      expect(setContributor).not.toHaveBeenCalledWith(late);
    });

    it("does not restore authority when a pending install completes after disposal", async () => {
      const install = deferred<HookInstallOutcome>();
      const { controller, events, installer, runtime, setContributor } = controllerDeps({
        initialEnabled: true,
        install: () => install.promise,
      });

      const starting = controller.start();
      await vi.waitFor(() => expect(installer.install).toHaveBeenCalledTimes(1));
      controller.dispose();
      install.resolve({ installed: true });
      await starting;

      expect(runtime.setAgentEnabled).not.toHaveBeenCalledWith("cursor", true);
      expect(setContributor).not.toHaveBeenCalledWith(runtime);
      expect(events).not.toContain("attach");
    });
  });

  describe("aggregate contributor lifecycle (D6)", () => {
    it("keeps the contributor attached when one of two agents is disabled", async () => {
      const { controller, events, runtime, setContributor } = controllerDeps({
        initialEnabled: true,
        secondAgent: { agent: "claude", initialEnabled: true },
      });
      await controller.start();
      expect(events).toContain("attach");
      const detachesAfterStart = () => events.slice(events.lastIndexOf("attach")).filter((e) => e === "detach").length;

      await controller.setDesiredEnabled("cursor", false);

      expect(detachesAfterStart()).toBe(0);
      expect(runtime.setAgentEnabled).toHaveBeenCalledWith("cursor", false);
      expect(setContributor).toHaveBeenLastCalledWith(runtime);
    });

    it("detaches only when the last authoritative agent goes away", async () => {
      const { controller, events } = controllerDeps({
        initialEnabled: true,
        secondAgent: { agent: "claude", initialEnabled: true },
      });
      await controller.start();

      await controller.setDesiredEnabled("cursor", false);
      await controller.setDesiredEnabled("claude", false);

      expect(events.at(-1)).toBe("claude:false");
      expect(events.slice(events.lastIndexOf("attach"))).toContain("detach");
    });

    it("grants authority to the agent whose install succeeded while the other is still pending", async () => {
      const pending = deferred<HookInstallOutcome>();
      const { controller, events, runtime } = controllerDeps({
        initialEnabled: true,
        secondAgent: { agent: "claude", initialEnabled: true, install: () => pending.promise },
      });

      const starting = controller.start();
      await vi.waitFor(() => expect(events).toContain("attach"));
      expect(runtime.setAgentEnabled).toHaveBeenCalledWith("cursor", true);
      expect(runtime.setAgentEnabled).not.toHaveBeenCalledWith("claude", true);

      pending.resolve({ installed: true });
      await starting;
      expect(runtime.setAgentEnabled).toHaveBeenCalledWith("claude", true);
    });

    it("grants a reconciled agent's authority as soon as the runtime arrives, not when its peer finishes (B4)", async () => {
      const runtimeReady = deferred<AgentHookRuntime>();
      const pending = deferred<HookInstallOutcome>();
      const events: string[] = [];
      const runtime = runtimeDouble(events);
      const { controller, installer } = controllerDeps({
        initialEnabled: true,
        runtimePromise: runtimeReady.promise,
        events,
        secondAgent: { agent: "claude", initialEnabled: true, install: () => pending.promise },
      });

      const starting = controller.start();
      // Cursor's install resolves while the runtime is still being created.
      await vi.waitFor(() => expect(installer.install).toHaveBeenCalledTimes(1));
      runtimeReady.resolve(runtime);

      await vi.waitFor(() => expect(runtime.setAgentEnabled).toHaveBeenCalledWith("cursor", true));
      expect(events).toContain("attach");
      expect(runtime.setAgentEnabled).not.toHaveBeenCalledWith("claude", true);

      pending.resolve({ installed: true });
      await starting;
      expect(runtime.setAgentEnabled).toHaveBeenCalledWith("claude", true);
    });

    it("refuses a duplicate agent slot instead of silently overwriting it (W1)", () => {
      const installer = installerDouble({});
      expect(
        () =>
          new AgentHookController({
            agents: [
              { agent: "cursor", installer, initialEnabled: true },
              { agent: "cursor", installer, initialEnabled: false },
            ],
            createRuntime: () => Promise.resolve(runtimeDouble()),
            setContributor: vi.fn(),
          }),
      ).toThrow(/cursor/);
    });

    it("withholds authority for an agent the runtime never registered (W1)", async () => {
      const events: string[] = [];
      const runtime = runtimeDouble(events, ["cursor"]);
      const { controller, onWarning, setContributor } = controllerDeps({
        initialEnabled: false,
        runtimePromise: Promise.resolve(runtime),
        events,
        secondAgent: { agent: "claude", initialEnabled: true },
      });

      await controller.start();

      expect(runtime.setAgentEnabled).not.toHaveBeenCalledWith("claude", true);
      expect(setContributor).not.toHaveBeenCalledWith(runtime);
      expect(events).not.toContain("attach");
      expect(onWarning).toHaveBeenCalledWith("claude", "runtime", "agent-not-registered");
    });

    it("keeps one agent's stale revision from disturbing the other", async () => {
      const { controller, events, secondInstaller } = controllerDeps({
        initialEnabled: true,
        secondAgent: { agent: "claude", initialEnabled: true },
      });
      await controller.start();
      const attachedAt = events.lastIndexOf("attach");

      void controller.setDesiredEnabled("cursor", false);
      await controller.setDesiredEnabled("cursor", true);

      expect(secondInstaller?.install).toHaveBeenCalledTimes(1);
      expect(events.slice(attachedAt)).not.toContain("claude:false");
    });
  });
});
