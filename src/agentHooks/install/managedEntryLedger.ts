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

/**
 * One write this extension made: where it went and what exactly it put there.
 * The pair is the key — a path without its command is a cleanup obligation we
 * can no longer recognise, which is how a capped command list used to revoke
 * ownership of a configuration still listed as pending (round-9 B17).
 *
 * `claims` names the installations that still want this write in place (D18).
 * Empty means cleanup is owed. `unresolved` marks a record migrated from a
 * shape that never held the relationship, so its command is unknown rather than
 * absent (D19).
 */
export interface LedgerWrite {
  path: string;
  command: string;
  claims: string[];
  unresolved?: boolean;
}

export interface AgentLedgerEntry {
  writes: LedgerWrite[];
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
   * Reserved BEFORE the configuration is written (round-4 B6, D17). Anything but
   * `ok` means the caller must not write: a record reaching only this session is
   * not enough (round-7 B6), and a refusal at the ceiling is not either.
   */
  reserve(destination: string, command: string): Promise<Reservation>;
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
 * A ceiling on tracked writes (round-4 B7). It governs RESERVATIONS, not the
 * collection: a new write may be reserved only while there is room, and nothing
 * enters the collection except through a reservation. Two earlier attempts capped
 * the collection itself — insertion in round 4, the session/durable merge in
 * round 7 — and both had to choose between staying bounded and keeping every
 * obligation. A refusal has no such dilemma (D17).
 */
export const MAX_TRACKED_WRITES = 16;

/**
 * @deprecated Reserved writes replaced the pending list; kept until the
 * transition owner moves onto claims (task 8_2).
 */
export const MAX_PENDING_DESTINATIONS = MAX_TRACKED_WRITES;

/**
 * The scope a ledger with no installation identity claims under. A store that
 * cannot mint one (a test, or a host whose state is unreadable) still behaves
 * exactly as the single-`destination` build did.
 */
export const DEFAULT_INSTALLATION_SCOPE = "default";

/** Why a reservation was refused, and what the caller can tell the user. */
export type Reservation = { ok: true } | { ok: false; reason: "at-capacity" | "not-durable"; blockedBy: string[] };

export class ManagedEntryLedger {
  /**
   * What this host wrote and could not persist. Losing a destination we already
   * modified is worse than remembering it only until the window closes, so a
   * failed write stays here and is folded into the next successful one (D15).
   */
  private readonly session = new Map<string, AgentLedgerEntry>();

  /**
   * `scope` identifies this VS Code installation (D18). It belongs to the ledger
   * rather than to an agent because it says WHO is claiming, not what.
   */
  public constructor(
    private readonly store: LedgerStore,
    private readonly scope: string = DEFAULT_INSTALLATION_SCOPE,
  ) {}

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
    return {
      isOwned: (command) => {
        if (typeof command !== "string") {
          return false;
        }
        const writes = this.entry(agent).writes;
        return writes.length === 0 ? command === seedCommand : writes.some((write) => write.command === command);
      },
      refresh: async () => {
        await this.refresh(agent);
      },
      // The reservation IS the record (D17): a command reaching the user's file
      // without one is the unowned entry the whole ledger exists to prevent, so
      // the caller may not write until this resolves durably.
      reserve: (destination, command) => this.reserve(agent, destination, command),
      recordInstalled: async (destination, command) => {
        const persisted = await this.mutate(agent, (entry) =>
          claim(reserved(entry, canonical(destination), command), canonical(destination), command, this.scope),
        );
        // A finalization that did not persist needs nothing further: the claimed
        // write is held in the session entry and folds into the next successful
        // transaction (round-5 W5). Marking it owed as well — which is what the
        // pending list used to require — would release the claim on a file we
        // have just written, and lose the destination this host is using.
        void persisted;
      },
      recordRemoved: async (destination) => {
        await this.release(agent, destination);
      },
    };
  }

  /**
   * Reserves a write before it happens. Refused at the ceiling, naming what is
   * holding it; refused when it could not be persisted, because a record only
   * this session holds cannot authorize cleanup after the window closes.
   */
  public async reserve(agent: string, destination: string, command: string): Promise<Reservation> {
    const path = canonical(destination);
    let blockedBy: string[] = [];
    let room = true;
    const persisted = await this.mutate(agent, (entry) => {
      const known = entry.writes.some((write) => write.path === path && write.command === command);
      room = known || entry.writes.length < MAX_TRACKED_WRITES;
      if (!room) {
        blockedBy = entry.writes.filter((write) => write.claims.length === 0).map((write) => write.path);
        return entry;
      }
      return reserved(entry, path, command);
    });
    if (!room) {
      return { ok: false, reason: "at-capacity", blockedBy };
    }
    return persisted ? { ok: true } : { ok: false, reason: "not-durable", blockedBy: [] };
  }

