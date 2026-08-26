import { describe, expect, it } from "vitest";
import { type IdentityInput, resolveAgentIdentity } from "./agentIdentity";

const ABSENT_SESSION = { kind: "absent" } as const;

function input(over: Partial<IdentityInput> = {}): IdentityInput {
  return { session: ABSENT_SESSION, ...over };
}

describe("rank 1 — launch record", () => {
  it("proves identity from the launched executable", () => {
    expect(resolveAgentIdentity(input({ isAgentLaunch: true, shell: "claude" }))).toEqual({
      kind: "proven",
      agent: "claude",
      source: "launch",
    });
  });

  it("resolves a path-form executable and a windows suffix", () => {
    expect(resolveAgentIdentity(input({ isAgentLaunch: true, shell: "/usr/local/bin/opencode" }))).toMatchObject({
      agent: "opencode",
      source: "launch",
    });
    expect(resolveAgentIdentity(input({ isAgentLaunch: true, shell: "codex.cmd" }))).toMatchObject({
      agent: "codex",
      source: "launch",
    });
  });

  it("resolves Cursor Agent through the registry's own aliases", () => {
    // `agent` / `cursor-agent` are how Cursor actually launches; a matcher built
    // from VAULT_AGENT_IDS alone would miss both.
    expect(resolveAgentIdentity(input({ isAgentLaunch: true, shell: "cursor-agent" }))).toMatchObject({
      agent: "cursor",
      source: "launch",
    });
    expect(resolveAgentIdentity(input({ isAgentLaunch: true, shell: "agent" }))).toMatchObject({
      agent: "cursor",
      source: "launch",
    });
  });

  it("claims nothing when the launched executable is a plain shell", () => {
    expect(resolveAgentIdentity(input({ isAgentLaunch: true, shell: "/bin/zsh" }))).toEqual({ kind: "absent" });
  });

  it("ignores the shell when the pane was not an agent launch", () => {
    // respawnFallbackShell clears the flag, so the rank stops claiming on its own.
    expect(resolveAgentIdentity(input({ isAgentLaunch: false, shell: "claude" }))).toEqual({ kind: "absent" });
    expect(resolveAgentIdentity(input({ shell: "claude" }))).toEqual({ kind: "absent" });
  });
});

describe("rank 2 — session registry", () => {
  it("proves identity from a resolved session and carries its entry id", () => {
    expect(resolveAgentIdentity(input({ session: { kind: "resolved", agent: "claude", sessionId: "abc" } }))).toEqual({
      kind: "proven",
      agent: "claude",
      source: "registry",
      entryId: "claude:abc",
    });
  });

  it("builds the entry id through the canonical formatter", () => {
    // A session id containing its own colon must survive intact.
    const outcome = resolveAgentIdentity(
      input({ session: { kind: "resolved", agent: "claude", sessionId: "parent:subagent:leaf" } }),
    );
    expect(outcome).toMatchObject({ entryId: "claude:parent:subagent:leaf" });
  });

  it("loses to the launch record but still contributes the entry id", () => {
    expect(
      resolveAgentIdentity(
        input({ isAgentLaunch: true, shell: "claude", session: { kind: "resolved", agent: "claude", sessionId: "z" } }),
      ),
    ).toEqual({ kind: "proven", agent: "claude", source: "launch", entryId: "claude:z" });
  });
});

describe("rank 4 — committed title", () => {
  it("proves identity from a title that names an agent", () => {
    expect(resolveAgentIdentity(input({ title: "claude — fix the projector" }))).toEqual({
      kind: "proven",
      agent: "claude",
      source: "title",
    });
  });

  it("refuses a substring match", () => {
    expect(resolveAgentIdentity(input({ title: "openclaude" }))).toEqual({ kind: "absent" });
    expect(resolveAgentIdentity(input({ title: "opencode-blinker" }))).toEqual({ kind: "absent" });
  });

  it("refuses a decoration-only title", () => {
    expect(resolveAgentIdentity(input({ title: "" }))).toEqual({ kind: "absent" });
  });

  it("refuses an unreported title without treating it as proof of absence", () => {
    expect(resolveAgentIdentity(input({ title: undefined }))).toEqual({ kind: "absent" });
  });

  it("loses to the session registry", () => {
    expect(
      resolveAgentIdentity(input({ title: "codex", session: { kind: "resolved", agent: "claude", sessionId: "q" } })),
    ).toMatchObject({ agent: "claude", source: "registry" });
  });
});

describe("an inconclusive read is not an absence", () => {
  it("reports failure rather than falling through to a weaker rank", () => {
    // Falling to `title` here would be the silent downgrade the spec forbids:
    // the caller must be able to retain the identity it last proved.
    const outcome = resolveAgentIdentity(
      input({ title: "codex", session: { kind: "failed", source: "panes", reason: "`ps` failed: timed out" } }),
    );
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.source).toBe("panes");
      expect(outcome.reason).toContain("timed out");
    }
  });

  it("does not report failure when a stronger rank already proved identity", () => {
    expect(
      resolveAgentIdentity(
        input({
          isAgentLaunch: true,
          shell: "claude",
          session: { kind: "failed", source: "registry", reason: "unreadable" },
        }),
      ),
    ).toEqual({ kind: "proven", agent: "claude", source: "launch" });
  });

  it("names the source that failed rather than blaming the pane for all of them", () => {
    // An unreadable session registry is not a failed process-table read. Folding
    // both into `panes` would make the stale affordance name the wrong source,
    // and would hide that the registry — which also feeds the external rows —
    // is the half that is out.
    const outcome = resolveAgentIdentity(
      input({ session: { kind: "failed", source: "registry", reason: "registry unreadable (EACCES)" } }),
    );
    expect(outcome).toEqual({ kind: "failed", source: "registry", reason: "registry unreadable (EACCES)" });
  });

  it("reports a conclusive empty read as absent, so a real exit clears the row", () => {
    expect(resolveAgentIdentity(input({ session: { kind: "absent" } }))).toEqual({ kind: "absent" });
  });
});
