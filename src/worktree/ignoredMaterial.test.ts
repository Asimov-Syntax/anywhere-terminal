import { describe, expect, it } from "vitest";
import {
  type DiskIgnoredOptions,
  diskIgnoredDeps,
  type IgnoredMaterialDeps,
  MAX_IGNORED_ENTRIES,
  MAX_IGNORED_MS,
  measureIgnoredMaterial,
} from "./ignoredMaterial";

/**
 * A fake worktree's ignored content. `sizes` maps a worktree-relative path to
 * its bytes; anything absent is a stat that fails.
 */
function fs(spec: {
  entries: readonly string[];
  sizes?: Record<string, number>;
  clock?: () => number;
}): IgnoredMaterialDeps {
  const sizes = spec.sizes ?? Object.fromEntries(spec.entries.map((e) => [e, 1]));
  return {
    ignoredEntries: async function* () {
      for (const entry of spec.entries) {
        yield entry;
      }
    },
    size: async (relPath) => {
      const held = sizes[relPath];
      if (held === undefined) {
        throw Object.assign(new Error(`EACCES ${relPath}`), { code: "EACCES" });
      }
      return held;
    },
    now: spec.clock ?? (() => 0),
    // No manifest by default: nothing writes one yet — the apply path that
    // would is unbuilt Phase 12 work — so the undifferentiated fallback is the
    // branch that actually runs today, and it is the one these cases exercise.
    readManifest: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  };
}

/** A dep set built by hand, with the default no-manifest read filled in. */
function noManifest(): Pick<IgnoredMaterialDeps, "readManifest"> {
  return {
    readManifest: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  };
}

describe("measureIgnoredMaterial", () => {
  it("counts the entries and totals their bytes", async () => {
    const deps = fs({
      entries: ["node_modules/", ".env.worktree", "dist/app.js"],
      sizes: { "node_modules/": 4096, ".env.worktree": 120, "dist/app.js": 880 },
    });

    const result = await measureIgnoredMaterial(deps);

    expect(result).toEqual({ kind: "measured", entries: 3, bytes: 5096 });
  });

  it("reports nothing found as a measurement, not as an absence", async () => {
    // A worktree with no ignored content is a measured zero. Reporting it as
    // unproven would say the walk failed when it succeeded and found none.
    const result = await measureIgnoredMaterial(fs({ entries: [] }));

    expect(result).toEqual({ kind: "measured", entries: 0, bytes: 0 });
  });

  it("stops at the entry budget rather than reporting a partial count", async () => {
    // The count renders inside its own element as a reading that was taken
    // (worktree-rpc.md § 2.5), so a partial total is worse than no total.
    const many = Array.from({ length: MAX_IGNORED_ENTRIES + 50 }, (_, i) => `f${i}`);

    const result = await measureIgnoredMaterial(fs({ entries: many }));

    expect(result).toEqual({ kind: "unproven", reason: "budget" });
  });

  it("never stats more entries than the budget allows", async () => {
    // The bound has to cover the sizing pass too. An enumeration that never
    // ends is the case a cap on the LIST alone would not survive.
    let statted = 0;
    let yielded = 0;
    const deps: IgnoredMaterialDeps = {
      ignoredEntries: async function* () {
        for (;;) {
          yielded += 1;
          yield `f${yielded}`;
        }
      },
      size: async () => {
        statted += 1;
        return 1;
      },
      now: () => 0,
      ...noManifest(),
    };

    const result = await measureIgnoredMaterial(deps);

    expect(result).toEqual({ kind: "unproven", reason: "budget" });
    expect(statted).toBeLessThanOrEqual(MAX_IGNORED_ENTRIES);
    expect(yielded).toBeLessThanOrEqual(MAX_IGNORED_ENTRIES + 1);
  });

  it("stops at the time budget on a slow disk", async () => {
    // § 2.3: a slow disk must not make a worktree unremovable. It must also not
    // make the assessment take as long as the disk does.
    let tick = 0;
    const deps = fs({
      entries: Array.from({ length: 50 }, (_, i) => `f${i}`),
      clock: () => {
        tick += MAX_IGNORED_MS;
        return tick;
      },
    });

    const result = await measureIgnoredMaterial(deps);

    expect(result).toEqual({ kind: "unproven", reason: "budget" });
  });

  it("reports an entry it could not size as unreadable, not as zero bytes", async () => {
    // A file that cannot be stat'd contributes an unknown number of bytes.
    // Treating it as 0 states a total the walk did not establish.
    const deps = fs({ entries: ["ok.txt", "denied.txt"], sizes: { "ok.txt": 10 } });

    const result = await measureIgnoredMaterial(deps);

    expect(result).toEqual({ kind: "unproven", reason: "unreadable" });
  });

  it("reports an enumeration that throws as unreadable", async () => {
    const deps: IgnoredMaterialDeps = {
      ignoredEntries: async function* () {
        yield "one";
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      },
      size: async () => 1,
      now: () => 0,
      ...noManifest(),
    };

    const result = await measureIgnoredMaterial(deps);

    expect(result).toEqual({ kind: "unproven", reason: "unreadable" });
  });

  it("never reports a count on an unproven result", async () => {
    // Every terminating condition produces the same shape. A caller that could
    // read a number off an unproven result would render one nobody measured.
    const budget = await measureIgnoredMaterial(
      fs({ entries: Array.from({ length: MAX_IGNORED_ENTRIES + 1 }, (_, i) => `f${i}`) }),
    );
    const unreadable = await measureIgnoredMaterial(fs({ entries: ["x"], sizes: {} }));

    for (const result of [budget, unreadable]) {
      expect(result.kind).toBe("unproven");
      expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
    }
  });
});

