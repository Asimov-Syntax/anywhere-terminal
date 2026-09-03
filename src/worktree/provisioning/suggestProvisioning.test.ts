// src/worktree/provisioning/suggestProvisioning.test.ts — the bounded fallback
// detector: fixed repository-root names, metadata only, opt-in rows
// (suggest-worktree-initialization design.md D1, D2).

import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SCAN, newBudget, type ProviderBudget } from "./providerKit";
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
      const at = rel(p);
      const prefix = at === ROOT || at === "" ? "" : `${at}/`;
      const names = new Set<string>();
      for (const key of [...Object.keys(entries), ...Object.keys(files)]) {
        if (key.startsWith(prefix)) {
          const next = key.slice(prefix.length).split("/")[0];
          if (next) {
            names.add(next);
          }
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
    const { deps, statted } = root(Object.fromEntries(dirs.map((d) => [`${d}/.env`, "file" as Kind])), {
      "package.json": PKG(dirs),
    });
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

describe("suggestProvisioning — what round-1 found", () => {
  const PKG = (workspaces: unknown): string => JSON.stringify({ name: "r", workspaces });

  it("[F001] does not read a manifest that resolves outside the checkout", async () => {
    const { deps, read } = root({ "apps/web/.env": "file" }, { "package.json": PKG(["apps/*"]) });
    // A `package.json` symlinked out of the repository. `openProviderFile`
    // resolves before it reads, so the bytes are never taken — a bare
    // `deps.readFile` followed the link and let an external file declare this
    // repository's workspaces.
    const outside: SuggestDeps = {
      ...deps,
      realpath: async (p) => (/package\.json$|pnpm-workspace\.yaml$/.test(p) ? `/elsewhere/${path.basename(p)}` : p),
    };

    const model = await suggestProvisioning(outside, ROOT, seq());

    expect(read).toEqual([]);
    expect(model.entries).toEqual([]);
  });

  it("[F002] a refused package manifest does not fall through to pnpm", async () => {
    const { deps } = root(
      { "apps/web/.env": "file" },
      { "package.json": '{"workspaces":["apps/*"],"broken":', "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n" },
    );

    const model = await suggestProvisioning(deps, ROOT, seq());

    // Refusal ends the walk. Treating it as "declared nothing" let the
    // lower-priority manifest govern probing for a repository whose own
    // manifest this reader had just declined to trust.
    expect(model.entries).toEqual([]);
  });

  it("[F003] one unreadable workspace directory does not discard every other suggestion", async () => {
    const { deps } = root({ ".env": "file", "pnpm-lock.yaml": "file" }, { "package.json": PKG(["apps/*"]) });
    const missing: SuggestDeps = {
      ...deps,
      readdir: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    };

    const model = await suggestProvisioning(missing, ROOT, seq());

    // The rejection used to escape the whole detector, so a sparse checkout
    // lost its root `.env` and its install step to an absent `apps/`.
    expect(model.entries.map((e) => e.path)).toEqual([".env"]);
    expect(model.setup.map((st) => st.script)).toEqual(["pnpm install"]);
  });

  it("[F004] a manifest of escaping declarations spends the budget it costs", async () => {
    const escaping = Array.from({ length: 40 }, (_, i) => `../outside${i}`);
    const { deps } = root({}, { "package.json": PKG(escaping) });
    const budget = seq();
    budget.scanned = MAX_SCAN - 5;

    const model = await suggestProvisioning(deps, ROOT, budget);

    // A refusal still costs a resolution, so it is charged. Charging only
    // ACCEPTED directories left this path free to run past the cap.
    expect(budget.scanned).toBe(MAX_SCAN);
    expect(model.entries).toEqual([]);
  });

  it("[F005] a root-level star finds the top-level packages it names", async () => {
    const { deps } = root({ "web/.env": "file", "server/.env": "file" }, { "package.json": PKG(["*"]) });

    const model = await suggestProvisioning(deps, ROOT, seq());

    // `splitGlob("*")` names the repository root, and resolved containment
    // refuses a candidate equal to the root on purpose — so asking it here
    // reported `*` as escaping and dropped every package.
    expect(model.entries.map((e) => e.path).sort()).toEqual(["server/.env", "web/.env"]);
  });
});

describe("suggestProvisioning — what round-3 found", () => {
  const PKG = (workspaces: unknown): string => JSON.stringify({ name: "r", workspaces });
  const PNPM = "packages:\n  - 'apps/*'\n";

  it("[F002] a wrong-shaped workspaces value is refused, not read past", async () => {
    // Present-but-unsupported is not the same answer as absent. Treating it as
    // "declared nothing" let the lower-priority manifest govern probing.
    for (const shape of [42, "apps/*", { nope: ["apps/*"] }, true]) {
      const { deps } = root({ "apps/web/.env": "file" }, { "package.json": PKG(shape), "pnpm-workspace.yaml": PNPM });
      expect((await suggestProvisioning(deps, ROOT, seq())).entries, JSON.stringify(shape)).toEqual([]);
    }
  });

  it("[F002] an absent workspaces key still falls through to pnpm", async () => {
    // The other half of the same rule: refusal is terminal, absence is not.
    const { deps } = root({ "apps/web/.env": "file" }, { "package.json": PKG(undefined), "pnpm-workspace.yaml": PNPM });

    expect((await suggestProvisioning(deps, ROOT, seq())).entries.map((e) => e.path)).toEqual(["apps/web/.env"]);
  });

  it("[F006] a manifest that is not a record does not take the whole offer down", async () => {
    // `readJsonc("null")` returns null with no errors, and reading `.workspaces`
    // off it threw — a rejection the host swallows by dropping every row.
    for (const text of ["null", "42", '"a string"', "[1,2]"]) {
      const { deps } = root({ ".env": "file", "pnpm-lock.yaml": "file" }, { "package.json": text });

      const model = await suggestProvisioning(deps, ROOT, seq());

      expect(
        model.entries.map((e) => e.path),
        text,
      ).toEqual([".env"]);
      expect(
        model.setup.map((st) => st.script),
        text,
      ).toEqual(["pnpm install"]);
    }
  });

  it("[F007] an absolute glob is refused rather than read as a root glob", async () => {
    // `splitGlob("/*")` reports an empty parent, which is exactly what the
    // root-glob exemption trusts — so `/*` was silently reinterpreted as `*`.
    for (const pattern of ["/*", "/etc/*", "//*"]) {
      const { deps } = root({ "web/.env": "file" }, { "package.json": PKG([pattern]) });
      expect((await suggestProvisioning(deps, ROOT, seq())).entries, pattern).toEqual([]);
    }
  });

  it("[F008] a directory is not read once the account is spent", async () => {
    // The parent charge can spend the last unit itself. `scanNames` bounds what
    // it KEEPS, but a Promise-backed readdir has already materialized the
    // directory by the time it looks, so the syscall is what must be gated.
    const { deps } = root({ "apps/web/.env": "file" }, { "package.json": PKG(["apps/*"]) });
    const listed: string[] = [];
    const counting: SuggestDeps = {
      ...deps,
      readdir: (p) => {
        listed.push(p);
        return deps.readdir(p);
      },
    };
    const budget = seq();
    budget.scanned = MAX_SCAN - 1;

    await suggestProvisioning(counting, ROOT, budget);

    expect(listed).toEqual([]);
  });
});
