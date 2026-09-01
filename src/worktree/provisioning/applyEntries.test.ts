// src/worktree/provisioning/applyEntries.test.ts
//
// Every case here exists because the obvious walk passes without it. The plan
// attack on this change's ledger supplied most of them: an intermediate
// component swapped after validation, a source swapped after `lstat`, and a
// relative symlink that is inside the repository where it was found and outside
// the worktree where it lands.

import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProvisionEntry } from "../../types/messages";
import { afterDelay } from "../deadline";
import { applyEntry } from "./applyEntries";
import { type FakeNode, fakeFs } from "./applyEntries.fake";
import { prepareEntryGate } from "./entryGate";

const MAIN = "/repo";
const WT = "/wt/feature";

const entry = (path: string, mode: "copy" | "link" = "copy"): ProvisionEntry => ({
  id: "i1",
  path,
  mode,
  source: "asimov/worktree.yaml",
});

/** Roots exist in every case; only what hangs beneath them varies. */
const base: Record<string, FakeNode> = {
  "/repo": { kind: "dir" },
  "/wt": { kind: "dir" },
  "/wt/feature": { kind: "dir" },
};

const budget = () => ({ maxNodes: 1000, maxBytes: 1 << 20, deadline: afterDelay(60_000) });

async function apply(e: ProvisionEntry, tree: Record<string, FakeNode>, over: Partial<ReturnType<typeof budget>> = {}) {
  const fs = fakeFs({ ...base, ...tree });
  const roots = await prepareEntryGate(MAIN, WT, fs);
  if (roots === null) {
    throw new Error("roots did not prepare");
  }
  const result = await applyEntry(e, roots, { ...budget(), ...over }, fs);
  return { result, fs };
}

describe("a copy replaces nothing that already existed", () => {
  it("copies a plain file into the new worktree", async () => {
    const { result, fs } = await apply(entry(".env"), { "/repo/.env": { kind: "file", mode: 0o600 } });
    expect(result.outcome.kind).toBe("copied");
    expect(fs.nodes.get("/wt/feature/.env")).toEqual({ kind: "file", mode: 0o600, size: 1 });
  });

  it("skips a destination that already exists rather than replacing it", async () => {
    const { result, fs } = await apply(entry(".env"), {
      "/repo/.env": { kind: "file", size: 7 },
      "/wt/feature/.env": { kind: "file", size: 99 },
    });
    expect(result.outcome.kind).toBe("skipped");
    // The point of the claim: the existing bytes are still the existing bytes.
    expect(fs.nodes.get("/wt/feature/.env")).toMatchObject({ size: 99 });
    expect(fs.created).toEqual([]);
  });

  it("skips one descendant of an existing destination directory and copies its siblings", async () => {
    const { result, fs } = await apply(entry("config"), {
      "/repo/config": { kind: "dir" },
      "/repo/config/local.json": { kind: "file", size: 1 },
      "/repo/config/other.json": { kind: "file", size: 2 },
      "/wt/feature/config": { kind: "dir" },
      "/wt/feature/config/local.json": { kind: "file", size: 42 },
    });
    expect(result.outcome.kind).toBe("copied");
    expect(fs.nodes.get("/wt/feature/config/local.json")).toMatchObject({ size: 42 });
    expect(fs.nodes.get("/wt/feature/config/other.json")).toMatchObject({ size: 2 });
    // A directory entry has one outcome and many nodes; the skipped file has to
    // be reportable or the spec's scenario cannot be observed at all.
    expect(result.details?.map((d) => d.path)).toContain("config/local.json");
  });
});

