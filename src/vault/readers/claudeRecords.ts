// src/vault/readers/claudeRecords.ts — Bounded, defensive JSONL streaming +
// record-text extraction for the Claude reader (claudeReader split).
//
// Every loop skips a single corrupt line and keeps reading (D8); `streamClaudeRecords`
// is head+tail bounded so a tens-of-MB transcript never fully materializes (W1).

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as readline from "node:readline";
import { createBoundedRecordBuffer } from "./detail";
import { classifyUserRecord } from "./userRecord";

/** Cap on a workflow manifest read (review W5): manifests are normally tens-to-
 *  hundreds of KB; skip anything larger rather than materialize + parse it. */
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

/** Read + parse a workflow manifest, bounded by {@link MAX_MANIFEST_BYTES} and
 *  defensive (missing / oversized / malformed → null, never throws — D8). */
export async function readManifestJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) {
      return null;
    }
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Coerce a record timestamp (ISO string, or epoch ms as number/string) to epoch
 *  ms, or undefined. Workflow manifests store `startTime` as a numeric string and
 *  records store ISO `timestamp`s — both must become finite numbers for the
 *  timeline merge to order them (D3). */
export function coerceTimestamp(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) {
      return asNum; // epoch-ms string, e.g. "1780072409110"
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms; // ISO string
  }
  return undefined;
}

/** RAW user text (string content or joined text blocks), WITHOUT the
 *  command-wrapper stripping `extractUserText` applies — so a
 *  `<teammate-message …>` tag survives intact for boundary detection. */
export function rawUserText(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((b): b is { type?: string; text?: string } => typeof b === "object" && b !== null)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join(" ");
    return text || undefined;
  }
  return undefined;
}

/** The human-typed prompt in a user RECORD, or undefined when the record is
 *  anything else (plumbing, a task notification, an injected banner, a compaction
 *  summary). Titles and `firstPrompt` come through here, so they classify exactly
 *  as the timeline does — which needs the record's flags, not just its message. */
export function extractUserText(rec: unknown): string | undefined {
  if (!rec || typeof rec !== "object") {
    return undefined;
  }
  const cls = classifyUserRecord(rec as Record<string, unknown>);
  return cls.kind === "prompt" ? cls.text : undefined;
}

/** Bytes read from the file tail when hunting for the late-written fields below.
 *  256 KB rather than 64 KB: measured over 120 local transcripts, 64 KB reaches
 *  the last `permissionMode` in 90 of the 109 that record one and 256 KB in 104,
 *  for ~192 KB more on a read the list scan already performs per CHANGED file. */
const TAIL_SCAN_BYTES = 256 * 1024;

/** The late-written fields Claude re-appends as a session evolves. */
export interface ClaudeTailFields {
  /** `{type:"custom-title"}` — the name the user gave the session in Claude. */
  customTitle?: string;
  /** `{type:"ai-title"}` — the title Claude generated for the session. */
  aiTitle?: string;
  /** `{type:"last-prompt"}` — Claude's display fallback before the first prompt. */
  lastPrompt?: string;
  /** The session's permission mode as of this point in the transcript. */
  permissionMode?: string;
}

/** Read one trailer field, mirroring Claude: last record wins, empty clears. */
function applyTailField(out: ClaudeTailFields, obj: Record<string, unknown>): void {
  const assign = (key: keyof ClaudeTailFields, value: unknown): void => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    out[key] = trimmed || undefined;
  };
  // Permission mode is session STATE, re-recorded on every change. It rides BOTH a
  // dedicated `{type:"permission-mode"}` record and ordinary records' top-level
  // field, so it is read off any record rather than one record type (D1).
  assign("permissionMode", obj.permissionMode);
  switch (obj.type) {
    case "custom-title":
      assign("customTitle", obj.customTitle);
      break;
    case "ai-title":
      assign("aiTitle", obj.aiTitle);
      break;
    case "last-prompt":
      assign("lastPrompt", obj.lastPrompt);
      break;
  }
}

/**
 * Claude re-appends its whole title trailer (`custom-title`, `ai-title`,
 * `last-prompt`, …) near the end of the session as it evolves, and re-records
 * `permissionMode` wherever the mode changes — the LATEST record of each wins,
 * and a title carrying an empty string CLEARS that field. Those records sit
 * scattered to EOF (a 86MB file is common), so the forward metadata scan never
 * reaches them. Read only the last `TAIL_SCAN_BYTES` — bounded regardless of
 * file size.
 */
export async function readLatestTailFields(filePath: string): Promise<ClaudeTailFields> {
  const out: ClaudeTailFields = {};
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const { size } = await handle.stat();
    if (size === 0) {
      return out;
    }
    const start = Math.max(0, size - TAIL_SCAN_BYTES);
    const length = size - start;
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) {
      lines.shift(); // first line is likely truncated mid-record — drop it
    }
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === "object") {
          applyTailField(out, obj as Record<string, unknown>);
        }
      } catch {
        // skip a partial/corrupt line, keep scanning (D8)
      }
    }
    return out;
  } catch {
    return out; // unreadable tail → fall back to the head scan's title + mode
  } finally {
    await handle?.close();
  }
}

/**
 * Read parseable records from a session jsonl (skip-malformed, D8), bounded to a
 * head + tail window so a tens-of-MB transcript never fully materializes (W1).
 * Returns `truncated` when the middle was dropped.
 */
export async function streamClaudeRecords(
  filePath: string,
  opts: { onRecord?: (rec: Record<string, unknown>) => void } = {},
): Promise<{ records: Record<string, unknown>[]; truncated: boolean } | null> {
  const buffer = createBoundedRecordBuffer();
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          const rec = parsed as Record<string, unknown>;
          // Fire BEFORE buffering so a side-collector (e.g. teamName gathering,
          // D4) sees every record even when the head+tail bound later drops the
          // middle of a very large transcript (W1).
          opts.onRecord?.(rec);
          buffer.push(rec);
        }
      } catch {
        // skip a single corrupt line, keep reading (D8)
      }
    }
  } catch {
    return null; // stream/open failure → unreadable
  } finally {
    rl?.close();
    stream?.destroy();
  }
  return buffer.result();
}

/** Cheaply read a transcript's first user message text + timestamp (head only). */
export async function readFirstUserRecord(filePath: string): Promise<{ text: string; timestamp: number } | null> {
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (obj.type !== "user") {
        continue;
      }
      const text = extractUserText(obj);
      if (text) {
        const t = obj.timestamp;
        const ts = typeof t === "string" ? Date.parse(t) : typeof t === "number" ? t : Number.NaN;
        return { text, timestamp: Number.isNaN(ts) ? 0 : ts };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    rl?.close();
    stream?.destroy();
  }
}
