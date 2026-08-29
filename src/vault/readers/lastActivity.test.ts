// src/vault/readers/lastActivity.test.ts — tail-bounded last-activity read
// (source-the-agent-row-preview 1_1).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INITIAL_WINDOW_BYTES, MAX_WINDOW_BYTES, readLastActivityLine } from "./lastActivity";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "at-last-activity-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, lines: string[]): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, `${lines.join("\n")}\n`);
  return file;
}

const claudeUser = (text: string): string => JSON.stringify({ type: "user", message: { content: text } });
const claudeAssistant = (text: string): string =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });
const codexEvent = (type: string, message: string): string =>
  JSON.stringify({ type: "event_msg", payload: { type, message } });

/** Unusable in either format, so padding never answers for the record under test. */
const filler = (n: number): string[] => Array.from({ length: n }, (_, i) => JSON.stringify({ type: "noise", i }));

/** At least `bytes` of filler, so a test can push a record past a real window. */
function fillerBytes(bytes: number): string[] {
  const line = JSON.stringify({ type: "noise", pad: "p".repeat(200) });
  return Array.from({ length: Math.ceil(bytes / (line.length + 1)) + 1 }, () => line);
}

describe("readLastActivityLine", () => {
  it("answers with the last message, not the first", async () => {
    const file = await write("a.jsonl", [claudeUser("open the file"), claudeAssistant("opened it")]);
    expect(await readLastActivityLine(file, "claude")).toBe("opened it");
  });

  it("never reads the head: the only usable record, sitting past the cap, is not found", async () => {
    // A whole-file reader answers "the first thing said". A tail reader cannot see
    // it, and says so rather than reading on.
    const pad = fillerBytes(MAX_WINDOW_BYTES + 64 * 1024);
    const file = await write("head-only.jsonl", [claudeAssistant("the first thing said"), ...pad]);
    expect((await fs.stat(file)).size).toBeGreaterThan(MAX_WINDOW_BYTES);
    expect(await readLastActivityLine(file, "claude")).toBeNull();
  });

  it("grows the window to recover a record cut by the first one", async () => {
    // ~100 KB of text: the first 64 KB window slices it, so only growth answers.
    const big = "b".repeat(100 * 1024);
    const file = await write("straddle.jsonl", [...fillerBytes(2 * INITIAL_WINDOW_BYTES), claudeAssistant(big)]);
    expect((await fs.stat(file)).size).toBeGreaterThan(2 * INITIAL_WINDOW_BYTES);
    expect(await readLastActivityLine(file, "claude")).toBe("b".repeat(120));
  });

  it("gives up on a single record larger than the window cap", async () => {
    const huge = "h".repeat(MAX_WINDOW_BYTES + 64 * 1024);
    const file = await write("huge.jsonl", [claudeAssistant("reachable but older"), claudeAssistant(huge)]);
    expect(await readLastActivityLine(file, "claude")).toBeNull();
  });

  it("keeps a record that ends exactly on the cap's window boundary", async () => {
    // The window's first line is dropped as a half-record. When the boundary
    // lands ON a newline that line is whole, and at the cap there is no next
    // doubling to recover it (round-1 S1).
    const record = claudeAssistant("the record on the boundary");
    const noiseBase = JSON.stringify({ type: "noise", pad: "" });
    const padding = MAX_WINDOW_BYTES - (record.length + 1) - (noiseBase.length + 1);
    const tail = `${record}\n${JSON.stringify({ type: "noise", pad: "p".repeat(padding) })}\n`;
    expect(tail.length).toBe(MAX_WINDOW_BYTES);

    const file = path.join(dir, "boundary.jsonl");
    await fs.writeFile(file, `${"h".repeat(5000)}\n${tail}`);

    expect(await readLastActivityLine(file, "claude")).toBe("the record on the boundary");
  });

  describe("the claude rule", () => {
    it("skips sidechain, meta, and non-conversation records", async () => {
      const file = await write("claude-rule.jsonl", [
        claudeAssistant("the real answer"),
        JSON.stringify({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "sub" }] } }),
        JSON.stringify({ type: "user", isMeta: true, message: { content: "injected banner" } }),
        JSON.stringify({ type: "summary", summary: "a summary" }),
      ]);
      expect(await readLastActivityLine(file, "claude")).toBe("the real answer");
    });

    it("skips user records the classifier calls plumbing", async () => {
      const file = await write("plumbing.jsonl", [
        claudeUser("run the tests"),
        claudeUser("<local-command-stdout>ok</local-command-stdout>"),
        JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "…" }] } }),
      ]);
      expect(await readLastActivityLine(file, "claude")).toBe("run the tests");
    });

    it("does not accept a codex record", async () => {
      const file = await write("codex-as-claude.jsonl", [codexEvent("agent_message", "codex said this")]);
      expect(await readLastActivityLine(file, "claude")).toBeNull();
    });
  });

  describe("the codex rule", () => {
    it("takes user and agent messages and nothing else", async () => {
      const file = await write("codex-rule.jsonl", [
        codexEvent("agent_message", "older answer"),
        codexEvent("user_message", "the last thing asked"),
        JSON.stringify({ type: "turn_context", payload: { type: "turn_context", model: "gpt-5" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: {} } }),
        JSON.stringify({ type: "response_item", payload: { type: "user_message", message: "not an event_msg" } }),
      ]);
      expect(await readLastActivityLine(file, "codex")).toBe("the last thing asked");
    });

    it("does not accept a claude record", async () => {
      const file = await write("claude-as-codex.jsonl", [claudeAssistant("claude said this")]);
      expect(await readLastActivityLine(file, "codex")).toBeNull();
    });
  });

  it("returns one bounded line for a long multi-line message", async () => {
    const file = await write("long.jsonl", [claudeAssistant(`first line\nsecond line\n${"x".repeat(300)}`)]);
    const line = await readLastActivityLine(file, "claude");
    expect(line).not.toBeNull();
    expect(line).toHaveLength(120);
    expect(line).not.toContain("\n");
    expect(line?.startsWith("first line second line ")).toBe(true);
  });

  it("keeps a line that is only a marker", async () => {
    const file = await write("marker.jsonl", [claudeAssistant("-")]);
    expect(await readLastActivityLine(file, "claude")).toBe("-");
  });

  it("skips a torn last line rather than failing", async () => {
    const file = path.join(dir, "torn.jsonl");
    await fs.writeFile(file, `${claudeAssistant("the complete record")}\n{"type":"assistant","messa`);
    expect(await readLastActivityLine(file, "claude")).toBe("the complete record");
  });

  it("does not lose the newest record to a file that shrank mid-read", async () => {
    // The window is sized from `stat`. If the file shrinks before the read, the
    // read comes back short and the rest of the zero-filled buffer is NUL
    // padding — which, decoded, glues onto the newest record and makes it
    // unparseable, silently answering with an older one instead (W4).
    const file = path.join(dir, "shrinking.jsonl");
    await fs.writeFile(file, `${claudeAssistant("the older record")}\n${claudeAssistant("the newest record")}`);

    const overstatingStat = async (p: string): Promise<fs.FileHandle> => {
      const handle = await fs.open(p, "r");
      return new Proxy(handle, {
        get(target, key, receiver) {
          if (key !== "stat") {
            return Reflect.get(target, key, receiver);
          }
          return async () => {
            const stats = await target.stat();
            return new Proxy(stats, {
              get: (t, k) => (k === "size" ? t.size + 500 : Reflect.get(t, k)),
            });
          };
        },
      });
    };

    expect(await readLastActivityLine(file, "claude", overstatingStat)).toBe("the newest record");
  });

  it("answers null for a missing or empty file", async () => {
    expect(await readLastActivityLine(path.join(dir, "nope.jsonl"), "claude")).toBeNull();
    const empty = path.join(dir, "empty.jsonl");
    await fs.writeFile(empty, "");
    expect(await readLastActivityLine(empty, "claude")).toBeNull();
  });

  it("answers null for a file with no usable record", async () => {
    const file = await write("noise.jsonl", filler(5));
    expect(await readLastActivityLine(file, "claude")).toBeNull();
  });
});
