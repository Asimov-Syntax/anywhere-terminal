// src/agentHooks/install/managedEntryLedger.ts — What this extension wrote,
// remembered rather than re-derived (D12). Ownership of a stored hook command is
// byte equality against a command we recorded writing; nothing is parsed, so no
// lookalike a shell would resolve differently can be claimed.
//
// The record lives in a file under global storage, taken under a lock and read
// fresh inside it (D15). A second extension host is a second writer, so no
// mutation may derive from a snapshot taken before the exclusion began.

import { resolve } from "node:path";
import { createKeyedSerialQueue } from "../../utils/keyedSerialQueue";
import type { LockedFile } from "./lockedJsonFile";

/** The persistence the ledger is written against; every mutation is one `transact`. */
export interface LedgerStore {
  /**
   * The value this process last observed for `key` — synchronous, and stale the
   * moment another host writes. Only the ownership answer reads it, and only
   * ever after a `transact` refreshed it.
   */
  peek(key: string): unknown;
  /**
   * Read `key` under the store's own exclusion, apply `change` to what was
   * actually there, publish the result. Rejects when it could not be persisted.
   */
  transact(key: string, change: (current: unknown) => AgentLedgerEntry): Promise<void>;
  /**
   * The value as it is on disk right now, taken under the same exclusion and
   * published, so the synchronous view behind it is no longer stale.
   */
  read(key: string): Promise<unknown>;
  /** Warm the synchronous view, so a read before the first mutation is not empty. */
  load(): Promise<void>;
}

export interface AgentLedgerEntry {
  /** Config file our entries were last written into. */
  destination?: string;
  /** Exact command strings this extension has written, newest last. */
  commands: string[];
  /** Destinations whose cleanup has not succeeded yet (D13). */
  pending: string[];
}

/** The ownership half of the ledger, bound to one agent. */
export interface ManagedEntryOwnership {
  isOwned(command: unknown): boolean;
  /**
   * Takes this operation's own snapshot under the ledger lock. Called inside the
   * configuration lock, so no installer can write between the read and the
   * ownership decision it feeds (round-7 B5).
   */
  refresh(): Promise<void>;
  /**
   * Recorded BEFORE the configuration is written (round-4 B6). False means the
   * record reached only this session, which is not enough to write on (round-7 B6).
   */
  recordCommand(command: string): Promise<boolean>;
  recordInstalled(destination: string, command: string): Promise<void>;
  recordRemoved(destination: string): Promise<void>;
}

/**
 * Where the record lives, relative to the user's home. Outside the extension's
 * storage root on purpose: that root moves, and a record of what we wrote has to
 * outlive every location it describes (D16). One file therefore serves every
 * VS Code installation for this user, which matches the agent configuration
 * files they already share.
 */
export const MANAGED_ENTRY_LEDGER_DIRECTORY = ".anywhere-terminal";
export const MANAGED_ENTRY_LEDGER_FILE = "agent-hooks-ledger.json";

/**
 * Only a destination move writes a new command, so this holds many moves' worth.
 * Beyond it the oldest is dropped: an entry written at a path we no longer
 * remember is left alone rather than swept, which is the safe direction.
 */
const MAX_REMEMBERED_COMMANDS = 8;

/**
 * A ceiling on destinations awaiting cleanup (round-4 B7). Reached, the ledger
 * refuses to track a NEW one and says so — dropping the oldest instead would
 * orphan exactly what D13 exists to retry. The caller stops the move rather than
 * continuing without it (round-5 B8).
 */
export const MAX_PENDING_DESTINATIONS = 16;

export class ManagedEntryLedger {
  /**
   * What this host wrote and could not persist. Losing a destination we already
   * modified is worse than remembering it only until the window closes, so a
   * failed write stays here and is folded into the next successful one (D15).
   */
  private readonly session = new Map<string, AgentLedgerEntry>();

  public constructor(private readonly store: LedgerStore) {}

  /** Warm the store's synchronous view; safe to call more than once. */
  public load(): Promise<void> {
    return this.store.load();
  }

  /** Sanitized read — a hand-edited or older-shaped value degrades to empty, never throws. */
  public entry(agent: string): AgentLedgerEntry {
    return this.view(this.store.peek(agent), agent);
  }

