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
import { MAX_PENDING_DESTINATIONS, ManagedEntryLedger, memoryLedgerStore } from "./managedEntryLedger";
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
      expect(order).toEqual(Array.from({ length: order.length / 2 }, () => ["start:false", "end:false"]).flat());
      // Two submissions that had not begun are one transition's worth of work
      // (round-7 B13); before coalescing this was four pairs.
      expect(order).toHaveLength(4);
    });

    it("collapses a burst to the state it ended on rather than running every event", async () => {
      const { settings, location, storageRoot, adapters } = await agentConfigs();
      const { entry } = adapters[0];
      let running = 0;
      let concurrent = 0;
      let transitions = 0;
      const controller = transitionsFor({
        settings,
        location,
        storageRoot,
        registry: [entry],
        setDesiredEnabled: async (_agent, enabled) => {
          if (!enabled) {
            transitions += 1;
          }
          running += 1;
          concurrent = Math.max(concurrent, running);
          await new Promise((resolve) => setTimeout(resolve, 2));
          running -= 1;
        },
      });

      const burst = Array.from({ length: 20 }, () => controller.submit(entry, true));
      const settled = await Promise.all(burst);

      expect(transitions).toBeLessThan(20);
      expect(concurrent).toBe(1);
      // Every caller is answered, and answered by a run that saw its intent.
      expect(settled).toHaveLength(20);
      for (const outcome of settled) {
        expect(outcome.agent).toBe(entry.agent);
      }
    });

    it("runs again for a submission that arrives while a transition is in flight", async () => {
      const { settings, location, storageRoot, adapters } = await agentConfigs();
      const { entry } = adapters[0];
      const forced: boolean[] = [];
      let controller: ReturnType<typeof transitionsFor>;
      let submitted = false;
      controller = transitionsFor({
        settings,
        location,
        storageRoot,
        registry: [entry],
        setDesiredEnabled: async (_agent, enabled) => {
          if (!enabled) {
            forced.push(true);
            if (!submitted) {
              // Arrives strictly after the first run began, so it cannot be
              // folded into it — the rerun is what keeps it from being dropped.
              submitted = true;
              void controller.submit(entry, true);
            }
          }
        },
      });

      await controller.submit(entry, true);

      // Two transitions, and each forces the desired value through twice.
      expect(forced).toHaveLength(4);
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

describe("a destination the ledger cannot track (round-5 B8)", () => {
  async function ceilingReached() {
    const { settings, location, storageRoot, adapters } = await agentConfigs();
    const { entry, adapter } = adapters[0];
    const previous = adapter.configPath();
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    await installerFor(adapter, storageRoot, ledger, entry.agent).install();
    for (let index = 0; index < MAX_PENDING_DESTINATIONS; index += 1) {
      await ledger.recordPending(entry.agent, join(storageRoot, `stranded-${index}.json`));
    }

    const registry = [{ ...entry, createAdapter: () => entry.createAdapterForPath(`${previous}.moved`) }];
    let refuse = true;
    const forced: Array<[string, boolean]> = [];
    const transitions = transitionsFor({
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
      setDesiredEnabled: async (agent, enabled) => {
        forced.push([agent, enabled]);
      },
    });
    return {
      entry,
      adapter,
      previous,
      ledger,
      forced,
      storageRoot,
      settings,
      location,
      movedEntry: registry[0],
      transitions,
      allow: () => {
        refuse = false;
      },
    };
  }

  it("never forgets the file it could not clean, however full the record is", async () => {
    const { entry, previous, ledger, movedEntry, transitions, adapter } = await ceilingReached();

    await transitions.submit(movedEntry);

    // Round 5 had to STOP the move here, because remembering `previous` meant
    // appending to a list that could refuse. A write is recorded once, when it
    // is reserved, so failing to clean it only releases its claim — there is
    // nothing left to refuse, and nothing that can drop it (D17).
    expect(ledger.pending(entry.agent)).toContain(resolve(previous));
    expect(await readFile(previous, "utf8")).toContain(adapter.wrapperLocation("linux").directoryName);
  });

  it("still finds that destination when the user removes everything", async () => {
    const { entry, previous, ledger, movedEntry, transitions, adapter, settings, location, storageRoot, allow } =
      await ceilingReached();
    await transitions.submit(movedEntry);

    allow();
    const results = await transitionsFor({
      settings,
      location,
      storageRoot,
      ledger,
      registry: [movedEntry],
    }).uninstallEverything();

    expect(results[0]).toMatchObject({ agent: entry.agent, removed: true });
    expect(await readFile(previous, "utf8")).not.toContain(adapter.wrapperLocation("linux").directoryName);
  });
});

describe("two installations sharing one ledger (round-9 B14)", () => {
  /** Two profiles, two `claudeConfigDir` values, one machine-wide ledger file. */
  async function twoInstallations() {
    const { location, storageRoot, adapters } = await agentConfigs();
    const entry = adapters.find(({ entry: candidate }) => candidate.locationSettingKeys.length > 0)?.entry;
    if (!entry) {
      throw new Error("no agent declares a configuration location");
    }
    const home = location.homeDirectory();
    const store = memoryLedgerStore();
    const profile = (name: string) => {
      const settings = settingsFrom({ "agentHooks.claudeConfigDir": join(home, name) });
      const ledger = new ManagedEntryLedger(store, name);
      return {
        settings,
        ledger,
        path: entry.createAdapter(settings, location).configPath(),
        transitions: transitionsFor({ settings, location, storageRoot, ledger, registry: [entry] }),
        install: () =>
          installerFor(entry.createAdapter(settings, location), storageRoot, ledger, entry.agent).install(),
      };
    };
    return { entry, first: profile("alpha"), second: profile("beta"), storageRoot, location };
  }

  it("leaves the other installation's registration in place when one reconciles", async () => {
    const { entry, first, second } = await twoInstallations();
    expect(await first.install()).toEqual({ installed: true });
    expect(await second.install()).toEqual({ installed: true });

    await first.transitions.submit(entry, true);

    // One `destination` string could not hold both, so each installation read
    // the other's file as stale and swept it (round-9 B14).
    expect(await readFile(second.path, "utf8")).toContain("observer");
    expect(second.ledger.destination(entry.agent)).toBe(resolve(second.path));
    expect(first.ledger.destination(entry.agent)).toBe(resolve(first.path));
  });

  it("cleans only its own previous path when one installation moves", async () => {
    const { entry, first, second, storageRoot, location } = await twoInstallations();
    await first.install();
    await second.install();

    const movedSettings = settingsFrom({ "agentHooks.claudeConfigDir": join(location.homeDirectory(), "alpha-moved") });
    await installerFor(entry.createAdapter(movedSettings, location), storageRoot, first.ledger, entry.agent).install();

    // The path it left is owed cleanup; the other installation's is not.
    expect(first.ledger.pending(entry.agent)).toContain(resolve(first.path));
    expect(first.ledger.pending(entry.agent)).not.toContain(resolve(second.path));
  });

  it("removes both when the user removes everything", async () => {
    const { entry, first, second } = await twoInstallations();
    await first.install();
    await second.install();

    const results = await first.transitions.uninstallEverything();

    expect(results[0]?.removed).toBe(true);
    expect(await readFile(first.path, "utf8")).not.toContain("observer");
    expect(await readFile(second.path, "utf8")).not.toContain("observer");
    expect(first.ledger.pending(entry.agent)).toEqual([]);
  });
});

describe("a ledger that cannot be read (round-9 B16)", () => {
  /** A store whose reads fail until `heal` is called. */
  function brittleStore() {
    let failing = true;
    const backing = memoryLedgerStore();
    return {
      heal: () => {
        failing = false;
      },
      store: {
        ...backing,
        read: async (key: string) => {
          if (failing) {
            throw new Error("ledger unreadable");
          }
          return backing.read(key);
        },
      },
    };
  }

  it("reports the failure and still reconciles once the ledger comes back", async () => {
    const { settings, location, storageRoot, adapters } = await agentConfigs();
    const { entry } = adapters[0];
    const brittle = brittleStore();
    const warnings: string[] = [];
    const transitions = transitionsFor({
      settings,
      location,
      storageRoot,
      ledger: new ManagedEntryLedger(brittle.store),
      registry: [entry],
    });

    const failed = await transitions.submit(entry, true);
    // The defect: this rejection was cached against the agent, so every later
    // submission got the same rejected promise back — forever.
    expect(failed).toMatchObject({ agent: entry.agent, reconciled: false, unavailable: true });

    brittle.heal();
    const recovered = await transitions.submit(entry, true);

    expect(recovered.unavailable).toBeUndefined();
    expect(recovered.reconciled).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("summarizes every agent when one of them cannot be read", async () => {
    const { settings, location, storageRoot } = await agentConfigs();
    const brittle = brittleStore();
    const transitions = transitionsFor({
      settings,
      location,
      storageRoot,
      ledger: new ManagedEntryLedger(brittle.store),
    });

    const results = await transitions.uninstallEverything();

    // Promise.all discarded all of them the moment one rejected.
    expect(results).toHaveLength(AGENT_HOOK_REGISTRY.length);
    expect(results.map((result) => result.agent)).toEqual(AGENT_HOOK_REGISTRY.map((entry) => entry.agent));
    expect(summarizeUninstall(results)).toBeTruthy();
  });
});
