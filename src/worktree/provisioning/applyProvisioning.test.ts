import { describe, expect, it } from "vitest";
import type { ProvisionEntry, ProvisionResultContest, ProvisionStepResult } from "../../types/messages";
import { afterDelay } from "../deadline";
import { fakeFs } from "./applyEntries.fake";
import { applyProvisioning, failEveryEntry } from "./applyProvisioning";
import { prepareEntryGate } from "./entryGate";

const MAIN = "/repo";
const WT = "/wt";

function entry(path: string, mode: ProvisionEntry["mode"], source: string, id = path): ProvisionEntry {
  return { id, path, mode, source };
}

async function applyTo(
  nodes: Parameters<typeof fakeFs>[0],
  entries: readonly ProvisionEntry[],
  options: Parameters<typeof fakeFs>[1] = {},
) {
  const fs = fakeFs({ [MAIN]: { kind: "dir" }, [WT]: { kind: "dir" }, ...nodes }, options);
  const roots = await prepareEntryGate(MAIN, WT, fs);
  if (roots === null) {
    throw new Error("the fake could not prepare its roots");
  }
  const deadline = afterDelay(60_000);
  try {
    const applied = await applyProvisioning(entries, roots, { maxNodes: 1000, maxBytes: 1_000_000, deadline }, fs);
    return { steps: applied.steps, contests: applied.contests, fs };
  } finally {
    deadline.cancel();
  }
}

/**
 * The declarations a step's contest names, as the report will render them.
 *
 * The membership is carried once per contest and referenced by index, so a
 * reason no longer repeats it — asserting on the reason text would witness the
 * quadratic shape this change removed.
 */
const named = (contests: readonly ProvisionResultContest[], step: ProvisionStepResult | undefined): readonly string[] =>
  (step?.contest === undefined ? [] : (contests[step.contest]?.members ?? [])).map(
    (member) => `${member.path} (declared in ${member.source})`,
  );

/** One file and one directory in the main checkout, for the entries below to name. */
const MATERIAL = { [`${MAIN}/.env`]: { kind: "file" }, [`${MAIN}/third_party`]: { kind: "dir" } } as const;

describe("applyProvisioning", () => {
  it("copies before it links, whatever order the provider listed them in", async () => {
    // The rule this orchestration exists to keep (worktree-apply.md § 1): a
    // link is only ever to material the copy pass may have just put there. It
    // lived in a closure in the extension's activation path, where no test
    // could reach it.
    const { fs } = await applyTo(MATERIAL, [
      entry("third_party", "link", "asimov/worktree.yaml"),
      entry(".env", "copy", "asimov/worktree.yaml"),
    ]);

    expect(fs.created).toEqual([`${WT}/.env`, `${WT}/third_party`]);
  });

  it("answers for every entry it was given, in the order the answers were produced", async () => {
    // The order the closure in the extension returned, which the webview keys
    // its provisioning state off: copies before links, whatever order the
    // provider listed them in (.reviews/round-1.md F003).
    const { steps } = await applyTo(MATERIAL, [
      entry("third_party", "link", "asimov/worktree.yaml"),
      entry(".env", "copy", "asimov/worktree.yaml"),
      entry("absent", "copy", "asimov/worktree.yaml"),
    ]);

    expect(steps.map((s) => [s.path, s.outcome.kind])).toEqual([
      [".env", "copied"],
      ["absent", "failed"],
      ["third_party", "linked"],
    ]);
  });

  it("shares one budget across every entry", async () => {
    // Minting it per entry multiplied the bound by the entry count (round-1
    // F007 of the apply change). Two entries of one node each against a
    // two-node budget: the second is the one that must not fit.
    const fs = fakeFs({
      [MAIN]: { kind: "dir" },
      [WT]: { kind: "dir" },
      [`${MAIN}/a`]: { kind: "file" },
      [`${MAIN}/b`]: { kind: "file" },
      [`${MAIN}/c`]: { kind: "file" },
    });
    const roots = await prepareEntryGate(MAIN, WT, fs);
    if (roots === null) {
      throw new Error("the fake could not prepare its roots");
    }
    const deadline = afterDelay(60_000);
    try {
      const { steps } = await applyProvisioning(
        [entry("a", "copy", "s"), entry("b", "copy", "s"), entry("c", "copy", "s")],
        roots,
        { maxNodes: 2, maxBytes: 1_000_000, deadline },
        fs,
      );

      expect(steps.map((s) => s.outcome.kind)).toEqual(["copied", "copied", "failed"]);
    } finally {
      deadline.cancel();
    }
  });
});

