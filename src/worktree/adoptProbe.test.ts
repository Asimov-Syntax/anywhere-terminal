// src/worktree/adoptProbe.test.ts — the second half of "the registration is gone".
//
// `probeReattach` reaches adopt only for a candidate git still lists as
// prunable. Once `git worktree prune` has run, git lists nothing and the only
// witness left is the directory itself.

import { describe, expect, it } from "vitest";
import { type AdoptProbeDeps, probeAdopt } from "./adoptProbe";
import type { GitLink } from "./reattachProbe";

function deps(over: Partial<AdoptProbeDeps> = {}): AdoptProbeDeps {
  return {
    readGitLink: async () => ({ kind: "file", gitdir: "/repo/.git/worktrees/gone" }) as GitLink,
    adminDirExists: async () => false,
    ...over,
  };
}

describe("probeAdopt", () => {
  it("answers adopt for a checkout whose administrative directory is gone", async () => {
    expect(await probeAdopt("/wt/survivor", deps())).toEqual({ kind: "adopt", adoptPath: "/wt/survivor" });
  });

  it("declines while the administrative directory is still there", async () => {
    const verdict = await probeAdopt("/wt/survivor", deps({ adminDirExists: async () => true }));

    expect(verdict).toEqual({ kind: "declined", because: "notAPrunedCheckout" });
  });

  // A `.git` DIRECTORY is a repository of its own, and adopting it would attach
  // someone else's repository to this one's branch.
  it("declines a repository", async () => {
    const verdict = await probeAdopt("/wt/repo", deps({ readGitLink: async () => ({ kind: "directory" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "notAPrunedCheckout" });
  });

  it("declines a directory with no git entry at all — that is debris, not a checkout", async () => {
    const verdict = await probeAdopt("/wt/debris", deps({ readGitLink: async () => ({ kind: "absent" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "notAPrunedCheckout" });
  });

  it("declines a `.git` that is neither a file nor a directory", async () => {
    const verdict = await probeAdopt("/wt/odd", deps({ readGitLink: async () => ({ kind: "notAFile" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "notAPrunedCheckout" });
  });

  // The one that must not collapse into "gone". A `.git` this process cannot
  // read is still a `.git`, and reading unreadable as absent would adopt over a
  // live registration.
  it("declines an unreadable git entry rather than reading it as gone", async () => {
    const verdict = await probeAdopt("/wt/locked", deps({ readGitLink: async () => ({ kind: "unreadable" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "unreadable" });
  });

  it("declines rather than throwing when the link read rejects", async () => {
    const verdict = await probeAdopt(
      "/wt/survivor",
      deps({
        readGitLink: async () => {
          throw new Error("EIO");
        },
      }),
    );

    expect(verdict).toEqual({ kind: "declined", because: "unreadable" });
  });

  it("declines rather than throwing when the existence check rejects", async () => {
    const verdict = await probeAdopt(
      "/wt/survivor",
      deps({
        adminDirExists: async () => {
          throw new Error("EIO");
        },
      }),
    );

    expect(verdict).toEqual({ kind: "declined", because: "unreadable" });
  });

  it("asks about the gitdir the link named, not about the candidate", async () => {
    const asked: string[] = [];
    await probeAdopt(
      "/wt/survivor",
      deps({
        adminDirExists: async (p) => {
          asked.push(p);
          return false;
        },
      }),
    );

    expect(asked).toEqual(["/repo/.git/worktrees/gone"]);
  });
});
