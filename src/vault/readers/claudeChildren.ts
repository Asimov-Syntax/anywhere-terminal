// src/vault/readers/claudeChildren.ts — Claude nested children: subagent (`Task`/
// `Agent`) transcripts and `/workflow` runs (nest-workflow-team-sessions D2/D3).
// Discovers lazy stubs for the parent preview and resolves each child id to its
// own bounded detail. Every path is id-derived + containment-checked (claudePaths).

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { boundedPreview } from "../preview";
import { formatEntryId, type VaultSessionDetail, type VaultTimelineItem } from "../types";
import { formatWorkflowAgentSessionId, formatWorkflowSessionId } from "./claudeChildIds";
import {
  type ClaudeReaderOptions,
  claudeRoots,
  isSafeSessionId,
  resolveClaudeSessionPath,
  resolveClaudeSubagentPath,
  resolveClaudeWorkflowAgentPath,
  SUBAGENT_MARKER,
  WORKFLOW_AGENT_STEM_RE,
  WORKFLOW_ID_RE,
} from "./claudePaths";
import { coerceTimestamp, readFirstUserRecord, readManifestJson, streamClaudeRecords } from "./claudeRecords";
import {
  type ClaudeChildStub,
  classifyClaudeStyleEvents,
  createSpawnIdCollector,
  finalizeDetail,
  scopeDirectChildren,
  sourceVerdict,
  synthesizeGroupDetail,
  truncate,
} from "./detail";

/** A subagent's own detail: its records are all `isSidechain` (that IS the
 *  conversation here), so classify with `includeSidechain`. It ALSO embeds this
 *  subagent's OWN direct children — the session's flat subagent list scoped to the
 *  `Agent`/`Task` ids spawned within THIS transcript — so a sub-subagent is
 *  expandable, recursing through the same `<parentId>:subagent:<stem>` id scheme
 *  (support-nested-subagent-preview D3). */
export async function readClaudeSubagentDetail(
  parentId: string,
  stem: string,
  sessionId: string,
  options: ClaudeReaderOptions,
  limit: number | undefined,
): Promise<VaultSessionDetail | null> {
  const filePath = await resolveClaudeSubagentPath(parentId, stem, options);
  if (!filePath) {
    return null;
  }
  // Collect this subagent's spawn ids (whole stream, ALL records — the file is the
  // sidechain) while reading; scope the session's flat subagent list to its direct
  // children. Both reads run in parallel.
  const spawn = createSpawnIdCollector(true);
  const [read, allStubs] = await Promise.all([
    streamClaudeRecords(filePath, { onRecord: spawn.onRecord }),
    listClaudeSubagentStubs(parentId, options),
  ]);
  if (read === null) {
    return null;
  }
  const childStubs = scopeDirectChildren(allStubs, spawn.ids);
  const detail = classifyClaudeStyleEvents(read.records, { limit, includeSidechain: true, childStubs });
  return finalizeDetail(formatEntryId("claude", sessionId), detail, sourceVerdict(read.truncated));
}

type ManifestObj = Record<string, unknown>;

function asObj(v: unknown): ManifestObj | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as ManifestObj) : undefined;
}
function manifestString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function manifestNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
/** A non-negative integer or undefined — for index/phaseIndex, which drive
 *  equality-based grouping (a fractional/negative value would land agents in a
 *  phantom group). */
function manifestInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/** Defensive caps on board rows so a pathological/corrupt manifest (bounded only
 *  by readManifestJson's 2 MiB file cap) can't ship an unbounded IPC payload or a
 *  giant synchronous DOM build. Far above any realistic workflow (~tens of agents). */
const MAX_BOARD_PHASES = 100;
const MAX_BOARD_AGENTS = 500;

/** True when the manifest carries at least one per-agent progress entry — the
 *  signal that a manifest-fed board (vs. the first-prompt fallback) can be built. */
function hasWorkflowAgents(progress: unknown): boolean {
  return Array.isArray(progress) && progress.some((e) => asObj(e)?.type === "workflow_agent");
}

/** Valid workflow-agent stems (`agent-*`) from a `subagents/workflows/<wfId>` dir
 *  listing — the jsonl transcripts, sorted. Shared by the eager board build and the
 *  lazy group detail so both resolve drill-down ids identically. */