describe("naming what this extension provisioned", () => {
  /** A walk of two entries, with whatever manifest text the case supplies. */
  function withManifest(text: string | undefined): IgnoredMaterialDeps {
    return {
      ...fs({ entries: ["node_modules/", ".env.worktree"], sizes: { "node_modules/": 40, ".env.worktree": 2 } }),
      readManifest: async () => {
        if (text === undefined) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return text;
      },
    };
  }

  const REAL = JSON.stringify({
    version: 1,
    createdAt: "2026-08-31T00:00:00.000Z",
    materialized: [
      { path: ".env.worktree", mode: "copy" },
      { path: "third_party", mode: "link" },
    ],
    ports: [],
    setup: [],
  });

  it("names the provisioned entries when the manifest parses whole", async () => {
    const result = await measureIgnoredMaterial(withManifest(REAL));

    expect(result).toEqual({ kind: "measured", entries: 2, bytes: 42, provisioned: { entries: 2 } });
  });

  it("omits the claim when there is no manifest", async () => {
    // Absence is how "we did not differentiate" is said. A zero would claim we
    // looked and found none of it was ours.
    const result = await measureIgnoredMaterial(withManifest(undefined));

    expect(result).toEqual({ kind: "measured", entries: 2, bytes: 42 });
  });

  it("omits the claim for a manifest that does not parse", async () => {
    const result = await measureIgnoredMaterial(withManifest("{ not json"));

    expect(result).toEqual({ kind: "measured", entries: 2, bytes: 42 });
  });

  it("omits the claim for a version it does not recognise", async () => {
    // A later writer may mean something else by `materialized`. Reading it
    // anyway is how a count becomes a sentence about files nobody provisioned.
    const future = JSON.stringify({ version: 2, materialized: [{ path: "x", mode: "copy" }] });

    const result = await measureIgnoredMaterial(withManifest(future));

    expect(result).toEqual({ kind: "measured", entries: 2, bytes: 42 });
  });

  it("omits the claim when materialized is not a list", async () => {
    const wrong = JSON.stringify({ version: 1, materialized: { path: "x" } });

    const result = await measureIgnoredMaterial(withManifest(wrong));

    expect(result).toEqual({ kind: "measured", entries: 2, bytes: 42 });
  });

  it("never claims provenance on an unproven walk", async () => {
    // The manifest says what we provisioned, not how much is there. Attaching
    // it to a walk that did not finish would decorate a measurement nobody took.
    const deps: IgnoredMaterialDeps = {
      ...fs({ entries: Array.from({ length: MAX_IGNORED_ENTRIES + 1 }, (_, i) => `f${i}`) }),
      readManifest: async () => REAL,
    };

    const result = await measureIgnoredMaterial(deps);

    expect(result).toEqual({ kind: "unproven", reason: "budget" });
  });
});

