import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { provesAbsence } from "../../utils/fsPresence";
import type { VaultActivityStep, VaultTimelineItem } from "../types";
import {
  type CursorNormalizedRecord,
  collectCursorAgentTypes,
  countCursorAgents,
  emptyCursorRecord,
  isCursorContinuationStep,
  mergeCursorSubagentInvocations,
  normalizeCursorRecord,
} from "./cursorNormalization";
import { type CursorPathFsDeps, isSafeCursorChatId } from "./cursorPaths";

const READ_CHUNK_BYTES = 256 * 1024;
const MAX_READ_BYTES = 32 * 1024 * 1024;
export const MAX_CURSOR_TRANSCRIPT_LINE_BYTES = 2 * 1024 * 1024;
const MAX_CURSOR_TRANSCRIPT_TIMELINE_ITEMS = 500;
const MAX_PROJECT_BUCKET_CHARS = 512;
export const MAX_CURSOR_PROJECT_BUCKETS = 1024;
export const MAX_CURSOR_PROJECT_CANDIDATES = 4096;
const MAX_CURSOR_PROJECT_PATH_CHECKS = 4096;
const MAX_CURSOR_PROJECT_PATH_DEPTH = 32;

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
  lstat: (p) => fs.lstat(p),
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

/** Cursor's project directory encoding: absolute separators and drive colon become hyphens. */
export function cursorProjectBucketForCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/^\/+/, "").replace(/:/g, "-").replace(/\//g, "-");
}