function workflowAgentStems(files: string[]): string[] {
  return files
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.slice(0, -".jsonl".length))
    .filter((s) => WORKFLOW_AGENT_STEM_RE.test(s))
    .sort();
}

/** Read the agent transcript stems under `<parentId>/subagents/workflows/<wfId>`
 *  for an eager board build (best-effort: a missing/escaping dir → empty set, which
 *  just costs per-agent drill-down — the board still renders from the manifest). */
async function readWorkflowAgentStems(
  projectDir: string,
  parentId: string,
  wfId: string,
  projectsDir: string,
): Promise<Set<string>> {
  const agentsDir = path.join(projectDir, parentId, "subagents", "workflows", wfId);
  const rel = path.relative(projectsDir, agentsDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return new Set();
  }
  let files: string[];
  try {
    files = await fs.readdir(agentsDir);
  } catch {
    return new Set();
  }
  return new Set(workflowAgentStems(files));
}

type WorkflowBoardItem = Extract<VaultTimelineItem, { kind: "workflowBoard" }>;

/**
 * Map a run manifest's `workflowProgress` to a `workflowBoard` timeline item
 * (render-vault-workflow-board D2). Phase rows come from `workflow_phase` entries
 * (sorted by 1-based `index`), each phase's `detail` resolved positionally from
 * the 0-based `manifest.phases` array (`index - 1`) with a title-equality fallback.
 * Agent rows come from `workflow_agent` entries in progress order; an agent gets a
 * `:wfagent:` drill-down `entryId` ONLY when its `agentId` is non-empty alphanumeric
 * and `agent-<agentId>` is in `stemSet` (its transcript file exists). Scalars/ids
 * pass through raw — the webview formats them.
 */
