// src/agentHooks/install/managedEntryLedger.test.ts — The rule D12 replaced
// three parsers with: a stored command is ours only when it is byte-equal to one
// we recorded writing. Every lookalike below defeated one of those parsers.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURSOR_WRAPPER_DIRECTORY, cursorConfigAdapter } from "./cursorConfigAdapter";
import { ManagedConfigInstaller, managedWrapperCommand } from "./ManagedConfigInstaller";
import { MANAGED_ENTRY_LEDGER_KEY, ManagedEntryLedger, memoryLedgerStore } from "./managedEntryLedger";

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
    const ledger = new ManagedEntryLedger(
      memoryLedgerStore({ [MANAGED_ENTRY_LEDGER_KEY]: { cursor: { commands: "not-an-array", pending: 7 } } }),
    );

    expect(ledger.entry("cursor")).toEqual({ destination: undefined, commands: [], pending: [] });
    expect(ledger.entry("claude")).toEqual({ destination: undefined, commands: [], pending: [] });
  });

  it.each([null, "text", [1, 2]])("survives a stored root of %s", (stored) => {
    const ledger = new ManagedEntryLedger(memoryLedgerStore({ [MANAGED_ENTRY_LEDGER_KEY]: stored }));

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
