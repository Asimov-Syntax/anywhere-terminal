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
  MANAGED_ENTRY_LEDGER_DIRECTORY,
  MANAGED_ENTRY_LEDGER_FILE,
  MAX_TRACKED_WRITES,
  ManagedEntryLedger,
  memoryLedgerStore,
} from "./managedEntryLedger";

/** The commands the ledger still recognises for an agent, oldest first. */
function commandsOf(ledger: ManagedEntryLedger, agent: string): string[] {
  return ledger
    .entry(agent)
    .writes.filter((write) => write.command.length > 0)
    .map((write) => write.command);
}

/** The paths nobody claims any more — cleanup still owed. */
function pathsOwed(entry: { writes: { path: string; claims: string[] }[] }): string[] {
  return entry.writes.filter((write) => write.claims.length === 0).map((write) => write.path);
}

const owedIn = pathsOwed;

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

    expect(ledger.entry("cursor").writes).toEqual([
      { path: "/a/hooks.json", command: "cursor-command", claims: ["default"] },
    ]);
    expect(ledger.entry("claude").writes).toEqual([
      { path: "/b/settings.json", command: "claude-command", claims: ["default"] },
    ]);
  });

  it("records a command once however many times it is written", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");

    await ownership.recordInstalled("/a/hooks.json", "same");
    await ownership.recordInstalled("/a/hooks.json", "same");

    expect(commandsOf(ledger, "cursor")).toEqual(["same"]);
  });

  it("keeps one command per path, because installing swept the ones before it", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");

    for (let index = 0; index < 9; index += 1) {
      await ownership.recordInstalled("/a/hooks.json", `command-${index}`);
    }

    // A successful install rewrites that file with exactly one of our entries,
    // so the commands before it are gone from it and are not obligations.
    expect(commandsOf(ledger, "cursor")).toEqual(["command-8"]);
    expect(ownership.isOwned("command-0")).toBe(false);
    expect(ownership.isOwned("command-8")).toBe(true);
  });

  it("refuses a reservation at the ceiling, naming what is holding it", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    for (let index = 0; index < MAX_TRACKED_WRITES; index += 1) {
      expect(await ledger.recordPending("cursor", `/stranded/${index}/hooks.json`)).toBe(true);
    }

    const refused = await ledger.reserve("cursor", "/one/too/many/hooks.json", "command");

    expect(refused).toMatchObject({ ok: false, reason: "at-capacity" });
    // Naming them is what makes the refusal something the user can clear.
    expect(refused.ok === false && refused.blockedBy).toHaveLength(MAX_TRACKED_WRITES);
    expect(refused.ok === false && refused.blockedBy).toContain(resolve("/stranded/0/hooks.json"));
    // Refused, not truncated: nothing already owed was dropped to make room.
    expect(ledger.pending("cursor")).toHaveLength(MAX_TRACKED_WRITES);
  });

  it("reserves a write it already recorded, however full it is", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    for (let index = 0; index < MAX_TRACKED_WRITES; index += 1) {
      await ledger.recordPending("cursor", `/stranded/${index}/hooks.json`);
    }

    // Re-reserving adds no record, so the ceiling has nothing to refuse — a full
    // ledger must not stop us reinstalling somewhere we are already tracked.
    await ledger.ownership("cursor", "seed").recordInstalled("/stranded/0/hooks.json", "command");
    expect(await ledger.reserve("cursor", "/stranded/0/hooks.json", "command")).toEqual({ ok: true });
  });

  it("still claims a command at a path awaiting cleanup, however many writes came after", async () => {
    // The defect this replaces: commands were capped independently of the paths
    // owed cleanup, so a pending path outlived the only thing that identified
    // its entries and stopped being ours (round-9 B17).
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");
    await ownership.recordInstalled("/stranded/hooks.json", "stranded-command");
    await ledger.recordPending("cursor", "/stranded/hooks.json");

    for (let index = 0; index < MAX_TRACKED_WRITES - 2; index += 1) {
      await ownership.recordInstalled(`/moved/${index}/hooks.json`, `command-${index}`);
      await ledger.clearPending("cursor", `/moved/${index}/hooks.json`);
    }

    expect(ownership.isOwned("stranded-command")).toBe(true);
    expect(ledger.pending("cursor")).toContain(resolve("/stranded/hooks.json"));
  });

  it("drops the destination on removal but keeps the command it may still meet elsewhere", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");
    await ownership.recordInstalled("/a/hooks.json", "command");

    await ownership.recordRemoved("/a/hooks.json");

    expect(ledger.entry("cursor").writes).toEqual([]);
    expect(ledger.destination("cursor")).toBeUndefined();
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
    const ledger = new ManagedEntryLedger(memoryLedgerStore({ cursor: { writes: "not-an-array" } }));

    expect(ledger.entry("cursor").writes).toEqual([]);
    expect(ledger.entry("claude").writes).toEqual([]);
  });

  it.each([null, "text", [1, 2]])("survives a stored root of %s", (stored) => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore({ cursor: stored }));

    expect(commandsOf(ledger, "cursor")).toEqual([]);
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
    read: async (key) => {
      published.set(key, values.get(key));
      return values.get(key);
    },
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
    expect(commandsOf(ledger, "cursor")).toEqual(["cursor-command"]);
    expect(commandsOf(ledger, "claude")).toEqual(["claude-command"]);
  });

  it("keeps every write for one agent when they overlap on a store that lags", async () => {
    const ledger = new ManagedEntryLedger(laggingLedgerStore());
    const ownership = ledger.ownership("cursor", "seed");

    await Promise.all([
      ownership.reserve("/a/hooks.json", "first"),
      ownership.reserve("/a/hooks.json", "second"),
      ledger.recordPending("cursor", "/old/hooks.json"),
    ]);

    expect(commandsOf(ledger, "cursor")).toEqual(["first", "second"]);
    // Both reservations and the failed cleanup survive the lagging store; a
    // reservation counts as owed until an install claims it (D17).
    expect(ledger.pending("cursor")).toEqual([resolve("/a/hooks.json"), resolve("/old/hooks.json")]);
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
    for (let index = 0; index < MAX_TRACKED_WRITES; index += 1) {
      expect(await ledger.recordPending("cursor", `/failed/${index}/hooks.json`)).toBe(true);
    }

    expect(await ledger.recordPending("cursor", "/one/too/many/hooks.json")).toBe(false);

    // Dropping the oldest is the orphaning D13 exists to prevent.
    expect(ledger.pending("cursor")).toHaveLength(MAX_TRACKED_WRITES);
    expect(ledger.pending("cursor")[0]).toBe(resolve("/failed/0/hooks.json"));
  });

  it("reports an already-tracked destination as tracked even at the ceiling", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore());
    for (let index = 0; index < MAX_TRACKED_WRITES; index += 1) {
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
      ledger.ownership("cursor", "seed").reserve("/a/hooks.json", "command"),
    ]);

    const reopened = open();
    await reopened.load();
    // The reservation is there too: until an install finalizes it, a reserved
    // write is a prepared obligation rather than a live registration (D17).
    expect(reopened.pending("cursor")).toEqual([
      resolve("/one/hooks.json"),
      resolve("/two/hooks.json"),
      resolve("/a/hooks.json"),
    ]);
    expect(commandsOf(reopened, "cursor")).toEqual(["command"]);
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
    // The session entry keeps the claimed write, so this host still knows where
    // it installed even though nothing reached the file.
    await ledger.ownership("cursor", "seed").recordInstalled("/a/hooks.json", "command");
    expect(ledger.destination("cursor")).toBe(resolve("/a/hooks.json"));

    failing = false;
    await ledger.ownership("cursor", "seed").reserve("/a/hooks.json", "command");

    const reopened = open();
    await reopened.load();
    // The write is claimed, not owed: its bytes reached the user's file, and the
    // record naming it survived the window that could not persist it at the time.
    expect(reopened.pending("cursor")).toEqual([]);
    expect(reopened.destination("cursor")).toBe(resolve("/a/hooks.json"));
  });

  it("starts empty on a ledger file that is not readable as a record", async () => {
    const { path, open } = await ledgerFile();
    await writeFile(path, "{ not json");

    const ledger = open();
    await ledger.load();

    expect(ledger.entry("cursor").writes).toEqual([]);
    await ledger.recordPending("cursor", "/old/hooks.json");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      cursor: {
        writes: [{ path: resolve("/old/hooks.json"), command: "", claims: [] }],
      },
    });
  });
});

