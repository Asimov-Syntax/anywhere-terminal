// src/webview/vault/vaultRenderSignature.ts — Stable signature over a vault list
// for the no-op render guard (cache-vault-load D6).
//
// The signature covers EVERY field the row, the folder filter, and the row actions
// read — not just id/modified/title — so a change the UI would reflect (e.g. a
// `canFork` flip after an agent version change, or a `cwd` change that affects the
// "This folder only" filter) never gets masked by the guard. It is order-sensitive:
// a reorder changes the signature (the list renders in array order).

import type { VaultSessionEntry } from "../../vault/types";

// Field/record separators (low control chars) that won't appear in titles, paths,
// or ids, so distinct field layouts can't collide into the same signature.
const FIELD_SEP = String.fromCharCode(1);
const ROW_SEP = String.fromCharCode(2);

export function entriesSignature(entries: readonly VaultSessionEntry[]): string {
  return entries
    .map((e) =>
      [
        e.id,
        e.agent,
        e.title,
        // A rename only changes `customName` (the derived title is untouched), and
        // the session's git branch shows as a header chip — both must be in the
        // signature or the no-op guard would mask the change (enhance-vault-sessions D1).
        e.customName ?? "",
        e.gitBranch ?? "",
        e.cwd,
        String(e.modified),
        e.canFork ? "1" : "0",
        // Explicit false hides Resume; undefined preserves legacy resume behavior.
        e.canResume === false ? "0" : "1",
        e.sessionPath ?? "",
        // Cursor's `cli`/`ide` storage domain drives badges and capability-gated
        // actions (e.g. resume); a source-only delta must not be masked
        // (integrate-cursor-agent D6).
        e.source ?? "",
        JSON.stringify(e.flags ?? {}),
      ].join(FIELD_SEP),
    )
    .join(ROW_SEP);
}
