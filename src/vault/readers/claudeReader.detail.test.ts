// src/vault/readers/claudeReader.detail.test.ts — Claude detail read (redesign-vault-panel-ui 2_2).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VaultTimelineItem } from "../types";
import { readClaudeDetail, readClaudeMessageRecord, resolveClaudeSessionPath } from "./claudeReader";

const isMessage = (t: VaultTimelineItem): t is Extract<VaultTimelineItem, { kind: "message" }> => t.kind === "message";

let configDir: string;

function jsonl(records: Record<string, unknown>[]): string {
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

async function writeSession(
  encodedCwd: string,
  sessionId: string,
  records: Record<string, unknown>[],
): Promise<string> {
  const dir = path.join(configDir, "projects", encodedCwd);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  await fs.writeFile(file, jsonl(records));
  return file;
}

async function writeSubagent(
  encodedCwd: string,
  parentSessionId: string,
  stem: string,
  meta: Record<string, unknown>,
  records: Record<string, unknown>[],
): Promise<void> {
  const dir = path.join(configDir, "projects", encodedCwd, parentSessionId, "subagents");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${stem}.jsonl`), jsonl(records));
  await fs.writeFile(path.join(dir, `${stem}.meta.json`), JSON.stringify(meta));
}

/** isSidechain assistant record carrying one `Task` tool_use block (a nested spawn). */
function sidechainTask(id: string, input: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "assistant",
    isSidechain: true,
    message: { role: "assistant", content: [{ type: "tool_use", id, name: "Task", input }] },
  };
}

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), "at-claude-detail-"));
});

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("resolveClaudeSessionPath", () => {
  it("locates the unique session file by id under projects/*", async () => {
    const file = await writeSession("-Users-me-proj", "sess-1", [{ type: "user", message: { content: "hi" } }]);
    expect(await resolveClaudeSessionPath("sess-1", { configDir })).toBe(file);
  });

  it("returns null for an unknown id", async () => {
    await writeSession("-Users-me-proj", "sess-1", [{ type: "user", message: { content: "hi" } }]);
    expect(await resolveClaudeSessionPath("nope", { configDir })).toBeNull();
  });

  it("rejects a traversal-style id without scanning", async () => {
    expect(await resolveClaudeSessionPath("../../etc/passwd", { configDir })).toBeNull();
  });
});

describe("readClaudeDetail", () => {
  it("classifies a session: first prompt, tool calls, subagent, latest, usage", async () => {
    await writeSession("-Users-me-proj", "sess-2", [
      { type: "summary", summary: "ignore me" },
      { type: "user", message: { role: "user", content: "build the thing" }, timestamp: "2026-05-01T00:00:00.000Z" },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", input: { file_path: "/src/a.ts" } }],
          usage: { output_tokens: 20, input_tokens: 100 },
        },
      },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Task", input: { subagent_type: "asm-finder", prompt: "find X" } }],
        },
      },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "all done" }] },
        timestamp: "2026-05-01T02:00:00.000Z",
      },
    ]);

    const detail = await readClaudeDetail("sess-2", { configDir });
    expect(detail).not.toBeNull();
    if (!detail) {
      return;
    }
    expect(detail.entryId).toBe("claude:sess-2");
    expect(detail.firstPrompt).toBe("build the thing");
    expect(detail.recentActivity).toEqual([
      { kind: "tool", tool: "Read", detail: "/src/a.ts", diff: undefined },
      { kind: "subagent", name: "asm-finder", prompt: "find X" },
    ]);
    expect(detail.latestMessage).toMatchObject({ role: "assistant", text: "all done" });
    expect(detail.stats.toolCount).toBe(1);
    expect(detail.stats.subagentCount).toBe(1);
    expect(detail.stats.tokenCount).toBe(120);
  });

  it("attaches per-message model + token usage to assistant messages, not user ones", async () => {
    await writeSession("-Users-me-proj", "sess-meta", [
      { type: "user", message: { role: "user", content: "hi" }, timestamp: "2026-05-01T00:00:00.000Z" },
      {
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          content: [{ type: "text", text: "hello back" }],
          usage: {
            output_tokens: 30,
            input_tokens: 100,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 15,
          },
        },
        timestamp: "2026-05-01T01:00:00.000Z",
      },
    ]);

    const detail = await readClaudeDetail("sess-meta", { configDir });
    const messages = (detail?.timeline ?? []).filter(isMessage);
    const assistant = messages.find((m) => m.role === "assistant");
    const user = messages.find((m) => m.role === "user");
    expect(assistant?.model).toBe("claude-opus-4-8");
    // input = input + cache_read + cache_creation = 100 + 5 + 15 = 120; output = 30
    expect(assistant?.tokens).toEqual({ input: 120, output: 30 });
    // User messages carry no model/tokens.
    expect(user?.model).toBeUndefined();
    expect(user?.tokens).toBeUndefined();
  });

  it("renders a long assistant body in full but keeps a long user prompt capped", async () => {
    const longAssistant = `START ${"a".repeat(5000)} END`;
    const longUser = "u".repeat(5000);
    await writeSession("-Users-me-proj", "sess-long", [
      { type: "user", message: { role: "user", content: longUser }, timestamp: "2026-05-01T00:00:00.000Z" },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: longAssistant }] },
        timestamp: "2026-05-01T01:00:00.000Z",
      },
    ]);

    const detail = await readClaudeDetail("sess-long", { configDir });
    const messages = (detail?.timeline ?? []).filter(isMessage);
    const assistant = messages.find((m) => m.role === "assistant");
    const user = messages.find((m) => m.role === "user");
    // Assistant body survives whole — no ellipsis truncation.
    expect(assistant?.text).toBe(longAssistant);
    expect(assistant?.text).not.toContain("…");
    // User prompt stays bounded with the ellipsis.
    expect(user?.text.endsWith("…")).toBe(true);
  });

  it("returns null when the session id can't be resolved", async () => {
    expect(await readClaudeDetail("missing", { configDir })).toBeNull();
  });

  it("tolerates corrupt lines and still classifies the rest", async () => {
    const dir = path.join(configDir, "projects", "-Users-me-proj");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "sess-3.jsonl");
    await fs.writeFile(
      file,
      `${JSON.stringify({ type: "user", message: { content: "first" } })}\n{ this is not json\n${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } })}\n`,
    );
    const detail = await readClaudeDetail("sess-3", { configDir });
    expect(detail?.firstPrompt).toBe("first");
    expect(detail?.latestMessage).toMatchObject({ role: "assistant", text: "ok" });
  });
});

// improve-vault-transcript-messages 3_1 — every message item carries the locator
// the host later resolves back to its source record.
describe("readClaudeDetail message locators", () => {
  it("stamps the record uuid on user and assistant messages", async () => {
    await writeSession("-Users-me-proj", "sess-ref", [
      { type: "user", uuid: "u-1", message: { role: "user", content: "build the thing" } },
      { type: "assistant", uuid: "a-1", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
    ]);
    const messages = (await readClaudeDetail("sess-ref", { configDir }))?.timeline.filter(isMessage);
    expect(messages?.map((m) => [m.role, m.msgRef])).toEqual([
      ["user", "u-1"],
      ["assistant", "a-1"],
    ]);
  });

  it("gives every text block of one assistant record the same locator", async () => {
    await writeSession("-Users-me-proj", "sess-ref2", [
      {
        type: "assistant",
        uuid: "a-9",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      },
    ]);
    const messages = (await readClaudeDetail("sess-ref2", { configDir }))?.timeline.filter(isMessage);
    expect(messages?.map((m) => m.msgRef)).toEqual(["a-9", "a-9"]);
  });

  it("omits the locator when the record carries no uuid", async () => {
    await writeSession("-Users-me-proj", "sess-ref3", [{ type: "user", message: { role: "user", content: "hi" } }]);
    const messages = (await readClaudeDetail("sess-ref3", { configDir }))?.timeline.filter(isMessage);
    expect(messages?.[0]).not.toHaveProperty("msgRef");
  });
});

// support-nested-subagent-preview — a depth-2 tree (root → outer → inner), all
// subagents stored flat under <sessionId>/subagents/, linked by meta.toolUseId.
describe("readClaudeDetail nested subagents (depth-2)", () => {
  const CWD = "-Users-me-proj";

  async function writeDepth2Tree(): Promise<void> {
    await writeSession(CWD, "sess-root", [
      { type: "user", message: { role: "user", content: "build it" }, timestamp: "2026-05-01T00:00:00.000Z" },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_A",
              name: "Task",
              input: { subagent_type: "outer", description: "do outer" },
            },
          ],
        },
      },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "root done" }] } },
    ]);
    await writeSubagent(
      CWD,
      "sess-root",
      "agent-outer1",
      { agentType: "outer", description: "do outer", toolUseId: "toolu_A" },
      [
        {
          type: "user",
          isSidechain: true,
          message: { role: "user", content: "start outer" },
          timestamp: "2026-05-01T00:01:00.000Z",
        },
        sidechainTask("toolu_B", { subagent_type: "inner", description: "do inner" }),
        {
          type: "assistant",
          isSidechain: true,
          message: { role: "assistant", content: [{ type: "text", text: "outer done" }] },
        },
      ],
    );
    await writeSubagent(
      CWD,
      "sess-root",
      "agent-inner1",
      { agentType: "inner", description: "do inner", toolUseId: "toolu_B" },
      [
        {
          type: "user",
          isSidechain: true,
          message: { role: "user", content: "start inner" },
          timestamp: "2026-05-01T00:02:00.000Z",
        },
        {
          type: "assistant",
          isSidechain: true,
          message: { role: "assistant", content: [{ type: "text", text: "inner done" }] },
        },
      ],
    );
  }

  it("embeds only the DIRECT child at the root (the nested grandchild does not flatten up)", async () => {
    await writeDepth2Tree();
    const root = await readClaudeDetail("sess-root", { configDir });
    const subs = (root?.timeline ?? []).filter((i) => i.kind === "subagentSession");
    expect(subs.map((s) => (s.kind === "subagentSession" ? s.entryId : ""))).toEqual([
      "claude:sess-root:subagent:agent-outer1",
    ]);
    expect(root?.stats.subagentCount).toBe(1);
  });

  it("reveals the nested grandchild when the outer subagent is expanded", async () => {
    await writeDepth2Tree();
    const outer = await readClaudeDetail("sess-root:subagent:agent-outer1", { configDir });
    const subs = (outer?.timeline ?? []).filter((i) => i.kind === "subagentSession");
    expect(subs.map((s) => (s.kind === "subagentSession" ? s.entryId : ""))).toEqual([
      "claude:sess-root:subagent:agent-inner1",
    ]);
    // The outer transcript renders (its sidechain records ARE its conversation).
    expect(
      outer?.timeline.some((i) => i.kind === "message" && i.role === "assistant" && i.text.includes("outer done")),
    ).toBe(true);
  });

  it("renders the innermost subagent as a leaf (no further nesting)", async () => {
    await writeDepth2Tree();
    const inner = await readClaudeDetail("sess-root:subagent:agent-inner1", { configDir });
    expect(inner?.timeline.some((i) => i.kind === "subagentSession")).toBe(false);
    expect(
      inner?.timeline.some((i) => i.kind === "message" && i.role === "assistant" && i.text.includes("inner done")),
    ).toBe(true);
  });
});

// .reviews/round-1.md L6 — a uuid match alone addressed any record, so a locator
// naming plumbing resolved it as if it were a message.
describe("readClaudeMessageRecord", () => {
  it("does not mistake a uuid quoted in oversized message content for the target field", async () => {
    await writeSession("-Users-me-proj", "sess-quoted-ref", [
      {
        type: "user",
        uuid: "other",
        message: { role: "user", content: `quoted "target-uuid" ${"x".repeat(300)}` },
      },
      { type: "assistant", uuid: "target-uuid", message: { role: "assistant", content: "actual target" } },
    ]);
    expect(await readClaudeMessageRecord("sess-quoted-ref", "target-uuid", { configDir }, 100)).toEqual({
      ok: true,
      line: expect.stringContaining('"uuid":"target-uuid"'),
    });
  });

  it("resolves a user record and refuses a non-message record with the same shape of id", async () => {
    await writeSession("-Users-me-proj", "sess-rec", [
      { type: "user", uuid: "u-1", message: { role: "user", content: "hello" } },
      { type: "summary", uuid: "s-1", summary: "a compacted summary" },
    ]);
    expect((await readClaudeMessageRecord("sess-rec", "u-1", { configDir })).ok).toBe(true);
    expect((await readClaudeMessageRecord("sess-rec", "s-1", { configDir })).ok).toBe(false);
  });
});
