// src/vault/readers/recordLine.test.ts — bounded transcript-line scan (improve-vault-transcript-messages 3_2).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRecordLine, MAX_RECORD_BYTES } from "./recordLine";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "at-record-line-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, body: string): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, body);
  return file;
}

describe("findRecordLine", () => {
  it("returns the matching line verbatim, not a re-serialization", async () => {
    const line = '{"uuid":"u-2",  "type":"user",  "message":{"content":"hi"}}';
    const file = await write("a.jsonl", `{"uuid":"u-1"}\n${line}\n{"uuid":"u-3"}\n`);
    const res = await findRecordLine(file, (rec) => rec.uuid === "u-2");
    expect(res).toEqual({ ok: true, line });
  });

  it("reports not-found when no record matches", async () => {
    const file = await write("b.jsonl", '{"uuid":"u-1"}\n');
    expect(await findRecordLine(file, (rec) => rec.uuid === "nope")).toEqual({ ok: false, reason: "not-found" });
  });

  it("counts physical lines, so a blank line still advances the ordinal", async () => {
    const file = await write("c.jsonl", '{"n":1}\n\n{"n":3}\n');
    const res = await findRecordLine(file, (_rec, lineNo) => lineNo === 3);
    expect(res).toEqual({ ok: true, line: '{"n":3}' });
  });

  it("skips a corrupt line and keeps scanning", async () => {
    const file = await write("d.jsonl", 'not json\n{"uuid":"u-9"}\n');
    expect(await findRecordLine(file, (rec) => rec.uuid === "u-9")).toEqual({ ok: true, line: '{"uuid":"u-9"}' });
  });

  it("refuses a matching line larger than the cap instead of returning it", async () => {
    const big = JSON.stringify({ uuid: "big", pad: "x".repeat(200) });
    const file = await write("e.jsonl", `${big}\n`);
    expect(await findRecordLine(file, (rec) => rec.uuid === "big", 100, { needles: ['"uuid":"big"'] })).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("does not parse an oversized non-target line", async () => {
    const huge = JSON.stringify({ uuid: "other", pad: "x".repeat(200) });
    const file = await write("bounded.jsonl", `${huge}\n{"uuid":"target"}\n`);
    const matchedLines: number[] = [];
    const res = await findRecordLine(
      file,
      (rec, lineNo) => {
        matchedLines.push(lineNo);
        return rec.uuid === "target";
      },
      100,
      { needles: ['"uuid":"target"'] },
    );
    expect(res).toEqual({ ok: true, line: '{"uuid":"target"}' });
    expect(matchedLines).toEqual([2]);
  });

  it("uses a physical-line hint to reject an oversized Codex target without parsing it", async () => {
    const file = await write("ordinal.jsonl", `{"n":1}\n${JSON.stringify({ pad: "x".repeat(200) })}\n`);
    let parsed = false;
    const res = await findRecordLine(
      file,
      () => {
        parsed = true;
        return true;
      },
      100,
      { lineNo: 2 },
    );
    expect(res).toEqual({ ok: false, reason: "too-large" });
    expect(parsed).toBe(false);
  });

  it("reports not-found for an unreadable file", async () => {
    expect(await findRecordLine(path.join(dir, "missing.jsonl"), () => true)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("caps at 256 KB by default", () => {
    expect(MAX_RECORD_BYTES).toBe(256 * 1024);
  });
});