async function isRealDirectory(candidatePath: string, deps: CursorPathFsDeps): Promise<boolean> {
  try {
    if (deps.lstat) {
      const stat = await deps.lstat(candidatePath);
      return stat.isDirectory() && !stat.isSymbolicLink();
    }
    return (await deps.stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

/** Decode one project bucket only when exactly one real, non-symlinked cwd matches. */
export async function resolveCursorProjectCwd(
  projectBucket: string,
  options: CursorTranscriptOptions = {},
): Promise<string | null> {
  if (!isSafeProjectBucket(projectBucket)) {
    return null;
  }
  const deps = options.pathsFs ?? REAL_PATH_FS;
  let basePath = path.parse(path.resolve("/")).root;
  let remaining = projectBucket;
  if (process.platform === "win32") {
    const drive = /^([A-Za-z])--(.+)$/.exec(projectBucket);
    if (!drive) {
      return null;
    }
    basePath = `${drive[1].toUpperCase()}:\\`;
    remaining = drive[2];
  }

  const matches = new Set<string>();
  const visited = new Set<string>();
  let checks = 0;
  const walk = async (base: string, encoded: string, depth: number): Promise<void> => {
    if (matches.size > 1 || depth > MAX_CURSOR_PROJECT_PATH_DEPTH || checks >= MAX_CURSOR_PROJECT_PATH_CHECKS) {
      return;
    }
    const stateKey = `${base}\0${encoded}`;
    if (visited.has(stateKey)) {
      return;
    }
    visited.add(stateKey);

    checks++;
    const leaf = path.join(base, encoded);
    if (await isRealDirectory(leaf, deps)) {
      matches.add(path.resolve(leaf));
      if (matches.size > 1) {
        return;
      }
    }

    for (let index = encoded.indexOf("-"); index >= 0; index = encoded.indexOf("-", index + 1)) {
      if (index === 0 || index === encoded.length - 1 || checks >= MAX_CURSOR_PROJECT_PATH_CHECKS) {
        continue;
      }
      const segment = encoded.slice(0, index);
      const nextBase = path.join(base, segment);
      checks++;
      if (!(await isRealDirectory(nextBase, deps))) {
        continue;
      }
      await walk(nextBase, encoded.slice(index + 1), depth + 1);
      if (matches.size > 1) {
        return;
      }
    }
  };

  await walk(basePath, remaining, 0);
  return matches.size === 1 ? [...matches][0] : null;
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

export async function listCursorTranscriptCandidates(options: CursorTranscriptOptions = {}): Promise<{
  candidates: CursorTranscriptCandidate[];
  ambiguousIds: ReadonlySet<string>;
  rejected: number;
  overflowed: boolean;
}> {
  const root = cursorProjectsRoot(options);
  const deps = options.pathsFs ?? REAL_PATH_FS;
  const projects = (await readdir(root, deps)).sort((a, b) => a.name.localeCompare(b.name));
  if (projects.length > MAX_CURSOR_PROJECT_BUCKETS) {
    return { candidates: [], ambiguousIds: new Set(), rejected: 0, overflowed: true };
  }

  const bySource = new Map<string, CursorTranscriptCandidate[]>();
  let rejected = 0;
  let candidateCount = 0;
  for (const project of projects) {
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
    const entries = (await readdir(transcriptsDir, deps)).sort((a, b) => a.name.localeCompare(b.name));
    if (candidateCount + entries.length > MAX_CURSOR_PROJECT_CANDIDATES) {
      return { candidates: [], ambiguousIds: new Set(), rejected, overflowed: true };
    }
    for (const entry of entries) {
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
            if ((await deps.stat(found.filePath)).isDirectory()) {
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
      candidateCount++;
      const sourceKey = `${found.projectBucket}\0${found.transcriptId}`;
      const group = bySource.get(sourceKey);
      if (group) {
        group.push(found);
      } else {
        bySource.set(sourceKey, [found]);
      }
    }
  }

  const candidates: CursorTranscriptCandidate[] = [];
  const byId = new Map<string, number>();
  for (const group of bySource.values()) {
    if (group.length !== 1) {
      rejected += group.length;
      continue;
    }
    candidates.push(group[0]);
    byId.set(group[0].transcriptId, (byId.get(group[0].transcriptId) ?? 0) + 1);
  }
  const ambiguousIds = new Set([...byId].filter(([, count]) => count > 1).map(([transcriptId]) => transcriptId));
  return { candidates, ambiguousIds, rejected, overflowed: false };
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

export type CursorTranscriptLookup =
  | { status: "found"; candidate: CursorTranscriptCandidate }
  | { status: "absent" }
  | { status: "unknown" };

/**
 * Locate one project transcript, saying WHY it found nothing. Exactly one of the
 * two supported layouts must exist; a stat that failed for a reason other than
 * absence leaves that unknowable (D4).
 */
export async function lookupCursorProjectTranscriptSession(
  sessionId: string,
  options: CursorTranscriptOptions = {},
): Promise<CursorTranscriptLookup> {
  const match = /^project:([A-Za-z0-9_-]+):([A-Za-z0-9._-]+)$/.exec(sessionId);
  if (!match || !isSafeCursorChatId(match[2])) {
    return { status: "absent" };
  }
  const projectBucket = decodeProjectBucket(match[1]);
  if (!projectBucket) {
    return { status: "absent" };
  }
  const root = cursorProjectsRoot(options);
  const transcriptsDir = path.join(root, projectBucket, "agent-transcripts");
  const candidates = [
    candidate(root, projectBucket, match[2], path.join(transcriptsDir, match[2], `${match[2]}.jsonl`), "nested"),
    candidate(root, projectBucket, match[2], path.join(transcriptsDir, `${match[2]}.jsonl`), "flat"),
  ].filter((item): item is CursorTranscriptCandidate => !!item);
  const deps = options.pathsFs ?? REAL_PATH_FS;
  const existing: CursorTranscriptCandidate[] = [];
  let complete = true;
  for (const item of candidates) {
    try {
      if (!(await deps.stat(item.filePath)).isDirectory()) {
        existing.push(item);
      }
    } catch (err) {
      // A missing candidate is a real answer; any other failure is not.
      complete = complete && provesAbsence(err);
    }
  }
  // Two layouts present is a store this reader refuses to guess about, not a
  // session that is gone.
  if (existing.length > 1) {
    return { status: "unknown" };
  }
  // "Exactly one layout exists" is what returning a candidate asserts, so a stat
  // that failed for a reason other than absence unsettles the found answer as
  // much as the absent one (round-1 B2).
  if (!complete) {
    return { status: "unknown" };
  }
  return existing.length === 1 ? { status: "found", candidate: existing[0] } : { status: "absent" };
}

/** The candidate-or-nothing view, for callers that cannot act on the difference. */
export async function resolveCursorProjectTranscriptSession(
  sessionId: string,
  options: CursorTranscriptOptions = {},
): Promise<CursorTranscriptCandidate | null> {
  const found = await lookupCursorProjectTranscriptSession(sessionId, options);
  return found.status === "found" ? found.candidate : null;
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

/** The JSONL mirror shares the CLI store's classifier, so the same chat reads the
 *  same way whichever source served it (D11/D12). */
function normalizeLine(value: unknown): CursorNormalizedRecord {
  return normalizeCursorRecord(value) ?? emptyCursorRecord();
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
        timeline.push(...normalized.timeline);
        activity.push(...normalized.activity);
        messageCount += normalized.messageCount;
        toolCount += normalized.toolCount;
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

  if (timeline.length > MAX_CURSOR_TRANSCRIPT_TIMELINE_ITEMS) {
    timeline.splice(0, timeline.length - MAX_CURSOR_TRANSCRIPT_TIMELINE_ITEMS);
    truncated = true;
  }
  const windowEnd = start + buffer.length;
  const lastNewline = buffer.lastIndexOf(0x0a);
  const pendingBytes = lastNewline < 0 ? buffer.length : buffer.length - lastNewline - 1;
  // The mirror reuses the normalizer without the store's correlation maps, so it
  // applies the same one-agent-many-invocations pass itself (D1). `activity` is
  // uncapped, so it still holds a launch the MAX_CURSOR_TRANSCRIPT_TIMELINE_ITEMS splice above cut
  // out of `timeline` — resolve declared types across both before merging either.
  const declaredTypes = collectCursorAgentTypes(activity, timeline);
  const mergedActivity = mergeCursorSubagentInvocations(activity, declaredTypes);
  return {
    status: "ok",
    timeline: mergeCursorSubagentInvocations(timeline, declaredTypes),
    // Filter before the cap: capping first lets a tail of 12+ resumes leave the
    // strip empty once the reader drops continuations (review W1).
    recentActivity: mergedActivity.filter((step) => !isCursorContinuationStep(step)).slice(-12),
    stats: {
      messageCount,
      toolCount,
      subagentCount: countCursorAgents(mergedActivity),
    },
    truncated,
    nextOffset: pendingTail ? windowEnd - pendingBytes : windowEnd,
    pendingTail,
  };
}
