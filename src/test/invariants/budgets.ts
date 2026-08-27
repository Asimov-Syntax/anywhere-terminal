// src/test/invariants/budgets.ts — The published scale budgets, as data.
// See asimov/changes/verify-cross-layer-scale/design.md D2.
//
// Cost budgets are exact counts and are asserted in the unit suite. Latency budgets are
// wall-clock and are asserted only by `pnpm run bench:scale`, never inside `test:unit`,
// because a timing assertion in a default suite measures the machine as much as the code.
//
// Neither a bound nor a fixture size may move to make a run pass. If a measurement breaches
// its budget, that is the finding.

export interface Budget {
  /** Where the value is published. This file is a mirror, never the definition. */
  readonly source: string;
  readonly fixture: string;
}

export interface LatencyBudget extends Budget {
  readonly maxMs: number;
}

export interface CostBudget extends Budget {
  readonly exactly: number;
}

/** worktree-agent-presence.md § 7 — "Presence rebuild, 10 panes / 10 worktrees | < 50 ms". */
export const PRESENCE_REBUILD: LatencyBudget = {
  source: "docs/design/worktree-agent-presence.md § 7",
  fixture: "10 panes × 10 worktrees",
  maxMs: 50,
};

/** worktree-agent-presence.md § 7 — "Process-table reads per rebuild | 1". */
export const PROCESS_TABLE_READS: CostBudget = {
  source: "docs/design/worktree-agent-presence.md § 7",
  fixture: "one rebuild, any pane count",
  exactly: 1,
};

/** worktree-model.md § 7 — "Rebuild latency, 1 repo / 10 worktrees | < 150 ms". */
export const MODEL_REBUILD: LatencyBudget = {
  source: "docs/design/worktree-model.md § 7",
  fixture: "1 repo × 10 worktrees, real git",
  maxMs: 150,
};

/** worktree-model.md § 7 — "Git invocations per watcher burst | 1 per affected repo". */
export const GIT_INVOCATIONS_PER_BURST: CostBudget = {
  source: "docs/design/worktree-model.md § 7",
  fixture: "one watcher burst, per affected repo",
  exactly: 1,
};
