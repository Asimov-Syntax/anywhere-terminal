// src/test/invariants/coverage.test.ts — Keeps the § 8.4 invariants honest.
// See asimov/changes/verify-cross-layer-scale/design.md D1.
//
// Everything here reads through node:fs rather than a shell. Five sources in this repo embed
// a literal NUL, which makes BSD grep classify them as binary and skip them printing nothing
// to stdout — that is how this change's own discovery first read two wired call sites as dead.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_WORKTREES_PER_REPO } from "../../webview/worktree/WorktreeView";
import { DEFERRED_BY_WT_006_2, INVARIANTS } from "./registry";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = path.join(REPO_ROOT, "src");

/** The § 8.4 table, parsed from the doc itself so the registry cannot drift away from it. */
function documentedInvariants(): Map<string, string> {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/DESIGN.md"), "utf8");
  const start = doc.indexOf("### 8.4");
  const end = doc.indexOf("### 8.5", start);
  expect(start, "DESIGN.md § 8.4 not found").toBeGreaterThan(-1);
  expect(end, "DESIGN.md § 8.5 not found").toBeGreaterThan(start);
  const rows = new Map<string, string>();
  for (const line of doc.slice(start, end).split("\n")) {
    const m = /^\|\s*(I\d+)\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (m !== null) {
      rows.set(m[1], m[2]);
    }
  }
  return rows;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Every task id the blueprint declares, so an `owners` entry cannot point at nothing. */
function blueprintTaskIds(): Set<string> {
  const plan = fs.readFileSync(path.join(REPO_ROOT, "docs/PLAN.md"), "utf8");
  return new Set([...plan.matchAll(/^###\s*\[(WT-[\d.]+)\]/gm)].map((m) => m[1]));
}

/** Modifiers that mean the declaration does not run, so it cannot hold an invariant open. */
const INERT = /(^|\.)(skip|todo|failing|concurrent\.skip)($|\.)/;

/**
 * Test declarations, found at their call sites rather than by scanning raw text — a tag inside
 * a comment or a fixture string is not coverage. Titles may span lines, hence [\s\S].
 */
const DECLARATION = /\b(?:it|test)((?:\.\w+)*)\s*\(\s*(["'`])([\s\S]*?)\2/g;

interface Declaration {
  readonly title: string;
  readonly active: boolean;
}

function declarationsIn(source: string): Declaration[] {
  const found: Declaration[] = [];
  for (const match of source.matchAll(DECLARATION)) {
    found.push({ title: match[3], active: !INERT.test(match[1]) });
  }
  return found;
}

const TAG = /\[(I\d+)\]/g;

/** Every invariant id tagged on a declaration that actually runs, mapped to where it was found. */
function taggedInvariants(): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const full of tsFiles(SRC).filter((f) => f.endsWith(".test.ts"))) {
    const rel = path.relative(REPO_ROOT, full);
    for (const declaration of declarationsIn(fs.readFileSync(full, "utf8"))) {
      if (!declaration.active) {
        continue;
      }
      for (const [, id] of declaration.title.matchAll(TAG)) {
        byId.set(id, [...(byId.get(id) ?? []), rel]);
      }
    }
  }
  return byId;
}

describe("truthfulness invariants — registry", () => {
  it("carries exactly the invariants DESIGN.md § 8.4 states", () => {
    const documented = documentedInvariants();
    expect(documented.size).toBeGreaterThan(0);
    expect(INVARIANTS.map((row) => row.id)).toEqual([...documented.keys()]);
  });

  it("states each invariant verbatim, so an edit to either side fails rather than drifts", () => {
    const documented = documentedInvariants();
    for (const row of INVARIANTS) {
      expect(row.statement, `${row.id} text differs from DESIGN.md § 8.4`).toBe(documented.get(row.id));
    }
  });

  it("attributes every invariant to blueprint tasks that exist", () => {
    const known = blueprintTaskIds();
    for (const row of INVARIANTS) {
      expect(row.owners.length, `${row.id} names no owner`).toBeGreaterThan(0);
      for (const owner of row.owners) {
        expect(known.has(owner), `${row.id} names unknown task ${owner}`).toBe(true);
      }
    }
  });

  it("gives every invariant a stimulus a reviewer can check a tagged test against", () => {
    for (const row of INVARIANTS) {
      expect(row.stimulus.length, `${row.id} has no stimulus`).toBeGreaterThan(0);
    }
  });

  it("makes an unproven invariant say why, rather than pass quietly", () => {
    for (const row of INVARIANTS) {
      if (row.status !== "covered") {
        expect(row.reason, `${row.id} is ${row.status} with no reason`).toBeTruthy();
      }
    }
  });

  it("defers only what the frozen peer-owned set names", () => {
    const deferred = INVARIANTS.filter((row) => row.status === "deferred").map((row) => row.id);
    expect(deferred).toEqual([...DEFERRED_BY_WT_006_2]);
  });

  // Assertion 6 (design.md D1). `uncovered` is the audit's backlog, not a
  // resting state: once the change that opened it closes, an invariant may only
  // be covered or deferred against the frozen set above. Leaving this to a
  // reviewer is what let the backlog become permanent last time.
  it("leaves no invariant merely recorded as unproven", () => {
    const uncovered = INVARIANTS.filter((row) => row.status === "uncovered").map((row) => row.id);
    expect(uncovered).toEqual([]);
  });
});

describe("truthfulness invariants — coverage", () => {
  it("finds a tag only where a test actually declares one", () => {
    const source = [
      '// it("[I1] a tag in a comment is not coverage", () => {});',
      'it("[I2] a real one", () => {});',
      'it.skip("[I3] a disabled one", () => {});',
      'const fixture = "[I4] a tag inside a fixture string";',
    ].join("\n");
    expect(
      declarationsIn(source)
        .filter((d) => d.active)
        .map((d) => d.title),
    ).toEqual(["[I1] a tag in a comment is not coverage", "[I2] a real one"]);
  });

  it("treats a disabled declaration as inert, so it cannot hold an invariant open", () => {
    for (const modifier of ["skip", "todo", "failing"]) {
      const only = declarationsIn(`it.${modifier}("[I9] x", () => {});`);
      expect(only[0]?.active, `it.${modifier} counted as active`).toBe(false);
    }
    expect(declarationsIn('it.only("[I9] x", () => {});')[0]?.active).toBe(true);
  });

  it("has a running test for every invariant it claims is covered", () => {
    const tagged = taggedInvariants();
    for (const row of INVARIANTS) {
      if (row.status === "covered") {
        expect(tagged.get(row.id)?.length ?? 0, `${row.id} claims coverage but no active test tags it`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("carries no tag that names an invariant the registry does not have", () => {
    const known = new Set(INVARIANTS.map((row) => row.id));
    for (const id of taggedInvariants().keys()) {
      expect(known.has(id), `tag [${id}] names no registry row`).toBe(true);
    }
  });
});

// The render cap is not a § 8.4 invariant — it is WT-007.1's fifth acceptance clause,
// "a repo past the render budget caps visibly rather than truncating silently". The
// behaviour was already covered (WorktreeView.test.ts:217). What was missing is that the
// value was module-private and absent from the § 10 registry, so a change to either side
// went unnoticed. This is the drift detector, not a second copy of the behaviour.
describe("cross-document consistency registry", () => {
  it("states the render cap the shipped code actually exports", () => {
    const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/DESIGN.md"), "utf8");
    const row = doc.split("\n").find((line) => line.includes("Worktree render cap"));
    expect(row, "DESIGN.md § 10.1 has no row for the worktree render cap").toBeDefined();
    expect(row).toContain(`MAX_WORKTREES_PER_REPO = ${MAX_WORKTREES_PER_REPO}`);
  });
});
