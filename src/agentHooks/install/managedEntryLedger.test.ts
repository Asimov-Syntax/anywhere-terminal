// src/agentHooks/install/managedEntryLedger.test.ts — The rule D12 replaced
// three parsers with: a stored command is ours only when it is byte-equal to one
// we recorded writing. Every lookalike below defeated one of those parsers.

import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURSOR_WRAPPER_DIRECTORY, cursorConfigAdapter } from "./cursorConfigAdapter";
import { LockedFile } from "./lockedJsonFile";
import { ManagedConfigInstaller, managedWrapperCommand } from "./ManagedConfigInstaller";
import {
  fileLedgerStore,
  type LedgerStore,
  MANAGED_ENTRY_LEDGER_FILE,
  MAX_PENDING_DESTINATIONS,
  ManagedEntryLedger,
  memoryLedgerStore,
} from "./managedEntryLedger";

const tempDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "managed-ledger-"));
  tempDirectories.push(directory);
  const storageRoot = join(directory, "storage");
  const configPath = join(directory, "hooks.json");
  const adapter = cursorConfigAdapter(configPath);
  const options = { storageRoot, platform: "linux" as const };
  return { adapter, configPath, options, storageRoot, command: managedWrapperCommand(adapter, options) };
}

function installer(
  fields: Awaited<ReturnType<typeof fixture>>,
  ledger: ManagedEntryLedger,
  storageRoot = fields.options.storageRoot,
) {
  const options = { ...fields.options, storageRoot };
  return new ManagedConfigInstaller(fields.adapter, {
    ...options,
    ownership: ledger.ownership("cursor", managedWrapperCommand(fields.adapter, options)),
  });
}

async function hooksIn(path: string) {
  const document = JSON.parse(await readFile(path, "utf8")) as { hooks: Record<string, Array<{ command: string }>> };
  return document.hooks;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ManagedEntryLedger ownership", () => {
  it.each([
    ["a directory that merely ends in the owned name", `/home/alice/not-${CURSOR_WRAPPER_DIRECTORY}/observer.sh`],
    ["a filename that merely starts with the owned name", (command: string) => `${command}.backup`],
    ["the owned command appearing as somebody else's argument", (command: string) => `/usr/bin/audit ${command}`],
    ["a suffix concatenated after the closing quote (round 2)", (command: string) => `${command}.bak`],
    ["a suffix concatenated in a second quoted run (round 2)", (command: string) => `${command}".bak"`],
    ["an unterminated quote", (command: string) => command.slice(0, -1)],
    ["a re-quoted equivalent of the same path (round 3)", (command: string) => `"${command.slice(1, -1)}"`],
    ["a literal backslash inside a quoted path (round 3)", (command: string) => command.replace("/storage", "\\x")],
  ])("refuses %s", async (_name, lookalike) => {
    const fields = await fixture();
    const ownership = new ManagedEntryLedger(memoryLedgerStore()).ownership("cursor", fields.command);

    expect(ownership.isOwned(typeof lookalike === "string" ? lookalike : lookalike(fields.command))).toBe(false);
  });

  it("claims the command it recorded writing, and nothing that merely resembles it", async () => {
    const fields = await fixture();
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    const ownership = ledger.ownership("cursor", "seed-only");

    await ownership.recordInstalled(fields.configPath, fields.command);

    expect(ownership.isOwned(fields.command)).toBe(true);
    expect(ownership.isOwned(`${fields.command} `)).toBe(false);
    // The seed is spent the moment a real record exists.
    expect(ownership.isOwned("seed-only")).toBe(false);
  });

  it.each([undefined, 42, null, { command: "x" }])("refuses the non-string %s", async (candidate) => {
    const fields = await fixture();

    expect(new ManagedEntryLedger(memoryLedgerStore()).ownership("cursor", fields.command).isOwned(candidate)).toBe(
      false,
    );
  });

  it("seeds from what the shipped build wrote, so an installation predating the ledger is still ours", async () => {
    const fields = await fixture();
    // Byte-for-byte what src/cursor/CursorHookInstaller shipped: the wrapper
    // under <globalStorage>/cursor-hooks, POSIX-quoted.
    const shipped = `'${join(fields.storageRoot, CURSOR_WRAPPER_DIRECTORY, "cursor-hook-observer.sh")}'`;
    expect(fields.command).toBe(shipped);

    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    await writeFile(
      fields.configPath,
      JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: shipped, timeout: 2 }] } }),
    );

    expect((await installer(fields, ledger).uninstall()).removed).toBe(true);
    expect((await hooksIn(fields.configPath)).sessionStart).toEqual([]);
  });

  it("still reaches an entry written before the storage root moved", async () => {
    const fields = await fixture();
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    await writeFile(fields.configPath, JSON.stringify({ version: 1, hooks: {} }));

    expect((await installer(fields, ledger).install()).installed).toBe(true);
    const moved = join(fields.storageRoot, "..", "moved");
    expect((await installer(fields, ledger, moved).install()).installed).toBe(true);

    const { sessionStart } = await hooksIn(fields.configPath);
    expect(sessionStart).toHaveLength(1);
    expect(sessionStart[0]?.command).toContain("moved");
  });

  it("leaves a hand-edited command alone rather than sweeping it", async () => {
    const fields = await fixture();
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    await writeFile(fields.configPath, JSON.stringify({ version: 1, hooks: {} }));
    await installer(fields, ledger).install();

    const edited = `${fields.command} --user-added-flag`;
    await writeFile(
      fields.configPath,
      JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: edited, timeout: 2 }] } }),
    );

    await installer(fields, ledger).uninstall();

    expect((await hooksIn(fields.configPath)).sessionStart).toEqual([{ command: edited, timeout: 2 }]);
  });
});

