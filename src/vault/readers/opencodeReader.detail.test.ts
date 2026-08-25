// src/vault/readers/opencodeReader.detail.test.ts — OpenCode detail mapping (redesign-vault-panel-ui 2_3).

import { describe, expect, it, vi } from "vitest";
import type { SqliteResult, SqliteSnapshot, withSqliteSnapshot } from "../sqlite";
import type { VaultTimelineItem } from "../types";
import {
  mapOpencodeRows,
  type OcMessageRow,
  type OcPartRow,
  readOpenCodeDetail,
  readOpenCodeMessageRecord,
  splitOpencodeSubtaskTitle,
} from "./opencodeReader";
import { MAX_RECORD_BYTES } from "./recordLine";

/** Wrap a `readSqlite`-shaped mock as the one-copy snapshot seam the detail read
 *  now uses, so each test keeps its own query mock and the shared-snapshot
 *  guarantee is what changed rather than every fixture. */
function snapshotOf(query: (db: string, sql: string) => Promise<SqliteResult>) {
  return (async (dbPath: string, callback: (snapshot: SqliteSnapshot) => Promise<unknown>) => ({
    status: "ok" as const,
    value: await callback({ query: (sql: string) => query(dbPath, sql) }),
  })) as unknown as typeof withSqliteSnapshot;
}

function msg(
  id: string,
  role: "user" | "assistant",
  timeCreated: number,
  extra: Record<string, unknown> = {},
): OcMessageRow {
  return { id, timeCreated, data: { role, ...extra } };
}

function textPart(messageId: string, t: number, text: string, synthetic = false): OcPartRow {
  const data: Record<string, unknown> = { type: "text", text };
  if (synthetic) {
    data.synthetic = true;
  }
  return { messageId, timeCreated: t, data };
}

function toolPart(
  messageId: string,
  t: number,
  tool: string,
  input: Record<string, unknown>,
  metadata?: unknown,
): OcPartRow {
  return { messageId, timeCreated: t, data: { type: "tool", callID: `c${t}`, tool, state: { input, metadata } } };
}

function subtaskPart(messageId: string, t: number, agent: string, prompt: string): OcPartRow {
  return { messageId, timeCreated: t, data: { type: "subtask", agent, prompt, description: prompt } };
}

/** Mock readSqlite for readOpenCodeDetail: one parent message + part, plus one
 *  child session row carrying the given `title`/`agent`/`first_user_part`. */
function childDetailMock(child: Record<string, unknown>) {
  return vi.fn(async (_db: string, sql: string): Promise<SqliteResult> => {
    // Route the omission probe FIRST: this fixture is a complete session, so no
    // row exists past the retained window. Falling through to the table branches
    // would answer the probe with a transcript row and fake an omission.
    if (sql.includes("OFFSET")) {
      return { status: "ok", rows: [] };
    }
    if (!sql.includes("parent_id") && sql.includes("FROM message")) {
      return { status: "ok", rows: [{ id: "m1", time_created: 1, data: JSON.stringify({ role: "user" }) }] };
    }
    if (!sql.includes("parent_id") && sql.includes("FROM part")) {
      return {
        status: "ok",
        rows: [
          {
            id: "p1",
            message_id: "m1",
            time_created: 1,
            data: JSON.stringify({ type: "text", text: "parent prompt" }),
          },
        ],
      };
    }
    return { status: "ok", rows: [{ time_created: 2, ...child }] };
  });
}

