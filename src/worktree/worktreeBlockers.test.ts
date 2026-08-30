import { describe, expect, it } from "vitest";
import type { PaneActivity } from "../shared/paneEvidence";
import type { WorktreeInfo } from "./types";
import {
  evaluateRemoval,
  type RemovalInput,
  type SessionRead,
  type SessionRecord,
  type SourceRead,
} from "./worktreeBlockers";

function wt(id: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id,
    displayPath: id,
    kind: "linked",
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    ...over,
  } as WorktreeInfo;
}

/**
 * The two views the producer derives from one scan. Tests that do not exercise
 * the selection pass the same list twice — the canonical winner of a list with
 * no duplicates is the list.
 */
function sessionsOk(records: readonly SessionRecord[], over: Partial<SessionRead> = {}): SourceRead<SessionRead> {
  return { ok: true, value: { live: records, canonical: records, partial: false, ...over } };
}

function input(over: Partial<RemovalInput> = {}): RemovalInput {
  const target = over.target ?? wt("/repo/wt-a");
  return {
    target,
    siblings: [wt("/repo", { kind: "main" }), target],
    panes: [],
    rows: [],
    sessions: sessionsOk([]),
    claimedByPane: new Map(),
    porcelain: { ok: true, value: "" },
    ignored: { kind: "measured", entries: 0, bytes: 0 },
    proofs: { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven" },
    ...over,
  };
}

describe("evaluateRemoval", () => {
  it("reports an empty set for a clean worktree", () => {
    const result = evaluateRemoval(input());
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence).toMatchObject({
      dirtyPaths: [],
      untrackedPaths: [],
      paneIds: [],
      externalSessionIds: [],
      locked: false,
    });
  });

  it("refuses the main worktree", () => {
    const main = wt("/repo", { kind: "main" });
    const result = evaluateRemoval(input({ target: main, siblings: [main] }));
    expect(result).toMatchObject({ kind: "refused", isMain: true });
  });

  it("refuses a worktree holding an agent mid-turn in this window", () => {
    const result = evaluateRemoval(input({ rows: [{ scope: "window", activity: "running" }] }));
    expect(result).toMatchObject({ kind: "refused", busyAgents: 1, isMain: false });
  });

  it("counts a waiting agent as busy, not merely a running one", () => {
    const result = evaluateRemoval(input({ rows: [{ scope: "window", activity: "waiting" }] }));
    expect(result).toMatchObject({ kind: "refused", busyAgents: 1 });
  });

  it("leaves a PROVABLY IDLE session in another window confirmable", () => {
    // Counted once, as externalAgents and never additionally as busyAgents:
    // presenceProjector emits every external registry session as a row with a
    // hardcoded activity, and scoring one session twice would refuse on the
    // strength of the same fact read from two places.
    const result = evaluateRemoval(
      input({
        rows: [{ scope: "external", activity: "running" }],
        sessions: sessionsOk([
          { sessionId: "s-1", entryId: "claude:s-1", cwd: "/repo/wt-a/pkg", activity: "idle", alive: true },
        ]),
      }),
    );
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence.externalSessionIds).toEqual(["s-1"]);
  });

  describe("an external session that is not provably idle (worktree-removal.md § 2, § 3)", () => {
    const rooted = (activity: PaneActivity | undefined) =>
      input({
        sessions: sessionsOk([
          { sessionId: "s-1", entryId: "claude:s-1", cwd: "/repo/wt-a/pkg", activity, alive: true },
        ]),
      });

    it.each(["running", "waiting"] as const)("refuses a session reporting %s", (activity) => {
      const result = evaluateRemoval(rooted(activity));
      expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
    });

    it("refuses a session whose activity cannot be determined", () => {
      // The registry records no activity at all, so this is the case production
      // actually takes. "We could not ask" is not evidence of idleness (§ 3),
      // and this is the one action that cannot be undone.
      const result = evaluateRemoval(rooted(undefined));
      expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
    });

    it("carries no fingerprint, so the refusal cannot be confirmed past", () => {
      const result = evaluateRemoval(rooted(undefined));
      expect(result.kind).toBe("refused");
      expect(Object.hasOwn(result, "evidence")).toBe(false);
    });

    it("ignores a session rooted OUTSIDE the target", () => {
      const result = evaluateRemoval(
        input({
          sessions: sessionsOk([
            { sessionId: "s-1", entryId: "claude:s-1", cwd: "/repo/wt-b", activity: undefined, alive: true },
          ]),
        }),
      );
      expect(result.kind).toBe("confirmable");
    });

    it("a duplicate the registry does not consider canonical does not refuse", () => {
      // THE ordering contract (round-1 B2). One session id, two live records:
      // the interactive one is rooted elsewhere and is the registry's canonical
      // winner; the headless resume record is rooted inside the target. The
      // winner is chosen over every live record user-wide and only THEN tested
      // for containment, so this removal is not refused. Choosing from the
      // records already inside the target reverses that order and refuses.
      const inside = { sessionId: "s-1", entryId: "claude:s-1", cwd: "/repo/wt-a", activity: undefined, alive: true };
      const outside = { sessionId: "s-1", entryId: "claude:s-1", cwd: "/elsewhere", activity: undefined, alive: true };
      const result = evaluateRemoval(input({ sessions: sessionsOk([inside, outside], { canonical: [outside] }) }));

      expect(result.kind).toBe("confirmable");
      if (result.kind !== "confirmable") {
        return;
      }
      expect(result.evidence.externalSessionIds).toEqual([]);
    });

    it("reports the canonical record it was handed, not one per raw record", () => {
      // `live` carries both; only `canonical` is consulted, so a session is
      // named once without this module deduping anything itself.
      const here = { sessionId: "s-1", entryId: "claude:s-1", cwd: "/repo/wt-a", activity: undefined, alive: true };
      const result = evaluateRemoval(input({ sessions: sessionsOk([here, here], { canonical: [here] }) }));

      expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
    });

    it("counts one session once — refusing, never also as a busy agent", () => {
      const result = evaluateRemoval(
        input({
          rows: [{ scope: "external", activity: "running" }],
          sessions: sessionsOk([
            { sessionId: "s-1", entryId: "claude:s-1", cwd: "/repo/wt-a", activity: undefined, alive: true },
          ]),
        }),
      );
      expect(result).toMatchObject({ kind: "refused", busyAgents: 0, liveExternalSessionIds: ["s-1"] });
    });

    it("stays unavailable, not refused, when the registry could not be read", () => {
      // Unreadable is the absence of an answer; refused is an answer. Only the
      // first is worth retrying.
      const result = evaluateRemoval(input({ sessions: { ok: false } }));
      expect(result).toMatchObject({ kind: "unavailable" });
    });
  });

  it("refuses a worktree containing a registered worktree, and names every child", () => {
    const target = wt("/repo/wt-a");
    const result = evaluateRemoval(
      input({
        target,
        siblings: [wt("/repo", { kind: "main" }), target, wt("/repo/wt-a/inner"), wt("/repo/wt-a/deep/nested")],
      }),
    );
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      return;
    }
    expect(result.containsWorktrees.map((c) => c.worktreeId)).toEqual(["/repo/wt-a/deep/nested", "/repo/wt-a/inner"]);
  });

  it("does not treat a sibling with a shared prefix as contained", () => {
    // `/repo/wt-alpha` starts with `/repo/wt-a` — a startsWith check would call
    // it nested and refuse a removal that is perfectly safe.
    const target = wt("/repo/wt-a");
    const result = evaluateRemoval(
      input({ target, siblings: [wt("/repo", { kind: "main" }), target, wt("/repo/wt-alpha")] }),
    );
    expect(result.kind).toBe("confirmable");
  });

  it("does not report the target as containing itself", () => {
    const result = evaluateRemoval(input());
    expect(result.kind).toBe("confirmable");
  });

  it("separates tracked changes from untracked files", () => {
    const result = evaluateRemoval(
      input({ porcelain: { ok: true, value: " M src/a.ts\n?? scratch.txt\nA  src/b.ts\n?? notes/\n" } }),
    );
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence.dirtyPaths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.evidence.untrackedPaths).toEqual(["notes/", "scratch.txt"]);
  });

  it("records a rename by the path a deletion would take", () => {
    const result = evaluateRemoval(input({ porcelain: { ok: true, value: "R  old.ts -> new.ts\n" } }));
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence.dirtyPaths).toEqual(["new.ts"]);
  });

  it("names the panes rooted in the worktree and ignores the ones that are not", () => {
    const result = evaluateRemoval(
      input({
        panes: [
          { paneId: "p1", cwd: "/repo/wt-a/src", activity: "idle" },
          { paneId: "p2", cwd: "/repo/other", activity: "idle" },
          { paneId: "p3", cwd: undefined, activity: "idle" },
        ],
      }),
    );
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence.paneIds).toEqual(["p1"]);
  });

  it("does not count a pane whose process already exited", () => {
    const result = evaluateRemoval(input({ panes: [{ paneId: "p1", cwd: "/repo/wt-a", activity: "exited" }] }));
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence.paneIds).toEqual([]);
  });

  it("carries the lock and its reason through as evidence", () => {
    const target = wt("/repo/wt-a", { locked: true, lockReason: "release build" });
    const result = evaluateRemoval(input({ target, siblings: [target] }));
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence).toMatchObject({ locked: true, lockReason: "release build" });
  });

  it("refuses before reading status, so a refusal carries no evidence to confirm", () => {
    const result = evaluateRemoval(
      input({ rows: [{ scope: "window", activity: "running" }], porcelain: { ok: true, value: " M dirty.ts\n" } }),
    );
    expect(result.kind).toBe("refused");
    expect(result).not.toHaveProperty("evidence");
  });
});

