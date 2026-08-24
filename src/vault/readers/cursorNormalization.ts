// src/vault/readers/cursorNormalization.ts — What a Cursor Agent record means.
//
// The canonical CLI store (SQLite blobs) and the project JSONL mirror carry the
// same conversation in two dialects (`tool-call`/`tool-result` vs
// `tool_use`/`tool_result`). One Cursor-specific classifier keeps both previews
// consistent (integrate-cursor-agent D11/D12): recognized transport wrappers are
// stripped, injected records become notices or are dropped, and activity records
// tool calls and subagent invocations only — never a standalone tool result
// (src/vault/types.ts).
//
// Bounded and local: no raw blob, argument, or result value is logged or cached,
// and every emitted string is capped.

import type { VaultActivityStep, VaultTimelineItem } from "../types";

const MAX_RECORD_TEXT_CHARS = 256 * 1024;
const MAX_TOOL_DETAIL_CHARS = 2000;
const MAX_SUBAGENT_RESULT_CHARS = 64 * 1024;
const MAX_CORRELATION_ID_CHARS = 1000;
const MAX_TASK_ID_CHARS = 200;
const MAX_TOOL_NAME_CHARS = 200;
const MAX_NOTICE_SUMMARY_CHARS = 200;
const MAX_NOTICE_BODY_CHARS = 2000;
const MAX_NOTICE_SCAN_CHARS = 8 * 1024;
const NOTIFICATION_PREFIX = "The ";
const NOTIFICATION_MARKERS = ["task_id", "has completed", "notification", "result", "do not"] as const;
const SUBAGENT_TOOL_NAMES = new Set(["task", "agent"]);
const TOOL_DETAIL_KEYS = ["file_path", "path", "command", "query", "description"];
const SUBAGENT_PROMPT_KEYS = ["prompt", "task"];
const REASONING_LEAK_RE =
  /\n{2,}\*\*(?:Considering|Thinking|Planning|Inspecting|Exploring|Reviewing|Troubleshooting|Diagnosing|Evaluating|Running|Checking|Reading|Understanding|Analyzing|Debugging|Responding)\b[^*\n]{0,80}\*\*\n{2,}/;

export type CursorSubagentStep = Extract<VaultActivityStep, { kind: "subagent" }> & {
  /** Private, unqualified child id; the combined reader must source-qualify or remove it before IPC. */
  childAgentId?: string;
};

export interface CursorSubagentCall {
  callId?: string;
  step: CursorSubagentStep;
}

export interface CursorToolResult {
  callId: string;
  result: string;
  taskId?: string;
  childAgentId?: string;
}

export interface CursorNoticeCorrelation {
  taskId: string;
  result?: string;
  childAgentId?: string;
}

export interface CursorNormalizedRecord {
  timeline: VaultTimelineItem[];
  activity: VaultActivityStep[];
  subagentCalls: CursorSubagentCall[];
  toolResults: CursorToolResult[];
  notice?: CursorNoticeCorrelation;
  /** Characters this record contributed, for the caller's total-output bound. */
  textChars: number;
  /** Visible human/assistant turns only — notices never count. */
  messageCount: number;
  /** Non-subagent tool CALLS only. */
  toolCount: number;
  subagentCount: number;
}

export type CursorUserText =
  | { kind: "prompt"; text: string }
  | { kind: "notice"; summary: string; body?: string; taskId?: string; result?: string; childAgentId?: string }
  | { kind: "drop" };

const EMPTY: CursorNormalizedRecord = {
  timeline: [],
  activity: [],
  subagentCalls: [],
  toolResults: [],
  textChars: 0,
  messageCount: 0,
  toolCount: 0,
  subagentCount: 0,
};