/**
 * A destination two selected declarations may both name.
 *
 * `MixedCase` and `mixedcase` are one entry on a folding volume and two on a
 * case-sensitive one, and the read path cannot tell which — it never asks a
 * filesystem anything (worktree-provisioning.md § 4.4). So both arrive
 * selected, and this is where the question is finally answerable.
 */
const NATIVE = ".vscode/worktree.json";
const INHERITED = "asimov/worktree.yaml";
const CONTESTED = {
  [`${MAIN}/MixedCase`]: { kind: "file", size: 11 },
  [`${MAIN}/mixedcase`]: { kind: "file", size: 22 },
} as const;
const PAIR = [entry("MixedCase", "copy", NATIVE, "i1"), entry("mixedcase", "copy", INHERITED, "i2")];

describe("a destination two declarations may both name", () => {
  it("leaves the repository's own declaration holding it, and refuses the other", async () => {
    const { steps, contests, fs } = await applyTo(CONTESTED, PAIR, { folds: true });

    expect(fs.nodes.get(`${WT}/MixedCase`)).toMatchObject({ size: 11 });
    expect(steps.map((s) => s.outcome.kind)).toEqual(["copied", "refused"]);
    // Both declarations, so the user can see what it was weighed against.
    expect(named(contests, steps[1])).toContain("MixedCase (declared in .vscode/worktree.json)");
  });

  it("refuses the held member even where this filesystem keeps the two spellings apart", async () => {
    // The volume here is non-folding, so the held destination reads absent
    // after the favoured member wrote — which is exactly the reading that used
    // to authorize the write. It is indistinguishable from the favoured
    // member's object having been unlinked on a FOLDING volume, where the same
    // write hands the destination to the inherited declaration
    // (.reviews/round-2.md F005). Refusing costs this member its material and
    // is the only settlement that cannot lose the destination.
    const { steps, contests, fs } = await applyTo(CONTESTED, PAIR);

    expect(steps.map((s) => s.outcome.kind)).toEqual(["copied", "refused"]);
    expect(fs.nodes.get(`${WT}/MixedCase`)).toMatchObject({ size: 11 });
    expect(fs.nodes.has(`${WT}/mixedcase`)).toBe(false);
    expect(named(contests, steps[1])).toEqual([
      "MixedCase (declared in .vscode/worktree.json)",
      "mixedcase (declared in asimov/worktree.yaml)",
    ]);
  });

  it("refuses BOTH when the destination was already there, and writes nothing", async () => {
    // Left to run, the favoured member merges into a destination it did not
    // create — `makeDirectory` answers `written` for an existing directory —
    // and installs neither its material nor its mode, while only the loser is
    // reported.
    const occupied = { ...CONTESTED, [`${WT}/MixedCase`]: { kind: "file", size: 99 } as const };
    const { steps, fs } = await applyTo(occupied, PAIR, { folds: true });

    expect(steps.map((s) => s.outcome.kind)).toEqual(["refused", "refused"]);
    expect(fs.created).toEqual([]);
    expect(fs.nodes.get(`${WT}/MixedCase`)).toMatchObject({ size: 99 });
  });

  it("refuses the other when the repository's own declaration never claimed it", async () => {
    // Neither source is there, so the favoured member fails before it claims
    // anything. One source would not do it: on a folding volume the fake
    // resolves the favoured spelling onto the other declaration's file.
    const { steps } = await applyTo({}, PAIR, { folds: true });

    expect(steps.map((s) => s.outcome.kind)).toEqual(["failed", "refused"]);
    expect(steps[1]?.outcome).toMatchObject({ reason: expect.stringContaining("never claimed") });
  });

  it("is not a contest at all when the repository's own declaration is unticked", async () => {
    // An unchecked favoured member must neither claim nor block a selected
    // inherited one (design.md D1).
    const { steps, fs } = await applyTo(CONTESTED, [PAIR[1] as ProvisionEntry], { folds: true });

    expect(steps.map((s) => s.outcome.kind)).toEqual(["copied"]);
    expect(fs.nodes.get(`${WT}/mixedcase`)).toMatchObject({ size: 22 });
  });

  it("moves no uncontested entry out of its place to settle a contest", async () => {
    // Promoting the favoured LINK ahead of the copy pass would create
    // `/wt/MixedCase` as a symlink out of the worktree, and the uncontested
    // `MixedCase/seed` copy would then resolve its parent through it and be
    // refused — a new refusal for an entry with no part in the dispute.
    const { steps } = await applyTo(
      {
        [`${MAIN}/MixedCase`]: { kind: "dir" },
        [`${MAIN}/MixedCase/seed`]: { kind: "file" },
        [`${MAIN}/mixedcase`]: { kind: "file", size: 22 },
      },
      [
        entry("MixedCase", "link", NATIVE, "i1"),
        entry("mixedcase", "copy", INHERITED, "i2"),
        entry("MixedCase/seed", "copy", INHERITED, "i3"),
      ],
      { folds: true },
    );

    // The uncontested entry keeps the outcome it has today. The contest itself
    // is refused rather than settled: `MixedCase/seed` had to create the
    // directory, so no member can claim that destination by its own write, and
    // neither declaration is written into what a third entry owns.
    expect(steps.map((s) => [s.path, s.outcome.kind])).toEqual([
      ["MixedCase/seed", "copied"],
      ["MixedCase", "refused"],
      ["mixedcase", "refused"],
    ]);
  });
});

