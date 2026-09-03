// src/worktree/provisioning/applyEntries.node.test.ts — the walk against a REAL
// filesystem, through the binding production actually passes.
//
// This suite exists because round-1 F003 was invisible to the other one. The
// fake at `applyEntries.fake.ts` supplies a `realpath` that `nodeApplyFsDeps`
// does not, so every assertion over there ran a corrected implementation while
// `extension.ts` handed the real one a binding that resolved symlink targets
// from LEXICAL dirnames. A dependency the tests inject and production omits is
// a hole no amount of care in the fake can find; only exercising the exported
// binding itself can.
//
// So: no fake, no injection. `nodeApplyFsDeps` verbatim, on a temp tree.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProvisionEntry } from "../../types/messages";
import { authorizeDirectory, directoryStillAuthorized } from "../../utils/authorizedDirectory";
import { afterDelay } from "../deadline";
import { type ApplyBudget, applyEntry, nodeApplyFsDeps } from "./applyEntries";
import { type EntryGateRoots, prepareEntryGate, refusedLockfile } from "./entryGate";

let tmp: string;
let main: string;
let worktree: string;
let roots: EntryGateRoots;

const budget = (over: Partial<ApplyBudget> = {}): ApplyBudget => ({
  maxNodes: 1000,
  maxBytes: 1024 * 1024,
  deadline: afterDelay(30_000),
  ...over,
});

const entry = (over: Partial<ProvisionEntry> = {}): ProvisionEntry => ({
  id: "e1",
  path: ".env",
  mode: "copy",
  source: "asimov/worktree.yaml",
  ...over,
});

const apply = (e: ProvisionEntry, b: ApplyBudget = budget()) =>
  applyEntry(e, roots, b, nodeApplyFsDeps, { directoryStillAuthorized });

