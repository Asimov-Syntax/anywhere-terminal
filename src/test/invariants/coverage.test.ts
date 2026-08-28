// src/test/invariants/coverage.test.ts — Keeps the § 8.4 invariants honest.
// See asimov/changes/verify-cross-layer-scale/design.md D1.
//
// What lives here reads DOCUMENTS: the registry against § 8.4, owners against the blueprint,
// the deferred set against its frozen constant. Whether a tagged test actually RAN is a question
// about execution, and it is answered by `coverageReporter.ts` from the run's own report — five
// generations of source scanner tried to answer it statically and each was walked past.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_WORKTREES_PER_REPO } from "../../webview/worktree/WorktreeView";
import { DEFERRED_BY_WT_006_2, INVARIANTS } from "./registry";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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

/** Every task id the blueprint declares, so an `owners` entry cannot point at nothing. */
function blueprintTaskIds(): Set<string> {
  const plan = fs.readFileSync(path.join(REPO_ROOT, "docs/PLAN.md"), "utf8");
  return new Set([...plan.matchAll(/^###\s*\[(WT-[\d.]+)\]/gm)].map((m) => m[1]));
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

  // `uncovered` is the audit's backlog, not a resting state: once the change that opened it
  // closes, an invariant may only be covered or deferred against the frozen set above. Leaving
  // this to a reviewer is what let the backlog become permanent last time.
  it("leaves no invariant merely recorded as unproven", () => {
    const uncovered = INVARIANTS.filter((row) => row.status === "uncovered").map((row) => row.id);
    expect(uncovered).toEqual([]);
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
