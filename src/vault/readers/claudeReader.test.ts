// src/vault/readers/claudeReader.test.ts — Unit tests over captured fixtures.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listClaudeWorkflowStubs, readClaudeDetail, readClaudeEntry, readClaudeSessions } from "./claudeReader";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(here, "..", "__fixtures__", "claude");
const CMDS_FIXTURE_ROOT = path.join(here, "..", "__fixtures__", "claude-cmds");
const TITLE_FIXTURE_ROOT = path.join(here, "..", "__fixtures__", "claude-title");
const TITLE_PRECEDENCE_FIXTURE_ROOT = path.join(here, "..", "__fixtures__", "claude-title-precedence");
const SUBAGENT_FIXTURE_ROOT = path.join(here, "..", "__fixtures__", "claude-subagents");
const TEAM_FIXTURE_ROOT = path.join(here, "..", "__fixtures__", "claude-teams");
const WF_FIXTURE_ROOT = path.join(here, "..", "__fixtures__", "claude-workflows");

describe("readClaudeSessions", () => {
  it("reads the valid session and counts the malformed one as unreadable", async () => {
    const { entries, unreadable } = await readClaudeSessions({ configDir: FIXTURE_ROOT });
    expect(entries).toHaveLength(1);
    expect(unreadable).toBe(1);
  });

  it("maps the documented metadata fields", async () => {
    const { entries } = await readClaudeSessions({ configDir: FIXTURE_ROOT });
    const e = entries[0];
    expect(e.id).toBe("claude:sess-valid");
    expect(e.agent).toBe("claude");
    expect(e.sessionId).toBe("sess-valid");
    expect(e.cwd).toBe("/Users/me/proj");
    expect(e.flags.model).toBe("claude-opus-4-7");
    expect(e.flags.permissionMode).toBe("acceptEdits");
    expect(e.flags.configDir).toBe(FIXTURE_ROOT);
    expect(e.modified).toBeGreaterThan(0);
    expect(e.canFork).toBe(false);
  });

  it("falls back to the first user message when there is no ai-title", async () => {
    const { entries } = await readClaudeSessions({ configDir: FIXTURE_ROOT });
    expect(entries[0].title.startsWith("Please help me build a really long prompt")).toBe(true);
  });

  it("prefers Claude's latest ai-title over the first user message", async () => {
    const { entries } = await readClaudeSessions({ configDir: TITLE_FIXTURE_ROOT });
    expect(entries).toHaveLength(1);
    // The newest ai-title wins over both the stale early one and the prompt.
    expect(entries[0].title).toBe("Redesign the AI Vault panel");
  });

  it("follows Claude's title precedence: custom-title > ai-title > last-prompt > first prompt", async () => {
    const { entries } = await readClaudeSessions({ configDir: TITLE_PRECEDENCE_FIXTURE_ROOT });
    const titles = Object.fromEntries(entries.map((e) => [e.sessionId, e.title]));
    // The name the user gave the session in Claude wins over the generated title.
    expect(titles["sess-named"]).toBe("add-command-receipt-replay");
    // No ai-title yet (half a real store) → the last prompt, not the first message.
    expect(titles["sess-lastprompt"]).toBe("/asimov-plan land the receipt contract");
    // An empty custom-title CLEARS the name, as it does in Claude.
    expect(titles["sess-cleared"]).toBe("An auto-generated title");
  });

  it("bounds the title to <=120 chars and strips newlines (D4)", async () => {
    const { entries } = await readClaudeSessions({ configDir: FIXTURE_ROOT });
    expect(entries[0].title.length).toBeLessThanOrEqual(120);
    expect(entries[0].title).not.toContain("\n");
  });

  it("skips the caveat banner and bare slash-commands, titling from the first real prompt", async () => {
    const { entries } = await readClaudeSessions({ configDir: CMDS_FIXTURE_ROOT });
    // sess-cmd has a real /asimov-plan prompt + an assistant reply → listed.
    // sess-empty is only a caveat + bare /clear (no prompt, no assistant) → hidden (D18).
    expect(entries).toHaveLength(1);
    expect(entries.map((e) => e.sessionId)).toEqual(["sess-cmd"]);
    // Not the <local-command-caveat> banner, not the bare /clear — the first
    // command WITH args wins.
    expect(entries[0].title).toBe("/asimov-plan update the vault UI please");
  });

  it("hides a content-less session (only a /clear) from the list, but still resolves it by id (D18)", async () => {
    const { entries } = await readClaudeSessions({ configDir: CMDS_FIXTURE_ROOT });
    expect(entries.some((e) => e.sessionId === "sess-empty")).toBe(false);
    // Hidden from the LIST only — a single-entry resolve still returns it (a real,
    // launchable session), mirroring the team-member rule.
    const entry = await readClaudeEntry("sess-empty", { configDir: CMDS_FIXTURE_ROOT });
    expect(entry?.id).toBe("claude:sess-empty");
  });

  it("returns zero entries (not an error) when the projects dir is absent", async () => {
    const { entries, unreadable } = await readClaudeSessions({ configDir: "/nonexistent/claude/root" });
    expect(entries).toEqual([]);
    expect(unreadable).toBe(0);
  });

  it("does NOT list subagent transcripts as separate sessions (only the parent)", async () => {
    const { entries } = await readClaudeSessions({ configDir: SUBAGENT_FIXTURE_ROOT });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("claude:sess-parent");
  });
});