describe("evidence that could not be read", () => {
  it("reports an unreadable status instead of an empty blocker set", () => {
    // The case that made this a BLOCK: a failed `git status` used to become
    // `""`, which parses to no dirty files — indistinguishable from a clean
    // worktree, on the one action that cannot be undone (round-2 B6).
    const result = evaluateRemoval(input({ porcelain: { ok: false } }));
    expect(result).toEqual({ kind: "unavailable", unreadable: ["status"] });
  });

  it("reports an unreadable session registry", () => {
    const result = evaluateRemoval(input({ sessions: { ok: false } }));
    expect(result).toEqual({ kind: "unavailable", unreadable: ["sessions"] });
  });

  it("reports a degraded listing, whose siblings cannot be trusted", () => {
    // `containsWorktrees` is derived from the listing, so a stale one can miss
    // a nested registration entirely — the refusal that would have saved it.
    const result = evaluateRemoval(input({ listingDegraded: true }));
    expect(result).toEqual({ kind: "unavailable", unreadable: ["listing"] });
  });

  it("names every source that failed, not just the first", () => {
    const result = evaluateRemoval(input({ porcelain: { ok: false }, sessions: { ok: false }, listingDegraded: true }));
    expect(result).toMatchObject({ kind: "unavailable", unreadable: ["status", "sessions", "listing"] });
  });

  it("does not answer with a refusal it derived from unreadable state", () => {
    // A refusal is an answer. Deriving one from a listing we know to be stale
    // claims more than we know, even though it happens to be the safe verdict.
    const result = evaluateRemoval(input({ rows: [{ scope: "window", activity: "running" }], listingDegraded: true }));
    expect(result.kind).toBe("unavailable");
  });

  it("stays confirmable when every source read cleanly", () => {
    // The negatives above only mean something if the positive still holds.
    expect(evaluateRemoval(input({})).kind).toBe("confirmable");
  });
});

