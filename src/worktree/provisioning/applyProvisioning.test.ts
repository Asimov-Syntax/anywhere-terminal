import { describe, expect, it } from "vitest";
import type { ProvisionEntry } from "../../types/messages";
import { afterDelay } from "../deadline";
import { fakeFs } from "./applyEntries.fake";
import { applyProvisioning } from "./applyProvisioning";
import { prepareEntryGate } from "./entryGate";

const MAIN = "/repo";
const WT = "/wt";

function entry(path: string, mode: ProvisionEntry["mode"], source: string, id = path): ProvisionEntry {
  return { id, path, mode, source };
}

async function applyTo(nodes: Parameters<typeof fakeFs>[0], entries: readonly ProvisionEntry[]) {
  const fs = fakeFs({ [MAIN]: { kind: "dir" }, [WT]: { kind: "dir" }, ...nodes });
  const roots = await prepareEntryGate(MAIN, WT, fs);
  if (roots === null) {
    throw new Error("the fake could not prepare its roots");
  }
  const deadline = afterDelay(60_000);
  try {
    const steps = await applyProvisioning(entries, roots, { maxNodes: 1000, maxBytes: 1_000_000, deadline }, fs);
    return { steps, fs };
  } finally {
    deadline.cancel();
  }
}

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

  it("answers for every entry it was given, in the order it was given them", async () => {
    // The report is per entry and the dialog reads it beside the rows it drew,
    // so the ORDER OF WORK is not the order of the answer.
    const { steps } = await applyTo(MATERIAL, [
      entry("third_party", "link", "asimov/worktree.yaml"),
      entry(".env", "copy", "asimov/worktree.yaml"),
      entry("absent", "copy", "asimov/worktree.yaml"),
    ]);

    expect(steps.map((s) => [s.path, s.outcome.kind])).toEqual([
      ["third_party", "linked"],
      [".env", "copied"],
      ["absent", "failed"],
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
      const steps = await applyProvisioning(
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
