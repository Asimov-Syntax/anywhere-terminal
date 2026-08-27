// src/agentHooks/install/managedEntryLedger.ts — What this extension wrote,
// remembered rather than re-derived (D12). Ownership of a stored hook command is
// byte equality against a command we recorded writing; nothing is parsed, so no
// lookalike a shell would resolve differently can be claimed.
//
// The record lives in a file under global storage, taken under a lock and read
// fresh inside it (D15). A second extension host is a second writer, so no
// mutation may derive from a snapshot taken before the exclusion began.

import { resolve } from "node:path";
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
  /** Recorded BEFORE the configuration is written (round-4 B6). */
  recordCommand(command: string): Promise<void>;
  recordInstalled(destination: string, command: string): Promise<void>;
  recordRemoved(destination: string): Promise<void>;
}

/** Name of the ledger file inside the extension's global storage root. */
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
    return sanitize(this.session.get(agent) ?? this.store.peek(agent));
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
      recordCommand: async (command) => {
        await this.mutate(agent, (entry) => ({ ...entry, commands: remember(entry, command) }));
      },
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

  /** False when the ceiling refused to track this destination — the caller must say so. */
  public async recordPending(agent: string, destination: string): Promise<boolean> {
    const path = canonical(destination);
    let tracked = true;
    await this.mutate(agent, (entry) => {
      tracked = entry.pending.includes(path) || entry.pending.length < MAX_PENDING_DESTINATIONS;
      return tracked && !entry.pending.includes(path) ? { ...entry, pending: [...entry.pending, path] } : entry;
    });
    return tracked;
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
    try {
      // `change` runs on what the store read under its own exclusion, never on
      // anything this object cached — the whole point of D15.
      await this.store.transact(agent, (current) => change(fold(sanitize(current), held)));
      this.session.delete(agent);
      return true;
    } catch {
      this.session.set(agent, change(this.entry(agent)));
      return false;
    }
  }
}

/** In-memory store — the installer's default, and every test's. */
export function memoryLedgerStore(initial: Record<string, unknown> = {}): LedgerStore {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    peek: (key) => values.get(key),
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
  // Two transacts from this host would otherwise contend for a lock built to
  // exclude other PROCESSES, and spin for a second before one of them failed.
  let tail: Promise<unknown> = Promise.resolve();

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
      return {};
    }
  };

  const serialize = (key: string, change: (current: unknown) => AgentLedgerEntry) => async (): Promise<void> => {
    const applied = await file.withLock(
      async () => {
        const document = await read();
        const next = { ...document, [key]: change(document[key]) };
        if (!(await file.atomicReplace(`${JSON.stringify(next, null, 2)}\n`, 0o600))) {
          return false;
        }
        published = next;
        return true;
      },
      false,
      false,
    );
    if (!applied) {
      throw new Error(`agent hook ledger unavailable: ${file.path}`);
    }
  };

  return {
    peek: (key) => published[key],
    load: async () => {
      published = await read().catch(() => published);
    },
    transact: (key, change) => {
      const next = tail.then(serialize(key, change), serialize(key, change));
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
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
