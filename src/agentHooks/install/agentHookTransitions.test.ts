// src/agentHooks/install/agentHookTransitions.test.ts — One serialized owner per
// agent (D13). What is asserted here is what the previous in-memory destination
// map could not do: retry a cleanup that failed, survive a restart, and keep two
// overlapping configuration events from interleaving.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultAgentId } from "../../vault/types";
import {
  AGENT_HOOK_REGISTRY,
  type AgentHookEnvironment,
  type AgentHookRegistryEntry,
  type SettingsReader,
} from "./agentHookRegistry";
import { AgentHookTransitions, type AgentHookTransitionsOptions, summarizeUninstall } from "./agentHookTransitions";
import { ManagedConfigInstaller, managedWrapperCommand } from "./ManagedConfigInstaller";
import { ManagedEntryLedger, memoryLedgerStore } from "./managedEntryLedger";
import type { AgentConfigAdapter } from "./types";

const tempDirectories: string[] = [];

function settingsFrom(values: Record<string, unknown>): SettingsReader {
  return <T>(key: string) => values[key] as T | undefined;
}

/**
 * Every path here is redirected into a temp home. Cursor's adapter resolves
 * `~/.cursor/hooks.json` from the real environment, so a test that forgot this
 * would install into the developer's own Cursor configuration.
 */
