// The Worktree view's pure derivations: the age clock, the branch label, marker
// precedence, and how the collapsed pill groups. No DOM — these are the rules the
// renderers only apply.

import { describe, expect, it } from "vitest";
import { agentRow, worktree } from "./worktreeFixtures";
import type { PresentedActivity } from "./worktreeFormat";
import {
  agentCountLabel,
  ageTimestamp,
  branchLabel,
  CONFIRMATION_CEILING_MS,
  compactAge,
  groupPresenceByActivity,
  hasProvenIdentity,
  isFallbackActivity,
  PRESENTED_ORDER,
  PRESENTED_STRENGTH,
  presentedActivity,
  presentedPreview,
  stripDecorations,
  strongestActivity,
  worktreeBadges,
  worktreePills,
  worktreeTooltip,
} from "./worktreeFormat";
import type { PresenceDegradation, WorktreeAgentRow } from "./worktreeViewTypes";

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
      { text: "open", kind: "open" },
    ]);
    expect(worktreePills(worktree({ id: "/a" }))).toEqual([]);
  });

  it("marks every worktree the workspace holds open, not just one", () => {
    // A multi-root workspace can hold two worktrees of one repo. The mark says
    // "open as a workspace folder", so carrying it twice is correct — the old
    // wording ("here") read as the user's single current location.
    for (const id of ["/a", "/b"]) {
      expect(worktreePills(worktree({ id, inWorkspace: true }))).toEqual([{ text: "open", kind: "open" }]);
    }
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
    expect(strongestActivity(rows, [], NOW)).toBe("waiting");
  });

  it("is undefined for a worktree with no agents, so the row keeps its branch glyph", () => {
    expect(strongestActivity([], [], NOW)).toBeUndefined();
  });

  it("ranks unknown above idle — a row nothing could read outranks one settled at rest", () => {
    const rows = [
      agentRow({ rowId: "1", activity: "idle", activitySource: "hook" }),
      agentRow({ rowId: "2", activity: "exited", activitySource: "hook" }),
    ];
    expect(strongestActivity(rows, [{ source: "hook", reason: "boom", since: NOW }], NOW)).toBe("unknown");
  });

  it("ranks what is shown, not what was sent — a degraded running row does not read as running", () => {
    const rows = [agentRow({ rowId: "1", activity: "running", activitySource: "output" })];
    expect(strongestActivity(rows, [{ source: "panes", reason: "boom", since: NOW }], NOW)).toBe("unknown");
  });

  it("still lets a waiting row from a live source outrank an unknown one", () => {
    const rows = [
      agentRow({ rowId: "1", activity: "running", activitySource: "output" }),
      agentRow({ rowId: "2", activity: "waiting", activitySource: "hook" }),
    ];
    expect(strongestActivity(rows, [{ source: "panes", reason: "boom", since: NOW }], NOW)).toBe("waiting");
  });

  it("ignores a repo's own listing failure — that says which worktrees exist, not what agents do", () => {
    // `degraded` on a repo never reaches here; only presence sources do. Guards the inversion
    // where one failed git listing turns every row in the repo unknown.
    const rows = [agentRow({ rowId: "1", activity: "running", activitySource: "output" })];
    expect(strongestActivity(rows, [], NOW)).toBe("running");
  });
});

describe("presentedActivity", () => {
  const degraded = (source: PresenceDegradation["source"]): PresenceDegradation[] => [
    { source, reason: "boom", since: NOW },
  ];

  it("reads unknown when no source spoke for the row at all", () => {
    const row = agentRow({ rowId: "1", activity: "idle", activitySource: "none" });
    expect(presentedActivity(row, [], NOW)).toBe("unknown");
  });

  it("reads unknown when the source that would have decided the row is degraded", () => {
    // One mapping per row: hook → hook, output and title → panes, registry → registry.
    expect(presentedActivity(agentRow({ rowId: "1", activitySource: "hook" }), degraded("hook"), NOW)).toBe("unknown");
    expect(presentedActivity(agentRow({ rowId: "2", activitySource: "output" }), degraded("panes"), NOW)).toBe(
      "unknown",
    );
    expect(presentedActivity(agentRow({ rowId: "3", activitySource: "title" }), degraded("panes"), NOW)).toBe(
      "unknown",
    );
    expect(presentedActivity(agentRow({ rowId: "4", activitySource: "registry" }), degraded("registry"), NOW)).toBe(
      "unknown",
    );
  });

  it("keeps the activity when some OTHER source is the degraded one", () => {
    const row = agentRow({ rowId: "1", activity: "running", activitySource: "hook" });
    expect(presentedActivity(row, degraded("panes"), NOW)).toBe("running");
    expect(presentedActivity(row, degraded("registry"), NOW)).toBe("running");
    // `vault` decides no row's activity, so it never turns one unknown.
    expect(presentedActivity(row, degraded("vault"), NOW)).toBe("running");
  });

  it("passes the activity through when nothing is degraded", () => {
    for (const activity of ["running", "waiting", "idle", "exited"] as const) {
      expect(presentedActivity(agentRow({ rowId: "1", activity }), [], NOW)).toBe(activity);
    }
  });
});