describe("the walk never follows something it did not check", () => {
  it("fails rather than copying through a source that became a symlink after its lstat", async () => {
    const fs = fakeFs({
      ...base,
      "/repo/.env": { kind: "file" },
      "/outside": { kind: "dir" },
      "/outside/secret": { kind: "file" },
    });
    // The swap happens between the walk's lstat and its open — the exact window
    // a following copyFile would read through.
    fs.beforeLstat = (p) => {
      if (p === "/repo/.env") {
        fs.nodes.set("/repo/.env", { kind: "link", target: "/outside/secret" });
      }
    };
    const roots = await prepareEntryGate(MAIN, WT, fs);
    if (roots === null) {
      throw new Error("roots did not prepare");
    }
    const result = await applyEntry(entry(".env"), roots, budget(), fs);
    expect(result.outcome.kind).not.toBe("copied");
    expect(fs.nodes.has("/wt/feature/.env")).toBe(false);
  });

  it("refuses to descend through a destination directory that is a symlink out of the worktree", async () => {
    const { result, fs } = await apply(entry("cfg"), {
      "/repo/cfg": { kind: "dir" },
      "/repo/cfg/app.json": { kind: "file" },
      "/outside": { kind: "dir" },
      // The destination's own parent leads out. COPYFILE_EXCL would not have
      // noticed: it guards the final component only.
      "/wt/feature/cfg": { kind: "link", target: "/outside" },
    });
    expect(result.outcome.kind).toBe("refused");
    expect(fs.nodes.has("/outside/app.json")).toBe(false);
  });

  it("refuses a NESTED destination component that is a symlink, which the entry gate never sees", async () => {
    // The gate checks the entry's own path; `cfg` is contained and absent, so it
    // is admitted. The escape is one level down, which is exactly where an
    // exclusive final-component primitive stops protecting anything.
    const { result, fs } = await apply(entry("cfg"), {
      "/repo/cfg": { kind: "dir" },
      "/repo/cfg/sub": { kind: "dir" },
      "/repo/cfg/sub/app.json": { kind: "file" },
      "/outside": { kind: "dir" },
      "/wt/feature/cfg": { kind: "dir" },
      "/wt/feature/cfg/sub": { kind: "link", target: "/outside" },
    });
    expect(fs.nodes.has("/outside/app.json")).toBe(false);
    expect(result.details?.some((d) => /symlink/i.test(d.reason))).toBe(true);
  });

  it("reports a source directory over a destination file, rather than ENOTDIR on its children", async () => {
    const { result } = await apply(entry("cfg"), {
      "/repo/cfg": { kind: "dir" },
      "/repo/cfg/app.json": { kind: "file" },
      "/wt/feature/cfg": { kind: "file" },
    });
    expect(["refused", "skipped"]).toContain(result.outcome.kind);
    if (result.outcome.kind === "refused" || result.outcome.kind === "skipped") {
      expect(result.outcome.reason).not.toMatch(/ENOTDIR/);
    }
  });

  it("recreates an in-repo symlink as a symlink rather than dereferencing it", async () => {
    const { result, fs } = await apply(entry("cfg"), {
      "/repo/cfg": { kind: "dir" },
      "/repo/cfg/target.json": { kind: "file" },
      "/repo/cfg/link.json": { kind: "link", target: "target.json" },
      "/wt/feature/cfg": { kind: "dir" },
      "/wt/feature/cfg/target.json": { kind: "file" },
    });
    expect(result.outcome.kind).toBe("copied");
    expect(fs.nodes.get("/wt/feature/cfg/link.json")).toEqual({ kind: "link", target: "target.json" });
  });

  it("refuses a relative link that is inside at its source and outside once relocated", async () => {
    // The plan attack's construction. `../../../inside.txt` resolves to
    // /repo/deep/inside.txt from the source, and to /inside.txt from the
    // destination — validating only at the source admits the escape.
    const { result, fs } = await apply(entry("alias/tree"), {
      "/repo/deep": { kind: "dir" },
      "/repo/deep/a": { kind: "dir" },
      "/repo/deep/a/b": { kind: "dir" },
      "/repo/deep/a/b/tree": { kind: "dir" },
      "/repo/deep/a/b/tree/link": { kind: "link", target: "../../../inside.txt" },
      "/repo/deep/inside.txt": { kind: "file" },
      "/repo/alias": { kind: "link", target: "deep/a/b" },
      "/wt/feature/alias": { kind: "dir" },
    });
    expect(fs.nodes.has("/wt/feature/alias/tree/link")).toBe(false);
    expect(result.details?.some((d) => /outside/i.test(d.reason))).toBe(true);
  });

  it("still recreates a relative link that is inside from BOTH sides", async () => {
    // The companion to the case above, and the reason the check is two-sided
    // rather than destination-only: this link is legitimate and must survive.
    const { result, fs } = await apply(entry("alias/tree"), {
      "/repo/deep": { kind: "dir" },
      "/repo/deep/a": { kind: "dir" },
      "/repo/deep/a/b": { kind: "dir" },
      "/repo/deep/a/b/tree": { kind: "dir" },
      "/repo/deep/a/b/tree/sibling.txt": { kind: "file" },
      "/repo/deep/a/b/tree/link": { kind: "link", target: "sibling.txt" },
      "/repo/alias": { kind: "link", target: "deep/a/b" },
      "/wt/feature/alias": { kind: "dir" },
    });
    expect(result.outcome.kind).toBe("copied");
    expect(fs.nodes.get("/wt/feature/alias/tree/link")).toEqual({ kind: "link", target: "sibling.txt" });
  });

  it("terminates on a symlink loop instead of expanding it", async () => {
    const { result, fs } = await apply(entry("loop"), {
      "/repo/loop": { kind: "dir" },
      "/repo/loop/self": { kind: "link", target: "." },
    });
    // The claim is termination, not any particular outcome: a walk that
    // traversed the link would not have returned at all.
    expect(result.outcome.kind).toBeDefined();
    expect(fs.created.length).toBeLessThan(10);
  });

  it("refuses a special file", async () => {
    const { result, fs } = await apply(entry("sock"), { "/repo/sock": { kind: "special" } });
    expect(result.outcome.kind).toBe("refused");
    expect(fs.created).toEqual([]);
  });
});

