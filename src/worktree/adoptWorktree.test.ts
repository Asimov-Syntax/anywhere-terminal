// src/worktree/adoptWorktree.test.ts — the four files, their order, and the undo.
//
// Every failure here is one that leaves the repository's own administrative
// directory in a state the user did not ask for, so each step gets an injected
// failure rather than one representative case.

import { describe, expect, it } from "vitest";
import { type AdoptFs, adoptWorktree } from "./adoptWorktree";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";

const COMMON = "/repo/.git";
const WT = "/wt/survivor";
const ENTRY = `${COMMON}/worktrees/survivor`;
const ORIGINAL_LINK = "gitdir: /repo/.git/worktrees/gone\n";
/** The tip the adoption promised, as `git -C <wt> rev-parse HEAD` answers it. */
const TIP = "a".repeat(40);
/** The administrative directory that link still names — proven absent by the probe. */
const STALE = `${COMMON}/worktrees/gone`;

function ok(stdout = ""): GitCommandResult {
  return { code: 0, stdout: Buffer.from(stdout, "utf8"), stderr: "", timedOut: false, failedToSpawn: false };
}

function runnerOf(
  answer: (args: readonly string[]) => GitCommandResult = (args) => ok(args[0] === "rev-parse" ? `${TIP}\n` : ""),
) {
  const calls: { args: string[]; cwd: string }[] = [];
  const runner: GitCommandRunner = {
    run: async (args: readonly string[], cwd: string) => {
      calls.push({ args: [...args], cwd });
      return answer(args);
    },
  } as unknown as GitCommandRunner;
  return { runner, calls };
}

