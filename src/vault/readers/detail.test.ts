// src/vault/readers/detail.test.ts — Shared detail substrate (redesign-vault-panel-ui 2_1).

import { describe, expect, it } from "vitest";
import {
  boundActivity,
  clampDetailLimit,
  classifyClaudeStyleEvents,
  cleanPromptText,
  createBoundedRecordBuffer,
  createSpawnIdCollector,
  finalizeDetail,
  MAX_ACTIVITY_STEPS,
  MAX_DETAIL_LIMIT,
  MAX_MESSAGE_TEXT,
  normalizeRich,
  SOURCE_TRUNCATED_REASON,
  scopeDirectChildren,
  synthesizeGroupDetail,
  toolLabel,
  truncate,
  truncateRich,
} from "./detail";

type Rec = Record<string, unknown>;

function userText(text: string, over: Rec = {}): Rec {
  return { type: "user", message: { role: "user", content: text }, timestamp: "2026-05-01T00:00:00.000Z", ...over };
}

function toolResultUser(toolUseId: string): Rec {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }] },
  };
}

function assistantText(text: string, over: Rec = {}): Rec {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    timestamp: "2026-05-01T01:00:00.000Z",
    ...over,
  };
}

function assistantTool(name: string, input: Rec, usage?: Rec): Rec {
  const message: Rec = { role: "assistant", content: [{ type: "tool_use", name, input }] };
  if (usage) {
    message.usage = usage;
  }
  return { type: "assistant", message };
}

describe("truncate", () => {
  it("collapses whitespace and trims", () => {
    expect(truncate("  a\n\n  b   c  ")).toBe("a b c");
  });

  it("caps at the max and appends an ellipsis", () => {
    expect(truncate("abcdef", 3)).toBe("abc…");
    expect(truncate("abc", 3)).toBe("abc");
  });
});

describe("truncateRich", () => {
  it("preserves line breaks, code indentation, and table alignment (D17)", () => {
    const input = "line one\nline two\n\n    indented\n| a | b |";
    expect(truncateRich(input)).toBe("line one\nline two\n\n    indented\n| a | b |");
  });

  it("normalizes CRLF, strips per-line trailing space, caps blank-line runs, trims ends", () => {
    expect(truncateRich("\n\na\r\nb   \n\n\n\nc\n\n")).toBe("a\nb\n\nc");
  });

  it("caps at max with an ellipsis", () => {
    expect(truncateRich("abcdef", 3)).toBe("abc…");
  });
});

describe("normalizeRich", () => {
  it("normalizes whitespace + structure like truncateRich, minus the cap", () => {
    expect(normalizeRich("\n\na\r\nb   \n\n\n\nc\n\n")).toBe("a\nb\n\nc");
  });

  it("never caps length — a long body survives whole with no ellipsis", () => {
    const long = "x".repeat(MAX_MESSAGE_TEXT * 2);
    const out = normalizeRich(long);
    expect(out).toBe(long);
    expect(out).not.toContain("…");
  });
});

describe("boundActivity", () => {
  it("keeps only the most-recent N (the tail)", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(boundActivity(items, 12)).toEqual(items.slice(8));
    expect(boundActivity([1, 2], 12)).toEqual([1, 2]);
  });
});

