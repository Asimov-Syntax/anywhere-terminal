// src/worktree/provisioning/suggestProvisioning.test.ts — the bounded fallback
// detector: fixed repository-root names, metadata only, opt-in rows
// (suggest-worktree-initialization design.md D1, D2).

import { describe, expect, it } from "vitest";
import { MAX_SCAN, type ProviderBudget, newBudget } from "./providerKit";
import { SUGGESTED_ENV_FILES, SUGGESTED_MANAGERS, type SuggestDeps, suggestProvisioning } from "./suggestProvisioning";

const ROOT = "/repo";

type Kind = "file" | "symlink" | "directory" | "failing";

/**
 * A root that answers `lstat` and nothing else — `SuggestDeps` offers no other
 * capability, so a detector that wanted bytes or a listing could not compile.
 */
function root(
  entries: Record<string, Kind>,
  files: Record<string, string> = {},
): { deps: SuggestDeps; statted: string[]; read: string[]; listed: string[] } {
  const statted: string[] = [];
  const read: string[] = [];
  const listed: string[] = [];
  const rel = (p: string): string => (p.startsWith(`${ROOT}/`) ? p.slice(ROOT.length + 1) : p);
  const deps: SuggestDeps = {
    // Manifests only. Every test asserts against `read`, so a detector that
    // opened an environment file to decide anything would be caught by name.
    readFile: async (p) => {
      read.push(rel(p));
      const text = files[rel(p)];
      if (text === undefined) {
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      }
      return text;
    },
    readdir: async (p) => {
      listed.push(rel(p));
      const prefix = `${rel(p)}/`;
      const names = new Set<string>();
      for (const key of [...Object.keys(entries), ...Object.keys(files)]) {
        if (key.startsWith(prefix)) {
          const next = key.slice(prefix.length).split("/")[0];
          if (next) names.add(next);
        }
      }
      return [...names];
    },
    realpath: async (p) => p,
    lstat: async (p) => {
      statted.push(p);
      const name = p.startsWith(`${ROOT}/`) ? p.slice(ROOT.length + 1) : p;
      const kind = entries[name];
      if (kind === undefined) {
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      }
      if (kind === "failing") {
        throw Object.assign(new Error(`EACCES ${p}`), { code: "EACCES" });
      }
      // `lstat` does not follow links, so a symlink is what it says it is —
      // never the ordinary file the rule requires.
      return { isFile: () => kind === "file" };
    },
  };
  return { deps, statted, read, listed };
}

function seq(): ProviderBudget {
  let n = 0;
  return { ...newBudget(), nextId: () => `s${(n += 1)}` };
}

describe("suggestProvisioning", () => {
  it("suggests an ordinary environment file as a copy, sourced to itself and explained", async () => {
    const { deps } = root({ ".env.local": "file" });

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries).toHaveLength(1);
    const entry = model.entries[0];
    expect(entry).toMatchObject({ path: ".env.local", mode: "copy", source: ".env.local" });
    // The explanation is what makes the row opt-in, says why it appeared, and
    // warns about what the file may hold. Static host text — no file content.
    expect(entry?.suggestion).toContain(".env.local");
    expect(entry?.suggestion).toMatch(/secret/i);
    expect(entry?.suggestion).toMatch(/independent/i);
  });

  it("suggests one static install command per detected manager, without precedence", async () => {
    const { deps } = root({ "pnpm-lock.yaml": "file", "yarn.lock": "file" });

    const model = await suggestProvisioning(deps, ROOT, seq());

    // Two managers, two rows — the extension does not pick one on the user's
    // behalf (design.md D1).
    expect(model.setup.map((s) => [s.script, s.source])).toEqual([
      ["pnpm install", "pnpm-lock.yaml"],
      ["yarn install", "yarn.lock"],
    ]);
    for (const step of model.setup) {
      expect(step.kind).toBe("shell");
      expect(step.suggestion).toContain(step.source);
      expect(step.suggestion).toMatch(/after file/i);
    }
  });

  it("treats bun.lock and bun.lockb as one manager", async () => {
    const { deps } = root({ "bun.lock": "file", "bun.lockb": "file" });

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.setup.map((s) => s.script)).toEqual(["bun install"]);
  });

  it("suggests nothing for a symlink, a directory, a failing stat, or an absence", async () => {
    const { deps } = root({
      ".env": "symlink",
      ".env.local": "directory",
      ".envrc": "failing",
      "pnpm-lock.yaml": "symlink",
    });

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries).toEqual([]);
    expect(model.setup).toEqual([]);
    // A stat that failed is absence of evidence, not a configuration problem —
    // nothing here was configured, so there is nothing to report.
    expect(model.problems).toEqual([]);
  });

  it("stats exactly the fixed names, and asks nothing else of the filesystem", async () => {
    const { deps, statted } = root({ ".env": "file", "pnpm-lock.yaml": "file" });

    await suggestProvisioning(deps, ROOT, seq());

    const expected = [...SUGGESTED_ENV_FILES, ...SUGGESTED_MANAGERS.flatMap((m) => m.lockfiles)].map(
      (name) => `${ROOT}/${name}`,
    );
    // Every call accounted for: no wildcard, no extra probe, no re-stat. The
    // interface already withholds `readFile` and `readdir`; this pins the one
    // capability it does hold to the fixed list.
    expect(statted.sort()).toEqual([...expected].sort());
  });

  it("offers an empty model for a root holding none of the fixed names", async () => {
    const { deps } = root({});

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model).toMatchObject({ entries: [], setup: [], ports: [], providers: [], problems: [] });
  });

  it("numbers rows from the sequence it is handed, not a private one", async () => {
    const { deps } = root({ ".env": "file", "pnpm-lock.yaml": "file" });
    const budget = seq();
    budget.nextId(); // s1 spent elsewhere in the same read

    const model = await suggestProvisioning(deps, ROOT, budget);

    expect([...model.entries, ...model.setup].map((r) => r.id)).toEqual(["s2", "s3"]);
  });
});

