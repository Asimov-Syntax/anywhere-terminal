import { describe, expect, it } from "vitest";
import { hasCurrentCursorApproval } from "./CursorApprovalDetector";

type TestLine = string | { text: string; isWrapped: boolean };

function terminal(lines: TestLine[], options: { rows?: number; baseY?: number } = {}) {
  const rows = options.rows ?? lines.length;
  const baseY = options.baseY ?? 0;
  return {
    rows,
    buffer: {
      active: {
        baseY,
        getLine: (index: number) => {
          const line = lines[index];
          const text = typeof line === "string" ? line : (line?.text ?? "");
          return {
            isWrapped: typeof line === "object" ? line.isWrapped : false,
            translateToString: () => text,
          };
        },
      },
    },
  };
}

const approval = [
  "Run this command?",
  "Not in allowlist: git status",
  " → Run (once) (y)",
  "   Add Shell(git status) to allowlist? (tab)",
  "   Run Everything (shift+tab)",
  "   Skip & tell the agent what to do instead (esc or n)",
];

describe("hasCurrentCursorApproval", () => {
  it("requires verified hook or strict Cursor title identity", () => {
    expect(hasCurrentCursorApproval(terminal(approval), false)).toBe(false);
    expect(hasCurrentCursorApproval(terminal(approval), true)).toBe(true);
    expect(hasCurrentCursorApproval(terminal(approval), false, "Cursor Agent")).toBe(true);
    expect(hasCurrentCursorApproval(terminal(approval), false, "Cursor Agent — project")).toBe(false);
  });

  it("recognizes Cursor's key-bound command approval menu", () => {
    expect(hasCurrentCursorApproval(terminal(approval), true)).toBe(true);
    expect(hasCurrentCursorApproval(terminal([...approval, "", ""]), true)).toBe(true);
  });

  it("reassembles the observed narrow-pane menu when Cursor splits choice rows", () => {
    const wrapped = [
      "Run this command?",
      "Not in allowlist: git status",
      " → Run (once) (y)",
      "   Add Shell(git status) to",
      " allowlist? (tab)",
      "   Run Everything (shift+tab)",
      "   Skip & tell the agent what to",
      " do instead (esc or n)",
      "",
      "",
    ];

    expect(hasCurrentCursorApproval(terminal(wrapped), true)).toBe(true);
  });

  it("requires the prompt, two recognized choices, and the final choice at the current bottom", () => {
    expect(hasCurrentCursorApproval(terminal(["Run this command?", " → Run (once) (y)"]), true)).toBe(false);
    expect(hasCurrentCursorApproval(terminal(approval.slice(1)), true)).toBe(false);
    expect(hasCurrentCursorApproval(terminal([...approval, "Command completed"]), true)).toBe(false);
  });

  it("rejects approval-like prose and generic numbered menus", () => {
    expect(
      hasCurrentCursorApproval(
        terminal([
          "Run this command?",
          "The agent suggests Run Everything (shift+tab)",
          "Then skip & tell the agent (esc or n)",
        ]),
        true,
      ),
    ).toBe(false);
    expect(
      hasCurrentCursorApproval(
        terminal(["Allow Cursor Agent to run this command?", "› 1. Allow once", "  2. Reject"]),
        true,
      ),
    ).toBe(false);
  });

  it("reads only the bottom eight rows of the active screen, never scrollback", () => {
    const lines = [
      ...approval,
      "current output 1",
      "current output 2",
      "current output 3",
      "current output 4",
      "current output 5",
      "current output 6",
      "current output 7",
      "current output 8",
    ];
    expect(hasCurrentCursorApproval(terminal(lines, { rows: 8, baseY: approval.length }), true)).toBe(false);

    const currentScreen = ["old scrollback", "old scrollback", ...approval];
    expect(hasCurrentCursorApproval(terminal(currentScreen, { rows: approval.length, baseY: 2 }), true)).toBe(true);
  });

  it("keeps the structural match through a short resized screen", () => {
    expect(hasCurrentCursorApproval(terminal(["wrapped", ...approval], { rows: 7, baseY: 0 }), true)).toBe(true);
  });
});
