// src/test/bench/scale.bench.ts — The two published WALL-CLOCK budgets.
// See asimov/changes/verify-cross-layer-scale/design.md D2.
//
// Deliberately not part of `test:unit`. A median-of-five timing assertion in a default
// suite measures JIT warm-up, GC and CPU contention as much as it measures the code, and
// five samples characterize none of them — inflicting that on every run buys a number
// nobody trusts. `vitest.config.mts` includes only `*.test.ts`, so this file is invisible
// to `test:unit` by construction. Run it explicitly: `pnpm run bench:scale`.
//
// It runs as a plain node process, NOT inside a vitest worker. Measured both ways: a bare
// `git --version` costs ~10 ms from node and ~80 ms from inside a worker, so a worker-hosted
// run reports the harness rather than the code — three git spawns of that overhead is more
// than the whole budget. Changing where a measurement is taken is not moving the bound.
//
// The model measurement builds a REAL temporary repository with ten worktrees. The
// published claim is "unit bench over a fixture repo"; stubbing git and the filesystem to
// make it fast would delete the very work the number is about.
//
// Neither the documented bound nor the documented fixture size may move to make a run
// pass. If a measurement breaches its budget, that IS the finding.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DescendantsOutcome, ProcessTableSnapshot } from "../../pty/processTableSnapshot";
import { createPaneEvidenceStore } from "../../session/PaneEvidenceStore";
import type { RunningSessionsOutcome } from "../../vault/readers/runningSessions";
import { createPresenceProjectorDeps } from "../../worktree/presenceDeps";
import { createPresenceProjector } from "../../worktree/presenceProjector";
import { buildWorktreeTree } from "../../worktree/WorktreeDiscovery";
import { createWorktreeTreeDeps } from "../../worktree/worktreeDeps";
import { MODEL_REBUILD, PRESENCE_REBUILD } from "../invariants/budgets";

/** The fixture sizes the design documents publish. Frozen — see the header. */
const WORKTREES = 10;
const PANES = 10;
/** Warm-ups discarded, then samples measured. The reported figure is the median. */
const WARMUP = 3;
const SAMPLES = 5;

const NOW = 1_700_000_000_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** Run `each` WARMUP + SAMPLES times and return the median of the measured tail. */
async function measure(each: () => Promise<unknown>): Promise<number> {
  for (let i = 0; i < WARMUP; i++) {
    await each();
  }
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const started = performance.now();
    await each();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

// ── Presence ─────────────────────────────────────────────────────────────
//
// The published target explicitly excludes the memoized session resolution, so the
// process table and the registry are stubbed here. Everything between them — the real
// `createPresenceProjectorDeps` and the real projector — is production's.

function presenceProjector() {
  const outcome: DescendantsOutcome = { kind: "ok", pids: [] };
  const table = {
    open: async () => ({ descendantsOf: () => outcome }),
    descendantsOf: async () => outcome,
  } as unknown as ProcessTableSnapshot;

  const store = createPaneEvidenceStore({ now: () => NOW });
  const worktreeIds = Array.from({ length: WORKTREES }, (_, i) => `/repo/wt-${i}`);
  for (let i = 0; i < PANES; i++) {
    store.create(`pane-${i}`, {
      viewId: "sidebar",
      cwd: worktreeIds[i % WORKTREES],
      ptyPid: 1000 + i,
      shell: "claude",
    });
  }

  const deps = createPresenceProjectorDeps({
    store,
    table,
    listRunning: async (): Promise<RunningSessionsOutcome> => ({ kind: "ok", sessions: [] }),
    sessionMtime: async () => 1,
    sessionPath: async () => null,
    now: () => NOW,
  });
  return { projector: createPresenceProjector(deps), worktreeIds };
}

// ── Model ────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** A real repository with `WORKTREES` real linked worktrees. Caller removes `tmp`. */
function buildFixtureRepo(): { tmp: string; repo: string } {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wt-bench-")));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  git(["init", "-q", "-b", "main"], repo);
  git(["config", "user.email", "t@example.com"], repo);
  git(["config", "user.name", "T"], repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  git(["add", "."], repo);
  git(["commit", "-qm", "init"], repo);
  for (let i = 0; i < WORKTREES; i++) {
    git(["worktree", "add", "-q", "-b", `feat-${i}`, path.join(tmp, `wt-${i}`)], repo);
  }
  return { tmp, repo };
}

interface Budgeted {
  maxMs: number;
  source: string;
  fixture: string;
}

/** Print the measurement whether it passed or not — a budget nobody can read is not a budget. */
function report(label: string, medianMs: number, budget: Budgeted): boolean {
  const ok = medianMs < budget.maxMs;
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(18)} median ${medianMs.toFixed(1)} ms ` +
      `(budget < ${budget.maxMs} ms, ${budget.fixture})\n      ${budget.source}\n`,
  );
  return ok;
}

async function main(): Promise<void> {
  let breached = 0;

  const presence = presenceProjector();
  const presenceMs = await measure(() => presence.projector.project(presence.worktreeIds));
  if (!report("presence rebuild", presenceMs, PRESENCE_REBUILD)) {
    breached++;
  }

  const { tmp, repo } = buildFixtureRepo();
  try {
    // One deps object across every sample, as the host holds one: the git version probe is
    // cached on it, and rebuilding it per sample would charge the rebuild for a probe
    // production pays once per window.
    const deps = createWorktreeTreeDeps();
    const modelMs = await measure(() => buildWorktreeTree([repo], deps));
    if (!report("model rebuild", modelMs, MODEL_REBUILD)) {
      breached++;
      // A breach names a cause rather than a number: this rebuild is dominated by process
      // spawns, so the per-spawn cost tells a reader whether the code regressed or the
      // machine is slow.
      const started = performance.now();
      execFileSync("git", ["--version"], { cwd: repo, encoding: "utf8" });
      process.stdout.write(
        `      for scale: one bare \`git --version\` here costs ${(performance.now() - started).toFixed(1)} ms\n`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (breached > 0) {
    process.stdout.write(
      `\n${breached} budget(s) breached. The bound and the fixture size are frozen ` +
        "(design.md D2): the finding is the breach, not the assertion.\n",
    );
    process.exitCode = 1;
  }
}

await main();