/** A filesystem that records the order it was written in — the order IS the contract. */
function fsOf(over: Partial<AdoptFs> = {}) {
  const dirs = new Set<string>([COMMON, `${COMMON}/worktrees`, WT]);
  const files = new Map<string, string>([[`${WT}/.git`, ORIGINAL_LINK]]);
  const writes: string[] = [];
  const identities = new Map<string, { dev: bigint; ino: bigint }>();
  let nextIno = 1n;

  const base: AdoptFs = {
    mkdir: async (p) => {
      if (dirs.has(p)) {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }
      dirs.add(p);
      identities.set(p, { dev: 1n, ino: nextIno++ });
      writes.push(`mkdir ${p}`);
    },
    // Idempotent, and NOT recorded in `writes`: the entry's parent is not part
    // of the ordered contract this fake exists to pin — the entry directory and
    // the four files are.
    ensureDir: async (p) => {
      dirs.add(p);
    },
    identify: async (p) => {
      const seen = identities.get(p);
      if (seen === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return seen;
    },
    readFile: async (p) => files.get(p) ?? null,
    writeFile: async (p, data) => {
      files.set(p, data);
      writes.push(`write ${p}`);
    },
    createFile: async (p, data) => {
      if (files.has(p)) {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }
      files.set(p, data);
      writes.push(`write ${p}`);
    },
    removeFile: async (p) => {
      files.delete(p);
      writes.push(`unlink ${p}`);
    },
    removeDir: async (p) => {
      dirs.delete(p);
      writes.push(`rm ${p}`);
    },
  };
  return { fs: { ...base, ...over }, writes, files, dirs, identities };
}

const request = {
  repoPath: "/repo",
  commonDir: COMMON,
  worktreePath: WT,
  branch: "feat/x",
  staleGitdir: STALE,
  staleLink: ORIGINAL_LINK,
  expectedBranchOid: TIP,
};

describe("adoptWorktree", () => {
  it("writes gitdir first, so a prune never sees an entry it would collect", async () => {
    const { runner } = runnerOf();
    const { fs, writes } = fsOf();

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(true);
    expect(writes.slice(0, 3)).toEqual([`mkdir ${ENTRY}`, `write ${ENTRY}/gitdir`, `write ${ENTRY}/commondir`]);
  });

  it("writes the worktree's own link last, so an unfinished entry is inert", async () => {
    const { runner } = runnerOf();
    const { fs, writes } = fsOf();

    await adoptWorktree(runner, request, fs);

    const entryWrites = writes.filter((w) => w.startsWith("write "));
    expect(entryWrites.at(-1)).toBe(`write ${WT}/.git`);
  });

  it("writes the four files git would have written", async () => {
    const { runner } = runnerOf();
    const { fs, files } = fsOf();

    await adoptWorktree(runner, request, fs);

    expect(files.get(`${ENTRY}/gitdir`)).toBe(`${WT}/.git\n`);
    expect(files.get(`${ENTRY}/commondir`)).toBe("../..\n");
    expect(files.get(`${ENTRY}/HEAD`)).toBe("ref: refs/heads/feat/x\n");
    expect(files.get(`${WT}/.git`)).toBe(`gitdir: ${ENTRY}\n`);
  });

  it("repairs, checks the tip, and only then rebuilds the index", async () => {
    // design.md D4's order. The tip guard sits between the two because the
    // index is work against a branch state (round-1 F009).
    const { runner, calls } = runnerOf();
    const { fs } = fsOf();

    await adoptWorktree(runner, request, fs);

    expect(calls.map((c) => c.args)).toEqual([
      ["worktree", "repair", WT],
      ["rev-parse", "HEAD"],
      ["reset", "--mixed"],
    ]);
  });

  it("advances the id rather than writing into an entry that already exists", async () => {
    const { runner } = runnerOf();
    const { fs, dirs } = fsOf();
    dirs.add(`${COMMON}/worktrees/survivor`);

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok === true && result.id).toBe("survivor-2");
  });

  it("refuses rather than looping forever when every id is taken", async () => {
    const { runner } = runnerOf();
    const { fs } = fsOf({
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
    });

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
  });

  // The window the identity check exists for: `prune` removes an entry whose
  // `gitdir` is missing and an external `add` mints the same id, so the
  // pathname we created and the pathname we are about to write through are not
  // provably the same directory.
  it("refuses when the entry it created has been replaced underneath it", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    let reads = 0;
    const fs: AdoptFs = {
      ...store.fs,
      identify: async () => {
        reads += 1;
        return reads === 1 ? { dev: 1n, ino: 7n } : { dev: 1n, ino: 8n };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });

  it.each([
    ["gitdir", `${ENTRY}/gitdir`],
    ["commondir", `${ENTRY}/commondir`],
    ["HEAD", `${ENTRY}/HEAD`],
    ["the worktree link", `${WT}/.git`],
  ])("undoes everything when the %s write fails", async (_label: string, failing: string) => {
    const { runner } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      writeFile: async (p, data) => {
        if (p === failing) {
          throw new Error("ENOSPC");
        }
        return store.fs.writeFile(p, data);
      },
      createFile: async (p, data) => {
        if (p === failing) {
          throw new Error("ENOSPC");
        }
        return store.fs.createFile(p, data);
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    expect(store.dirs.has(ENTRY)).toBe(false);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });

  it("undoes the adoption when the repair fails", async () => {
    const { runner } = runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(),
    );
    const store = fsOf();

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result.ok).toBe(false);
    expect(store.dirs.has(ENTRY)).toBe(false);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });

  it("undoes the adoption when the index rebuild fails", async () => {
    const { runner } = runnerOf((args) =>
      args[0] === "reset"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(),
    );
    const store = fsOf();

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result.ok).toBe(false);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });

  // An undo that cannot finish is not a clean failure, and reporting one would
  // send the user looking for a directory that is still registered.
  it("names what it left behind when the entry cannot be removed", async () => {
    const { runner } = runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(),
    );
    const store = fsOf({
      removeDir: async () => {
        throw new Error("EPERM");
      },
    });

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.leftBehind).toEqual({ entryPath: ENTRY, worktreeLinkRestored: true });
  });

  it("names the link it could not restore", async () => {
    const { runner } = runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(),
    );
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      writeFile: async (p, data) => {
        if (p === `${WT}/.git` && store.files.get(`${WT}/.git`) !== ORIGINAL_LINK) {
          throw new Error("EPERM");
        }
        return store.fs.writeFile(p, data);
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok === false && result.leftBehind?.worktreeLinkRestored).toBe(false);
  });

  // The caller's own post-write checks run after this returns, so withdrawing
  // the registration has to stay possible past success.
  it("hands back an undo the caller can use after success", async () => {
    const { runner } = runnerOf();
    const store = fsOf();

    const result = await adoptWorktree(runner, request, store.fs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      await result.undo();
    }

    expect(store.dirs.has(ENTRY)).toBe(false);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });

  it("refuses a worktree path git would read as a flag", async () => {
    const { runner, calls } = runnerOf();
    const { fs } = fsOf();

    const result = await adoptWorktree(runner, { ...request, worktreePath: "--git-dir=/evil" }, fs);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("restores an absent link as absent rather than inventing one", async () => {
    const { runner } = runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(),
    );
    const store = fsOf();
    store.files.delete(`${WT}/.git`);

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result.ok).toBe(false);
    expect(store.files.has(`${WT}/.git`)).toBe(false);
  });

  it("never writes anything inside the working tree but its link", async () => {
    const { runner } = runnerOf();
    const { fs, writes } = fsOf();

    await adoptWorktree(runner, request, fs);

    const inside = writes.filter((w) => w.includes(`${WT}/`) && !w.endsWith(`${WT}/.git`));
    expect(inside).toEqual([]);
  });

  // `repair` is the REPOSITORY's command and `reset` is the worktree's; running
  // either from the other's directory reaches a different repository.
  it("runs each command from the directory that owns it", async () => {
    const { runner, calls } = runnerOf();
    const { fs } = fsOf();

    await adoptWorktree(runner, request, fs);

    expect(calls[0]?.cwd).toBe("/repo");
    expect(calls[1]?.cwd).toBe(WT);
  });
});

