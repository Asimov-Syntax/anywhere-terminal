// src/vault/readers/userRecord.ts — What a user-role transcript record actually is.
//
// Agents store records in the user role that the human never typed: injected
// banners, command plumbing, background-task notifications, compaction
// summaries. One classifier answers that question for every consumer (the
// timeline, the session title, `firstPrompt`) so they cannot disagree
// (improve-vault-transcript-messages D1/D2).

import { cleanPromptText, extractText, stripSystemReminders } from "./detail";

export type UserRecordClass =
  | { kind: "prompt"; text: string }
  | { kind: "drop" }
  | { kind: "notice"; summary: string; status?: string; body?: string }
  | { kind: "compaction"; text: string };

const DROP: UserRecordClass = { kind: "drop" };
const NOTIFICATION_OPEN = "<task-notification>";

/**
 * Classify one user-role record. Flags are read BEFORE text: a compaction
 * summary is identified by `isCompactSummary`, never by matching its prose —
 * the same sentence typed by a human is a real prompt.
 */
export function classifyUserRecord(rec: Record<string, unknown>): UserRecordClass {
  if (!rec || typeof rec !== "object" || rec.type !== "user" || rec.isMeta === true) {
    return DROP;
  }
  if (typeof rec.interruptedMessageId === "string" && rec.interruptedMessageId) {
    return { kind: "notice", summary: "Request interrupted by user" };
  }
  const message = rec.message;
  const raw =
    message && typeof message === "object" ? extractText((message as { content?: unknown }).content) : undefined;
  if (!raw) {
    return DROP; // no text at all (a tool-result-only record is plumbing)
  }
  if (rec.isCompactSummary === true) {
    const text = raw.trim();
    return text ? { kind: "compaction", text } : DROP;
  }
  return classifyUserText(raw);
}

/**
 * The text-level half of the same taxonomy, for callers holding a message but
 * not its record (the session-title path). Flag-borne classes — meta,
 * compaction — are invisible here and belong to {@link classifyUserRecord}.
 */
export function classifyUserText(raw: string): UserRecordClass {
  const text = stripSystemReminders(raw).trim();
  if (!text) {
    return DROP;
  }
  if (text.startsWith(NOTIFICATION_OPEN)) {
    return classifyNotification(text);
  }
  const prompt = cleanPromptText(text);
  return prompt ? { kind: "prompt", text: prompt } : DROP;
}

/** A `<task-notification>` envelope → its summary line, status and result body.
 *  A malformed envelope with no readable summary is dropped rather than shown
 *  as markup. */
function classifyNotification(text: string): UserRecordClass {
  const summary = readTag(text, "summary");
  if (!summary) {
    return DROP;
  }
  const status = readTag(text, "status");
  const body = readTag(text, "result");
  return {
    kind: "notice",
    summary,
    ...(status ? { status } : {}),
    ...(body ? { body } : {}),
  };
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
  if (end < 0) {
    return undefined;
  }
  return text.slice(from, end).trim() || undefined;
}
