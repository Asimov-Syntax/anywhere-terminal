// src/worktree/provisioning/entryGate.test.ts — the refusals, before a file is opened.
//
// Every case here is a REFUSAL with a reason, or an admission with two resolved
// paths. Nothing in this module writes, so the acceptance is which reason comes
// back and that an admitted entry names paths that were checked against two
// different roots (design.md D4).

import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProvisionEntry } from "../../types/messages";
import type { AuthorizedDirectory } from "../../utils/authorizedDirectory";
import type { ResolvedPathInsideDeps } from "../../utils/resolvedPathBoundary";
import { admitEntry, prepareEntryGate, refusedLockfile } from "./entryGate";

const MAIN = "/repo";
const WT = "/wt/feature";

function observed(path: string): AuthorizedDirectory {
  return { path, platform: "darwin", components: [{ path, identity: { dev: 7, ino: path.length } }] };
}

const AUTHORIZATION = { source: observed(MAIN), destination: observed(WT) };

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
  const roots = await prepareEntryGate(MAIN, WT, AUTHORIZATION, deps);
  if (roots === null) {
    throw new Error("roots did not prepare");
  }
  return roots;
}

async function verdictFor(e: ProvisionEntry, deps: ResolvedPathInsideDeps = fs()) {
  return admitEntry(e, await gate(deps), deps);
}

describe("an entry is admitted or refused before anything opens it", () => {
  it("retains the mutation-issued source and destination authorizations", async () => {
    const roots = await gate(fs());

    expect(roots.source.authorization).toBe(AUTHORIZATION.source);
    expect(roots.destination.authorization).toBe(AUTHORIZATION.destination);
  });

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

describe("[F004] every spelling of a refused name is refused", () => {
  // Round 1 fixed the backslash this block already covers and left the
  // instrument that made it work: the rule read `path.posix.basename` while
  // admission resolved with `path.resolve`. Acceptance is per SPELLING now,
  // not per rule — the chair reproduced all four of these admitting.
  it.each([
    ["pnpm-lock.yaml", "copy"],
    ["pnpm-lock.yaml/.", "copy"],
    ["./pnpm-lock.yaml", "copy"],
    ["a/../pnpm-lock.yaml", "copy"],
    ["PNPM-LOCK.YAML", "copy"],
    ["Cargo.lock", "copy"],
    ["deps/../Gemfile.lock", "copy"],
  ] as const)("refuses the lockfile spelled %s", async (spelling, mode) => {
    const deps = fs();
    const verdict = await admitEntry(entry(spelling, mode), await gate(deps), deps);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/lockfile/i);
    }
  });

  it.each([
    ["node_modules"],
    ["node_modules/."],
    ["./node_modules"],
    ["a/../node_modules"],
    ["NODE_MODULES"],
  ])("refuses linking node_modules spelled %s", async (spelling) => {
    const deps = fs();
    const verdict = await admitEntry(entry(spelling, "link"), await gate(deps), deps);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/node_modules/i);
    }
  });

  it("still admits a lockfile-like name that is not one, so the rule is not just refusing", async () => {
    const deps = fs();

    expect((await admitEntry(entry("pnpm-lock.yaml.example"), await gate(deps), deps)).ok).toBe(true);
    expect((await admitEntry(entry("node_modules.txt"), await gate(deps), deps)).ok).toBe(true);
  });

  it("copies node_modules when asked to copy it — the rule is about SHARING", async () => {
    const deps = fs();
    expect((await admitEntry(entry("node_modules", "copy"), await gate(deps), deps)).ok).toBe(true);
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

describe("[round-5 F028] a Win32 alias is folded where Win32 decides, not everywhere", () => {
  // Task 4_1 justified these three transforms as filesystem identity, which is
  // true of Win32 and false here: a Darwin probe held `pnpm-lock.yaml`,
  // `pnpm-lock.yaml.` and `pnpm-lock.yaml::$DATA` at once, with three different
  // inodes and three different contents. Folding them everywhere refuses a file
  // the material rule was never about.
  const win32Only = ["pnpm-lock.yaml.", "pnpm-lock.yaml ", "pnpm-lock.yaml::$DATA", "pnpm-lock.yaml::$DATA."];

  it.each(win32Only)("admits `%s` on a platform whose filenames are bytes", async (spelling) => {
    if (path.sep === "\\") {
      // On Win32 the opposite claim holds and the block below is the one that
      // runs; asserting admission there would encode the alias as a distinct
      // file, which is the defect this pair exists to prevent.
      return;
    }
    const deps = fs();

    expect((await admitEntry(entry(spelling), await gate(deps), deps)).ok).toBe(true);
  });

  it.each(win32Only)("still refuses `%s` under Win32 filename identity", (spelling) => {
    // The rule itself, asked directly, so the Win32 half is exercised on every
    // host rather than only on the one that cannot run this suite in CI.
    expect(refusedLockfile(spelling, true)).toMatch(/lockfile/i);
  });

  it("keeps case folding, which is a different question this round did not reopen", async () => {
    const deps = fs();

    expect((await admitEntry(entry("PNPM-LOCK.YAML"), await gate(deps), deps)).ok).toBe(false);
  });
});