describe("ManagedEntryLedger state", () => {
  it("keeps each agent's record separate", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());

    await ledger.ownership("cursor", "seed").recordInstalled("/a/hooks.json", "cursor-command");
    await ledger.ownership("claude", "seed").recordInstalled("/b/settings.json", "claude-command");

    expect(ledger.entry("cursor")).toEqual({ destination: "/a/hooks.json", commands: ["cursor-command"], pending: [] });
    expect(ledger.entry("claude")).toEqual({
      destination: "/b/settings.json",
      commands: ["claude-command"],
      pending: [],
    });
  });

  it("records a command once however many times it is written", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");

    await ownership.recordInstalled("/a/hooks.json", "same");
    await ownership.recordInstalled("/a/hooks.json", "same");

    expect(ledger.entry("cursor").commands).toEqual(["same"]);
  });

  it("forgets the oldest command past the bound, and stops claiming it", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");

    for (let index = 0; index < 9; index += 1) {
      await ownership.recordInstalled("/a/hooks.json", `command-${index}`);
    }

    expect(ledger.entry("cursor").commands).toHaveLength(8);
    expect(ownership.isOwned("command-0")).toBe(false);
    expect(ownership.isOwned("command-8")).toBe(true);
  });

  it("drops the destination on removal but keeps the command it may still meet elsewhere", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");
    await ownership.recordInstalled("/a/hooks.json", "command");

    await ownership.recordRemoved("/a/hooks.json");

    expect(ledger.entry("cursor")).toEqual({ destination: undefined, commands: ["command"], pending: [] });
  });

  it("carries a failed cleanup as pending until it succeeds", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());

    await ledger.recordPending("cursor", "/old/hooks.json");
    await ledger.recordPending("cursor", "/old/hooks.json");
    expect(ledger.pending("cursor")).toEqual(["/old/hooks.json"]);

    await ledger.clearPending("cursor", "/old/hooks.json");
    expect(ledger.pending("cursor")).toEqual([]);
  });

  it("clears a pending destination that a later install reclaims", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    await ledger.recordPending("cursor", "/a/hooks.json");

    await ledger.ownership("cursor", "seed").recordInstalled("/a/hooks.json", "command");

    expect(ledger.pending("cursor")).toEqual([]);
  });

  it("survives a stored value of the wrong shape rather than throwing", () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore({ cursor: { commands: "not-an-array", pending: 7 } }));

    expect(ledger.entry("cursor")).toEqual({ destination: undefined, commands: [], pending: [] });
    expect(ledger.entry("claude")).toEqual({ destination: undefined, commands: [], pending: [] });
  });

  it.each([null, "text", [1, 2]])("survives a stored root of %s", (stored) => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore({ cursor: stored }));

    expect(ledger.entry("cursor").commands).toEqual([]);
  });

  it("persists across ledger instances sharing a store", async () => {
    const store = memoryLedgerStore();
    await new ManagedEntryLedger(store).ownership("cursor", "seed").recordInstalled("/a/hooks.json", "command");

    const reopened = new ManagedEntryLedger(store);

    expect(reopened.destination("cursor")).toBe("/a/hooks.json");
    expect(reopened.ownership("cursor", "seed").isOwned("command")).toBe(true);
  });
});

