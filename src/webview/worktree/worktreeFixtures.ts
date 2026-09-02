// src/webview/worktree/worktreeFixtures.ts — Static data in the exact shapes the
// host will push, one per state in docs/ui/worktree.html.
//
// Typed against the real `WorktreeTree` (src/worktree/types.ts) and the transcribed
// presence/action types, so wiring the host is a swap of the producer, not a
// rewrite of the view. Timestamps are expressed as offsets from a caller-supplied
// `now` — a fixture with a baked-in epoch renders a different age every day.

import type {
  ProvisionModel,
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeCreateDefaults,
  WorktreeInfo,
  WorktreePresence,
  WorktreeProvisionOffer,
  WorktreeRemoveReport,
  WorktreeTree,
} from "./worktreeViewTypes";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const REPO_ID = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";
const MAIN_PATH = "/Users/dev/Projects/ai-oss/anywhere-terminal";
const WT_ROOT = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt";

/** Every field defaulted to its quiet value, so a fixture only states what it means. */
export function worktree(over: Partial<WorktreeInfo> & Pick<WorktreeInfo, "id">): WorktreeInfo {
  return {
    displayPath: over.id,
    kind: "linked",
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    missing: false,
    inWorkspace: false,
    ...over,
  };
}

export function agentRow(over: Partial<WorktreeAgentRow> & Pick<WorktreeAgentRow, "rowId">): WorktreeAgentRow {
  return {
    scope: "window",
    agentSource: "launch",
    activity: "idle",
    activitySource: "hook",
    ...over,
  };
}

/**
 * Mockup § 1 / § 4: one repo, so no group header. Covers the active worktree card,
 * a collapsed presence pill, a zero-agent row, locked, detached, and missing.
 */
export function singleRepoTree(): WorktreeTree {
  return {
    gitAvailable: true,
    unreadable: { count: 0, reasons: [] },
    repos: [
      {
        repoId: REPO_ID,
        label: "anywhere-terminal",
        mainPath: MAIN_PATH,
        worktrees: [
          worktree({ id: MAIN_PATH, kind: "main", branch: "main", head: "a".repeat(40), inWorkspace: true }),
          worktree({ id: `${WT_ROOT}/worktree-panel`, branch: "feat/worktree-panel", head: "b".repeat(40) }),
          worktree({ id: `${WT_ROOT}/validator`, branch: "asimov-validator-autofix", head: "c".repeat(40) }),
          worktree({
            id: `${WT_ROOT}/release`,
            branch: "release/0.4.x",
            head: "d".repeat(40),
            locked: true,
            lockReason: "publishing",
          }),
          worktree({ id: `${WT_ROOT}/detached`, detached: true, head: "9f2c1ab0000000000000000000000000000000ab" }),
          // `missing` outranks `prunable`: only one badge shows on this row.
          worktree({
            id: "/Volumes/ext/anywhere-terminal-wt/spike-hooks",
            branch: "spike/hooks",
            head: "e".repeat(40),
            missing: true,
            prunable: true,
          }),
        ],
      },
    ],
  };
}

/** Mockup § 2: two repos, so group headers appear; the second one is degraded. */
export function twoRepoTree(): WorktreeTree {
  const single = singleRepoTree();
  const primary = single.repos[0];
  if (!primary) {
    throw new Error("singleRepoTree lost its repo");
  }
  return {
    gitAvailable: true,
    unreadable: { count: 0, reasons: [] },
    repos: [
      { ...primary, worktrees: primary.worktrees.slice(0, 2) },
      {
        repoId: "/Users/dev/Projects/cyberk-skills/.git",
        label: "cyberk-skills",
        mainPath: "/Users/dev/Projects/cyberk-skills",
        degraded: "git worktree list: exit 128 — not a git repository (safe.directory)",
        worktrees: [
          worktree({
            id: "/Users/dev/Projects/cyberk-skills",
            kind: "main",
            branch: "main",
            head: "f".repeat(40),
          }),
          worktree({ id: "/Users/dev/Projects/cyberk-skills-bare", bare: true, prunable: true }),
        ],
      },
    ],
  };
}

/** Mockup § 7, third frame: git is absent, and that is not an error state. */
export function gitMissingTree(): WorktreeTree {
  return { gitAvailable: false, unreadable: { count: 0, reasons: [] }, repos: [] };
}

/**
 * Git went away after a good listing, so the worktrees are retained and stale
 * rather than gone (spec: a retained listing is shown rather than replaced by an
 * empty state). Distinct from `gitMissingTree`, which never listed anything.
 */
