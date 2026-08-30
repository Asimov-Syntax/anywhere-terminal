import { describe, expect, it } from "vitest";
import { type GitLink, probeReattach, type ReattachProbeDeps } from "./reattachProbe";

const SUBJECT = { repairPath: "/wt/stale", branchOid: "abc123" };

function deps(over: Partial<ReattachProbeDeps> = {}): ReattachProbeDeps & { asked: string[] } {
  const asked: string[] = [];
  const link: GitLink = { kind: "file", gitdir: "/repo/.git/worktrees/stale" };
  return {
    asked,
    readGitLink: (p) => {
      asked.push(`link:${p}`);
      return Promise.resolve(link);
    },
    adminDirExists: (d) => {
      asked.push(`admin:${d}`);
      return Promise.resolve(true);
    },
    headOid: (p) => {
      asked.push(`head:${p}`);
      return Promise.resolve("abc123");
    },
    ...over,
  };
}

describe("probeReattach", () => {
  it("offers the repair when all three conditions hold, carrying the directory's own OID", async () => {
    const verdict = await probeReattach(SUBJECT, deps());

    expect(verdict).toEqual({ kind: "offer", repairPath: "/wt/stale", expectedOid: "abc123" });
  });

  it("a gitdir naming a directory that is gone is ADOPT, not a declined reattach", async () => {
    // The two states look alike to a user and are completely different to git.
    // Reporting this as declined would lose the distinction WT-012.15 needs,
    // and treating the directory as debris would delete a surviving checkout.
    const verdict = await probeReattach(SUBJECT, deps({ adminDirExists: () => Promise.resolve(false) }));

    expect(verdict).toEqual({ kind: "adopt", adoptPath: "/wt/stale" });
  });

  it("a .git DIRECTORY is a repository, not a linked worktree", async () => {
    const verdict = await probeReattach(SUBJECT, deps({ readGitLink: () => Promise.resolve({ kind: "directory" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "notALinkedWorktree" });
  });

  it("an absent .git is not a checkout git ever registered", async () => {
    const verdict = await probeReattach(SUBJECT, deps({ readGitLink: () => Promise.resolve({ kind: "absent" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "notALinkedWorktree" });
  });

  it("an unreadable link declines rather than throwing", async () => {
    // A dialog is waiting on this. An exception would fail the whole resolution
    // over a candidate the user may not even have selected.
    const verdict = await probeReattach(SUBJECT, deps({ readGitLink: () => Promise.resolve({ kind: "unreadable" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "unreadable" });
  });

  it("a HEAD that no longer matches the branch is a directory that needs a human", async () => {
    const verdict = await probeReattach(SUBJECT, deps({ headOid: () => Promise.resolve("deadbee") }));

    expect(verdict).toEqual({ kind: "declined", because: "headMoved" });
  });

  it("a HEAD that cannot be read is not treated as matching", async () => {
    const verdict = await probeReattach(SUBJECT, deps({ headOid: () => Promise.resolve(undefined) }));

    expect(verdict).toEqual({ kind: "declined", because: "headMoved" });
  });

  it("stops at the first failed condition rather than reading past it", async () => {
    // Order is the contract: a missing admin directory is adopt, and asking for
    // a HEAD afterwards would be a read taken to answer a question already
    // settled.
    const d = deps({ adminDirExists: () => Promise.resolve(false) });

    await probeReattach(SUBJECT, d);

    expect(d.asked.some((a) => a.startsWith("head:"))).toBe(false);
  });
});
