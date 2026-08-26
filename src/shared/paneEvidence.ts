// src/shared/paneEvidence.ts — The rules that turn one pane's evidence into an
// activity, shared by the webview tab tracker and the extension host.
//
// The webview projects activity for the tab it renders; the host projects it
// for the worktree row, over the window's whole pane set. Two implementations
// of "what does running mean" is how the tab bar and the worktree row end up
// disagreeing about the same pane, so the rules live here and neither side
// owns a copy.
//
// Pure and dependency-free by contract: imported from both bundles. The one
// import is `agentNames`, which is dependency-free for the same reason.
//
// See: docs/design/worktree-agent-presence.md § 3.3;
//      asimov/changes/add-host-pane-evidence/design.md D5, D9.

import { isShellName, matchTitleAgentName } from "./agentNames";

/** Output seen more recently than this counts as `running`. */
export const OUTPUT_IDLE_WINDOW_MS = 1500;

/**
 * Upper bound on a reported title. xterm accepts OSC payloads up to 10 MB and
 * any program can emit one; the store holds an entry per open pane, so an
 * unbounded title is an unbounded registry.
 */
export const MAX_REPORTED_TITLE_CHARS = 1024;

/** What a pane whose process is still running can be doing. */
export type LiveActivity = "running" | "waiting" | "idle";

/**
 * What a pane's reported title claims about who owns the pane.
 *
 * `unknown` is not `neutral`: a pane no surface has reported yet has told us
 * nothing, which is a different claim from a title that named nothing.
 */
export type TitleClass = "shell" | "agent" | "neutral" | "unknown";

/** Every state a pane can be in. `exited` is produced only by a dead pty. */
export type PaneActivity = LiveActivity | "exited";

export interface LiveActivityEvidence {
  /** The pane is blocked on the user. */
  waiting: boolean;
  /** An agent reported itself working, independent of any output. */
  semanticWorking: boolean;
  /** Output was seen within `OUTPUT_IDLE_WINDOW_MS`. */
  outputActive: boolean;
  /** What the last reported title claims. Required, so no caller can skip the rule. */
  titleClass: TitleClass;
}

/**
 * What a reported title claims about who owns the pane.
 *
 * One implementation, called by the webview tracker and the host store alike:
 * two copies of this ladder is how the tab bar and the worktree row end up
 * disagreeing about the same title (.reviews/round-1.md S1).
 *
 * `undefined` is `unknown`, not `neutral` — a pane no surface has reported has
 * told us nothing, which is a different claim from a title that named nothing.
 */
export function classifyTitle(title: string | undefined): TitleClass {
  if (title === undefined) {
    return "unknown";
  }
  if (title.trim() === "") {
    return "neutral"; // decoration-only titles arrive here already stripped
  }
  if (isShellName(title)) {
    return "shell";
  }
  return matchTitleAgentName(title) ? "agent" : "neutral";
}

/**
 * Which rule produced a pane's activity.
 *
 * Carried rather than re-derived, because the outcome does not identify its
 * cause: an idle pane with a shell title may have been forced idle by that
 * title, or may simply have had nothing to do. Crediting the title in both
 * cases reports a provenance that is false half the time
 * (.reviews/round-1.md W2).
 */
export type ActivityRule = "waiting" | "shell-title" | "working" | "quiet";

export interface ProjectedActivity {
  activity: LiveActivity;
  rule: ActivityRule;
}

/**
 * Activity for a pane whose process is alive.
 *
 * `waiting` outranks `running` deliberately: an agent painting a prompt is
 * still emitting output, so ordering these the other way would render every
 * approval prompt as work in progress.
 *
 * A `shell` title outranks output and semantic evidence but NOT `waiting`. A
 * shell name is strong evidence the agent ended and the shell has the pane
 * back, so whatever is still being written is the shell's. It yields to
 * `waiting` because a false `idle` on a pane blocked on the user hides a prompt
 * they have to answer, which is the costlier of the two mistakes.
 *
 * No title ever produces `running`. Decoration is stripped before a title
 * reaches the host, so a spinner frozen at the moment its process hung is
 * indistinguishable from one still animating; the evidence that an agent is
 * working is the output it produces, not the title it left behind.
 *
 * See: docs/design/worktree-agent-presence.md § 6;
 *      asimov/changes/project-worktree-agent-presence/design.md D6, D7.
 */
export function explainLiveActivity(evidence: LiveActivityEvidence): ProjectedActivity {
  if (evidence.waiting) {
    return { activity: "waiting", rule: "waiting" };
  }
  const working = evidence.semanticWorking || evidence.outputActive;
  if (evidence.titleClass === "shell") {
    // The rule is `shell-title` only where it actually overruled something. A
    // pane that was going to be idle anyway was not decided by its title.
    return { activity: "idle", rule: working ? "shell-title" : "quiet" };
  }
  if (working) {
    return { activity: "running", rule: "working" };
  }
  return { activity: "idle", rule: "quiet" };
}

export function projectLiveActivity(evidence: LiveActivityEvidence): LiveActivity {
  return explainLiveActivity(evidence).activity;
}

/**
 * Activity for any pane. `exited` wins over everything: the process is gone, so
 * whatever the last output or title evidence claimed is history.
 */
export function projectPaneActivity(evidence: LiveActivityEvidence & { exited: boolean }): PaneActivity {
  return evidence.exited ? "exited" : projectLiveActivity(evidence);
}

/** As `projectPaneActivity`, keeping the rule that decided. */
export function explainPaneActivity(evidence: LiveActivityEvidence & { exited: boolean }): {
  activity: PaneActivity;
  rule: ActivityRule;
} {
  return evidence.exited ? { activity: "exited", rule: "quiet" } : explainLiveActivity(evidence);
}
