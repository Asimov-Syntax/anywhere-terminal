// The no-op render guard's input. The load-bearing case is the spinner: without
// frame-stripping here, one animating title repaints the whole tree at animation
// rate and destroys scroll position and expansion state.

import { describe, expect, it } from "vitest";
import { agentRow, singleRepoPresence, singleRepoTree, worktree } from "./worktreeFixtures";
import { worktreeScopeSignature, worktreeSignature } from "./worktreeRenderSignature";
import type {
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreePresence,
  WorktreeRepo,
  WorktreeSubagentRow,
  WorktreeTree,
} from "./worktreeViewTypes";

const NOW = 1_700_000_000_000;

/** One row's signature, for comparing two roster states of the same row. */
function signatureFor(rows: WorktreeAgentRow[]): string {
  return worktreeSignature(singleRepoTree(), {
    scannedAt: NOW,
    degradedSources: [],
    rowsByWorktreeId: { "/repo": rows },
  });
}

function presenceWithTitle(title: string): WorktreePresence {
  return {
    scannedAt: NOW,
    degradedSources: [],
    rowsByWorktreeId: { "/repo": [agentRow({ rowId: "a", agent: "claude", activity: "running", title })] },
  };
}

describe("worktreeSignature", () => {
  it("is empty without a tree", () => {
    expect(worktreeSignature(null, null)).toBe("");
  });

  it("is unchanged by a spinner-only title change", () => {
    expect(worktreeSignature(singleRepoTree(), presenceWithTitle("⠋ Building"))).toBe(
      worktreeSignature(singleRepoTree(), presenceWithTitle("⠙ Building")),
    );
  });

  it("still moves when the real title changes", () => {
    expect(worktreeSignature(singleRepoTree(), presenceWithTitle("⠋ Building"))).not.toBe(
      worktreeSignature(singleRepoTree(), presenceWithTitle("⠋ Testing")),
    );
  });

  // A preview is message text, not a pane title, so nothing in it is decoration to
  // discount — a leading marker is content and every change to it must repaint
  // (source-the-agent-row-preview D4). The animation-rate risk the stripping above
  // guards against lives on the title, which still strips.
  it("moves for any preview change, including a leading marker", () => {
    expect(signatureFor([agentRow({ rowId: "a", preview: "- run the tests" })])).not.toBe(
      signatureFor([agentRow({ rowId: "a", preview: "run the tests" })]),
    );
  });

  it("still moves when the real preview changes", () => {
    expect(signatureFor([agentRow({ rowId: "a", preview: "Bash: npm test" })])).not.toBe(
      signatureFor([agentRow({ rowId: "a", preview: "Bash: npm run build" })]),
    );
  });

  it("is stable across a rescan that found nothing new", () => {
    // `scannedAt` moves on every poll; including it would make the guard buy nothing.
    const a = singleRepoPresence(NOW);
    const b = { ...singleRepoPresence(NOW), scannedAt: NOW + 30_000 };
    expect(worktreeSignature(singleRepoTree(), a)).toBe(worktreeSignature(singleRepoTree(), b));
  });

  it("moves when a degraded source appears", () => {
    const clean = singleRepoPresence(NOW);
    const degraded: WorktreePresence = {
      ...clean,
      degradedSources: [{ source: "registry", reason: "spawn ENOENT", since: NOW }],
    };
    expect(worktreeSignature(singleRepoTree(), degraded)).not.toBe(worktreeSignature(singleRepoTree(), clean));
  });

  it("moves when any clock the age column can fall back to moves", () => {
    // `ageTimestamp` falls back through lastActivityAt and startedAt, so a row
    // whose only moving timestamp is a fallback would otherwise render a frozen age.
    for (const field of ["lastActivityAt", "startedAt"] as const) {
      const base = singleRepoPresence(NOW);
      const moved = singleRepoPresence(NOW);
      const row = Object.values(moved.rowsByWorktreeId)[0]?.[0];
      if (!row) {
        throw new Error("fixture lost its first row");
      }
      row[field] = NOW - 90_000;
      expect(worktreeSignature(singleRepoTree(), moved)).not.toBe(worktreeSignature(singleRepoTree(), base));
    }
  });

  it("is order-sensitive, because the tree renders in array order", () => {
    const reordered = singleRepoTree();
    const repo = reordered.repos[0];
    if (repo) {
      repo.worktrees.reverse();
    }
    expect(worktreeSignature(reordered, null)).not.toBe(worktreeSignature(singleRepoTree(), null));
  });
});

// Coverage proof (design.md D5). These fixtures are typed `Required<T>`, so a
// field added to a wire type is a compile error here until it is set; the walk
// below then asserts every field it finds moves the signature. A field that
// genuinely renders nothing is named in NOT_RENDERED with its reason — field
// names only, never a whole type, which would re-open the gap wholesale.