describe("suggestProvisioning — the workspaces a repository declares", () => {
  const PKG = (workspaces: unknown): string => JSON.stringify({ name: "r", workspaces });

  it("finds an environment file inside a declared package and names it by its path", async () => {
    const { deps, read } = root(
      { "apps/web/.env": "file", "apps/server/.env": "file" },
      { "package.json": PKG(["apps/*"]) },
    );

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries.map((e) => e.path).sort()).toEqual(["apps/server/.env", "apps/web/.env"]);
    // Path AND source, so a copy reads the file whose presence was the evidence.
    expect(model.entries.every((e) => e.path === e.source && e.mode === "copy")).toBe(true);
    // Two rows a user must tell apart name the directory that distinguishes them.
    expect(model.entries.find((e) => e.path === "apps/web/.env")?.suggestion).toContain("apps/web/.env");
    // Only manifests are ever opened.
    expect(read).toEqual(["package.json"]);
  });

  it("accepts the object form of workspaces as well as the array", async () => {
    const { deps } = root({ "packages/infra/.env": "file" }, { "package.json": PKG({ packages: ["packages/*"] }) });

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries.map((e) => e.path)).toEqual(["packages/infra/.env"]);
  });

  it("reads pnpm-workspace.yaml when package.json declares nothing", async () => {
    const { deps } = root(
      { "apps/web/.env": "file" },
      { "package.json": PKG(undefined), "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n" },
    );

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries.map((e) => e.path)).toEqual(["apps/web/.env"]);
  });

  it("refuses a manifest whose parse reports any error, rather than acting on what survived", async () => {
    // `readJsonc` RECOVERS: it returns the keys it could build and reports the
    // syntax errors out of band. A detector checking only for `undefined` would
    // read `workspaces` out of this and act on half a file.
    const { deps } = root({ "apps/web/.env": "file" }, { "package.json": '{"workspaces":["apps/*"],"broken":' });

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries).toEqual([]);
  });

  it("ignores a workspaces value of the wrong shape and its non-string members", async () => {
    for (const shape of [42, "apps/*", { nope: ["apps/*"] }, [1, null, { a: 1 }]]) {
      const { deps } = root({ "apps/web/.env": "file" }, { "package.json": PKG(shape) });
      expect((await suggestProvisioning(deps, ROOT, seq())).entries, JSON.stringify(shape)).toEqual([]);
    }
  });

  it("offers nothing from a pattern that resolves outside the checkout", async () => {
    const { deps } = root(
      { "../secrets/.env": "file", "apps/web/.env": "file" },
      { "package.json": PKG(["../secrets", "/etc", "apps/*"]) },
    );

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries.map((e) => e.path)).toEqual(["apps/web/.env"]);
  });

  it("skips a pattern this reader does not implement rather than interpreting it generously", async () => {
    const { deps, listed } = root({ "apps/web/.env": "file" }, { "package.json": PKG(["**/*", "a/*/b"]) });

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries).toEqual([]);
    expect(listed).toEqual([]);
  });

  it("charges every resolved directory to the shared budget, literal spellings included", async () => {
    // The hole the plan attack found: literal paths skip `splitGlob` and
    // `scanNames` entirely and never increment `scanned`, so a manifest of
    // literal directories bought unbounded probing under a budget that could
    // not see it.
    const dirs = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const { deps, statted } = root(
      Object.fromEntries(dirs.map((d) => [`${d}/.env`, "file" as Kind])),
      { "package.json": PKG(dirs) },
    );
    const budget = seq();
    budget.scanned = MAX_SCAN - 5;

    const model = await suggestProvisioning(deps, ROOT, budget);

    expect(budget.scanned).toBe(MAX_SCAN);
    expect(model.entries.length).toBeLessThanOrEqual(5);
    // Probing stops with the budget: no directory past the cap is even statted.
    // Anchored on the package directory: the ROOT lockfile probes are also
    // `/repo/p…`, and a substring filter counted `pnpm-lock.yaml` as a package.
    expect(statted.filter((p) => /^\/repo\/p\d+\//.test(p))).toHaveLength(5 * SUGGESTED_ENV_FILES.length);
  });

  it("keeps root suggestions first and unchanged when a workspace also contributes", async () => {
    const { deps } = root(
      { ".env": "file", "apps/web/.env": "file", "pnpm-lock.yaml": "file" },
      { "package.json": PKG(["apps/*"]) },
    );

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries.map((e) => e.path)).toEqual([".env", "apps/web/.env"]);
    // Setup stays a root question: one workspace install runs at the root (D5).
    expect(model.setup.map((st) => st.script)).toEqual(["pnpm install"]);
  });

  it("suggests nothing extra for a repository that declares no workspaces", async () => {
    const { deps, listed } = root({ ".env": "file", "apps/web/.env": "file" }, { "package.json": PKG(undefined) });

    const model = await suggestProvisioning(deps, ROOT, seq());

    expect(model.entries.map((e) => e.path)).toEqual([".env"]);
    expect(listed).toEqual([]);
  });
});

