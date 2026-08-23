// src/vault/readers/claudeReader.ts — Read Claude Code sessions (metadata only)
// + dispatch on-demand session detail.
// See: specs/agent-session-index/spec.md (Read Claude Code sessions; Metadata-only),
//      design.md D4 (bounded title preview), D7 (cwd encoding), D8 (defensive parse),
//      docs/research/20260528-cmux-vault-mechanism.md §3.
//
// Sessions live at `<root>/projects/<encoded-cwd>/*.jsonl` where root is
// `$CLAUDE_CONFIG_DIR` else `~/.claude`, and the encoded-cwd dir name is the
// project cwd with every `/` replaced by `-`. We stream each file and stop once
// the title (first user message) and model (first assistant message) are found —
// the full transcript is never loaded.
//
// This module is the reader's entry point + metadata scanner; the heavier
// concerns are split out: path/id safety (claudePaths), bounded JSONL streaming
// (claudeRecords), team threading (claudeTeam), and nested children
// (claudeChildren). The shared classifier lives in ./detail.

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import type { ReaderListCache, ReaderResultWithState } from "../cacheTypes";
import { boundedPreview } from "../preview";
import { formatEntryId, type VaultSessionDetail, type VaultSessionEntry } from "../types";
import { type ClaudeChildId, parseClaudeChildId } from "./claudeChildIds";
import {
  listClaudeSubagentStubs,
  listClaudeWorkflowNodes,
  readClaudeSubagentDetail,
  readClaudeWorkflowAgentDetail,
  readClaudeWorkflowDetail,
} from "./claudeChildren";
import {
  type ClaudeReaderOptions,
  claudeRoots,
  decodeProjectDir,
  isSafeSessionId,
  listJsonlFiles,
  resolveClaudeSessionPath,
  resolveClaudeSubagentPath,
  resolveClaudeWorkflowAgentPath,
} from "./claudePaths";
import { extractUserText, readLatestTailFields, streamClaudeRecords } from "./claudeRecords";
import {
  buildTeamThread,
  readClaudeTeamSegment,
  recordTeamIdentity,
  teamContextCollector,
  teammateMessageHook,
} from "./claudeTeam";
import {
  boundTimeline,
  clampDetailLimit,
  classifyClaudeStyleEvents,
  createSpawnIdCollector,
  finalizeDetail,
  MAX_TIMELINE_ITEMS,
  mergeTimestampedItems,
  scopeDirectChildren,
} from "./detail";
import { findRecordLine, type RecordLineResult } from "./recordLine";

const NOT_FOUND = { ok: false, reason: "not-found" } as const;

export { listClaudeWorkflowStubs } from "./claudeChildren";
// Re-export the public reader surface so existing importers (VaultService, the
// Codex reader's `ReaderResult` type, and the reader tests) keep their paths.
export type { ClaudeReaderOptions } from "./claudePaths";
export { resolveClaudeSessionPath, resolveClaudeSubagentPath } from "./claudePaths";

export interface ReaderResult {
  entries: VaultSessionEntry[];
  unreadable: number;
}

interface ClaudeFileFields {
  cwd?: string;
  gitBranch?: string;
  permissionMode?: string;
  model?: string;
  /** The first human prompt (or a legacy summary) — the LAST resort for a title. */
  title?: string;
  /** True when at least one line parsed as JSON — otherwise the file is junk. */
  parsedAnyLine: boolean;
  /**
   * True when the session has real content: a human prompt (a non-meta user
   * record whose text survives `cleanPromptText`) OR an assistant turn (which
   * carries any tool use). A session with NEITHER — e.g. a transcript holding
   * only a `/clear` command + caveat banner — is junk the list hides (D18).
   */
  hasContent: boolean;
  /**
   * True when this session is a non-lead TEAM MEMBER: an early record (within the
   * metadata head scan) carries BOTH a non-empty `agentName` and `teamName` — it
   * was born into a team rather than spawning one. The top-level list excludes
   * these (nest-workflow-team-sessions D5); a leader has neither on its early
   * records (the team is created mid-session). The predicate MUST match the
   * team-grouping predicate (D4) so an `agentName`-only session is never hidden.
   */
  isTeamMember: boolean;
}