describe("toolLabel", () => {
  it("uses file_path for file tools", () => {
    expect(toolLabel("Read", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(toolLabel("Edit", { file_path: "/a/b.ts", old_string: "x", new_string: "y" })).toBe("/a/b.ts");
    expect(toolLabel("Write", { file_path: "/a/b.ts", content: "..." })).toBe("/a/b.ts");
  });

  it("uses command for Bash and pattern for Grep/Glob", () => {
    expect(toolLabel("Bash", { command: "npm test", description: "run" })).toBe("npm test");
    expect(toolLabel("Grep", { pattern: "foo.*bar" })).toBe("foo.*bar");
    expect(toolLabel("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  it("falls back to the first string field for unknown tools", () => {
    expect(toolLabel("MysteryTool", { count: 3, label: "hello" })).toBe("hello");
    expect(toolLabel("MysteryTool", { count: 3 })).toBeUndefined();
  });
});

describe("cleanPromptText", () => {
  it("passes a plain human prompt through (trimmed)", () => {
    expect(cleanPromptText("  fix the bug  ")).toBe("fix the bug");
  });

  it("drops the local-command caveat banner and command stdout", () => {
    expect(cleanPromptText("<local-command-caveat>Caveat: …</local-command-caveat>")).toBeUndefined();
    expect(cleanPromptText("<local-command-stdout>done</local-command-stdout>")).toBeUndefined();
  });

  it("drops a bare slash-command (no args)", () => {
    expect(cleanPromptText("<command-name>/clear</command-name>\n<command-args></command-args>")).toBeUndefined();
  });

  it("surfaces the command + args for a slash-command WITH arguments", () => {
    const raw =
      "<command-message>asimov-plan</command-message>\n<command-name>/asimov-plan</command-name>\n<command-args>update the vault UI</command-args>";
    expect(cleanPromptText(raw)).toBe("/asimov-plan update the vault UI");
  });

  it("keeps a real prompt that only MENTIONS a command wrapper mid-text (no false drop)", () => {
    // Regression: a 1-line meta-prompt referencing `<command-message>` was being
    // mistaken for a command record and dropped whole. It must survive verbatim.
    const raw = "help me write a prompt; wrappers like `<command-message>asimov</command-message>` should be stripped";
    expect(cleanPromptText(raw)).toBe(raw);
    // Same for an inline `<command-name>` mention.
    const raw2 = "explain what <command-name>/clear</command-name> does in Claude Code";
    expect(cleanPromptText(raw2)).toBe(raw2);
  });

  it("unwraps a teammate-message to its clean body (so titles/prompts lose the tag) (D16)", () => {
    expect(
      cleanPromptText('<teammate-message teammate_id="team-lead" color="blue">review the auth path</teammate-message>'),
    ).toBe("review the auth path");
    // Unclosed tag (truncated transcript) → still unwraps the visible body.
    expect(cleanPromptText('<teammate-message teammate_id="x">partial body')).toBe("partial body");
    // Empty body → nothing to surface.
    expect(cleanPromptText('<teammate-message teammate_id="x"></teammate-message>')).toBeUndefined();
  });
});

describe("classifyClaudeStyleEvents — injected records", () => {
  const NOTIFICATION = [
    "<task-notification>",
    "<status>completed</status>",
    '<summary>Background command "Re-run release 0.17.9" completed (exit code 0)</summary>',
    "</task-notification>",
  ].join("\n");

  it("emits a notice item, not a user message, for a background-task notification", () => {
    const out = classifyClaudeStyleEvents([
      userText("ship it"),
      userText(NOTIFICATION, { uuid: "notice-1" }),
      assistantText("done"),
    ]);
    expect(out.timeline).toContainEqual(
      expect.objectContaining({
        kind: "notice",
        summary: 'Background command "Re-run release 0.17.9" completed (exit code 0)',
        status: "completed",
        msgRef: "notice-1",
      }),
    );
    const users = out.timeline.filter((i) => i.kind === "message" && i.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ text: "ship it" });
    // Not a conversation turn: it must not become the latest message.
    expect(out.latestMessage).toMatchObject({ role: "assistant", text: "done" });
  });

  it("emits a notice, not a user message, when the reader interrupts a response", () => {
    const out = classifyClaudeStyleEvents([
      userText("start"),
      userText("[Request interrupted by user]", {
        uuid: "interrupt-1",
        interruptedMessageId: "msg_011CeKT6psxjRD2zHJkwrzD4",
      }),
    ]);
    expect(out.timeline).toContainEqual(
      expect.objectContaining({ kind: "notice", summary: "Request interrupted by user", msgRef: "interrupt-1" }),
    );
    expect(out.timeline.filter((item) => item.kind === "message" && item.role === "user")).toHaveLength(1);
  });

  it("emits a compaction item for a compact-summary record", () => {
    const summary = "This session is being continued from a previous conversation that ran out of context.";
    const out = classifyClaudeStyleEvents([
      userText("start"),
      userText(summary, { isCompactSummary: true, uuid: "compact-1" }),
      userText("carry on"),
    ]);
    expect(out.timeline).toContainEqual(
      expect.objectContaining({ kind: "compaction", text: summary, msgRef: "compact-1" }),
    );
    expect(out.timeline.filter((i) => i.kind === "message" && i.role === "user")).toHaveLength(2);
  });

  it("bounds a notification body and a compaction summary", () => {
    const huge = "y".repeat(MAX_MESSAGE_TEXT + 500);
    const withBody = NOTIFICATION.replace("</task-notification>", `<result>${huge}</result>\n</task-notification>`);
    const out = classifyClaudeStyleEvents([userText(withBody), userText(huge, { isCompactSummary: true })]);
    const notice = out.timeline.find((i) => i.kind === "notice");
    const compaction = out.timeline.find((i) => i.kind === "compaction");
    expect(notice?.kind === "notice" && notice.body?.length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT + 1);
    expect(compaction?.kind === "compaction" && compaction.text.length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT + 1);
  });

  it("strips a system-reminder appended to a real prompt", () => {
    const out = classifyClaudeStyleEvents([
      userText("fix the UI\n<system-reminder>\nGoal check-in: still running\n</system-reminder>"),
    ]);
    expect(out.timeline).toContainEqual(expect.objectContaining({ kind: "message", role: "user", text: "fix the UI" }));
    expect(out.firstPrompt).toBe("fix the UI");
  });
});

describe("classifyClaudeStyleEvents", () => {
  it("captures the first prompt independently of the 12-step activity cap", () => {
    const records: Rec[] = [userText("the very first prompt")];
    for (let i = 0; i < 20; i++) {
      records.push(assistantTool("Bash", { command: `cmd ${i}` }));
    }
    records.push(assistantText("final answer"));

    const out = classifyClaudeStyleEvents(records);
    expect(out.firstPrompt).toBe("the very first prompt");
    expect(out.recentActivity).toHaveLength(MAX_ACTIVITY_STEPS);
    // Tail kept: last bash call is cmd 19.
    expect(out.recentActivity.at(-1)).toEqual({ kind: "tool", tool: "Bash", detail: "cmd 19", diff: undefined });
    expect(out.latestMessage).toMatchObject({ role: "assistant", text: "final answer" });
  });

  it("records Read + Bash tool calls and a Task as a subagent step", () => {
    const records: Rec[] = [
      userText("do work"),
      assistantTool("Read", { file_path: "/src/x.ts" }),
      assistantTool("Bash", { command: "ls -la" }),
      assistantTool("Task", { subagent_type: "asm-review-frontend", prompt: "review the change" }),
    ];
    const out = classifyClaudeStyleEvents(records);
    expect(out.recentActivity).toEqual([
      { kind: "tool", tool: "Read", detail: "/src/x.ts", diff: undefined },
      { kind: "tool", tool: "Bash", detail: "ls -la", diff: undefined },
      { kind: "subagent", name: "asm-review-frontend", prompt: "review the change" },
    ]);
    expect(out.stats.toolCount).toBe(2);
    expect(out.stats.subagentCount).toBe(1);
  });

  it("does NOT add a tool_result user message as its own step or message", () => {
    const records: Rec[] = [
      userText("start"),
      assistantTool("Read", { file_path: "/a.ts" }),
      toolResultUser("tu_1"),
      assistantText("done"),
    ];
    const out = classifyClaudeStyleEvents(records);
    // Only the Read tool_use is a step — the tool_result is not.
    expect(out.recentActivity).toEqual([{ kind: "tool", tool: "Read", detail: "/a.ts", diff: undefined }]);
    // Messages: user "start" + 2 assistant turns = 3 (the tool_result user is excluded).
    expect(out.stats.messageCount).toBe(3);
    expect(out.latestMessage).toMatchObject({ role: "assistant", text: "done" });
  });

  it("emits an incoming teammate-message as a teammateMessage item (clean body), not a raw USER turn (D16)", () => {
    const raw =
      '<teammate-message teammate_id="reviewer-a" color="blue" summary="done">found 2 issues</teammate-message>';
    // The hook (the Claude reader's parseTeammateTag adapter) unwraps the tag.
    const hook = (text: string) =>
      text.includes("<teammate-message")
        ? { agentName: "reviewer-a", from: "peer", color: "blue", body: "found 2 issues" }
        : null;
    const out = classifyClaudeStyleEvents([userText(raw)], { teammateMessage: hook });
    expect(out.timeline).toHaveLength(1);
    const item = out.timeline[0];
    expect(item.kind).toBe("teammateMessage");
    if (item.kind === "teammateMessage") {
      expect(item.agentName).toBe("reviewer-a");
      expect(item.from).toBe("peer");
      expect(item.color).toBe("blue");
      expect(item.text).toBe("found 2 issues"); // clean body — the literal tag never surfaces
    }
    // It still counts as a real message, but never as a first prompt (the leader's
    // human prompt owns that) or a plain user bubble.
    expect(out.stats.messageCount).toBe(1);
    expect(out.firstPrompt).toBeUndefined();
    expect(out.timeline.some((i) => i.kind === "message")).toBe(false);
  });

  it("without the teammate hook, leaves a non-team user prompt as a plain message", () => {
    const out = classifyClaudeStyleEvents([userText("just a normal prompt")]);
    expect(out.timeline).toEqual([
      { kind: "message", role: "user", text: "just a normal prompt", timestamp: expect.any(Number) },
    ]);
  });

  it("excludes summary and sidechain records from first/latest selection", () => {
    const records: Rec[] = [
      { type: "summary", summary: "a synthetic summary" },
      userText("sidechain prompt", { isSidechain: true }),
      assistantText("sidechain reply", { isSidechain: true }),
      userText("the real first prompt"),
      assistantText("the real latest"),
    ];
    const out = classifyClaudeStyleEvents(records);
    expect(out.firstPrompt).toBe("the real first prompt");
    expect(out.latestMessage).toMatchObject({ role: "assistant", text: "the real latest" });
    // Sidechain turns excluded from the message count too.
    expect(out.stats.messageCount).toBe(2);
  });

  it("computes a diff stat for Edit from the old/new strings", () => {
    const records: Rec[] = [
      userText("edit it"),
      assistantTool("Edit", { file_path: "/a.ts", old_string: "one\ntwo", new_string: "one\ntwo\nthree\nfour" }),
    ];
    const out = classifyClaudeStyleEvents(records);
    expect(out.recentActivity[0]).toEqual({
      kind: "tool",
      tool: "Edit",
      detail: "/a.ts",
      diff: { added: 2, removed: 0 },
    });
  });

  it("sums usage into an approximate token count when present", () => {
    const records: Rec[] = [
      userText("hi"),
      assistantTool("Bash", { command: "a" }, { output_tokens: 100, input_tokens: 500 }),
      assistantTool(
        "Bash",
        { command: "b" },
        {
          output_tokens: 50,
          input_tokens: 1200,
          cache_read_input_tokens: 300,
        },
      ),
    ];
    const out = classifyClaudeStyleEvents(records);
    // output sum (150) + last turn context (1200 + 300) = 1650.
    expect(out.stats.tokenCount).toBe(1650);
  });

  it("omits tokenCount when no usage is present", () => {
    const out = classifyClaudeStyleEvents([userText("hi"), assistantText("yo")]);
    expect(out.stats.tokenCount).toBeUndefined();
  });

  it("builds a full chronological timeline (messages interleaved with tool/subagent steps)", () => {
    const records: Rec[] = [
      userText("do the work"),
      assistantTool("Read", { file_path: "/a.ts" }),
      assistantText("here is the plan"),
      assistantTool("Task", { subagent_type: "asm-finder", prompt: "find it" }),
      userText("looks good"),
    ];
    const out = classifyClaudeStyleEvents(records);
    expect(out.timeline).toEqual([
      { kind: "message", role: "user", text: "do the work", timestamp: expect.any(Number) },
      { kind: "tool", tool: "Read", detail: "/a.ts", diff: undefined },
      { kind: "message", role: "assistant", text: "here is the plan", timestamp: expect.any(Number) },
      { kind: "subagent", name: "asm-finder", prompt: "find it" },
      { kind: "message", role: "user", text: "looks good", timestamp: expect.any(Number) },
    ]);
  });

  it("suppresses a Workflow tool_use but keeps sibling text/tool blocks in the same message (D5)", () => {
    const records: Rec[] = [
      userText("kick off the workflow"),
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "running the board workflow" },
            { type: "tool_use", name: "Workflow", input: { script: "export const meta = {}".repeat(500) } },
            { type: "tool_use", name: "Bash", input: { command: "echo hi" } },
          ],
        },
        timestamp: "2026-05-01T01:00:00.000Z",
      },
    ];
    const out = classifyClaudeStyleEvents(records);
    // The Workflow block produces no timeline item and is not counted as a tool…
    expect(out.timeline.some((i) => i.kind === "tool" && i.tool === "Workflow")).toBe(false);
    expect(out.stats.toolCount).toBe(1); // only the Bash call
    // …while the sibling text + Bash blocks in the SAME message survive.
    expect(
      out.timeline.some(
        (i) => i.kind === "message" && i.role === "assistant" && i.text === "running the board workflow",
      ),
    ).toBe(true);
    expect(out.timeline.some((i) => i.kind === "tool" && i.tool === "Bash" && i.detail === "echo hi")).toBe(true);
  });

  it("maps an AskUserQuestion tool_use + its answer record into a question item with options", () => {
    const records: Rec[] = [
      userText("plan it"),
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_q1",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Which direction?",
                    header: "Gate 1",
                    multiSelect: false,
                    options: [
                      { label: "Built-in", description: "use the built-in provider" },
                      { label: "Custom", description: "more control" },
                    ],
                  },
                ],
              },
            },
          ],
        },
        timestamp: "2026-05-01T01:00:00.000Z",
      },
      // The answer arrives in a later user record's structured toolUseResult.
      {
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_q1", content: "answered" }] },
        toolUseResult: { questions: [{ question: "Which direction?" }], answers: { "Which direction?": "Built-in" } },
      },
    ];
    const out = classifyClaudeStyleEvents(records);
    const question = out.timeline.find((t) => t.kind === "question");
    expect(question?.kind === "question" && question.questions).toEqual([
      {
        prompt: "Which direction?",
        answer: "Built-in",
        options: [
          { label: "Built-in", description: "use the built-in provider", chosen: true },
          { label: "Custom", description: "more control" },
        ],
      },
    ]);
    // Surfaced as a question, not a bare "AskUserQuestion" tool chip; still counts as a tool.
    expect(out.timeline.some((t) => t.kind === "tool" && t.tool === "AskUserQuestion")).toBe(false);
    expect(out.stats.toolCount).toBe(1);
  });

  it("splits a Claude multi-select answer (comma-joined) to highlight every picked option", () => {
    const records: Rec[] = [
      userText("go"),
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_m",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Pick features",
                    multiSelect: true,
                    options: [{ label: "A" }, { label: "B" }, { label: "C" }],
                  },
                ],
              },
            },
          ],
        },
        timestamp: "2026-05-01T01:00:00.000Z",
      },
      {
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_m", content: "ok" }] },
        // Claude joins multi-select picks with ", " into one string.
        toolUseResult: { questions: [{ question: "Pick features" }], answers: { "Pick features": "A, C" } },
      },
    ];
    const out = classifyClaudeStyleEvents(records);
    const question = out.timeline.find((t) => t.kind === "question");
    expect(question?.kind === "question" && question.questions[0]).toEqual({
      prompt: "Pick features",
      answer: "A, C",
      options: [{ label: "A", chosen: true }, { label: "B" }, { label: "C", chosen: true }],
    });
  });

  it("matches a single-select Claude answer whole even when its label contains a comma", () => {
    const records: Rec[] = [
      userText("go"),
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_s",
              name: "AskUserQuestion",
              input: {
                questions: [
                  { question: "Proceed?", multiSelect: false, options: [{ label: "Yes, proceed" }, { label: "No" }] },
                ],
              },
            },
          ],
        },
        timestamp: "2026-05-01T01:00:00.000Z",
      },
      {
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_s", content: "ok" }] },
        toolUseResult: { questions: [{ question: "Proceed?" }], answers: { "Proceed?": "Yes, proceed" } },
      },
    ];
    const out = classifyClaudeStyleEvents(records);
    const question = out.timeline.find((t) => t.kind === "question");
    // Single-select: the whole "Yes, proceed" matches its option — NOT split into "Yes"/"proceed".
    expect(question?.kind === "question" && question.questions[0]).toEqual({
      prompt: "Proceed?",
      answer: "Yes, proceed",
      options: [{ label: "Yes, proceed", chosen: true }, { label: "No" }],
    });
  });

  it("maps an unanswered AskUserQuestion (no matching answer record) as pending", () => {
    const records: Rec[] = [
      userText("plan it"),
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_q2",
              name: "AskUserQuestion",
              input: { questions: [{ question: "Proceed?", options: [{ label: "Yes" }, { label: "No" }] }] },
            },
          ],
        },
        timestamp: "2026-05-01T01:00:00.000Z",
      },
    ];
    const out = classifyClaudeStyleEvents(records);
    const question = out.timeline.find((t) => t.kind === "question");
    expect(question?.kind === "question" && question.questions).toEqual([
      { prompt: "Proceed?", options: [{ label: "Yes" }, { label: "No" }] },
    ]);
  });

  it("skips isMeta records, the caveat banner, and bare commands when picking the first prompt", () => {
    const records: Rec[] = [
      userText("<local-command-caveat>Caveat: …</local-command-caveat>", { isMeta: true }),
      userText("<command-name>/clear</command-name>\n<command-args></command-args>"),
      userText("<command-name>/asimov-build</command-name>\n<command-args>ship the vault fix</command-args>"),
      assistantText("on it"),
    ];
    const out = classifyClaudeStyleEvents(records);
    expect(out.firstPrompt).toBe("/asimov-build ship the vault fix");
    // The caveat (meta) + bare /clear are not human turns → not counted.
    expect(out.stats.messageCount).toBe(2);
  });

  it("folds an Agent/Task spawn into a subagentSession when a matching child stub is provided", () => {
    const records: Rec[] = [
      userText("go"),
      assistantTool("Agent", { subagent_type: "cf-oracle", description: "Oracle review of the plan" }),
      assistantText("done"),
    ];
    const out = classifyClaudeStyleEvents(records, {
      childStubs: [
        {
          entryId: "claude:parent:subagent:agent-abc",
          agentType: "cf-oracle",
          description: "Oracle review of the plan",
          firstMessage: "You are reviewing…",
          timestamp: 10,
        },
      ],
    });
    const sub = out.timeline.find((i) => i.kind === "subagentSession");
    expect(sub).toBeDefined();
    if (sub?.kind === "subagentSession") {
      expect(sub.entryId).toBe("claude:parent:subagent:agent-abc");
      expect(sub.title).toBe("Oracle review of the plan");
      expect(sub.agent).toBe("cf-oracle");
    }
    // No bare "subagent" step remains for the matched spawn.
    expect(out.timeline.some((i) => i.kind === "subagent")).toBe(false);
  });

  it("falls back to a plain subagent step when no child stub matches", () => {
    const records: Rec[] = [
      userText("go"),
      assistantTool("Agent", { subagent_type: "general", description: "unmatched" }),
    ];
    const out = classifyClaudeStyleEvents(records, { childStubs: [] });
    expect(out.timeline.some((i) => i.kind === "subagent")).toBe(true);
    expect(out.timeline.some((i) => i.kind === "subagentSession")).toBe(false);
  });

  it("includes isSidechain records only when includeSidechain is set (subagent files)", () => {
    const records: Rec[] = [
      userText("subagent prompt", { isSidechain: true }),
      assistantText("subagent reply", { isSidechain: true }),
    ];
    // Default: sidechain is noise in a MAIN transcript → dropped.
    expect(classifyClaudeStyleEvents(records).timeline).toHaveLength(0);
    // For a subagent file, the sidechain IS the conversation.
    const out = classifyClaudeStyleEvents(records, { includeSidechain: true });
    expect(out.timeline.map((i) => i.kind)).toEqual(["message", "message"]);
  });

  it("counts distinct subagents as max(spawn calls, stubs) — no double-count on mismatch (W4)", () => {
    // One spawn call whose description does NOT match the one stub: the call
    // surfaces as a plain step AND the stub is appended, but the count is 1.
    const records: Rec[] = [
      userText("go"),
      assistantTool("Agent", { subagent_type: "general", description: "spawn description" }),
    ];
    const stub = { entryId: "claude:p:subagent:agent-x", description: "different", agentType: "cf-oracle" };
    const out = classifyClaudeStyleEvents(records, { childStubs: [stub] });
    expect(out.stats.subagentCount).toBe(1);
  });

  it("counts all stubs when there are more transcripts than matched calls (W4)", () => {
    const records: Rec[] = [userText("go"), assistantTool("Agent", { description: "A" })];
    const stubs = [
      { entryId: "claude:p:subagent:a", description: "A" },
      { entryId: "claude:p:subagent:b", description: "B" },
    ];
    const out = classifyClaudeStyleEvents(records, { childStubs: stubs });
    // 1 matched call + 1 leftover stub = 2 distinct subagents (not 3).
    expect(out.stats.subagentCount).toBe(2);
    expect(out.timeline.filter((i) => i.kind === "subagentSession")).toHaveLength(2);
  });

  it("places an unmatched stub by timestamp, not after newer messages (W6)", () => {
    const records: Rec[] = [userText("early", { timestamp: 10 }), assistantText("late", { timestamp: 30 })];
    const out = classifyClaudeStyleEvents(records, {
      childStubs: [{ entryId: "claude:p:subagent:b", description: "B", timestamp: 20 }],
    });
    expect(out.timeline.map((i) => (i.kind === "subagentSession" ? "subagent" : i.kind))).toEqual([
      "message",
      "subagent",
      "message",
    ]);
  });

  it("renders an isGroup stub title-only (no @agent chip) but keeps real subagents prefixed (D8)", () => {
    const records: Rec[] = [userText("go", { timestamp: 10 })];
    const out = classifyClaudeStyleEvents(records, {
      childStubs: [
        // Group node: description is the full label; no agentType.
        {
          entryId: "claude:p:workflow:wf_1",
          description: "Workflow: audit · 29 agents · completed",
          isGroup: true,
          timestamp: 20,
        },
        // Real subagent: keeps its @agent chip.
        { entryId: "claude:p:subagent:agent-x", description: "Sub", agentType: "cf-oracle", timestamp: 30 },
      ],
    });
    const items = out.timeline.filter((i) => i.kind === "subagentSession");
    const group = items.find((i) => i.kind === "subagentSession" && i.entryId === "claude:p:workflow:wf_1");
    const real = items.find((i) => i.kind === "subagentSession" && i.entryId === "claude:p:subagent:agent-x");
    if (group?.kind === "subagentSession") {
      expect(group.title).toBe("Workflow: audit · 29 agents · completed");
      expect(group.agent).toBeUndefined(); // no "subagent" fallback leaked
    }
    if (real?.kind === "subagentSession") {
      expect(real.agent).toBe("cf-oracle");
    }
  });
});

