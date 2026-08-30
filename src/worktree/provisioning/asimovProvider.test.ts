import { describe, expect, it } from "vitest";
import {
  ASIMOV_PROVIDER_FILE,
  type AsimovProviderDeps,
  MAX_MODEL_ROWS,
  MAX_SCAN,
  readAsimovProvisioning,
} from "./asimovProvider";

const ROOT = "/repo";

/**
 * A fake checkout. `files` maps absolute paths to text; `dirs` maps absolute
 * directories to the names inside them. Containment resolves lexically here —
 * `realpath` is the identity — so the suite is about the adapter's rules, and
 * `resolvedPathBoundary.test.ts` owns the symlink cases.
 */
function fs(spec: { files?: Record<string, string>; dirs?: Record<string, string[]> }): AsimovProviderDeps {
  const files = spec.files ?? {};
  const dirs = spec.dirs ?? {};
  return {
    readFile: async (p) => {
      const held = files[p];
      if (held === undefined) {
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      }
      return held;
    },
    readdir: async (p) => {
      const held = dirs[p];
      if (held === undefined) {
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      }
      return held;
    },
    realpath: async (p) => p,
    lstat: async () => ({}),
  };
}

function withYaml(yaml: string, dirs?: Record<string, string[]>): AsimovProviderDeps {
  return fs({ files: { [`${ROOT}/${ASIMOV_PROVIDER_FILE}`]: yaml }, dirs: { [ROOT]: ["asimov"], ...dirs } });
}

/** This repository's own file, abridged to its declarations. */
const REAL = `
copy:
  - .opencode/package.json
  - .opencode/node_modules
  - .opencode/command/*.md
  - .claude/settings.local.json
  - .code-review-graph

link:
  - third_party

setup:
  - pnpm install --frozen-lockfile
  - node esbuild.js
`;

