// src/agentHooks/hookEnvironment.test.ts — what a terminal is told, and who
// keeps the receiver up.

import { describe, expect, it, vi } from "vitest";
import { AgentHookController } from "./AgentHookController";
import type { AgentHookRuntime, SessionEnvironmentContributor } from "./AgentHookRuntime";
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

describe("who keeps the shared receiver up", () => {
  function harness(cursorEnabled: boolean, opencodeEnabled: boolean) {
    const runtime = {
      isAgentRegistered: vi.fn(() => true),
      setAgentEnabled: vi.fn(),
      dispose: vi.fn(),
    } as unknown as AgentHookRuntime;
    const contributors: Array<AgentHookRuntime | undefined> = [];
    const installer = {
      install: () => Promise.resolve({ installed: true }),
      uninstall: () => Promise.resolve({ removed: true }),
    };
    const controller = new AgentHookController({
      agents: [
        { agent: "cursor", initialEnabled: cursorEnabled, installer },
        { agent: "opencode", initialEnabled: opencodeEnabled, installer },
      ],
      createRuntime: () => Promise.resolve(runtime),
      setContributor: (contributor) => contributors.push(contributor),
    });
    return { controller, runtime, contributors };
  }

  it("runs for OpenCode even when Cursor hooks are off", async () => {
    const h = harness(false, true);
    await h.controller.start();

    expect(h.runtime.setAgentEnabled).toHaveBeenCalledWith("opencode", true);
    expect(h.contributors.at(-1)).toBe(h.runtime);
  });

  it("keeps running for Cursor when OpenCode is switched off", async () => {
    const h = harness(true, true);
    await h.controller.start();

    await h.controller.setDesiredEnabled("opencode", false);

    expect(h.runtime.setAgentEnabled).toHaveBeenCalledWith("opencode", false);
    expect(h.runtime.setAgentEnabled).toHaveBeenCalledWith("cursor", true);
    expect(h.contributors.at(-1)).toBe(h.runtime);
  });

  it("detaches after the final enabled agent is switched off", async () => {
    const h = harness(false, true);
    await h.controller.start();

    await h.controller.setDesiredEnabled("opencode", false);

    expect(h.contributors.at(-1)).toBeUndefined();
  });
});
