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
import { afterDelay } from "../deadline";
import { type ApplyBudget, applyEntry, nodeApplyFsDeps } from "./applyEntries";
import { type EntryGateRoots, prepareEntryGate } from "./entryGate";

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

const apply = (e: ProvisionEntry, b: ApplyBudget = budget()) => applyEntry(e, roots, b, nodeApplyFsDeps);

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
  const prepared = await prepareEntryGate(main, worktree, nodeApplyFsDeps);
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