describe("mapOpencodeRows", () => {
  it("derives first prompt, tool/subtask steps, latest message, and exact token sum", () => {
    const messages: OcMessageRow[] = [
      msg("m1", "user", 1),
      msg("m2", "assistant", 2, { tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 0 } } }),
      msg("m3", "assistant", 3),
    ];
    const parts: OcPartRow[] = [
      textPart("m1", 1, "make it faster"),
      toolPart("m2", 2, "read", { filePath: "/src/a.ts" }),
      toolPart("m2", 2.5, "bash", { command: "npm test" }),
      subtaskPart("m2", 2.7, "general", "go check the thing"),
      textPart("m3", 3, "done, look here"),
    ];

    const out = mapOpencodeRows(messages, parts);
    expect(out.firstPrompt).toBe("make it faster");
    expect(out.recentActivity).toEqual([
      { kind: "tool", tool: "Read", detail: "/src/a.ts", diff: undefined },
      { kind: "tool", tool: "Bash", detail: "npm test", diff: undefined },
      { kind: "subagent", name: "general", prompt: "go check the thing" },
    ]);
    expect(out.latestMessage).toMatchObject({ role: "assistant", text: "done, look here", timestamp: 3 });
    expect(out.stats).toMatchObject({ messageCount: 3, toolCount: 2, subagentCount: 1, tokenCount: 135 });
  });

  // improve-vault-transcript-messages 3_1 — the message row id is the locator.
  it("stamps the message row id on each message", () => {
    const messages: OcMessageRow[] = [msg("m1", "user", 1), msg("m2", "assistant", 2)];
    const parts: OcPartRow[] = [textPart("m1", 1, "make it faster"), textPart("m2", 2, "done")];
    const out = mapOpencodeRows(messages, parts);
    expect(
      out.timeline.filter((t) => t.kind === "message").map((t) => (t.kind === "message" ? t.msgRef : null)),
    ).toEqual(["m1", "m2"]);
  });

  it("attaches per-message model + tokens to assistant messages, not user ones", () => {
    const messages: OcMessageRow[] = [
      msg("m1", "user", 1),
      msg("m2", "assistant", 2, {
        providerID: "anthropic",
        modelID: "claude-opus-4-8",
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 0 } },
      }),
    ];
    const parts: OcPartRow[] = [textPart("m1", 1, "hi"), textPart("m2", 2, "hello")];
    const out = mapOpencodeRows(messages, parts);
    const assistant = out.timeline.find((t) => t.kind === "message" && t.role === "assistant");
    if (assistant?.kind === "message") {
      expect(assistant.model).toBe("anthropic/claude-opus-4-8");
      // input = input + cache.read + cache.write = 100 + 10 + 0 = 110;
      // output = output + reasoning = 20 + 5 = 25 (reasoning folded in, matching Claude/Codex)
      expect(assistant.tokens).toEqual({ input: 110, output: 25 });
    }
    const user = out.timeline.find((t) => t.kind === "message" && t.role === "user");
    if (user?.kind === "message") {
      expect(user.model).toBeUndefined();
      expect(user.tokens).toBeUndefined();
    }
  });

  it("excludes synthetic text parts and summary messages from first/latest + count", () => {
    const messages: OcMessageRow[] = [
      msg("s0", "user", 1, { summary: true }), // compaction message — excluded
      msg("m1", "user", 2),
      msg("m2", "assistant", 3),
    ];
    const parts: OcPartRow[] = [
      textPart("s0", 1, "SYNTHETIC SUMMARY", true),
      textPart("m1", 2, "the real prompt"),
      textPart("m2", 3, "the real reply"),
    ];
    const out = mapOpencodeRows(messages, parts);
    expect(out.firstPrompt).toBe("the real prompt");
    expect(out.latestMessage).toMatchObject({ role: "assistant", text: "the real reply" });
    expect(out.stats.messageCount).toBe(2); // summary message not counted
  });

  it("does not count textless user rows or unknown-role rows (W7)", () => {
    const messages: OcMessageRow[] = [
      msg("m1", "user", 1), // real user turn (has text)
      msg("m2", "user", 2), // tool-result-only user row (no text) — not a turn
      msg("m3", "assistant", 3), // tool-only assistant turn (no text) — still a turn
      { id: "m4", timeCreated: 4, data: { role: "tool" } }, // unknown role — skipped
    ];
    const parts: OcPartRow[] = [
      textPart("m1", 1, "the only real prompt"),
      toolPart("m3", 3, "read", { filePath: "/a.ts" }),
    ];
    const out = mapOpencodeRows(messages, parts);
    // 1 user (with text) + 1 assistant (tool-only) = 2; the textless user and the
    // unknown-role row are excluded.
    expect(out.stats.messageCount).toBe(2);
    expect(out.firstPrompt).toBe("the only real prompt");
  });

  it("computes a cheap diff stat for an edit tool from its unified-diff metadata", () => {
    const messages: OcMessageRow[] = [msg("m1", "user", 1), msg("m2", "assistant", 2)];
    const parts: OcPartRow[] = [
      textPart("m1", 1, "edit it"),
      toolPart(
        "m2",
        2,
        "edit",
        { filePath: "/a.ts" },
        {
          diff: "--- a/a.ts\n+++ b/a.ts\n+added one\n+added two\n-removed one",
        },
      ),
    ];
    const out = mapOpencodeRows(messages, parts);
    expect(out.recentActivity[0]).toEqual({
      kind: "tool",
      tool: "Edit",
      detail: "/a.ts",
      diff: { added: 2, removed: 1 },
    });
  });

  it("maps an AskUserQuestion tool into a question item (answered + pending) with options", () => {
    const messages: OcMessageRow[] = [msg("m1", "user", 1), msg("m2", "assistant", 2)];
    const parts: OcPartRow[] = [
      textPart("m1", 1, "plan it"),
      // Answered: the user's pick lives in state.metadata.answers (array per question).
      toolPart(
        "m2",
        2,
        "question",
        {
          questions: [
            {
              question: "Which direction?",
              header: "Gate 1",
              options: [
                { label: "Built-in (Recommended)", description: "use the built-in provider" },
                { label: "Custom wrapper", description: "more control, more risk" },
              ],
            },
          ],
        },
        { answers: [["Built-in (Recommended)"]] },
      ),
      // Pending: no answers recorded → no `answer` field → renders "Awaiting answer".
      toolPart("m2", 3, "question", { questions: [{ question: "Run review now?", options: [] }] }),
    ];
    const out = mapOpencodeRows(messages, parts);
    const questions = out.timeline.filter(
      (t): t is Extract<VaultTimelineItem, { kind: "question" }> => t.kind === "question",
    );
    expect(questions).toHaveLength(2);
    expect(questions[0].questions).toEqual([
      {
        prompt: "Which direction?",
        answer: "Built-in (Recommended)",
        options: [
          { label: "Built-in (Recommended)", description: "use the built-in provider", chosen: true },
          { label: "Custom wrapper", description: "more control, more risk" },
        ],
      },
    ]);
    expect(questions[1].questions).toEqual([{ prompt: "Run review now?" }]);
    // The question is NOT also emitted as a bare "Question" tool chip, and is not
    // counted as a subagent — but still counts as a tool call.
    expect(out.timeline.some((t) => t.kind === "tool" && t.tool === "Question")).toBe(false);
    expect(out.stats.toolCount).toBe(2);
  });

  it("joins multi-select answers and falls back to the header when a question text is absent", () => {
    const messages: OcMessageRow[] = [msg("m1", "user", 1), msg("m2", "assistant", 2)];
    const parts: OcPartRow[] = [
      textPart("m1", 1, "go"),
      toolPart("m2", 2, "question", { questions: [{ header: "Pick features" }] }, { answers: [["A", "B"]] }),
    ];
    const out = mapOpencodeRows(messages, parts);
    const q = out.timeline.find((t) => t.kind === "question");
    expect(q?.kind === "question" && q.questions).toEqual([{ prompt: "Pick features", answer: "A, B" }]);
  });

  it("falls back to a generic tool chip when a question tool has no parseable questions", () => {
    const messages: OcMessageRow[] = [msg("m1", "user", 1), msg("m2", "assistant", 2)];
    const parts: OcPartRow[] = [textPart("m1", 1, "go"), toolPart("m2", 2, "question", {})];
    const out = mapOpencodeRows(messages, parts);
    expect(out.timeline.some((t) => t.kind === "question")).toBe(false);
    expect(out.timeline.some((t) => t.kind === "tool" && t.tool === "Question")).toBe(true);
  });

  it("does not render an errored (rejected/aborted) question as 'Awaiting answer'", () => {
    const messages: OcMessageRow[] = [msg("m1", "user", 1), msg("m2", "assistant", 2)];
    // An aborted question keeps parseable input but status:"error" — it must NOT
    // surface as a pending question item; it falls back to a generic tool chip.
    const errored: OcPartRow = {
      messageId: "m2",
      timeCreated: 2,
      data: {
        type: "tool",
        tool: "question",
        state: { status: "error", error: "Tool execution aborted", input: { questions: [{ question: "Proceed?" }] } },
      },
    };
    const out = mapOpencodeRows([...messages], [textPart("m1", 1, "go"), errored]);
    expect(out.timeline.some((t) => t.kind === "question")).toBe(false);
    expect(out.timeline.some((t) => t.kind === "tool" && t.tool === "Question")).toBe(true);
  });

  it("omits tokenCount when no assistant tokens are present", () => {
    const out = mapOpencodeRows([msg("m1", "user", 1), msg("m2", "assistant", 2)], [textPart("m1", 1, "hi")]);
    expect(out.stats.tokenCount).toBeUndefined();
  });

  it("interleaves child sub-session stubs into the timeline by timestamp", () => {
    const messages: OcMessageRow[] = [msg("m1", "user", 1), msg("m2", "assistant", 5)];
    const parts: OcPartRow[] = [textPart("m1", 1, "do the work"), textPart("m2", 5, "all done")];
    const childStubs: { timestamp: number; item: VaultTimelineItem }[] = [
      {
        timestamp: 3,
        item: {
          kind: "subagentSession",
          entryId: "opencode:ses_child",
          title: "Review (@reviewer subagent)",
          timestamp: 3,
        },
      },
    ];
    const out = mapOpencodeRows(messages, parts, undefined, childStubs);
    // user(1) → subagentSession(3) → assistant(5)
    expect(out.timeline.map((i) => i.kind)).toEqual(["message", "subagentSession", "message"]);
    const sub = out.timeline[1];
    expect(sub.kind === "subagentSession" && sub.entryId).toBe("opencode:ses_child");
    expect(out.stats.subagentCount).toBe(1); // counts children, not subtask parts
  });
});

