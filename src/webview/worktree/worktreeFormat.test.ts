// The Worktree view's pure derivations: the age clock, the branch label, marker
// precedence, and how the collapsed pill groups. No DOM — these are the rules the
// renderers only apply.

import { describe, expect, it } from "vitest";
import { agentRow, worktree } from "./worktreeFixtures";
import {
  agentCountLabel,
  ageTimestamp,
  branchLabel,
  compactAge,
  groupPresenceByActivity,
  hasProvenIdentity,
  isFallbackActivity,
  stripDecorations,
  strongestActivity,
  worktreeBadges,
  worktreePills,
  worktreeTooltip,
} from "./worktreeFormat";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("stripDecorations", () => {
  it("drops leading spinner frames", () => {
    expect(stripDecorations("⠋ Working on it")).toBe("Working on it");
    expect(stripDecorations("✻ Thinking…")).toBe("Thinking…");
  });

  it("leaves a title that only looks like a frame alone", () => {
    // A path is not an animation, and clipping it would corrupt the title.
    expect(stripDecorations("/Users/dev/repo")).toBe("/Users/dev/repo");
    expect(stripDecorations("build-agent")).toBe("build-agent");
  });

  it("strips a lone ASCII frame followed by space", () => {
    expect(stripDecorations("/ compiling")).toBe("compiling");
  });

  it("returns empty for a title that is only frames", () => {
    expect(stripDecorations("⠹⠸ ")).toBe("");
    expect(stripDecorations(undefined)).toBe("");
  });
});

describe("compactAge", () => {
  it("uses the compact vocabulary, not the vault list's '5m ago'", () => {
    expect(compactAge(NOW - 10_000, NOW)).toBe("now");
    expect(compactAge(NOW - 5 * MINUTE, NOW)).toBe("5m");
    expect(compactAge(NOW - 3 * HOUR, NOW)).toBe("3h");
    expect(compactAge(NOW - 3 * DAY, NOW)).toBe("3d");
  });

  it("renders nothing for an absent or future timestamp", () => {
    expect(compactAge(undefined, NOW)).toBe("");
    expect(compactAge(NOW + MINUTE, NOW)).toBe("");
    expect(compactAge(0, NOW)).toBe("");
  });
});

describe("ageTimestamp", () => {
  it("counts from when the current state began while a row is working", () => {
    const row = agentRow({
      rowId: "a",
      activity: "running",
      stateStartedAt: NOW - MINUTE,
      finishedAt: NOW - 5 * HOUR,
    });
    expect(compactAge(ageTimestamp(row), NOW)).toBe("1m");
  });

  it("counts from when it finished once a row is done", () => {
    // A row must never rank as freshly done while showing a stale age, so the two
    // clocks are chosen by state rather than merged.
    const row = agentRow({
      rowId: "a",
      activity: "idle",
      stateStartedAt: NOW - MINUTE,
      finishedAt: NOW - 2 * HOUR,
    });
    expect(compactAge(ageTimestamp(row), NOW)).toBe("2h");
  });
});

describe("branchLabel", () => {
  it("names a branch, a detached sha, and a bare worktree differently", () => {
    expect(branchLabel(worktree({ id: "/a", branch: "feat/x" }))).toEqual({ text: "feat/x", variant: "branch" });
    expect(
      branchLabel(worktree({ id: "/a", detached: true, head: "9f2c1ab0000000000000000000000000000000ab" })),
    ).toEqual({ text: "9f2c1ab", variant: "sha" });
    expect(branchLabel(worktree({ id: "/a", bare: true }))).toEqual({ text: "bare", variant: "bare" });
  });
});

describe("markers", () => {
  it("pills name which worktree it is", () => {
    expect(worktreePills(worktree({ id: "/a", kind: "main", inWorkspace: true }))).toEqual([
      { text: "main", kind: "main" },
      { text: "here", kind: "here" },
    ]);
    expect(worktreePills(worktree({ id: "/a" }))).toEqual([]);
  });

  it("shows missing instead of prunable when both are true", () => {
    const badges = worktreeBadges(worktree({ id: "/a", missing: true, prunable: true }));
    expect(badges.map((b) => b.kind)).toEqual(["missing"]);
  });

  it("keeps prunable when the directory is still there", () => {
    expect(worktreeBadges(worktree({ id: "/a", prunable: true })).map((b) => b.kind)).toEqual(["prunable"]);
  });

  it("carries the lock reason on the locked badge", () => {
    const badges = worktreeBadges(worktree({ id: "/a", locked: true, lockReason: "publishing" }));
    expect(badges[0]).toEqual({ kind: "locked", title: "locked: publishing" });
  });
});

describe("worktreeTooltip", () => {
  it("carries the path, which no row element ever shows", () => {
    const tip = worktreeTooltip(worktree({ id: "/a", displayPath: "/repo/wt", branch: "feat/x" }));
    expect(tip).toBe("feat/x\n/repo/wt");
  });
});

describe("strongestActivity", () => {
  it("reads as waiting when one waits among four running", () => {
    const rows = [
      agentRow({ rowId: "1", activity: "running" }),
      agentRow({ rowId: "2", activity: "running" }),
      agentRow({ rowId: "3", activity: "waiting" }),
      agentRow({ rowId: "4", activity: "running" }),
      agentRow({ rowId: "5", activity: "running" }),
    ];
    expect(strongestActivity(rows)).toBe("waiting");
  });

  it("is undefined for a worktree with no agents, so the row keeps its branch glyph", () => {
    expect(strongestActivity([])).toBeUndefined();
  });
});

describe("groupPresenceByActivity", () => {
  it("groups by state, caps icons at three, and overflows with a count", () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => agentRow({ rowId: `r${i}`, agent: "claude", activity: "running" })),
      agentRow({ rowId: "i1", agent: "cursor", activity: "idle" }),
    ];
    const groups = groupPresenceByActivity(rows);
    expect(groups.map((g) => g.activity)).toEqual(["running", "idle"]);
    expect(groups[0]?.agents).toHaveLength(3);
    expect(groups[0]?.overflow).toBe(4);
    expect(groups[1]?.overflow).toBe(0);
  });

  it("counts an unproven row without contributing an icon for it", () => {
    const groups = groupPresenceByActivity([
      agentRow({ rowId: "a", agentSource: "none", activity: "idle" }),
      agentRow({ rowId: "b", agent: "claude", agentSource: "title", activity: "idle" }),
    ]);
    expect(groups[0]?.agents).toEqual([]);
    expect(groups[0]?.overflow).toBe(2);
  });
});

describe("evidence sources", () => {
  it("derives identity and activity confidence independently", () => {
    // A row can be sure of one and uncertain about the other; one field could not
    // carry both answers, which is why the sources travel intact.
    const titleIdentityHookActivity = agentRow({
      rowId: "a",
      agent: "claude",
      agentSource: "title",
      activitySource: "hook",
    });
    expect(hasProvenIdentity(titleIdentityHookActivity)).toBe(false);
    expect(isFallbackActivity(titleIdentityHookActivity.activitySource)).toBe(false);

    const launchIdentityOutputActivity = agentRow({
      rowId: "b",
      agent: "claude",
      agentSource: "launch",
      activitySource: "output",
    });
    expect(hasProvenIdentity(launchIdentityOutputActivity)).toBe(true);
    expect(isFallbackActivity(launchIdentityOutputActivity.activitySource)).toBe(true);
  });
});

describe("agentCountLabel", () => {
  it("is plural-safe", () => {
    expect(agentCountLabel(1)).toBe("1 agent");
    expect(agentCountLabel(3)).toBe("3 agents");
  });
});
