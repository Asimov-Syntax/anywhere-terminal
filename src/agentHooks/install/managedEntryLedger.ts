// src/agentHooks/install/managedEntryLedger.ts — What this extension wrote,
// remembered rather than re-derived (D12). Ownership of a stored hook command is
// byte equality against a command we recorded writing; nothing is parsed, so no
// lookalike a shell would resolve differently can be claimed.

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

type LedgerState = Record<string, AgentLedgerEntry>;

export class ManagedEntryLedger {
  public constructor(
    private readonly store: LedgerStore,
    private readonly key: string = MANAGED_ENTRY_LEDGER_KEY,
  ) {}

  /** Sanitized read — a hand-edited or older-shaped value degrades to empty, never throws. */
  public entry(agent: string): AgentLedgerEntry {
    const found = this.state()[agent];
    return {
      destination: typeof found?.destination === "string" ? found.destination : undefined,
      commands: strings(found?.commands),
      pending: strings(found?.pending),
    };
  }

  /**
   * Ownership for one agent. `seedCommand` is what this build would write right
   * now; it stands in only while nothing is recorded, which is what lets an
   * installation predating the ledger still be reconciled. It is a command we
   * construct ourselves, so seeding claims exactly one byte-exact string.
   */
  public ownership(agent: string, seedCommand: string): ManagedEntryOwnership {
    return {
      isOwned: (command) => {
        if (typeof command !== "string") {
          return false;
        }
        const recorded = this.entry(agent).commands;
        return recorded.length === 0 ? command === seedCommand : recorded.includes(command);
      },
      recordInstalled: (destination, command) =>
        this.mutate(agent, (entry) => ({
          destination,
          commands: [...entry.commands.filter((known) => known !== command), command].slice(-MAX_REMEMBERED_COMMANDS),
          pending: entry.pending.filter((candidate) => candidate !== destination),
        })),
      recordRemoved: (destination) =>
        this.mutate(agent, (entry) => ({
          destination: entry.destination === destination ? undefined : entry.destination,
          commands: entry.commands,
          pending: entry.pending.filter((candidate) => candidate !== destination),
        })),
    };
  }

  /** Destinations still holding our entries after a failed cleanup (D13). */
  public pending(agent: string): string[] {
    return this.entry(agent).pending;
  }

  public recordPending(agent: string, destination: string): Promise<void> {
    return this.mutate(agent, (entry) => ({
      ...entry,
      pending: entry.pending.includes(destination) ? entry.pending : [...entry.pending, destination],
    }));
  }

  public clearPending(agent: string, destination: string): Promise<void> {
    return this.mutate(agent, (entry) => ({
      ...entry,
      pending: entry.pending.filter((candidate) => candidate !== destination),
    }));
  }

  public destination(agent: string): string | undefined {
    return this.entry(agent).destination;
  }

  private state(): LedgerState {
    const raw = this.store.get<unknown>(this.key);
    return isRecord(raw) ? (raw as LedgerState) : {};
  }

  private async mutate(agent: string, change: (entry: AgentLedgerEntry) => AgentLedgerEntry): Promise<void> {
    await this.store.update(this.key, { ...this.state(), [agent]: change(this.entry(agent)) });
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

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