function buildWorkflowBoardItem(
  manifest: ManifestObj,
  parentId: string,
  wfId: string,
  stemSet: Set<string>,
): WorkflowBoardItem {
  const progress = Array.isArray(manifest.workflowProgress) ? manifest.workflowProgress : [];
  const manifestPhases = Array.isArray(manifest.phases) ? manifest.phases : [];

  const phaseDetail = (index: number, title: string): string | undefined => {
    const positional = asObj(manifestPhases[index - 1]);
    if (positional) {
      const t = manifestString(positional.title);
      if (t === undefined || t === title) {
        return manifestString(positional.detail);
      }
    }
    for (const p of manifestPhases) {
      const obj = asObj(p);
      if (obj && manifestString(obj.title) === title) {
        return manifestString(obj.detail);
      }
    }
    return positional ? manifestString(positional.detail) : undefined;
  };

  // Pre-scan explicit phase indices so a synthesized index (for an entry missing
  // one) can't collide with a real one — a collision would group the same agents
  // under two phases (W2). Real manifests always carry sequential indices.
  const usedPhaseIndexes = new Set<number>();
  for (const entry of progress) {
    const obj = asObj(entry);
    if (obj?.type === "workflow_phase") {
      const i = manifestInt(obj.index);
      if (i !== undefined) {
        usedPhaseIndexes.add(i);
      }
    }
  }
  let nextSynthPhaseIndex = 1;
  const synthPhaseIndex = (): number => {
    while (usedPhaseIndexes.has(nextSynthPhaseIndex)) {
      nextSynthPhaseIndex++;
    }
    usedPhaseIndexes.add(nextSynthPhaseIndex);
    return nextSynthPhaseIndex;
  };

  const phases: WorkflowBoardItem["phases"] = [];
  const agents: WorkflowBoardItem["agents"] = [];
  for (const entry of progress) {
    const obj = asObj(entry);
    if (!obj) {
      continue;
    }
    if (obj.type === "workflow_phase") {
      if (phases.length >= MAX_BOARD_PHASES) {
        continue;
      }
      const index = manifestInt(obj.index) ?? synthPhaseIndex();
      const rawTitle = manifestString(obj.title);
      const title = rawTitle ? truncate(rawTitle) : `Phase ${index}`;
      const detail = phaseDetail(index, title);
      phases.push({ index, title, ...(detail ? { detail: truncate(detail) } : {}) });
    } else if (obj.type === "workflow_agent") {
      if (agents.length >= MAX_BOARD_AGENTS) {
        continue;
      }
      const agentId = manifestString(obj.agentId);
      const stem = agentId && /^[A-Za-z0-9]+$/.test(agentId) ? `agent-${agentId}` : undefined;
      const entryId =
        stem && stemSet.has(stem)
          ? formatEntryId("claude", formatWorkflowAgentSessionId(parentId, wfId, stem))
          : undefined;
      const tokens = manifestNumber(obj.tokens);
      const toolCalls = manifestNumber(obj.toolCalls);
      const durationMs = manifestNumber(obj.durationMs);
      const model = manifestString(obj.model);
      agents.push({
        label: truncate(manifestString(obj.label) ?? agentId ?? "agent"),
        phaseIndex: manifestInt(obj.phaseIndex) ?? 0,
        ...(entryId ? { entryId } : {}),
        ...(model ? { model: truncate(model) } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        ...(toolCalls !== undefined ? { toolCalls } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
    }
  }
  phases.sort((a, b) => a.index - b.index);

  const summary = manifestString(manifest.summary);
  const status = manifestString(manifest.status);
  const agentCount = manifestNumber(manifest.agentCount);
  const durationMs = manifestNumber(manifest.durationMs);
  const totalTokens = manifestNumber(manifest.totalTokens);
  const totalToolCalls = manifestNumber(manifest.totalToolCalls);
  const model = manifestString(manifest.defaultModel);
  const timestamp = coerceTimestamp(manifest.startTime) ?? coerceTimestamp(manifest.timestamp);

  return {
    kind: "workflowBoard",
    wfId,
    workflowName: truncate(manifestString(manifest.workflowName) ?? wfId),
    ...(summary ? { summary: truncate(summary) } : {}),
    ...(status ? { status: truncate(status) } : {}),
    ...(agentCount !== undefined ? { agentCount } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(totalToolCalls !== undefined ? { totalToolCalls } : {}),
    ...(model ? { model } : {}),
    phases,
    agents,
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}

/**
 * Workflow GROUP detail (D2/D3): when the manifest carries per-agent
 * `workflowProgress`, surface a CLI-style `workflowBoard` (phases + per-agent
 * rows; agents drill into their `:wfagent:` transcript). Otherwise fall back to
 * listing the run's agents under `<parentId>/subagents/workflows/<wfId>/` as
 * title-only nested sessions labelled by their first prompt. Parent unknown → null;
 * in the fallback path a missing agents dir also → null.
 */
export async function readClaudeWorkflowDetail(
  parentId: string,
  wfId: string,
  sessionId: string,
  options: ClaudeReaderOptions,
  limit: number | undefined,
): Promise<VaultSessionDetail | null> {
  if (!isSafeSessionId(parentId) || !WORKFLOW_ID_RE.test(wfId)) {
    return null;
  }
  const parentPath = await resolveClaudeSessionPath(parentId, options);
  if (!parentPath) {
    return null;
  }
  const projectDir = path.dirname(parentPath);
  const { projectsDir } = claudeRoots(options);
  const agentsDir = path.join(projectDir, parentId, "subagents", "workflows", wfId);
  const agentsRel = path.relative(projectsDir, agentsDir);
  if (agentsRel.startsWith("..") || path.isAbsolute(agentsRel)) {
    return null;
  }
  // Manifest leads the group (best-effort; bounded + defensive, W5/D8).
  const manifest = await readManifestJson(path.join(projectDir, parentId, "workflows", `${wfId}.json`));
  const summary = manifest && typeof manifest.summary === "string" ? manifest.summary : undefined;
  let files: string[] | null;
  try {
    files = await fs.readdir(agentsDir);
  } catch {
    files = null;
  }
  const stems = workflowAgentStems(files ?? []);

  // Board path (D2): the manifest is authoritative, so a missing agents dir only
  // costs per-agent drill-down (no `entryId`) — the board still renders.
  if (manifest && hasWorkflowAgents(manifest.workflowProgress)) {
    const board = buildWorkflowBoardItem(manifest, parentId, wfId, new Set(stems));
    return finalizeDetail(
      formatEntryId("claude", sessionId),
      {
        ...(summary ? { firstPrompt: truncate(summary) } : {}),
        recentActivity: [],
        timeline: [board],
        stats: { messageCount: 0, toolCount: 0, subagentCount: board.agents.length },
      },
      { kind: "complete" },
    );
  }

  // Fallback (no usable workflowProgress): the first-prompt list. Here a missing
  // agents dir means the workflow id doesn't resolve.
  if (files === null) {
    return null;
  }
  const children: ClaudeChildStub[] = [];
  for (const stem of stems) {
    const first = await readFirstUserRecord(path.join(agentsDir, `${stem}.jsonl`));
    children.push({
      entryId: formatEntryId("claude", formatWorkflowAgentSessionId(parentId, wfId, stem)),
      description: first?.text ? boundedPreview(first.text) : stem,
      isGroup: true, // title-only: the first-prompt label, no agent chip
      ...(first?.text ? { firstMessage: first.text } : {}),
      ...(first?.timestamp ? { timestamp: first.timestamp } : {}),
    });
  }
  return synthesizeGroupDetail(formatEntryId("claude", sessionId), children, {
    firstPrompt: summary,
    subagentCount: children.length,
    limit,
  });
}

/** A workflow agent leaf (D3): its records are all `isSidechain` (the agent's own
 *  conversation), so classify with `includeSidechain`. */
export async function readClaudeWorkflowAgentDetail(
  parentId: string,
  wfId: string,
  stem: string,
  sessionId: string,
  options: ClaudeReaderOptions,
  limit: number | undefined,
): Promise<VaultSessionDetail | null> {
  const filePath = await resolveClaudeWorkflowAgentPath(parentId, wfId, stem, options);
  if (!filePath) {
    return null;
  }
  const read = await streamClaudeRecords(filePath);
  if (read === null) {
    return null;
  }
  const detail = classifyClaudeStyleEvents(read.records, { limit, includeSidechain: true });
  return finalizeDetail(formatEntryId("claude", sessionId), detail, sourceVerdict(read.truncated));
}

/**
 * Discover the parent session's `/workflow` runs (D3) for the parent timeline.
 * Manifests live at `<parentId>/workflows/wf_*.json`. A run with usable per-agent
 * `workflowProgress` is built EAGERLY into an INLINE `workflowBoard` item (one layer
 * — the board is itself collapsible in the webview, so no outer wrapper node). A run
 * without it keeps a lazy collapsible GROUP stub (first-prompt list). Both are placed
 * by manifest timestamp. Missing `workflows/` dir → empty.
 */
export async function listClaudeWorkflowNodes(
  parentId: string,
  options: ClaudeReaderOptions = {},
): Promise<{ boards: VaultTimelineItem[]; stubs: ClaudeChildStub[] }> {
  const empty = { boards: [] as VaultTimelineItem[], stubs: [] as ClaudeChildStub[] };
  if (!isSafeSessionId(parentId)) {
    return empty;
  }
  const parentPath = await resolveClaudeSessionPath(parentId, options);
  if (!parentPath) {
    return empty;
  }
  const projectDir = path.dirname(parentPath);
  const wfDir = path.join(projectDir, parentId, "workflows");
  const { projectsDir } = claudeRoots(options);
  const rel = path.relative(projectsDir, wfDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return empty;
  }
  let files: string[];
  try {
    files = await fs.readdir(wfDir);
  } catch {
    return empty; // no workflows dir → the common case
  }
  const boards: VaultTimelineItem[] = [];
  const stubs: ClaudeChildStub[] = [];
  for (const name of files) {
    if (!name.startsWith("wf_") || !name.endsWith(".json")) {
      continue;
    }
    const wfId = name.slice(0, -".json".length);
    if (!WORKFLOW_ID_RE.test(wfId)) {
      continue;
    }
    const manifest = await readManifestJson(path.join(wfDir, name));
    if (!manifest) {
      continue; // missing / oversized / malformed — skip, don't throw (W5/D8)
    }
    if (hasWorkflowAgents(manifest.workflowProgress)) {
      // Inline, self-collapsing board — no outer group layer. Cheap: manifest + one
      // readdir; per-agent transcripts stay lazy.
      const stemSet = await readWorkflowAgentStems(projectDir, parentId, wfId, projectsDir);
      const board = buildWorkflowBoardItem(manifest, parentId, wfId, stemSet);
      if (board.timestamp === undefined) {
        // No manifest time → anchor to the file mtime so the board threads near the
        // recent tail instead of sorting to 0 (where a >cap parent timeline would
        // tail-drop it, W3). Gated, so the common path pays no extra I/O.
        try {
          board.timestamp = (await fs.stat(path.join(wfDir, name))).mtimeMs;
        } catch {
          // mtime unavailable → leave undefined (degrades to prior behavior)
        }
      }
      boards.push(board);
    } else {
      const wfName = typeof manifest.workflowName === "string" ? manifest.workflowName : wfId;
      const status = typeof manifest.status === "string" ? manifest.status : "";
      const summary = typeof manifest.summary === "string" ? manifest.summary : undefined;
      const ts = coerceTimestamp(manifest.startTime) ?? coerceTimestamp(manifest.timestamp);
      const label = `Workflow: ${wfName}${status ? ` · ${status}` : ""}`;
      stubs.push({
        entryId: formatEntryId("claude", formatWorkflowSessionId(parentId, wfId)),
        description: label,
        isGroup: true,
        ...(summary ? { firstMessage: summary } : {}),
        ...(ts !== undefined ? { timestamp: ts } : {}),
      });
    }
  }
  stubs.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  return { boards, stubs };
}

/** Back-compat: the collapsible group stubs only (fallback runs without usable
 *  `workflowProgress`). Progress-bearing runs inline as self-collapsing boards; see
 *  {@link listClaudeWorkflowNodes}. */
export async function listClaudeWorkflowStubs(
  parentId: string,
  options: ClaudeReaderOptions = {},
): Promise<ClaudeChildStub[]> {
  return (await listClaudeWorkflowNodes(parentId, options)).stubs;
}

/**
 * Discover a parent session's subagents: `<projects>/<dir>/<parentId>/subagents/`
 * holds `<stem>.jsonl` transcripts + `<stem>.meta.json` (`{agentType, description}`).
 * Returns a lazy stub per subagent (entryId + meta + first prompt) — fail-safe to
 * `[]` (a missing dir / unreadable meta just yields no nesting).
 */
export async function listClaudeSubagentStubs(
  parentId: string,
  options: ClaudeReaderOptions,
): Promise<ClaudeChildStub[]> {
  if (!isSafeSessionId(parentId)) {
    return [];
  }
  const { projectsDir } = claudeRoots(options);
  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  for (const dir of projectDirs) {
    const subagentsDir = path.join(projectsDir, dir, parentId, "subagents");
    const rel = path.relative(projectsDir, subagentsDir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      continue;
    }
    let files: string[];
    try {
      files = await fs.readdir(subagentsDir);
    } catch {
      continue; // no subagents dir under this project — try the next
    }
    const stems = files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.slice(0, -".jsonl".length))
      .filter((stem) => isSafeSessionId(stem));
    // Read every sibling's meta + first record CONCURRENTLY: a session can hold many
    // subagents and this runs on each preview open (root read + every nested expand),
    // so a serial loop scaled O(N) wall-clock per open (review W2). Promise.all keeps
    // the stable directory order.
    const stubs: ClaudeChildStub[] = await Promise.all(
      stems.map(async (stem) => {
        const meta = await readSubagentMeta(path.join(subagentsDir, `${stem}.meta.json`));
        const first = await readFirstUserRecord(path.join(subagentsDir, `${stem}.jsonl`));
        return {
          entryId: formatEntryId("claude", `${parentId}${SUBAGENT_MARKER}${stem}`),
          agentType: meta?.agentType,
          description: meta?.description,
          ...(meta?.toolUseId ? { toolUseId: meta.toolUseId } : {}),
          firstMessage: first?.text,
          timestamp: first?.timestamp,
        };
      }),
    );
    return stubs;
  }
  return [];
}

/** Read a subagent's `{agentType, description, toolUseId}` meta sidecar (best-effort).
 *  `toolUseId` is the spawning `Agent`/`Task` call's id — the parent edge used to
 *  scope each transcript to its direct children (support-nested-subagent-preview D1). */
async function readSubagentMeta(
  metaPath: string,
): Promise<{ agentType?: string; description?: string; toolUseId?: string } | null> {
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") {
      return null;
    }
    return {
      agentType: typeof obj.agentType === "string" ? obj.agentType : undefined,
      description: typeof obj.description === "string" ? obj.description : undefined,
      toolUseId: typeof obj.toolUseId === "string" ? obj.toolUseId : undefined,
    };
  } catch {
    return null;
  }
}