describe("synthesizeGroupDetail (nest-workflow-team-sessions 1_2)", () => {
  it("builds a detail whose timeline is one title-only subagentSession per child", () => {
    const detail = synthesizeGroupDetail(
      "claude:p:workflow:wf_1",
      [
        { entryId: "claude:p:wfagent:wf_1:agent-a", description: "plan the migration", isGroup: true },
        { entryId: "claude:p:wfagent:wf_1:agent-b", description: "audit the schema", isGroup: true, timestamp: 5 },
      ],
      { firstPrompt: "Audit Ghola design docs", subagentCount: 29 },
    );
    expect(detail.entryId).toBe("claude:p:workflow:wf_1");
    expect(detail.firstPrompt).toBe("Audit Ghola design docs");
    expect(detail.recentActivity).toEqual([]);
    expect(detail.stats.subagentCount).toBe(29);
    expect(detail.timeline.map((i) => i.kind)).toEqual(["subagentSession", "subagentSession"]);
    const first = detail.timeline[0];
    if (first.kind === "subagentSession") {
      expect(first.entryId).toBe("claude:p:wfagent:wf_1:agent-a");
      expect(first.title).toBe("plan the migration");
      expect(first.agent).toBeUndefined();
    }
  });

  it("handles an empty group (no children)", () => {
    const detail = synthesizeGroupDetail("claude:p:team:t", [], { subagentCount: 0 });
    expect(detail.timeline).toEqual([]);
    expect(detail.stats.subagentCount).toBe(0);
  });

  it("bounds the timeline to the limit and flags truncated (W4)", () => {
    const children = Array.from({ length: 5 }, (_, i) => ({
      entryId: `claude:p:wfagent:wf_1:agent-${i}`,
      description: `agent ${i}`,
      isGroup: true,
    }));
    const detail = synthesizeGroupDetail("claude:p:workflow:wf_1", children, { subagentCount: 5, limit: 2 });
    expect(detail.timeline).toHaveLength(2); // most-recent 2 kept
    expect(detail.truncated).toBe(true);
    expect(detail.stats.subagentCount).toBe(5); // count reflects the whole group
  });
});

