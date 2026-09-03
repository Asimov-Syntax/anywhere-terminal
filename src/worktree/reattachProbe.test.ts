import { describe, expect, it, vi } from "vitest";
import { type GitLink, type GitLinkFs, probeReattach, type ReattachProbeDeps, readGitLink } from "./reattachProbe";

const SUBJECT = { repairPath: "/wt/stale", branchOid: "abc123" };

function deps(over: Partial<ReattachProbeDeps> = {}): ReattachProbeDeps & { asked: string[] } {
  const asked: string[] = [];
  const link: GitLink = {
    kind: "file",
    gitdir: "/repo/.git/worktrees/stale",
    raw: "gitdir: /repo/.git/worktrees/stale\n",
  };
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

describe("readGitLink", () => {
  function fs(over: Partial<GitLinkFs> = {}): GitLinkFs {
    return { lstat: async () => null, readFile: async () => null, ...over };
  }

  it("resolves a relative `gitdir:` against the worktree, not the process cwd", async () => {
    expect(
      await readGitLink(
        "/repo/wt/stale",
        fs({
          lstat: async () => ({ isDirectory: () => false, isFile: () => true }),
          readFile: async () => "gitdir: ../../.git/worktrees/stale\n",
        }),
      ),
      // Against the WORKTREE. Resolved against the process cwd this would name
      // a directory under wherever the extension host happens to be running.
    ).toEqual({
      kind: "file",
      gitdir: "/repo/.git/worktrees/stale",
      // The BYTES, beside the path they resolve to. An adoption proves it was
      // offered on this link and must compare against what it actually read,
      // not against a value it reconstructed (round-2 F006).
      raw: "gitdir: ../../.git/worktrees/stale\n",
    });
  });

  it("keeps an absolute `gitdir:` as written", async () => {
    expect(
      await readGitLink(
        "/wt/stale",
        fs({
          lstat: async () => ({ isDirectory: () => false, isFile: () => true }),
          readFile: async () => "gitdir: /repo/.git/worktrees/stale",
        }),
      ),
    ).toMatchObject({ kind: "file", gitdir: "/repo/.git/worktrees/stale" });
  });

  it("calls a `.git` DIRECTORY a directory — a repository is not a linked worktree", async () => {
    expect(
      await readGitLink("/repo", fs({ lstat: async () => ({ isDirectory: () => true, isFile: () => false }) })),
    ).toEqual({
      kind: "directory",
    });
  });

  it("refuses a symlinked `.git`, which `readFile` would have followed", async () => {
    // `lstat` does not follow the link, so the old "not a directory means it is
    // the link file" reading let a symlink pointing anywhere satisfy the check
    // and then had `readFile` follow it (round-1 B1).
    const readFile = vi.fn(async () => "gitdir: /elsewhere/.git/worktrees/x");
    expect(
      await readGitLink(
        "/wt/stale",
        fs({ lstat: async () => ({ isDirectory: () => false, isFile: () => false }), readFile }),
      ),
    ).toEqual({ kind: "notAFile" });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("declines to offer a repair against a symlinked `.git`", async () => {
    const verdict = await probeReattach(
      { repairPath: "/wt/stale", branchOid: "aaa" },
      {
        readGitLink: async () => ({ kind: "notAFile" }),
        adminDirExists: async () => true,
        headOid: async () => "aaa",
      },
    );
    expect(verdict).toEqual({ kind: "declined", because: "notALinkedWorktree" });
  });

  it("calls a missing `.git` absent, which is not the same as unreadable", async () => {
    expect(await readGitLink("/wt/none", fs())).toEqual({ kind: "absent" });
  });

  it("answers unreadable when the file is there but cannot be read", async () => {
    expect(
      await readGitLink("/wt/stale", fs({ lstat: async () => ({ isDirectory: () => false, isFile: () => true }) })),
    ).toEqual({
      kind: "unreadable",
    });
  });

  it("answers unreadable when the file names no gitdir at all", async () => {
    // A `.git` file with other content is not a link we can follow, and
    // guessing one would point `adminDirExists` at a path nobody wrote.
    expect(
      await readGitLink(
        "/wt/stale",
        fs({
          lstat: async () => ({ isDirectory: () => false, isFile: () => true }),
          readFile: async () => "something else\n",
        }),
      ),
    ).toEqual({ kind: "unreadable" });
  });

  it("answers unreadable for a `gitdir:` with nothing after it", async () => {
    expect(
      await readGitLink(
        "/wt/stale",
        fs({
          lstat: async () => ({ isDirectory: () => false, isFile: () => true }),
          readFile: async () => "gitdir:   \n",
        }),
      ),
    ).toEqual({ kind: "unreadable" });
  });
});

describe("readGitLink follows git's own gitfile grammar", () => {
  function linkFs(content: string): GitLinkFs {
    return {
      lstat: async () => ({ isDirectory: () => false, isFile: () => true }),
      readFile: async () => content,
    };
  }

  // Git's `read_gitfile_gently` requires the file to BEGIN with `gitdir: ` and
  // treats everything after it as the path. A `gitdir:` line found further down
  // is not a link git would follow, so it is not authority to overwrite one
  // (round-1 F007).
  it("refuses a `gitdir:` line that is not the first thing in the file", async () => {
    expect(await readGitLink("/wt/stale", linkFs("junk\ngitdir: /repo/.git/worktrees/stale\n"))).toEqual({
      kind: "unreadable",
    });
  });

  it("refuses a leading blank line before the `gitdir:`", async () => {
    expect(await readGitLink("/wt/stale", linkFs("\ngitdir: /repo/.git/worktrees/stale\n"))).toEqual({
      kind: "unreadable",
    });
  });

  it("refuses `gitdir:` without the space git writes after it", async () => {
    expect(await readGitLink("/wt/stale", linkFs("gitdir:/repo/.git/worktrees/stale\n"))).toEqual({
      kind: "unreadable",
    });
  });

  it("trims the trailing whitespace git trims, and nothing else", async () => {
    expect(await readGitLink("/wt/stale", linkFs("gitdir: /repo/.git/worktrees/stale  \n"))).toEqual({
      kind: "file",
      gitdir: "/repo/.git/worktrees/stale",
      raw: "gitdir: /repo/.git/worktrees/stale  \n",
    });
  });

  it("declines a repair against a malformed gitfile rather than reading it as a link", async () => {
    const verdict = await probeReattach(SUBJECT, {
      readGitLink: (p) => readGitLink(p, linkFs("junk\ngitdir: /repo/.git/worktrees/stale\n")),
      adminDirExists: async () => false,
      headOid: async () => "abc123",
    });

    // Not `adopt`: an unreadable `.git` is still a `.git`, and reporting this
    // one as a forgotten checkout would offer to overwrite it.
    expect(verdict).toEqual({ kind: "declined", because: "unreadable" });
  });
});

describe("probeReattach does not read a failed check as a gone directory", () => {
  // The adopt REPORT is what this arm produces, and adoption overwrites the
  // `.git` it was reported for. A `stat` that failed is not a directory that is
  // gone, and reporting one as the other hands adoption a live registration
  // (round-1 F003, at the boundary beside the one the finding named).
  it("declines when the administrative directory cannot be read", async () => {
    const verdict = await probeReattach(SUBJECT, {
      readGitLink: async () => ({
        kind: "file",
        gitdir: "/repo/.git/worktrees/stale",
        raw: "gitdir: /repo/.git/worktrees/stale\n",
      }),
      adminDirExists: async () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
      headOid: async () => "abc123",
    });

    expect(verdict).toEqual({ kind: "declined", because: "unreadable" });
  });
});
