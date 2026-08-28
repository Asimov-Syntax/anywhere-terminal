// src/test/invariants/coverageReporter.ts — Invariant coverage, counted from the run itself.
// See asimov/changes/verify-cross-layer-scale/design.md D1 (revised after review round 5).
//
// Five hand-written scanners tried to decide, from source text, whether a tagged test would run.
// Each was locally correct and each was walked past: comments, string literals, `item(` vs `it(`,
// `describe.skip`, `skipIf`/`runIf`, `describe["skip"]`. The last one cannot be answered statically
// at all — `ctx.skip()` is called while the test executes.
//
// So nothing here decides. The runner reports what it ran, and this reads that report.

import path from "node:path";
import type { Reporter, TestCase, TestModule, TestRunEndReason, Vitest } from "vitest/node";
import { INVARIANTS } from "./registry";

const TAG = /\[(I\d+)\]/g;

/**
 * Whether this test counts as coverage.
 *
 * `it.fails(...)` is why `state` alone is not enough: it EXECUTES, and it reports `passed` when
 * its body throws. A collection-time answer — `vitest list`, a global-setup manifest — counts it,
 * which is the same class of miss that beat the scanner five times.
 */
function proves(test: TestCase): boolean {
  return test.result().state === "passed" && test.options.fails !== true;
}

interface Sighting {
  readonly id: string;
  readonly where: string;
}

function sightings(modules: readonly TestModule[]): Sighting[] {
  const found: Sighting[] = [];
  for (const module of modules) {
    const where = path.relative(process.cwd(), module.moduleId);
    for (const test of module.children.allTests()) {
      if (!proves(test)) {
        continue;
      }
      for (const [, id] of test.name.matchAll(TAG)) {
        found.push({ id, where });
      }
    }
  }
  return found;
}

/**
 * Fails the run when a `docs/DESIGN.md` § 8.4 invariant the registry calls `covered` has no test
 * that actually passed under it, or when a tag names no registry row.
 *
 * Attached from the `test:unit` script rather than from `vitest.config.mts`, so a targeted
 * `vitest run <file>` is not answering a question it was never asked.
 */
export default class InvariantCoverageReporter implements Reporter {
  private vitest: Vitest | undefined;

  onInit(vitest: Vitest): void {
    this.vitest = vitest;
  }

  async onTestRunEnd(modules: readonly TestModule[], _errors: unknown, reason: TestRunEndReason): Promise<void> {
    // A red or interrupted run already fails, and its untagged gaps are consequences of the
    // failure rather than findings. Reporting them here would bury the real error.
    if (reason !== "passed") {
      return;
    }
    const partial = await this.partialRun(modules);
    if (partial !== null) {
      console.log(`[invariants] coverage not checked — ${partial}. Run \`pnpm run test:unit\` unfiltered.`);
      return;
    }

    const seen = new Map<string, string[]>();
    for (const { id, where } of sightings(modules)) {
      seen.set(id, [...(seen.get(id) ?? []), where]);
    }
    const known = new Set(INVARIANTS.map((row) => row.id));

    const uncovered = INVARIANTS.filter((row) => row.status === "covered" && !seen.has(row.id));
    const unknown = [...seen.keys()].filter((id) => !known.has(id));
    if (uncovered.length === 0 && unknown.length === 0) {
      return;
    }

    const lines = ["", "[invariants] docs/DESIGN.md § 8.4 coverage failed:"];
    for (const row of uncovered) {
      lines.push(`  ${row.id} is registered as covered, but no passing test carries its tag.`);
      lines.push(`    stimulus: ${row.stimulus}`);
    }
    for (const id of unknown) {
      lines.push(`  [${id}] names no registry row — tagged in ${seen.get(id)?.join(", ")}`);
    }
    console.error(lines.join("\n"));
    process.exitCode = 1;
  }

  /** Why this run cannot answer the coverage question, or `null` when it can. */
  private async partialRun(modules: readonly TestModule[]): Promise<string | null> {
    const pattern = this.vitest?.config.testNamePattern;
    if (pattern !== undefined) {
      return `tests were filtered by name (${String(pattern)})`;
    }
    const all = await this.vitest?.globTestSpecifications();
    if (all === undefined) {
      return "the reporter never received the Vitest instance";
    }
    const ran = new Set(modules.map((module) => module.moduleId));
    const missing = all.filter((spec) => !ran.has(spec.moduleId)).length;
    return missing === 0 ? null : `${missing} of ${all.length} test files were filtered out`;
  }
}
