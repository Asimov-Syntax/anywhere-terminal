import { describe, expect, it } from "vitest";
import type { RemovalCheck } from "../types/messages";
import type { IgnoredMaterial } from "./ignoredMaterial";
import type { OrphanProofs } from "./orphanProofs";
import { checksFor, countOf, failed, isRefusedByChecks } from "./removalChecks";
import type { RemovalAssessment, UnreadableSource } from "./worktreeBlockers";

/** Every proof unproven — this task's own Outcome, and what a fixture says when it is not about proofs. */
const UNPROVEN: OrphanProofs = { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven" };

const CATALOGUE_IDS = [
  "isMain",
  "busyAgents",
  "containsWorktrees",
  "dirty",
  "untracked",
  "idlePanes",
  "externalAgents",
  "locked",
  "ignored",
  "lockAged",
  "ownerGone",
  "branchMerged",
];

function confirmable(over: {
  dirtyPaths?: readonly string[];
  untrackedPaths?: readonly string[];
  paneIds?: readonly string[];
  externalSessionIds?: readonly string[];
  locked?: boolean;
  notApplicable?: readonly UnreadableSource[];
  ignored?: IgnoredMaterial;
  proofs?: OrphanProofs;
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
      // A measured nothing, not an absence: the default worktree these cases
      // describe is one the walk finished on and found no ignored material in.
      ignored: over.ignored ?? { kind: "measured", entries: 0, bytes: 0 },
      proofs: over.proofs ?? UNPROVEN,
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

describe("the ignored material a removal will delete", () => {
  it("reports a measured tree as a confirmable failure carrying its count", () => {
    const checks = checksFor(confirmable({ ignored: { kind: "measured", entries: 12, bytes: 5_242_880 } }));
    const ignored = checks.find((c) => c.id === "ignored");

    expect(ignored?.cls).toBe("confirmable");
    expect(ignored?.outcome).toBe("failed");
    expect(countOf(checks, "ignored")).toBe(12);
    // The size rides as prose because the magnitude element is the COUNT's.
    // Without it the panel says "12 ignored entries" about 5 MB or about 5 KB,
    // and those are different decisions.
    expect(ignored?.detail).toContain("5.0 MB");
  });

  it("passes on a tree the walk finished and found nothing in", () => {
    const checks = checksFor(confirmable({ ignored: { kind: "measured", entries: 0, bytes: 0 } }));
    const ignored = checks.find((c) => c.id === "ignored");

    expect(ignored?.outcome).toBe("passed");
    expect(failed(checks, "ignored")).toBe(false);
    // A passed check counted nothing worth naming. `countOf` already refuses to
    // read one, and attaching it anyway leaves a number for the next producer.
    expect(ignored?.count).toBeUndefined();
  });

  it("does not refuse the removal when the walk could not finish", () => {
    // worktree-removal.md § 2.3: a slow or unreadable disk must not make a
    // worktree unremovable. Unproven here is confirmable, and stays so.
    for (const reason of ["budget", "unreadable"] as const) {
      const checks = checksFor(confirmable({ ignored: { kind: "unproven", reason } }));
      const ignored = checks.find((c) => c.id === "ignored");

      expect(ignored?.outcome).toBe("unproven");
      expect(ignored?.cls).toBe("confirmable");
      expect(isRefusedByChecks(checks)).toBe(false);
      // A count on an unproven check is a number nobody measured, and the panel
      // renders it inside a `<b>` as a reading that was taken.
      expect(ignored?.count).toBeUndefined();
      expect(countOf(checks, "ignored")).toBe(0);
      expect(failed(checks, "ignored")).toBe(false);
    }
  });

  it("is reported in every branch the catalogue is reported in", () => {
    // The check list must not get shorter for a worse outcome. An unproven
    // ignored walk is still a check that exists.
    const unavailable = checksFor({ kind: "unavailable", unreadable: ["status"] });

    expect(unavailable.map((c) => c.id)).toEqual(CATALOGUE_IDS);
    expect(unavailable.find((c) => c.id === "ignored")?.outcome).toBe("unproven");
    // Its own source did not fail, so nothing claims it did.
    expect(unavailable.find((c) => c.id === "ignored")?.detail).toBeUndefined();
  });
});

describe("the three proofs (worktree-removal.md § 4)", () => {
  const proven = { lockAged: "passed", ownerGone: "passed", branchMerged: "failed" } as const;

  it("reports each proof's own outcome, in the proof class", () => {
    const checks = checksFor(confirmable({ proofs: proven }));

    expect(checks.filter((c) => c.cls === "proof")).toEqual([
      { id: "lockAged", cls: "proof", outcome: "passed" },
      { id: "ownerGone", cls: "proof", outcome: "passed" },
      { id: "branchMerged", cls: "proof", outcome: "failed" },
    ]);
  });

  it("carries notApplicable through as itself, not as a pass", () => {
    // An unlocked worktree's lock age was never in question. Reported as passed
    // it would say a lock went stale; as failed, that one is being held.
    const checks = checksFor(confirmable({ proofs: { ...proven, lockAged: "notApplicable" } }));

    expect(checks.find((c) => c.id === "lockAged")).toEqual({
      id: "lockAged",
      cls: "proof",
      outcome: "notApplicable",
    });
  });

  it("never refuses, whatever every proof says", () => {
    // § 2.2: a proof withholds only the option it gates. A failing proof making
    // `isRefusedByChecks` true would make a fresh lock un-removable.
    const checks = checksFor(
      confirmable({ proofs: { lockAged: "failed", ownerGone: "failed", branchMerged: "failed" } }),
    );

    expect(isRefusedByChecks(checks)).toBe(false);
  });

  it("is absent from a refused assessment, which gathered no evidence about them", () => {
    const checks = checksFor({
      kind: "refused",
      isMain: true,
      busyAgents: 0,
      containsWorktrees: [],
      liveExternalSessionIds: [],
    });

    expect(checks.some((c) => c.cls === "proof")).toBe(false);
  });

  it("changes nothing else about the report, whatever the proofs say", () => {
    // This task's whole Outcome, stated as the only thing that can be measured
    // from here: the proofs are ADDITIVE. Swap all three for their opposites and
    // every check that decided an offer before they existed is untouched.
    const unproven = checksFor(confirmable({ dirtyPaths: ["a.ts"], locked: true, proofs: UNPROVEN }));
    const answered = checksFor(
      confirmable({
        dirtyPaths: ["a.ts"],
        locked: true,
        proofs: { lockAged: "passed", ownerGone: "failed", branchMerged: "notApplicable" },
      }),
    );

    const nonProof = (checks: readonly RemovalCheck[]) => checks.filter((c) => c.cls !== "proof");
    expect(nonProof(answered)).toEqual(nonProof(unproven));
    expect(isRefusedByChecks(answered)).toBe(isRefusedByChecks(unproven));
    expect(countOf(answered, "dirty")).toBe(1);
  });
});