describe("clampDetailLimit (W2)", () => {
  it("passes a finite positive int through, capped at the max", () => {
    expect(clampDetailLimit(400)).toBe(400);
    expect(clampDetailLimit(800)).toBe(800);
    expect(clampDetailLimit(MAX_DETAIL_LIMIT + 5000)).toBe(MAX_DETAIL_LIMIT);
    expect(clampDetailLimit(123.9)).toBe(123);
  });

  it("rejects undefined / non-finite / non-positive → undefined (reader default)", () => {
    expect(clampDetailLimit(undefined)).toBeUndefined();
    expect(clampDetailLimit(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(clampDetailLimit(Number.NaN)).toBeUndefined();
    expect(clampDetailLimit(0)).toBeUndefined();
    expect(clampDetailLimit(-10)).toBeUndefined();
  });
});

describe("finalizeDetail (contracts P2 — source vs pageable truncation)", () => {
  const base: Omit<import("../types").VaultSessionDetail, "entryId"> = {
    recentActivity: [],
    timeline: [{ kind: "message", role: "user", text: "hi" }],
    stats: { messageCount: 1, toolCount: 0, subagentCount: 0 },
  };

  it("passes the detail through untouched when the source read was complete", () => {
    const out = finalizeDetail("claude:a", { ...base, truncated: true }, false);
    expect(out.partial).toBeUndefined();
    expect(out.limitedReason).toBeUndefined();
    // The classifier's own pageable `truncated` is preserved (drives load-more).
    expect(out.truncated).toBe(true);
  });

  it("marks a source-truncated read as partial WITHOUT touching pageable truncated", () => {
    const out = finalizeDetail("claude:a", { ...base, truncated: true }, true);
    expect(out.partial).toBe(true);
    expect(out.limitedReason).toBe(SOURCE_TRUNCATED_REASON);
    // Still pageable within the retained window — load-more semantics intact.
    expect(out.truncated).toBe(true);
  });

  it("keeps an existing limitedReason instead of overwriting it", () => {
    const out = finalizeDetail("codex:a", { ...base, limitedReason: "index only" }, true);
    expect(out.partial).toBe(true);
    expect(out.limitedReason).toBe("index only");
  });
});

describe("createBoundedRecordBuffer (W1)", () => {
  it("keeps every record in order when under the cap", () => {
    const buf = createBoundedRecordBuffer(2, 3);
    const recs = [{ i: 0 }, { i: 1 }, { i: 2 }];
    for (const r of recs) {
      buf.push(r);
    }
    expect(buf.result()).toEqual({ records: recs, truncated: false });
  });

  it("keeps head + tail and drops the middle when over the cap", () => {
    const buf = createBoundedRecordBuffer(2, 3);
    for (let i = 0; i < 10; i++) {
      buf.push({ i });
    }
    const { records, truncated } = buf.result();
    expect(truncated).toBe(true);
    // head = first 2, then an explicit discontinuity, then the last 3.
    expect(records.map((r) => ("i" in r ? r.i : r.type))).toEqual([0, 1, "__vault_gap__", 7, 8, 9]);
  });

  it("emits the discontinuity as a timeline gap", () => {
    const buf = createBoundedRecordBuffer(1, 1);
    buf.push(userText("first", { uuid: "u-1" }));
    buf.push(assistantText("omitted", { uuid: "a-middle" }));
    buf.push(userText("last", { uuid: "u-2" }));
    expect(classifyClaudeStyleEvents(buf.result().records).timeline.map((item) => item.kind)).toEqual([
      "message",
      "gap",
      "message",
    ]);
  });
});

// support-nested-subagent-preview — toolUseId is the exact parent edge; scoping a
// transcript to its direct children lets nested subagents nest under their real
// parent instead of flattening to the root.
function taskRecord(id: string, input: Rec = {}, over: Rec = {}): Rec {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name: "Task", input }] },
    timestamp: "2026-05-01T01:00:00.000Z",
    ...over,
  };
}

