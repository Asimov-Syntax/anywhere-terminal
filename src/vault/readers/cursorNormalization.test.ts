// src/vault/readers/cursorNormalization.test.ts — Unit tests for the shared
// Cursor record classifier: agent identity on an invocation, and the
// one-card-per-agent merge both readers apply (integrate-cursor-agent D11).

import { describe, expect, it } from "vitest";
import type { VaultActivityStep } from "../types";
import { mergeCursorSubagentInvocations, normalizeCursorRecord } from "./cursorNormalization";

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

  it("collapses continuations onto the launch call, keeping its declared type and position", () => {
    const items = [
      { kind: "message" as const, role: "user" as const, text: "go" },
      { ...launch(), childAgentId: "oracle-1", status: "running" as const },
      { kind: "tool" as const, tool: "Read" },
      { ...continuation("Answer 1"), childAgentId: "oracle-1" },
      { ...continuation("Answer 2"), childAgentId: "oracle-1" },
    ];

    const merged = mergeCursorSubagentInvocations(items);
    expect(merged.map((item) => item.kind)).toEqual(["message", "subagent", "tool"]);
    expect(subagent(merged[1] as VaultActivityStep)).toEqual({
      kind: "subagent",
      name: "asm-oracle",
      title: "Launch",
      prompt: "Stand by",
      childAgentId: "oracle-1",
      result: "Answer 2",
      status: "completed",
    });
  });

  it("takes the declared type even when the launch call is not the first invocation", () => {
    const merged = mergeCursorSubagentInvocations([
      { ...continuation("Answer 1"), childAgentId: "oracle-1" },
      { ...launch(), childAgentId: "oracle-1" },
    ]);
    expect(merged).toHaveLength(1);
    expect(subagent(merged[0] as VaultActivityStep)).toMatchObject({ name: "asm-oracle", title: "Launch" });
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
    expect(merged).toHaveLength(1);
    expect(subagent(merged[0] as VaultActivityStep)).not.toHaveProperty("result");
    expect(subagent(merged[0] as VaultActivityStep)).not.toHaveProperty("status");
  });
});
