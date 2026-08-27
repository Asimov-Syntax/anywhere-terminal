// src/agentHooks/install/types.ts — The seam between the shared managed-config
// reconciler and the per-agent document shapes (install-claude-hooks D1).
// Everything about locking, retrying, and replacing a file belongs to the
// installer; everything about what the document looks like belongs here.

export type JsonObject = Record<string, unknown>;

export type Platform = "darwin" | "linux" | "win32";

/**
 * A read is classified rather than coerced (D10). The shipped code collapsed a
 * parse failure into `{}`, which Cursor survived only because its shape gate
 * demanded `version: 1`. Claude has no such field, so the collapse would rewrite
 * a user's malformed settings file as a fresh one holding nothing but our hooks.
 */
export type ConfigRead =
  | { kind: "missing" }
  | { kind: "document"; contents: string; document: JsonObject; mode?: number }
  | { kind: "unsupported" };

export interface AgentConfigAdapter {
  /** Absolute path to the agent's configuration file. */
  configPath(): string;
  /**
   * The extension-owned directory name and wrapper filename. Together they are
   * managed-entry identity (D3): ownership is the directory pair, not the bare
   * filename, so a user's same-named script elsewhere is never swept.
   */
  wrapperLocation(platform: Platform): { directoryName: string; fileName: string };
  /** Rejects a document this agent's installer must not merge into (D2). */
  isSupportedDocument(document: JsonObject): boolean;
  /** Seeds a document for a config file that does not exist yet (D10). */
  createInitialDocument(): JsonObject;
  /** Adds or refreshes the managed entry for every registered event; false when nothing changed. */
  applyManagedEntries(document: JsonObject, command: string, isOwned: OwnershipTest): boolean;
  /** Removes entries this extension owns; false when none were present. */
  removeManagedEntries(document: JsonObject, isOwned: OwnershipTest): boolean;
  /** The script the agent runs. */
  wrapperScript(platform: Platform): string;
}

/** True when a stored hook command invokes this extension's managed wrapper. */
export type OwnershipTest = (command: unknown) => boolean;

export interface HookInstallOutcome {
  installed: boolean;
  reason?: "unsupported-config" | "lock-unavailable" | "write-failed" | "windows-probe-failed";
}

export interface HookRemoveOutcome {
  removed: boolean;
  reason?: "unsupported-config" | "lock-unavailable" | "write-failed" | "not-installed";
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