describe("a registration whose directory is gone is still removable", () => {
  // Round-3 B8. D16 made an unreadable status `unavailable`, which is right —
  // but a MISSING worktree has no directory to read, so every assessment came
  // back `unavailable` and the only action that clears a stale registration
  // could never run. `worktree-actions.md:348` says it succeeds.
  const missing = wt("/repo/wt-a", { missing: true, prunable: true });

  it("is confirmable on the evidence that still applies", () => {
    const result = evaluateRemoval(
      input({
        target: missing,
        siblings: [wt("/repo", { kind: "main" }), missing],
        porcelain: { ok: "notApplicable" },
      }),
    );
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence).toMatchObject({ dirtyPaths: [], untrackedPaths: [] });
  });

  it("does not report the absent directory as an unreadable source", () => {
    const result = evaluateRemoval(input({ target: missing, porcelain: { ok: "notApplicable" } }));
    expect(result).not.toMatchObject({ kind: "unavailable" });
  });

  it("still refuses it for a reason that does not depend on the directory", () => {
    // Not-applicable is narrow: it removes ONE source, not the assessment.
    const result = evaluateRemoval(
      input({
        target: missing,
        porcelain: { ok: "notApplicable" },
        rows: [{ scope: "window", activity: "running" }],
      }),
    );
    expect(result).toMatchObject({ kind: "refused", busyAgents: 1 });
  });

  it("is still unavailable when a source that DOES apply could not be read", () => {
    const result = evaluateRemoval(
      input({ target: missing, porcelain: { ok: "notApplicable" }, sessions: { ok: false } }),
    );
    expect(result).toEqual({ kind: "unavailable", unreadable: ["sessions"] });
  });

  it("keeps reporting an unreadable status on a directory that is present", () => {
    // The negative that keeps D16 intact: only an ABSENT directory is exempt.
    const result = evaluateRemoval(input({ porcelain: { ok: false } }));
    expect(result).toEqual({ kind: "unavailable", unreadable: ["status"] });
  });
});

describe("the ignored material the removal will delete", () => {
  it("carries the measurement onto the evidence, whole", () => {
    const result = evaluateRemoval(
      input({ ignored: { kind: "measured", entries: 3, bytes: 900, provisioned: { entries: 2 } } }),
    );

    expect(result.kind === "confirmable" && result.evidence.ignored).toEqual({
      kind: "measured",
      entries: 3,
      bytes: 900,
      provisioned: { entries: 2 },
    });
  });

  it("stays confirmable when the walk could not finish", () => {
    // § 2.3: a slow or unreadable disk must not make a worktree unremovable, so
    // this read never joins the sources that make an assessment `unavailable`.
    const result = evaluateRemoval(input({ ignored: { kind: "unproven", reason: "budget" } }));

    expect(result.kind).toBe("confirmable");
    expect(result.kind === "confirmable" && result.evidence.ignored).toEqual({
      kind: "unproven",
      reason: "budget",
    });
  });
});

