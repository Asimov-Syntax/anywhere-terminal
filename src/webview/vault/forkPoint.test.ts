// src/webview/vault/forkPoint.test.ts — where a continuation forks from
// (improve-vault-transcript-messages 8_1, design.md D9).

import { describe, expect, it } from "vitest";
import type { VaultTimelineItem } from "../../vault/types";
import { resolveForkPoint } from "./forkPoint";

type Message = Extract<VaultTimelineItem, { kind: "message" }>;

function msg(role: "user" | "assistant", text: string, msgRef?: string): Message {
  return { kind: "message", role, text, timestamp: 1, ...(msgRef ? { msgRef } : {}) };
}

const tool: VaultTimelineItem = { kind: "tool", tool: "Read", detail: "a.ts" };

describe("resolveForkPoint", () => {
  const reply = msg("assistant", "I refactored the reader", "a-1");
  const followUp = msg("user", "now do codexReader", "u-2");
  const timeline = [msg("user", "refactor the reader", "u-1"), reply, tool, followUp];

  it("anchors an assistant message at itself and seeds from the next user turn", () => {
    expect(resolveForkPoint(timeline, reply)).toEqual({
      anchorRef: "a-1",
      anchorText: "I refactored the reader",
      seedRef: "u-2",
      seedText: "now do codexReader",
    });
  });

  it("anchors a user message at the reply before it and seeds from itself", () => {
    expect(resolveForkPoint(timeline, followUp)).toEqual({
      anchorRef: "a-1",
      anchorText: "I refactored the reader",
      seedRef: "u-2",
      seedText: "now do codexReader",
    });
  });

  it("gives an assistant message with no later user turn an empty seed", () => {
    const last = msg("assistant", "done", "a-9");
    expect(resolveForkPoint([reply, followUp, last], last)).toEqual({
      anchorRef: "a-9",
      anchorText: "done",
    });
  });

  it("gives the session's first user message an empty fork point", () => {
    expect(resolveForkPoint(timeline, timeline[0] as Message)).toEqual({});
  });

  it("does not pair messages across an omitted-history gap", () => {
    const gap = { kind: "gap" } as VaultTimelineItem;
    expect(resolveForkPoint([reply, gap, followUp], followUp)).toEqual({});
    expect(resolveForkPoint([reply, gap, followUp], reply)).toEqual({
      anchorRef: "a-1",
      anchorText: "I refactored the reader",
    });
  });

  it("skips non-message items when scanning for the pair", () => {
    const notice: VaultTimelineItem = { kind: "notice", summary: "background command finished" };
    const withNoise = [reply, notice, tool, followUp];
    expect(resolveForkPoint(withNoise, reply).seedRef).toBe("u-2");
  });

  it("returns nothing for an item that is not in the timeline", () => {
    expect(resolveForkPoint(timeline, msg("user", "elsewhere", "u-x"))).toEqual({});
  });

  it("carries a message that has no locator, so the reader can still start from it", () => {
    const unaddressed = msg("assistant", "no uuid here");
    expect(resolveForkPoint([unaddressed], unaddressed)).toEqual({ anchorText: "no uuid here" });
  });
});