describe("adoptWorktree cannot write through a directory it does not own", () => {
  // The three entry files were ordinary truncating writes, so a directory
  // removed and recreated between the `mkdir` and them was not detected before
  // its `gitdir`, `commondir` and `HEAD` had already been overwritten — the
  // exact cross-process damage the identity check exists to prevent (F005).
  it("refuses rather than truncating a replacement entry's own files", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    store.files.set(`${ENTRY}/gitdir`, "someone else\n");
    const result = await adoptWorktree(runner, { ...request }, store.fs);

    expect(result.ok).toBe(false);
    expect(store.files.get(`${ENTRY}/gitdir`), "a foreign registration was overwritten").toBe("someone else\n");
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });

  it("reports the entry it could not prove it owns rather than a clean withdrawal", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    let reads = 0;
    const fs: AdoptFs = {
      ...store.fs,
      identify: async () => {
        reads += 1;
        return reads === 1 ? { dev: 1n, ino: 7n } : { dev: 1n, ino: 8n };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    // A directory another process owns is left where it is AND said. Reporting
    // nothing left behind was the reading that made the damage invisible.
    expect(result).toMatchObject({ ok: false, leftBehind: { entryPath: ENTRY } });
  });

  it("removes nothing and reports nothing when the entry is already gone", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    let reads = 0;
    const fs: AdoptFs = {
      ...store.fs,
      identify: async (p) => {
        reads += 1;
        if (reads === 1) {
          return store.fs.identify(p);
        }
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    expect((result as { leftBehind?: unknown }).leftBehind).toBeUndefined();
  });
});

describe("adoptWorktree writes the link only while it is still the one it was offered", () => {
  // Several awaits separate the caller's corroboration from this write, and the
  // write is what makes the adoption real. A registration restored inside that
  // window would otherwise have its live link replaced (F006).
  it("refuses when the worktree's link changed while the entry was being written", async () => {
    // Through the STORE, not through a reader that lies about it: a fake that
    // returns different bytes without changing what it holds cannot show
    // whether the undo then overwrote them (round-2 F005).
    const { runner } = runnerOf();
    const store = fsOf();
    const replacement = "gitdir: /repo/.git/worktrees/restored\n";
    const fs: AdoptFs = {
      ...store.fs,
      createFile: async (p, data) => {
        await store.fs.createFile(p, data);
        // Somebody else installs a registration while the entry is being built.
        store.files.set(`${WT}/.git`, replacement);
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    expect(store.files.get(`${WT}/.git`), "a link nobody proved was ours was overwritten").toBe(replacement);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });

  it("refuses when the registration it was offered against came back", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    // The entry at the stale path names THIS checkout's link — the definition
    // of "the registration came back", and the one state adopting over would
    // leave the repository with two entries claiming one directory.
    store.files.set(`${STALE}/gitdir`, `${WT}/.git\n`);

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result.ok).toBe(false);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });

  it("proceeds when the stale path holds a registration for some other checkout", async () => {
    // Two checkouts of one repository can share a basename, so the stale path
    // can be legitimately occupied by an entry that has nothing to do with this
    // directory. Refusing on mere existence would decline that adoption.
    const { runner } = runnerOf();
    const store = fsOf();
    store.files.set(`${STALE}/gitdir`, "/wt/somebody-else/.git\n");

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: true });
  });

  it("refuses rather than assuming absence when that read cannot be made", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    let reads = 0;
    const fs: AdoptFs = {
      ...store.fs,
      readFile: async (p) => {
        reads += 1;
        if (reads > 1) {
          throw new Error("EACCES");
        }
        return store.fs.readFile(p);
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });
});

