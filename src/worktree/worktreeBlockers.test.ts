import { describe, expect, it } from "vitest";
import type { WorktreeInfo } from "./types";
import { evaluateRemoval, type RemovalInput } from "./worktreeBlockers";

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

function input(over: Partial<RemovalInput> = {}): RemovalInput {
  const target = over.target ?? wt("/repo/wt-a");
  return {
    target,
    siblings: [wt("/repo", { kind: "main" }), target],
    panes: [],
    rows: [],
    externalSessions: { ok: true, value: [] },
    porcelain: { ok: true, value: "" },
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

  it("leaves a session in ANOTHER window confirmable rather than refusing", () => {
    // presenceProjector emits every external registry session with a hardcoded
    // activity of "running". Counting those as busyAgents would turn the
    // accepted confirmable externalAgents blocker into an unconditional refusal,
    // and one open session elsewhere would make a worktree unremovable forever.
    const result = evaluateRemoval(
      input({
        rows: [{ scope: "external", activity: "running" }],
        externalSessions: { ok: true, value: [{ sessionId: "s-1", cwd: "/repo/wt-a/pkg" }] },
      }),
    );
    expect(result.kind).toBe("confirmable");
    if (result.kind !== "confirmable") {
      return;
    }
    expect(result.evidence.externalSessionIds).toEqual(["s-1"]);
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
    const result = evaluateRemoval(input({ externalSessions: { ok: false } }));
    expect(result).toEqual({ kind: "unavailable", unreadable: ["sessions"] });
  });

  it("reports a degraded listing, whose siblings cannot be trusted", () => {
    // `containsWorktrees` is derived from the listing, so a stale one can miss
    // a nested registration entirely — the refusal that would have saved it.
    const result = evaluateRemoval(input({ listingDegraded: true }));
    expect(result).toEqual({ kind: "unavailable", unreadable: ["listing"] });
  });

  it("names every source that failed, not just the first", () => {
    const result = evaluateRemoval(
      input({ porcelain: { ok: false }, externalSessions: { ok: false }, listingDegraded: true }),
    );
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
      input({ target: missing, porcelain: { ok: "notApplicable" }, externalSessions: { ok: false } }),
    );
    expect(result).toEqual({ kind: "unavailable", unreadable: ["sessions"] });
  });

  it("keeps reporting an unreadable status on a directory that is present", () => {
    // The negative that keeps D16 intact: only an ABSENT directory is exempt.
    const result = evaluateRemoval(input({ porcelain: { ok: false } }));
    expect(result).toEqual({ kind: "unavailable", unreadable: ["status"] });
  });
});
