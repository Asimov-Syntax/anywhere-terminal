// src/vault/readers/subagentLookup.ts — Resolve a clicked subagent (Task) header's
// description to its on-disk transcript detail. The clicked text is matched by
// PREFIX against the parent session's subagent stubs (terminal width can clip the
// right edge), then read through the existing containment-checked subagent reader.
// See: specs/claude-running-session-map/spec.md "Resolve a clicked subagent…";
//      design.md D5.
//
// No `cwd` input: the readers locate the parent session by `sessionId` (there is
// no project-dir encoder), so resolution needs only the parent id + description.

import * as fs from "node:fs/promises";
import { prepareResolvedRoot } from "../../utils/pathBoundary";
import { parseEntryId, type VaultSessionDetail } from "../types";
import { listClaudeSubagentStubs, readClaudeSubagentDetail } from "./claudeChildren";
import { type ClaudeReaderOptions, claudeRoots, resolveClaudeSubagentPathUnder, SUBAGENT_MARKER } from "./claudePaths";
import { readClaudeDetail } from "./claudeReader";

/** Recover the `agent-*` file stem from a subagent stub's entry id
 *  (`claude:<parentId>:subagent:<stem>`). Returns null when it carries no marker. */
function stemFromEntryId(entryId: string): string | null {
  const parsed = parseEntryId(entryId);
  if (!parsed) {
    return null;
  }
  const at = parsed.sessionId.indexOf(SUBAGENT_MARKER);
  if (at < 0) {
    return null;
  }
  const stem = parsed.sessionId.slice(at + SUBAGENT_MARKER.length);
  return stem || null;
}

/** Among tied candidates, pick the one whose transcript file is most recent. */
async function pickNewestByMtime(
  parentId: string,
  candidates: Array<{ stem: string }>,
  options: ClaudeReaderOptions,
): Promise<{ stem: string }> {
  let best = candidates[0];
  let bestMtime = Number.NEGATIVE_INFINITY;
  // One prepared root for the whole tie: this loop already owns every candidate,
  // and resolving the same root per candidate is M syscalls for one answer
  // (design.md D8, review round-2 W1). Each candidate still resolves.
  const { projectsDir } = claudeRoots(options);
  const root = await prepareResolvedRoot(projectsDir);
  if (root === null) {
    return best;
  }
  for (const candidate of candidates) {
    const filePath = await resolveClaudeSubagentPathUnder(parentId, candidate.stem, projectsDir, root);
    let mtime = 0;
    if (filePath) {
      try {
        mtime = (await fs.stat(filePath)).mtimeMs;
      } catch {
        // unreadable → treat as oldest
      }
    }
    // Stable secondary key (lexical stem) so equal mtimes resolve deterministically
    // regardless of directory-scan order.
    if (mtime > bestMtime || (mtime === bestMtime && candidate.stem < best.stem)) {
      best = candidate;
      bestMtime = mtime;
    }
  }
  return best;
}

/**
 * Resolve the subagent of `sessionId` whose meta `description` is prefix-matched
 * by the clicked `description`, and return its bounded transcript detail (or null
 * when nothing matches / reads). Ties (several stubs sharing the prefix) are
 * broken by newest file mtime. Never throws.
 */
export async function resolveSubagentDetail(
  sessionId: string,
  description: string,
  options: ClaudeReaderOptions = {},
  limit?: number,
): Promise<VaultSessionDetail | null> {
  const clicked = description.trim();
  if (!clicked) {
    return null;
  }
  const stubs = await listClaudeSubagentStubs(sessionId, options);
  const candidates = stubs
    .filter((s): s is typeof s & { description: string } => typeof s.description === "string")
    // Terminal right-edge clipping only DROPS trailing chars, so the clicked text
    // is a prefix of (or equal to) the verbatim meta description.
    .filter((s) => s.description.startsWith(clicked))
    .map((s) => ({ stem: stemFromEntryId(s.entryId) }))
    .filter((c): c is { stem: string } => c.stem !== null);
  if (candidates.length === 0) {
    return null;
  }
  const chosen = candidates.length === 1 ? candidates[0] : await pickNewestByMtime(sessionId, candidates, options);
  // The detail's entryId mirrors the vault's subagent token so the renderer keys
  // nested nodes consistently (`<parentId>:subagent:<stem>`).
  const token = `${sessionId}${SUBAGENT_MARKER}${chosen.stem}`;
  return readClaudeSubagentDetail(sessionId, chosen.stem, token, options, limit);
}

/**
 * Resolve a subagent transcript directly by its vault `entryId` — the path used by
 * the terminal popup's NESTED drill-down (support-nested-subagent-preview D5): the
 * popup already holds a child's `claude:<parentId>:subagent:<stem>` id, so resolve
 * it by id (containment-checked inside `readClaudeDetail`) rather than re-matching a
 * live terminal + description. Subagent popups are Claude-only, so a non-`claude`
 * entryId resolves to null. Never throws beyond the reader's own guarantees.
 */
export async function resolveSubagentDetailByEntryId(
  entryId: string,
  options: ClaudeReaderOptions = {},
  limit?: number,
): Promise<VaultSessionDetail | null> {
  const parsed = parseEntryId(entryId);
  if (parsed?.agent !== "claude") {
    return null;
  }
  return readClaudeDetail(parsed.sessionId, options, limit);
}