describe("readOpenCodeDetail child sub-sessions", () => {
  it("queries direct children by parent_id and embeds them as subagentSession stubs", async () => {
    const readSqliteFn = vi.fn(async (_db: string, sql: string): Promise<SqliteResult> => {
      // Probes FIRST: a complete fixture has nothing past its window, and falling
      // through would answer the probe with a transcript row and fake an omission.
      if (sql.includes("OFFSET")) {
        return { status: "ok", rows: [] };
      }
      // Then children — its first-user-message subquery also contains "FROM part",
      // so it must not be misrouted to the parts branch.
      if (!sql.includes("parent_id") && sql.includes("FROM message")) {
        return { status: "ok", rows: [{ id: "m1", time_created: 1, data: JSON.stringify({ role: "user" }) }] };
      }
      if (!sql.includes("parent_id") && sql.includes("FROM part")) {
        return {
          status: "ok",
          rows: [
            {
              id: "p1",
              message_id: "m1",
              time_created: 1,
              data: JSON.stringify({ type: "text", text: "parent prompt" }),
            },
          ],
        };
      }
      // children query (WHERE s.parent_id = ...)
      return {
        status: "ok",
        rows: [
          {
            id: "ses_kid",
            title: "New session - 2026-05-01T00:00:00Z", // placeholder → falls back to first message
            agent: "reviewer",
            time_created: 2,
            first_user_part: JSON.stringify({ type: "text", text: "go review the diff" }),
          },
        ],
      };
    });

    const detail = await readOpenCodeDetail(
      "ses_parent",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail).not.toBeNull();
    // 2 message windows (head ASC + tail DESC) + 2 part windows + 1 children
    // query + 1 omission probe per table.
    expect(readSqliteFn).toHaveBeenCalledTimes(7);
    expect(detail?.partial).toBeFalsy(); // complete fixture must prove it stays complete
    const childSql = readSqliteFn.mock.calls.find((c) => c[1].includes("parent_id"))?.[1] ?? "";
    expect(childSql).toContain("WHERE s.parent_id = 'ses_parent'");
    const stub = detail?.timeline.find((i) => i.kind === "subagentSession");
    expect(stub).toBeDefined();
    if (stub?.kind === "subagentSession") {
      expect(stub.entryId).toBe("opencode:ses_kid");
      expect(stub.title).toBe("go review the diff"); // placeholder title → first message
      expect(stub.agent).toBe("reviewer");
    }
  });

  it("still returns the parent detail when the child query fails", async () => {
    const readSqliteFn = vi.fn(async (_db: string, sql: string): Promise<SqliteResult> => {
      if (sql.includes("OFFSET")) {
        return { status: "ok", rows: [] }; // complete session: nothing past the window
      }
      if (sql.includes("FROM message")) {
        return { status: "ok", rows: [{ id: "m1", time_created: 1, data: JSON.stringify({ role: "user" }) }] };
      }
      if (sql.includes("FROM part") && !sql.includes("parent_id")) {
        return {
          status: "ok",
          rows: [{ id: "p1", message_id: "m1", time_created: 1, data: JSON.stringify({ type: "text", text: "hi" }) }],
        };
      }
      return { status: "query-error", rows: [] }; // children query fails → degrade
    });
    const detail = await readOpenCodeDetail(
      "ses_parent",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail).not.toBeNull();
    expect(detail?.partial).toBeFalsy(); // a failed CHILD query is not source omission
    expect(detail?.timeline.some((i) => i.kind === "subagentSession")).toBe(false);
  });

  it("strips OpenCode's `(@<agent> subagent)` title suffix so the @agent chip is not duplicated", async () => {
    const readSqliteFn = childDetailMock({
      id: "ses_kid",
      title: "Review logic architecture (@asm-review-logic subagent)",
      agent: "asm-review-logic",
      first_user_part: JSON.stringify({ type: "text", text: "review the logic" }),
    });
    const detail = await readOpenCodeDetail(
      "ses_parent",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    const stub = detail?.timeline.find((i) => i.kind === "subagentSession");
    expect(stub?.kind === "subagentSession" && stub.title).toBe("Review logic architecture");
    expect(stub?.kind === "subagentSession" && stub.agent).toBe("asm-review-logic");
  });

  it("recovers the agent from the title suffix when the `agent` column is empty", async () => {
    const readSqliteFn = childDetailMock({
      id: "ses_kid",
      title: "Extract change knowledge (@asm-knowledge-extract subagent)",
      agent: "", // OpenCode leaves the column empty for some nested spawns
      first_user_part: JSON.stringify({ type: "text", text: "extract it" }),
    });
    const detail = await readOpenCodeDetail(
      "ses_parent",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    const stub = detail?.timeline.find((i) => i.kind === "subagentSession");
    expect(stub?.kind === "subagentSession" && stub.title).toBe("Extract change knowledge");
    expect(stub?.kind === "subagentSession" && stub.agent).toBe("asm-knowledge-extract");
  });

  it("falls back to the first message for a bare-suffix title while still recovering the agent", async () => {
    const readSqliteFn = childDetailMock({
      id: "ses_kid",
      title: "(@general subagent)", // empty description → bare suffix
      agent: "",
      first_user_part: JSON.stringify({ type: "text", text: "do the thing" }),
    });
    const detail = await readOpenCodeDetail(
      "ses_parent",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    const stub = detail?.timeline.find((i) => i.kind === "subagentSession");
    expect(stub?.kind === "subagentSession" && stub.title).toBe("do the thing");
    expect(stub?.kind === "subagentSession" && stub.agent).toBe("general");
  });

  it("uses the first message for a placeholder title carrying a suffix, still recovering the agent", async () => {
    const readSqliteFn = childDetailMock({
      id: "ses_kid",
      title: "New session - 2026-05-01T00:00:00Z (@asm-finder subagent)",
      agent: "",
      first_user_part: JSON.stringify({ type: "text", text: "find the code" }),
    });
    const detail = await readOpenCodeDetail(
      "ses_parent",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    const stub = detail?.timeline.find((i) => i.kind === "subagentSession");
    expect(stub?.kind === "subagentSession" && stub.title).toBe("find the code");
    expect(stub?.kind === "subagentSession" && stub.agent).toBe("asm-finder");
  });
});

describe("readOpenCodeDetail head+tail windowing", () => {
  const limitOf = (sql: string): number => Number(sql.match(/LIMIT (\d+)/)?.[1] ?? 0);

  // A long session whose first user message exists only in the head (ASC) window
  // and whose final assistant reply exists only in the tail (DESC) window, with
  // disjoint ids so nothing collapses on de-dup. `messageTotal`/`partTotal` are
  // the source's TRUE row counts, independent of what the windows retained —
  // that independence is what makes omission provable rather than inferred.
  const longSessionSqlite = (messageTotal: number, partTotal: number) =>
    vi.fn(async (_db: string, sql: string): Promise<SqliteResult> => {
      if (sql.includes("parent_id")) {
        return { status: "ok", rows: [] }; // no children
      }
      // The omission probe: one row exists past the retained capacity only when
      // the source's true total exceeds it.
      const offset = Number(sql.match(/OFFSET (\d+)/)?.[1] ?? Number.NaN);
      if (Number.isFinite(offset)) {
        const total = sql.includes("FROM message") ? messageTotal : partTotal;
        return { status: "ok", rows: total > offset ? [{ id: "probe" }] : [] };
      }
      const n = limitOf(sql);
      if (sql.includes("FROM message")) {
        if (sql.includes("DESC")) {
          // tail (most-recent first): row 0 is the final reply (global max time)
          const rows = Array.from({ length: n }, (_v, i) => ({
            id: i === 0 ? "mt_final" : `mtf${i}`,
            time_created: i === 0 ? 9_999_999 : 1_000_000 + (n - i),
            data: JSON.stringify({ role: "assistant" }),
          }));
          return { status: "ok", rows };
        }
        // head: row 0 is the first user turn, rest filler
        const rows = Array.from({ length: n }, (_v, i) => ({
          id: i === 0 ? "mh_first" : `mhf${i}`,
          time_created: i,
          data: JSON.stringify({ role: i === 0 ? "user" : "assistant" }),
        }));
        return { status: "ok", rows };
      }
      // FROM part — text lives only on the first-user and final-assistant messages
      if (sql.includes("DESC")) {
        const rows = Array.from({ length: n }, (_v, i) => ({
          id: i === 0 ? "pt_final" : `ptf${i}`,
          message_id: i === 0 ? "mt_final" : `mtf${i}`,
          time_created: i === 0 ? 9_999_999 : 2_000_000 + (n - i),
          data: JSON.stringify({ type: "text", text: i === 0 ? "the final AI reply" : "" }),
        }));
        return { status: "ok", rows };
      }
      const rows = Array.from({ length: n }, (_v, i) => ({
        id: i === 0 ? "ph_first" : `phf${i}`,
        message_id: i === 0 ? "mh_first" : `mhf${i}`,
        time_created: i,
        data: JSON.stringify({ type: "text", text: i === 0 ? "first user prompt" : "" }),
      }));
      return { status: "ok", rows };
    });

  // The retained union at saturation: both message windows full and disjoint
  // (100 + 2000), both part windows full and disjoint (1000 + 4000).
  const RETAINED_MESSAGES = 2100;
  const RETAINED_PARTS = 5000;

  it("keeps the final assistant message from a long session (tail) AND the first prompt (head)", async () => {
    const readSqliteFn = longSessionSqlite(RETAINED_MESSAGES + 400, RETAINED_PARTS + 400);

    const detail = await readOpenCodeDetail(
      "ses_long",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail).not.toBeNull();
    expect(detail?.firstPrompt).toBe("first user prompt");
    expect(detail?.latestMessage).toMatchObject({ role: "assistant", text: "the final AI reply" });
    const last = detail?.timeline.at(-1);
    expect(last?.kind === "message" && last.role).toBe("assistant");
    expect(last?.kind === "message" && last.text).toContain("the final AI reply");
    // More source rows exist than the windows retained, so the middle is gone and
    // no larger limit brings it back — `partial`, with nothing left to page.
    expect(detail?.timeline.some((item) => item.kind === "gap")).toBe(true);
    expect(detail?.partial).toBe(true);
    expect(detail?.limitedReason?.length).toBeGreaterThan(0);
    expect(detail?.truncated).not.toBe(true);

    // Same source read, a limit below what it retained: now older retained items
    // ARE pageable, so both signals hold at once.
    const paged = await readOpenCodeDetail(
      "ses_long",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      1,
    );
    expect(paged?.timeline).toHaveLength(1);
    expect(paged?.partial).toBe(true);
    expect(paged?.truncated).toBe(true);
  });

  // The boundary the non-overlap heuristic got wrong (review round 1, B1): both
  // windows full and disjoint, yet their union IS every source row. Saturation is
  // not omission, so this session must not be marked partial.
  it("does not report partial when full disjoint windows still cover every source row", async () => {
    const readSqliteFn = longSessionSqlite(RETAINED_MESSAGES, RETAINED_PARTS);

    const detail = await readOpenCodeDetail(
      "ses_long",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail).not.toBeNull();
    expect(detail?.partial).toBeFalsy();
    expect(detail?.limitedReason).toBeUndefined();
    expect(detail?.timeline.some((item) => item.kind === "gap")).toBe(false);
  });

  it("reports partial when the source exceeds the retained union by a single row", async () => {
    const readSqliteFn = longSessionSqlite(RETAINED_MESSAGES + 1, RETAINED_PARTS);

    const detail = await readOpenCodeDetail(
      "ses_long",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail?.partial).toBe(true);
    expect(detail?.limitedReason?.length).toBeGreaterThan(0);
  });

  // `partial` is contracted as source omission and nothing else, so a read that
  // could not prove either answer has no honest value to return — it fails like
  // every other failed query in this reader rather than guessing (round 3 B2).
  it("fails the read rather than guessing when the probe query fails", async () => {
    const base = longSessionSqlite(RETAINED_MESSAGES, RETAINED_PARTS);
    const readSqliteFn = vi.fn(
      async (db: string, sql: string): Promise<SqliteResult> =>
        sql.includes("OFFSET") ? { status: "query-error", rows: [], error: "no such table" } : base(db, sql),
    );

    const detail = await readOpenCodeDetail(
      "ses_long",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail).toBeNull();
  });

  // Round 2 S1: message overflow short-circuits the `||`, so the part branch only
  // proves itself with messages sitting exactly at capacity.
  it("reports partial when only the part table overflows", async () => {
    const readSqliteFn = longSessionSqlite(RETAINED_MESSAGES, RETAINED_PARTS + 1);

    const detail = await readOpenCodeDetail(
      "ses_long",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail?.partial).toBe(true);
    expect(detail?.limitedReason?.length).toBeGreaterThan(0);
  });

  it("de-duplicates the overlapping head/tail windows on a short session (no double-count)", async () => {
    // Short session: the head (ASC) and tail (DESC) windows return the SAME rows.
    const sameRows = (sql: string): SqliteResult => {
      if (sql.includes("FROM message")) {
        return {
          status: "ok",
          rows: [
            { id: "m1", time_created: 1, data: JSON.stringify({ role: "user" }) },
            { id: "m2", time_created: 2, data: JSON.stringify({ role: "assistant" }) },
          ],
        };
      }
      return {
        status: "ok",
        rows: [
          { id: "p1", message_id: "m1", time_created: 1, data: JSON.stringify({ type: "text", text: "hello" }) },
          { id: "p2", message_id: "m2", time_created: 2, data: JSON.stringify({ type: "text", text: "hi there" }) },
        ],
      };
    };
    const readSqliteFn = vi.fn(async (_db: string, sql: string): Promise<SqliteResult> => {
      if (sql.includes("parent_id") || sql.includes("OFFSET")) {
        return { status: "ok", rows: [] }; // no children, and nothing past the window
      }
      return sameRows(sql);
    });

    const detail = await readOpenCodeDetail(
      "ses_short",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail).not.toBeNull();
    expect(detail?.firstPrompt).toBe("hello");
    expect(detail?.latestMessage).toMatchObject({ role: "assistant", text: "hi there" });
    expect(detail?.stats.messageCount).toBe(2); // not 4 — windows de-duplicated by id
    expect(detail?.timeline.filter((i) => i.kind === "message")).toHaveLength(2);
    expect(detail?.truncated).toBeFalsy();
    // A complete fixture must PROVE it stays complete — the probe silently
    // answering with transcript rows is what made this pass while lying (S1).
    expect(detail?.partial).toBeFalsy();
  });

  // Round 3 B1: `time_created` is not a total order. With every row sharing one
  // timestamp the windows must still be complementary, or they overlap while both
  // miss rows and the capacity probe reports a truncated read as complete.
  it("keeps head and tail complementary when every row shares a timestamp", async () => {
    const ids = Array.from({ length: 12 }, (_v, i) => `p${String(i).padStart(2, "0")}`);
    const readSqliteFn = vi.fn(async (_db: string, sql: string): Promise<SqliteResult> => {
      if (sql.includes("parent_id")) {
        return { status: "ok", rows: [] };
      }
      if (sql.includes("OFFSET")) {
        return { status: "ok", rows: [] }; // exactly at capacity, nothing beyond
      }
      if (sql.includes("FROM message")) {
        return { status: "ok", rows: [{ id: "m1", time_created: 7, data: JSON.stringify({ role: "user" }) }] };
      }
      // Every part shares time_created; only the id tie-break orders them, so an
      // ASC window and a DESC window must select opposite ends and never collide.
      const asc = sql.includes("ASC");
      const ordered = asc ? ids : [...ids].reverse();
      return {
        status: "ok",
        rows: ordered.slice(0, 6).map((id) => ({
          id,
          message_id: "m1",
          time_created: 7,
          data: JSON.stringify({ type: "text", text: id }),
        })),
      };
    });

    const detail = await readOpenCodeDetail(
      "ses_tied",
      { dataDir: "/x/oc", withSqliteSnapshotFn: snapshotOf(readSqliteFn) },
      undefined,
    );
    expect(detail).not.toBeNull();
    const ascSql = readSqliteFn.mock.calls.map((c) => c[1]).find((q) => q.includes("FROM part") && q.includes("ASC"));
    const descSql = readSqliteFn.mock.calls.map((c) => c[1]).find((q) => q.includes("FROM part") && q.includes("DESC"));
    expect(ascSql).toContain("ORDER BY time_created ASC, id ASC");
    expect(descSql).toContain("ORDER BY time_created DESC, id DESC");
    // Complementary windows: 6 + 6 disjoint ids cover all 12 rows, nothing dropped.
    expect(detail?.timeline.filter((i) => i.kind === "message")).toHaveLength(1);
    expect(detail?.partial).toBeFalsy();
  });
});

describe("splitOpencodeSubtaskTitle", () => {
  it("splits the `<description> (@<agent> subagent)` form into description + agent", () => {
    expect(splitOpencodeSubtaskTitle("Review logic architecture (@asm-review-logic subagent)")).toEqual({
      title: "Review logic architecture",
      agent: "asm-review-logic",
    });
  });

  it("returns the title untouched (no agent) when there is no subagent suffix", () => {
    expect(splitOpencodeSubtaskTitle("Just a normal title")).toEqual({ title: "Just a normal title" });
  });

  it("recovers agent names that contain characters outside `[\\w.-]` (slashes, spaces)", () => {
    // OpenCode interpolates the raw subagent_type, which has no character limit.
    expect(splitOpencodeSubtaskTitle("Audit auth (@review/logic subagent)")).toEqual({
      title: "Audit auth",
      agent: "review/logic",
    });
    expect(splitOpencodeSubtaskTitle("Audit auth (@review logic subagent)")).toEqual({
      title: "Audit auth",
      agent: "review logic",
    });
  });

  it("does not mis-split a description that itself contains an earlier `(@…)`", () => {
    // Only the trailing ` (@… subagent)` is the suffix; the inner `(@foo)` stays.
    expect(splitOpencodeSubtaskTitle("Fix (@foo) bug (@bar subagent)")).toEqual({
      title: "Fix (@foo) bug",
      agent: "bar",
    });
  });

  it("recovers the agent even when the description is empty (bare suffix)", () => {
    // Empty description → blank title (caller falls back to the first message),
    // but the agent is still recovered so the @chip renders.
    expect(splitOpencodeSubtaskTitle("(@general subagent)")).toEqual({ title: "", agent: "general" });
  });
});

// .reviews/round-1.md L2, L3 — the resolver borrowed the preview's part cap and
// swallowed a failed part query, so a Raw copy could silently be a partial record.
describe("readOpenCodeMessageRecord", () => {
  const messageRow = { id: "msg_1", time_created: 1, data: JSON.stringify({ role: "user" }) };
  const partRow = { id: "p1", time_created: 2, data: JSON.stringify({ type: "text", text: "hi" }) };

  it("refuses a failed same-snapshot query", async () => {
    const res = await readOpenCodeMessageRecord("ses_1", "msg_1", {
      dataDir: "/x/oc",
      readSqliteFn: vi.fn(
        async (_db: string, _sql: string): Promise<SqliteResult> => ({
          status: "query-error",
          rows: [],
          error: "database is locked",
        }),
      ),
    });
    expect(res.ok).toBe(false);
  });

  it("returns too-large from one query without fetching payloads later", async () => {
    const readSqliteFn = vi.fn(
      async (_db: string, _sql: string): Promise<SqliteResult> => ({
        status: "ok",
        rows: [{ source_bytes: MAX_RECORD_BYTES + 1, record_json: null }],
      }),
    );

    await expect(readOpenCodeMessageRecord("ses_1", "msg_1", { dataDir: "/x/oc", readSqliteFn })).resolves.toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(readSqliteFn).toHaveBeenCalledTimes(1);
  });

  it("returns the complete record from the same bounded snapshot", async () => {
    const record = JSON.stringify({ message: messageRow, parts: [partRow] });
    const readSqliteFn = vi.fn(
      async (_db: string, _sql: string): Promise<SqliteResult> => ({
        status: "ok",
        rows: [{ source_bytes: Buffer.byteLength(record), record_json: record }],
      }),
    );

    const result = await readOpenCodeMessageRecord("ses_1", "msg_1", { dataDir: "/x/oc", readSqliteFn });
    expect(result.ok && JSON.parse(result.line)).toEqual({ message: messageRow, parts: [partRow] });
    expect(readSqliteFn).toHaveBeenCalledTimes(1);
    expect(readSqliteFn.mock.calls[0]?.[1]).toMatch(/CASE[\s\S]+json_group_array/i);
  });
});
