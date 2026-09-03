// Real git, real directories. The unit tests prove the reconstruction WRITES the
// four files in the order design.md D4 names; only this file proves git then
// reads them — that the adopted directory lists, holds its branch, survives a
// prune, and commits back, with nothing inside it touched.
//
// It also pins the fact D4's write order rests on, invisible from a unit test:
// `prune` removes an entry whose `gitdir` file is missing OR names a path that
// is gone, and spares one whose `gitdir` names a path that exists. `<wt>/.git`
// is such a path for the whole adoption — it holds the stale link until the
// last write replaces it — which is what lets `gitdir` be written first.
//
// See: asimov/changes/re-register-a-surviving-checkout/design.md D4, D5
//      docs/design/worktree-create.md § 2.4

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepoFixture, type RepoFixture } from "../test/fixtures/repoFixture";
import { type AdoptFs, adoptWorktree } from "./adoptWorktree";
import { createGitCommandRunner } from "./gitCommandRunner";

const runner = createGitCommandRunner();

/** The same filesystem `src/extension.ts` hands the reconstruction in production. */
const realFs: AdoptFs = {
  mkdir: async (p) => {
    fs.mkdirSync(p);
  },
  ensureDir: async (p) => {
    fs.mkdirSync(p, { recursive: true });
  },
  identify: async (p) => fs.lstatSync(p, { bigint: true }),
  readFile: async (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  writeFile: async (p, data) => {
    fs.writeFileSync(p, data, "utf8");
  },
  createFile: async (p, data) => {
    fs.writeFileSync(p, data, { encoding: "utf8", flag: "wx" });
  },
  removeFile: async (p) => {
    fs.rmSync(p, { force: true });
  },
  removeDir: async (p) => {
    fs.rmSync(p, { recursive: true, force: true });
  },
};

let fixture: RepoFixture;
let repo: string;
let tmp: string;
/** The surviving checkout: a real worktree whose administrative entry was deleted. */
let survivor: string;
let commonDir: string;
/** The administrative directory the survivor's link still names — deleted in setup. */
let staleGitdir: string;

/** The `gitdir:` a surviving checkout still points at, read from git's own link file. */
function staleOf(worktreePath: string): string {
  const link = fs.readFileSync(path.join(worktreePath, ".git"), "utf8");
  return link.slice("gitdir: ".length).trim();
}

function git(args: string[], cwd = repo): string {
  return fixture.git(args, cwd);
}

/** Every registered worktree path, from git itself. */
function listed(): string[] {
  return git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}

/** The branch a registered path holds, or undefined when git does not list it. */
function branchAt(target: string): string | undefined {
  const records = git(["worktree", "list", "--porcelain"]).split("\n\n");
  const record = records.find((r) => r.startsWith(`worktree ${target}\n`) || r.trim() === `worktree ${target}`);
  return record
    ?.split("\n")
    .find((l) => l.startsWith("branch "))
    ?.slice("branch refs/heads/".length);
}

/** Every path under `at` except its `.git` entry, with content and mtime. */
function contentOf(at: string): Record<string, string> {
  const seen: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(at, full);
      if (rel === ".git") {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const stat = fs.lstatSync(full);
      seen[rel] = `${fs.readFileSync(full, "utf8")} @ ${stat.mtimeMs}`;
    }
  };
  walk(at);
  return seen;
}

beforeEach(() => {
  fixture = createRepoFixture({ prefix: "wt-adopt-" });
  repo = fixture.repo;
  tmp = fixture.tmp;
  commonDir = path.resolve(repo, git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());

  survivor = path.join(tmp, "survivor");
  git(["worktree", "add", "-q", "-b", "survivor", survivor]);
  staleGitdir = staleOf(survivor);
  // What the panel is actually looking at: a directory git has FORGOTTEN. The
  // entry is deleted and pruned, so no registration is left to repair — which
  // is exactly why `git worktree repair` cannot recover this on its own.
  fs.rmSync(path.join(commonDir, "worktrees", "survivor"), { recursive: true, force: true });
  git(["worktree", "prune"]);
});

afterEach(() => {
  fixture.dispose();
});

