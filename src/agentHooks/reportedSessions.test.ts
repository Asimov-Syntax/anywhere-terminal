// src/agentHooks/reportedSessions.test.ts — what a terminal last reported.

import { describe, expect, it } from "vitest";
import { ReportedSessions } from "./reportedSessions";

describe("what a terminal last reported", () => {
  it("reads back the session a terminal named", () => {
    const reported = new ReportedSessions();
    reported.record({ terminalId: "t1", agent: "opencode", sessionId: "ses_abc123" });

    expect(reported.get("t1")).toEqual({ agent: "opencode", sessionId: "ses_abc123" });
  });

  it("knows nothing about a terminal that never reported", () => {
    expect(new ReportedSessions().get("t1")).toBeUndefined();
  });

  it("keeps the newest report, because an agent can start a second session in one pane", () => {
    const reported = new ReportedSessions();
    reported.record({ terminalId: "t1", agent: "opencode", sessionId: "ses_first" });
    reported.record({ terminalId: "t1", agent: "opencode", sessionId: "ses_second" });

    expect(reported.get("t1")?.sessionId).toBe("ses_second");
  });

  it("forgets a terminal when it is released", () => {
    const reported = new ReportedSessions();
    reported.record({ terminalId: "t1", agent: "opencode", sessionId: "s1" });
    reported.release("t1");

    expect(reported.get("t1")).toBeUndefined();
  });

  it("keeps one terminal's report out of another's", () => {
    const reported = new ReportedSessions();
    reported.record({ terminalId: "t1", agent: "opencode", sessionId: "ses_one" });
    reported.record({ terminalId: "t2", agent: "opencode", sessionId: "ses_two" });
    reported.release("t1");

    expect(reported.get("t2")?.sessionId).toBe("ses_two");
  });
});