describe("a collision this apply cannot attribute to its own write", () => {
  it("stops a pre-existing DIRECTORY destination instead of merging into it", async () => {
    // The state `EEXIST` cannot report: `makeDirectory` answers `written` for a
    // directory that was already there and the walk merges children in, so the
    // destination keeps ITS mode and gains the favoured member's contents —
    // neither declaration's outcome, and nothing in the step results says so.
    const occupied = {
      [`${MAIN}/MixedCase`]: { kind: "dir" } as const,
      [`${MAIN}/MixedCase/inner`]: { kind: "file", size: 11 } as const,
      [`${MAIN}/mixedcase`]: { kind: "dir" } as const,
      [`${MAIN}/mixedcase/other`]: { kind: "file", size: 22 } as const,
      [`${WT}/MixedCase`]: { kind: "dir", mode: 0o755 } as const,
    };
    const { steps, fs } = await applyTo(occupied, PAIR, { folds: true });

    expect(steps.map((s) => s.outcome.kind)).toEqual(["refused", "refused"]);
    expect(fs.created).toEqual([]);
    expect(fs.nodes.get(`${WT}/MixedCase/inner`)).toBeUndefined();
    expect(fs.nodes.get(`${WT}/MixedCase`)).toEqual({ kind: "dir", mode: 0o755 });
  });

  it("names BOTH declarations in each refusal, from each row", async () => {
    // The row a person reads is one entry's. Naming only the refused one leaves
    // them with a rule and no counterparty; naming only the other leaves them
    // unable to tell which row lost.
    const occupied = { ...CONTESTED, [`${WT}/MixedCase`]: { kind: "file", size: 99 } as const };
    const { steps, contests } = await applyTo(occupied, PAIR, { folds: true });

    // Its own spelling and declaring file, from its own row: the step result
    // carries no source and the notice renders `path: reason`, so what the row
    // cannot reach the user never gets (.reviews/round-1.md F004).
    for (const step of steps) {
      expect(named(contests, step)).toEqual([
        "MixedCase (declared in .vscode/worktree.json)",
        "mixedcase (declared in asimov/worktree.yaml)",
      ]);
    }
  });

  it("names both declarations when the favoured one never claimed the destination", async () => {
    const { steps, contests } = await applyTo({}, PAIR, { folds: true });

    expect(steps[1]).toMatchObject({ path: "mixedcase" });
    expect(named(contests, steps[1])).toEqual([
      "MixedCase (declared in .vscode/worktree.json)",
      "mixedcase (declared in asimov/worktree.yaml)",
    ]);
  });

  it("refuses a name that appeared during the apply rather than crediting it to the favoured member", async () => {
    // Absent when the reading was taken and present now — which may be the
    // favoured member folding onto it, a descendant another entry's directory
    // copy wrote, or another process. Nothing here tells those apart, so
    // reporting the loser as skipped-because-awarded would claim a causal fact
    // this apply cannot establish.
    const { steps, contests } = await applyTo(CONTESTED, PAIR, { folds: true });

    // And it claims nothing about who DIDN'T create it either: naming a
    // non-creator is the same unfounded causal claim as naming a creator.
    expect(steps[1]?.outcome).toMatchObject({
      kind: "refused",
      reason: expect.stringContaining("claimed by the repository's own declaration"),
    });
    expect(named(contests, steps[1])).toContain("mixedcase (declared in asimov/worktree.yaml)");
  });
});