export function emptyCursorRecord(): CursorNormalizedRecord {
  return { ...EMPTY, timeline: [], activity: [], subagentCalls: [], toolResults: [] };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** First `<name>…</name>` body, by indexOf scan (no regex over untrusted text). */
function readTag(text: string, name: string): string | undefined {
  const open = `<${name}>`;
  const start = text.indexOf(open);
  if (start < 0) {
    return undefined;
  }
  const from = start + open.length;
  const end = text.indexOf(`</${name}>`, from);
  return end < 0 ? undefined : text.slice(from, end);
}

/**
 * A background-completion envelope Cursor injects in the user role, matched
 * against the FULL observed template signature: the injected opening phrase plus
 * every marker of the template (the task id, the completion report, the
 * self-description as a notification, its result section, and its
 * "do not respond" instruction).
 *
 * The conjunction is deliberately strict and conservative. A human discussing
 * task ids, notifications, or completed work hits one or two of these markers,
 * never all of them in one bounded prompt, so their turn stays a prompt.
 */
function isBackgroundNotification(text: string): boolean {
  if (!text.startsWith(NOTIFICATION_PREFIX)) {
    return false;
  }
  const scanned = text.slice(0, MAX_NOTICE_SCAN_CHARS).toLowerCase();
  return NOTIFICATION_MARKERS.every((marker) => scanned.includes(marker));
}

function taskIdFromText(text: string): string | undefined {
  const match = /\btask_id\s*[:=]\s*([A-Za-z0-9._-]{1,200})/i.exec(text.slice(0, MAX_NOTICE_SCAN_CHARS));
  return match?.[1].slice(0, MAX_TASK_ID_CHARS);
}

function childAgentIdFromText(text: string): string | undefined {
  const match = /(?:^|\n)Agent ID:\s*([A-Za-z0-9._-]{1,200})(?=\s*(?:\(|$))/i.exec(
    text.slice(0, MAX_SUBAGENT_RESULT_CHARS),
  );
  const id = match?.[1];
  return id && !id.includes("..") ? id : undefined;
}

function noticeResult(text: string): string | undefined {
  const match = /(?:^|\n)Result:\s*([\s\S]*)$/i.exec(text);
  const result = match?.[1].trim();
  return result ? result.slice(0, MAX_SUBAGENT_RESULT_CHARS) : undefined;
}

function asNotice(text: string): CursorUserText {
  const lines = text.split("\n");
  const summaryIndex = lines.findIndex((line) => line.trim().length > 0);
  const summary = summaryIndex < 0 ? "" : lines[summaryIndex].trim().slice(0, MAX_NOTICE_SUMMARY_CHARS);
  if (!summary) {
    return { kind: "drop" };
  }
  const body = lines
    .slice(summaryIndex + 1)
    .join("\n")
    .trim()
    .slice(0, MAX_NOTICE_BODY_CHARS);
  const taskId = taskIdFromText(text);
  const result = noticeResult(text);
  const childAgentId = result ? childAgentIdFromText(result) : undefined;
  return {
    kind: "notice",
    summary,
    ...(body ? { body } : {}),
    ...(taskId ? { taskId } : {}),
    ...(result ? { result } : {}),
    ...(childAgentId ? { childAgentId } : {}),
  };
}

/**
 * Classify one user-role text. Cursor wraps a real prompt in `<timestamp>` plus
 * `<user_query>` and only the query is visible; a bootstrap record carries
 * `<user_info>` with no query and was never typed. Unrecognized markup is kept
 * verbatim — stripping only the wrappers we can name avoids eating real content.
 */
export function classifyCursorUserText(raw: string): CursorUserText {
  const query = readTag(raw, "user_query");
  if (query === undefined) {
    if (raw.includes("<user_info>")) {
      return { kind: "drop" };
    }
    const text = raw.trim();
    return text ? { kind: "prompt", text } : { kind: "drop" };
  }
  const text = query.trim();
  if (!text) {
    return { kind: "drop" };
  }
  return isBackgroundNotification(text) ? asNotice(text) : { kind: "prompt", text };
}

function boundedName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOOL_NAME_CHARS ? value : undefined;
}

function toolName(record: Record<string, unknown>): string | undefined {
  for (const key of ["name", "toolName", "tool_name"]) {
    const found = boundedName(record[key]);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function pickString(args: unknown, keys: readonly string[]): string | undefined {
  const record = asObject(args);
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value.slice(0, MAX_TOOL_DETAIL_CHARS);
    }
  }
  return undefined;
}

function correlationId(record: Record<string, unknown>): string | undefined {
  for (const key of ["toolCallId", "tool_call_id", "toolUseId", "tool_use_id", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value.length <= MAX_CORRELATION_ID_CHARS) {
      return value;
    }
  }
  return undefined;
}

/** One `tool-call`/`tool_use` block → a tool or subagent step plus private
 * correlation metadata. The correlation id never leaves the normalized detail. */
function toolCallStep(
  name: string,
  args: unknown,
  block: Record<string, unknown>,
): { step: VaultActivityStep; subagentCall?: CursorSubagentCall } {
  if (SUBAGENT_TOOL_NAMES.has(name.toLowerCase())) {
    const input = asObject(args);
    const subagentType = boundedName(input?.subagent_type);
    const title = pickString(args, ["description"]);
    const prompt = pickString(args, SUBAGENT_PROMPT_KEYS);
    const step: CursorSubagentStep = {
      kind: "subagent",
      name: subagentType ?? name,
      ...(title ? { title } : {}),
      ...(prompt ? { prompt } : {}),
      ...(typeof input?.run_in_background === "boolean" ? { background: input.run_in_background } : {}),
    };
    const callId = correlationId(block);
    return { step, subagentCall: { ...(callId ? { callId } : {}), step } };
  }
  const detail = pickString(args, TOOL_DETAIL_KEYS);
  return { step: { kind: "tool", tool: name, ...(detail ? { detail } : {}) } };
}

function isToolCallBlock(type: unknown): boolean {
  return type === "tool_use" || type === "tool_call" || type === "tool-call";
}

function isToolResultBlock(type: unknown): boolean {
  return type === "tool_result" || type === "tool-result";
}

function isTextBlock(type: unknown): boolean {
  return type === "text" || type === "input_text" || type === "output_text";
}

function isDropped(record: Record<string, unknown>): boolean {
  return (
    record.isSummary === true ||
    record.isGenerated === true ||
    record.generated === true ||
    record.type === "summary" ||
    record.type === "reasoning" ||
    record.type === "thinking" ||
    record.type === "turn_ended" ||
    record.role === "system" ||
    record.role === "reasoning"
  );
}

/** A record that only reports a tool's OUTPUT. Its call was already recorded, so
 *  emitting it again would double-count activity (src/vault/types.ts). */
function isStandaloneToolResult(record: Record<string, unknown>): boolean {
  return record.role === "tool" || record.role === "tool_result" || isToolResultBlock(record.type);
}

function boundedResult(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.slice(0, MAX_SUBAGENT_RESULT_CHARS);
  }
  const object = asObject(value);
  if (!object) {
    return undefined;
  }
  for (const key of ["result", "output", "content", "text"]) {
    const nested = object[key];
    if (typeof nested === "string") {
      return nested.slice(0, MAX_SUBAGENT_RESULT_CHARS);
    }
  }
  return undefined;
}

