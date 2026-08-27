// src/worktree/delegations.test.ts — a session's transcript as a delegation roster.
//
// The mapping is where "what the source recorded" becomes "what presence
// claims", so every test here is about a claim NOT made: never live, never
// complete without evidence, never an empty roster standing in for an unread one.

import { describe, expect, it } from "vitest";
import type { VaultSessionDetail, VaultTimelineItem } from "../vault/types";
import { rosterFromDetail } from "./delegations";

function detail(over: Partial<VaultSessionDetail> = {}): VaultSessionDetail {
  return {
    entryId: "claude:s1",
    timeline: [],
    stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
    ...over,
  } as VaultSessionDetail;
}

const session = (over: Partial<Extract<VaultTimelineItem, { kind: "subagentSession" }>> = {}): VaultTimelineItem =>
  ({
    kind: "subagentSession",
    entryId: "claude:s1:subagent:a",
    title: "Review the row anatomy",
    ...over,
  }) as VaultTimelineItem;

const step = (over: Record<string, unknown> = {}): VaultTimelineItem =>
  ({ kind: "subagent", name: "librarian", ...over }) as VaultTimelineItem;

describe("what becomes a delegation row", () => {
  it("takes both the folded child session and the bare call", () => {
    // A Task call whose child transcript was never matched is recorded as the
    // plain step — a delegation that happened with nothing to open. Taking only
    // the richer kind drops exactly the delegations with the thinnest evidence.
    const roster = rosterFromDetail(detail({ timeline: [session({ agent: "reviewer" }), step()] }));
    expect(roster.kind).toBe("ok");
    expect(roster.kind === "ok" && roster.rows.map((r) => r.name)).toEqual(["reviewer", "librarian"]);
  });

  it("takes the delegated task from the field each producer actually sets", () => {
    // Shaped as both readers emit an unmatched call: name + prompt, no title
    // (detail.ts, opencodeReader.ts). Reading only `title` renders the role
    // where the task belongs, on exactly the thinnest-evidence delegations.
    const roster = rosterFromDetail(detail({ timeline: [step({ prompt: "find the presence spec" })] }));
    expect(roster.kind === "ok" && roster.rows[0]?.title).toBe("find the presence spec");
  });

  it("keeps an explicit title over the prompt when the source set both", () => {
    const roster = rosterFromDetail(detail({ timeline: [step({ title: "Spec hunt", prompt: "find it" })] }));
    expect(roster.kind === "ok" && roster.rows[0]?.title).toBe("Spec hunt");
  });

  it("carries no task label when the source recorded neither field", () => {
    // The row must not invent one — the view falls back to the role itself.
    const roster = rosterFromDetail(detail({ timeline: [step()] }));
    expect(roster.kind === "ok" && roster.rows[0]?.title).toBeUndefined();
  });

  it("ignores everything that is not a delegation", () => {
    const roster = rosterFromDetail(
      detail({ timeline: [{ kind: "tool", tool: "read" } as VaultTimelineItem, session()] }),
    );
    expect(roster.kind === "ok" && roster.rows).toHaveLength(1);
  });

  it("never marks a row live, whatever the transcript recorded", () => {
    const roster = rosterFromDetail(detail({ timeline: [session({ status: "running" })] }));
    expect(roster.kind === "ok" && roster.rows[0]).toMatchObject({ status: "running", live: false });
  });

  it("calls an unrecorded status unknown rather than guessing an outcome", () => {
    const roster = rosterFromDetail(detail({ timeline: [session()] }));
    expect(roster.kind === "ok" && roster.rows[0]?.status).toBe("unknown");
  });

  it("keeps a drill-down only where the source has one", () => {
    const roster = rosterFromDetail(detail({ timeline: [session(), step()] }));
    expect(roster.kind === "ok" && roster.rows[0]?.entryId).toBe("claude:s1:subagent:a");
    expect(roster.kind === "ok" && roster.rows[1]?.entryId).toBeUndefined();
  });

  it("names a delegation by its declared agent, falling back to its title", () => {
    const roster = rosterFromDetail(detail({ timeline: [session({ agent: undefined, title: "Find the spec" })] }));
    expect(roster.kind === "ok" && roster.rows[0]?.name).toBe("Find the spec");
  });
});

describe("what makes a roster incomplete", () => {
  it("is incomplete when the source dropped records no read can recover", () => {
    const roster = rosterFromDetail(detail({ timeline: [session()], partial: true, limitedReason: "middle dropped" }));
    expect(roster.kind === "ok" && roster.incomplete).toBe(true);
  });

  it("is incomplete when a larger read would return more — there is no larger read", () => {
    // The read already asked for the reader's maximum, so pageability here is
    // permanent omission at this seam, not something a load-more can fix.
    const roster = rosterFromDetail(detail({ timeline: [session()], truncated: true }));
    expect(roster.kind === "ok" && roster.incomplete).toBe(true);
  });

  it("is incomplete when the source counted more delegations than it handed over", () => {
    const roster = rosterFromDetail(
      detail({ timeline: [session()], stats: { messageCount: 0, toolCount: 0, subagentCount: 4 } }),
    );
    expect(roster.kind === "ok" && roster.incomplete).toBe(true);
  });

  it("claims nothing when no signal reports omission", () => {
    const roster = rosterFromDetail(
      detail({ timeline: [session()], stats: { messageCount: 0, toolCount: 0, subagentCount: 1 } }),
    );
    expect(roster.kind === "ok" && roster.incomplete).toBeUndefined();
  });

  it("reports an empty roster for a session that delegated nothing", () => {
    expect(rosterFromDetail(detail())).toEqual({ kind: "ok", rows: [] });
  });
});