// Cycle-2 B5. A claim used to be applied at the producer, against the LAST
// COMPLETED window pass — so a live Claude rooted in the target could vanish
// from both evidence sources at once: the pane that claimed it had no
// attributable cwd, or the pane set moved ahead of the debounced projection,
// and the registry record was dropped anyway. Suppression now happens here,
// where the target and the pane snapshot are both in hand, and only where this
// same assessment will classify the claiming pane.
describe("a registry session a pane in this window already holds", () => {
  const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
    sessionId: "s-1",
    entryId: "claude:s-1",
    cwd: "/repo/wt-a",
    activity: undefined,
    alive: true,
    ...over,
  });

  const withClaim = (panes: RemovalInput["panes"], claimedByPane: ReadonlyMap<string, string>) =>
    evaluateRemoval(
      input({
        panes,
        claimedByPane,
        sessions: sessionsOk([session()]),
      }),
    );

  it("counts it once, as the idle pane it is", () => {
    const result = withClaim(
      [{ paneId: "p-1", cwd: "/repo/wt-a", activity: "idle" }],
      new Map([["claude:s-1", "p-1"]]),
    );
    // Confirmable, and reported as the pane — not a second row for an unknown
    // external session, which would refuse (round-1 B2).
    expect(result).toMatchObject({ kind: "confirmable" });
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence.paneIds).toEqual(["p-1"]);
    expect(result.evidence.externalSessionIds).toEqual([]);
  });

  it("refuses when the claiming pane reports no directory", () => {
    // The pane is in this window, but nothing in this assessment attributes it
    // to the target — so it classifies nothing, and the registry record stands.
    const result = withClaim([{ paneId: "p-1", cwd: undefined, activity: "idle" }], new Map([["claude:s-1", "p-1"]]));
    expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
  });

  it("refuses when the claiming pane resolves outside the target", () => {
    const result = withClaim(
      [{ paneId: "p-1", cwd: "/repo/wt-b", activity: "idle" }],
      new Map([["claude:s-1", "p-1"]]),
    );
    expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
  });

  it("refuses when the claiming pane has exited", () => {
    // The pane is gone; whatever it was holding is not this window's any more.
    const result = withClaim(
      [{ paneId: "p-1", cwd: "/repo/wt-a", activity: "exited" }],
      new Map([["claude:s-1", "p-1"]]),
    );
    expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
  });

  it("refuses when the claim names a pane this snapshot no longer has", () => {
    // The stale-projection case B5 names: the claim outlived the pane it was
    // made by, and the registry record is the only evidence left.
    const result = withClaim(
      [{ paneId: "p-2", cwd: "/repo/wt-a", activity: "idle" }],
      new Map([["claude:s-1", "p-1"]]),
    );
    expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
  });

  // Round-4 B5. `busyAgents` is counted from the debounced projection while
  // `panes` is the live snapshot, so "the pane exists and has not exited" let a
  // stale idle row pair with a pane that is running RIGHT NOW — and the
  // registry record that would have refused was erased on the strength of it.
  it.each(["running", "waiting"] as const)("refuses when the claiming pane is %s", (activity) => {
    const result = withClaim([{ paneId: "p-1", cwd: "/repo/wt-a", activity }], new Map([["claude:s-1", "p-1"]]));
    expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
  });

  it("refuses when the claiming pane's activity is unknown", () => {
    // Same rule the registry record itself is held to: absent means live.
    const result = withClaim(
      [{ paneId: "p-1", cwd: "/repo/wt-a", activity: undefined }],
      new Map([["claude:s-1", "p-1"]]),
    );
    expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
  });

  it("still names a running claiming pane in the evidence when something else refuses nothing", () => {
    // `paneIds` answers a different question from suppression: a running pane
    // is still a pane the report should name. Only the SUPPRESSION tightened.
    const result = evaluateRemoval(
      input({
        panes: [{ paneId: "p-1", cwd: "/repo/wt-a", activity: "running" }],
        claimedByPane: new Map([["claude:s-1", "p-1"]]),
      }),
    );
    expect(result).toMatchObject({ kind: "confirmable" });
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence.paneIds).toEqual(["p-1"]);
  });

  it("refuses when nothing claimed it at all", () => {
    const result = withClaim([{ paneId: "p-1", cwd: "/repo/wt-a", activity: "idle" }], new Map());
    expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
  });
});