beforeEach(async () => {
  // `realpath` the temp root: macOS hands out `/var/...`, a symlink to
  // `/private/var`. Without this every containment check in the suite would be
  // comparing a resolved path against an unresolved root and refusing
  // everything — passing tests that prove nothing.
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "apply-node-")));
  main = path.join(tmp, "main");
  worktree = path.join(tmp, "wt");
  await fs.mkdir(main, { recursive: true });
  await fs.mkdir(worktree, { recursive: true });
  const [source, destination] = await Promise.all([authorizeDirectory(main), authorizeDirectory(worktree)]);
  if (source === undefined || destination === undefined) {
    throw new Error("the gate could not authorize its roots");
  }
  const prepared = await prepareEntryGate(main, worktree, { source, destination }, nodeApplyFsDeps);
  if (prepared === null) {
    throw new Error("the gate would not prepare its roots");
  }
  roots = prepared;
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("the binding production actually passes", () => {
  it("copies a declared file", async () => {
    await fs.writeFile(path.join(main, ".env"), "TOKEN=1");

    expect((await apply(entry())).outcome).toEqual({ kind: "copied" });
    expect(await fs.readFile(path.join(worktree, ".env"), "utf8")).toBe("TOKEN=1");
  });

  it("does not read replacement source bytes after the observed checkout is recreated", async () => {
    const original = `${main}-original`;
    await fs.rename(main, original);
    await fs.mkdir(main);
    await fs.writeFile(path.join(main, ".env"), "REPLACEMENT=1");

    const result = await apply(entry());

    expect(result.outcome.kind).toBe("failed");
    await expect(fs.readFile(path.join(worktree, ".env"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not read through a recreated source ancestor", async () => {
    const sourceParent = path.join(tmp, "source-parent");
    const sourceRoot = path.join(sourceParent, "main");
    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.writeFile(path.join(sourceRoot, ".env"), "ORIGINAL=1");
    const [source, destination] = await Promise.all([authorizeDirectory(sourceRoot), authorizeDirectory(worktree)]);
    if (source === undefined || destination === undefined) {
      throw new Error("the test roots could not be authorized");
    }
    const localRoots = await prepareEntryGate(sourceRoot, worktree, { source, destination }, nodeApplyFsDeps);
    if (localRoots === null) {
      throw new Error("the test roots did not prepare");
    }
    await fs.rename(sourceParent, `${sourceParent}-original`);
    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.writeFile(path.join(sourceRoot, ".env"), "REPLACEMENT=1");

    const result = await applyEntry(entry(), localRoots, budget(), nodeApplyFsDeps, { directoryStillAuthorized });

    expect(result.outcome.kind).toBe("failed");
    await expect(fs.readFile(path.join(worktree, ".env"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not write through a recreated destination root", async () => {
    await fs.writeFile(path.join(main, ".env"), "TOKEN=1");
    const original = `${worktree}-original`;
    await fs.rename(worktree, original);
    await fs.mkdir(worktree);

    const result = await apply(entry());

    expect(result.outcome.kind).toBe("failed");
    await expect(fs.readFile(path.join(worktree, ".env"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("[F003] refuses a link whose REAL directory is outside, though its lexical one is inside", async () => {
    // The chair's reproduction, on disk. `pkg/deep/alias` is a committed
    // symlink to `shared`, and `shared/tree/link` points out of the repo. The
    // entry is admitted because it realpath-resolves inside the main checkout.
    //
    // Resolved lexically, BOTH halves of D6 pass: `<main>/pkg/deep/alias/tree`
    // and `<wt>/pkg/deep/alias/tree` each look like ordinary in-tree
    // directories. Resolved really, the link lands at `<wt>/shared/tree/link`
    // — the kernel followed `alias` — and points at `/outside.txt`.
    await fs.mkdir(path.join(main, "pkg", "deep"), { recursive: true });
    await fs.mkdir(path.join(main, "shared", "tree"), { recursive: true });
    await fs.writeFile(path.join(tmp, "outside.txt"), "secret");
    await fs.symlink("../../shared", path.join(main, "pkg", "deep", "alias"));
    await fs.symlink("../../../outside.txt", path.join(main, "shared", "tree", "link"));

    const result = await apply(entry({ path: "pkg/deep/alias/tree" }));

    const landed = path.join(worktree, "shared", "tree", "link");
    await expect(fs.lstat(landed)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.details?.some((d) => d.reason.includes("outside"))).toBe(true);
  });

  it("recreates a link that really is inside, so the check above is not just refusing everything", async () => {
    await fs.mkdir(path.join(main, "cfg"), { recursive: true });
    await fs.writeFile(path.join(main, "cfg", "real.json"), "{}");
    await fs.symlink("real.json", path.join(main, "cfg", "alias.json"));

    const result = await apply(entry({ path: "cfg" }));

    expect(result.outcome).toEqual({ kind: "copied" });
    expect(await fs.readlink(path.join(worktree, "cfg", "alias.json"))).toBe("real.json");
  });

  it("never writes through a destination symlink planted mid-walk", async () => {
    await fs.mkdir(path.join(main, "cfg"), { recursive: true });
    await fs.writeFile(path.join(main, "cfg", "a.txt"), "in");
    await fs.mkdir(path.join(tmp, "elsewhere"), { recursive: true });
    await fs.symlink(path.join(tmp, "elsewhere"), path.join(worktree, "cfg"));

    const result = await apply(entry({ path: "cfg" }));

    expect(result.outcome.kind).toBe("refused");
    await expect(fs.lstat(path.join(tmp, "elsewhere", "a.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("[F012] creates the destination parents a declared entry needs", async () => {
    // A gitignored subdirectory does not exist in a worktree git just made, so
    // this is the ordinary case rather than an edge one.
    await fs.mkdir(path.join(main, "apps", "web"), { recursive: true });
    await fs.writeFile(path.join(main, "apps", "web", ".env"), "K=V");

    expect((await apply(entry({ path: "apps/web/.env" }))).outcome).toEqual({ kind: "copied" });
    expect(await fs.readFile(path.join(worktree, "apps", "web", ".env"), "utf8")).toBe("K=V");
  });

  it("[F002] refuses ONE file larger than the whole byte budget", async () => {
    await fs.writeFile(path.join(main, ".env"), "x".repeat(4096));

    const result = await apply(entry(), budget({ maxBytes: 64 }));

    expect(result.outcome.kind).toBe("failed");
    await expect(fs.lstat(path.join(worktree, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("[F002] writes nothing at all when the deadline has already passed", async () => {
    await fs.writeFile(path.join(main, ".env"), "TOKEN=1");
    const spent = afterDelay(0);
    await new Promise((r) => setTimeout(r, 5));

    const result = await apply(entry(), budget({ deadline: spent }));

    expect(result.outcome.kind).toBe("failed");
    await expect(fs.lstat(path.join(worktree, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("[F004] refuses a lockfile spelled with a backslash", async () => {
    await fs.writeFile(path.join(main, "pnpm-lock.yaml"), "lockfileVersion: 9");

    const result = await apply(entry({ path: "tools\\pnpm-lock.yaml" }));

    expect(result.outcome.kind).toBe("refused");
  });
});

describe("[round-4 F025] a lockfile reaches the worktree through no ancestor", () => {
  it("refuses a lockfile found inside a copied directory, and keeps the rest", async () => {
    // The entry-level rule ran once. A directory copy walked past it and the
    // step still reported `copied` — the destination lockfile held the main
    // checkout's bytes.
    await fs.mkdir(path.join(main, "cfg"));
    await fs.writeFile(path.join(main, "cfg", "pnpm-lock.yaml"), "lockfileVersion: 9");
    await fs.writeFile(path.join(main, "cfg", "app.json"), "{}");

    const result = await apply(entry({ path: "cfg" }));

    await expect(fs.lstat(path.join(worktree, "cfg", "pnpm-lock.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(worktree, "cfg", "app.json"), "utf8")).toBe("{}");
    // D8: the parent keeps ONE outcome and the refusal rides as a detail.
    expect(result.outcome.kind).toBe("copied");
    expect(result.details?.map((d) => d.reason)).toEqual([
      "a lockfile is never brought over — this branch's own lockfile is the authoritative one",
    ]);
  });

  it("refuses an INWARD symlink named like a lockfile, which D6 would happily recreate", async () => {
    // The hole the oracle found in the first fix. D6 asks where a link's target
    // resolves, never what the link is CALLED: `pnpm-lock.yaml → actual` is
    // inside main and inside the worktree on both sides, so it is recreated —
    // and reading it in the new worktree reads the main checkout's lockfile.
    // The plain file beside it passes on its own name.
    await fs.mkdir(path.join(main, "cfg"));
    await fs.writeFile(path.join(main, "cfg", "actual"), "lockfileVersion: 9");
    await fs.symlink("actual", path.join(main, "cfg", "pnpm-lock.yaml"));

    await apply(entry({ path: "cfg" }));

    await expect(fs.lstat(path.join(worktree, "cfg", "pnpm-lock.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    // `actual` is not a lockfile by name and is not what the rule is about.
    expect(await fs.readFile(path.join(worktree, "cfg", "actual"), "utf8")).toBe("lockfileVersion: 9");
  });

  it("refuses the head of an inward symlink CHAIN, so the alias never lands", async () => {
    await fs.mkdir(path.join(main, "cfg"));
    await fs.writeFile(path.join(main, "cfg", "actual"), "lockfileVersion: 9");
    await fs.symlink("actual", path.join(main, "cfg", "alias"));
    await fs.symlink("alias", path.join(main, "cfg", "pnpm-lock.yaml"));

    await apply(entry({ path: "cfg" }));

    await expect(fs.lstat(path.join(worktree, "cfg", "pnpm-lock.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not refuse a DIRECTORY named like a lockfile, nor give a FIFO the wrong reason", async () => {
    // The rule is about lockfile bytes, not about the string. Refusing by name
    // before the kind is known would hand both of these a reason that is not
    // true of them.
    await fs.mkdir(path.join(main, "cfg"));
    await fs.mkdir(path.join(main, "cfg", "pnpm-lock.yaml"));
    await fs.writeFile(path.join(main, "cfg", "pnpm-lock.yaml", "README.md"), "notes");

    const result = await apply(entry({ path: "cfg" }));

    expect(result.outcome.kind).toBe("copied");
    expect(await fs.readFile(path.join(worktree, "cfg", "pnpm-lock.yaml", "README.md"), "utf8")).toBe("notes");
  });

  it("charges no bytes for a descendant it refuses", async () => {
    // The refusal sits ahead of `spendBytes`, so a node that is never written
    // cannot push a later sibling over the cap.
    await fs.mkdir(path.join(main, "cfg"));
    await fs.writeFile(path.join(main, "cfg", "pnpm-lock.yaml"), "0123456789");
    await fs.writeFile(path.join(main, "cfg", "app.json"), "{}");

    const shared = budget({ maxBytes: 4 });
    const result = await apply(entry({ path: "cfg" }), shared);

    expect(result.outcome.kind).toBe("copied");
    expect(await fs.readFile(path.join(worktree, "cfg", "app.json"), "utf8")).toBe("{}");
  });
});

describe("[round-4 F004] the classifier reads the identity the filesystem acts on", () => {
  it.each([
    ["pnpm-lock.yaml.", "a trailing dot Win32 strips"],
    ["pnpm-lock.yaml ", "a trailing space Win32 strips"],
    ["pnpm-lock.yaml::$DATA", "the default data stream"],
    ["pnpm-lock.yaml::$DATA.", "a stream spelling behind a stripped dot"],
    ["pnpm-lock.yaml. ::$DATA", "a stream spelling ahead of a stripped dot and space"],
  ])("folds %s — %s — where the filesystem does", async (spelling) => {
    // Round 4 asserted a refusal here on every platform. That was wrong on this
    // one, and this suite runs against the REAL filesystem, which is the thing
    // best placed to say so: writing the alias and the lockfile side by side
    // gives two files, so the alias is not the object the rule protects
    // (.reviews/round-5.md F028). The Win32 half of the claim is asserted
    // directly in `entryGate.test.ts`, on every host.
    await fs.writeFile(path.join(main, "pnpm-lock.yaml"), "lockfileVersion: 9");
    await fs.writeFile(path.join(main, spelling), "not the lockfile");

    const result = await apply(entry({ path: spelling }));

    expect(result.outcome.kind).toBe(path.sep === "\\" ? "refused" : "copied");
    expect(refusedLockfile(spelling, true)).toMatch(/lockfile/i);
  });

  it("still admits an entry whose offending segment resolution discards", async () => {
    // A rule over the SPELLING would refuse this for the `scratch.` segment,
    // which `path.resolve` removes before the walk ever sees it — the
    // raw-versus-resolved disagreement round-2 F004 removed.
    await fs.writeFile(path.join(main, ".env"), "TOKEN=1");

    const result = await apply(entry({ path: "scratch./../.env" }));

    expect(result.outcome.kind).toBe("copied");
  });
});

describe("[round-4 F027] the mode that lands is the mode the source had", () => {
  // The ambient umask, not one this suite sets — vitest workers refuse
  // `process.umask(mask)`. That is enough, because the defect IS the umask
  // being applied: any nonzero mask makes the two modes differ.
  const MASK = process.umask();

  it("has a umask that can tell the two apart, so the two tests below are not vacuous", () => {
    // Without this the suite would pass on a machine whose umask is 0 while
    // proving nothing at all.
    expect(MASK & 0o777).not.toBe(0);
  });

  it("keeps a file's permission bits", async () => {
    // `fs.open`'s `O_CREAT` mode is masked by the process umask and nothing
    // restored it, so a `0777` source arrived masked while the step reported
    // `copied`. The fake stores the supplied mode verbatim, so only this suite
    // can see it.
    await fs.writeFile(path.join(main, "run.sh"), "#!/bin/sh\n");
    await fs.chmod(path.join(main, "run.sh"), 0o777);

    const result = await apply(entry({ path: "run.sh" }));

    expect(result.outcome.kind).toBe("copied");
    expect((await fs.stat(path.join(worktree, "run.sh"))).mode & 0o777).toBe(0o777);
  });

  it("keeps a directory's permission bits too", async () => {
    await fs.mkdir(path.join(main, "shared"));
    await fs.chmod(path.join(main, "shared"), 0o777);
    await fs.writeFile(path.join(main, "shared", "a.txt"), "a");

    await apply(entry({ path: "shared" }));

    expect((await fs.stat(path.join(worktree, "shared"))).mode & 0o777).toBe(0o777);
  });
});

describe("[round-4 F016] a direct link is one node like any other", () => {
  it("refuses a root-level link when no node is left in the budget", async () => {
    // A root-level link creates no parent, so `ensureParents` spends nothing
    // and this arm reached `symlink` with the budget entirely unconsulted.
    await fs.writeFile(path.join(main, "third_party"), "x");

    const result = await apply(entry({ path: "third_party", mode: "link" }), budget({ maxNodes: 0 }));

    expect(result.outcome.kind).toBe("failed");
    await expect(fs.lstat(path.join(worktree, "third_party"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a link whose destination already exists, rather than skipping for free", async () => {
    // The EEXIST arm answered `skipped` without ever charging the node, so the
    // cheap path was also the unaccounted one.
    await fs.writeFile(path.join(main, "third_party"), "x");
    await fs.writeFile(path.join(worktree, "third_party"), "y");

    const result = await apply(entry({ path: "third_party", mode: "link" }), budget({ maxNodes: 0 }));

    expect(result.outcome.kind).toBe("failed");
  });
});

describe("[round-4 F021] the transfer is bounded while it runs, not audited after", () => {
  it("stops a copy that outgrows the ceiling it was given", async () => {
    // The binding's own contract, exercised directly: a stat before the open is
    // an ESTIMATE, and a source that is larger than the remaining budget must
    // fail during the stream rather than be reconciled once the bytes are down.
    await fs.writeFile(path.join(main, "big.bin"), "x".repeat(64 * 1024));

    await expect(
      nodeApplyFsDeps.copyFileNoFollow(
        path.join(main, "big.bin"),
        path.join(worktree, "big.bin"),
        0o644,
        undefined,
        16,
      ),
    ).rejects.toThrow(/too large/);
  });

  it("answers with the bytes it actually wrote, not the size it was told", async () => {
    await fs.writeFile(path.join(main, "small.txt"), "hello");

    const written = await nodeApplyFsDeps.copyFileNoFollow(
      path.join(main, "small.txt"),
      path.join(worktree, "small.txt"),
      0o644,
      undefined,
      1024,
    );

    expect(written).toBe(5);
  });
});

describe("[round-4 F019] a name that begins with two dots is not an escape", () => {
  it("admits an entry under a directory literally named `..cache`", async () => {
    await fs.mkdir(path.join(main, "..cache"), { recursive: true });
    await fs.writeFile(path.join(main, "..cache", "seed"), "s");

    const result = await apply(entry({ path: "..cache/seed" }));

    expect(result.outcome.kind).toBe("copied");
    expect(await fs.readFile(path.join(worktree, "..cache", "seed"), "utf8")).toBe("s");
  });
});

describe("[round-5 F021] a transfer that fails partway is charged for the bytes it forwarded", () => {
  /**
   * The reachable race, written down rather than mocked: `lstat` answers with
   * the size it really saw, and the source grows before the copy opens it. Every
   * other dependency is the production binding, which is the whole point — the
   * injected fake owns its own copy and ignores `limit`, so no assertion over
   * there can see this.
   */
  function growsAfterStat(target: string, extra: number): typeof nodeApplyFsDeps {
    return {
      ...nodeApplyFsDeps,
      lstat: async (p: string) => {
        const stat = await nodeApplyFsDeps.lstat(p);
        if (p === target) {
          await fs.appendFile(p, "g".repeat(extra));
        }
        return stat;
      },
    };
  }

  it("does not let a later entry spend the bytes a failed copy already wrote", async () => {
    const CAP = 100 * 1024;
    const grows = path.join(main, "grows.bin");
    await fs.writeFile(grows, "g".repeat(1024));
    await fs.writeFile(path.join(main, "after.bin"), "a".repeat(60 * 1024));
    const shared = budget({ maxBytes: CAP });

    const failed = await applyEntry(entry({ path: "grows.bin" }), roots, shared, growsAfterStat(grows, 150 * 1024), {
      directoryStillAuthorized,
    });
    const after = await applyEntry(entry({ id: "e2", path: "after.bin" }), roots, shared, nodeApplyFsDeps, {
      directoryStillAuthorized,
    });

    expect(failed.outcome.kind).toBe("failed");
    // The claim D10 makes is over the worktree, not over the counter — so this
    // adds up what is ON DISK. The first step left a partial file standing on
    // purpose (D9 never deletes), and the cap has to hold anyway.
    const landed = await fs.readdir(worktree);
    const sizes = await Promise.all(landed.map(async (n) => (await fs.stat(path.join(worktree, n))).size));
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CAP);
    expect(after.outcome.kind).toBe("failed");
  });

  it("charges nothing for a failure that never opened the destination", async () => {
    // The other direction, so the fix cannot be "always consume the ceiling":
    // an unreadable source forwards no bytes and must leave the budget free for
    // the entries behind it.
    const shared = budget({ maxBytes: 64 * 1024 });
    await fs.writeFile(path.join(main, "fine.txt"), "f".repeat(1024));

    const missing = await applyEntry(entry({ path: "gone.txt" }), roots, shared, nodeApplyFsDeps, {
      directoryStillAuthorized,
    });
    const fine = await applyEntry(entry({ id: "e2", path: "fine.txt" }), roots, shared, nodeApplyFsDeps, {
      directoryStillAuthorized,
    });

    expect(missing.outcome.kind).toBe("failed");
    expect(fine.outcome.kind).toBe("copied");
    expect(shared.spent?.bytes).toBe(1024);
  });
});
