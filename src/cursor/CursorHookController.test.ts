import { describe, expect, it, vi } from "vitest";
import { CursorHookController } from "./CursorHookController";
import type { CursorHookInstallResult, CursorHookRemoveResult } from "./CursorHookInstaller";
import type { CursorHookRuntime } from "./CursorHookRuntime";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function runtimeDouble(events: string[] = []) {
  return {
    setEnabled: vi.fn((enabled: boolean) => events.push(`runtime:${enabled}`)),
    // Deliberately not recorded in `events`: the ordering those assertions pin
    // down is attach/detach against the runtime's own enable, and reporting is
    // a separate switch that rides along with both.
    setReportingEnabled: vi.fn(),
    create: vi.fn(() => ({})),
    release: vi.fn(),
    dispose: vi.fn(() => events.push("dispose")),
  } as unknown as CursorHookRuntime;
}

function controllerDeps(options: {
  initialEnabled?: boolean;
  runtimePromise?: Promise<CursorHookRuntime>;
  install?: () => Promise<CursorHookInstallResult>;
  uninstall?: () => Promise<CursorHookRemoveResult>;
  events?: string[];
}) {
  const events = options.events ?? [];
  const runtime = runtimeDouble(events);
  const installer = {
    install: vi.fn(options.install ?? (async () => ({ installed: true }))),
    uninstall: vi.fn(options.uninstall ?? (async () => ({ removed: true }))),
  };
  const setContributor = vi.fn((value?: CursorHookRuntime) => events.push(value ? "attach" : "detach"));
  const onWarning = vi.fn();
  const controller = new CursorHookController({
    initialEnabled: options.initialEnabled ?? false,
    installer,
    createRuntime: () => options.runtimePromise ?? Promise.resolve(runtime),
    setContributor,
    onWarning,
  });
  return { controller, events, installer, onWarning, runtime, setContributor };
}

describe("CursorHookController", () => {
  it("attaches and enables authority only after installation succeeds", async () => {
    const install = deferred<CursorHookInstallResult>();
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

    expect(runtime.setEnabled).not.toHaveBeenCalledWith(true);
    expect(setContributor).not.toHaveBeenCalledWith(runtime);
    expect(events.at(-2)).toBe("detach");
    expect(events.at(-1)).toBe("runtime:false");
    expect(onWarning).toHaveBeenCalledWith("install", reason);
  });

  it("uses a setting change made while runtime creation awaits", async () => {
    const runtimeReady = deferred<CursorHookRuntime>();
    const events: string[] = [];
    const runtime = runtimeDouble(events);
    const { controller, installer } = controllerDeps({
      initialEnabled: true,
      runtimePromise: runtimeReady.promise,
      events,
    });

    const starting = controller.start();
    const changing = controller.setDesiredEnabled(false);
    runtimeReady.resolve(runtime);
    await Promise.all([starting, changing]);

    expect(installer.install).toHaveBeenCalledTimes(1);
    expect(installer.uninstall).toHaveBeenCalled();
    expect(runtime.setEnabled).not.toHaveBeenCalledWith(true);
  });

  it("revokes immediately and ignores a successful stale install when disabled mid-install", async () => {
    const install = deferred<CursorHookInstallResult>();
    const { controller, events, installer, runtime } = controllerDeps({
      initialEnabled: true,
      install: () => install.promise,
    });

    const starting = controller.start();
    await vi.waitFor(() => expect(installer.install).toHaveBeenCalledTimes(1));
    const disabling = controller.setDesiredEnabled(false);
    expect(events.at(-1)).toBe("detach");

    install.resolve({ installed: true });
    await Promise.all([starting, disabling]);

    expect(installer.uninstall).toHaveBeenCalledTimes(1);
    expect(runtime.setEnabled).toHaveBeenCalledWith(false);
    expect(runtime.setEnabled).not.toHaveBeenCalledWith(true);
  });

  it("reconciles the latest re-enable before restoring authority", async () => {
    const firstInstall = deferred<CursorHookInstallResult>();
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
    void controller.setDesiredEnabled(false);
    const reenabled = controller.setDesiredEnabled(true);
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
});