describe("readClaudeEntry: single-entry resolve", () => {
  it("resolves one session by id with the same fields as the list scan", async () => {
    const entry = await readClaudeEntry("sess-valid", { configDir: FIXTURE_ROOT });
    expect(entry?.id).toBe("claude:sess-valid");
    expect(entry?.sessionId).toBe("sess-valid");
    expect(entry?.cwd).toBe("/Users/me/proj");
    expect(entry?.flags.model).toBe("claude-opus-4-7");
    expect(entry?.flags.permissionMode).toBe("acceptEdits");
    expect(entry?.flags.configDir).toBe(FIXTURE_ROOT);
  });

  it("returns null for an unsafe id (path traversal)", async () => {
    expect(await readClaudeEntry("../../escape", { configDir: FIXTURE_ROOT })).toBeNull();
  });

  it("returns null for a session that does not exist", async () => {
    expect(await readClaudeEntry("nope-not-here", { configDir: FIXTURE_ROOT })).toBeNull();
  });
});

describe("readClaudeDetail subagent nesting (new <sessionId>/subagents layout)", () => {
  it("folds each subagent into the parent timeline as a lazy subagentSession", async () => {
    const detail = await readClaudeDetail("sess-parent", { configDir: SUBAGENT_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    const sub = detail?.timeline.find((i) => i.kind === "subagentSession");
    expect(sub).toBeDefined();
    if (sub?.kind === "subagentSession") {
      expect(sub.entryId).toBe("claude:sess-parent:subagent:agent-deadbeef01");
      expect(sub.title).toBe("Oracle review of refactor"); // from meta.description
      expect(sub.agent).toBe("cf-oracle");
      expect(sub.firstMessage).toContain("reviewing the refactor");
    }
    // The matched Agent spawn becomes the rich block, not a bare subagent step.
    expect(detail?.timeline.some((i) => i.kind === "subagent")).toBe(false);
  });

  it("resolves a subagent transcript by its composite id, including its sidechain records", async () => {
    const detail = await readClaudeDetail("sess-parent:subagent:agent-deadbeef01", {
      configDir: SUBAGENT_FIXTURE_ROOT,
    });
    expect(detail).not.toBeNull();
    expect(detail?.entryId).toBe("claude:sess-parent:subagent:agent-deadbeef01");
    // The subagent file is entirely isSidechain — it IS the conversation here.
    expect(
      detail?.timeline.some((i) => i.kind === "message" && i.role === "assistant" && i.text.includes("ship it")),
    ).toBe(true);
    expect(detail?.timeline.some((i) => i.kind === "thinking")).toBe(true);
  });

  it("rejects an unsafe subagent stem (path traversal)", async () => {
    expect(
      await readClaudeDetail("sess-parent:subagent:../../escape", { configDir: SUBAGENT_FIXTURE_ROOT }),
    ).toBeNull();
  });
});

describe("team-member exclusion from the top-level list (D5)", () => {
  it("hides non-lead members but lists the leader + normal sessions, without inflating unreadable", async () => {
    const { entries, unreadable } = await readClaudeSessions({ configDir: TEAM_FIXTURE_ROOT });
    const ids = entries.map((e) => e.sessionId).sort();
    // member-a / member-b (FIRST user record has agentName + teamName) are excluded.
    // latejoin gains a teamName only on a LATE record → NOT a member → still listed (W2).
    expect(ids).toEqual(["latejoin", "leader", "normal"]);
    // The corrupt fixture still counts; the skipped members do NOT.
    expect(unreadable).toBe(1);
  });

  it("still resolves a member by explicit id (a member is a real, launchable session)", async () => {
    const entry = await readClaudeEntry("member-a", { configDir: TEAM_FIXTURE_ROOT });
    expect(entry).not.toBeNull();
    expect(entry?.sessionId).toBe("member-a");
    expect(entry?.id).toBe("claude:member-a");
  });

  it("W2: a late-team session is neither excluded from the list nor threaded as a member", async () => {
    // latejoin gains a teamName only on a LATE record → NOT a member → no turn is
    // threaded for it (exclusion + threading both decide on the FIRST user record,
    // so they agree). Only the real members thread in.
    const detail = await readClaudeDetail("leader", { configDir: TEAM_FIXTURE_ROOT });
    const turns = (detail?.timeline ?? []).filter((i) => i.kind === "teammateTurn");
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((t) => t.kind === "teammateTurn" && t.entryId.startsWith("claude:member-"))).toBe(true);
  });
});

describe("readClaudeTeamSegment :turn: (6_1)", () => {
  it("resolves a member turn to just that turn's records", async () => {
    const detail = await readClaudeDetail("member-a:turn:0", { configDir: TEAM_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    expect(detail?.entryId).toBe("claude:member-a:turn:0");
    // The turn = the incoming `<teammate-message>` + the member's response to it.
    expect(
      detail?.timeline.some((i) => i.kind === "message" && i.role === "assistant" && i.text.includes("reviewing")),
    ).toBe(true);
  });

  it("returns null for an out-of-range turn", async () => {
    expect(await readClaudeDetail("member-a:turn:5", { configDir: TEAM_FIXTURE_ROOT })).toBeNull();
  });

  it("rejects a forged/traversal member id", async () => {
    expect(await readClaudeDetail("../escape:turn:0", { configDir: TEAM_FIXTURE_ROOT })).toBeNull();
  });
});

describe("workflow nesting (2_1 / 2_2 / 2_3)", () => {
  it("2_1: discovers a workflow run as one collapsed group stub from the manifest", async () => {
    const stubs = await listClaudeWorkflowStubs("wfparent", { configDir: WF_FIXTURE_ROOT });
    expect(stubs).toHaveLength(1);
    expect(stubs[0].entryId).toBe("claude:wfparent:workflow:wf_test123");
    expect(stubs[0].description).toBe("Workflow: design-audit · completed");
    expect(stubs[0].isGroup).toBe(true);
    expect(stubs[0].timestamp).toBe(1780072409110); // startTime numeric string coerced
  });

  it("2_1: returns [] for a parent with no workflows dir", async () => {
    expect(await listClaudeWorkflowStubs("nope-not-here", { configDir: WF_FIXTURE_ROOT })).toEqual([]);
  });

  it("2_2: resolves a :workflow: group to its agents as title-only nested sessions", async () => {
    const detail = await readClaudeDetail("wfparent:workflow:wf_test123", { configDir: WF_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    expect(detail?.entryId).toBe("claude:wfparent:workflow:wf_test123");
    expect(detail?.firstPrompt).toBe("Audit the design docs for consistency");
    expect(detail?.stats.subagentCount).toBe(2);
    const items = detail?.timeline ?? [];
    expect(items.map((i) => i.kind)).toEqual(["subagentSession", "subagentSession"]);
    const first = items[0];
    if (first.kind === "subagentSession") {
      expect(first.entryId).toBe("claude:wfparent:wfagent:wf_test123:agent-aaa");
      expect(first.title).toBe("audit doc A for hallucinations");
      expect(first.agent).toBeUndefined();
    }
  });

  it("2_3: resolves a :wfagent: leaf to its transcript (sidechain records included)", async () => {
    const detail = await readClaudeDetail("wfparent:wfagent:wf_test123:agent-aaa", { configDir: WF_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    expect(detail?.entryId).toBe("claude:wfparent:wfagent:wf_test123:agent-aaa");
    expect(
      detail?.timeline.some((i) => i.kind === "message" && i.role === "user" && i.text.includes("audit doc A")),
    ).toBe(true);
    expect(
      detail?.timeline.some((i) => i.kind === "message" && i.role === "assistant" && i.text.includes("3 issues")),
    ).toBe(true);
  });

  it("2_3: rejects a workflow-agent id with a traversal stem", async () => {
    expect(await readClaudeDetail("wfparent:wfagent:wf_test123:../escape", { configDir: WF_FIXTURE_ROOT })).toBeNull();
  });
});

describe("workflow board from manifest workflowProgress (1_2)", () => {
  it("maps workflowProgress to a single workflowBoard item with phases, agents, and meta scalars", async () => {
    const detail = await readClaudeDetail("wfboard:workflow:wf_board1", { configDir: WF_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    expect(detail?.entryId).toBe("claude:wfboard:workflow:wf_board1");
    const items = detail?.timeline ?? [];
    expect(items.map((i) => i.kind)).toEqual(["workflowBoard"]);
    const board = items[0];
    expect(board.kind).toBe("workflowBoard");
    if (board.kind !== "workflowBoard") {
      return;
    }
    expect(board.wfId).toBe("wf_board1"); // stable key for selection persistence
    expect(board.workflowName).toBe("design-board");
    expect(board.summary).toBe("Audit and build the board");
    expect(board.status).toBe("completed");
    expect(board.agentCount).toBe(2);
    expect(board.durationMs).toBe(5000);
    expect(board.totalTokens).toBe(12345);
    expect(board.totalToolCalls).toBe(7);
    expect(board.model).toBe("claude-opus-4-8[1m]");
    expect(board.timestamp).toBe(1780072409110);
    // phases in index order
    expect(board.phases.map((p) => [p.index, p.title])).toEqual([
      [1, "Plan"],
      [2, "Build"],
    ]);
    // agents in progress order, with per-agent stats
    expect(board.agents.map((a) => a.label)).toEqual(["scout", "writer"]);
    expect(board.agents[0]).toMatchObject({ phaseIndex: 1, model: "claude-opus-4-8[1m]", tokens: 5000, toolCalls: 3 });
    // subagentCount mirrors the agent rows
    expect(detail?.stats.subagentCount).toBe(2);
  });

  it("resolves phase detail positionally without an off-by-one (1-based index → 0-based phases[])", async () => {
    const detail = await readClaudeDetail("wfboard:workflow:wf_board1", { configDir: WF_FIXTURE_ROOT });
    const board = detail?.timeline[0];
    if (board?.kind !== "workflowBoard") {
      throw new Error("expected a workflowBoard item");
    }
    const byIndex = new Map(board.phases.map((p) => [p.index, p.detail]));
    expect(byIndex.get(1)).toBe("plan phase detail"); // phases[0], NOT phases[1]
    expect(byIndex.get(2)).toBe("build phase detail"); // phases[1]
  });

  it("sets a drill-down entryId only for an agent whose transcript file exists", async () => {
    const detail = await readClaudeDetail("wfboard:workflow:wf_board1", { configDir: WF_FIXTURE_ROOT });
    const board = detail?.timeline[0];
    if (board?.kind !== "workflowBoard") {
      throw new Error("expected a workflowBoard item");
    }
    const scout = board.agents.find((a) => a.label === "scout");
    const writer = board.agents.find((a) => a.label === "writer");
    expect(scout?.entryId).toBe("claude:wfboard:wfagent:wf_board1:agent-aaa111"); // file present
    expect(writer?.entryId).toBeUndefined(); // agent-bbb222.jsonl absent → non-clickable
  });

  it("falls back to the first-prompt list when workflowProgress is an empty array", async () => {
    const detail = await readClaudeDetail("wfempty:workflow:wf_empty1", { configDir: WF_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    const kinds = (detail?.timeline ?? []).map((i) => i.kind);
    expect(kinds).not.toContain("workflowBoard");
    expect(kinds).toEqual(["subagentSession"]);
    expect(detail?.firstPrompt).toBe("A run whose manifest has an empty workflowProgress");
  });

  it("inlines a progress-bearing run as a self-collapsing board in the PARENT timeline (one layer, #1)", async () => {
    const detail = await readClaudeDetail("wfboard", { configDir: WF_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    const timeline = detail?.timeline ?? [];
    // The board renders directly in the parent timeline (it folds itself in the webview)…
    const board = timeline.find((i) => i.kind === "workflowBoard");
    expect(board?.kind).toBe("workflowBoard");
    if (board?.kind === "workflowBoard") {
      expect(board.wfId).toBe("wf_board1");
    }
    // …with NO outer collapsible "Workflow:" subagentSession wrapper (no extra layer).
    const wrapped = timeline.some((i) => i.kind === "subagentSession" && i.title.startsWith("Workflow:"));
    expect(wrapped).toBe(false);
    // A progress-bearing run yields no fallback group stub.
    expect(await listClaudeWorkflowStubs("wfboard", { configDir: WF_FIXTURE_ROOT })).toEqual([]);
  });
});

describe("parent detail composition (4_1)", () => {
  it("folds the workflow group AND threads team-member turns into the leader's timeline", async () => {
    const detail = await readClaudeDetail("wfparent", { configDir: WF_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    const timeline = detail?.timeline ?? [];
    const groupIds = timeline
      .filter((i) => i.kind === "subagentSession")
      .map((i) => (i.kind === "subagentSession" ? i.entryId : ""));
    // Workflow stays a collapsed group node…
    expect(groupIds).toContain("claude:wfparent:workflow:wf_test123");
    // …and there is NO :team: group node any more (replaced by threaded turns, D14).
    expect(groupIds.some((id) => id.includes(":team:"))).toBe(false);
    // The team member is threaded as a teammateTurn instead of a group.
    const turns = timeline.filter((i) => i.kind === "teammateTurn");
    expect(turns.some((t) => t.kind === "teammateTurn" && t.agentName === "wf-reviewer" && t.from === "leader")).toBe(
      true,
    );
    expect(turns.some((t) => t.kind === "teammateTurn" && t.entryId === "claude:wfmember:turn:0")).toBe(true);
  });
});

describe("buildTeamThread — threaded teammate turns (6_2)", () => {
  it("threads each member's turns (leader + peer) into the leader timeline by time", async () => {
    const detail = await readClaudeDetail("leader", { configDir: TEAM_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    const turns = (detail?.timeline ?? []).filter((i) => i.kind === "teammateTurn");
    // member-a: 1 turn (from leader); member-b: 2 turns (from leader + a peer DM).
    expect(turns).toHaveLength(3);
    const byEntry = new Map(turns.map((t) => [t.kind === "teammateTurn" ? t.entryId : "", t]));
    const a0 = byEntry.get("claude:member-a:turn:0");
    expect(a0?.kind === "teammateTurn" && a0.agentName).toBe("reviewer-a");
    expect(a0?.kind === "teammateTurn" && a0.from).toBe("leader");
    expect(a0?.kind === "teammateTurn" && a0.preview).toContain("review this");
    // The peer DM (reviewer-a → reviewer-b) is its own node, attributed to the peer.
    const bPeer = byEntry.get("claude:member-b:turn:1");
    expect(bPeer?.kind === "teammateTurn" && bPeer.from).toBe("reviewer-a");
    // No team GROUP node remains in the leader timeline.
    expect((detail?.timeline ?? []).some((i) => i.kind === "subagentSession" && i.entryId.includes(":team:"))).toBe(
      false,
    );
  });

  it("W3: a member's own detail does not thread peers under itself", async () => {
    const detail = await readClaudeDetail("member-a", { configDir: TEAM_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    expect((detail?.timeline ?? []).some((i) => i.kind === "teammateTurn")).toBe(false);
  });
});

describe("inbound teammate-message rendering (D16)", () => {
  it("renders the leader's inbound reply as a teammateMessage (clean body), not a raw USER turn", async () => {
    const detail = await readClaudeDetail("leader", { configDir: TEAM_FIXTURE_ROOT });
    expect(detail).not.toBeNull();
    const tm = (detail?.timeline ?? []).find((i) => i.kind === "teammateMessage");
    expect(tm?.kind === "teammateMessage" && tm.agentName).toBe("reviewer-a");
    expect(tm?.kind === "teammateMessage" && tm.from).toBe("peer");
    expect(tm?.kind === "teammateMessage" && tm.color).toBe("blue");
    expect(tm?.kind === "teammateMessage" && tm.text).toBe("found 2 issues in the auth path");
    // The literal tag must NEVER leak into any message text.
    const leaked = (detail?.timeline ?? []).some(
      (i) => "text" in i && typeof i.text === "string" && i.text.includes("<teammate-message"),
    );
    expect(leaked).toBe(false);
  });

  it("R5: surfaces a summary-only inbound message (empty body) using its summary, never drops it", async () => {
    // reviewer-b's reply is `<teammate-message … summary="build passed"></teammate-message>`
    // — an empty body. Before the fix the empty body unwrapped to nothing and the
    // record vanished from the timeline; now it falls back to the summary text.
    const detail = await readClaudeDetail("leader", { configDir: TEAM_FIXTURE_ROOT });
    const tms = (detail?.timeline ?? []).filter((i) => i.kind === "teammateMessage");
    const b = tms.find((i) => i.kind === "teammateMessage" && i.agentName === "reviewer-b");
    expect(b?.kind === "teammateMessage" && b.text).toBe("build passed");
  });

  it("renders an incoming request inside a member transcript as a teammateMessage from the leader", async () => {
    // member-a's first record is `<teammate-message teammate_id="team-lead">review this</teammate-message>`.
    const detail = await readClaudeDetail("member-a", { configDir: TEAM_FIXTURE_ROOT });
    const tm = (detail?.timeline ?? []).find((i) => i.kind === "teammateMessage");
    expect(tm?.kind === "teammateMessage" && tm.from).toBe("leader");
    expect(tm?.kind === "teammateMessage" && tm.text).toBe("review this");
  });

  it("the opened turn segment leads with the clean incoming message, not the raw tag", async () => {
    const detail = await readClaudeDetail("member-a:turn:0", { configDir: TEAM_FIXTURE_ROOT });
    const first = (detail?.timeline ?? [])[0];
    expect(first?.kind).toBe("teammateMessage");
    expect(first?.kind === "teammateMessage" && first.text).toBe("review this");
  });
});

describe("readClaudeSessions incremental", () => {
  // Build a throwaway store with one project dir + one session file we can mutate.
  async function makeStore(): Promise<{ configDir: string; file: string; cleanup: () => Promise<void> }> {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-claude-inc-"));
    const projDir = path.join(root, "projects", "-Users-me-proj");
    await fsp.mkdir(projDir, { recursive: true });
    const file = path.join(projDir, "sess-1.jsonl");
    await fsp.writeFile(
      file,
      [
        JSON.stringify({ type: "user", cwd: "/Users/me/proj", message: { content: "ORIGINAL prompt title" } }),
        JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-8" } }),
      ].join("\n"),
    );
    return { configDir: root, file, cleanup: () => fsp.rm(root, { recursive: true, force: true }) };
  }

  it("reuses the cached entry without re-reading the body when (mtime,size) is unchanged", async () => {
    const { configDir, cleanup } = await makeStore();
    try {
      const first = await readClaudeSessions({ configDir });
      expect(first.entries).toHaveLength(1);
      expect(first.cache.kind).toBe("files");

      // Poison the cached entry's title: if the reader re-reads the body, it would
      // overwrite this with "ORIGINAL prompt title". Reuse must preserve it.
      const poisoned = structuredClone(first.cache);
      if (poisoned.kind === "files") {
        for (const k of Object.keys(poisoned.files)) {
          poisoned.files[k].entry = { ...poisoned.files[k].entry, title: "CACHED_TITLE" };
        }
      }
      const second = await readClaudeSessions({ configDir }, poisoned);
      expect(second.entries[0].title).toBe("CACHED_TITLE");
    } finally {
      await cleanup();
    }
  });

  it("re-reads a file whose mtime changed", async () => {
    const { configDir, file, cleanup } = await makeStore();
    try {
      const first = await readClaudeSessions({ configDir });
      const poisoned = structuredClone(first.cache);
      if (poisoned.kind === "files") {
        for (const k of Object.keys(poisoned.files)) {
          poisoned.files[k].entry = { ...poisoned.files[k].entry, title: "CACHED_TITLE" };
        }
      }
      // Bump mtime forward → stamp mismatch → rebuild from the (unchanged) body.
      const future = new Date(Date.now() + 60_000);
      await fsp.utimes(file, future, future);
      const second = await readClaudeSessions({ configDir }, poisoned);
      expect(second.entries[0].title).toBe("ORIGINAL prompt title");
    } finally {
      await cleanup();
    }
  });

  it("drops a cached entry whose file no longer exists", async () => {
    const { configDir, file, cleanup } = await makeStore();
    try {
      const first = await readClaudeSessions({ configDir });
      await fsp.rm(file);
      const second = await readClaudeSessions({ configDir }, first.cache);
      expect(second.entries).toHaveLength(0);
      if (second.cache.kind === "files") {
        expect(Object.keys(second.cache.files)).toHaveLength(0);
      }
    } finally {
      await cleanup();
    }
  });
});
