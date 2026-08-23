// src/vault/messageText.test.ts — recovering a quoted message's own text from a
// resolved record (improve-vault-transcript-messages 5_3).

import { describe, expect, it } from "vitest";
import { extractMessageText, resolveAssistantMessageRef } from "./messageText";

describe("extractMessageText — claude", () => {
  it("recovers a plain user prompt", () => {
    const record = JSON.stringify({ type: "user", uuid: "u-1", message: { role: "user", content: "build the thing" } });
    expect(extractMessageText("claude", record)).toBe("build the thing");
  });

  it("recovers text from content blocks", () => {
    const record = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "block form" }] },
    });
    expect(extractMessageText("claude", record)).toBe("block form");
  });

  it("refuses an injected record, so a notification can never seed a handoff", () => {
    const record = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<task-notification><summary>done</summary></task-notification>" },
    });
    expect(extractMessageText("claude", record)).toBeNull();
  });

  it("refuses an assistant record", () => {
    const record = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
    });
    expect(extractMessageText("claude", record)).toBeNull();
  });
});

describe("extractMessageText — codex", () => {
  it("recovers a user_message payload", () => {
    const record = JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "ship it" } });
    expect(extractMessageText("codex", record)).toBe("ship it");
  });

  it("refuses an agent_message payload", () => {
    const record = JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "shipped" } });
    expect(extractMessageText("codex", record)).toBeNull();
  });
});

describe("extractMessageText — opencode", () => {
  it("joins the row's real text parts", () => {
    const record = JSON.stringify({
      message: { id: "m1", data: JSON.stringify({ role: "user" }) },
      parts: [
        { data: JSON.stringify({ type: "text", text: "first" }) },
        { data: JSON.stringify({ type: "text", text: "second" }) },
      ],
    });
    expect(extractMessageText("opencode", record)).toBe("first second");
  });

  it("skips synthetic parts", () => {
    const record = JSON.stringify({
      message: { id: "m1", data: JSON.stringify({ role: "user" }) },
      parts: [
        { data: JSON.stringify({ type: "text", text: "injected", synthetic: true }) },
        { data: JSON.stringify({ type: "text", text: "real" }) },
      ],
    });
    expect(extractMessageText("opencode", record)).toBe("real");
  });

  it("refuses an assistant row", () => {
    const record = JSON.stringify({
      message: { id: "m1", data: JSON.stringify({ role: "assistant" }) },
      parts: [{ data: JSON.stringify({ type: "text", text: "done" }) }],
    });
    expect(extractMessageText("opencode", record)).toBeNull();
  });
});

describe("extractMessageText — malformed input", () => {
  it("returns null rather than throwing on unparseable JSON", () => {
    expect(extractMessageText("claude", "{ not json")).toBeNull();
  });

  it("returns null for an empty message", () => {
    expect(extractMessageText("claude", JSON.stringify({ type: "user", message: { content: "   " } }))).toBeNull();
  });
});

describe("extractMessageText — unknown agent", () => {
  it("returns null rather than guessing a record shape it does not know", () => {
    const record = JSON.stringify({ type: "user", message: { content: "hi" } });
    expect(extractMessageText("gemini", record)).toBeNull();
  });
});

describe("resolveAssistantMessageRef", () => {
  it("recovers a Claude assistant uuid and rejects a user record", () => {
    const assistant = JSON.stringify({
      type: "assistant",
      uuid: "a-1",
      message: { role: "assistant", content: "done" },
    });
    const user = JSON.stringify({ type: "user", uuid: "u-1", message: { role: "user", content: "go" } });
    expect(resolveAssistantMessageRef("claude", assistant, "forged")).toBe("a-1");
    expect(resolveAssistantMessageRef("claude", user, "u-1")).toBeNull();
  });

  it("normalizes a Codex physical-line locator only for an agent message", () => {
    const assistant = JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "done" } });
    const user = JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "go" } });
    expect(resolveAssistantMessageRef("codex", assistant, "#0007")).toBe("#7");
    expect(resolveAssistantMessageRef("codex", user, "#7")).toBeNull();
  });

  it("recovers an OpenCode assistant row id and rejects malformed data", () => {
    const assistant = JSON.stringify({
      message: { id: "msg_9", data: JSON.stringify({ role: "assistant" }) },
      parts: [],
    });
    expect(resolveAssistantMessageRef("opencode", assistant, "forged")).toBe("msg_9");
    expect(resolveAssistantMessageRef("opencode", "{bad", "msg_9")).toBeNull();
  });
});

// .reviews/round-1.md L4 — a part whose stored JSON will not parse was skipped,
// so the handoff quoted a message with a hole in it.
describe("extractMessageText — unparseable opencode part", () => {
  it("refuses rather than quoting the readable parts alone", () => {
    const record = JSON.stringify({
      message: { id: "msg_1", data: JSON.stringify({ role: "user" }) },
      parts: [
        { id: "p1", data: JSON.stringify({ type: "text", text: "first half" }) },
        { id: "p2", data: "{not json" },
      ],
    });
    expect(extractMessageText("opencode", record)).toBeNull();
  });
});
