// src/vault/VaultAgentAdapter.ts — one object per vault agent, replacing the
// parallel `Record<VaultAgentId, …>` maps VaultService used to keep per capability.
// Adding an agent is then ONE registration a `satisfies Record<VaultAgentId, …>`
// can prove complete, instead of N maps each of which fails silently on omission.
//
// Capabilities an agent does not have are ABSENT, never stubbed: Claude has no
// writable title field, and asking every reader to model one would be the false
// generality this collapse exists to avoid.

import type { ListReader } from "./cacheTypes";
import type { RecordLineResult } from "./readers/recordLine";
import type { VaultAgentId } from "./registry";
import type { VaultEntryLookup, VaultSessionDetail } from "./types";

/** A directory + glob to hand to `WatcherPool.subscribePattern` (enhance-vault-sessions
 *  D4/D5). Resolved from the reader path helpers so watch targets never drift. */
export interface VaultWatchTarget {
  baseDir: string;
  glob: string;
  events?: Array<"create" | "change" | "delete">;
  /** Present when watcher events can be routed to one incremental reader. */
  agent?: VaultAgentId;
}

/** Writes a user-chosen title into an agent's own store; true iff a row was
 *  updated (write-vault-rename-to-store D1). */
export type VaultNativeRenamer = (sessionId: string, name: string) => Promise<boolean>;

export interface VaultAgentAdapter {
  /** Incremental list read: given the prior per-agent cache, return the current
   *  entries + the freshness state to persist (cache-vault-load D3). */
  list: ListReader;
  /** On-demand single-session detail. `limit` bounds the returned timeline
   *  (most-recent kept) so the webview can load older messages incrementally. */
  detail: (sessionId: string, limit?: number) => Promise<VaultSessionDetail | null>;
  /** Resolve ONE launch entry by id, with no full scan — the resume/fork fast path.
   *  Answers conclusively: a session that is not there is `absent`, a lookup that
   *  could not find out is `unknown` (tell-an-absent-session-from-an-unknown-one D1). */
  entry: (sessionId: string) => Promise<VaultEntryLookup>;
  /** Resolve the `msgRef` a timeline item carries back to its stored record
   *  (improve-vault-transcript-messages D5). */
  record: (sessionId: string, msgRef: string) => Promise<RecordLineResult>;
  /** Present only for agents whose store has a writable title. */
  renameNative?: VaultNativeRenamer;
  /** Store-wide FS-watch targets for auto-refresh (enhance-vault-sessions D4). */
  storeWatchTargets?: () => VaultWatchTarget[];
  /**
   * Per-session FS-watch targets for live-follow (D5), scoped to the ONE
   * previewed session. An id that reaches a glob must be validated by the
   * adapter that interpolates it — the service cannot know which of them do.
   * Returns `[]` for an unresolvable or unsafe id.
   */
  sessionWatchTargets?: (sessionId: string) => Promise<VaultWatchTarget[]>;
}