describe("a contest larger than a pair", () => {
  // `contendersOf` groups any number of members, and a refusal built from the
  // current member and the favoured one hides every other declaration in the
  // dispute (.reviews/round-2.md F004).
  const THIRD = "tools/worktree.yaml";
  const TRIO = [
    entry("MixedCase", "copy", NATIVE, "i1"),
    entry("mixedcase", "copy", INHERITED, "i2"),
    entry("MIXEDCASE", "copy", THIRD, "i3"),
  ];
  const TRIO_MATERIAL = { ...CONTESTED, [`${MAIN}/MIXEDCASE`]: { kind: "file", size: 33 } as const };

  it("names all three in every refusal, after the repository's own claimed it", async () => {
    const { steps, contests } = await applyTo(TRIO_MATERIAL, TRIO);

    expect(steps.map((s) => s.outcome.kind)).toEqual(["copied", "refused", "refused"]);
    for (const refused of steps.slice(1)) {
      expect(named(contests, refused)).toEqual([
        "MixedCase (declared in .vscode/worktree.json)",
        "mixedcase (declared in asimov/worktree.yaml)",
        "MIXEDCASE (declared in tools/worktree.yaml)",
      ]);
    }
  });

  it("names all three when the repository's own never claimed it", async () => {
    const { steps, contests } = await applyTo({}, TRIO);

    expect(steps.map((s) => s.outcome.kind)).toEqual(["failed", "refused", "refused"]);
    for (const refused of steps.slice(1)) {
      expect(named(contests, refused)).toContain("MIXEDCASE (declared in tools/worktree.yaml)");
      expect(named(contests, refused)).toContain("mixedcase (declared in asimov/worktree.yaml)");
    }
  });
});

describe("a refusal says which rule refused", () => {
  it("keeps a contested entry's own refusal instead of calling it a lost claim", async () => {
    // Every `refused` from a contested entry used to be replaced with the
    // claim-loss text, so an unsupported file type reached the user as a
    // destination collision that never happened (.reviews/round-3.md F006).
    const material = {
      [`${MAIN}/MixedCase`]: { kind: "special" } as const,
      [`${MAIN}/mixedcase`]: { kind: "file", size: 22 } as const,
    };
    const { steps, contests } = await applyTo(material, PAIR, { folds: true });

    expect(steps[0]?.outcome).toMatchObject({
      kind: "refused",
      reason: expect.stringContaining("devices, sockets and FIFOs are never configuration"),
    });
    // The rule it fired AND the contest it is in — D4a holds for every refusal,
    // not only the ones the contest itself produced (.reviews/round-4.md F009).
    expect(named(contests, steps[0])).toEqual([
      "MixedCase (declared in .vscode/worktree.json)",
      "mixedcase (declared in asimov/worktree.yaml)",
    ]);
    // And the contest still settles: the favoured member never claimed it.
    expect(steps[1]?.outcome).toMatchObject({
      kind: "refused",
      reason: expect.stringContaining("never claimed"),
    });
  });
});