describe("the walk is bounded", () => {
  const wide = (): Record<string, FakeNode> => {
    const tree: Record<string, FakeNode> = { "/repo/big": { kind: "dir" } };
    for (let i = 0; i < 50; i += 1) {
      tree[`/repo/big/f${i}`] = { kind: "file", size: 1000 };
    }
    return tree;
  };

  it("stops an entry that exceeds the node budget, naming the budget", async () => {
    const { result } = await apply(entry("big"), wide(), { maxNodes: 5 });
    expect(result.outcome.kind).toBe("failed");
    if (result.outcome.kind === "failed") {
      expect(result.outcome.reason).toMatch(/too many|node/i);
    }
  });

  it("stops an entry that exceeds the byte budget, naming the budget", async () => {
    const { result } = await apply(entry("big"), wide(), { maxBytes: 2000 });
    expect(result.outcome.kind).toBe("failed");
    if (result.outcome.kind === "failed") {
      expect(result.outcome.reason).toMatch(/large|byte/i);
    }
  });

  it("[F002] writes NOTHING for a deadline already spent, without being awaited first", async () => {
    // The `await past.elapsed` this test used to open with is exactly what hid
    // the defect: it drained the microtask that set the old boolean flag, so
    // the walk saw an expired deadline for reasons the production caller never
    // arranges. Reading the deadline synchronously is the fix, and removing
    // that await is what makes this assertion able to fail.
    const past = afterDelay(0);
    const { result, fs } = await apply(entry("big"), wide(), { deadline: past });
    expect(result.outcome.kind).toBe("failed");
    if (result.outcome.kind === "failed") {
      expect(result.outcome.reason).toMatch(/too long|deadline|time/i);
    }
    expect(fs.created).toEqual([]);
  });

  it("[F002] refuses ONE file bigger than the whole byte budget", async () => {
    // The cap used to be tested only after it had been spent, so a single node
    // of any size passed: `bytes` was still 0 when the copy was authorized.
    const huge: Record<string, FakeNode> = { "/repo/huge": { kind: "file", size: 5000 } };
    const { result, fs } = await apply(entry("huge"), huge, { maxBytes: 2000 });
    expect(result.outcome.kind).toBe("failed");
    expect(fs.created).toEqual([]);
  });

  it("[F002] refuses a listing larger than the node budget before walking it", async () => {
    // `readdir` materializes the whole listing in one operation. Charging one
    // child at a time bounds the walk and not the read that produced it.
    const { result, fs } = await apply(entry("big"), wide(), { maxNodes: 10 });
    expect(result.outcome.kind).toBe("failed");
    // The entry's own directory is made before the listing is read, so the
    // assertion is that no CHILD was written — stopped at `readdir`, not after
    // walking ten of fifty children.
    expect(fs.created).toEqual(["/wt/feature/big"]);
  });

  it("[F008] caps the details it reports, and says how many it left out", async () => {
    // `details` rides one postMessage and is documented display-ready; its only
    // bound used to be maxNodes, which is thousands of rows.
    const many: Record<string, FakeNode> = { "/repo/big": { kind: "dir" }, "/wt/feature/big": { kind: "dir" } };
    for (let i = 0; i < 150; i += 1) {
      many[`/repo/big/f${i}`] = { kind: "file", size: 1 };
      // Already there, so every child reports a `skipped` detail row.
      many[`/wt/feature/big/f${i}`] = { kind: "file", size: 1 };
    }
    const { result } = await apply(entry("big"), many);

    expect(result.details?.length).toBeLessThanOrEqual(101);
    expect(result.details?.at(-1)?.reason).toMatch(/more not listed/i);
  });

  it("leaves what it had already written when it stops partway", async () => {
    const { result, fs } = await apply(entry("big"), wide(), { maxNodes: 5 });
    expect(result.outcome.kind).toBe("failed");
    // D9: a partial copy is reported, never unwound.
    expect(fs.created.length).toBeGreaterThan(0);
  });
});

