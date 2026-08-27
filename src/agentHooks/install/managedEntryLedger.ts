// src/agentHooks/install/managedEntryLedger.ts — What this extension wrote,
// remembered rather than re-derived (D12). Ownership of a stored hook command is
// byte equality against a command we recorded writing; nothing is parsed, so no
// lookalike a shell would resolve differently can be claimed.

import { resolve } from "node:path";

/** The slice of VS Code's `Memento` the ledger needs; injected so this never imports vscode. */
export interface LedgerStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
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

export const MANAGED_ENTRY_LEDGER_KEY = "anywhereTerminal.agentHooks.ledger";

/**
 * Only a destination move writes a new command, so this holds many moves' worth.
 * Beyond it the oldest is dropped: an entry written at a path we no longer
 * remember is left alone rather than swept, which is the safe direction.
 */
const MAX_REMEMBERED_COMMANDS = 8;

/**
 * A ceiling on destinations awaiting cleanup (round-4 B7). Reached, the ledger
 * refuses to track a NEW one and says so — dropping the oldest instead would
 * orphan exactly what D13 exists to retry.
 */
export const MAX_PENDING_DESTINATIONS = 16;

export class ManagedEntryLedger {
  /**
   * Every mutation this instance makes, in order. A store whose reads lag its
   * writes would otherwise let two overlapping load-modify-updates for one agent
   * both derive from the same snapshot (round-4 B5).
   */
  private writes: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly store: LedgerStore,
    private readonly keyPrefix: string = MANAGED_ENTRY_LEDGER_KEY,
  ) {}

  /** Sanitized read — a hand-edited or older-shaped value degrades to empty, never throws. */
  public entry(agent: string): AgentLedgerEntry {
    const found = this.store.get<unknown>(this.key(agent));
    const record = isRecord(found) ? found : {};
    return {
      destination: typeof record.destination === "string" ? record.destination : undefined,
      commands: strings(record.commands),
      pending: strings(record.pending),
    };
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
      recordCommand: (command) => this.mutate(agent, (entry) => ({ ...entry, commands: remember(entry, command) })),
      recordInstalled: (destination, command) =>
        this.mutate(agent, (entry) => ({
          destination: canonical(destination),
          commands: remember(entry, command),
          pending: without(entry.pending, destination),
        })),
      recordRemoved: (destination) =>
        this.mutate(agent, (entry) => ({
          destination: entry.destination === canonical(destination) ? undefined : entry.destination,
          commands: entry.commands,
          pending: without(entry.pending, destination),
        })),
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
      if (entry.pending.includes(path)) {
        return entry;
      }
      if (entry.pending.length >= MAX_PENDING_DESTINATIONS) {
        tracked = false;
        return entry;
      }
      return { ...entry, pending: [...entry.pending, path] };
    });
    return tracked;
  }

  public clearPending(agent: string, destination: string): Promise<void> {
    return this.mutate(agent, (entry) => ({ ...entry, pending: without(entry.pending, destination) }));
  }

  public destination(agent: string): string | undefined {
    return this.entry(agent).destination;
  }

  /** One key per agent, so no write ever reads a root another agent also writes. */
  private key(agent: string): string {
    return `${this.keyPrefix}.${agent}`;
  }

  private mutate(agent: string, change: (entry: AgentLedgerEntry) => AgentLedgerEntry): Promise<void> {
    // Chained on settlement, not success: one failed persist must not stop the
    // next from being attempted.
    const next = this.writes.then(
      () => this.store.update(this.key(agent), change(this.entry(agent))),
      () => this.store.update(this.key(agent), change(this.entry(agent))),
    );
    this.writes = next.then(
      () => undefined,
      () => undefined,
    );
    return Promise.resolve(next);
  }
}

/** In-memory store — the installer's default, and every test's. */
export function memoryLedgerStore(initial: Record<string, unknown> = {}): LedgerStore {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      values.set(key, value);
    },
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
