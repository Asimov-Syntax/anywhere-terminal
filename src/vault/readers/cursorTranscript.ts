import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { VaultActivityStep, VaultTimelineItem } from "../types";
import { type CursorPathFsDeps, isSafeCursorChatId } from "./cursorPaths";

const READ_CHUNK_BYTES = 256 * 1024;
const MAX_READ_BYTES = 32 * 1024 * 1024;
export const MAX_CURSOR_TRANSCRIPT_LINE_BYTES = 2 * 1024 * 1024;
const MAX_TIMELINE_ITEMS = 500;
const MAX_TEXT_CHARS = 256 * 1024;
const MAX_TOOL_DETAIL_CHARS = 2000;
const MAX_PROJECT_BUCKET_CHARS = 512;
const REASONING_LEAK_RE =
  /\n{2,}\*\*(?:Considering|Thinking|Planning|Inspecting|Exploring|Reviewing|Troubleshooting|Diagnosing|Evaluating|Running|Checking|Reading|Understanding|Analyzing|Debugging|Responding)\b[^*\n]{0,80}\*\*\n{2,}/;

export interface CursorTranscriptCandidate {
  transcriptId: string;
  projectBucket: string;
  filePath: string;
  layout: "nested" | "flat";
}

export interface CursorTranscriptFsDeps {
  stat(p: string): Promise<{ isFile(): boolean; size: number; mtimeMs: number }>;
  open(p: string, flags: string): Promise<FileHandle>;
}

export interface CursorTranscriptOptions {
  home?: string;
  projectsDir?: string;
  pathsFs?: CursorPathFsDeps;
  fs?: CursorTranscriptFsDeps;
  /** Optional byte offset for append-only incremental drains. */
  fromOffset?: number;
}

export type CursorTranscriptResult =
  | {
      status: "ok";
      timeline: VaultTimelineItem[];
      recentActivity: VaultActivityStep[];
      stats: { messageCount: number; toolCount: number; subagentCount: number };
      truncated: boolean;
      nextOffset: number;
      pendingTail: boolean;
    }
  | { status: "limited"; reason: string };

const REAL_PATH_FS: CursorPathFsDeps = {
  readdir: (p, options) => fs.readdir(p, options),
  stat: (p) => fs.stat(p),
};

const REAL_FS: CursorTranscriptFsDeps = {
  stat: (p) => fs.stat(p),
  open: (p, flags) => fs.open(p, flags),
};

export function cursorProjectsRoot(options: CursorTranscriptOptions = {}): string {
  if (options.projectsDir) {
    return options.projectsDir;
  }
  return path.join(options.home ?? os.homedir(), ".cursor", "projects");
}

