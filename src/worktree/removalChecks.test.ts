import { describe, expect, it } from "vitest";
import { checksFor, countOf, failed, isRefusedByChecks } from "./removalChecks";
import type { RemovalAssessment } from "./worktreeBlockers";

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
    const checks = checksFor({
      kind: "refused",
      isMain: false,
      liveExternalSessionIds: [],
      busyAgents: 2,
      containsWorktrees: [{ worktreeId: "/wt/a", displayPath: "a" }],
    });

    expect(checks.map((c) => c.id)).toEqual(["isMain", "busyAgents", "containsWorktrees"]);
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
