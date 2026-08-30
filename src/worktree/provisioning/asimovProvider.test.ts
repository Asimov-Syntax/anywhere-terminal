import { describe, expect, it } from "vitest";
import { ASIMOV_PROVIDER_FILE, type AsimovProviderDeps, readAsimovProvisioning } from "./asimovProvider";

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