const FULL_SUBAGENT: Required<WorktreeSubagentRow> = {
  name: "sub-1",
  title: "Delegated read",
  status: "completed",
  live: false,
  entryId: "sub-entry",
};

const FULL_ROW: Required<WorktreeAgentRow> = {
  rowId: "row-1",
  scope: "window",
  paneId: "pane-1",
  viewId: "view-1",
  title: "Building",
  preview: "last line",
  model: "sonnet",
  agent: "claude",
  agentSource: "launch",
  activity: "running",
  activitySource: "hook",
  interactivePrompt: '{"approval":{"tool":"Bash"}}',
  entryId: "entry-1",
  titleSourceId: "entry-1",
  startedAt: 10,
  stateStartedAt: 20,
  finishedAt: 30,
  lastActivityAt: 40,
  pid: 4321,
  delegations: { kind: "ok", rows: [FULL_SUBAGENT], incomplete: true },
};

const FULL_DEGRADATION: Required<PresenceDegradation> = {
  source: "panes",
  reason: "pane scan failed",
  since: 7,
};

const WT_ID = "/repo/wt";

const FULL_PRESENCE: Required<WorktreePresence> = {
  rowsByWorktreeId: { [WT_ID]: [FULL_ROW] },
  scannedAt: NOW,
  degradedSources: [FULL_DEGRADATION],
};

const FULL_WORKTREE: Required<WorktreeInfo> = {
  id: WT_ID,
  displayPath: WT_ID,
  kind: "linked",
  bare: false,
  branch: "feat",
  head: "abc123",
  detached: false,
  locked: true,
  lockReason: "held by an agent",
  prunable: false,
  missing: false,
  inWorkspace: true,
};

const FULL_REPO: Required<WorktreeRepo> = {
  repoId: "/repo/.git",
  label: "repo",
  mainPath: "/repo",
  worktrees: [FULL_WORKTREE],
  generation: 7,
  degraded: "exit 128",
};

/** Inline on WorktreeTree, so it needs its own entry or only its first field is walked. */
const FULL_UNREADABLE: Required<WorktreeTree["unreadable"]> = { count: 1, reasons: ["EACCES"] };

const FULL_TREE: Required<WorktreeTree> = {
  repos: [FULL_REPO],
  unreadable: FULL_UNREADABLE,
  gitAvailable: true,
};

/** Verified against every renderer under src/webview/worktree/ before listing. */
const NOT_RENDERED: Record<string, string> = {
  "WorktreePresence.scannedAt": "moves on every rescan; keying it would make the guard buy nothing",
  "WorktreeAgentRow.pid": "no renderer reads it",
  "WorktreeAgentRow.model":
    "no list row draws it; the inspector is its home, and it returns to the signature when that draws it",
  "WorktreeAgentRow.titleSourceId":
    "names where a disowned row's title came from, never drawn; `title` is what renders, and it moves on its own",
  "WorktreeSubagentRow.live": "typed as the constant false, so it can never move",
  "WorktreeRepo.generation":
    "the token a launch quotes, rendered nowhere; it moves on every rebuild, so keying it would repaint the tree at rebuild rate (design.md D10)",
};

/** A different value of the same shape, so the change is the field, not its type. */
function perturb(value: unknown): unknown {
  if (typeof value === "boolean") {
    return !value;
  }
  if (typeof value === "number") {
    return value + 1;
  }
  if (typeof value === "string") {
    return `${value}~`;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.slice(0, -1) : ["~"];
  }
  if (value !== null && typeof value === "object") {
    // Perturb a field of the nested value rather than blanking it: a shape the
    // signature reads into must stay a valid shape, or the walk tests a crash
    // instead of the key.
    const entries = Object.entries(value as Record<string, unknown>);
    const first = entries[0];
    return first === undefined ? { added: "~" } : { ...(value as object), [first[0]]: perturb(first[1]) };
  }
  return "~";
}

const sign = (tree: WorktreeTree, presence: WorktreePresence) => worktreeSignature(tree, presence);
const withRow = (row: WorktreeAgentRow): WorktreePresence => ({
  ...FULL_PRESENCE,
  rowsByWorktreeId: { [WT_ID]: [row] },
});

