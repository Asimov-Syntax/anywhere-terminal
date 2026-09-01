// src/worktree/provisioning/entryGate.test.ts — the refusals, before a file is opened.
//
// Every case here is a REFUSAL with a reason, or an admission with two resolved
// paths. Nothing in this module writes, so the acceptance is which reason comes
// back and that an admitted entry names paths that were checked against two
// different roots (design.md D4).

import { describe, expect, it } from "vitest";
import type { ProvisionEntry } from "../../types/messages";
import type { ResolvedPathInsideDeps } from "../../utils/resolvedPathBoundary";
import { admitEntry, prepareEntryGate } from "./entryGate";

const MAIN = "/repo";
const WT = "/wt/feature";

/**
 * A filesystem as a link table: a path present here resolves to its value,
 * everything else resolves to itself, and `absent` is ENOENT.
 *
 * Enough for this module, which never opens anything — it only asks the shared
 * resolved predicate where a path lands.
 */
function fs(links: Record<string, string> = {}, absent: readonly string[] = []): ResolvedPathInsideDeps {
  const enoent = (p: string): never => {
    const error = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  };
  const resolve = (p: string): string => {
    for (const [from, to] of Object.entries(links)) {
      if (p === from) {
        return to;
      }
      if (p.startsWith(`${from}/`)) {
        return to + p.slice(from.length);
      }
    }
    return p;
  };
  return {
    realpath: async (p) => (absent.includes(p) ? enoent(p) : resolve(p)),
    lstat: async (p) => (absent.includes(p) ? enoent(p) : {}),
  };
}

const entry = (path: string, mode: "copy" | "link" = "copy"): ProvisionEntry => ({
  id: "i1",
  path,
  mode,
  source: "asimov/worktree.yaml",
});

async function gate(deps: ResolvedPathInsideDeps) {
  const roots = await prepareEntryGate(MAIN, WT, deps);
  if (roots === null) {
    throw new Error("roots did not prepare");
  }
  return roots;
}

async function verdictFor(e: ProvisionEntry, deps: ResolvedPathInsideDeps = fs()) {
  return admitEntry(e, await gate(deps), deps);
}

describe("an entry is admitted or refused before anything opens it", () => {
  it("admits an ordinary entry with a path under each root", async () => {
    const verdict = await verdictFor(entry(".env"));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.source).toBe("/repo/.env");
    expect(verdict.destination).toBe("/wt/feature/.env");
  });

  it("refuses a path that climbs out with .., rather than trimming it", async () => {
    const verdict = await verdictFor(entry("../../etc/passwd"));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    expect(verdict.reason).toMatch(/outside/i);
    // The reason must not read as though a usable path came back.
    expect(verdict).not.toHaveProperty("source");
  });

  it("refuses an absolute path outright", async () => {
    for (const absolute of ["/etc/passwd", "C:\\Windows\\system32"]) {
      const verdict = await verdictFor(entry(absolute));
      expect(verdict.ok).toBe(false);
      if (verdict.ok) {
        continue;
      }
      expect(verdict.reason).toMatch(/relative/i);
    }
  });

  it("refuses a source whose component resolves out of the main checkout", async () => {
    // `/repo/escape` is a link to somewhere else entirely.
    const verdict = await verdictFor(entry("escape/secret"), fs({ "/repo/escape": "/outside" }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    expect(verdict.reason).toMatch(/outside/i);
  });

  it("refuses a destination whose component resolves out of the new worktree", async () => {
    // The source is fine; only the DESTINATION escapes. One "inside the
    // repository" test would have admitted this.
    const verdict = await verdictFor(entry("cfg/app.json"), fs({ "/wt/feature/cfg": "/outside" }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    expect(verdict.reason).toMatch(/outside/i);
  });

  it("refuses a source that resolves into the new worktree rather than the main checkout", async () => {
    // The defeater for a single shared root: this passes "inside the repository"
    // and is still a source that is really a destination.
    const verdict = await verdictFor(entry("shared/app.json"), fs({ "/repo/shared": "/wt/feature/shared" }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    expect(verdict.reason).toMatch(/outside/i);
  });

  it("admits an entry whose destination does not exist yet", async () => {
    // The normal case: the worktree was made seconds ago and holds none of this.
    const verdict = await verdictFor(
      entry("config/local.json"),
      fs({}, ["/wt/feature/config", "/wt/feature/config/local.json"]),
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("some material is refused however it was asked for", () => {
  it.each([
    ["pnpm-lock.yaml"],
    ["package-lock.json"],
    ["yarn.lock"],
    ["bun.lockb"],
    ["Cargo.lock"],
  ])("refuses %s for copy AND for link", async (name) => {
    for (const mode of ["copy", "link"] as const) {
      const verdict = await verdictFor(entry(name, mode));
      expect(verdict.ok).toBe(false);
      if (verdict.ok) {
        continue;
      }
      expect(verdict.reason).toMatch(/lockfile/i);
    }
  });

  it("refuses node_modules as a link, naming why a shared tree is not supported", async () => {
    const verdict = await verdictFor(entry("node_modules", "link"));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    expect(verdict.reason).toMatch(/node_modules/);
  });

  it("does not refuse node_modules for copy under the link rule", async () => {
    // The rule is about SHARING a tree, which a copy does not do. If this ever
    // starts refusing, it must be for a reason that says something else.
    const verdict = await verdictFor(entry("node_modules"));
    if (!verdict.ok) {
      expect(verdict.reason).not.toMatch(/shared/i);
    }
  });

  it("refuses a nested lockfile, not only one at the root", async () => {
    const verdict = await verdictFor(entry("packages/api/pnpm-lock.yaml"));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    expect(verdict.reason).toMatch(/lockfile/i);
  });

  it("gives each refusal a reason distinguishable from the others", async () => {
    const reasons = new Set<string>();
    for (const e of [entry("../x"), entry("/abs"), entry("yarn.lock"), entry("node_modules", "link")]) {
      const verdict = await verdictFor(e);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        reasons.add(verdict.reason);
      }
    }
    expect(reasons.size).toBe(4);
  });
});

describe("[F004] a spelling cannot walk past a refusal", () => {
  // `path.posix.basename` does not split a backslash, so every basename rule
  // below matched nothing — while `path.resolve` on Windows DOES split it, so
  // the entry landed anyway. Two Acceptance clauses were bypassable by
  // spelling alone, on the platform where the separator is real.
  it.each([
    ["tools\\pnpm-lock.yaml", "a lockfile"],
    ["vendor\\node_modules", "node_modules"],
    ["a\\b\\.env", "an ordinary file"],
  ])("refuses %s (%s)", async (spelling) => {
    const deps = fs();
    const verdict = await admitEntry(entry(spelling), await gate(deps), deps);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/backslash/i);
    }
  });
});