describe("a contest's membership travels once", () => {
  it("carries each contest once and points every member at it", async () => {
    const { steps, contests } = await applyTo(CONTESTED, PAIR, { folds: true });

    expect(contests).toEqual([
      {
        members: [
          { id: "i1", path: "MixedCase", source: ".vscode/worktree.json" },
          { id: "i2", path: "mixedcase", source: "asimov/worktree.yaml" },
        ],
      },
    ]);
    // The reason says what happened to THIS row and nothing about who else was
    // named — that repetition is what made the report quadratic
    // (award-a-contested-destination-or-refuse-it/.reviews/round-3.md F008).
    // Every member, not only the one that lost: the favoured row belongs to the
    // dispute too (.reviews/round-1.md F003).
    expect(steps.map((step) => step.contest)).toEqual([0, 0]);
    expect(steps[1]?.outcome).toMatchObject({ reason: expect.not.stringContaining("declared in") });
  });

  it("names each declaration exactly once in the whole report", async () => {
    // A ratio between two measured sizes is calibration, not a claim: enough
    // fixed overhead and a quadratic representation passes again
    // (.reviews/round-1.md F004). This counts instead — each declaring token
    // appears once, in the contest, and never inside a step's reason.
    const spelling = (at: number): string =>
      [..."shared"].map((letter, j) => ((at >> j) & 1 ? letter.toUpperCase() : letter)).join("");
    const many = Array.from({ length: 16 }, (_, at) =>
      entry(spelling(at), "copy", at === 0 ? NATIVE : INHERITED, `m${at}`),
    );
    const { steps, contests } = await applyTo(
      Object.fromEntries(many.map((e) => [`${MAIN}/${e.path}`, { kind: "file", size: 1 } as const])),
      many,
      { folds: true },
    );

    expect(contests).toHaveLength(1);
    expect(contests[0]?.members).toHaveLength(16);
    const asContests = JSON.stringify(contests);
    const asSteps = JSON.stringify(steps);
    for (const member of contests[0]?.members ?? []) {
      // `split` counts occurrences. Once in the membership, and once among the
      // steps as that step's OWN path — never once per member per member.
      expect(asContests.split(member.path).length - 1).toBe(1);
      expect(asSteps.split(member.path).length - 1).toBe(1);
    }
    // The declaring file is named where the membership is, and nowhere else.
    expect(asSteps).not.toContain("worktree.yaml");
    expect(asSteps).not.toContain("worktree.json");
    for (const step of steps) {
      if ("reason" in step.outcome) {
        expect(step.outcome.reason).not.toContain("declared in");
      }
    }
  });
});