describe("ManagedEntryLedger across hosts (round-7 B5, B6, B9, B10)", () => {
  async function twoHosts() {
    const directory = await mkdtemp(join(tmpdir(), "ledger-hosts-"));
    tempDirectories.push(directory);
    const path = join(directory, MANAGED_ENTRY_LEDGER_DIRECTORY, MANAGED_ENTRY_LEDGER_FILE);
    const open = (dependencies: ConstructorParameters<typeof LockedFile>[1] = {}) =>
      new ManagedEntryLedger(fileLedgerStore(new LockedFile(path, dependencies)));
    return { directory, path, open };
  }

  it("creates the ledger's own directory rather than degrading to unavailable", async () => {
    const { path, open } = await twoHosts();
    // Nothing has created `~/.anywhere-terminal` on a first run.
    await open().recordPending("cursor", "/old/hooks.json");

    expect(owedIn(JSON.parse(await readFile(path, "utf8")).cursor)).toEqual([resolve("/old/hooks.json")]);
  });

  it("sees a destination the other host recorded after this one loaded", async () => {
    const { open } = await twoHosts();
    const first = open();
    await first.load();
    await open().recordPending("cursor", "/other/hooks.json");

    // `entry` still answers from the view this host holds...
    expect(first.pending("cursor")).toEqual([]);
    // ...and the operation-scoped read is what every inventory must use.
    expect(pathsOwed(await first.refresh("cursor"))).toEqual([resolve("/other/hooks.json")]);
  });

  it("keeps claiming a command written under a storage root that has since moved", async () => {
    const { open } = await twoHosts();
    const ledger = open();
    await ledger.ownership("cursor", "old-seed").reserve("/a/hooks.json", "'/old/root/observer.sh'");

    // A new window with a different storage root: same ledger path, so the
    // command the previous root wrote is still recognised (D16).
    const relocated = open();
    await relocated.load();

    expect(relocated.ownership("cursor", "'/new/root/observer.sh'").isOwned("'/old/root/observer.sh'")).toBe(true);
  });

  it("reports a pending destination as untracked when the write reached only this session", async () => {
    const { open } = await twoHosts();
    const ledger = open({
      rename: async () => {
        throw new Error("disk full");
      },
    });

    // The B8 guard asks this question to decide whether a move is safe; an
    // answer that ignores durability authorizes the loss it guards against.
    expect(await ledger.recordPending("cursor", "/old/hooks.json")).toBe(false);
    expect(ledger.pending("cursor")).toEqual([resolve("/old/hooks.json")]);
  });

  it("refuses a new obligation once the merged list has reached the ceiling", async () => {
    const { open } = await twoHosts();
    const failing = open({
      rename: async () => {
        throw new Error("disk full");
      },
    });
    // Admitted while there was room, then stranded in this host's memory.
    expect(await failing.recordPending("cursor", "/session/only/hooks.json")).toBe(false);

    // Another host fills the durable list without ever seeing that one.
    const durable = open();
    for (let index = 0; index < MAX_TRACKED_WRITES; index += 1) {
      await durable.recordPending("cursor", `/durable/${index}/hooks.json`);
    }

    expect(await failing.recordPending("cursor", "/one/too/many/hooks.json")).toBe(false);

    // Nothing already owed was dropped to make room — the ceiling refuses,
    // it never truncates.
    const merged = pathsOwed(await failing.refresh("cursor"));
    expect(merged).toHaveLength(MAX_TRACKED_WRITES + 1);
    expect(merged).toContain(resolve("/durable/0/hooks.json"));
    expect(merged).toContain(resolve("/session/only/hooks.json"));
    expect(merged).not.toContain(resolve("/one/too/many/hooks.json"));
  });
});