function toolResultFromBlock(block: Record<string, unknown>): CursorToolResult | undefined {
  const name = toolName(block);
  if (!name || !SUBAGENT_TOOL_NAMES.has(name.toLowerCase())) {
    return undefined;
  }
  const callId = correlationId(block);
  const result = boundedResult(block.result ?? block.output ?? block.content ?? block.text);
  if (!callId || result === undefined) {
    return undefined;
  }
  const taskId = taskIdFromText(result);
  const childAgentId = childAgentIdFromText(result);
  return {
    callId,
    result,
    ...(taskId ? { taskId } : {}),
    ...(childAgentId ? { childAgentId } : {}),
  };
}

function standaloneToolResults(record: Record<string, unknown>): CursorToolResult[] {
  if (isToolResultBlock(record.type)) {
    const result = toolResultFromBlock(record);
    return result ? [result] : [];
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map(asObject)
      .filter((block): block is Record<string, unknown> => !!block && isToolResultBlock(block.type))
      .map(toolResultFromBlock)
      .filter((result): result is CursorToolResult => !!result);
  }
  return [];
}

function timestampOf(record: Record<string, unknown>): number | undefined {
  for (const key of ["timestampMs", "timestamp_ms", "createdAtMs", "created_at_ms"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

function stepChars(step: VaultActivityStep): number {
  return step.kind === "tool"
    ? (step.detail?.length ?? 0)
    : (step.title?.length ?? 0) + (step.prompt?.length ?? 0) + (step.result?.length ?? 0);
}

/**
 * Normalize one parsed Cursor record from either dialect.
 *
 * Returns `undefined` when the record carries text beyond the per-record bound:
 * the store treats that as schema drift and fails closed, the JSONL mirror skips
 * the line.
 */
export function normalizeCursorRecord(value: unknown): CursorNormalizedRecord | undefined {
  const envelope = asObject(value);
  if (!envelope) {
    return undefined;
  }
  const message = asObject(envelope.message);
  const record = message ? { ...envelope, ...message } : envelope;
  if (isDropped(envelope) || isDropped(record)) {
    return emptyCursorRecord();
  }
  if (isStandaloneToolResult(record)) {
    const toolResults = standaloneToolResults(record);
    return {
      ...emptyCursorRecord(),
      toolResults,
      textChars: toolResults.reduce((sum, result) => sum + result.result.length, 0),
    };
  }
  const role = record.role;
  if (role !== "user" && role !== "assistant") {
    return emptyCursorRecord();
  }

  const texts: string[] = [];
  const activity: VaultActivityStep[] = [];
  const subagentCalls: CursorSubagentCall[] = [];
  const toolResults: CursorToolResult[] = [];
  const content = record.content;
  if (typeof content === "string") {
    if (content.length > MAX_RECORD_TEXT_CHARS) {
      return undefined;
    }
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const item of content) {
      const block = asObject(item);
      if (!block) {
        continue;
      }
      if (isTextBlock(block.type)) {
        if (typeof block.text !== "string") {
          continue;
        }
        if (block.text.length > MAX_RECORD_TEXT_CHARS) {
          return undefined;
        }
        texts.push(block.text);
      } else if (role === "assistant" && isToolCallBlock(block.type)) {
        const name = toolName(block);
        if (name) {
          const normalized = toolCallStep(name, block.input ?? block.args ?? block.arguments, block);
          activity.push(normalized.step);
          if (normalized.subagentCall) {
            subagentCalls.push(normalized.subagentCall);
          }
        }
      } else if (isToolResultBlock(block.type)) {
        const result = toolResultFromBlock(block);
        if (result) {
          toolResults.push(result);
        }
      }
    }
  } else if (typeof record.text === "string" && record.text.length <= MAX_RECORD_TEXT_CHARS) {
    texts.push(record.text);
  }

  const raw = texts.join("\n");
  const timestamp = timestampOf(record) ?? timestampOf(envelope);
  const stamp = timestamp !== undefined ? { timestamp } : {};
  const timeline: VaultTimelineItem[] = [];
  let notice: CursorNoticeCorrelation | undefined;
  let messageCount = 0;
  let textChars = 0;

  if (role === "user") {
    const classified = classifyCursorUserText(raw);
    if (classified.kind === "prompt") {
      timeline.push({ kind: "message", role, text: classified.text, ...stamp });
      messageCount = 1;
      textChars = classified.text.length;
    } else if (classified.kind === "notice") {
      timeline.push({
        kind: "notice",
        summary: classified.summary,
        ...(classified.body ? { body: classified.body } : {}),
        ...stamp,
      });
      textChars = classified.summary.length + (classified.body?.length ?? 0);
      if (classified.taskId) {
        notice = {
          taskId: classified.taskId,
          ...(classified.result ? { result: classified.result } : {}),
          ...(classified.childAgentId ? { childAgentId: classified.childAgentId } : {}),
        };
      }
    }
  } else {
    let text = raw;
    const marker = REASONING_LEAK_RE.exec(text);
    if (marker && marker.index > 0) {
      text = text.slice(0, marker.index).trimEnd();
    }
    if (text.length > 0) {
      timeline.push({ kind: "message", role, text, ...stamp });
      messageCount = 1;
      textChars = text.length;
    }
  }

  timeline.push(...activity);
  return {
    timeline,
    activity,
    subagentCalls,
    toolResults,
    ...(notice ? { notice } : {}),
    textChars:
      textChars +
      activity.reduce((sum, step) => sum + stepChars(step), 0) +
      toolResults.reduce((sum, result) => sum + result.result.length, 0),
    messageCount,
    toolCount: activity.filter((step) => step.kind === "tool").length,
    subagentCount: activity.filter((step) => step.kind === "subagent").length,
  };
}
