import { describe, expect, it } from "vitest";
import { checksFor, countOf, failed, isRefusedByChecks } from "./removalChecks";
import type { RemovalAssessment, UnreadableSource } from "./worktreeBlockers";

const CATALOGUE_IDS = [
  "isMain",
  "busyAgents",
  "containsWorktrees",
  "dirty",
  "untracked",
  "idlePanes",
  "externalAgents",
  "locked",
];

function confirmable(over: {
  dirtyPaths?: readonly string[];
  untrackedPaths?: readonly string[];
  paneIds?: readonly string[];
  externalSessionIds?: readonly string[];
  locked?: boolean;
  notApplicable?: readonly UnreadableSource[];
}): RemovalAssessment {
  return {
    kind: "confirmable",
    evidence: {
      dirtyPaths: over.dirtyPaths ?? [],
      untrackedPaths: over.untrackedPaths ?? [],
      paneIds: over.paneIds ?? [],
      externalSessionIds: over.externalSessionIds ?? [],
      locked: over.locked ?? false,
      lockReason: null,
      notApplicable: over.notApplicable ?? [],
    },
  };
}

describe("checksFor", () => {
  it("reports every check unproven when nothing could be read", () => {
    // The distinction the boolean record could not carry: "no risk" and "the
    // risk could not be read" were the same empty set.
    const checks = checksFor({ kind: "unavailable", unreadable: ["status"] });

    expect(checks.map((c) => c.id)).toEqual(CATALOGUE_IDS);
    expect(checks.every((c) => c.outcome === "unproven")).toBe(true);
    expect(checks.find((c) => c.id === "dirty")?.detail).toBe("The status could not be read.");
    // A check whose own source did not fail still cannot claim it passed.
    expect(checks.find((c) => c.id === "busyAgents")?.detail).toBeUndefined();
    expect(isRefusedByChecks(checks)).toBe(false);
  });

  it("names each failed source on the checks it feeds", () => {
    const checks = checksFor({ kind: "unavailable", unreadable: ["sessions", "listing"] });

    expect(checks.find((c) => c.id === "idlePanes")?.detail).toBe("The sessions could not be read.");
    expect(checks.find((c) => c.id === "containsWorktrees")?.detail).toBe("The listing could not be read.");
    expect(checks.find((c) => c.id === "dirty")?.detail).toBeUndefined();
  });

  it("reports only the refusal checks when the removal was already refused", () => {
    // No confirmable evidence was gathered once the answer was no, so reporting
    // those checks as passed would claim a read that never happened.
    //
    // `externalAgents` is in this list because the sessions WERE read — an
    // unreadable registry returns `unavailable` before a refusal is reached —
    // so it is a refusal-class check here, not confirmable evidence.
    const checks = checksFor({
      kind: "refused",
      isMain: false,
      liveExternalSessionIds: [],
      busyAgents: 2,
      containsWorktrees: [{ worktreeId: "/wt/a", displayPath: "a" }],
    });

    expect(checks.map((c) => c.id)).toEqual(["isMain", "busyAgents", "containsWorktrees", "externalAgents"]);
    expect(checks.every((c) => c.cls === "refusal")).toBe(true);
    expect(isRefusedByChecks(checks)).toBe(true);
    expect(countOf(checks, "busyAgents")).toBe(2);
    expect(countOf(checks, "containsWorktrees")).toBe(1);
    expect(failed(checks, "isMain")).toBe(false);
  });

  it("passes every refusal check on a confirmable assessment", () => {
    const checks = checksFor(confirmable({ dirtyPaths: ["a.ts", "b.ts"] }));

    expect(checks.map((c) => c.id)).toEqual(CATALOGUE_IDS);
    expect(isRefusedByChecks(checks)).toBe(false);
    expect(failed(checks, "dirty")).toBe(true);
    expect(countOf(checks, "dirty")).toBe(2);
    expect(failed(checks, "untracked")).toBe(false);
  });

  it("carries a count for every magnitude the panel renders", () => {
    const checks = checksFor(
      confirmable({
        dirtyPaths: ["a.ts"],
        untrackedPaths: ["x", "y", "z"],
        paneIds: ["p1", "p2"],
        externalSessionIds: ["s1"],
        locked: true,
      }),
    );

    expect(countOf(checks, "untracked")).toBe(3);
    expect(countOf(checks, "idlePanes")).toBe(2);
    expect(countOf(checks, "externalAgents")).toBe(1);
    expect(failed(checks, "locked")).toBe(true);
    // `locked` is a boolean, not a magnitude — it carries no count to render.
    expect(checks.find((c) => c.id === "locked")?.count).toBeUndefined();
  });

  it("invents no outcome the sources cannot answer yet", () => {
    // `notApplicable` is on the wire; WT-013.1 adds the sources that produce it.
    const kinds: RemovalAssessment[] = [
      { kind: "unavailable", unreadable: ["status"] },
      { kind: "refused", isMain: true, busyAgents: 0, containsWorktrees: [], liveExternalSessionIds: [] },
      confirmable({}),
    ];

    for (const assessment of kinds) {
      expect(checksFor(assessment).some((c) => c.outcome === "notApplicable")).toBe(false);
    }
  });
});

