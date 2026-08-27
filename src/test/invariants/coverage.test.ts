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
});
