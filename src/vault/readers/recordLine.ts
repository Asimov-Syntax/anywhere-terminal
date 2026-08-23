// src/vault/readers/recordLine.ts — locate one transcript record by predicate,
// bounded (improve-vault-transcript-messages D5).

import { createReadStream } from "node:fs";

/** Upper bound on a single record handed back to the webview for a Raw copy. */
export const MAX_RECORD_BYTES = 256 * 1024;

export type RecordLineResult = { ok: true; line: string } | { ok: false; reason: "not-found" | "too-large" };

/** Reader-owned hint that identifies a target without parsing an oversized line. */
export interface RecordLineHint {
  lineNo?: number;
  needles?: string[];
}

/**
 * Stream `filePath` and return the first line whose parsed record satisfies
 * `match`, verbatim — a Raw copy must be the transcript's own bytes, not a
 * re-serialization that reorders keys or drops formatting.
 *
 * `lineNo` is the PHYSICAL 1-based line, blanks included, so it stays the locator
 * the codex reader stamped while streaming. A line retains at most `maxBytes`;
 * oversized non-targets are skipped without construction or JSON parsing.
 */
export async function findRecordLine(
  filePath: string,
  match: (rec: Record<string, unknown>, lineNo: number) => boolean,
  maxBytes = MAX_RECORD_BYTES,
  hint: RecordLineHint = {},
): Promise<RecordLineResult> {
  const cap = Math.max(0, Math.floor(maxBytes));
  const needles = (hint.needles ?? []).map((needle) => Buffer.from(needle, "utf8"));
  const maxNeedleBytes = needles.reduce((max, needle) => Math.max(max, needle.length), 0);
  let stream: ReturnType<typeof createReadStream> | undefined;
  let lineNo = 0;
  let chunks: Buffer[] = [];
  let lineBytes = 0;
  let oversized = false;
  let lineHadBytes = false;
  let needleFound = false;
  let needleTail = Buffer.alloc(0);

  const resetLine = (): void => {
    chunks = [];
    lineBytes = 0;
    oversized = false;
    lineHadBytes = false;
    needleFound = false;
    needleTail = Buffer.alloc(0);
  };

  const scanNeedles = (chunk: Buffer): void => {
    if (needleFound || needles.length === 0 || chunk.length === 0) {
      return;
    }
    const window = needleTail.length > 0 ? Buffer.concat([needleTail, chunk]) : chunk;
    needleFound = needles.some((needle) => window.indexOf(needle) >= 0);
    const keep = Math.max(0, maxNeedleBytes - 1);
    needleTail = keep > 0 ? Buffer.from(window.subarray(Math.max(0, window.length - keep))) : Buffer.alloc(0);
  };

  const append = (chunk: Buffer): void => {
    if (chunk.length === 0) {
      return;
    }
    lineHadBytes = true;
    scanNeedles(chunk);
    if (oversized) {
      return;
    }
    if (lineBytes + chunk.length > cap) {
      oversized = true;
      chunks = [];
      return;
    }
    chunks.push(Buffer.from(chunk));
    lineBytes += chunk.length;
  };

  const finishLine = (): RecordLineResult | undefined => {
    lineNo++;
    const hintedByLine = hint.lineNo === lineNo;
    const hasHint = hint.lineNo !== undefined || needles.length > 0;
    const candidate = !hasHint || hintedByLine || needleFound;
    if (oversized) {
      const result = candidate ? { ok: false as const, reason: "too-large" as const } : undefined;
      resetLine();
      return result;
    }
    if (!candidate) {
      resetLine();
      return undefined;
    }
    const trimmed = Buffer.concat(chunks, lineBytes).toString("utf8").trim();
    resetLine();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && match(parsed as Record<string, unknown>, lineNo)
        ? { ok: true, line: trimmed }
        : undefined;
    } catch {
      return undefined;
    }
  };

  try {
    stream = createReadStream(filePath, { highWaterMark: Math.min(64 * 1024, Math.max(1024, cap + 1)) });
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      let start = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] !== 0x0a) {
          continue;
        }
        append(chunk.subarray(start, i));
        const result = finishLine();
        if (result) {
          return result;
        }
        start = i + 1;
      }
      append(chunk.subarray(start));
    }
    if (lineHadBytes) {
      const result = finishLine();
      if (result) {
        return result;
      }
    }
  } catch {
    return { ok: false, reason: "not-found" };
  } finally {
    stream?.destroy();
  }
  return { ok: false, reason: "not-found" };
}