async function parseClaudeFile(filePath: string): Promise<ClaudeFileFields | null> {
  const fields: ClaudeFileFields = { parsedAnyLine: false, isTeamMember: false, hasContent: false };
  let summary: string | undefined;
  let haveUser = false;
  let haveAssistant = false;

  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({
      input: stream,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let obj: Record<string, unknown>;
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed !== "object" || parsed === null) {
          continue;
        }
        obj = parsed as Record<string, unknown>;
      } catch {
        continue; // skip a single corrupt line, keep reading (D8)
      }
      fields.parsedAnyLine = true;

      if (fields.cwd === undefined && typeof obj.cwd === "string") {
        fields.cwd = obj.cwd;
      }
      if (fields.gitBranch === undefined && typeof obj.gitBranch === "string") {
        fields.gitBranch = obj.gitBranch;
      }
      // Permission mode is session STATE, not an attribute — LAST one in this
      // window wins, never the first (D1). The tail scan overrides it below.
      if (typeof obj.permissionMode === "string") {
        fields.permissionMode = obj.permissionMode;
      }
      if (summary === undefined && obj.type === "summary" && typeof obj.summary === "string") {
        summary = obj.summary;
      }
      if (!haveUser && obj.type === "user" && obj.isMeta !== true && obj.isSidechain !== true) {
        const text = extractUserText(obj);
        if (text) {
          fields.title = text;
          // Team-member detection (D5, W2): decided on this FIRST identity record
          // — a teammate is born into a team with both fields here; a leader has
          // neither (the team it later creates comes after this record).
          fields.isTeamMember = recordTeamIdentity(obj) !== null;
          haveUser = true;
        }
      }
      if (!haveAssistant && obj.type === "assistant") {
        const model = (obj.message as { model?: unknown } | undefined)?.model;
        if (typeof model === "string") {
          fields.model = model;
          haveAssistant = true;
        }
      }
      // Title + model are the last-appearing fields we need; cwd/branch/mode
      // sit on earlier lines, so stop here to avoid loading the transcript.
      if (haveUser && haveAssistant) {
        break;
      }
    }
  } catch {
    return null; // stream/open failure → unreadable
  } finally {
    rl?.close();
    stream?.destroy();
  }

  if (!fields.parsedAnyLine) {
    return null;
  }
  fields.hasContent = haveUser || haveAssistant;
  if (fields.title === undefined && summary !== undefined) {
    fields.title = summary;
  }
  return fields;
}

/**
 * On-demand bounded detail for a Claude session: resolve the file by id, stream
 * + classify its mixed-event records. Returns null when the session can't be
 * located or read.
 */
export async function readClaudeDetail(
  sessionId: string,
  options: ClaudeReaderOptions = {},
  limit?: number,
): Promise<VaultSessionDetail | null> {
  // A child id carries a marker (`:subagent:` / `:workflow:` / `:wfagent:` /
  // `:team:`); a plain session id parses to null and falls through to the
  // main-session path below. Each child branch resolves by id under the projects
  // root (containment-checked) — never a webview-supplied path (D2/D6).
  const child = parseClaudeChildId(sessionId);
  if (child) {
    return readClaudeChildDetail(child, sessionId, options, limit);
  }

  const filePath = await resolveClaudeSessionPath(sessionId, options);
  if (!filePath) {
    return null;
  }
  // Collect the leader's team context across the WHOLE stream (even records the
  // head+tail bound later drops) so a team episode buried mid-transcript is still
  // grouped (D4), and detect whether THIS session is itself a non-lead member —
  // a member must NOT synthesize its own Team group (recursive peer nesting, W3),
  // so team groups are leader-only.
  // Two whole-stream side-collectors share the single pass: team context (D4) and
  // the root's `Agent`/`Task` spawn ids (non-sidechain only) used to scope subagent
  // stubs to root's DIRECT children — so a subagent spawned inside another subagent
  // is NOT flattened under the root (support-nested-subagent-preview D2).
  const { ctx, onRecord } = teamContextCollector();
  const spawn = createSpawnIdCollector(false);
  const read = await streamClaudeRecords(filePath, {
    onRecord: (rec) => {
      onRecord(rec);
      spawn.onRecord(rec);
    },
  });
  if (read === null) {
    return null;
  }
  // childStubs = flat subagents ∪ workflow groups (each folds into its spawn call
  // or merges by timestamp). Team members are NOT collapsed groups any more:
  // their communication turns are threaded as `teammateTurn` nodes (D13/D14). A
  // member resolves an empty team set → no teammate turns under it (W3).
  const teamScanNames = ctx.selfIsMember ? new Set<string>() : ctx.teamNames;
  const [subStubs, wfNodes, teammateTurns] = await Promise.all([
    listClaudeSubagentStubs(sessionId, options),
    listClaudeWorkflowNodes(sessionId, options),
    buildTeamThread(filePath, teamScanNames, ctx.colorByMember),
  ]);
  // Progress-bearing runs render INLINE as self-collapsing `workflowBoard` items (no
  // wrapper layer) — threaded with the teammate turns by timestamp below. Fallback
  // runs fold in as lazy "Workflow:" group stubs (classify merges them).
  const childStubs = [...scopeDirectChildren(subStubs, spawn.ids), ...wfNodes.stubs];
  const detail = classifyClaudeStyleEvents(read.records, { limit, childStubs, teammateMessage: teammateMessageHook });
  // Thread the teammate turns + inline workflow boards into the classified timeline
  // by timestamp, then re-bound (classify already bounded its stream-derived items) (D14).
  const extras = [...teammateTurns, ...wfNodes.boards];
  if (extras.length > 0) {
    const merged = mergeTimestampedItems(detail.timeline, extras);
    const bounded = boundTimeline(merged, clampDetailLimit(limit) ?? MAX_TIMELINE_ITEMS);
    detail.timeline = bounded.timeline;
    if (bounded.truncated) {
      detail.truncated = true;
    }
  }
  return finalizeDetail(formatEntryId("claude", sessionId), detail, read.truncated);
}