describe("what git does with a reconstructed entry", () => {
  it("lists the adopted directory on its branch, and it survives a prune", () => {
    expect(listed(), "the setup left a registration behind").not.toContain(survivor);

    return adoptWorktree(
      runner,
      { repoPath: repo, commonDir, worktreePath: survivor, branch: "survivor", staleGitdir },
      realFs,
    ).then((result) => {
      expect(result).toMatchObject({ ok: true });
      expect(listed()).toContain(survivor);
      expect(branchAt(survivor)).toBe("survivor");

      // The reason the write order is what it is: an entry with a `gitdir`
      // file is not prunable, so a prune landing mid-adoption cannot take it.
      git(["worktree", "prune", "--expire", "now"]);
      expect(listed(), "a prune removed the entry the adoption wrote").toContain(survivor);
    });
  });

  it("accepts a commit that lands in the repository", async () => {
    await adoptWorktree(runner, { repoPath: repo, commonDir, worktreePath: survivor, branch: "survivor", staleGitdir }, realFs);

    fs.writeFileSync(path.join(survivor, "added.txt"), "from the adopted tree\n");
    git(["add", "added.txt"], survivor);
    git(["commit", "-qm", "from the adopted tree"], survivor);

    // Read from the MAIN worktree: a commit only the adopted directory can see
    // would not be a commit into this repository.
    expect(git(["log", "-1", "--format=%s", "survivor"]).trim()).toBe("from the adopted tree");
  });

  it("reports only the working-tree state that was already there", async () => {
    // The failure this is aimed at: an adoption whose index is not reset reports
    // every tracked file as deleted, which reads as catastrophic data loss.
    fs.writeFileSync(path.join(survivor, "README.md"), "edited before the adoption\n");
    fs.writeFileSync(path.join(survivor, "untracked.txt"), "never added\n");

    await adoptWorktree(runner, { repoPath: repo, commonDir, worktreePath: survivor, branch: "survivor", staleGitdir }, realFs);

    const status = git(["status", "--porcelain"], survivor)
      .split("\n")
      .filter((l) => l.length > 0)
      .sort();
    expect(status).toEqual([" M README.md", "?? untracked.txt"]);
  });

  it("changes nothing inside the directory except its `.git` entry", async () => {
    fs.writeFileSync(path.join(survivor, "README.md"), "edited before the adoption\n");
    fs.writeFileSync(path.join(survivor, "untracked.txt"), "never added\n");
    fs.mkdirSync(path.join(survivor, "nested"));
    fs.writeFileSync(path.join(survivor, "nested", "deep.txt"), "deep\n");
    const before = contentOf(survivor);
    expect(Object.keys(before).length, "the fixture staged nothing to compare").toBeGreaterThan(2);

    const result = await adoptWorktree(
      runner,
      { repoPath: repo, commonDir, worktreePath: survivor, branch: "survivor", staleGitdir },
      realFs,
    );
    expect(result).toMatchObject({ ok: true });

    // Content AND mtime, so a rewrite with identical bytes is still caught.
    expect(contentOf(survivor)).toEqual(before);
    // And the one path that IS the adoption, asserted separately rather than
    // excluded and forgotten.
    const id = (result as { id: string }).id;
    expect(fs.readFileSync(path.join(survivor, ".git"), "utf8")).toBe(
      `gitdir: ${path.join(commonDir, "worktrees", id)}\n`,
    );
  });

  it("leaves no entry and reports a refusal when the branch is taken during the adoption", async () => {
    // The window the pre-read cannot close. Driven here by taking the branch
    // BEFORE the write, which is what an external `git worktree add` landing in
    // the user's pause looks like from inside.
    const rival = path.join(tmp, "rival");
    git(["worktree", "add", "-q", rival, "survivor"]);
    const linkBefore = fs.readFileSync(path.join(survivor, ".git"), "utf8");

    const result = await adoptWorktree(
      runner,
      { repoPath: repo, commonDir, worktreePath: survivor, branch: "survivor", staleGitdir },
      realFs,
    );
    // The reconstruction itself does not read the listing — the service's guards
    // do — so this asserts what the SERVICE would then undo: git reports two
    // holders, and only one of them is the adopted path.
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(await result.undo(), "the undo could not put the directory back").toBeUndefined();
    }
    expect(listed()).toContain(rival);
    expect(listed(), "the undo left the registration it wrote").not.toContain(survivor);
    // And the link holds the bytes it held. Restored, not removed: this
    // directory HAD one — pointing at the entry that was deleted — and putting
    // back a different state would be the undo changing what it found.
    expect(fs.readFileSync(path.join(survivor, ".git"), "utf8")).toBe(linkBefore);
  });

  it("removes an entry whose `gitdir` file is missing, which is why that file is written first", () => {
    // Not a claim about our code — a claim about git, and the one D4's write
    // order rests on. If this ever stops holding, the order is free to change;
    // while it holds, writing `gitdir` last would let a concurrent prune delete
    // the entry between the mkdir and the link.
    const entry = path.join(commonDir, "worktrees", "handmade");
    fs.mkdirSync(entry, { recursive: true });
    fs.writeFileSync(path.join(entry, "commondir"), "../..\n", "utf8");
    fs.writeFileSync(path.join(entry, "HEAD"), "ref: refs/heads/survivor\n", "utf8");

    git(["worktree", "prune", "--expire", "now"]);

    expect(fs.existsSync(entry), "git kept an entry with no gitdir file").toBe(false);
  });

  it("keeps an entry whose `gitdir` names a path that exists, which the adoption writes first", () => {
    // The other half, and the exact claim — not "a gitdir file is enough".
    // Git prunes an entry whose `gitdir` names a path that is GONE just as
    // readily as one with no `gitdir` at all, which the sibling below pins. What
    // spares the entry is naming a path that is there, and `<wt>/.git` IS there
    // throughout the adoption: it holds the stale link until the last write
    // replaces it. That is why `gitdir` can be written first and still protect.
    const entry = path.join(commonDir, "worktrees", "handmade");
    fs.mkdirSync(entry, { recursive: true });
    fs.writeFileSync(path.join(entry, "gitdir"), `${path.join(survivor, ".git")}\n`, "utf8");
    fs.writeFileSync(path.join(entry, "commondir"), "../..\n", "utf8");
    fs.writeFileSync(path.join(entry, "HEAD"), "ref: refs/heads/survivor\n", "utf8");

    // `--expire now` is what makes this meaningful: the entry is not spared for
    // being young.
    git(["worktree", "prune", "--expire", "now"]);

    expect(fs.existsSync(entry), "git removed an entry whose gitdir names a path that exists").toBe(true);
  });

  it("removes an entry whose `gitdir` names a path that is gone, which is the case above's arm", () => {
    // Without this the test above passes for "it had a gitdir file", which is
    // not what git does and would leave D4's order resting on a false reading.
    const entry = path.join(commonDir, "worktrees", "handmade");
    fs.mkdirSync(entry, { recursive: true });
    fs.writeFileSync(path.join(entry, "gitdir"), `${path.join(tmp, "not-there", ".git")}\n`, "utf8");
    fs.writeFileSync(path.join(entry, "commondir"), "../..\n", "utf8");
    fs.writeFileSync(path.join(entry, "HEAD"), "ref: refs/heads/survivor\n", "utf8");

    git(["worktree", "prune", "--expire", "now"]);

    expect(fs.existsSync(entry)).toBe(false);
  });

  it("refuses a destination that reads as a git option, before writing anything", async () => {
    // Absent, because the setup's prune removed it once it was empty — which is
    // the state the refusal has to leave untouched. Creating it would be a write.
    const parent = path.join(commonDir, "worktrees");
    expect(fs.existsSync(parent), "the setup left an entry parent behind").toBe(false);

    const result = await adoptWorktree(
      runner,
      { repoPath: repo, commonDir, worktreePath: "--force", branch: "survivor", staleGitdir },
      realFs,
    );

    expect(result).toMatchObject({ ok: false });
    expect(fs.existsSync(parent), "a refused adoption still wrote into the repository").toBe(false);
  });

  it("mints a second entry name rather than writing into one that is already there", async () => {
    // Two adoptions of two different directories whose basenames collide. The
    // second must not land inside the first's entry — that entry is a live
    // registration, and overwriting its `gitdir` would point an existing
    // worktree at the wrong tree.
    const other = path.join(tmp, "other", "survivor");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    git(["worktree", "add", "-q", "-b", "second", other]);
    const staleOther = staleOf(other);
    fs.rmSync(path.join(commonDir, "worktrees", "survivor1"), { recursive: true, force: true });
    // git names the second entry `survivor1`; whatever it chose, clear every
    // entry so both directories are forgotten.
    for (const name of fs.readdirSync(path.join(commonDir, "worktrees"))) {
      fs.rmSync(path.join(commonDir, "worktrees", name), { recursive: true, force: true });
    }
    git(["worktree", "prune"]);

    const first = await adoptWorktree(
      runner,
      { repoPath: repo, commonDir, worktreePath: survivor, branch: "survivor", staleGitdir },
      realFs,
    );
    const second = await adoptWorktree(
      runner,
      { repoPath: repo, commonDir, worktreePath: other, branch: "second", staleGitdir: staleOther },
      realFs,
    );

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect((second as { id: string }).id).not.toBe((first as { id: string }).id);
    expect(listed()).toEqual(expect.arrayContaining([survivor, other]));
    expect(branchAt(survivor)).toBe("survivor");
    expect(branchAt(other)).toBe("second");
  });
});

describe("the git this was verified against", () => {
  it("is a version whose prune behaviour these tests pin", () => {
    // Stated rather than asserted on: the two prune facts above are the real
    // check, and this only makes the version legible when one of them fails.
    const version = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
    expect(version).toMatch(/^git version \d+\.\d+/);
  });
});