describe("a link points at the main checkout, or says the platform would not let it", () => {
  const linkable: Record<string, FakeNode> = {
    "/repo/.env": { kind: "file", size: 12 },
    "/wt/feature/sub": { kind: "dir" },
  };

  it("creates a RELATIVE symlink back to the main checkout", async () => {
    const { result, fs } = await apply(entry(".env", "link"), linkable);
    expect(result.outcome.kind).toBe("linked");
    const node = fs.nodes.get("/wt/feature/.env");
    expect(node).toMatchObject({ kind: "link" });
    if (node?.kind !== "link") {
      return;
    }
    // Relative so the pair survives being moved together — an absolute target
    // would name this machine's layout.
    expect(path.posix.isAbsolute(node.target)).toBe(false);
    expect(path.posix.resolve("/wt/feature", node.target)).toBe("/repo/.env");
  });

  it("does not walk a link entry's source tree", async () => {
    // A link is ONE node. Copying the tree underneath it would give the worktree
    // its own copy, which is the opposite of what link means.
    const { result, fs } = await apply(entry("cfg", "link"), {
      "/repo/cfg": { kind: "dir" },
      "/repo/cfg/a.json": { kind: "file" },
      "/repo/cfg/b.json": { kind: "file" },
    });
    expect(result.outcome.kind).toBe("linked");
    expect(fs.nodes.get("/wt/feature/cfg")).toMatchObject({ kind: "link" });
    expect(fs.nodes.has("/wt/feature/cfg/a.json")).toBe(false);
  });

  it("degrades to a copy, and says so, where the platform has no symlink to give", async () => {
    const fs = fakeFs({ ...base, ...linkable });
    const refuse = (code: string) => async () => {
      const error = new Error(`${code}: symlink`) as NodeJS.ErrnoException;
      error.code = code;
      throw error;
    };
    for (const code of ["EPERM", "ENOSYS", "UNKNOWN"]) {
      const one = fakeFs({ ...base, ...linkable });
      one.symlink = refuse(code);
      const roots = await prepareEntryGate(MAIN, WT, one);
      if (roots === null) {
        throw new Error("roots did not prepare");
      }
      const result = await applyEntry(entry(".env", "link"), roots, budget(), one);
      expect(result.outcome.kind).toBe("degradedToCopy");
      // Degraded means the user still got the material — not a link reported as
      // made, and not a failure.
      expect(one.nodes.get("/wt/feature/.env")).toMatchObject({ kind: "file", size: 12 });
    }
    void fs;
  });

  it("fails rather than silently degrading on a symlink error the platform did not excuse", async () => {
    const fs = fakeFs({ ...base, ...linkable });
    fs.symlink = async () => {
      const error = new Error("EIO: symlink") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    };
    const roots = await prepareEntryGate(MAIN, WT, fs);
    if (roots === null) {
      throw new Error("roots did not prepare");
    }
    const result = await applyEntry(entry(".env", "link"), roots, budget(), fs);
    expect(result.outcome.kind).toBe("failed");
    expect(fs.nodes.has("/wt/feature/.env")).toBe(false);
  });

  it("skips a link whose destination already exists rather than replacing it", async () => {
    const { result, fs } = await apply(entry(".env", "link"), {
      ...linkable,
      "/wt/feature/.env": { kind: "file", size: 99 },
    });
    expect(result.outcome.kind).toBe("skipped");
    expect(fs.nodes.get("/wt/feature/.env")).toMatchObject({ kind: "file", size: 99 });
  });
});