describe("absence is established, never assumed", () => {
  it("refuses the contest when an earlier uncontested copy created the destination first", async () => {
    // One reading, taken before the ordered pass, proves only what was in the
    // worktree then. `makeDirectory` answers `written` for a directory that was
    // already there and the walk merges into it, so the favoured member reported
    // `copied` for a destination an unrelated entry owned, top-level mode and
    // all (.reviews/round-1.md F001).
    const tree = {
      [`${MAIN}/MixedCase`]: { kind: "dir" } as const,
      [`${MAIN}/MixedCase/inner`]: { kind: "file", size: 11 } as const,
      [`${MAIN}/mixedcase`]: { kind: "file", size: 22 } as const,
      [`${MAIN}/other`]: { kind: "dir" } as const,
      [`${MAIN}/other/seed`]: { kind: "file" } as const,
    };
    const { steps, fs } = await applyTo(
      tree,
      [
        entry("MixedCase/seed", "copy", INHERITED, "i3"),
        entry("MixedCase", "copy", NATIVE, "i1"),
        entry("mixedcase", "copy", INHERITED, "i2"),
      ],
      { folds: true },
    );

    expect(steps.map((s) => [s.path, s.outcome.kind])).toEqual([
      ["MixedCase/seed", "failed"],
      ["MixedCase", "refused"],
      ["mixedcase", "refused"],
    ]);
    // The favoured member's material is NOT merged into what the other entry made.
    expect(fs.nodes.get(`${WT}/MixedCase/inner`)).toBeUndefined();
  });

  it("refuses the contest when the destination cannot be read at all", async () => {
    // `EACCES` is not `ENOENT`. Read as absence it authorizes the write path
    // after failing to prove the destination free — the one direction this
    // check must never fail in (.reviews/round-1.md F002).
    const fs = fakeFs({ [MAIN]: { kind: "dir" }, [WT]: { kind: "dir" }, ...CONTESTED }, { folds: true });
    fs.beforeLstat = (p) => {
      if (p === `${WT}/mixedcase`) {
        const error = new Error(`EACCES: ${p}`) as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
    };
    const roots = await prepareEntryGate(MAIN, WT, fs);
    if (roots === null) {
      throw new Error("the fake could not prepare its roots");
    }
    const deadline = afterDelay(60_000);
    try {
      const { steps } = await applyProvisioning(PAIR, roots, { maxNodes: 1000, maxBytes: 1_000_000, deadline }, fs);

      expect(steps.map((s) => s.outcome.kind)).toEqual(["refused", "refused"]);
      expect(fs.created).toEqual([]);
    } finally {
      deadline.cancel();
    }
  });

  it("refuses the contest when another writer takes the destination after the second reading", async () => {
    // The window the second reading cannot close: between it and the favoured
    // member's own `mkdir`, a process outside this apply creates the name.
    // `makeDirectory` answers `written` for a directory that is already there,
    // so the declaration was reported as the owner of another writer's
    // directory, its mode and its children (.reviews/round-2.md F001).
    const fs = fakeFs({ [MAIN]: { kind: "dir" }, [WT]: { kind: "dir" }, ...CONTESTED }, { folds: true });
    let taken = false;
    fs.beforeLstat = (p) => {
      // The source lstat that opens the favoured member's own walk, which is
      // the last thing to happen before its `mkdir`.
      if (!taken && p === `${MAIN}/MixedCase`) {
        taken = true;
        fs.nodes.set(`${WT}/MixedCase`, { kind: "dir", mode: 0o700 });
      }
    };
    const roots = await prepareEntryGate(MAIN, WT, fs);
    if (roots === null) {
      throw new Error("the fake could not prepare its roots");
    }
    const deadline = afterDelay(60_000);
    try {
      const { steps } = await applyProvisioning(PAIR, roots, { maxNodes: 1000, maxBytes: 1_000_000, deadline }, fs);

      expect(steps.map((s) => s.outcome.kind)).toEqual(["refused", "refused"]);
      // The other writer's mode is untouched, and neither declaration's
      // material went in under it.
      expect(fs.nodes.get(`${WT}/MixedCase`)).toEqual({ kind: "dir", mode: 0o700 });
    } finally {
      deadline.cancel();
    }
  });
});

describe("[round-5 F011] the worktree could not be read at all", () => {
  const WHY = "the worktree could not be read after it was created";

  it("still says which declarations were contesting", () => {
    // The apply never ran, so it has no opinion about who wins. It still owes
    // the dialog the dispute: a contested row whose step carries no contest
    // index renders as a row unrelated to the contest beside it.
    const { steps, contests } = failEveryEntry(PAIR, WHY);

    expect(steps.map((s) => s.outcome)).toEqual([
      { kind: "failed", reason: WHY },
      { kind: "failed", reason: WHY },
    ]);
    for (const step of steps) {
      expect(named(contests, step)).toEqual([
        "MixedCase (declared in .vscode/worktree.json)",
        "mixedcase (declared in asimov/worktree.yaml)",
      ]);
    }
  });

  it("carries the membership once, not once per member", () => {
    const { contests } = failEveryEntry(PAIR, WHY);

    expect(contests).toHaveLength(1);
  });

  it("leaves an uncontested entry with no contest to point at", () => {
    const alone = [entry(".env", "copy", NATIVE, "i9")];
    const { steps, contests } = failEveryEntry(alone, WHY);

    expect(steps[0]?.contest).toBeUndefined();
    expect(contests).toEqual([]);
  });
});
