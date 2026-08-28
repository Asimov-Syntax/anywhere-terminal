import { describe, expect, it, vi } from "vitest";
import type { AgentHookChannel } from "../AgentHookRuntime";
import { opencodeAgentRegistration } from "./opencode";

function channel() {
  return {
    sessionId: "terminal-1",
    now: () => 0,
    setTimer: vi.fn(),
    clearTimer: vi.fn(),
    publish: vi.fn(),
    reason: vi.fn(),
  } satisfies AgentHookChannel;
}

describe("OpenCode hook registration", () => {
  it("publishes only the validated session id", () => {
    const c = channel();
    const session = opencodeAgentRegistration().createSession(c);

    session.handle(Buffer.from(JSON.stringify({ sessionID: "ses_abc", prompt: "private" })));

    expect(c.publish).toHaveBeenCalledWith("ses_abc");
  });

  it("rejects malformed and missing ids without publishing", () => {
    const c = channel();
    const session = opencodeAgentRegistration().createSession(c);

    session.handle(Buffer.from("not-json"));
    session.handle(Buffer.from(JSON.stringify({ messageID: "msg_wrong" })));

    expect(c.publish).not.toHaveBeenCalled();
    expect(c.reason).toHaveBeenCalledTimes(2);
    expect(c.reason).toHaveBeenCalledWith("malformed-json");
  });
});
