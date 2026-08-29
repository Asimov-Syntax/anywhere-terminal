// src/vault/readers/lastActivity.ts — One session's last activity, read from the
// END of its transcript (source-the-agent-row-preview D1/D1b).
//
// The detail path already derives `latestMessage`, and it gets there by streaming
// the whole file into a head/tail buffer and classifying it into a 400-item
// timeline. That is a whole-file read per row per presence scan for one ≤120-char
// line, on the one axis that actually grows: a long-running session's transcript
// reaches tens of megabytes while its last message stays one line.
//
// So this reads a window off the tail, splits it on newlines, and walks backwards
// to the first record the format calls usable. Cost is flat in transcript size.

import * as fs from "node:fs/promises";
import { boundedPreview } from "../preview";
import { extractText } from "./detail";
import { classifyUserRecord } from "./userRecord";

/** Transcript formats this reader covers. SQLite-backed sources have no path to give it. */
export type LastActivityFormat = "claude" | "codex";

/** First window off the tail. Wide enough that one read answers a normal transcript. */
export const INITIAL_WINDOW_BYTES = 64 * 1024;

/**
 * Hard ceiling on window growth. "Return the last message" and "never read the
 * head" cannot both hold unconditionally — a single record can be larger than any
 * window — so the walk gives up here rather than reading unboundedly. A row with a
 * pathological last record shows no preview, which is a normal row (D3).
 */
export const MAX_WINDOW_BYTES = 1024 * 1024;

/**
 * The last usable message in `transcriptPath`, already bounded to one ≤120-char
 * line. `null` means nothing usable was found — no record, an unreadable file, or
 * a record too large for the window cap. The caller treats all three the same.
 *
 * `format` is a parameter and is never inferred from the content: the caller knows
 * which provider the entry came from, and guessing would let one format's records
 * answer for the other.
 */
export async function readLastActivityLine(transcriptPath: string, format: LastActivityFormat): Promise<string | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(transcriptPath, "r");
    const { size } = await handle.stat();
    if (size <= 0) {
      return null;
    }
    const usable = format === "claude" ? claudeActivity : codexActivity;
    for (let window = INITIAL_WINDOW_BYTES; ; window = Math.min(window * 2, MAX_WINDOW_BYTES)) {
      // One byte earlier than the window when there is room, so the boundary
      // itself says whether the first line is a fragment. Without it a window
      // that lands exactly on a newline discards a whole record, and at the cap
      // there is no next doubling to recover it (round-1 S1).
      const start = Math.max(0, size - window - 1);
      const buf = Buffer.alloc(size - start);
      // Decode only what arrived: `Buffer.alloc` is zero-filled, and a short read
      // on a truncated or network-backed file would otherwise feed NUL padding
      // into the newest record and lose it (W4).
      const { bytesRead } = await handle.read(buf, 0, buf.length, start);
      const reachedHead = start === 0;
      const text = buf.toString("utf8", 0, bytesRead);
      const lines = text.split("\n");
      if (!reachedHead && !text.startsWith("\n")) {
        // The window cut a record in half. Drop that fragment — growing the
        // window is what brings it back whole.
        lines.shift();
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        const text = usableText(lines[i], usable);
        if (text !== undefined) {
          return boundedPreview(text);
        }
      }
      if (reachedHead || window >= MAX_WINDOW_BYTES) {
        return null; // the head, or a record too large for the cap (D1b)
      }
    }
  } catch {
    return null; // missing, unopenable, unreadable — the caller's failure story is absence
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function usableText(
  line: string | undefined,
  usable: (rec: Record<string, unknown>) => string | undefined,
): string | undefined {
  const trimmed = line?.trim();
  if (!trimmed) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined; // a torn or corrupt tail line is skipped, not fatal
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const text = usable(parsed as Record<string, unknown>);
  return text?.trim() ? text : undefined;
}

/**
 * A non-sidechain, non-meta `user`/`assistant` record — the same rule the detail
 * classifier applies (`detail.ts` § classifyClaudeStyleEvents). A user record goes
 * through `classifyUserRecord`, so injected banners, command plumbing and
 * background-task notices do not read as something the session did.
 */
function claudeActivity(rec: Record<string, unknown>): string | undefined {
  if (rec.isSidechain === true || rec.isMeta === true) {
    return undefined;
  }
  if (rec.type === "user") {
    const cls = classifyUserRecord(rec);
    return cls.kind === "prompt" ? cls.text : undefined;
  }
  if (rec.type !== "assistant") {
    return undefined;
  }
  const message = rec.message;
  if (!message || typeof message !== "object") {
    return undefined;
  }
  return extractText((message as { content?: unknown }).content);
}

/**
 * An `event_msg` whose payload is a `user_message` or `agent_message` — the same
 * rule the Codex classifier applies (`codexReader.ts` § classifyCodexRolloutEvents).
 */
function codexActivity(rec: Record<string, unknown>): string | undefined {
  if (rec.type !== "event_msg") {
    return undefined;
  }
  const payload = rec.payload;
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const { type, message } = payload as { type?: unknown; message?: unknown };
  if (type !== "user_message" && type !== "agent_message") {
    return undefined;
  }
  return typeof message === "string" ? message : undefined;
}