/**
 * A store whose synchronous view lags its writes, and whose exclusion — like the
 * real lock's — is its own. A mutation deriving from anything but what `transact`
 * hands it is what erased the earlier write in round 4.
 */
function laggingLedgerStore(): LedgerStore {
  const values = new Map<string, unknown>();
  const published = new Map<string, unknown>();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    peek: (key) => published.get(key),
    load: async () => undefined,
    transact: (key, change) => {
      const next = tail.then(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              const updated = change(values.get(key));
              values.set(key, updated);
              published.set(key, updated);
              resolve();
            }, 1);
          }),
      );
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

describe("ManagedEntryLedger durability (round-4 B5, B6, B7)", () => {
  it("keeps both agents' records when their writes overlap on a store that lags", async () => {
    const ledger = new ManagedEntryLedger(laggingLedgerStore());

    await Promise.all([
      ledger.ownership("cursor", "seed").recordInstalled("/a/hooks.json", "cursor-command"),
      ledger.ownership("claude", "seed").recordInstalled("/b/settings.json", "claude-command"),
    ]);

    // One shared root plus a lagging read is how the later write erased the earlier.
    expect(ledger.entry("cursor").commands).toEqual(["cursor-command"]);
    expect(ledger.entry("claude").commands).toEqual(["claude-command"]);
  });

  it("keeps every write for one agent when they overlap on a store that lags", async () => {
    const ledger = new ManagedEntryLedger(laggingLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");

    await Promise.all([
      ownership.recordCommand("first"),
      ownership.recordCommand("second"),
      ledger.recordPending("cursor", "/old/hooks.json"),
    ]);

    expect(ledger.entry("cursor").commands).toEqual(["first", "second"]);
    expect(ledger.pending("cursor")).toEqual([resolve("/old/hooks.json")]);
  });

  it("owns a command recorded before a write that then failed", async () => {
    const fields = await fixture();
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    await writeFile(fields.configPath, JSON.stringify({ version: 1, hooks: {} }));
    // A previous storage root, so the seed no longer covers the new command.
    await ledger.ownership("cursor", "seed").recordInstalled("/old/hooks.json", "'/old/root/observer.sh'");

    const failing = new ManagedConfigInstaller(
      fields.adapter,
      {
        ...fields.options,
        ownership: ledger.ownership("cursor", managedWrapperCommand(fields.adapter, fields.options)),
      },
      {
        // Only the config replacement fails, so the wrapper is created and the
        // failure lands exactly where B6 said the ledger was still behind.
        rename: async (from, to) => {
          if (to === fields.configPath) {
            throw new Error("disk full");
          }
          await rename(from, to);
        },
      },
    );
    expect((await failing.install()).installed).toBe(false);

    // The command reached the ledger before the file was touched, so a write
    // that DID land would still be reachable.
    expect(ledger.ownership("cursor", "seed").isOwned(fields.command)).toBe(true);
  });

  it("treats equivalent spellings of a destination as one pending entry", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());

    await ledger.recordPending("cursor", "/a/b/../hooks.json");
    await ledger.recordPending("cursor", "/a/hooks.json");

    expect(ledger.pending("cursor")).toEqual([resolve("/a/hooks.json")]);
    await ledger.clearPending("cursor", "/a/b/../hooks.json");
    expect(ledger.pending("cursor")).toEqual([]);
  });

  it("refuses to track past the ceiling and keeps what it already tracks", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    for (let index = 0; index < MAX_PENDING_DESTINATIONS; index += 1) {
      expect(await ledger.recordPending("cursor", `/failed/${index}/hooks.json`)).toBe(true);
    }

    expect(await ledger.recordPending("cursor", "/one/too/many/hooks.json")).toBe(false);

    // Dropping the oldest is the orphaning D13 exists to prevent.
    expect(ledger.pending("cursor")).toHaveLength(MAX_PENDING_DESTINATIONS);
    expect(ledger.pending("cursor")[0]).toBe(resolve("/failed/0/hooks.json"));
  });

  it("reports an already-tracked destination as tracked even at the ceiling", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    for (let index = 0; index < MAX_PENDING_DESTINATIONS; index += 1) {
      await ledger.recordPending("cursor", `/failed/${index}/hooks.json`);
    }

    expect(await ledger.recordPending("cursor", "/failed/0/hooks.json")).toBe(true);
  });
});

