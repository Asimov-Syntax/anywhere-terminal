// src/extension.worktreeDelegations.test.ts — the reader the worktree host is
// wired with. The bound it asks for is load-bearing: the roster's claim that an
// omission is permanent (design.md D5) is only true when there is no larger
// limit left to ask for.
//
// See: asimov/changes/surface-subagent-history-rows/design.md D5, D6.

import { describe, expect, it, vi } from "vitest";
import { createDelegationReader } from "./extension";
import { MAX_DETAIL_LIMIT } from "./vault/readers/detail";
import type { VaultSessionDetail } from "./vault/types";

function detail(over: Partial<VaultSessionDetail> = {}): VaultSessionDetail {
  return {
    entryId: "claude:s1",
    agent: "claude",
    sessionId: "s1",
    title: "A session",
    timeline: [],
    stats: { messageCount: 0, toolCallCount: 0, subagentCount: 0 },
    ...over,
  } as VaultSessionDetail;
}

describe("the wired delegation reader", () => {
  it("asks for the whole transcript, not a page of it", async () => {
    const getDetail = vi.fn(async () => detail());
    await createDelegationReader({ getDetail })("claude:s1");
    expect(getDetail).toHaveBeenCalledWith("claude:s1", MAX_DETAIL_LIMIT);
  });

  it("maps a transcript it got into that session's roster", async () => {
    const getDetail = vi.fn(async () =>
      detail({
        timeline: [{ kind: "subagent", name: "librarian", status: "completed" }],
        stats: { messageCount: 1, toolCallCount: 1, subagentCount: 1 },
      } as unknown as Partial<VaultSessionDetail>),
    );
    await expect(createDelegationReader({ getDetail })("claude:s1")).resolves.toEqual({
      kind: "ok",
      rows: [{ name: "librarian", status: "completed", live: false }],
    });
  });

  it("reports a session with no transcript as a failed read, never as one that delegated nothing", async () => {
    const getDetail = vi.fn(async () => null);
    const roster = await createDelegationReader({ getDetail })("claude:gone");
    expect(roster.kind).toBe("failed");
  });
});