  /**
   * This operation's own snapshot, read under the ledger's exclusion. A view
   * refreshed once per host cannot see a destination another window recorded
   * afterwards, and an inventory frozen from it reports a cleanup complete that
   * never ran (round-7 B5).
   */
  public async refresh(agent: string): Promise<AgentLedgerEntry> {
    return this.view(await this.store.read(agent), agent);
  }

  private view(stored: unknown, agent: string): AgentLedgerEntry {
    return fold(sanitize(stored), this.session.get(agent));
  }

  /**
   * Ownership for one agent. `seedCommand` is what this build would write right
   * now; it stands in only while nothing is recorded, which is what lets an
   * installation predating the ledger still be reconciled. It is a command we
   * construct ourselves, so seeding claims exactly one byte-exact string.
   */
  public ownership(agent: string, seedCommand: string): ManagedEntryOwnership {
    const remember = (entry: AgentLedgerEntry, command: string): string[] =>
      [...entry.commands.filter((known) => known !== command), command].slice(-MAX_REMEMBERED_COMMANDS);

    return {
      isOwned: (command) => {
        if (typeof command !== "string") {
          return false;
        }
        const recorded = this.entry(agent).commands;
        return recorded.length === 0 ? command === seedCommand : recorded.includes(command);
      },
      refresh: async () => {
        await this.refresh(agent);
      },
      recordCommand: (command) => this.mutate(agent, (entry) => ({ ...entry, commands: remember(entry, command) })),
      recordInstalled: async (destination, command) => {
        const persisted = await this.mutate(agent, (entry) => ({
          destination: canonical(destination),
          commands: remember(entry, command),
          pending: without(entry.pending, destination),
        }));
        if (!persisted) {
          // The configuration was already replaced by the time we got here, so a
          // destination we cannot record is exactly what `pending` is for
          // (round-5 W5). The retry may persist what the first attempt could not.
          await this.recordPending(agent, destination);
        }
      },
      recordRemoved: async (destination) => {
        await this.mutate(agent, (entry) => ({
          destination: entry.destination === canonical(destination) ? undefined : entry.destination,
          commands: entry.commands,
          pending: without(entry.pending, destination),
        }));
      },
    };
  }

  /** Destinations still holding our entries after a failed cleanup (D13). */
  public pending(agent: string): string[] {
    return this.entry(agent).pending;
  }

  /**
   * False when this destination is not tracked in a way that survives the window
   * — either the ceiling refused it, or the write reached only session memory.
   * The caller asks in order to decide whether continuing is safe, so an answer
   * that ignores durability authorizes exactly the loss it was guarding against
   * (round-7 B6, and B8's guard).
   */
  public async recordPending(agent: string, destination: string): Promise<boolean> {
    const path = canonical(destination);
    let tracked = true;
    const persisted = await this.mutate(agent, (entry) => {
      tracked = entry.pending.includes(path) || entry.pending.length < MAX_PENDING_DESTINATIONS;
      return tracked && !entry.pending.includes(path) ? { ...entry, pending: [...entry.pending, path] } : entry;
    });
    return tracked && persisted;
  }

  public async clearPending(agent: string, destination: string): Promise<void> {
    await this.mutate(agent, (entry) => ({ ...entry, pending: without(entry.pending, destination) }));
  }

  public destination(agent: string): string | undefined {
    return this.entry(agent).destination;
  }

  /** True when the result reached the store; false when only this session holds it. */
  private async mutate(agent: string, change: (entry: AgentLedgerEntry) => AgentLedgerEntry): Promise<boolean> {
    const held = this.session.get(agent);
    let base: AgentLedgerEntry | undefined;
    try {
      // `change` runs on what the store read under its own exclusion, never on
      // anything this object cached — the whole point of D15.
      await this.store.transact(agent, (current) => {
        base = fold(sanitize(current), held);
        return change(base);
      });
      this.session.delete(agent);
      return true;
    } catch {
      // Held back against the SAME base the attempt used, when it got far enough
      // to read one. Re-deciding against this host's own view would answer a
      // ceiling question from a list missing every destination only the file
      // knows about, and admit an obligation the merged list had no room for.
      this.session.set(agent, change(base ?? this.entry(agent)));
      return false;
    }
  }
}