describe("diskIgnoredDeps", () => {
  /** A git that answers each command from `replies`, keyed by its first arg. */
  function disk(over: Partial<DiskIgnoredOptions> & { replies?: Record<string, string> } = {}) {
    const calls: string[][] = [];
    const replies = over.replies ?? {};
    const deps = diskIgnoredDeps({
      worktreePath: "/repo/wt-a",
      run: async (args, cwd) => {
        calls.push([...args, `cwd=${cwd}`]);
        return { code: 0, timedOut: false, stdout: Buffer.from(replies[args[0] ?? ""] ?? "", "utf8") };
      },
      stat: async () => ({ size: 7 }),
      readFile: async () => "{}",
      join: (...parts) => parts.join("/"),
      ...over,
    });
    return { deps, calls };
  }

  async function collect(deps: IgnoredMaterialDeps): Promise<string[]> {
    const out: string[] = [];
    for await (const entry of deps.ignoredEntries()) {
      out.push(entry);
    }
    return out;
  }

  it("yields the ignored entries and nothing else git reported", async () => {
    const { deps, calls } = disk({
      replies: { status: " M src/a.ts\n?? scratch.md\n!! node_modules/react/index.js\n!! dist/app.js\n" },
    });

    expect(await collect(deps)).toEqual(["node_modules/react/index.js", "dist/app.js"]);
    // `matching`, not the default `traditional`: traditional collapses an
    // ignored directory to one entry, and stat-ing that entry sizes the
    // directory inode — a few hundred bytes standing in for a gigabyte.
    expect(calls[0]).toEqual(["status", "--porcelain", "--ignored=matching", "cwd=/repo/wt-a"]);
  });

  it("unquotes a path git had to quote", async () => {
    const { deps } = disk({ replies: { status: '!! "dist/a b.js"\n' } });

    expect(await collect(deps)).toEqual(["dist/a b.js"]);
  });

  it("throws rather than reporting an empty listing when git failed", async () => {
    // The difference the whole module exists for: an empty listing says there
    // is nothing to delete, and a failed command says we do not know.
    const { deps } = disk({ run: async () => ({ code: 128, timedOut: false, stdout: Buffer.alloc(0) }) });

    await expect(collect(deps)).rejects.toThrow();
  });

  it("treats a timeout as a failure even when git exited 0", async () => {
    const { deps } = disk({ run: async () => ({ code: 0, timedOut: true, stdout: Buffer.alloc(0) }) });

    await expect(collect(deps)).rejects.toThrow();
  });

  it("reads the manifest from the worktree's own git dir", async () => {
    let read = "";
    const { deps } = disk({
      replies: { "rev-parse": "/repo/.git/worktrees/wt-a\n" },
      readFile: async (absPath) => {
        read = absPath;
        return "{}";
      },
    });

    await deps.readManifest();

    // git deletes this directory along with the worktree, which is why the
    // manifest lives there and not in the working tree it describes.
    expect(read).toBe("/repo/.git/worktrees/wt-a/anywhere-terminal-provision.json");
  });

  it("sizes an entry against the worktree it is relative to", async () => {
    let statted = "";
    const { deps } = disk({
      stat: async (absPath) => {
        statted = absPath;
        return { size: 42 };
      },
    });

    expect(await deps.size("dist/app.js")).toBe(42);
    expect(statted).toBe("/repo/wt-a/dist/app.js");
  });
});