/**
 * The verbatim transcript line whose record carries `msgRef` (its `uuid`), for the
 * per-message Raw copy (D5). Aggregate child ids (a workflow group, a team turn)
 * span no single file and resolve to null. Returns null when nothing matches or the
 * line exceeds `maxBytes`.
 */
export async function readClaudeMessageRecord(
  sessionId: string,
  msgRef: string,
  options: ClaudeReaderOptions = {},
  maxBytes?: number,
): Promise<RecordLineResult> {
  if (!isSafeSessionId(msgRef)) {
    return NOT_FOUND;
  }
  const child = parseClaudeChildId(sessionId);
  let filePath: string | null;
  switch (child?.kind) {
    case undefined:
      filePath = await resolveClaudeSessionPath(sessionId, options);
      break;
    case "subagent":
      filePath = await resolveClaudeSubagentPath(child.parentId, child.stem, options);
      break;
    case "wfagent":
      filePath = await resolveClaudeWorkflowAgentPath(child.parentId, child.wfId, child.stem, options);
      break;
    default:
      filePath = null;
  }
  // A uuid rides plumbing records too (summaries, trailers), so matching it
  // alone would resolve one of those as the message the locator names.
  return filePath
    ? findRecordLine(
        filePath,
        (rec) => rec.uuid === msgRef && (rec.type === "user" || rec.type === "assistant"),
        maxBytes,
        { needles: [`"uuid":${JSON.stringify(msgRef)}`] },
      )
    : NOT_FOUND;
}

/** Dispatch a parsed child id to its resolver (nest-workflow-team-sessions D2). */
async function readClaudeChildDetail(
  child: ClaudeChildId,
  sessionId: string,
  options: ClaudeReaderOptions,
  limit: number | undefined,
): Promise<VaultSessionDetail | null> {
  switch (child.kind) {
    case "subagent":
      return readClaudeSubagentDetail(child.parentId, child.stem, sessionId, options, limit);
    case "workflow":
      return readClaudeWorkflowDetail(child.parentId, child.wfId, sessionId, options, limit);
    case "wfagent":
      return readClaudeWorkflowAgentDetail(child.parentId, child.wfId, child.stem, sessionId, options, limit);
    case "teamTurn":
      return readClaudeTeamSegment(child.memberId, child.turn, options, limit);
  }
}

/**
 * Build one Claude entry from its session file (metadata + first/last record).
 * Shared by the list scan and the single-entry resolve so both produce identical
 * entries. Throws on stat/read failure (caller catches → unreadable); returns
 * null when the file has no usable records (D8). The cwd falls back to the decoded
 * project-dir name (the file's parent) when the transcript omits it.
 */
async function buildClaudeEntry(
  filePath: string,
  sessionId: string,
  configDir: string | undefined,
): Promise<{ entry: VaultSessionEntry; isTeamMember: boolean; isEmpty: boolean } | null> {
  const stat = await fs.stat(filePath);
  const fields = await parseClaudeFile(filePath);
  if (!fields) {
    return null;
  }
  // Claude's own display precedence, so a row reads as it does in Claude: the
  // name the user gave the session > the title Claude generated > the last
  // prompt > the first prompt.
  const tail = await readLatestTailFields(filePath);
  const title = tail.customTitle ?? tail.aiTitle ?? tail.lastPrompt ?? fields.title ?? "";
  const entry: VaultSessionEntry = {
    id: formatEntryId("claude", sessionId),
    agent: "claude",
    sessionId,
    title: boundedPreview(title),
    cwd: fields.cwd ?? decodeProjectDir(path.basename(path.dirname(filePath))),
    modified: stat.mtimeMs,
    gitBranch: fields.gitBranch,
    flags: {
      model: fields.model,
      // The mode as of the END of the session: the tail scan sees every change the
      // head window stopped short of, so it wins when it found one (D1). Neither
      // scan finding one leaves the flag off — the CLI applies its own default.
      permissionMode: tail.permissionMode ?? fields.permissionMode,
      configDir,
    },
    canFork: false, // resolved by VaultService (task 2_5)
    // File-backed → the webview shows file-targeting context-menu items;
    // the host re-derives this path by id, never trusting it (D9).
    sessionPath: filePath,
  };
  // isTeamMember / isEmpty ride alongside (not on the entry) so the list path can
  // EXCLUDE members (D5) and content-less junk (D18), while the single-entry
  // resolve still returns them — both are real sessions, launchable by explicit
  // id even when hidden from the list.
  return { entry, isTeamMember: fields.isTeamMember, isEmpty: !fields.hasContent };
}