describe("createSpawnIdCollector", () => {
  it("collects non-sidechain Agent/Task ids only when includeSidechain is false (mixed root)", () => {
    const c = createSpawnIdCollector(false);
    [
      taskRecord("toolu_root"),
      taskRecord("toolu_side", {}, { isSidechain: true }), // a subagent's own spawn, in a mixed root file
      assistantTool("Read", { file_path: "/a.ts" }), // not a spawn
    ].forEach(c.onRecord);
    expect([...c.ids]).toEqual(["toolu_root"]);
  });

  it("collects sidechain ids too when includeSidechain is true (subagent file)", () => {
    const c = createSpawnIdCollector(true);
    [taskRecord("toolu_a", {}, { isSidechain: true }), taskRecord("toolu_b", {}, { isSidechain: true })].forEach(
      c.onRecord,
    );
    expect([...c.ids].sort()).toEqual(["toolu_a", "toolu_b"]);
  });
});

describe("scopeDirectChildren", () => {
  it("keeps in-set toolUseId stubs and all legacy stubs, drops out-of-set", () => {
    const stubs = [
      { entryId: "claude:p:subagent:agent-A", toolUseId: "toolu_A" },
      { entryId: "claude:p:subagent:agent-B", toolUseId: "toolu_B" },
      { entryId: "claude:p:subagent:agent-legacy" }, // no toolUseId → always kept
    ];
    const kept = scopeDirectChildren(stubs, new Set(["toolu_A"])).map((s) => s.entryId);
    expect(kept).toEqual(["claude:p:subagent:agent-A", "claude:p:subagent:agent-legacy"]);
  });
});