  /** The writes nobody claims any more — cleanup this extension still owes (D13, D18). */
  public pending(agent: string): string[] {
    // By path: two reserved commands at one destination are one cleanup, and a
    // caller sweeping the same file twice would report the second as untouched.
    return [
      ...new Set(
        this.entry(agent)
          .writes.filter((write) => write.claims.length === 0)
          .map((write) => write.path),
      ),
    ];
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
      const known = entry.writes.some((write) => write.path === path);
      tracked = known || entry.writes.length < MAX_TRACKED_WRITES;
      if (!tracked) {
        return entry;
      }
      // Releasing every claim is what makes a write owed. A path we never
      // recorded arrives here only from a pre-D17 record, so it is tracked with
      // its command unknown rather than silently dropped (D19).
      return known
        ? { writes: entry.writes.map((write) => (write.path === path ? { ...write, claims: [] } : write)) }
        : { writes: [...entry.writes, { path, command: "", claims: [], unresolved: true }] };
    });
    return tracked && persisted;
  }

  public async clearPending(agent: string, destination: string): Promise<void> {
    await this.mutate(agent, (entry) => ({
      writes: entry.writes.filter((write) => write.path !== canonical(destination) || write.claims.length > 0),
    }));
  }

  /**
   * Where THIS installation last installed. Another installation's destination is
   * not ours to report, and was not ours to overwrite either (round-9 B14).
   */
  public destination(agent: string): string | undefined {
    return [...this.entry(agent).writes].reverse().find((write) => write.claims.includes(this.scope))?.path;
  }

  /**
   * Drops this installation's claim on a path. The record itself survives while
   * any other installation still wants it — removing it would sweep a
   * registration that is someone else's and still live (D18).
   */
  public async release(agent: string, destination: string): Promise<void> {
    const path = canonical(destination);
    await this.mutate(agent, (entry) => ({
      writes: entry.writes.flatMap((write) => {
        if (write.path !== path) {
          return [write];
        }
        const claims = write.claims.filter((claimant) => claimant !== this.scope);
        return claims.length > 0 ? [{ ...write, claims }] : [];
      }),
    }));
  }

  /**
   * "Remove everything" (D9): every installation's claim goes, because that is
   * what the user asked for — the one place a claim we do not hold is ours to
   * release.
   */
  public async releaseEverything(agent: string): Promise<void> {
    await this.mutate(agent, (entry) => ({
      writes: entry.writes.map((write) => ({ ...write, claims: [] })),
    }));
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
/**
 * Merged by the write's own key — path and command together. A record differing
 * only in its claims is the SAME write, so it merges rather than duplicating;
 * the session state wins, because this host's unpersisted change is the more
 * recent fact about a write it made. Nothing is trimmed here: the bound lives on
 * the reservation, which is the only thing that can add a key at all (D17).
 */
function fold(stored: AgentLedgerEntry, held: AgentLedgerEntry | undefined): AgentLedgerEntry {
  if (!held) {
    return stored;
  }
  const merged = new Map(stored.writes.map((write) => [key(write), write]));
  for (const write of held.writes) {
    merged.set(key(write), write);
  }
  return { writes: [...merged.values()] };
}

function key(write: LedgerWrite): string {
  return `${write.path} ${write.command}`;
}

/** Adds the write if it is new, leaving an existing one's claims alone. */
function reserved(entry: AgentLedgerEntry, path: string, command: string): AgentLedgerEntry {
  return entry.writes.some((write) => write.path === path && write.command === command)
    ? entry
    : { writes: [...entry.writes, { path, command, claims: [] }] };
}

/**
 * Claims the write this install just made, for one installation.
 *
 * A successful install sweeps our own older entries out of that file and
 * re-appends one, so any other command recorded at the SAME path is no longer in
 * it and stops being an obligation — which keeps repeated moves from
 * accumulating records. At every OTHER path this installation drops its claim,
 * because it has moved away; the record survives if another installation still
 * claims it, and becomes cleanup owed if nobody does. The claimed write goes
 * last, so `destination` reads the most recent one.
 */
function claim(entry: AgentLedgerEntry, path: string, command: string, scope: string): AgentLedgerEntry {
  const elsewhere = entry.writes.filter((write) => write.path !== path);
  const previous = entry.writes.find((write) => write.path === path && write.command === command);
  const claimed: LedgerWrite = {
    path,
    command,
    claims: [...new Set([...(previous?.claims ?? []), scope])],
  };
  return {
    writes: [
      ...elsewhere.map((write) => ({ ...write, claims: write.claims.filter((claimant) => claimant !== scope) })),
      claimed,
    ],
  };
}

function sanitize(value: unknown): AgentLedgerEntry {
  const record = isRecord(value) ? value : {};
  const writes = Array.isArray(record.writes) ? record.writes : [];
  return {
    writes: writes.filter(isRecord).flatMap((write) =>
      typeof write.path === "string" && typeof write.command === "string"
        ? [
            {
              path: write.path,
              command: write.command,
              claims: strings(write.claims),
              ...(write.unresolved === true ? { unresolved: true as const } : {}),
            },
          ]
        : [],
    ),
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

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
