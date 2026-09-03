// src/worktree/provisioning/suggestProvisioning.test.ts — the bounded fallback
// detector: fixed repository-root names, metadata only, opt-in rows
// (suggest-worktree-initialization design.md D1, D2).

import { describe, expect, it } from "vitest";
import {
  SUGGESTED_ENV_FILES,
  SUGGESTED_MANAGERS,
  type SuggestDeps,
  suggestProvisioning,
} from "./suggestProvisioning";

const ROOT = "/repo";

type Kind = "file" | "symlink" | "directory" | "failing";

/**
 * A root that answers `lstat` and nothing else — `SuggestDeps` offers no other
 * capability, so a detector that wanted bytes or a listing could not compile.
 */
function root(entries: Record<string, Kind>): { deps: SuggestDeps; statted: string[] } {
  const statted: string[] = [];
  const deps: SuggestDeps = {
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
  return { deps, statted };
}

function seq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `s${n}`;
  };
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

    const expected = [
      ...SUGGESTED_ENV_FILES,
      ...SUGGESTED_MANAGERS.flatMap((m) => m.lockfiles),
    ].map((name) => `${ROOT}/${name}`);
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
    const nextId = seq();
    nextId(); // s1 spent elsewhere in the same read

    const model = await suggestProvisioning(deps, ROOT, nextId);

    expect([...model.entries, ...model.setup].map((r) => r.id)).toEqual(["s2", "s3"]);
  });
});