export function gitGoneWithRetainedTree(): WorktreeTree {
  const reason = "git 2.20 is below 2.31";
  const retained = singleRepoTree();
  return {
    gitAvailable: false,
    unreadable: { count: 1, reasons: [reason] },
    repos: retained.repos.map((repo) => ({ ...repo, degraded: reason })),
  };
}

/** Mockup § 7, second frame: folders are open, none of them is a repository. */
export function noRepoTree(): WorktreeTree {
  return { gitAvailable: true, unreadable: { count: 0, reasons: [] }, repos: [] };
}

/**
 * Mockup § 1 / § 4: three window rows on `main` — one waiting with two past
 * delegations, one running, one with no proven identity — and seven on the second
 * worktree so the collapsed pill has something to overflow.
 */
export function singleRepoPresence(now: number): WorktreePresence {
  const overflow: WorktreeAgentRow[] = [];
  for (let i = 0; i < 5; i++) {
    overflow.push(
      agentRow({
        rowId: `run-${i}`,
        agent: i === 4 ? "codex" : "claude",
        activity: "running",
        activitySource: "hook",
        title: `worker ${i}`,
        stateStartedAt: now - (i + 1) * MINUTE,
      }),
    );
  }
  return {
    scannedAt: now,
    degradedSources: [],
    rowsByWorktreeId: {
      [MAIN_PATH]: [
        agentRow({
          rowId: "main-claude",
          agent: "claude",
          activity: "waiting",
          activitySource: "hook",
          title: "INTEGRATE-WORKTREE",
          preview: "Approve the git worktree add?",
          model: "sonnet-4-6",
          entryId: "claude:abc",
          paneId: "pane-1",
          stateStartedAt: now - 5 * MINUTE,
          delegations: {
            kind: "ok",
            rows: [
              { name: "reviewer", title: "Review the worktree row anatomy", status: "completed", live: false },
              { name: "librarian", title: "locate the presence spec", status: "failed", live: false },
            ],
          },
        }),
        agentRow({
          rowId: "main-codex",
          agent: "codex",
          activity: "running",
          activitySource: "hook",
          title: "Backpressure pass",
          preview: "Bash: npm run test -- src/webview",
          model: "gpt-5-codex",
          paneId: "pane-2",
          stateStartedAt: now - 20_000,
        }),
        // Fallback ACTIVITY source: the confidence marker shows, and the icon stays.
        agentRow({
          rowId: "main-opencode",
          agent: "opencode",
          activity: "running",
          activitySource: "output",
          agentSource: "process",
          title: "opencode",
          preview: "writing docs/design/worktree-panel-ui.md",
          paneId: "pane-3",
          stateStartedAt: now - 2 * MINUTE,
        }),
        // External scope: labelled, offered no focus anywhere.
        agentRow({
          rowId: "main-external",
          agent: "cursor",
          scope: "external",
          agentSource: "registry",
          activity: "waiting",
          activitySource: "registry",
          title: "Sash regression hunt",
          preview: "Which file should I start from?",
          pid: 4242,
          entryId: "cursor:xyz",
          stateStartedAt: now - 14 * MINUTE,
        }),
        // `agentSource: "none"` — a plain terminal row, never a guessed icon.
        agentRow({
          rowId: "main-shell",
          agentSource: "none",
          activity: "idle",
          activitySource: "none",
          title: "zsh",
          paneId: "pane-4",
          finishedAt: now - HOUR,
        }),
      ],
      [`${WT_ROOT}/worktree-panel`]: [
        ...overflow,
        agentRow({ rowId: "idle-1", agent: "opencode", activity: "idle", title: "opencode", finishedAt: now - HOUR }),
        agentRow({ rowId: "idle-2", agent: "cursor", activity: "idle", title: "cursor", finishedAt: now - 2 * HOUR }),
      ],
    },
  };
}

/** Mockup § 5, first notice: git refused the removal and said exactly why. */
export const removeErrorResult: WorktreeActionResult = {
  action: "remove",
  worktreeId: "/Volumes/ext/anywhere-terminal-wt/spike-hooks",
  outcome: "error",
  error:
    "fatal: '/Volumes/ext/anywhere-terminal-wt/spike-hooks' contains modified or untracked files, use --force to delete it",
};

/** Mockup § 5, second notice: the repository changed, so this is not a failure. */
export const removeIndeterminateResult: WorktreeActionResult = {
  action: "remove",
  worktreeId: `${WT_ROOT}/release`,
  repoId: REPO_ID,
  outcome: "indeterminate",
  observed: "observed after: git worktree remove — exit 0, list still reports the path",
};