describe("adoptWorktree says which failure stopped it", () => {
  // A permission wall and a hundred taken names are different problems with
  // different recoveries, and both reported the second one (F011).
  it("names the failure rather than reporting that no name was available", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      mkdir: async () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain("permission denied");
  });

  it("still reports exhaustion when every name really is taken", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      mkdir: async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect((result as { message: string }).message).toContain("No unused administrative entry name");
  });
});

describe("adoptWorktree checks the tip before it rebuilds the index", () => {
  // The index is work against a branch STATE. Rebuilding it first spent that
  // work on a state the user was never shown and reported a reset failure
  // instead of the move — design.md D4 states repair, verify, then reset
  // (round-1 F009).
  it("refuses a moved branch without rebuilding the index", async () => {
    const { runner, calls } = runnerOf((args) => ok(args[0] === "rev-parse" ? `${"b".repeat(40)}\n` : ""));
    const store = fsOf();

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain("moved");
    expect(
      calls.some((c) => c.args[0] === "reset"),
      "the index was rebuilt against a branch that moved",
    ).toBe(false);
    expect(store.dirs.has(ENTRY)).toBe(false);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });

  it("refuses when that tip cannot be read at all", async () => {
    // An unreadable HEAD is not a matching one: treating it as a pass would
    // attach the checkout to a commit nobody verified.
    const { runner, calls } = runnerOf((args) =>
      args[0] === "rev-parse"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal", timedOut: false, failedToSpawn: false }
        : ok(),
    );
    const store = fsOf();

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: false });
    expect(calls.some((c) => c.args[0] === "reset")).toBe(false);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });
});

describe("adoptWorktree leaves a link it did not install alone", () => {
  const REPLACEMENT = "gitdir: /repo/.git/worktrees/restored\n";

  function failingRepair() {
    return runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(`${TIP}\n`),
    );
  }

  // Every failure runs the undo, and the undo used to write the old bytes back
  // unconditionally. A process that installed its own registration in the
  // meantime had it destroyed, and the result said the withdrawal was clean
  // (round-2 F005).
  it("does not restore over a registration installed after its own write", async () => {
    const { runner } = failingRepair();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      writeFile: async (p, data) => {
        await store.fs.writeFile(p, data);
        if (p === `${WT}/.git`) {
          store.files.set(p, REPLACEMENT);
        }
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(store.files.get(`${WT}/.git`), "another process's registration was overwritten").toBe(REPLACEMENT);
    expect(result).toMatchObject({ ok: false, leftBehind: { worktreeLinkRestored: false } });
  });

  it("does not touch the link at all when it fails before installing its own", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      createFile: async (p: string) => {
        throw new Error(`ENOSPC ${p}`);
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    // Not "restored to the same bytes" — never written. Before the final write
    // there is nothing of this adoption's there to undo.
    expect(store.writes.filter((w) => w.endsWith(`${WT}/.git`))).toEqual([]);
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
  });

  it("restores its own link when the failure is after it installed one", async () => {
    const { runner } = failingRepair();
    const store = fsOf();

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: false });
    expect((result as { leftBehind?: unknown }).leftBehind).toBeUndefined();
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });

  it("refuses before creating anything when the link cannot be read", async () => {
    // A read that FAILED is not an absent link. Answering `null` let the undo
    // remove a `.git` this adoption had never seen (round-2 F003).
    const { runner } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      readFile: async () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false });
    expect(store.files.get(`${WT}/.git`)).toBe(ORIGINAL_LINK);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });

  it("refuses before creating anything when a live registration was restored first", async () => {
    // The bytes are the claim. Comparing the reconstruction's own two reads
    // against each other passed happily while the link being replaced was a
    // live one somebody had just installed (round-2 F006).
    const { runner } = runnerOf();
    const store = fsOf();
    store.files.set(`${WT}/.git`, REPLACEMENT);

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: false });
    expect(store.files.get(`${WT}/.git`)).toBe(REPLACEMENT);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });
});
