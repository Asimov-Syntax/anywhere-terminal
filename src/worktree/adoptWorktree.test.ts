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

function ok(stdout = ""): GitCommandResult {
  return { code: 0, stdout: Buffer.from(stdout, "utf8"), stderr: "", timedOut: false, failedToSpawn: false };
}

function runnerOf(answer: (args: readonly string[]) => GitCommandResult = () => ok()) {
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

const request = { repoPath: "/repo", commonDir: COMMON, worktreePath: WT, branch: "feat/x" };

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

  it("repairs and then rebuilds the index, in that order", async () => {
    const { runner, calls } = runnerOf();
    const { fs } = fsOf();

    await adoptWorktree(runner, request, fs);

    expect(calls.map((c) => c.args)).toEqual([
      ["worktree", "repair", WT],
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