async function agentConfigs() {
  const directory = await mkdtemp(join(tmpdir(), "agent-hook-transitions-"));
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

function installerFor(
  adapter: AgentConfigAdapter,
  storageRoot: string,
  ledger: ManagedEntryLedger,
  agent: VaultAgentId,
) {
  const options = { storageRoot, platform: "linux" as const };
  return new ManagedConfigInstaller(adapter, {
    ...options,
    ownership: ledger.ownership(agent, managedWrapperCommand(adapter, options)),
  });
}

/** Defaults every seam so each test overrides only what it is about. */
function transitionsFor(overrides: {
  settings: SettingsReader;
  location: AgentHookEnvironment;
  storageRoot: string;
  ledger?: ManagedEntryLedger;
  registry?: readonly AgentHookRegistryEntry[];
  createUninstaller?: AgentHookTransitionsOptions["createUninstaller"];
  setDesiredEnabled?: AgentHookTransitionsOptions["setDesiredEnabled"];
}) {
  const ledger = overrides.ledger ?? new ManagedEntryLedger(memoryLedgerStore());
  return new AgentHookTransitions({
    registry: overrides.registry ?? AGENT_HOOK_REGISTRY,
    settings: overrides.settings,
    location: overrides.location,
    ledger,
    createUninstaller:
      overrides.createUninstaller ?? ((adapter, agent) => installerFor(adapter, overrides.storageRoot, ledger, agent)),
    setDesiredEnabled: overrides.setDesiredEnabled ?? (async () => undefined),
  });
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("agent hook transitions", () => {
  it("removes every agent's entries whatever the settings say", async () => {
    const { settings, location, storageRoot, adapters } = await agentConfigs();
    for (const { adapter } of adapters) {
      const installer = new ManagedConfigInstaller(adapter, { storageRoot, platform: "linux" });
      expect((await installer.install()).installed, adapter.configPath()).toBe(true);
    }

    // Every setting is false — exactly the state a user is in after disabling
    // the toggle and finding the config still modified.
    const results = await transitionsFor({ settings, location, storageRoot }).uninstallEverything();

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
    await new ManagedConfigInstaller(second.adapter, { storageRoot, platform: "linux" }).install();

    const results = await transitionsFor({
      settings,
      location,
      storageRoot,
      createUninstaller: (adapter) =>
        adapter.configPath() === first.adapter.configPath()
          ? {
              uninstall: async () => {
                throw new Error("permission denied");
              },
            }
          : new ManagedConfigInstaller(adapter, { storageRoot, platform: "linux" }),
    }).uninstallEverything();

    expect(results[0]).toMatchObject({ agent: first.entry.agent, removed: false, reason: "write-failed" });
    expect(results[1]).toMatchObject({ agent: second.entry.agent, removed: true });
    expect(summarizeUninstall(results)).toBe(
      `${first.entry.agent}: still in ${resolve(first.adapter.configPath())} (write-failed) · ${second.entry.agent}: removed`,
    );
  });

  it("reports a partly-swept agent as not removed, naming what is left (round-4 B8)", async () => {
    const { settings, location, storageRoot, adapters } = await agentConfigs();
    const { entry, adapter } = adapters[0];
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    await installerFor(adapter, storageRoot, ledger, entry.agent).install();
    const stranded = `${adapter.configPath()}.stranded`;
    await ledger.recordPending(entry.agent, stranded);

    const [result] = await transitionsFor({
      settings,
      location,
      storageRoot,
      ledger,
      registry: [entry],
      createUninstaller: (target, agent) =>
        target.configPath() === resolve(stranded)
          ? {
              uninstall: async () => ({ removed: false, reason: "write-failed" }) as const,
            }
          : installerFor(target, storageRoot, ledger, agent),
    }).uninstallEverything();

    // One destination clean and one refused is not "removed".
    expect(result).toMatchObject({ agent: entry.agent, removed: false, reason: "write-failed" });
    expect(result.left).toEqual([resolve(stranded)]);
    expect(ledger.pending(entry.agent)).toEqual([resolve(stranded)]);
    expect(summarizeUninstall([result])).toContain(`still in ${resolve(stranded)}`);
  });

  it("reports an agent that was never installed as nothing to remove", async () => {
    const { settings, location, storageRoot } = await agentConfigs();

    const results = await transitionsFor({ settings, location, storageRoot }).uninstallEverything();

    expect(summarizeUninstall(results)).toContain("nothing to remove");
  });

  describe("a destination that moves mid-session (D13)", () => {
    it("cleans the file it left behind and reconciles the new one", async () => {
      const { settings, location, storageRoot, adapters } = await agentConfigs();
      const { entry, adapter } = adapters[0];
      const previous = adapter.configPath();
      const ledger = new ManagedEntryLedger(memoryLedgerStore());
      await installerFor(adapter, storageRoot, ledger, entry.agent).install();

      const moved = `${previous}.moved`;
      const movedEntry = { ...entry, createAdapter: () => entry.createAdapterForPath(moved) };
      const forced: Array<[string, boolean]> = [];
      const outcome = await transitionsFor({
        settings,
        location,
        storageRoot,
        ledger,
        registry: [movedEntry],
        setDesiredEnabled: async (agent, enabled) => {
          forced.push([agent, enabled]);
        },
      }).submit(movedEntry);

      expect(outcome).toMatchObject({ destination: moved, pending: [], reconciled: true });
      expect(forced).toEqual([
        [entry.agent, false],
        [entry.agent, false],
      ]);
      expect(await readFile(previous, "utf8")).not.toContain(adapter.wrapperLocation("linux").directoryName);
    });

    it("carries a failed cleanup as pending and retries it on the next transition", async () => {
      const { settings, location, storageRoot, adapters } = await agentConfigs();
      const { entry, adapter } = adapters[0];
      const previous = adapter.configPath();
      const ledger = new ManagedEntryLedger(memoryLedgerStore());
      await installerFor(adapter, storageRoot, ledger, entry.agent).install();

      const moved = `${previous}.moved`;
      const registry = [{ ...entry, createAdapter: () => entry.createAdapterForPath(moved) }];
      let refuse = true;
      const options = {
        settings,
        location,
        storageRoot,
        ledger,
        registry,
        createUninstaller: (target: AgentConfigAdapter, agent: VaultAgentId) =>
          refuse && target.configPath() === previous
            ? {
                uninstall: async () => {
                  throw new Error("permission denied");
                },
              }
            : installerFor(target, storageRoot, ledger, agent),
      };

      const movedEntry = registry[0];
      const failed = await transitionsFor(options).submit(movedEntry);
      expect(failed.pending).toEqual([previous]);
      // Forgetting it here is what stranded entries across a restart before D13.
      expect(ledger.pending(entry.agent)).toEqual([previous]);

      refuse = false;
      const retried = await transitionsFor(options).submit(movedEntry);

      expect(retried.pending).toEqual([]);
      expect(await readFile(previous, "utf8")).not.toContain(adapter.wrapperLocation("linux").directoryName);
    });

    it("settles overlapping transitions in submission order rather than interleaving them", async () => {
      const { settings, location, storageRoot, adapters } = await agentConfigs();
      const { entry } = adapters[0];
      const ledger = new ManagedEntryLedger(memoryLedgerStore());
      const order: string[] = [];
      const transitions = transitionsFor({
        settings,
        location,
        storageRoot,
        ledger,
        registry: [entry],
        setDesiredEnabled: async (_agent, enabled) => {
          order.push(`start:${enabled}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push(`end:${enabled}`);
        },
      });

      await Promise.all([transitions.submit(entry, true), transitions.submit(entry, true)]);

      // Never two starts in a row — the queue is what forbids it.
      expect(order).toEqual(Array.from({ length: 4 }, () => ["start:false", "end:false"]).flat());
    });

    it("does not delay one agent's transition behind another's", async () => {
      const { settings, location, storageRoot } = await agentConfigs();
      const ledger = new ManagedEntryLedger(memoryLedgerStore());
      const started: string[] = [];
      let release: () => void = () => undefined;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transitions = transitionsFor({
        settings,
        location,
        storageRoot,
        ledger,
        setDesiredEnabled: async (agent) => {
          started.push(agent);
          if (agent === AGENT_HOOK_REGISTRY[0].agent) {
            await blocked;
          }
        },
      });

      const all = Promise.all(AGENT_HOOK_REGISTRY.map((candidate) => transitions.submit(candidate, true)));
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(new Set(started)).toEqual(new Set(AGENT_HOOK_REGISTRY.map((candidate) => candidate.agent)));
      release();
      await all;
    });
  });
});