/**
 * List Claude sessions, incrementally (cache-vault-load D3). When `prev` carries
 * a per-file cache, each session file is `stat`-ed and — if its `(mtimeMs, size)`
 * is unchanged — its entry is reused WITHOUT re-reading the body (skipping the
 * metadata stream and the 64 KB ai-title tail read, the dominant cost). Files
 * absent from disk drop out of the returned cache, so deletions reconcile. The
 * returned `cache.files` is keyed by current paths only.
 *
 * Stays option-first for back-compat; `prev` is an optional second argument.
 */
export async function readClaudeSessions(
  options: ClaudeReaderOptions = {},
  prev?: ReaderListCache,
): Promise<ReaderResultWithState> {
  const { configDir, projectsDir } = claudeRoots(options);
  const prevFiles = prev?.kind === "files" ? prev.files : undefined;
  const files: Record<string, { stamp: { mtimeMs: number; size: number }; entry: VaultSessionEntry }> = {};

  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // No store → zero entries (not an error), and an empty cache so the next
    // refresh re-discovers the dir if the user starts using the agent.
    return { entries: [], unreadable: 0, cache: { kind: "files", files } };
  }

  const entries: VaultSessionEntry[] = [];
  let unreadable = 0;

  for (const projectDir of projectDirs) {
    const dirPath = path.join(projectsDir, projectDir);
    const jsonlFiles = await listJsonlFiles(dirPath);
    for (const filePath of jsonlFiles) {
      const sessionId = path.basename(filePath, ".jsonl");
      try {
        const stat = await fs.stat(filePath);
        const stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
        const cached = prevFiles?.[filePath];
        if (cached && cached.stamp.mtimeMs === stamp.mtimeMs && cached.stamp.size === stamp.size) {
          // Unchanged + previously LISTED file — reuse the cached entry without a
          // body read (skips the metadata stream + the 64 KB ai-title tail, the
          // dominant cost). Only listed entries are ever cached (below), so a hit
          // is always safe to push; a member/empty file is never a hit.
          files[filePath] = cached;
          entries.push(cached.entry);
          continue;
        }
        const built = await buildClaudeEntry(filePath, sessionId, configDir);
        if (!built) {
          unreadable++;
        } else if (built.isTeamMember || built.isEmpty) {
          // Members thread under their leader (D5); content-less sessions
          // (only a /clear, a caveat banner, …) are junk — neither is listed (D18).
          // Excluded sessions carry no listed entry, so they are NOT cached and get
          // re-evaluated each refresh (cheap relative to a full first-load scan).
        } else {
          files[filePath] = { stamp, entry: built.entry };
          entries.push(built.entry);
        }
      } catch {
        unreadable++;
      }
    }
  }

  return { entries, unreadable, cache: { kind: "files", files } };
}

/**
 * Resolve ONE Claude session to its launch entry by id — the single-entry
 * counterpart to readClaudeSessions, used by VaultService.getEntry for fast
 * resume/fork (no full-store scan; D3). Locates the file via the same
 * containment-checked, metadata-only path resolver. Returns null for an unsafe
 * id or an unlocatable/unparseable session.
 */
export async function readClaudeEntry(
  sessionId: string,
  options: ClaudeReaderOptions = {},
): Promise<VaultSessionEntry | null> {
  const { configDir } = claudeRoots(options);
  const filePath = await resolveClaudeSessionPath(sessionId, options);
  if (!filePath) {
    return null;
  }
  try {
    // Resolve-by-id returns the entry even for a team member (it's a real,
    // launchable session) — only the list path hides members (D5).
    const built = await buildClaudeEntry(filePath, sessionId, configDir);
    return built ? built.entry : null;
  } catch {
    return null;
  }
}
