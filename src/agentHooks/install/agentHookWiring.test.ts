// src/agentHooks/install/agentHookWiring.test.ts — The registry is only useful
// if package.json actually declares what it names and the runtime actually
// receives what it lists, so both halves are asserted against the real files.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentHookRuntime } from "../AgentHookRuntime";
import {
  AGENT_HOOK_REGISTRY,
  AGENT_HOOK_UNINSTALL_COMMAND,
  isAgentHookEnabled,
  type SettingsReader,
} from "./agentHookRegistry";
import { ManagedConfigInstaller } from "./ManagedConfigInstaller";
import { summarizeUninstall, uninstallAllAgents } from "./uninstallAllAgents";

const tempDirectories: string[] = [];

async function manifest() {
  return JSON.parse(await readFile(join(__dirname, "..", "..", "..", "package.json"), "utf8")) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      configuration: { properties: Record<string, { type: string; scope?: string; default?: unknown }> };
    };
  };
}

function settingsFrom(values: Record<string, unknown>): SettingsReader {
  return <T>(key: string) => values[key] as T | undefined;
}

/**
 * Every path here is redirected into a temp home. Cursor's adapter resolves
 * `~/.cursor/hooks.json` from the real environment, so a test that forgot this
 * would install into the developer's own Cursor configuration.
 */
