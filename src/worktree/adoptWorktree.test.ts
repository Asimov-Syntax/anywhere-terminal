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

/**
 * A filesystem that records the order it was written in, over an INODE TABLE.
 *
 * The table is the point. Rounds 1 through 3 were each defeated by a fake that
 * could not tell "the path now names a different file" from "the file's bytes
 * changed" — round 2's returned alternate bytes from the reader while leaving
 * the store untouched, so an overwrite was invisible to the assertions. Here a
 * path maps to an inode id and the bytes live on the inode, so a handle opened
 * before a replacement keeps writing the OLD object and a test can read both.
 */
function fsOf(over: Partial<AdoptFs> = {}) {
  const dirs = new Set<string>([COMMON, `${COMMON}/worktrees`, WT]);
  /** path → inode id. Replacing a file rebinds the path; rewriting it does not. */
  const at = new Map<string, bigint>();
  /** inode id → its bytes. Reachable after the path stops naming it. */
  const inodes = new Map<bigint, string>();
  /** inode id → how many names reach it. A hard link is a second name, not a copy. */
  const names = new Map<bigint, number>();
  const writes: string[] = [];
  /** Every path read BY NAME. The undo must not appear in here at all. */
  const reads: string[] = [];
  const identities = new Map<string, { dev: bigint; ino: bigint }>();
  let nextIno = 1n;
  let closed = false;

  const put = (p: string, data: string): bigint => {
    const ino = nextIno++;
    at.set(p, ino);
    inodes.set(ino, data);
    names.set(ino, 1);
    return ino;
  };
  put(`${WT}/.git`, ORIGINAL_LINK);
  const bytesAt = (p: string): string | null => {
    const ino = at.get(p);
    return ino === undefined ? null : (inodes.get(ino) ?? null);
  };

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
      const dir = identities.get(p);
      if (dir !== undefined) {
        return dir;
      }
      const ino = at.get(p);
      if (ino === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return { dev: 1n, ino };
    },
    openLink: async (p) => {
      // Bound HERE, once. Everything below reaches this object even after the
      // path has been rebound to another one.
      const bound = at.get(p);
      if (bound === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      const live = <T>(run: () => T): T => {
        if (closed) {
          throw Object.assign(new Error("closed"), { code: "EBADF" });
        }
        return run();
      };
      return {
        identity: async () => live(() => ({ dev: 1n, ino: bound, nlink: names.get(bound) ?? 1 })),
        readAt: async (position) => live(() => (inodes.get(bound) ?? "").slice(position)),
        truncate: async (length) =>
          live(() => {
            inodes.set(bound, (inodes.get(bound) ?? "").slice(0, length));
            writes.push(`truncate ${p}`);
          }),
        writeAt: async (data, position) =>
          live(() => {
            const text = data.toString("utf8");
            const held = inodes.get(bound) ?? "";
            inodes.set(bound, held.slice(0, position) + text);
            writes.push(`write ${p}`);
            return data.byteLength;
          }),
        close: async () => {
          closed = true;
        },
      };
    },
    readFile: async (p) => {
      reads.push(p);
      return bytesAt(p);
    },
    createFile: async (p, data) => {
      if (at.has(p)) {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }
      put(p, data);
      writes.push(`write ${p}`);
    },
    removeDir: async (p) => {
      dirs.delete(p);
      writes.push(`rm ${p}`);
    },
  };

  /** The `files`-shaped view the existing assertions read, over the inode table. */
  const files = {
    get: (p: string) => bytesAt(p) ?? undefined,
    has: (p: string) => at.has(p),
    delete: (p: string) => at.delete(p),
    set: (p: string, data: string) => {
      put(p, data);
    },
  };

  return {
    fs: { ...base, ...over },
    writes,
    reads,
    files,
    dirs,
    identities,
    /** Give the link a SECOND name — a hard link, which no `O_NOFOLLOW` refuses. */
    hardLinkTheLink: () => {
      const ino = at.get(`${WT}/.git`);
      if (ino === undefined) {
        throw new Error("no link to alias");
      }
      names.set(ino, (names.get(ino) ?? 1) + 1);
    },
    /**
     * Another writer REPLACES the link — `rename` or unlink+create. New inode,
     * and the OLD one loses the name it had: an open descriptor is then the last
     * reference to an object `nlink` reports as 0. Modelling that drop is what
     * lets a test see the difference between "somebody aliased our file" and
     * "somebody took our file away" (round-6, oracle B1).
     */
    replaceLink: (data: string) => {
      const old = at.get(`${WT}/.git`);
      if (old !== undefined) {
        names.set(old, Math.max(0, (names.get(old) ?? 1) - 1));
      }
      return put(`${WT}/.git`, data);
    },
    /** Another writer TRUNCATES the link in place — what git's own writer does. */
    rewriteLinkInPlace: (data: string) => {
      const ino = at.get(`${WT}/.git`);
      if (ino === undefined) {
        throw new Error("no link to rewrite");
      }
      inodes.set(ino, data);
    },
    /** What the NAME holds now. */
    linkBytes: () => bytesAt(`${WT}/.git`),
    /** What a given object holds, whether or not the name still points at it. */
    inodeBytes: (ino: bigint) => inodes.get(ino) ?? null,
    linkInode: () => at.get(`${WT}/.git`),
    wasClosed: () => closed,
  };
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
    // The ENTRY's identity moves, and only the entry's. Answering for every
    // path — which this case used to do, counting reads — made the link's own
    // identity comparison refuse first, so the guard named here could be
    // deleted with the case still green (self-audit after round 5).
    let entryReads = 0;
    const fs: AdoptFs = {
      ...store.fs,
      identify: async (p) => {
        if (p !== ENTRY) {
          return store.fs.identify(p);
        }
        entryReads += 1;
        return entryReads === 1 ? { dev: 1n, ino: 7n } : { dev: 1n, ino: 8n };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false });
    expect(
      (result as { message: string }).message,
      "a different guard refused, so this case does not witness the entry re-check",
    ).toContain("administrative entry was replaced");
    expect(store.linkBytes()).toBe(ORIGINAL_LINK);
  });

  // The link is proved against the corroborated bytes BEFORE anything is
  // created. The later check catches bytes that move while the entry is being
  // written; without this one, a link already rewritten when the adoption
  // arrived would have an entry built for it first (round-2 F006).
  it("refuses before creating anything when the link is not the one it was offered", async () => {
    const { runner, calls } = runnerOf();
    const store = fsOf();
    store.rewriteLinkInPlace("gitdir: /repo/.git/worktrees/somebody-else\n");

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain("not the one this adoption was offered on");
    expect(store.writes, "an entry was built for a link that had already moved").toEqual([]);
    expect(calls).toEqual([]);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });

  it.each([
    ["gitdir", `${ENTRY}/gitdir`],
    ["commondir", `${ENTRY}/commondir`],
    ["HEAD", `${ENTRY}/HEAD`],
  ])("undoes everything when the %s write fails", async (_label: string, failing: string) => {
    const { runner } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
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

  // The claim write is not an ordinary write, and round-3 F012 is the reason:
  // `writeFile` opens `w`, which truncates BEFORE the first byte, so a
  // rejection left `.git` empty while the adoption reported that its withdrawal
  // had changed nothing.
  describe("when the claim write begins and does not finish", () => {
    /** A handle whose claim write fails; `recoverable` decides whether the restore may. */
    function brokenClaim(store: ReturnType<typeof fsOf>, recoverable: boolean): AdoptFs {
      return {
        ...store.fs,
        openLink: async (p) => {
          const handle = await store.fs.openLink(p);
          let attempts = 0;
          return {
            ...handle,
            writeAt: async (data, position) => {
              attempts += 1;
              if (attempts === 1 || !recoverable) {
                throw new Error("ENOSPC");
              }
              return handle.writeAt(data, position);
            },
          };
        },
      };
    }

    it("puts the found bytes back through the same handle", async () => {
      const { runner } = runnerOf();
      const store = fsOf();

      const result = await adoptWorktree(runner, request, brokenClaim(store, true));

      expect(result.ok).toBe(false);
      expect(store.dirs.has(ENTRY)).toBe(false);
      expect(store.linkBytes()).toBe(ORIGINAL_LINK);
      expect((result as { leftBehind?: unknown }).leftBehind).toBeUndefined();
    });

    it("says the content is unknown when the recovery cannot land either", async () => {
      const { runner } = runnerOf();
      const store = fsOf();

      const result = await adoptWorktree(runner, request, brokenClaim(store, false));

      expect(result.ok).toBe(false);
      // The entry IS withdrawn — the thing that is not withdrawn is the link,
      // and a failure that says nothing changed would be a lie about a `.git`
      // that now names nothing.
      expect(store.dirs.has(ENTRY)).toBe(false);
      expect(store.linkBytes()).not.toBe(ORIGINAL_LINK);
      expect(result.ok === false && result.leftBehind).toEqual({ entryPath: null, link: "unknown" });
    });

    // A fulfilled write is not a completed one. `FileHandle.write` answers with
    // a byte count, and taking fulfilment for completion leaves a partial link
    // that BOTH identity checks accept as established.
    it("finishes a write that fulfils short rather than taking it for a whole link", async () => {
      const { runner } = runnerOf();
      const store = fsOf();
      const fs: AdoptFs = {
        ...store.fs,
        openLink: async (p) => {
          const handle = await store.fs.openLink(p);
          let first = true;
          return {
            ...handle,
            writeAt: async (data, position) => {
              if (!first) {
                return handle.writeAt(data, position);
              }
              first = false;
              // Half the bytes, fulfilled. No rejection anywhere.
              const half = data.subarray(0, Math.floor(data.byteLength / 2));
              await handle.writeAt(half, position);
              return half.byteLength;
            },
          };
        },
      };

      const result = await adoptWorktree(runner, request, fs);

      // The remainder is written, so the link is WHOLE — not the half the first
      // call reported. Taking the count for completion would leave `gitdir: /re`.
      expect(result.ok).toBe(true);
      expect(store.linkBytes()).toBe(`gitdir: ${ENTRY}\n`);
    });

    // And a fulfilled write of NOTHING is not progress: looping on it is a hang
    // rather than an error, so it ends the write like any other failure.
    it("stops rather than spinning when a write fulfils with no bytes", async () => {
      const { runner } = runnerOf();
      const store = fsOf();
      const fs: AdoptFs = {
        ...store.fs,
        openLink: async (p) => {
          const handle = await store.fs.openLink(p);
          let claimed = false;
          return {
            ...handle,
            writeAt: async (data, position) => {
              if (claimed) {
                return handle.writeAt(data, position);
              }
              claimed = true;
              return 0;
            },
          };
        },
      };

      const result = await adoptWorktree(runner, request, fs);

      expect(result.ok).toBe(false);
      expect(store.dirs.has(ENTRY)).toBe(false);
      expect(store.linkBytes()).toBe(ORIGINAL_LINK);
    });
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
    expect(result.ok === false && result.leftBehind).toEqual({ entryPath: ENTRY, link: "restored" });
  });

  it("names the link it could not restore", async () => {
    const { runner } = runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(),
    );
    const store = fsOf();
    // The claim write lands; the RESTORE is what cannot be made. The link is
    // then neither ours-as-written nor the bytes it was found with, and saying
    // "withdrawn" over that state is the report round-3 F012 falsified.
    const fs: AdoptFs = {
      ...store.fs,
      openLink: async (p) => {
        const handle = await store.fs.openLink(p);
        let claimed = false;
        return {
          ...handle,
          truncate: async (length) => {
            if (claimed) {
              throw new Error("EPERM");
            }
            return handle.truncate(length);
          },
          writeAt: async (data, position) => {
            const wrote = await handle.writeAt(data, position);
            claimed = true;
            return wrote;
          },
        };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok === false && result.leftBehind?.link).toBe("unknown");
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
    const fs: AdoptFs = {
      ...store.fs,
      readFile: async (p) => {
        if (p.startsWith(STALE)) {
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
    let ours: bigint | undefined;
    const fs: AdoptFs = {
      ...store.fs,
      // The substitution goes through the inode table, so the path is REBOUND
      // rather than the bytes swapped under a reader — which is the difference
      // round 2's witness could not see.
      identify: async (p) => {
        const seen = await store.fs.identify(p);
        if (p === `${WT}/.git` && ours !== undefined && store.linkInode() === ours) {
          store.replaceLink(REPLACEMENT);
        }
        return seen;
      },
      openLink: async (p) => {
        const handle = await store.fs.openLink(p);
        ours = store.linkInode();
        return handle;
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(store.linkBytes(), "another process's registration was overwritten").toBe(REPLACEMENT);
    expect(result).toMatchObject({ ok: false, leftBehind: { link: "leftAsFound" } });
    // And not merely "the name still reads right". Once the fake models the
    // replacement DROPPING the old name, the detached object reports `nlink` 0
    // and the claim is refused before it mutates anything — so this object holds
    // exactly what it always held, and no write ever reached it (oracle B1).
    expect(ours !== undefined && store.inodeBytes(ours)).toBe(ORIGINAL_LINK);
    expect(store.writes.filter((w) => w.endsWith(`${WT}/.git`))).toEqual([]);
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
    //
    // Injected at the HANDLE. This case used to override `AdoptFs.readFile`,
    // which stopped being the link's reader when the handle arrived — so it
    // failed later, at the stale-entry read, and its end-state assertions passed
    // whether or not the guard it is named for existed (round-4 F014).
    const { runner, calls } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      openLink: async (p) => ({
        ...(await store.fs.openLink(p)),
        readAt: async () => {
          throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        },
      }),
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false });
    // Nothing happened AT ALL — no entry, no git, no write of any kind. The
    // end state alone cannot say that, because a refusal further along leaves
    // the same end state after undoing itself.
    expect(store.writes, "something was written before the link was proved").toEqual([]);
    expect(calls, "git ran before the link was proved").toEqual([]);
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

describe("adoptWorktree writes through the object it opened, not the name", () => {
  const REPLACEMENT = "gitdir: /repo/.git/worktrees/restored\n";

  // The destructive half of round-1 F006 and rounds 2 and 3's F005: a writer
  // that REPLACES the link. Our handle keeps the old inode, so the write cannot
  // reach the replacement — and the post-write check turns that from a silent
  // no-op into a refusal.
  it("refuses rather than writing when the link was replaced before the claim", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    let opened = false;
    let ours: bigint | undefined;
    const fs: AdoptFs = {
      ...store.fs,
      identify: async (p) => {
        const seen = await store.fs.identify(p);
        if (p === `${WT}/.git` && opened) {
          opened = false;
          store.replaceLink(REPLACEMENT);
          return store.fs.identify(p);
        }
        return seen;
      },
      openLink: async (p) => {
        opened = true;
        ours = store.linkInode();
        return store.fs.openLink(p);
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false });
    expect(store.linkBytes(), "the replacement was overwritten").toBe(REPLACEMENT);
    expect(store.dirs.has(ENTRY)).toBe(false);
    // And the refusal came BEFORE the write, not after it. Checking only that
    // the replacement survived cannot tell the two apart — the write would have
    // landed on the detached object either way, and the post-write check would
    // have refused just the same. What separates them is whether this adoption
    // truncated an object it had already been told was no longer the link.
    expect(ours !== undefined && store.inodeBytes(ours), "the detached object was written anyway").toBe(ORIGINAL_LINK);
  });

  // The case the handle does NOT close, asserted as parity rather than left to
  // be discovered: `git worktree repair` truncates this file in place through
  // git's own `write_file_buf`, so the inode never changes and nothing here can
  // tell that write from ours (design.md D9).
  it("cannot tell an in-place rewrite of the same object from its own write", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      readFile: async (p) => {
        if (p.startsWith(STALE)) {
          store.rewriteLinkInPlace(REPLACEMENT);
        }
        return store.fs.readFile(p);
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    // Documented, not celebrated. If this ever starts refusing, the claim in D9
    // has become stronger than it says and the ledger row should be re-read.
    expect(result).toMatchObject({ ok: true });
    expect(store.linkBytes()).toBe(`gitdir: ${ENTRY}\n`);
  });

  // Byte equality was the round-2 answer, and `worktree.useRelativePaths` breaks
  // it without any race at all: repair legitimately rewrites OUR link, and every
  // withdrawal D5 reaches runs after repair.
  it("still recognises its own link after repair normalises it to a relative one", async () => {
    const store = fsOf();
    const { runner } = runnerOf((args) => {
      if (args[1] !== "repair") {
        return ok(`${TIP}\n`);
      }
      // Exactly what git does here: the SAME inode, rewritten in place, into the
      // relative form `worktree.useRelativePaths` asks for.
      store.rewriteLinkInPlace("gitdir: ../../repo/.git/worktrees/survivor\n");
      return { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false };
    });

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: false });
    // Restored, NOT reported as a stranger's: the relative form resolves to the
    // very entry this adoption created.
    expect((result as { leftBehind?: unknown }).leftBehind).toBeUndefined();
    expect(store.linkBytes()).toBe(ORIGINAL_LINK);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });

  // The handle outlives the call because the undo does. Closing it on return
  // would hand the caller a withdrawal that can only fail.
  it("keeps the link open for a caller that withdraws, and releases it for one that keeps", async () => {
    const { runner } = runnerOf();
    const kept = fsOf();

    const held = await adoptWorktree(runner, request, kept.fs);
    expect(held.ok).toBe(true);
    expect(kept.wasClosed(), "the handle was closed before the caller could withdraw").toBe(false);
    if (held.ok) {
      await held.release();
    }
    expect(kept.wasClosed()).toBe(true);

    const withdrawn = fsOf();
    const second = await adoptWorktree(runner, request, withdrawn.fs);
    if (second.ok) {
      expect(await second.undo()).toBeUndefined();
    }
    expect(withdrawn.linkBytes()).toBe(ORIGINAL_LINK);
    expect(withdrawn.wasClosed()).toBe(true);
  });
});

describe("adoptWorktree will not write an object that has a second name", () => {
  // `O_NOFOLLOW` refuses a symlink at the leaf. Nothing in it refuses a HARD
  // LINK, and `isFile()` is true of an inode with two names — so truncating the
  // descriptor would rewrite a file outside this checkout (round-4 F013).
  it("refuses at the open, before anything is created", async () => {
    const { runner, calls } = runnerOf();
    const store = fsOf();
    store.hardLinkTheLink();

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: false });
    expect(store.writes).toEqual([]);
    expect(calls).toEqual([]);
    expect(store.linkBytes()).toBe(ORIGINAL_LINK);
  });

  it("refuses at the claim when the second name appears while it works", async () => {
    const { runner } = runnerOf();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      // The alias lands after the open, so only the re-read before the claim
      // can catch it.
      createFile: async (p, data) => {
        const written = await store.fs.createFile(p, data);
        if (p.endsWith("/HEAD")) {
          store.hardLinkTheLink();
        }
        return written;
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false });
    expect(store.linkBytes(), "the aliased object was truncated anyway").toBe(ORIGINAL_LINK);
    expect(store.dirs.has(ENTRY)).toBe(false);
  });
});

describe("adoptWorktree withdraws in an order that leaves no dangling link", () => {
  function failingRepair() {
    return runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(`${TIP}\n`),
    );
  }

  // Removing the entry first leaves an interval in which `<wt>/.git` names a
  // directory that is already gone (round-4 F005).
  it("puts the link back before it removes the entry", async () => {
    const { runner } = failingRepair();
    const store = fsOf();

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result).toMatchObject({ ok: false });
    const restored = store.writes.lastIndexOf(`write ${WT}/.git`);
    const removed = store.writes.indexOf(`rm ${ENTRY}`);
    expect(restored, "the link was never put back").toBeGreaterThanOrEqual(0);
    expect(removed, "the entry was never removed").toBeGreaterThanOrEqual(0);
    expect(restored, "the entry was removed while the link still named it").toBeLessThan(removed);
  });

  // The sample before the restore expires the moment it returns. The handle
  // keeps the write off anyone else's file, so what is left is a REPORT that
  // says the link is back when the name points somewhere else entirely.
  it("does not report a restore that landed on a detached object", async () => {
    const { runner } = failingRepair();
    const store = fsOf();
    const REPLACEMENT = "gitdir: /repo/.git/worktrees/somebody-else\n";
    const fs: AdoptFs = {
      ...store.fs,
      openLink: async (p) => {
        const handle = await store.fs.openLink(p);
        return {
          ...handle,
          writeAt: async (data, position) => {
            const wrote = await handle.writeAt(data, position);
            // The restore is the write of the ORIGINAL bytes. The substitution
            // lands immediately after it, so the proof taken BEFORE the restore
            // passed and only a second proof can see it. Rebinding the path is
            // what makes the identity move — returning a stale identity from
            // the reader would leave this case unable to see anything, which is
            // how it passed with the guard removed the first time it was written.
            if (data.toString("utf8") === ORIGINAL_LINK) {
              store.replaceLink(REPLACEMENT);
            }
            return wrote;
          },
        };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false, leftBehind: { link: "leftAsFound" } });
    expect(store.linkBytes()).toBe(REPLACEMENT);
  });
});

