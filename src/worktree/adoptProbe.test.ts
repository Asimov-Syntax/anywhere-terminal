// src/worktree/adoptProbe.test.ts — the second half of "the registration is gone".
//
// `probeReattach` reaches adopt only for a candidate git still lists as
// prunable. Once `git worktree prune` has run, git lists nothing and the only
// witness left is the directory itself.

import { describe, expect, it } from "vitest";
import { type AdoptProbeDeps, probeAdopt } from "./adoptProbe";
import { type GitLink, readGitLink } from "./reattachProbe";

/** This repository's common directory — every default `gitdir` below is an entry under it. */
const COMMON = "/repo/.git";

function deps(over: Partial<AdoptProbeDeps> = {}): AdoptProbeDeps {
  return {
    readGitLink: async () => ({ kind: "file", gitdir: "/repo/.git/worktrees/gone" }) as GitLink,
    adminDirExists: async () => false,
    ...over,
  };
}

describe("probeAdopt", () => {
  it("answers adopt for a checkout whose administrative directory is gone", async () => {
    expect(await probeAdopt({ candidatePath: "/wt/survivor", commonDir: COMMON }, deps())).toEqual({
      kind: "adopt",
      adoptPath: "/wt/survivor",
      // Carried, because the reconstruction re-reads THIS path at its own write
      // boundary rather than parsing the link a second time (F006).
      staleGitdir: `${COMMON}/worktrees/gone`,
    });
  });

  it("declines while the administrative directory is still there", async () => {
    const verdict = await probeAdopt({ candidatePath: "/wt/survivor", commonDir: COMMON }, deps({ adminDirExists: async () => true }));

    expect(verdict).toEqual({ kind: "declined", because: "notAPrunedCheckout" });
  });

  // A `.git` DIRECTORY is a repository of its own, and adopting it would attach
  // someone else's repository to this one's branch.
  it("declines a repository", async () => {
    const verdict = await probeAdopt({ candidatePath: "/wt/repo", commonDir: COMMON }, deps({ readGitLink: async () => ({ kind: "directory" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "notAPrunedCheckout" });
  });

  it("declines a directory with no git entry at all — that is debris, not a checkout", async () => {
    const verdict = await probeAdopt({ candidatePath: "/wt/debris", commonDir: COMMON }, deps({ readGitLink: async () => ({ kind: "absent" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "notAPrunedCheckout" });
  });

  it("declines a `.git` that is neither a file nor a directory", async () => {
    const verdict = await probeAdopt({ candidatePath: "/wt/odd", commonDir: COMMON }, deps({ readGitLink: async () => ({ kind: "notAFile" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "notAPrunedCheckout" });
  });

  // The one that must not collapse into "gone". A `.git` this process cannot
  // read is still a `.git`, and reading unreadable as absent would adopt over a
  // live registration.
  it("declines an unreadable git entry rather than reading it as gone", async () => {
    const verdict = await probeAdopt({ candidatePath: "/wt/locked", commonDir: COMMON }, deps({ readGitLink: async () => ({ kind: "unreadable" }) }));

    expect(verdict).toEqual({ kind: "declined", because: "unreadable" });
  });

  it("declines rather than throwing when the link read rejects", async () => {
    const verdict = await probeAdopt(
      { candidatePath: "/wt/survivor", commonDir: COMMON },
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
      { candidatePath: "/wt/survivor", commonDir: COMMON },
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
      { candidatePath: "/wt/survivor", commonDir: COMMON },
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

describe("probeAdopt refuses a gitfile git itself rejects", () => {
  it("declines a `.git` whose `gitdir:` is not the first thing in it", async () => {
    // The authority to overwrite a `.git` cannot be weaker than git's own
    // reading of it (round-1 F007).
    const verdict = await probeAdopt({ candidatePath: "/wt/stale", commonDir: COMMON }, {
      readGitLink: (p: string) =>
        readGitLink(p, {
          lstat: async () => ({ isDirectory: () => false, isFile: () => true }),
          readFile: async () => "junk\ngitdir: /repo/.git/worktrees/stale\n",
        }),
      adminDirExists: async () => false,
    });

    expect(verdict).toEqual({ kind: "declined", because: "unreadable" });
  });
});

describe("probeAdopt binds the surviving checkout to this repository", () => {
  // The stale `gitdir:` is the only thing left that says WHICH repository the
  // directory was a worktree of. Discarding it let a forgotten checkout of
  // another repository be offered here, and the reconstruction would then
  // attach its working tree to this repository's object database (round-1 F002).
  it("declines a checkout whose stale entry belongs to another repository", async () => {
    const verdict = await probeAdopt(
      { candidatePath: "/wt/survivor", commonDir: COMMON },
      deps({ readGitLink: async () => ({ kind: "file", gitdir: "/other/.git/worktrees/gone" }) }),
    );

    expect(verdict).toEqual({ kind: "declined", because: "anotherRepository" });
  });

  it("declines a stale gitdir that is not an entry at all", async () => {
    const verdict = await probeAdopt(
      { candidatePath: "/wt/survivor", commonDir: COMMON },
      deps({ readGitLink: async () => ({ kind: "file", gitdir: "/repo/.git/objects" }) }),
    );

    expect(verdict).toEqual({ kind: "declined", because: "anotherRepository" });
  });

  it("declines a sibling directory whose name merely starts with this common directory", async () => {
    const verdict = await probeAdopt(
      { candidatePath: "/wt/survivor", commonDir: COMMON },
      deps({ readGitLink: async () => ({ kind: "file", gitdir: "/repo/.git-other/worktrees/gone" }) }),
    );

    expect(verdict).toEqual({ kind: "declined", because: "anotherRepository" });
  });

  it("adopts an entry of this repository written with a redundant spelling", async () => {
    const verdict = await probeAdopt(
      { candidatePath: "/wt/survivor", commonDir: "/repo/.git/" },
      deps({ readGitLink: async () => ({ kind: "file", gitdir: "/repo/.git/worktrees/../worktrees/gone" }) }),
    );

    expect(verdict).toMatchObject({ kind: "adopt", adoptPath: "/wt/survivor" });
  });

  it("proves the repository before it asks whether the entry is gone", async () => {
    // The existence check is I/O about a path from another repository. Asking
    // it at all is a read this probe has no business making.
    const asked: string[] = [];
    await probeAdopt(
      { candidatePath: "/wt/survivor", commonDir: COMMON },
      deps({
        readGitLink: async () => ({ kind: "file", gitdir: "/other/.git/worktrees/gone" }),
        adminDirExists: async (p) => {
          asked.push(p);
          return false;
        },
      }),
    );

    expect(asked).toEqual([]);
  });
});
