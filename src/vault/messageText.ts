// src/vault/messageText.ts — recover the human turn's own text from a resolved
// record, so a continue handoff quotes the untruncated message (D7).

import { classifyUserRecord } from "./readers/userRecord";

/**
 * The text of the quoted message, or null when the record is not a human turn —
 * an assistant reply, an injected notification, or anything unparseable. Refusing
 * is the safe outcome: a handoff seeded from a notification would quote plumbing
 * back at a fresh agent as if the user had written it.
 */
export function extractMessageText(agent: string, record: string): string | null {
  const rec = parseRecord(record);
  if (!rec) {
    return null;
  }
  const byAgent: Record<string, (r: Record<string, unknown>) => string | undefined> = {
    claude: fromClaude,
    codex: fromCodex,
    opencode: fromOpenCode,
  };
  const trimmed = byAgent[agent]?.(rec)?.trim();
  return trimmed ? trimmed : null;
}

/** Validate the resolved anchor as an assistant turn and recover its canonical
 * reader-owned locator. The requested locator is used only where the record has
 * no native id (Codex physical lines). */
export function resolveAssistantMessageRef(agent: string, record: string, requestedRef: string): string | null {
  const rec = parseRecord(record);
  if (!rec) {
    return null;
  }
  if (agent === "claude") {
    const message = asObject(rec.message);
    return rec.type === "assistant" && message?.role === "assistant" && typeof rec.uuid === "string" && rec.uuid
      ? rec.uuid
      : null;
  }
  if (agent === "codex") {
    const payload = asObject(rec.payload);
    const ordinal = /^#0*(\d+)$/.exec(requestedRef)?.[1];
    return rec.type === "event_msg" && payload?.type === "agent_message" && ordinal ? `#${Number(ordinal)}` : null;
  }
  if (agent === "opencode") {
    const message = asObject(rec.message);
    const id = message?.id;
    return parseData(message?.data)?.role === "assistant" && typeof id === "string" && id ? id : null;
  }
  return null;
}

function parseRecord(record: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(record));
  } catch {
    return undefined;
  }
}

/** Reuses the timeline's own taxonomy, so what seeds a handoff is exactly what
 *  the preview showed as a user message. */
function fromClaude(rec: Record<string, unknown>): string | undefined {
  const cls = classifyUserRecord(rec);
  return cls.kind === "prompt" ? cls.text : undefined;
}

function fromCodex(rec: Record<string, unknown>): string | undefined {
  const payload = asObject(rec.payload);
  if (payload?.type !== "user_message" || typeof payload.message !== "string") {
    return undefined;
  }
  return payload.message;
}

function fromOpenCode(rec: Record<string, unknown>): string | undefined {
  const message = asObject(rec.message);
  if (parseData(message?.data)?.role !== "user") {
    return undefined;
  }
  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const texts: string[] = [];
  for (const part of parts) {
    const data = parseData(asObject(part)?.data);
    if (!data) {
      return undefined; // a part we cannot read may be text — quoting the rest would drop it silently
    }
    if (data.type === "text" && data.synthetic !== true && typeof data.text === "string") {
      texts.push(data.text);
    }
  }
  return texts.join(" ");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** OpenCode stores each row's payload as a JSON string in a `data` column. */
function parseData(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") {
    return asObject(value);
  }
  try {
    return asObject(JSON.parse(value));
  } catch {
    return undefined;
  }
}