describe("the two presented orders", () => {
  // They answer different questions — exact display vocabulary versus aggregate
  // rank — and the design says they may diverge in ORDER. What they may never
  // diverge in is MEMBERSHIP: a state missing from the vocabulary is dropped from
  // the collapsed pill, and one missing from the rank cannot win a worktree row.
  // Byte-identical today is exactly what makes that easy to miss.
  // Against the UNION, not against each other: two arrays that agree can still
  // both be missing the same member, and a state absent from the vocabulary is
  // dropped from the collapsed pill while one absent from the rank can never win
  // a worktree row. The Record makes adding a member to `PresentedActivity`
  // fail to compile here until it is listed.
  const ALL: Record<PresentedActivity, true> = {
    waiting: true,
    running: true,
    "running-unconfirmed": true,
    unknown: true,
    idle: true,
    exited: true,
  };
  const EVERY = Object.keys(ALL).sort();

  it("each carry every presented state the type allows", () => {
    expect([...PRESENTED_ORDER].sort()).toEqual(EVERY);
    expect([...PRESENTED_STRENGTH].sort()).toEqual(EVERY);
  });
});

describe("the confirmation ceiling", () => {
  const stale = (over: Partial<WorktreeAgentRow> = {}) =>
    agentRow({
      rowId: "r",
      activity: "running",
      activitySource: "output",
      stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
      ...over,
    });

  it("[I17] stops confirming an output-inferred run once the state has stood unchanged past the ceiling", () => {
    expect(presentedActivity(stale(), [], NOW)).toBe("running-unconfirmed");
  });

  it("still confirms the same row one millisecond under the ceiling", () => {
    expect(presentedActivity(stale({ stateStartedAt: NOW - CONFIRMATION_CEILING_MS + 1 }), [], NOW)).toBe("running");
  });

  it("never marks a reported or external row, at any age", () => {
    // `hook` is a declaration and `registry` is a claim that a session is live,
    // not that a turn is in progress. Neither is manufacturable by a spinner.
    for (const source of ["hook", "registry"] as const) {
      expect(presentedActivity(stale({ activitySource: source, stateStartedAt: 0 }), [], NOW)).toBe("running");
    }
  });

  it("never marks a state other than running", () => {
    for (const activity of ["waiting", "idle", "exited"] as const) {
      expect(presentedActivity(stale({ activity, stateStartedAt: 0 }), [], NOW)).toBe(activity);
    }
  });

  it("treats an absent or impossible clock as confirmed rather than manufacturing staleness", () => {
    expect(presentedActivity(stale({ stateStartedAt: undefined }), [], NOW)).toBe("running");
    expect(presentedActivity(stale({ stateStartedAt: NOW + 60_000 }), [], NOW)).toBe("running");
  });

  it("lets unknown win — a source that failed cannot support a claim of running at all", () => {
    const degraded = [{ source: "panes" as const, reason: "scan failed", since: NOW }];
    expect(presentedActivity(stale(), degraded, NOW)).toBe("unknown");
    // And the clock never paused: clearing the failure lands straight on unconfirmed.
    expect(presentedActivity(stale(), [], NOW)).toBe("running-unconfirmed");
  });

  it("restarts on a change of activity but not on a change of source", () => {
    // A hook report confirms the row outright...
    expect(presentedActivity(stale({ activitySource: "hook" }), [], NOW)).toBe("running");
    // ...and when it ages out, the claim is unconfirmed immediately: `stateStartedAt`
    // did not move when the source changed, so there is no fresh grace period.
    expect(presentedActivity(stale(), [], NOW)).toBe("running-unconfirmed");
    // A genuine activity change moves the clock, so the row is confirmed again.
    expect(presentedActivity(stale({ stateStartedAt: NOW }), [], NOW)).toBe("running");
  });

  it("ranks as running, and loses to a confirmed run", () => {
    const rows = [stale({ rowId: "a" }), agentRow({ rowId: "b", activity: "running", activitySource: "hook" })];
    expect(strongestActivity(rows, [], NOW)).toBe("running");
    expect(strongestActivity([...rows].reverse(), [], NOW)).toBe("running");
  });

  it("reads as unconfirmed only when every running claim it holds is", () => {
    const rows = [stale({ rowId: "a" }), agentRow({ rowId: "b", activity: "idle", activitySource: "hook" })];
    expect(strongestActivity(rows, [], NOW)).toBe("running-unconfirmed");
    expect(
      strongestActivity([...rows, agentRow({ rowId: "c", activity: "waiting", activitySource: "hook" })], [], NOW),
    ).toBe("waiting");
  });

  it("counts into the collapsed pill under its own state, never omitted", () => {
    const rows = [stale({ rowId: "a", agent: "claude" }), agentRow({ rowId: "b", agent: "claude", activity: "idle" })];
    const groups = groupPresenceByActivity(rows, [], NOW);
    expect(groups.map((g) => g.activity)).toEqual(["running-unconfirmed", "idle"]);
  });
});

