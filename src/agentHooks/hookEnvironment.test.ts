// src/agentHooks/hookEnvironment.test.ts — what a terminal is told, and who
// keeps the receiver up.

import { describe, expect, it, vi } from "vitest";
import { CursorHookController } from "../cursor/CursorHookController";
import type { CursorHookRuntime, SessionEnvironmentContributor } from "../cursor/CursorHookRuntime";
import { withHookEnvironment } from "./hookEnvironment";

function credentials(): SessionEnvironmentContributor & { released: string[] } {
  const released: string[] = [];
  return {
    released,
    create: (sessionId) => ({ ANYWHERE_TERMINAL_AGENT_HOOK_URL: `http://127.0.0.1/${sessionId}/tok` }),
    release: (sessionId) => {
      released.push(sessionId);
    },
  };
}

describe("what a terminal is told", () => {
  it("carries the credential and the configuration directory together", () => {
    const composed = withHookEnvironment(credentials(), () => ({ OPENCODE_CONFIG_DIR: "/storage/opencode-config" }));

    expect(composed.create("t1")).toEqual({
      ANYWHERE_TERMINAL_AGENT_HOOK_URL: "http://127.0.0.1/t1/tok",
      OPENCODE_CONFIG_DIR: "/storage/opencode-config",
    });
  });

  it("carries the credential alone while reporting is off", () => {
    const composed = withHookEnvironment(credentials(), () => ({}));

    expect(composed.create("t1")).toEqual({ ANYWHERE_TERMINAL_AGENT_HOOK_URL: "http://127.0.0.1/t1/tok" });
  });

  it("still revokes the credential, which is the only part that expires", () => {
    const issuer = credentials();
    withHookEnvironment(issuer, () => ({ OPENCODE_CONFIG_DIR: "/d" })).release("t1");

    expect(issuer.released).toEqual(["t1"]);
  });

  // The setting can flip long after the contributor was installed, and the
  // controller has no reason to reinstall it — Cursor may be holding the
  // receiver up on its own (.reviews/round-1.md B5).
  it("carries the directory chosen after the contributor was installed", () => {
    let current: Record<string, string> = {};
    const composed = withHookEnvironment(credentials(), () => current);

    current = { OPENCODE_CONFIG_DIR: "/storage/opencode-config" };

    expect(composed.create("t1").OPENCODE_CONFIG_DIR).toBe("/storage/opencode-config");
  });

  // The spec forfeits the report for a terminal that already selects its own
  // directory; that selection is per terminal, not per extension host
  // (spec.md "Reporting preserves the user's own OpenCode configuration").
  it("yields to the directory the terminal is already being spawned with", () => {
    const composed = withHookEnvironment(credentials(), () => ({ OPENCODE_CONFIG_DIR: "/storage/opencode-config" }));

    const contributed = composed.create("t1", { OPENCODE_CONFIG_DIR: "/home/u/my-opencode" });

    expect(contributed.OPENCODE_CONFIG_DIR).toBeUndefined();
    expect(contributed.ANYWHERE_TERMINAL_AGENT_HOOK_URL).toBe("http://127.0.0.1/t1/tok");
  });
});

describe("who keeps the receiver up", () => {
  function harness(options: { installs: boolean; receiver?: boolean }) {
    const runtime = { setEnabled: vi.fn(), dispose: vi.fn() } as unknown as CursorHookRuntime;
    const contributors: Array<CursorHookRuntime | undefined> = [];
    const controller = new CursorHookController({
      initialEnabled: false,
      ...(options.receiver === undefined ? {} : { initialReceiverEnabled: options.receiver }),
      installer: {
        install: () => Promise.resolve(options.installs ? { installed: true } : { installed: false }),
        uninstall: () => Promise.resolve({ removed: true }),
      },
      createRuntime: () => Promise.resolve(runtime),
      setContributor: (contributor) => contributors.push(contributor),
    });
    return { controller, runtime, contributors };
  }

  it("runs for a reporting agent even though Cursor's hook file was never written", async () => {
    const h = harness({ installs: false, receiver: true });
    await h.controller.start();

    expect(h.contributors.at(-1)).toBeDefined();
    expect(h.runtime.setEnabled).toHaveBeenCalledWith(true);
  });

  it("stays down when nobody wants it", async () => {
    const h = harness({ installs: false });
    await h.controller.start();

    expect(h.contributors.at(-1)).toBeUndefined();
  });

  it("comes up when a reporting agent is switched on later", async () => {
    const h = harness({ installs: false });
    await h.controller.start();

    h.controller.setDesiredReceiverEnabled(true);

    expect(h.contributors.at(-1)).toBeDefined();
  });

  it("goes down again when that agent is switched off and Cursor never had it", async () => {
    const h = harness({ installs: false, receiver: true });
    await h.controller.start();

    h.controller.setDesiredReceiverEnabled(false);

    expect(h.contributors.at(-1)).toBeUndefined();
  });

  it("keeps running for the reporting agent when Cursor's hooks are switched off", async () => {
    const h = harness({ installs: true, receiver: true });
    await h.controller.start();
    await h.controller.setDesiredEnabled(true);

    await h.controller.setDesiredEnabled(false);

    expect(h.contributors.at(-1)).toBeDefined();
  });
});
