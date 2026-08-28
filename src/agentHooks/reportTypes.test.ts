// src/agentHooks/reportTypes.test.ts — an untrusted producer body becoming a report.

import { describe, expect, it } from "vitest";
import { MAX_REPORT_ID_CHARS, parseAgentSessionReport } from "./reportTypes";

describe("reading a producer's body", () => {
  it("reads OpenCode's own field name", () => {
    expect(parseAgentSessionReport("t1", "opencode", { sessionID: "ses_abc123" })).toEqual({
      terminalId: "t1",
      agent: "opencode",
      sessionId: "ses_abc123",
    });
  });

  it("takes the terminal from the credential, never from the body", () => {
    const report = parseAgentSessionReport("t1", "opencode", { sessionID: "ses_abc123", terminalId: "t2" });

    expect(report?.terminalId).toBe("t1");
  });

  it("drops everything that is not the session id", () => {
    const report = parseAgentSessionReport("t1", "opencode", {
      sessionID: "s1",
      cwd: "/repo",
      part: { type: "text", text: "the user's private prompt" },
    });

    expect(report).toEqual({ terminalId: "t1", agent: "opencode", sessionId: "s1" });
  });

  it("names no session when the body carries no id", () => {
    expect(parseAgentSessionReport("t1", "opencode", { cwd: "/repo" })).toBeNull();
    expect(parseAgentSessionReport("t1", "opencode", { sessionID: "   " })).toBeNull();
    expect(parseAgentSessionReport("t1", "opencode", "not an object")).toBeNull();
  });

  it("refuses an id that is unbounded or carries a control character", () => {
    expect(parseAgentSessionReport("t1", "opencode", { sessionID: "x".repeat(MAX_REPORT_ID_CHARS + 1) })).toBeNull();
    expect(parseAgentSessionReport("t1", "opencode", { sessionID: `${String.fromCharCode(0)}ses` })).toBeNull();
    expect(parseAgentSessionReport("t1", "opencode", { sessionID: "ses\nabc" })).toBeNull();
  });
});
