// src/vault/readers/subagentLookup.test.ts — Unit tests for clicked-description → detail.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every `realpath` the lookup asks for. The real implementation is kept — these
 * tests need a real store on disk — and only counted through, because the claim
 * is about how MANY times the projects root is resolved, not what it answers.
 */
const realpathCalls: string[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    realpath: (p: Parameters<typeof actual.realpath>[0], ...rest: unknown[]) => {
      realpathCalls.push(String(p));
      return (actual.realpath as (...a: unknown[]) => unknown)(p, ...rest);
    },
  };
});

import { resolveSubagentDetail, resolveSubagentDetailByEntryId } from "./subagentLookup";

let tmpRoot: string;
let subagentsDir: string;
const PARENT = "parent-session";

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anywhere-subagent-"));
  // Mirror the real store layout: <root>/projects/<encoded-cwd>/<parent>/subagents/.
  subagentsDir = path.join(tmpRoot, "projects", "-work-proj", PARENT, "subagents");
  await fs.mkdir(subagentsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function opts() {
  return { configDir: tmpRoot };
}

/** Write a subagent transcript + its meta sidecar. */
async function writeSubagent(stem: string, description: string, firstText = "do the thing"): Promise<void> {
  const record = {
    type: "user",
    isSidechain: true,
    agentId: stem.replace(/^agent-/, ""),
    message: { role: "user", content: firstText },
    timestamp: "2026-06-01T00:00:00.000Z",
    uuid: `${stem}-u1`,
    parentUuid: null,
    sessionId: PARENT,
  };
  await fs.writeFile(path.join(subagentsDir, `${stem}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
  await fs.writeFile(
    path.join(subagentsDir, `${stem}.meta.json`),
    JSON.stringify({ agentType: "Explore", description }),
    "utf8",
  );
}

describe("resolveSubagentDetail", () => {
  it("matches a stub by exact description and returns its detail with the subagent entryId", async () => {
    await writeSubagent("agent-aaa", "Find the auth middleware");

    const detail = await resolveSubagentDetail(PARENT, "Find the auth middleware", opts());

    expect(detail).not.toBeNull();
    expect(detail?.entryId).toBe(`claude:${PARENT}:subagent:agent-aaa`);
  });

  it("matches by PREFIX (terminal right-edge clipping drops trailing chars)", async () => {
    await writeSubagent("agent-bbb", "Find the session preview rendering code");

    const detail = await resolveSubagentDetail(PARENT, "Find the session preview", opts());

    expect(detail?.entryId).toBe(`claude:${PARENT}:subagent:agent-bbb`);
  });

  it("returns null when no stub description starts with the clicked text", async () => {
    await writeSubagent("agent-ccc", "Refactor the parser");
    expect(await resolveSubagentDetail(PARENT, "Find the auth", opts())).toBeNull();
  });

  it("returns null for an empty/whitespace description", async () => {
    await writeSubagent("agent-ddd", "anything");
    expect(await resolveSubagentDetail(PARENT, "   ", opts())).toBeNull();
  });

  it("returns null when the parent session has no subagents", async () => {
    expect(await resolveSubagentDetail("unknown-parent", "whatever", opts())).toBeNull();
  });

  it("breaks ties on shared prefix by newest file mtime", async () => {
    await writeSubagent("agent-old", "Find things everywhere");
    await writeSubagent("agent-new", "Find things in the codebase");
    // Make agent-new's transcript strictly newer.
    const old = new Date("2026-06-01T00:00:00Z");
    const recent = new Date("2026-06-01T01:00:00Z");
    await fs.utimes(path.join(subagentsDir, "agent-old.jsonl"), old, old);
    await fs.utimes(path.join(subagentsDir, "agent-new.jsonl"), recent, recent);

    const detail = await resolveSubagentDetail(PARENT, "Find things", opts());
    expect(detail?.entryId).toBe(`claude:${PARENT}:subagent:agent-new`);
  });

  it("does not resolve the projects root once per tied candidate", async () => {
    // The tie-break loop already owns every candidate, so the root is one answer
    // it should ask for once. Asserted as INDEPENDENCE from the tie's size rather
    // than as an absolute count: the winner's own detail read legitimately
    // resolves again, and pinning the total would break on any unrelated change
    // to that read (design.md D8, review round-2 W1).
    const projectsDir = path.join(tmpRoot, "projects");
    const rootResolvesForTieOf = async (stems: string[]): Promise<number> => {
      for (const stem of stems) {
        await writeSubagent(stem, `Find things ${stem}`);
      }
      realpathCalls.length = 0;
      expect(await resolveSubagentDetail(PARENT, "Find things", opts())).not.toBeNull();
      return realpathCalls.filter((p) => p === projectsDir).length;
    };

    const small = await rootResolvesForTieOf(["agent-a", "agent-b"]);
    const large = await rootResolvesForTieOf(["agent-c", "agent-d", "agent-e", "agent-f"]);
    expect(large).toBe(small);
  });
});

// support-nested-subagent-preview D5 — the terminal popup's nested drill-down
// resolves a child directly by its vault entryId (no live-terminal matching).
describe("resolveSubagentDetailByEntryId", () => {
  it("resolves a Claude subagent child by its vault entryId", async () => {
    await writeSubagent("agent-eee", "Trace the spawn", "child work");
    const detail = await resolveSubagentDetailByEntryId(`claude:${PARENT}:subagent:agent-eee`, opts());
    expect(detail?.entryId).toBe(`claude:${PARENT}:subagent:agent-eee`);
  });

  it("returns null for a non-Claude entryId (subagent popups are Claude-only)", async () => {
    expect(await resolveSubagentDetailByEntryId(`codex:${PARENT}:subagent:agent-eee`, opts())).toBeNull();
  });

  it("returns null for an unresolvable id", async () => {
    expect(await resolveSubagentDetailByEntryId("claude:nope:subagent:agent-zzz", opts())).toBeNull();
  });
});