describe("readAsimovProvisioning", () => {
  it("reads this repository's own file", async () => {
    // The acceptance case: four literal copy paths plus a glob that matches one
    // file here, one link, two shell steps — every one of them attributed.
    const deps = withYaml(REAL, { [`${ROOT}/.opencode/command`]: ["asimov-debug.md", "notes.txt"] });
    const model = await readAsimovProvisioning(deps, ROOT);

    expect(model.entries.filter((e) => e.mode === "copy").map((e) => e.path)).toEqual([
      ".opencode/package.json",
      ".opencode/node_modules",
      ".opencode/command/asimov-debug.md",
      ".claude/settings.local.json",
      ".code-review-graph",
    ]);
    expect(model.entries.filter((e) => e.mode === "link").map((e) => e.path)).toEqual(["third_party"]);
    expect(model.setup.map((s) => s.script)).toEqual(["pnpm install --frozen-lockfile", "node esbuild.js"]);
    expect(model.setup.every((s) => s.kind === "shell")).toBe(true);
    expect(model.problems).toEqual([]);
    expect(model.providers).toEqual([{ id: "asimov", file: ASIMOV_PROVIDER_FILE, active: true }]);
  });

  it("attributes every row, expanded ones included", async () => {
    // § 4.3: an expanded entry carries the GLOB's source, not the matched file's.
    const deps = withYaml(REAL, { [`${ROOT}/.opencode/command`]: ["a.md", "b.md"] });
    const model = await readAsimovProvisioning(deps, ROOT);

    const sources = [...model.entries, ...model.setup].map((r) => r.source);
    expect(new Set(sources)).toEqual(new Set([ASIMOV_PROVIDER_FILE]));
  });

  it("gives every selectable row an id unique within the offer", async () => {
    const deps = withYaml(REAL, { [`${ROOT}/.opencode/command`]: ["a.md"] });
    const model = await readAsimovProvisioning(deps, ROOT);

    const all = [...model.entries, ...model.ports, ...model.setup].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    // Not a path, and not derived from one — a superseded id must resolve to
    // nothing rather than name whatever now occupies that slot.
    expect(all.every((id) => !id.includes("/"))).toBe(true);
  });

  it("expands a glob to what is actually there, sorted", async () => {
    const deps = withYaml("copy:\n  - docs/*.md\n", { [`${ROOT}/docs`]: ["b.md", "a.md", "c.txt", "notes.markdown"] });
    const model = await readAsimovProvisioning(deps, ROOT);

    expect(model.entries.map((e) => e.path)).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("expands a glob whose directory is the repository root", async () => {
    // `isResolvedPathInsideRoot` refuses a candidate equal to its root by
    // design, so a naive containment check here would call the repo root itself
    // an escape.
    const deps = withYaml("copy:\n  - '*.md'\n", { [ROOT]: ["README.md", "asimov", "notes.txt"] });
    const model = await readAsimovProvisioning(deps, ROOT);

    expect(model.entries.map((e) => e.path)).toEqual(["README.md"]);
    expect(model.problems).toEqual([]);
  });

  it("treats an unmatched glob as nothing, not as a problem", async () => {
    // A repo legitimately carries optional material (§ 3.1).
    const deps = withYaml("copy:\n  - docs/*.md\n", { [`${ROOT}/docs`]: ["only.txt"] });
    const model = await readAsimovProvisioning(deps, ROOT);

    expect(model.entries).toEqual([]);
    expect(model.problems).toEqual([]);
  });

  it("treats a missing glob directory the same way", async () => {
    const model = await readAsimovProvisioning(withYaml("copy:\n  - nothing/*.md\n"), ROOT);

    expect(model.entries).toEqual([]);
    expect(model.problems).toEqual([]);
  });

  it("refuses a pattern it does not implement rather than guessing", async () => {
    // A generous reading produces a list of files different from the one the
    // user was shown, which is the failure the whole section exists to prevent.
    const two = await readAsimovProvisioning(withYaml("copy:\n  - a/*/b*.md\n"), ROOT);
    const early = await readAsimovProvisioning(withYaml("copy:\n  - a/*/b.md\n"), ROOT);

    expect(two.entries).toEqual([]);
    expect(two.problems[0]?.reason).toBe("malformed");
    expect(early.entries).toEqual([]);
    expect(early.problems[0]?.reason).toBe("malformed");
  });

  it("refuses an entry that escapes the repository, and does not clamp it", async () => {
    const model = await readAsimovProvisioning(withYaml("copy:\n  - ../secrets\n  - /etc/passwd\n"), ROOT);

    expect(model.entries).toEqual([]);
    expect(model.problems).toHaveLength(2);
    expect(model.problems.every((p) => p.reason === "malformed")).toBe(true);
    // Reported, never rewritten into something that would have passed.
    expect(model.problems.map((p) => p.detail).join(" ")).toContain("../secrets");
  });

  it("reads no directory outside the repository while rejecting a glob", async () => {
    const read: string[] = [];
    const deps = withYaml("copy:\n  - ../elsewhere/*.md\n");
    const model = await readAsimovProvisioning(
      {
        ...deps,
        readdir: async (p) => {
          read.push(p);
          return [];
        },
      },
      ROOT,
    );

    expect(read).toEqual([]);
    expect(model.problems[0]?.reason).toBe("malformed");
  });

  it("names a port without inventing a number for it", async () => {
    // Allocation is WT-012.6's. A placeholder here would read as an allocation
    // nobody made.
    const model = await readAsimovProvisioning(withYaml("ports:\n  APP: 5183\n  DB: 5433\n"), ROOT);

    expect(model.ports.map((p) => p.name)).toEqual(["APP", "DB"]);
    expect(model.ports.every((p) => p.port === undefined)).toBe(true);
    expect(model.ports.every((p) => p.source === ASIMOV_PROVIDER_FILE)).toBe(true);
  });

  it("keeps a setup command exactly as written", async () => {
    const model = await readAsimovProvisioning(withYaml('setup:\n  - "echo $HOME && ls -la"\n'), ROOT);

    expect(model.setup.map((s) => s.script)).toEqual(["echo $HOME && ls -la"]);
  });

  describe("a file it cannot use", () => {
    it("returns an empty model when there is no provider file at all", async () => {
      const model = await readAsimovProvisioning(fs({}), ROOT);

      expect(model.entries).toEqual([]);
      expect(model.problems).toEqual([]);
      // Absent is not a problem — it is the ordinary case for most repositories.
      expect(model.providers).toEqual([]);
    });

    it("reports malformed YAML and still returns a model", async () => {
      const model = await readAsimovProvisioning(withYaml("copy:\n  - a\n   - b: [\n"), ROOT);

      expect(model.problems[0]?.reason).toBe("malformed");
      expect(model.problems[0]?.file).toBe(ASIMOV_PROVIDER_FILE);
      expect(model.providers).toHaveLength(1);
    });

    it("bounds a parser message, because it can quote the file back", async () => {
      const model = await readAsimovProvisioning(withYaml(`copy: [${"x".repeat(4000)}\n`), ROOT);

      expect(model.problems).toHaveLength(1);
      expect(model.problems[0]?.detail.length).toBeLessThanOrEqual(300);
      // One line: a message spanning many is a rendering hazard of its own.
      expect(model.problems[0]?.detail).not.toContain("\n");
    });

    it("names a key it does not read rather than ignoring it", async () => {
      const model = await readAsimovProvisioning(withYaml("copy:\n  - a.txt\nexclude:\n  - b.txt\n"), ROOT);

      expect(model.problems.map((p) => p.reason)).toEqual(["unknownKey"]);
      // The keys it does read still apply.
      expect(model.entries.map((e) => e.path)).toEqual(["a.txt"]);
    });

    it("reports a key whose value is the wrong shape", async () => {
      const model = await readAsimovProvisioning(withYaml("copy: a.txt\nsetup: true\nports:\n  - APP\n"), ROOT);

      expect(model.problems.map((p) => p.reason)).toEqual(["malformed", "malformed", "malformed"]);
      expect(model.entries).toEqual([]);
      expect(model.setup).toEqual([]);
      expect(model.ports).toEqual([]);
    });

    it("returns an empty model for an empty file", async () => {
      const model = await readAsimovProvisioning(withYaml("# only a comment\n"), ROOT);

      expect(model.problems).toEqual([]);
      expect(model.entries).toEqual([]);
      expect(model.providers).toHaveLength(1);
    });
  });
});

describe("what it refuses to trust (round-1 B2, B7, B8, W1)", () => {
  /** An errno-carrying rejection, the way `node:fs` reports one. */
  function fail(code: string): Promise<never> {
    return Promise.reject(Object.assign(new Error(code), { code }));
  }

  it("[B8] names a provider file it was denied, rather than reporting nothing", async () => {
    // Present-but-unreadable must be NAMED — the spec scenario requires it, and
    // silently reporting an empty model makes the section say "Nothing
    // configured", which is an affirmative false claim.
    const model = await readAsimovProvisioning({ ...fs({}), readFile: () => fail("EACCES") }, ROOT);

    expect(model.problems).toHaveLength(1);
    expect(model.problems[0]?.reason).toBe("unreadable");
    expect(model.problems[0]?.file).toBe(ASIMOV_PROVIDER_FILE);
  });

  it("[B8] still treats a genuinely absent file as absence", async () => {
    const model = await readAsimovProvisioning({ ...fs({}), readFile: () => fail("ENOENT") }, ROOT);

    expect(model.problems).toEqual([]);
    expect(model.providers).toEqual([]);
  });

  it("[B8] reports a glob directory it could not read, unlike one that is absent", async () => {
    const denied = await readAsimovProvisioning(
      { ...withYaml("copy:\n  - docs/*.md\n"), readdir: () => fail("EACCES") },
      ROOT,
    );
    const absent = await readAsimovProvisioning(
      { ...withYaml("copy:\n  - docs/*.md\n"), readdir: () => fail("ENOENT") },
      ROOT,
    );

    expect(denied.problems.map((p) => p.reason)).toEqual(["unreadable"]);
    expect(absent.problems).toEqual([]);
  });

  it("[B2] refuses a provider file that is itself a symlink out of the checkout", async () => {
    // The relative name is a constant, so the only way out is the file being a
    // link — which is exactly what a hostile checkout controls.
    const deps = withYaml(REAL);
    const model = await readAsimovProvisioning(
      { ...deps, realpath: async (p) => (p.endsWith(ASIMOV_PROVIDER_FILE) ? "/elsewhere/worktree.yaml" : p) },
      ROOT,
    );

    expect(model.entries).toEqual([]);
    expect(model.problems.map((p) => p.reason)).toEqual(["malformed"]);
  });

  it("[B2] refuses a glob match that resolves outside the repository", async () => {
    // A contained PARENT says nothing about a child symlink, and an expanded
    // entry is what a later task materializes.
    const deps = withYaml("copy:\n  - docs/*.md\n", { [`${ROOT}/docs`]: ["safe.md", "escape.md"] });
    const model = await readAsimovProvisioning(
      { ...deps, realpath: async (p) => (p.endsWith("escape.md") ? "/elsewhere/escape.md" : p) },
      ROOT,
    );

    expect(model.entries.map((e) => e.path)).toEqual(["docs/safe.md"]);
    expect(model.problems.map((p) => p.reason)).toEqual(["malformed"]);
  });

  it("[B7] bounds what one glob may expand to, and says so", async () => {
    // A repository-controlled directory must not be able to push unbounded rows
    // through postMessage and into the DOM.
    const many = Array.from({ length: MAX_MODEL_ROWS + 50 }, (_, i) => `f${String(i).padStart(4, "0")}.md`);
    const model = await readAsimovProvisioning(withYaml("copy:\n  - docs/*.md\n", { [`${ROOT}/docs`]: many }), ROOT);

    expect(model.entries.length).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    expect(model.problems.some((p) => p.reason === "malformed")).toBe(true);
    // Reported, not silently truncated.
    expect(model.problems.map((p) => p.detail).join(" ")).toMatch(/\d/);
  });

  it("[W1] never parses a provider file past the byte budget", async () => {
    // Bounded at the READ. The dep signals oversize the way the production
    // reader does, and it becomes an unreadable problem rather than a parse.
    const model = await readAsimovProvisioning({ ...fs({}), readFile: () => fail("EFBIG") }, ROOT);

    expect(model.problems.map((p) => p.reason)).toEqual(["unreadable"]);
    expect(model.entries).toEqual([]);
  });
});

describe("what it refuses to spend (round-2 B7, W6)", () => {
  it("[B7] stops scanning a directory that matches nothing, rather than reading all of it", async () => {
    // The cost is the ENUMERATION, not the matches. A directory of names that
    // all fail the pattern was still materialized, copied and sorted in full.
    let seen = 0;
    const huge = {
      readdir: async function* () {
        for (;;) {
          seen += 1;
          yield `no-match-${seen}.txt`;
        }
      },
    };
    const deps: AsimovProviderDeps = {
      ...withYaml("copy:\n  - docs/*.md\n"),
      readdir: huge.readdir as unknown as AsimovProviderDeps["readdir"],
    };
    const model = await readAsimovProvisioning(deps, ROOT);

    expect(seen).toBeLessThanOrEqual(MAX_SCAN + 1);
    expect(model.entries).toEqual([]);
    expect(model.problems.some((p) => p.reason === "malformed")).toBe(true);
  });

  it("[B7] counts ports and setup steps against the same budget as entries", async () => {
    // The cap read `entries` alone, so three of the four collections it claimed
    // to bound went straight past it.
    const ports = Array.from({ length: MAX_MODEL_ROWS + 20 }, (_, i) => `  P${i}: 1`).join("\n");
    const model = await readAsimovProvisioning(withYaml(`ports:\n${ports}\n`), ROOT);

    expect(model.ports.length).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    expect(model.problems.some((p) => p.reason === "malformed")).toBe(true);
  });

  it("[B7] bounds the problems an all-escaping directory can emit", async () => {
    // Every match refused is still a row posted and rendered.
    const many = Array.from({ length: MAX_MODEL_ROWS + 50 }, (_, i) => `e${String(i).padStart(4, "0")}.md`);
    const deps = withYaml("copy:\n  - docs/*.md\n", { [`${ROOT}/docs`]: many });
    const model = await readAsimovProvisioning(
      { ...deps, realpath: async (p) => (p.includes("/docs/e") ? `/elsewhere/${p}` : p) },
      ROOT,
    );

    expect(model.problems.length).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    expect(model.entries).toEqual([]);
  });

  it("[W6] says unreadable, not outside, when containment could not be decided", async () => {
    // `isResolvedPathInsideRoot` answers false for a proven escape AND for a
    // resolution that failed. Reporting both as an escape states something the
    // code has not established.
    const deps = withYaml("copy:\n  - .env\n");
    const model = await readAsimovProvisioning(
      {
        ...deps,
        realpath: async (p) => {
          if (p.endsWith("/.env")) {
            throw Object.assign(new Error("EACCES"), { code: "EACCES" });
          }
          return p;
        },
      },
      ROOT,
    );

    expect(model.entries).toEqual([]);
    expect(model.problems.map((p) => p.reason)).toEqual(["unreadable"]);
  });

  it("[W6] still says malformed for a path proven to resolve outside", async () => {
    const model = await readAsimovProvisioning(withYaml("copy:\n  - ../secrets\n"), ROOT);

    expect(model.problems.map((p) => p.reason)).toEqual(["malformed"]);
  });
});

describe("what it refuses to spend on problems (round-3 B7)", () => {
  /** Every row the offer carries, whichever collection holds it. */
  function rows(model: Awaited<ReturnType<typeof readAsimovProvisioning>>): number {
    return model.entries.length + model.ports.length + model.setup.length + model.problems.length;
  }

  it("[B7] bounds a file made of nothing but keys it does not read", async () => {
    // The cap was applied to the three ROW collections and to refused matches.
    // The file that produces the most output produces none of those: an
    // unrecognized key emits a problem, and that loop consulted nothing.
    const keys = Array.from({ length: MAX_MODEL_ROWS + 80 }, (_, i) => `unknown${i}: 1`).join("\n");
    const model = await readAsimovProvisioning(withYaml(`${keys}\n`), ROOT);

    expect(rows(model)).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    expect(model.problems.filter((p) => p.detail.includes("not offered"))).toHaveLength(1);
  });

  it("[B7] bounds a copy list whose elements are not paths", async () => {
    // Reported and skipped one line BEFORE the budget check, so the whole list
    // was emitted however long it was.
    const junk = Array.from({ length: MAX_MODEL_ROWS + 40 }, () => "  - []").join("\n");
    const model = await readAsimovProvisioning(withYaml(`copy:\n${junk}\n`), ROOT);

    expect(rows(model)).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    expect(model.entries).toEqual([]);
  });

  it("[B7] records the cap once, and stops rather than filling the rest", async () => {
    // A capped draft costs nothing further: later sections are not walked, and
    // no second cap row is added by whichever one would have been next.
    const keys = Array.from({ length: MAX_MODEL_ROWS + 5 }, (_, i) => `unknown${i}: 1`).join("\n");
    const ports = Array.from({ length: 50 }, (_, i) => `  P${i}: 1`).join("\n");
    const model = await readAsimovProvisioning(
      withYaml(`${keys}\ncopy:\n  - .env\nports:\n${ports}\nsetup:\n  - pnpm install\n`),
      ROOT,
    );

    expect(rows(model)).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    expect(model.problems.filter((p) => p.detail.includes("not offered"))).toHaveLength(1);
    expect(model.ports).toEqual([]);
    expect(model.setup).toEqual([]);
  });

  it("[B7] still reports a malformed collection shape when there is room", async () => {
    // The budget bounds emission; it does not silence a file that is simply
    // wrong. One row is still one row.
    const model = await readAsimovProvisioning(withYaml("ports:\n  - APP\nsetup: 7\n"), ROOT);

    expect(model.problems.map((p) => p.reason)).toEqual(["malformed", "malformed"]);
    expect(model.problems.some((p) => p.detail.includes("not offered"))).toBe(false);
  });
});