describe("ManagedEntryLedger on disk (round-5 B5, W5)", () => {
  async function ledgerFile(dependencies: ConstructorParameters<typeof LockedFile>[1] = {}) {
    const directory = await mkdtemp(join(tmpdir(), "ledger-file-"));
    tempDirectories.push(directory);
    const path = join(directory, MANAGED_ENTRY_LEDGER_FILE);
    return { path, open: () => new ManagedEntryLedger(fileLedgerStore(new LockedFile(path, dependencies))) };
  }

  it("shows a second host what the first recorded", async () => {
    const { open } = await ledgerFile();
    await open().recordPending("cursor", "/old/hooks.json");

    const second = open();
    await second.load();

    expect(second.pending("cursor")).toEqual([resolve("/old/hooks.json")]);
  });

  it("does not let a host that never read an entry erase it", async () => {
    const { open } = await ledgerFile();
    const first = open();
    // Opened, and its view warmed, BEFORE the other host writes anything —
    // exactly the stale snapshot a per-window cache hands back on the next write.
    const second = open();
    await second.load();

    await first.ownership("cursor", "seed").recordInstalled("/a/hooks.json", "cursor-command");
    await second.ownership("claude", "seed").recordInstalled("/b/settings.json", "claude-command");

    const reopened = open();
    await reopened.load();
    expect(reopened.destination("cursor")).toBe(resolve("/a/hooks.json"));
    expect(reopened.destination("claude")).toBe(resolve("/b/settings.json"));
  });

  it("keeps every write when two of them overlap on one file", async () => {
    const { open } = await ledgerFile();
    const ledger = open();

    await Promise.all([
      ledger.recordPending("cursor", "/one/hooks.json"),
      ledger.recordPending("cursor", "/two/hooks.json"),
      ledger.ownership("cursor", "seed").recordCommand("command"),
    ]);

    const reopened = open();
    await reopened.load();
    expect(reopened.pending("cursor")).toEqual([resolve("/one/hooks.json"), resolve("/two/hooks.json")]);
    expect(reopened.entry("cursor").commands).toEqual(["command"]);
  });

  it("writes through a lock a dead process left behind", async () => {
    const { path, open } = await ledgerFile({ now: () => Date.now() + 60_000 });
    await writeFile(`${path}.anywhere-terminal.lock`, "");

    await open().recordPending("cursor", "/old/hooks.json");

    const reopened = open();
    await reopened.load();
    expect(reopened.pending("cursor")).toEqual([resolve("/old/hooks.json")]);
  });

  it("holds a destination it could not persist, and lands it on the next write that can", async () => {
    let failing = true;
    const { open } = await ledgerFile({
      rename: async (from, to) => {
        if (failing) {
          throw new Error("disk full");
        }
        await rename(from, to);
      },
    });
    const ledger = open();

    // The configuration was already replaced; forgetting where is what W5 named.
    await ledger.ownership("cursor", "seed").recordInstalled("/a/hooks.json", "command");
    expect(ledger.pending("cursor")).toEqual([resolve("/a/hooks.json")]);

    failing = false;
    await ledger.ownership("cursor", "seed").recordCommand("command");

    const reopened = open();
    await reopened.load();
    expect(reopened.pending("cursor")).toEqual([resolve("/a/hooks.json")]);
    expect(reopened.destination("cursor")).toBe(resolve("/a/hooks.json"));
  });

  it("starts empty on a ledger file that is not readable as a record", async () => {
    const { path, open } = await ledgerFile();
    await writeFile(path, "{ not json");

    const ledger = open();
    await ledger.load();

    expect(ledger.entry("cursor")).toEqual({ destination: undefined, commands: [], pending: [] });
    await ledger.recordPending("cursor", "/old/hooks.json");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      cursor: { destination: undefined, commands: [], pending: [resolve("/old/hooks.json")] },
    });
  });
});
