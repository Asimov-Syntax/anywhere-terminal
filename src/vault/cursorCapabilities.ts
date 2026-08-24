// src/vault/cursorCapabilities.ts — Canonical predicate for safe, source-qualified
// Cursor CLI Resume entries.
// See: specs/vault-session-launch/spec.md#cursor-source-capability-enforcement;
//      .reviews/round-4.md S8.
//
// Cursor IDE entries, unmatched project-transcript entries, and any forged/stale
// entry MUST be rejected before executable probing or launch. This is the single
// pure predicate every host launch seam (LaunchBuilder, VaultLauncher) calls so
// the CLI-only Resume boundary cannot drift between resolution, command-copy,
// and build paths. Each seam still performs its own independent rejection —
// this module only centralizes WHAT counts as safe, not the throwing.

import { isSafeCursorChatId } from "./readers/cursorPaths";
import type { VaultSessionEntry } from "./types";

/**
 * True only for a Cursor entry that is safe to pass to the CLI's `--resume
 * [chatId]`: sourced from the CLI's own chat storage (not IDE/project), proven
 * resumable, addressed by the canonical `cursor:<sessionId>` id, and carrying a
 * chat id that passes the canonical safe-id validator (no path traversal, no
 * unsafe characters).
 */
export function isCursorCliResumableEntry(entry: Pick<VaultSessionEntry, "agent" | "source" | "canResume" | "id" | "sessionId">): boolean {
  return (
    entry.agent === "cursor" &&
    entry.source === "cli" &&
    entry.canResume === true &&
    entry.id === `cursor:${entry.sessionId}` &&
    isSafeCursorChatId(entry.sessionId)
  );
}
