import { describe, expect, it } from "vitest";
import type { RemovalEvidence } from "./worktreeBlockers";
import { createFingerprintStore, FINGERPRINT_TTL_MS } from "./worktreeFingerprint";

/** The same worktree, same incarnation — what every pre-existing case assumed. */
const WT = { worktreeId: "wt" };

function evidence(over: Partial<RemovalEvidence> = {}): RemovalEvidence {
  return {
    dirtyPaths: [],
    untrackedPaths: [],
    paneIds: [],
    externalSessionIds: [],
    notApplicable: [],
    ignored: { kind: "measured", entries: 0, bytes: 0 },
    proofs: { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven" },
    locked: false,
    lockReason: null,
    ...over,
  };
}

describe("createFingerprintStore", () => {
  it("proceeds when nothing changed", () => {
    const store = createFingerprintStore();
    const e = evidence({ dirtyPaths: ["a.ts"], paneIds: ["p1"] });
    const fp = store.issue(WT, e, 0);
    expect(store.redeem(WT, fp, e, 1_000)).toMatchObject({ kind: "proceed" });
  });

  it("proceeds when strictly less is at risk than was approved", () => {
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence({ dirtyPaths: ["a.ts", "b.ts"], paneIds: ["p1", "p2"] }), 0);
    expect(store.redeem(WT, fp, evidence({ dirtyPaths: ["a.ts"], paneIds: ["p1"] }), 1_000)).toMatchObject({
      kind: "proceed",
    });
  });

  it("re-prompts when one dirty file is swapped for another at equal count", () => {
    // THE case counts cannot see: `dirty: true` and `untracked: 1` are both
    // unchanged while the actual files at risk are entirely different ones.
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence({ dirtyPaths: ["README.md"] }), 0);
    expect(store.redeem(WT, fp, evidence({ dirtyPaths: [".env"] }), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("re-prompts when one pane closes and another opens", () => {
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence({ paneIds: ["A"] }), 0);
    expect(store.redeem(WT, fp, evidence({ paneIds: ["B"] }), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("re-prompts when an external session is substituted", () => {
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence({ externalSessionIds: ["s1"] }), 0);
    expect(store.redeem(WT, fp, evidence({ externalSessionIds: ["s2"] }), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("re-prompts when a blocker appears that was not there", () => {
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence(), 0);
    expect(store.redeem(WT, fp, evidence({ untrackedPaths: ["new.txt"] }), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("re-prompts when the worktree became locked after the confirmation", () => {
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence(), 0);
    expect(store.redeem(WT, fp, evidence({ locked: true }), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("proceeds when a lock was released after the confirmation", () => {
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence({ locked: true }), 0);
    expect(store.redeem(WT, fp, evidence({ locked: false }), 1_000)).toMatchObject({ kind: "proceed" });
  });

  it("authorizes nothing with a fingerprint this host never issued", () => {
    const store = createFingerprintStore();
    store.issue(WT, evidence(), 0);
    expect(store.redeem(WT, "not-a-real-fingerprint", evidence(), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("authorizes nothing once the fingerprint has expired", () => {
    // A fingerprint recovered from stale webview state must not remove a
    // worktree minutes after the user saw what was at risk.
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence(), 0);
    expect(store.redeem(WT, fp, evidence(), FINGERPRINT_TTL_MS + 1)).toEqual({ kind: "reprompt" });
  });

  it("does not let one worktree's fingerprint authorize another's removal", () => {
    const store = createFingerprintStore();
    const fp = store.issue({ worktreeId: "wt-a" }, evidence(), 0);
    expect(store.redeem({ worktreeId: "wt-b" }, fp, evidence(), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("replaces a worktree's issued entry rather than accumulating them", () => {
    // Bounded by replacement, not only by expiry: one entry per worktree.
    const store = createFingerprintStore();
    const first = store.issue(WT, evidence({ dirtyPaths: ["a.ts"] }), 0);
    store.issue(WT, evidence({ dirtyPaths: ["b.ts"] }), 10);
    // Measured BEFORE the redeem: redeeming now spends the record (B5), so a
    // count taken afterwards would read 0 whether or not the second issue had
    // replaced the first, and would stop testing replacement at all.
    expect(store.size()).toBe(1);
    expect(store.redeem(WT, first, evidence({ dirtyPaths: ["a.ts"] }), 20)).toEqual({ kind: "reprompt" });
    expect(store.size()).toBe(0);
  });

  it("gives different evidence different fingerprints", () => {
    const store = createFingerprintStore();
    const a = store.issue(WT, evidence({ dirtyPaths: ["a.ts"] }), 0);
    const b = store.issue(WT, evidence({ dirtyPaths: ["b.ts"] }), 0);
    expect(a).not.toBe(b);
  });

  it("spends the confirmation, so the same token cannot authorize a second attempt", () => {
    // The first attempt may have half-run: a killed `git worktree remove`
    // leaves the registration and some of the directory, and the evidence the
    // user read is exactly what it was in the middle of changing. Re-asking is
    // the only honest move, so the token must not survive being spent
    // (round-1 B5).
    const store = createFingerprintStore();
    const e = evidence({ dirtyPaths: ["a.ts"] });
    const fp = store.issue(WT, e, 0);
    expect(store.redeem(WT, fp, e, 1_000)).toMatchObject({ kind: "proceed" });
    expect(store.redeem(WT, fp, e, 1_100)).toEqual({ kind: "reprompt" });
  });

  it("spends it even when it refused, so a refusal is not a free retry", () => {
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence({ dirtyPaths: ["a.ts"] }), 0);
    expect(store.redeem(WT, fp, evidence({ dirtyPaths: [".env"] }), 10)).toEqual({ kind: "reprompt" });
    // The original evidence would have satisfied it. The token is gone anyway.
    expect(store.redeem(WT, fp, evidence({ dirtyPaths: ["a.ts"] }), 20)).toEqual({ kind: "reprompt" });
  });

  it("refuses a confirmation for a worktree that was observed to disappear", () => {
    // Remove `feat-a`, create `feat-a` again: same id, same empty evidence, so
    // the digest compares equal. What separates them is that the host SAW the
    // worktree go — and that observation is what destroys the token (D15).
    const store = createFingerprintStore();
    const fp = store.issue(WT, evidence(), 0);
    store.forget("wt");
    expect(store.redeem(WT, fp, evidence(), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("forgets only the worktree that vanished", () => {
    const store = createFingerprintStore();
    const a = store.issue({ worktreeId: "wt-a" }, evidence(), 0);
    store.issue({ worktreeId: "wt-b" }, evidence(), 0);
    store.forget("wt-b");
    expect(store.redeem({ worktreeId: "wt-a" }, a, evidence(), 10)).toMatchObject({ kind: "proceed" });
  });

  it("releases an expired record rather than holding it and refusing it", () => {
    // Refusing is not releasing: the store lives as long as the host, so a
    // record kept past its TTL is a leak the TTL appears to have prevented
    // (round-1 W2).
    const store = createFingerprintStore();
    store.issue({ worktreeId: "wt-a" }, evidence({ dirtyPaths: ["a.ts"] }), 0);
    store.issue({ worktreeId: "wt-b" }, evidence(), 0);
    expect(store.size()).toBe(2);
    store.issue({ worktreeId: "wt-c" }, evidence(), FINGERPRINT_TTL_MS + 1);
    expect(store.size()).toBe(1);
  });
});

describe("ignored material that appeared after the confirmation", () => {
  const store = () => createFingerprintStore();
  const measured = (entries: number, bytes: number) => evidence({ ignored: { kind: "measured", entries, bytes } });

  it("re-prompts when there is more to delete than the user was shown", () => {
    // An `npm install` between reading the confirmation and typing it. The
    // count the user weighed is not the count the removal will destroy.
    const s = store();
    const fp = s.issue(WT, measured(0, 0), 0);

    expect(s.redeem(WT, fp, measured(4_000, 900_000), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("proceeds on exactly what was confirmed", () => {
    const s = store();
    const fp = s.issue(WT, measured(12, 5_000), 0);

    expect(s.redeem(WT, fp, measured(12, 5_000), 1_000)).toMatchObject({ kind: "proceed" });
  });

  it("proceeds when less is there than was confirmed", () => {
    const s = store();
    const fp = s.issue(WT, measured(12, 5_000), 0);

    expect(s.redeem(WT, fp, measured(3, 40), 1_000)).toMatchObject({ kind: "proceed" });
  });

  it("re-prompts when the same entry count grew in bytes", () => {
    // The substitution the identity lists exist to catch, in the one dimension
    // that has no identities: 12 files, one of them now a gigabyte.
    const s = store();
    const fp = s.issue(WT, measured(12, 5_000), 0);

    expect(s.redeem(WT, fp, measured(12, 5_000_000), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("re-prompts when a reading the user saw became unmeasurable", () => {
    // The user confirmed "12 entries, 5 KB". "We can no longer tell" is not a
    // subset of that — it is an unbounded amount the confirmation never named.
    const s = store();
    const fp = s.issue(WT, measured(12, 5_000), 0);

    expect(s.redeem(WT, fp, evidence({ ignored: { kind: "unproven", reason: "budget" } }), 1_000)).toEqual({
      kind: "reprompt",
    });
  });

  it("re-prompts when an unmeasurable reading became a measured failure", () => {
    // Round-1 B1. I had argued the other way — confirming an amount nobody
    // could bound authorizes any amount — but the accepted spec is about
    // OUTCOMES, not magnitudes: a check that was not failing at confirmation
    // time and is failing now re-prompts, and `unproven` is not failing.
    const s = store();
    const fp = s.issue(WT, evidence({ ignored: { kind: "unproven", reason: "unreadable" } }), 0);

    expect(s.redeem(WT, fp, measured(4_000, 900_000), 1_000)).toEqual({ kind: "reprompt" });
  });

  it("proceeds when an unmeasurable reading became a measured nothing", () => {
    // Not a failure, so there is nothing new for the user to weigh. Strictly
    // better information about strictly less risk.
    const s = store();
    const fp = s.issue(WT, evidence({ ignored: { kind: "unproven", reason: "unreadable" } }), 0);

    expect(s.redeem(WT, fp, measured(0, 0), 1_000)).toMatchObject({ kind: "proceed" });
  });

  it("proceeds when an unmeasurable reading is still unmeasurable", () => {
    const s = store();
    const fp = s.issue(WT, evidence({ ignored: { kind: "unproven", reason: "budget" } }), 0);

    expect(s.redeem(WT, fp, evidence({ ignored: { kind: "unproven", reason: "budget" } }), 1_000)).toMatchObject({
      kind: "proceed",
    });
  });

  it("binds the fingerprint to the reading it was issued for", () => {
    // One worktree, alike in every tracked way across the two readings and
    // different only in what the removal will delete.
    const s = store();
    const small = s.issue(WT, measured(1, 10), 0);
    const large = s.issue(WT, measured(9, 90), 0);

    expect(small).not.toBe(large);
  });
});

describe("a proof is not a risk (design.md D2)", () => {
  const withProofs = (over: Partial<RemovalEvidence["proofs"]>) =>
    evidence({ proofs: { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven", ...over } });

  it("proceeds when a proof changed between the confirmation and the redeem", () => {
    // The case § 3.1 describes and calls out as NOT riskier: someone merged the
    // branch. Folding the proofs into the digest would re-prompt an irreversible
    // action the user already weighed, over a change in its favour.
    const store = createFingerprintStore();
    const fp = store.issue(WT, withProofs({ branchMerged: "failed" }), 0);

    expect(store.redeem(WT, fp, withProofs({ branchMerged: "passed" }), 1_000)).toMatchObject({ kind: "proceed" });
  });

  it("proceeds when a proof DEGRADED, which is the direction that looks like a risk", () => {
    // Passed → unproven is what § 3.1 says must withdraw the option a proof
    // gated. Withdrawing the option is the offer's job; re-prompting the removal
    // is not, and nothing about the removal got riskier.
    const store = createFingerprintStore();
    const fp = store.issue(WT, withProofs({ ownerGone: "passed", lockAged: "passed" }), 0);

    expect(store.redeem(WT, fp, withProofs({ ownerGone: "unproven", lockAged: "failed" }), 1_000)).toMatchObject({
      kind: "proceed",
    });
  });
});

describe("redemption returns the issued evidence, not a fresh reading (design.md D10)", () => {
  const merged = (mergeEvidence: NonNullable<RemovalEvidence["proofs"]["mergeEvidence"]>) =>
    evidence({ proofs: { lockAged: "unproven", ownerGone: "unproven", branchMerged: "passed", mergeEvidence } });

  it("hands back exactly the RemovalEvidence object that was issued", () => {
    const store = createFingerprintStore();
    const issued = merged({ branch: "feature", branchOid: "a".repeat(40), base: "main", baseOid: "b".repeat(40) });
    const fp = store.issue(WT, issued, 0);

    expect(store.redeem(WT, fp, issued, 1_000)).toEqual({ kind: "proceed", approved: issued });
  });

  it("a branch that moved between issue and redemption is still described by the OID it was proven at", () => {
    // Proofs are not folded into the digest (D2) and never re-prompt on their
    // own, so this redemption still proceeds. What matters for the guard it
    // feeds is which OID rides along: the branch's CURRENT commit, not the
    // one the merge was proven against — never the fresh, moved one.
    const store = createFingerprintStore();
    const issuedOid = "a".repeat(40);
    const movedOid = "c".repeat(40);
    const issued = merged({ branch: "feature", branchOid: issuedOid, base: "main", baseOid: "b".repeat(40) });
    const fp = store.issue(WT, issued, 0);
    const current = merged({ branch: "feature", branchOid: movedOid, base: "main", baseOid: "b".repeat(40) });

    const result = store.redeem(WT, fp, current, 1_000);

    expect(result).toMatchObject({ kind: "proceed" });
    expect(result.kind === "proceed" ? result.approved.proofs.mergeEvidence?.branchOid : undefined).toBe(issuedOid);
    expect(result.kind === "proceed" ? result.approved.proofs.mergeEvidence?.branchOid : undefined).not.toBe(movedOid);
  });
});
