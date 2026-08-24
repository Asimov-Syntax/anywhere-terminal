// src/vault/readers/cursorNormalization.test.ts — Unit tests for the shared
// Cursor record classifier: agent identity on an invocation, and the
// one-agent-many-invocations pass both readers apply (show-cursor-subagent-continuations D1/D2).

import { describe, expect, it } from "vitest";
import type { VaultActivityStep } from "../types";
import {
  collectCursorAgentTypes,
  isCursorDeclaredAgentType,
  mergeCursorSubagentInvocations,
  normalizeCursorRecord,
} from "./cursorNormalization";

function taskCall(args: Record<string, unknown>, toolCallId = "call-1"): VaultActivityStep[] {
  const record = normalizeCursorRecord({
    role: "assistant",
    content: [{ type: "tool-call", toolName: "Task", toolCallId, args }],
  });
  return record?.activity ?? [];
}

function subagent(step: VaultActivityStep): Extract<VaultActivityStep, { kind: "subagent" }> & {
  childAgentId?: string;
} {
  if (step.kind !== "subagent") {
    throw new Error(`expected a subagent step, got ${step.kind}`);
  }
  return step;
}

describe("normalizeCursorRecord: agent identity on the invocation", () => {
  it("reads the bounded resume argument as the agent being continued", () => {
    const [step] = taskCall({ description: "Oracle next step", prompt: "What now?", resume: "oracle-1" });
    expect(subagent(step)).toMatchObject({ name: "Task", title: "Oracle next step", childAgentId: "oracle-1" });
  });

  it("ignores an unsafe, oversized, or non-string resume value", () => {
    for (const resume of ["../../etc/passwd", "has space", "a/b", "x".repeat(201), 7, null]) {
      const [step] = taskCall({ description: "d", resume });
      expect(subagent(step).childAgentId).toBeUndefined();
    }
  });
});

describe("mergeCursorSubagentInvocations", () => {
  const launch = () => ({ kind: "subagent" as const, name: "asm-oracle", title: "Launch", prompt: "Stand by" });
  const continuation = (result: string) => ({
    kind: "subagent" as const,
    name: "Task",
    title: "Follow-up",
    prompt: "Question",
    result,
    status: "completed" as const,
  });

  it("keeps every invocation in place, marking the ones after the launch", () => {
    const items = [
      { kind: "message" as const, role: "user" as const, text: "go" },
      { ...launch(), childAgentId: "oracle-1", status: "running" as const },
      { kind: "tool" as const, tool: "Read" },
      { ...continuation("Answer 1"), childAgentId: "oracle-1" },
      { ...continuation("Answer 2"), childAgentId: "oracle-1" },
    ];

    const merged = mergeCursorSubagentInvocations(items);
    expect(merged.map((item) => item.kind)).toEqual(["message", "subagent", "tool", "subagent", "subagent"]);
    expect(subagent(merged[1] as VaultActivityStep)).toEqual({
      kind: "subagent",
      name: "asm-oracle",
      title: "Launch",
      prompt: "Stand by",
      childAgentId: "oracle-1",
      status: "running",
    });
    expect(subagent(merged[3] as VaultActivityStep)).toMatchObject({
      name: "asm-oracle",
      title: "Follow-up",
      result: "Answer 1",
      continuation: true,
    });
    expect(subagent(merged[4] as VaultActivityStep)).toMatchObject({ result: "Answer 2", continuation: true });
  });

  it("leaves the owner unmarked so it still renders as the launch card", () => {
    const merged = mergeCursorSubagentInvocations([
      { ...launch(), childAgentId: "oracle-1" },
      { ...continuation("Answer"), childAgentId: "oracle-1" },
    ]);
    expect(subagent(merged[0] as VaultActivityStep)).not.toHaveProperty("continuation");
  });

  it("names a group from the declared-type map when its launch was cut from this array", () => {
    const types = new Map([["oracle-1", "asm-oracle"]]);
    const merged = mergeCursorSubagentInvocations([{ ...continuation("Answer"), childAgentId: "oracle-1" }], types);
    expect(subagent(merged[0] as VaultActivityStep)).toMatchObject({ name: "asm-oracle", title: "Follow-up" });
    expect(subagent(merged[0] as VaultActivityStep)).not.toHaveProperty("continuation");
  });

  it("takes the declared type even when the launch call is not the first invocation", () => {
    const merged = mergeCursorSubagentInvocations([
      { ...continuation("Answer 1"), childAgentId: "oracle-1" },
      { ...launch(), childAgentId: "oracle-1" },
    ]);
    expect(merged).toHaveLength(2);
    expect(subagent(merged[0] as VaultActivityStep)).toMatchObject({ name: "asm-oracle", title: "Follow-up" });
  });

  it("keeps the invoking tool name off the agent chip when nothing declared a type", () => {
    const merged = mergeCursorSubagentInvocations([
      { ...continuation("Answer 1"), childAgentId: "oracle-1" },
      { ...continuation("Answer 2"), childAgentId: "oracle-1" },
    ]);
    expect(merged.every((step) => !isCursorDeclaredAgentType(subagent(step as VaultActivityStep).name))).toBe(true);
  });

  it("is idempotent, so merging one array twice changes nothing", () => {
    const items = [
      { ...launch(), childAgentId: "oracle-1" },
      { ...continuation("Answer 1"), childAgentId: "oracle-1" },
      { ...continuation("Answer 2"), childAgentId: "oracle-1" },
    ];
    const once = mergeCursorSubagentInvocations(items);
    expect(mergeCursorSubagentInvocations(once)).toEqual(once);
  });

  it("does not mutate the caller's steps, so a sibling array keeps its own view", () => {
    const shared = { ...continuation("Answer"), childAgentId: "oracle-1" };
    mergeCursorSubagentInvocations([{ ...launch(), childAgentId: "oracle-1" }, shared]);
    expect(shared).not.toHaveProperty("continuation");
    expect(shared.name).toBe("Task");
  });

  it("leaves invocations without an agent identity, or with different ones, untouched", () => {
    const items = [
      { ...launch(), childAgentId: "oracle-1" },
      { ...launch(), childAgentId: "oracle-2" },
      launch(),
      launch(),
    ];
    expect(mergeCursorSubagentInvocations(items)).toEqual(items);
  });

  it("does not fabricate a result or status for an agent that reported neither", () => {
    const merged = mergeCursorSubagentInvocations([
      { ...launch(), childAgentId: "oracle-1" },
      { kind: "subagent" as const, name: "Task", childAgentId: "oracle-1" },
    ]);
    expect(subagent(merged[0] as VaultActivityStep)).not.toHaveProperty("result");
    expect(subagent(merged[1] as VaultActivityStep)).not.toHaveProperty("result");
  });
});

describe("collectCursorAgentTypes", () => {
  const launch = { kind: "subagent" as const, name: "asm-oracle", childAgentId: "oracle-1" };
  const continuation = { kind: "subagent" as const, name: "Task", childAgentId: "oracle-1" };

  it("recovers a declared type from a sibling array the display window did not cut", () => {
    expect(collectCursorAgentTypes([continuation], [launch])).toEqual(new Map([["oracle-1", "asm-oracle"]]));
  });

  it("records nothing for an agent no decoded invocation declared", () => {
    expect(collectCursorAgentTypes([continuation]).size).toBe(0);
  });

  it("keeps the first declared type when a later invocation redeclares one", () => {
    const second = { kind: "subagent" as const, name: "asm-finder", childAgentId: "oracle-1" };
    expect(collectCursorAgentTypes([launch, second]).get("oracle-1")).toBe("asm-oracle");
  });
});