/** Mockup § 11: every confirmable check failing at once, so one confirmation covers the whole risk. */
export const confirmableBlocker: WorktreeRemoveReport = {
  fingerprint: "sha256:blockers-v1",
  checks: [
    { id: "isMain", cls: "refusal", outcome: "passed" },
    { id: "busyAgents", cls: "refusal", outcome: "passed", count: 0 },
    { id: "containsWorktrees", cls: "refusal", outcome: "passed", count: 0 },
    { id: "dirty", cls: "confirmable", outcome: "failed", count: 4 },
    { id: "untracked", cls: "confirmable", outcome: "failed", count: 3 },
    { id: "idlePanes", cls: "confirmable", outcome: "failed", count: 2 },
    { id: "externalAgents", cls: "confirmable", outcome: "failed", count: 1 },
    { id: "locked", cls: "confirmable", outcome: "failed" },
  ],
  contained: [],
};

/** Mockup § 12: a mid-turn agent. No confirmation authorizes this one. */
export const refusedBlocker: WorktreeRemoveReport = {
  fingerprint: "sha256:blockers-v2",
  checks: [
    { id: "isMain", cls: "refusal", outcome: "passed" },
    { id: "busyAgents", cls: "refusal", outcome: "failed", count: 1 },
    { id: "containsWorktrees", cls: "refusal", outcome: "passed", count: 0 },
  ],
  contained: [],
};

/** Mockup § 9: the default create seed. § 10 is the same seed plus `collidedWith`. */
export function createDefaults(over: Partial<WorktreeCreateDefaults> = {}): WorktreeCreateDefaults {
  return {
    repoId: REPO_ID,
    repoLabel: "anywhere-terminal",
    mainPath: MAIN_PATH,
    pathParent: "/Users/dev/Projects/ai-oss",
    pathPrefix: "anywhere-terminal",
    agents: [
      {
        id: "claude",
        label: "Claude Code",
        canSeedPrompt: true,
        permissionChoices: [
          { id: "default", label: "Ask for permission" },
          { id: "plan", label: "Plan only" },
          { id: "acceptEdits", label: "Accept edits" },
          { id: "bypassPermissions", label: "Bypass permission checks", dangerous: true },
        ],
      },
      {
        id: "codex",
        label: "Codex",
        canSeedPrompt: true,
        permissionChoices: [
          { id: "read-only", label: "Read only" },
          { id: "workspace-write", label: "Write in the workspace" },
          { id: "danger-full-access", label: "Full access, no approvals", dangerous: true },
        ],
      },
      // No postures at all — the box must render without a posture control.
      { id: "opencode", label: "OpenCode", canSeedPrompt: true, permissionChoices: [] },
    ],
    ...over,
  };
}

const YAML = "asimov/worktree.yaml";

/**
 * A repository that declares one of everything — the acceptance case for the
 * section, and the only fixture that exercises a port row: this repository's own
 * `asimov/worktree.yaml` declares no `ports:` at all.
 */
export function provisionModel(over: Partial<ProvisionModel> = {}): ProvisionModel {
  return {
    entries: [
      { id: "i1", path: ".env", mode: "copy", source: YAML },
      { id: "i2", path: ".claude/settings.local.json", mode: "copy", source: YAML },
      { id: "i3", path: ".env.local", mode: "link", source: YAML },
    ],
    ports: [{ id: "i4", name: "APP", source: YAML }],
    setup: [{ id: "i5", kind: "shell", script: "pnpm install --frozen-lockfile", source: YAML }],
    providers: [{ id: "asimov", files: [YAML], present: [YAML], active: true }],
    excluded: [],
    contenders: [],
    problems: [],
    ...over,
  };
}

/** The offer as the form receives it — an opaque id beside the model it names. */
export function provisionOffer(over: Partial<WorktreeProvisionOffer> = {}): WorktreeProvisionOffer {
  return { offerId: "provision-1", model: provisionModel(), ...over };
}

/** A repository that declares nothing — no provider file at all, not a failed read. */
export function emptyProvisionModel(): ProvisionModel {
  return {
    entries: [],
    ports: [],
    setup: [],
    providers: [],
    excluded: [],
    contenders: [],
    problems: [],
  };
}

/** A provider file that is present and unusable. The model survives; the file is named. */
export function malformedProvisionModel(over: Partial<ProvisionModel> = {}): ProvisionModel {
  return {
    ...emptyProvisionModel(),
    providers: [{ id: "asimov", files: [YAML], present: [YAML], active: true }],
    problems: [{ file: YAML, reason: "malformed", detail: "Unexpected key `copyFiles` at line 12." }],
    ...over,
  };
}
