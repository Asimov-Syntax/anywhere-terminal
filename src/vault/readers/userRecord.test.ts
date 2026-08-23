// src/vault/readers/userRecord.test.ts — user-role record classification
// (improve-vault-transcript-messages 1_1).

import { describe, expect, it } from "vitest";
import { cleanPromptText } from "./detail";
import { classifyUserRecord } from "./userRecord";

type Rec = Record<string, unknown>;

function rec(content: unknown, over: Rec = {}): Rec {
  return { type: "user", message: { role: "user", content }, ...over };
}

const NOTIFICATION = [
  "<task-notification>",
  "<task-id>bhw4dug1s</task-id>",
  "<tool-use-id>toolu_014TBcoJ38tGaDPW4d8bjfY7</tool-use-id>",
  "<output-file>/tmp/tasks/bhw4dug1s.output</output-file>",
  "<status>completed</status>",
  '<summary>Background command "Re-run release 0.17.9" completed (exit code 0)</summary>',
  "</task-notification>",
].join("\n");

describe("classifyUserRecord", () => {
  it("classifies a human prompt", () => {
    expect(classifyUserRecord(rec("  fix the bug  "))).toEqual({ kind: "prompt", text: "fix the bug" });
  });

  it("drops an injected meta record before looking at its text", () => {
    expect(classifyUserRecord(rec("some skill body", { isMeta: true }))).toEqual({ kind: "drop" });
  });

  it("drops plumbing envelopes and a tool-result-only record", () => {
    expect(classifyUserRecord(rec("<local-command-caveat>Caveat: …</local-command-caveat>"))).toEqual({ kind: "drop" });
    expect(classifyUserRecord(rec("<local-command-stdout>done</local-command-stdout>"))).toEqual({ kind: "drop" });
    expect(classifyUserRecord(rec("<command-name>/clear</command-name>\n<command-args></command-args>"))).toEqual({
      kind: "drop",
    });
    expect(classifyUserRecord(rec([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]))).toEqual({
      kind: "drop",
    });
  });

  it("surfaces a slash-command's arguments as the prompt", () => {
    const raw =
      "<command-message>asimov-plan</command-message>\n<command-name>/asimov-plan</command-name>\n<command-args>update the vault UI</command-args>";
    expect(classifyUserRecord(rec(raw))).toEqual({ kind: "prompt", text: "/asimov-plan update the vault UI" });
  });

  it("classifies an interrupted request marker as a notice, not a prompt", () => {
    expect(
      classifyUserRecord(
        rec("[Request interrupted by user]", {
          interruptedMessageId: "msg_011CeKT6psxjRD2zHJkwrzD4",
        }),
      ),
    ).toEqual({ kind: "notice", summary: "Request interrupted by user" });
  });

  it("classifies a task-notification envelope, keeping summary + status", () => {
    expect(classifyUserRecord(rec(NOTIFICATION))).toEqual({
      kind: "notice",
      summary: 'Background command "Re-run release 0.17.9" completed (exit code 0)',
      status: "completed",
    });
  });

  it("keeps a task-notification's result body", () => {
    const withResult = NOTIFICATION.replace(
      "</task-notification>",
      "<result>## Review\n\nVERDICT: BLOCK</result>\n</task-notification>",
    );
    const out = classifyUserRecord(rec(withResult));
    expect(out.kind).toBe("notice");
    expect(out.kind === "notice" && out.body).toBe("## Review\n\nVERDICT: BLOCK");
  });

  it("classifies a compaction summary by its record flag, not its prose", () => {
    const summary = "This session is being continued from a previous conversation that ran out of context.";
    expect(classifyUserRecord(rec(summary, { isCompactSummary: true }))).toEqual({
      kind: "compaction",
      text: summary,
    });
    // The same prose typed by a human is still a prompt.
    expect(classifyUserRecord(rec(summary))).toEqual({ kind: "prompt", text: summary });
  });

  it("excises a system-reminder and keeps the human remainder", () => {
    const raw = "ship the release\n<system-reminder>\nGoal check-in: still running\n</system-reminder>";
    expect(classifyUserRecord(rec(raw))).toEqual({ kind: "prompt", text: "ship the release" });
  });

  it("drops a record that is nothing but a system-reminder", () => {
    expect(classifyUserRecord(rec("<system-reminder>context blob</system-reminder>"))).toEqual({ kind: "drop" });
  });

  it("re-classifies the remainder after excision", () => {
    // A notification with a reminder appended is still a notification.
    const raw = `${NOTIFICATION}\n<system-reminder>Goal check-in</system-reminder>`;
    expect(classifyUserRecord(rec(raw)).kind).toBe("notice");
  });

  it("keeps a human prompt that quotes an envelope", () => {
    const raw = "why does the preview show <task-notification> markup instead of a summary?";
    expect(classifyUserRecord(rec(raw))).toEqual({ kind: "prompt", text: raw });
  });

  it("degrades a malformed notification rather than leaking markup", () => {
    // No closing tag: the summary that IS readable still wins.
    const partial = "<task-notification>\n<status>completed</status>\n<summary>Agent finished</summary>";
    expect(classifyUserRecord(rec(partial))).toEqual({
      kind: "notice",
      summary: "Agent finished",
      status: "completed",
    });
    // Nothing readable at all → dropped, never rendered raw.
    expect(classifyUserRecord(rec("<task-notification>\n<task-id>x</task-id>"))).toEqual({ kind: "drop" });
  });

  it("ignores a non-user record", () => {
    expect(classifyUserRecord({ type: "assistant", message: { content: "hi" } })).toEqual({ kind: "drop" });
  });
});

describe("cleanPromptText — system-reminder excision", () => {
  it("strips a reminder block wherever it sits", () => {
    expect(cleanPromptText("before\n<system-reminder>noise</system-reminder>\nafter")).toBe("before\nafter");
  });

  it("strips several reminder blocks", () => {
    const raw = "<system-reminder>a</system-reminder>real prompt<system-reminder>b</system-reminder>";
    expect(cleanPromptText(raw)).toBe("real prompt");
  });

  it("drops a text that is only reminders", () => {
    expect(cleanPromptText("<system-reminder>a</system-reminder>")).toBeUndefined();
  });

  it("leaves an unclosed reminder alone rather than eating the prompt", () => {
    const raw = "fix this <system-reminder> and that";
    expect(cleanPromptText(raw)).toBe(raw);
  });
});