describe("classify: toolUseId binding", () => {
  it("binds a toolUseId stub to its spawn block by id (not description)", () => {
    const out = classifyClaudeStyleEvents([userText("go"), taskRecord("toolu_A", { description: "do outer" })], {
      childStubs: [
        { entryId: "claude:p:subagent:agent-A", agentType: "outer", description: "do outer", toolUseId: "toolu_A" },
      ],
    });
    const sub = out.timeline.find((i) => i.kind === "subagentSession");
    expect(sub?.kind === "subagentSession" && sub.entryId).toBe("claude:p:subagent:agent-A");
    expect(out.timeline.some((i) => i.kind === "subagent")).toBe(false); // matched → no bare step
  });

  it("does NOT let a toolUseId stub be consumed by a same-description call with a different id", () => {
    const out = classifyClaudeStyleEvents([userText("go"), taskRecord("toolu_OTHER", { description: "do outer" })], {
      childStubs: [
        {
          entryId: "claude:p:subagent:agent-A",
          agentType: "outer",
          description: "do outer",
          toolUseId: "toolu_A",
          timestamp: 5,
        },
      ],
    });
    // The mismatched call renders as a bare subagent step (the stub did not bind to it)…
    expect(out.timeline.some((i) => i.kind === "subagent")).toBe(true);
    // …and the stub still surfaces (merged), never silently dropped.
    expect(out.timeline.some((i) => i.kind === "subagentSession" && i.entryId === "claude:p:subagent:agent-A")).toBe(
      true,
    );
  });

  it("still surfaces a direct child whose spawn block was truncated out of the records (timestamp merge)", () => {
    // Simulates the reader having scoped this stub in (its id was seen by the
    // whole-stream collector) while the bounded records omit the Task block.
    const out = classifyClaudeStyleEvents([userText("go", { timestamp: "2026-05-01T00:00:00.000Z" })], {
      childStubs: [
        {
          entryId: "claude:p:subagent:agent-A",
          agentType: "outer",
          description: "do outer",
          toolUseId: "toolu_A",
          timestamp: 1,
        },
      ],
    });
    expect(out.timeline.some((i) => i.kind === "subagentSession" && i.entryId === "claude:p:subagent:agent-A")).toBe(
      true,
    );
  });
});