const COVERAGE: Array<{ type: string; full: Record<string, unknown>; sign: (patched: never) => string }> = [
  { type: "WorktreeTree", full: FULL_TREE, sign: (t) => sign(t as WorktreeTree, FULL_PRESENCE) },
  {
    type: "WorktreeRepo",
    full: FULL_REPO,
    sign: (r) => sign({ ...FULL_TREE, repos: [r as WorktreeRepo] }, FULL_PRESENCE),
  },
  {
    type: "WorktreeInfo",
    full: FULL_WORKTREE,
    sign: (w) => sign({ ...FULL_TREE, repos: [{ ...FULL_REPO, worktrees: [w as WorktreeInfo] }] }, FULL_PRESENCE),
  },
  {
    type: "WorktreeTree.unreadable",
    full: FULL_UNREADABLE,
    sign: (u) => sign({ ...FULL_TREE, unreadable: u as WorktreeTree["unreadable"] }, FULL_PRESENCE),
  },
  { type: "WorktreePresence", full: FULL_PRESENCE, sign: (p) => sign(FULL_TREE, p as WorktreePresence) },
  { type: "WorktreeAgentRow", full: FULL_ROW, sign: (r) => sign(FULL_TREE, withRow(r as WorktreeAgentRow)) },
  {
    type: "WorktreeSubagentRow",
    full: FULL_SUBAGENT,
    sign: (s) =>
      sign(FULL_TREE, withRow({ ...FULL_ROW, delegations: { kind: "ok", rows: [s as WorktreeSubagentRow] } })),
  },
  {
    type: "PresenceDegradation",
    full: FULL_DEGRADATION,
    sign: (d) => sign(FULL_TREE, { ...FULL_PRESENCE, degradedSources: [d as PresenceDegradation] }),
  },
];

describe("worktreeSignature — every rendered field is keyed", () => {
  for (const entry of COVERAGE) {
    it(`moves on every rendered field of ${entry.type}`, () => {
      const signOne = entry.sign as (patched: Record<string, unknown>) => string;
      const baseline = signOne(entry.full);
      for (const key of Object.keys(entry.full)) {
        if (NOT_RENDERED[`${entry.type}.${key}`] !== undefined) {
          continue;
        }
        const patched = signOne({ ...entry.full, [key]: perturb(entry.full[key]) });
        expect(patched, `${entry.type}.${key} is not in the render key — it would render stale`).not.toBe(baseline);
      }
    });
  }
});

describe("roster states are distinguishable in the signature", () => {
  it("separates a row whose roster was never read from one read and empty", () => {
    // Both render nothing under the row, and a signature that cannot tell them
    // apart leaves the "reading…" state on screen after the answer arrived.
    const unread = signatureFor([agentRow({ rowId: "window:a", delegations: undefined })]);
    const empty = signatureFor([agentRow({ rowId: "window:a", delegations: { kind: "ok", rows: [] } })]);
    expect(unread).not.toBe(empty);
  });

  it("separates an incomplete roster from a complete one with the same rows", () => {
    const rows = [{ name: "librarian", status: "completed" as const, live: false as const }];
    const complete = signatureFor([agentRow({ rowId: "window:a", delegations: { kind: "ok", rows } })]);
    const incomplete = signatureFor([
      agentRow({ rowId: "window:a", delegations: { kind: "ok", rows, incomplete: true } }),
    ]);
    expect(complete).not.toBe(incomplete);
  });

  it("separates a live delegation from the same one recorded as history", () => {
    // `live` decides the section label and the row styling, so a roster that
    // changed only in provenance must not hash the same as the one it replaced
    // — it would be guarded out and never repaint (round-1 W3).
    const past = signatureFor([
      agentRow({
        rowId: "window:a",
        delegations: { kind: "ok", rows: [{ name: "librarian", status: "running", live: false }] },
      }),
    ]);
    const live = signatureFor([
      agentRow({
        rowId: "window:a",
        delegations: { kind: "ok", reported: true, rows: [{ name: "librarian", status: "running", live: true }] },
      }),
    ]);
    expect(past).not.toBe(live);
  });

  it("separates a failed roster from an empty one, and by its reason", () => {
    const empty = signatureFor([agentRow({ rowId: "window:a", delegations: { kind: "ok", rows: [] } })]);
    const failed = signatureFor([agentRow({ rowId: "window:a", delegations: { kind: "failed", reason: "EACCES" } })]);
    const other = signatureFor([agentRow({ rowId: "window:a", delegations: { kind: "failed", reason: "ENOENT" } })]);
    expect(failed).not.toBe(empty);
    expect(failed).not.toBe(other);
  });

  it("ignores the registration generation, which moves on every rebuild", () => {
    // The generation is not rendered anywhere — it is the token a launch quotes
    // (design.md D10). Signing it would repaint the whole tree at rebuild rate,
    // which is the exact cost this guard exists to avoid.
    const moved: WorktreeTree = { ...FULL_TREE, repos: [{ ...FULL_REPO, generation: FULL_REPO.generation + 1 }] };
    expect(worktreeSignature(moved, null)).toBe(worktreeSignature(FULL_TREE, null));
  });
});