/** In-memory store — the installer's default, and every test's. */
export function memoryLedgerStore(initial: Record<string, unknown> = {}): LedgerStore {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    peek: (key) => values.get(key),
    read: async (key) => values.get(key),
    load: async () => undefined,
    transact: async (key, change) => {
      values.set(key, change(values.get(key)));
    },
  };
}

/**
 * The ledger on disk. Unlike an agent's configuration, this file is ours alone,
 * so a corrupt one is replaced rather than classified unsupported (D10 protects
 * the user's document, not our bookkeeping).
 */
export function fileLedgerStore(file: LockedFile): LedgerStore {
  let published: Record<string, unknown> = {};
  // Two operations from this host would otherwise contend for a lock built to
  // exclude other PROCESSES, and spin for a second before one of them failed.
  // The repository's own keyed serialization owns this; a second chain here was
  // duplication (round-7 reuse).
  const queue = createKeyedSerialQueue();

  const underLock = async <T>(body: () => Promise<T>): Promise<T> => {
    const outcome = await file.withLock<{ ok: true; value: T } | { ok: false }>(
      async () => ({ ok: true, value: await body() }),
      { ok: false },
      { ok: false },
    );
    if (!outcome.ok) {
      throw new Error(`agent hook ledger unavailable: ${file.path}`);
    }
    return outcome.value;
  };

  const read = async (): Promise<Record<string, unknown>> => {
    const contents = await file.readText();
    if (contents === undefined) {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(contents);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      // Our own bookkeeping, not the user's document: replacing an unreadable
      // one is right here, and wrong in D10's classified read.
      return {};
    }
  };

  return {
    peek: (key) => published[key],
    load: async () => {
      published = await read().catch(() => published);
    },
    read: (key) =>
      queue.run(file.path, () =>
        underLock(async () => {
          published = await read();
          return published[key];
        }),
      ),
    transact: (key, change) =>
      queue.run(file.path, () =>
        underLock(async () => {
          const document = await read();
          const next = { ...document, [key]: change(document[key]) };
          if (!(await file.atomicReplace(`${JSON.stringify(next, null, 2)}\n`, 0o600))) {
            throw new Error(`agent hook ledger write failed: ${file.path}`);
          }
          published = next;
        }),
      ),
  };
}

/**
 * A session-only entry is what THIS host wrote and could not persist; the stored
 * one is what every host managed to. Both are true, so both survive — except the
 * destination, where the unpersisted write is the more recent fact.
 */
function fold(stored: AgentLedgerEntry, held: AgentLedgerEntry | undefined): AgentLedgerEntry {
  if (!held) {
    return stored;
  }
  return {
    destination: held.destination,
    commands: [...stored.commands.filter((command) => !held.commands.includes(command)), ...held.commands].slice(
      -MAX_REMEMBERED_COMMANDS,
    ),
    // Unioned, never trimmed: both lists are cleanup this extension still owes,
    // and dropping either is the orphaning the ceiling exists to prevent. The
    // ceiling instead governs what may be ADDED — `recordPending` measures the
    // merged list, so the union can only exceed the bound by obligations that
    // were already real, and never by new ones (round-7 B10).
    pending: [...stored.pending, ...held.pending.filter((path) => !stored.pending.includes(path))],
  };
}

function sanitize(value: unknown): AgentLedgerEntry {
  const record = isRecord(value) ? value : {};
  return {
    destination: typeof record.destination === "string" ? record.destination : undefined,
    commands: strings(record.commands),
    pending: strings(record.pending),
  };
}

/**
 * The same file spelled two ways is one destination — otherwise a `..` or a
 * trailing separator in a user's path setting becomes a second pending entry
 * for a cleanup that already happened (round-4 B7).
 */
function canonical(destination: string): string {
  return resolve(destination);
}

function without(pending: readonly string[], destination: string): string[] {
  const path = canonical(destination);
  return pending.filter((candidate) => candidate !== path && candidate !== destination);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