describe("a check whose class its evidence decides (round-3 design.md D1)", () => {
  const refusedBy = (liveExternalSessionIds: readonly string[]): RemovalAssessment => ({
    kind: "refused",
    isMain: false,
    busyAgents: 0,
    containsWorktrees: [],
    liveExternalSessionIds,
  });

  it("reports externalAgents as a refusal when the session is not provably idle", () => {
    const checks = checksFor(refusedBy(["s-1"]));
    const external = checks.find((c) => c.id === "externalAgents");

    expect(external).toMatchObject({ cls: "refusal", outcome: "failed", count: 1 });
    expect(isRefusedByChecks(checks)).toBe(true);
  });

  it("reports externalAgents as confirmable when the session is provably idle", () => {
    // Same id, same row, different class — the class is what decides whether a
    // typed confirmation can authorize it, and that answer is the evidence's.
    const checks = checksFor(confirmable({ externalSessionIds: ["s-1"] }));
    const external = checks.find((c) => c.id === "externalAgents");

    expect(external).toMatchObject({ cls: "confirmable", outcome: "failed", count: 1 });
    expect(isRefusedByChecks(checks)).toBe(false);
  });

  it("keeps one id for both classes", () => {
    // Two ids would make the check list differ by outcome, which is the failure
    // the single catalogue exists to prevent, and would make the UI treat one
    // row as two.
    const refused = checksFor(refusedBy(["s-1"])).filter((c) => c.id === "externalAgents");
    const idle = checksFor(confirmable({})).filter((c) => c.id === "externalAgents");

    expect(refused).toHaveLength(1);
    expect(idle).toHaveLength(1);
  });

  it("keeps every check in a refusal refusal-class, including this one", () => {
    // `cls` answers whether a confirmation could authorize the check, and a
    // refusal authorizes nothing — so the class is uniform in that branch even
    // for the check whose class the evidence otherwise decides.
    for (const assessment of [refusedBy(["s-1"]), refusedBy([])]) {
      expect(checksFor(assessment).every((c) => c.cls === "refusal")).toBe(true);
    }
  });

  it("reports externalAgents passed, not absent, when a refusal came from elsewhere", () => {
    // A worktree refused for being main still had its sessions read, and a
    // check that ran and found nothing is a different report from one omitted.
    const checks = checksFor({
      kind: "refused",
      isMain: true,
      busyAgents: 0,
      containsWorktrees: [],
      liveExternalSessionIds: [],
    });

    expect(checks.find((c) => c.id === "externalAgents")).toMatchObject({ outcome: "passed", count: 0 });
  });
});

describe("a check whose question never arose (round-3 spec: notApplicable)", () => {
  it("reports the status-fed checks as notApplicable, not passed", () => {
    // A worktree whose directory is authoritatively gone has no working tree,
    // so `git status` is a read with no subject rather than one that failed —
    // and rendering that as "passed" claims a check ran that never applied.
    const checks = checksFor(confirmable({ notApplicable: ["status"] }));

    expect(checks.find((c) => c.id === "dirty")?.outcome).toBe("notApplicable");
    expect(checks.find((c) => c.id === "untracked")?.outcome).toBe("notApplicable");
  });

  it("leaves checks fed by a source that DID apply alone", () => {
    const checks = checksFor(confirmable({ notApplicable: ["status"], paneIds: ["p-1"] }));

    expect(checks.find((c) => c.id === "idlePanes")).toMatchObject({ outcome: "failed", count: 1 });
    expect(checks.find((c) => c.id === "containsWorktrees")?.outcome).toBe("passed");
  });

  it("is neither a failure nor a reading", () => {
    // The panel keys its clauses on these two. A notApplicable check that read
    // as either would put a magnitude nobody measured inside a `<b>`.
    const checks = checksFor(confirmable({ notApplicable: ["status"] }));

    expect(failed(checks, "dirty")).toBe(false);
    expect(countOf(checks, "dirty")).toBe(0);
    expect(isRefusedByChecks(checks)).toBe(false);
  });

  it("carries no count, so nothing can render one", () => {
    const dirty = checksFor(confirmable({ notApplicable: ["status"] })).find((c) => c.id === "dirty");

    expect(dirty && "count" in dirty).toBe(false);
  });

  it("still reports every catalogue id", () => {
    const checks = checksFor(confirmable({ notApplicable: ["status", "sessions"] }));

    expect(checks.map((c) => c.id)).toEqual(CATALOGUE_IDS);
  });
});