describe("[1_3] the model is keyed again", () => {
  it("moves the signature when only the model changed", () => {
    // It left the key when it left the list row (WT-009.2). The inspector draws
    // it, so a guard blind to it would hold a stale model on screen for ever.
    const base = agentRow({ rowId: "a", agent: "claude", model: "claude-opus-5" });
    expect(signatureFor([base])).not.toBe(signatureFor([{ ...base, model: "claude-sonnet-5" }]));
  });

  it("tells an unknown model apart from a named one", () => {
    const bare = agentRow({ rowId: "a", agent: "claude" });
    expect(signatureFor([bare])).not.toBe(signatureFor([{ ...bare, model: "claude-opus-5" }]));
  });

  it("does not let an empty model hash like a real one", () => {
    // An absent and an empty model both render nothing, so they may hash alike;
    // what must not happen is either hashing like a row that names one.
    const bare = agentRow({ rowId: "a", agent: "claude" });
    const named = signatureFor([{ ...bare, model: "x" }]);
    expect(signatureFor([bare])).not.toBe(named);
    expect(signatureFor([{ ...bare, model: "" }])).not.toBe(named);
  });
});

describe("[1_3] a signature scoped to one worktree", () => {
  const INFO = worktree({ id: "/repo/wt", branch: "feat/x" });
  const ROWS = [agentRow({ rowId: "a", agent: "claude", title: "Building", model: "claude-opus-5" })];
  const scoped = (
    info: WorktreeInfo = INFO,
    rows: readonly WorktreeAgentRow[] = ROWS,
    degraded: readonly PresenceDegradation[] = [],
  ): string => worktreeScopeSignature(info, rows, degraded, NOW);

  it("moves for the worktree's own fields", () => {
    expect(scoped()).not.toBe(scoped({ ...INFO, branch: "feat/y" }));
    expect(scoped()).not.toBe(scoped({ ...INFO, locked: true }));
    expect(scoped()).not.toBe(scoped({ ...INFO, missing: true }));
  });

  it("moves for its agents' fields, including the model", () => {
    const first = ROWS[0];
    if (first === undefined) {
      throw new Error("fixture lost its row");
    }
    expect(scoped()).not.toBe(scoped(INFO, [{ ...first, model: "claude-sonnet-5" }]));
    expect(scoped()).not.toBe(scoped(INFO, [{ ...first, title: "Something else" }]));
    expect(scoped()).not.toBe(scoped(INFO, []));
  });

  it("moves for a degradation that changes what a glyph claims", () => {
    expect(scoped()).not.toBe(scoped(INFO, ROWS, [{ source: "registry", reason: "unreadable", since: NOW }]));
  });

  it("still strips decorative frames, so a spinner alone changes nothing", () => {
    const first = ROWS[0];
    if (first === undefined) {
      throw new Error("fixture lost its row");
    }
    expect(scoped(INFO, [{ ...first, title: "⠋ Building" }])).toBe(scoped());
  });

  it("ignores everything outside the worktree it is about", () => {
    // This is the whole reason it exists: guarding the drawer on the full-tree
    // signature would rebuild it when an unrelated repository's listing failed,
    // when a repo label moved, or when git went away — none of which it draws.
    // Both sides are scoped OUT of a real tree, so the claim is that one
    // worktree hashes alike in a healthy tree and a sick one.
    const healthy = singleRepoTree();
    const sick: WorktreeTree = {
      ...healthy,
      gitAvailable: false,
      unreadable: { count: 3, reasons: ["EACCES"] },
      repos: healthy.repos.map((r: WorktreeRepo) => ({ ...r, label: "renamed", degraded: "listing failed" })),
    };
    const presence: WorktreePresence = { scannedAt: NOW, degradedSources: [], rowsByWorktreeId: { "/repo": ROWS } };
    // The full signature DOES move, which is what proves those fields are real
    // inputs and the scoped one holding still is a decision, not an inert test.
    expect(worktreeSignature(healthy, presence, NOW)).not.toBe(worktreeSignature(sick, presence, NOW));

    const pick = (t: WorktreeTree): WorktreeInfo => {
      const found = t.repos[0]?.worktrees[0];
      if (found === undefined) {
        throw new Error("fixture has no worktree to scope to");
      }
      return found;
    };
    expect(scoped(pick(healthy))).toBe(scoped(pick(sick)));
  });

  it("ignores another worktree's rows entirely", () => {
    const other = [agentRow({ rowId: "z", agent: "codex", title: "Elsewhere" })];
    expect(scoped()).not.toBe(scoped(INFO, other));
  });
});