function isSafeProjectBucket(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PROJECT_BUCKET_CHARS || value === "." || value === "..") {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "/" || character === "\\" || code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readdir(dir: string, deps: CursorPathFsDeps): Promise<Dirent[]> {
  try {
    return await deps.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function candidate(
  root: string,
  projectBucket: string,
  transcriptId: string,
  filePath: string,
  layout: "nested" | "flat",
): CursorTranscriptCandidate | undefined {
  if (!isSafeProjectBucket(projectBucket) || !isSafeCursorChatId(transcriptId) || !contained(root, filePath)) {
    return undefined;
  }
  return { projectBucket, transcriptId, filePath, layout };
}

export async function listCursorTranscriptCandidates(
  options: CursorTranscriptOptions = {},
): Promise<{ candidates: CursorTranscriptCandidate[]; ambiguousIds: ReadonlySet<string>; rejected: number }> {
  const root = cursorProjectsRoot(options);
  const deps = options.pathsFs ?? REAL_PATH_FS;
  const byId = new Map<string, CursorTranscriptCandidate[]>();
  let rejected = 0;

  for (const project of (await readdir(root, deps)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!project.isDirectory() || !isSafeProjectBucket(project.name)) {
      if (project.isDirectory()) {
        rejected++;
      }
      continue;
    }
    const transcriptsDir = path.join(root, project.name, "agent-transcripts");
    if (!contained(root, transcriptsDir)) {
      rejected++;
      continue;
    }
    for (const entry of (await readdir(transcriptsDir, deps)).sort((a, b) => a.name.localeCompare(b.name))) {
      let found: CursorTranscriptCandidate | undefined;
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const transcriptId = entry.name.slice(0, -".jsonl".length);
        found = candidate(root, project.name, transcriptId, path.join(transcriptsDir, entry.name), "flat");
      } else if (entry.isDirectory() && isSafeCursorChatId(entry.name)) {
        found = candidate(
          root,
          project.name,
          entry.name,
          path.join(transcriptsDir, entry.name, `${entry.name}.jsonl`),
          "nested",
        );
        if (found) {
          try {
            if (!(await deps.stat(found.filePath)).isDirectory()) {
              // `CursorPathFsDeps.stat` exposes only isDirectory; false means a file.
            } else {
              found = undefined;
            }
          } catch {
            found = undefined;
          }
        }
      } else if (entry.isDirectory() || entry.isFile()) {
        rejected++;
      }
      if (!found) {
        continue;
      }
      const group = byId.get(found.transcriptId);
      if (group) {
        group.push(found);
      } else {
        byId.set(found.transcriptId, [found]);
      }
    }
  }

  const candidates: CursorTranscriptCandidate[] = [];
  const ambiguousIds = new Set<string>();
  for (const [transcriptId, group] of byId) {
    if (group.length === 1) {
      candidates.push(group[0]);
    } else {
      ambiguousIds.add(transcriptId);
    }
  }
  return { candidates, ambiguousIds, rejected };
}

export function cursorProjectSessionId(candidate: CursorTranscriptCandidate): string {
  return `project:${Buffer.from(candidate.projectBucket, "utf8").toString("base64url")}:${candidate.transcriptId}`;
}

function decodeProjectBucket(value: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return isSafeProjectBucket(decoded) && Buffer.from(decoded, "utf8").toString("base64url") === value
      ? decoded
      : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveCursorProjectTranscriptSession(
  sessionId: string,
  options: CursorTranscriptOptions = {},
): Promise<CursorTranscriptCandidate | null> {
  const match = /^project:([A-Za-z0-9_-]+):([A-Za-z0-9._-]+)$/.exec(sessionId);
  if (!match || !isSafeCursorChatId(match[2])) {
    return null;
  }
  const projectBucket = decodeProjectBucket(match[1]);
  if (!projectBucket) {
    return null;
  }
  const root = cursorProjectsRoot(options);
  const transcriptsDir = path.join(root, projectBucket, "agent-transcripts");
  const candidates = [
    candidate(root, projectBucket, match[2], path.join(transcriptsDir, match[2], `${match[2]}.jsonl`), "nested"),
    candidate(root, projectBucket, match[2], path.join(transcriptsDir, `${match[2]}.jsonl`), "flat"),
  ].filter((item): item is CursorTranscriptCandidate => !!item);
  const deps = options.pathsFs ?? REAL_PATH_FS;
  const existing: CursorTranscriptCandidate[] = [];
  for (const item of candidates) {
    try {
      if (!(await deps.stat(item.filePath)).isDirectory()) {
        existing.push(item);
      }
    } catch {
      // Missing candidates are ignored; exactly one supported layout must exist.
    }
  }
  return existing.length === 1 ? existing[0] : null;
}

export async function resolveCursorTranscriptCandidate(
  transcriptId: string,
  options: CursorTranscriptOptions = {},
): Promise<CursorTranscriptCandidate | null> {
  if (!isSafeCursorChatId(transcriptId)) {
    return null;
  }
  const { candidates, ambiguousIds } = await listCursorTranscriptCandidates(options);
  if (ambiguousIds.has(transcriptId)) {
    return null;
  }
  return candidates.find((item) => item.transcriptId === transcriptId) ?? null;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function boundedText(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_TEXT_CHARS ? value : undefined;
}

function toolDetail(input: unknown): string | undefined {
  const record = asObject(input);
  if (!record) {
    return undefined;
  }
  for (const key of ["file_path", "path", "command", "query", "description"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value.slice(0, MAX_TOOL_DETAIL_CHARS);
    }
  }
  return undefined;
}

function toolResultText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.slice(0, MAX_TOOL_DETAIL_CHARS);
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const text: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      text.push(item);
    } else {
      const block = asObject(item);
      if (block && block.type === "text" && typeof block.text === "string") {
        text.push(block.text);
      }
    }
  }
  return text.join("\n").slice(0, MAX_TOOL_DETAIL_CHARS) || undefined;
}

function toolName(record: Record<string, unknown>): string {
  for (const key of ["name", "toolName", "tool_name"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 200) {
      return value;
    }
  }
  return "Tool result";
}

function normalizeLine(value: unknown): { timeline: VaultTimelineItem[]; activity: VaultActivityStep[] } {
  const envelope = asObject(value);
  if (!envelope || envelope.type === "turn_ended") {
    return { timeline: [], activity: [] };
  }
  const message = asObject(envelope.message);
  const record = message ? { ...envelope, ...message } : envelope;
  const role = record.role;
  if (role === "system" || role === "reasoning" || record.type === "thinking" || record.type === "reasoning") {
    return { timeline: [], activity: [] };
  }
  if (role === "tool" || role === "tool_result" || record.type === "tool_result") {
    const tool: VaultActivityStep = {
      kind: "tool",
      tool: toolName(record),
      ...(toolResultText(record.content ?? record.output ?? record.result)
        ? { detail: toolResultText(record.content ?? record.output ?? record.result) }
        : {}),
    };
    return { timeline: [tool], activity: [tool] };
  }
  if (role !== "user" && role !== "assistant") {
    return { timeline: [], activity: [] };
  }

  const texts: string[] = [];
  const activity: VaultActivityStep[] = [];
  const content = record.content;
  if (typeof content === "string") {
    const text = boundedText(content);
    if (text !== undefined) {
      texts.push(text);
    }
  } else if (Array.isArray(content)) {
    for (const item of content) {
      const block = asObject(item);
      if (!block) {
        continue;
      }
      if (block.type === "text" || block.type === "input_text" || block.type === "output_text") {
        const text = boundedText(block.text);
        if (text !== undefined) {
          texts.push(text);
        }
      } else if (block.type === "tool_use" || block.type === "tool_call" || block.type === "tool-call") {
        if (typeof block.name === "string" && block.name.length > 0 && block.name.length <= 200) {
          const detail = toolDetail(block.input ?? block.arguments);
          activity.push({ kind: "tool", tool: block.name, ...(detail ? { detail } : {}) });
        }
      } else if (block.type === "tool_result") {
        const detail = toolResultText(block.content ?? block.text ?? block.output);
        activity.push({ kind: "tool", tool: toolName(block), ...(detail ? { detail } : {}) });
      }
    }
  }

  let text = texts.join("\n");
  if (role === "assistant") {
    const marker = REASONING_LEAK_RE.exec(text);
    if (marker && marker.index > 0) {
      text = text.slice(0, marker.index).trimEnd();
    }
  }
  const timeline: VaultTimelineItem[] = [];
  if (text.length > 0) {
    timeline.push({ kind: "message", role, text });
  }
  timeline.push(...activity);
  return { timeline, activity };
}

async function readWindow(
  filePath: string,
  start: number,
  length: number,
  deps: CursorTranscriptFsDeps,
): Promise<Buffer | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await deps.open(filePath, "r");
    const output = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const chunkLength = Math.min(READ_CHUNK_BYTES, length - offset);
      const { bytesRead } = await handle.read(output, offset, chunkLength, start + offset);
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    return output.subarray(0, offset);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function readCursorTranscript(
  candidate: CursorTranscriptCandidate,
  options: CursorTranscriptOptions = {},
): Promise<CursorTranscriptResult> {
  const root = cursorProjectsRoot(options);
  const expectedPath =
    candidate.layout === "nested"
      ? path.join(
          root,
          candidate.projectBucket,
          "agent-transcripts",
          candidate.transcriptId,
          `${candidate.transcriptId}.jsonl`,
        )
      : path.join(root, candidate.projectBucket, "agent-transcripts", `${candidate.transcriptId}.jsonl`);
  if (
    !isSafeProjectBucket(candidate.projectBucket) ||
    !isSafeCursorChatId(candidate.transcriptId) ||
    path.resolve(candidate.filePath) !== path.resolve(expectedPath) ||
    !contained(root, candidate.filePath)
  ) {
    return { status: "limited", reason: "Cursor project transcript is unavailable." };
  }
  const deps = options.fs ?? REAL_FS;
  let stat: Awaited<ReturnType<CursorTranscriptFsDeps["stat"]>>;
  try {
    stat = await deps.stat(candidate.filePath);
  } catch {
    return { status: "limited", reason: "Cursor project transcript is unavailable." };
  }
  if (!stat.isFile()) {
    return { status: "limited", reason: "Cursor project transcript is unavailable." };
  }

  const requestedOffset =
    typeof options.fromOffset === "number" && Number.isSafeInteger(options.fromOffset) && options.fromOffset >= 0
      ? options.fromOffset
      : undefined;
  if (requestedOffset !== undefined && requestedOffset >= stat.size) {
    return {
      status: "ok",
      timeline: [],
      recentActivity: [],
      stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
      truncated: false,
      nextOffset: requestedOffset,
      pendingTail: false,
    };
  }
  const start = requestedOffset ?? Math.max(0, stat.size - MAX_READ_BYTES);
  const readLength = Math.min(stat.size - start, MAX_READ_BYTES);
  const buffer = await readWindow(candidate.filePath, start, readLength, deps);
  if (!buffer) {
    return { status: "limited", reason: "Cursor project transcript is unavailable." };
  }

  let localStart = 0;
  let truncated = requestedOffset === undefined && start > 0;
  if (requestedOffset === undefined && start > 0) {
    const firstNewline = buffer.indexOf(0x0a);
    if (firstNewline < 0) {
      return { status: "limited", reason: "Cursor project transcript record exceeds the read bound." };
    }
    localStart = firstNewline + 1;
  }

  const timeline: VaultTimelineItem[] = [];
  const activity: VaultActivityStep[] = [];
  let messageCount = 0;
  let toolCount = 0;
  let pendingTail = false;
  while (localStart < buffer.length) {
    const newline = buffer.indexOf(0x0a, localStart);
    const end = newline >= 0 ? newline : buffer.length;
    const line = buffer.subarray(localStart, end);
    const next = newline >= 0 ? end + 1 : end;
    const completeAtEof = newline < 0;
    if (line.length > MAX_CURSOR_TRANSCRIPT_LINE_BYTES) {
      truncated = true;
    } else if (line.length > 0) {
      try {
        const parsed = JSON.parse(line.toString("utf8"));
        const normalized = normalizeLine(parsed);
        for (const item of normalized.timeline) {
          timeline.push(item);
          if (item.kind === "message") {
            messageCount++;
          }
          if (item.kind === "tool") {
            toolCount++;
          }
        }
        activity.push(...normalized.activity);
      } catch {
        if (completeAtEof) {
          pendingTail = true;
        }
      }
    }
    localStart = next;
    if (completeAtEof) {
      break;
    }
  }

  if (timeline.length > MAX_TIMELINE_ITEMS) {
    timeline.splice(0, timeline.length - MAX_TIMELINE_ITEMS);
    truncated = true;
  }
  const windowEnd = start + buffer.length;
  const lastNewline = buffer.lastIndexOf(0x0a);
  const pendingBytes = lastNewline < 0 ? buffer.length : buffer.length - lastNewline - 1;
  return {
    status: "ok",
    timeline,
    recentActivity: activity.slice(-12),
    stats: { messageCount, toolCount, subagentCount: 0 },
    truncated,
    nextOffset: pendingTail ? windowEnd - pendingBytes : windowEnd,
    pendingTail,
  };
}