describe("adoptWorktree's withdrawal does not consult the link's name", () => {
  const TAKEN_OVER = "gitdir: /repo/.git/worktrees/taken-over\n";

  function failingRepair() {
    return runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(`${TIP}\n`),
    );
  }

  // The rule itself, witnessed as an ABSENCE. Rounds 5 and 6 both turned on a
  // pathname read inside the undo whose answer expired before the `removeDir`;
  // the fix is that the read is gone, and only counting reads can prove a read
  // is gone. Asserting on the outcome alone would pass with the read restored.
  it("reads the checkout's git link by name zero times while withdrawing", async () => {
    const { runner } = failingRepair();
    const store = fsOf();

    const result = await adoptWorktree(runner, request, store.fs);

    expect(result.ok).toBe(false);
    expect(store.reads.filter((p) => p === `${WT}/.git`)).toEqual([]);
  });

  // The same distinction at the OPEN. Both counts refuse, so only the message
  // separates them — and a user told "also reachable under another name" about a
  // link somebody deleted is being told the wrong thing to go look at.
  it("says the link was taken away, not aliased, when it is already nameless at the open", async () => {
    const { runner } = failingRepair();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      openLink: async (p) => {
        const handle = await store.fs.openLink(p);
        return { ...handle, identity: async () => ({ ...(await handle.identity()), nlink: 0 }) };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("was replaced before the adoption began");
    expect(store.writes, "something was created before the link was proved").toEqual([]);
  });

  // Oracle B1: `nlink` 0 and `nlink` 2 both refused the write and were reported
  // identically, but zero is positive evidence the link was TAKEN AWAY.
  it("reports a link that was replaced before the claim as left as found, and still withdraws", async () => {
    const { runner } = failingRepair();
    const store = fsOf();
    let sampled = 0;
    const fs: AdoptFs = {
      ...store.fs,
      // The replacement lands AFTER the pre-write identity sample and before the
      // write reaches for the descriptor — oracle B1's exact schedule. Landing it
      // any earlier is caught by the identity comparison instead, which would
      // make this a witness for a guard it was not written for.
      identify: async (p) => {
        const seen = await store.fs.identify(p);
        if (p === `${WT}/.git`) {
          sampled += 1;
          if (sampled === 1) {
            store.replaceLink(TAKEN_OVER);
          }
        }
        return seen;
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false, leftBehind: { entryPath: null, link: "leftAsFound" } });
    expect(store.linkBytes(), "the replacement was overwritten").toBe(TAKEN_OVER);
    expect(store.dirs.has(ENTRY), "the entry this adoption made was left for nothing to collect").toBe(false);
  });

  // POSIX: an unsuccessful `ftruncate` leaves the file unaffected, which is what
  // lets a rejected truncate be classified as "nothing happened". The seam is
  // injected, so the guarantee is checked here rather than assumed of the double.
  it("treats a rejecting truncate as a write that never began", async () => {
    const { runner } = failingRepair();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      openLink: async (p) => {
        const handle = await store.fs.openLink(p);
        return {
          ...handle,
          truncate: async () => {
            throw new Error("EROFS");
          },
        };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    expect(store.linkBytes(), "a refused truncate changed the file").toBe(ORIGINAL_LINK);
    // Nothing was installed, so there is no residue to report at all — the
    // failure changed nothing and the entry went by the ordinary path.
    expect(result.ok === false && result.leftBehind).toBeUndefined();
    expect(store.dirs.has(ENTRY)).toBe(false);
  });

  // Round-6 F016: every late-alias witness so far aliased AFTER a successful
  // claim. This one fails the claim first, so the recovery is what meets it.
  it("will not rewrite an alias that appears before the failed claim's recovery", async () => {
    const { runner } = failingRepair();
    const store = fsOf();
    let wrote = 0;
    const fs: AdoptFs = {
      ...store.fs,
      openLink: async (p) => {
        const handle = await store.fs.openLink(p);
        return {
          ...handle,
          writeAt: async (data, position) => {
            wrote += 1;
            if (wrote === 1) {
              // The claim truncated and then failed; the alias lands before the
              // recovery reaches for the same descriptor.
              store.hardLinkTheLink();
              throw new Error("EIO");
            }
            return handle.writeAt(data, position);
          },
        };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result.ok).toBe(false);
    // The recovery refused on the second name, so the aliased object still holds
    // what the truncate left — not the stale bytes written through an alias.
    expect(result.ok === false && result.leftBehind?.link).toBe("unknown");
    expect(store.dirs.has(ENTRY)).toBe(false);
  });
});

describe("adoptWorktree withdraws the entry it created whatever the link says", () => {
  function failingRepair() {
    return runnerOf((args) =>
      args[1] === "repair"
        ? { code: 1, stdout: Buffer.alloc(0), stderr: "fatal: nope", timedOut: false, failedToSpawn: false }
        : ok(`${TIP}\n`),
    );
  }

  // Rounds 4 and 5 made the removal depend on what the visible link named, and
  // round 6 found the schedule where that read expires before the `removeDir`.
  // The dependency is gone, and this is the case it used to protect: the entry
  // is removed even though a replacement link names it. Verified on git 2.50.1,
  // that leaves the destination in the state `probeAdopt` recognises and that
  // `git worktree prune` produces unasked — whereas RETAINING it leaves a
  // directory `git worktree list` omits and `prune` never collects.
  it("removes the entry even when a foreign link names it", async () => {
    const { runner } = failingRepair();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      openLink: async (p) => {
        const handle = await store.fs.openLink(p);
        return {
          ...handle,
          writeAt: async (data, position) => {
            const wrote = await handle.writeAt(data, position);
            // A replacement that points at THIS adoption's entry — the case the
            // `somebody-else` witness could not see, because it named a path
            // nothing depended on.
            if (data.toString("utf8") === ORIGINAL_LINK) {
              store.replaceLink(`gitdir: ${ENTRY}\n`);
            }
            return wrote;
          },
        };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false, leftBehind: { entryPath: null, link: "leftAsFound" } });
    expect(store.dirs.has(ENTRY), "an entry nothing will ever collect was left behind").toBe(false);
    // The replacement's bytes are untouched — the undo refuses to write a link
    // it does not own, which is a separate rule from whether the entry goes.
    expect(store.linkBytes()).toBe(`gitdir: ${ENTRY}\n`);
  });

  // `putLink` has three callers and the count used to be at one of them.
  it("will not rewrite an alias that appears before the undo's restore", async () => {
    const { runner } = failingRepair();
    const store = fsOf();
    const fs: AdoptFs = {
      ...store.fs,
      openLink: async (p) => {
        const handle = await store.fs.openLink(p);
        let claimed = false;
        return {
          ...handle,
          writeAt: async (data, position) => {
            const wrote = await handle.writeAt(data, position);
            if (!claimed) {
              claimed = true;
              // The alias lands AFTER a successful claim, so only a count taken
              // inside the write can see it when the undo comes back through.
              store.hardLinkTheLink();
            }
            return wrote;
          },
        };
      },
    };

    const result = await adoptWorktree(runner, request, fs);

    expect(result).toMatchObject({ ok: false });
    // The restore did not happen, and the outcome says so rather than claiming
    // a withdrawal that rewrote a file outside the checkout.
    expect(store.linkBytes(), "the aliased object was rewritten by the undo").toBe(`gitdir: ${ENTRY}\n`);
    // `unknown`, and deliberately so: the alias refusal spared the aliased file
    // but the link still holds THIS adoption's claim, which is neither restored
    // nor as found. The `notWritten` outcome maps to "as found" only at the
    // claim, where nothing had been installed yet (round-6 F015).
    expect(result.ok === false && result.leftBehind?.link).toBe("unknown");
  });
});
