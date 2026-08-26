// src/webview/worktree/worktreeRenderSignature.ts — Stable signature over the
// worktree tree + presence for the no-op render guard (worktree-panel-ui § 6.1).
//
// Mirrors src/webview/vault/vaultRenderSignature.ts and adds the rule that makes
// this view survivable: decorative title frames are stripped BEFORE the signature
// is computed. Without that, one agent's spinner repaints the whole tree at
// animation rate and destroys scroll position and expansion state.
//
// The signature covers every field a row, badge, pill, marker, or notice reads —
// a change the UI would reflect must never be masked by the guard. It is
// order-sensitive: the tree renders in array order, so a reorder is a change.

import { stripDecorations } from "./worktreeFormat";
import type { WorktreePresence, WorktreeTree } from "./worktreeViewTypes";

// Low control chars that cannot appear in branches, paths, ids, or titles, so
// distinct field layouts can't collide into one signature.
const FIELD_SEP = String.fromCharCode(1);
const ROW_SEP = String.fromCharCode(2);
const SECTION_SEP = String.fromCharCode(3);

export function worktreeSignature(tree: WorktreeTree | null, presence: WorktreePresence | null): string {
  if (!tree) {
    return "";
  }
  const repos = tree.repos
    .map((repo) =>
      [
        repo.repoId,
        repo.label,
        repo.mainPath,
        repo.degraded ?? "",
        repo.worktrees
          .map((w) =>
            [
              w.id,
              w.displayPath,
              w.kind,
              w.branch ?? "",
              w.head ?? "",
              w.bare ? "1" : "0",
              w.detached ? "1" : "0",
              w.locked ? "1" : "0",
              w.lockReason ?? "",
              w.prunable ? "1" : "0",
              w.missing ? "1" : "0",
              w.inWorkspace ? "1" : "0",
            ].join(FIELD_SEP),
          )
          .join(ROW_SEP),
      ].join(SECTION_SEP),
    )
    .join(ROW_SEP);

  // `unreadable.count` is occurrences and `reasons` is deduplicated for display —
  // both go in, because the copy shows the count and lists the reasons.
  const treePart = [
    tree.gitAvailable ? "1" : "0",
    String(tree.unreadable.count),
    tree.unreadable.reasons.join(FIELD_SEP),
    repos,
  ].join(SECTION_SEP);

  if (!presence) {
    return treePart;
  }

  // `scannedAt` is deliberately EXCLUDED: a rescan that found nothing new must not
  // invalidate the guard, or the guard buys nothing on a polling rebuild.
  const rows = Object.keys(presence.rowsByWorktreeId)
    .sort()
    .map((worktreeId) => {
      const list = presence.rowsByWorktreeId[worktreeId] ?? [];
      return [
        worktreeId,
        list
          .map((r) =>
            [
              r.rowId,
              r.scope,
              r.paneId ?? "",
              // Stripped, so a spinner tick alone leaves the signature unchanged.
              stripDecorations(r.title),
              r.preview ?? "",
              r.model ?? "",
              r.agent ?? "",
              r.agentSource,
              r.activity,
              r.activitySource,
              r.entryId ?? "",
              // Every clock `ageTimestamp` can fall back to, or a row whose only
              // moving timestamp is a fallback renders a frozen age.
              String(r.stateStartedAt ?? ""),
              String(r.finishedAt ?? ""),
              String(r.lastActivityAt ?? ""),
              String(r.startedAt ?? ""),
              (r.subagents ?? []).map((s) => [s.name, s.title ?? "", s.status].join(FIELD_SEP)).join(","),
            ].join(FIELD_SEP),
          )
          .join(ROW_SEP),
      ].join(SECTION_SEP);
    })
    .join(ROW_SEP);

  const degraded = presence.degradedSources
    .map((d) => [d.source, d.reason, String(d.since)].join(FIELD_SEP))
    .join(ROW_SEP);

  return [treePart, rows, degraded].join(SECTION_SEP);
}