describe("groupPresenceByActivity", () => {
  it("groups by state, caps icons at three, and overflows with a count", () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => agentRow({ rowId: `r${i}`, agent: "claude", activity: "running" })),
      agentRow({ rowId: "i1", agent: "cursor", activity: "idle" }),
    ];
    const groups = groupPresenceByActivity(rows, [], NOW);
    expect(groups.map((g) => g.activity)).toEqual(["running", "idle"]);
    expect(groups[0]?.agents).toHaveLength(3);
    expect(groups[0]?.overflow).toBe(4);
    expect(groups[1]?.overflow).toBe(0);
  });

  it("counts an unproven row without contributing an icon for it", () => {
    const groups = groupPresenceByActivity(
      [
        agentRow({ rowId: "a", agentSource: "none", activity: "idle" }),
        agentRow({ rowId: "b", agent: "claude", agentSource: "title", activity: "idle" }),
      ],
      [],
      NOW,
    );
    expect(groups[0]?.agents).toEqual([]);
    expect(groups[0]?.overflow).toBe(2);
  });
});

describe("evidence sources", () => {
  it("[I4] derives identity and activity confidence independently", () => {
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

  // A report comes from inside the agent, under a credential issued to that one
  // terminal for that one run — the strongest proof of identity there is, not a
  // guess like a matching title (.reviews/round-2.md B1).
  it("counts the agent that reported itself as proven", () => {
    const reported = agentRow({ rowId: "c", agent: "opencode", agentSource: "report", activitySource: "output" });

    expect(hasProvenIdentity(reported)).toBe(true);
  });
});

describe("agentCountLabel", () => {
  it("is plural-safe", () => {
    expect(agentCountLabel(1)).toBe("1 agent");
    expect(agentCountLabel(3)).toBe("3 agents");
  });
});

describe("presentedPreview", () => {
  it("withholds a preview that repeats the row's title", () => {
    expect(presentedPreview(agentRow({ rowId: "a", title: "Building", preview: "Building" }))).toBe("");
  });

  it("withholds a preview that repeats a title carrying a spinner frame", () => {
    expect(presentedPreview(agentRow({ rowId: "a", title: "\u280b Building", preview: "Building" }))).toBe("");
  });

  it.each([[""], ["   "]])("withholds a blank preview (%j)", (preview) => {
    expect(presentedPreview(agentRow({ rowId: "a", title: "Building", preview }))).toBe("");
  });

  it("draws a preview that differs from the title by one word", () => {
    const row = agentRow({ rowId: "a", title: "Building", preview: "Building the extension" });
    expect(presentedPreview(row)).toBe("Building the extension");
  });

  it("never normalizes the preview, so a marker the title's stripper would eat survives", () => {
    // `stripDecorations` turns "* Building" into "Building" and "*" into "". Running
    // it over a preview is what worktree-agent-presence forbids: in message text the
    // marker is content, so neither of these is a repeat of the title beside it.
    expect(presentedPreview(agentRow({ rowId: "a", title: "Building", preview: "* Building" }))).toBe("* Building");
    expect(presentedPreview(agentRow({ rowId: "a", title: "", preview: "*" }))).toBe("*");
  });

  it("draws a preview reading like the placeholder on a row with no title", () => {
    // An untitled row DISPLAYS "(untitled)", but that is a placeholder rather than a
    // title, so a preview saying the same words is not repeating anything.
    expect(presentedPreview(agentRow({ rowId: "a", title: "", preview: "(untitled)" }))).toBe("(untitled)");
  });
});