async function agentConfigs() {
  const directory = await mkdtemp(join(tmpdir(), "agent-hook-wiring-"));
  tempDirectories.push(directory);
  const location = { homeDirectory: () => directory, environment: {} as NodeJS.ProcessEnv };
  const settings = settingsFrom({ "agentHooks.claudeConfigDir": join(directory, "claude") });
  const storageRoot = join(directory, "storage");
  const adapters = AGENT_HOOK_REGISTRY.map((entry) => ({ entry, adapter: entry.createAdapter(settings, location) }));
  for (const { adapter } of adapters) {
    expect(adapter.configPath().startsWith(directory)).toBe(true);
  }
  return { settings, location, storageRoot, adapters };
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("agent hook wiring", () => {
  it("declares every registry settings key in package.json as a machine-scoped boolean", async () => {
    const { properties } = (await manifest()).contributes.configuration;

    for (const entry of AGENT_HOOK_REGISTRY) {
      const declared = properties[`anywhereTerminal.${entry.enabledSettingKey}`];
      expect(declared, entry.enabledSettingKey).toBeDefined();
      expect(declared.type).toBe("boolean");
      expect(declared.default).toBe(false);
      expect(declared.scope).toBe("machine");
    }
  });

  it("declares the claude config directory override as a machine-scoped string", async () => {
    const declared = (await manifest()).contributes.configuration.properties[
      "anywhereTerminal.agentHooks.claudeConfigDir"
    ];

    expect(declared).toMatchObject({ type: "string", default: "", scope: "machine" });
  });

  it("declares the uninstall command in package.json", async () => {
    const commands = (await manifest()).contributes.commands;

    expect(commands.map((command) => command.command)).toContain(AGENT_HOOK_UNINSTALL_COMMAND);
  });

  it("registers every listed agent on the runtime with a distinct slot", async () => {
    const runtime = await createAgentHookRuntime(
      AGENT_HOOK_REGISTRY.map((entry) => entry.createRegistration()),
      {},
      { onStatus: () => undefined, onReasonCode: () => undefined },
    );

    for (const entry of AGENT_HOOK_REGISTRY) {
      expect(runtime.isAgentRegistered(entry.agent), entry.agent).toBe(true);
    }
    const slugs = AGENT_HOOK_REGISTRY.map((entry) => entry.createRegistration().slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const envVars = AGENT_HOOK_REGISTRY.map((entry) => entry.createRegistration().envVar);
    expect(new Set(envVars).size).toBe(envVars.length);
  });

  it("reads each agent's enablement from its own key only", () => {
    for (const entry of AGENT_HOOK_REGISTRY) {
      const onlyThisOne = settingsFrom({ [entry.enabledSettingKey]: true });
      expect(isAgentHookEnabled(entry, onlyThisOne)).toBe(true);
      for (const other of AGENT_HOOK_REGISTRY.filter((candidate) => candidate !== entry)) {
        expect(isAgentHookEnabled(other, onlyThisOne)).toBe(false);
      }
    }
  });

  it("gives every agent a config path and an installer of its own", async () => {
    const { adapters, storageRoot } = await agentConfigs();

    const paths = adapters.map(({ adapter }) => adapter.configPath());
    expect(new Set(paths).size).toBe(paths.length);
    const directories = adapters.map(({ adapter }) => adapter.wrapperLocation("linux").directoryName);
    expect(new Set(directories).size).toBe(directories.length);
    expect(storageRoot).toBeTruthy();
  });

  it("can build an adapter pinned to a destination the settings no longer name", async () => {
    const { storageRoot, adapters } = await agentConfigs();
    for (const { entry, adapter } of adapters) {
      const previous = adapter.configPath();
      const installer = new ManagedConfigInstaller(adapter, { storageRoot, platform: "linux" });
      expect((await installer.install()).installed, entry.agent).toBe(true);

      // The user moves the setting elsewhere; only the pinned adapter can still
      // reach what was left behind (round-1 B1).
      const pinned = entry.createAdapterForPath(previous);
      expect(pinned.configPath()).toBe(previous);
      expect(
        (await new ManagedConfigInstaller(pinned, { storageRoot, platform: "linux" }).uninstall()).removed,
        entry.agent,
      ).toBe(true);
      expect(await readFile(previous, "utf8")).not.toContain(adapter.wrapperLocation("linux").directoryName);
    }
  });

  it("removes every agent's entries whatever the settings say", async () => {
    const { settings, location, storageRoot, adapters } = await agentConfigs();
    for (const { adapter } of adapters) {
      const installer = new ManagedConfigInstaller(adapter, { storageRoot, platform: "linux" });
      expect((await installer.install()).installed, adapter.configPath()).toBe(true);
    }

    // Every setting is false — exactly the state a user is in after disabling
    // the toggle and finding the config still modified.
    const results = await uninstallAllAgents({
      storageRoot,
      settings,
      location,
      createInstaller: (root, adapter) => new ManagedConfigInstaller(adapter, { storageRoot: root, platform: "linux" }),
    });

    expect(results.map((result) => result.agent)).toEqual(AGENT_HOOK_REGISTRY.map((entry) => entry.agent));
    expect(results.every((result) => result.removed)).toBe(true);
    for (const { adapter } of adapters) {
      expect(await readFile(adapter.configPath(), "utf8")).not.toContain(
        adapter.wrapperLocation("linux").directoryName,
      );
    }
  });

  it("continues past one agent's failure and reports both outcomes", async () => {
    const { settings, location, storageRoot, adapters } = await agentConfigs();
    const [first, second] = adapters;
    const installer = new ManagedConfigInstaller(second.adapter, { storageRoot, platform: "linux" });
    await installer.install();

    const results = await uninstallAllAgents({
      storageRoot,
      settings,
      location,
      createInstaller: (root, adapter) =>
        adapter.configPath() === first.adapter.configPath()
          ? {
              uninstall: async () => {
                throw new Error("permission denied");
              },
            }
          : new ManagedConfigInstaller(adapter, { storageRoot: root, platform: "linux" }),
    });

    expect(results[0]).toMatchObject({ agent: first.entry.agent, removed: false, reason: "write-failed" });
    expect(results[1]).toMatchObject({ agent: second.entry.agent, removed: true });
    expect(summarizeUninstall(results)).toBe(`${first.entry.agent}: write-failed · ${second.entry.agent}: removed`);
  });

  it("reports an agent that was never installed as nothing to remove", async () => {
    const { settings, location, storageRoot } = await agentConfigs();

    const results = await uninstallAllAgents({
      storageRoot,
      settings,
      location,
      createInstaller: (root, adapter) => new ManagedConfigInstaller(adapter, { storageRoot: root, platform: "linux" }),
    });

    expect(summarizeUninstall(results)).toContain("nothing to remove");
  });
});