describe("the configuration write depends on a durable record (round-7 B6)", () => {
  it("does not touch the user's config when the pre-write record cannot persist", async () => {
    const fields = await fixture();
    const directory = await mkdtemp(join(tmpdir(), "ledger-durable-"));
    tempDirectories.push(directory);
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(fields.configPath, original);

    const ledger = new ManagedEntryLedger(
      fileLedgerStore(
        new LockedFile(join(directory, MANAGED_ENTRY_LEDGER_FILE), {
          rename: async () => {
            throw new Error("disk full");
          },
        }),
      ),
    );

    const outcome = await installer(fields, ledger).install();

    expect(outcome).toEqual({ installed: false, reason: "write-failed" });
    // A command written with no durable record is one no later session can remove.
    expect(await readFile(fields.configPath, "utf8")).toBe(original);
  });
});

describe("a record written before writes were reserved (round-9 B17, D19)", () => {
  const legacy = {
    cursor: {
      destination: "/live/hooks.json",
      commands: ["older-command", "newest-command"],
      pending: ["/stranded/hooks.json"],
    },
  };

  it("keeps the destination's newest command, which is the one relation the old shape held", () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore(legacy), "alpha");

    expect(ledger.destination("cursor")).toBe("/live/hooks.json");
    expect(ledger.ownership("cursor", "seed").isOwned("newest-command")).toBe(true);
  });

  it("carries a stranded path's possible commands without claiming which one it is", () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore(legacy), "alpha");

    const stranded = ledger.entry("cursor").writes.find((write) => write.path === "/stranded/hooks.json");

    // The old shape never said which command went where, so neither do we.
    expect(stranded).toMatchObject({ unresolved: true, command: "", claims: [] });
    expect(stranded?.candidates).toEqual(["older-command", "newest-command"]);
    // Any of them is still worth recognising — that is strictly better than
    // dropping the file, which is what the capped command list did.
    expect(ledger.ownership("cursor", "seed").isOwned("older-command")).toBe(true);
  });

  it("does not forget an unresolved path just because a sweep found nothing", async () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore(legacy), "alpha");

    // "not-installed" is the EXPECTED answer when the command that identifies
    // the entries is the one the old shape lost.
    await ledger.clearPending("cursor", "/stranded/hooks.json");

    expect(ledger.pending("cursor")).toContain("/stranded/hooks.json");
    expect(ledger.unresolved("cursor")).toEqual(["/stranded/hooks.json"]);
  });

  it("does not migrate a record that has none of the old keys", () => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore({ cursor: {} }), "alpha");

    expect(ledger.entry("cursor").writes).toEqual([]);
  });
});
