// src/shared/paneEvidence.ts — The rules that turn one pane's evidence into an
// activity, shared by the webview tab tracker and the extension host.
//
// The webview projects activity for the tab it renders; the host projects it
// for the worktree row, over the window's whole pane set. Two implementations
// of "what does running mean" is how the tab bar and the worktree row end up
// disagreeing about the same pane, so the rules live here and neither side
// owns a copy.
//
// Pure and dependency-free by contract: imported from both bundles.
//
// See: docs/design/worktree-agent-presence.md § 3.3;
//      asimov/changes/add-host-pane-evidence/design.md D5, D9.

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

/** Every state a pane can be in. `exited` is produced only by a dead pty. */
export type PaneActivity = LiveActivity | "exited";

export interface LiveActivityEvidence {
  /** The pane is blocked on the user. */
  waiting: boolean;
  /** An agent reported itself working, independent of any output. */
  semanticWorking: boolean;
  /** Output was seen within `OUTPUT_IDLE_WINDOW_MS`. */
  outputActive: boolean;
}

/**
 * Activity for a pane whose process is alive.
 *
 * `waiting` outranks `running` deliberately: an agent painting a prompt is
 * still emitting output, so ordering these the other way would render every
 * approval prompt as work in progress.
 *
 * No title rule fires here yet. `worktree-agent-presence.md` § 6 adds two — a
 * shell title forces `idle`, a spinner-only title feeds `running` — and they
 * belong in this function when they land, so they reach the tab and the
 * worktree row in the same change (design.md D9).
 */
export function projectLiveActivity(evidence: LiveActivityEvidence): LiveActivity {
  if (evidence.waiting) {
    return "waiting";
  }
  if (evidence.semanticWorking || evidence.outputActive) {
    return "running";
  }
  return "idle";
}

/**
 * Activity for any pane. `exited` wins over everything: the process is gone, so
 * whatever the last output or title evidence claimed is history.
 */
export function projectPaneActivity(evidence: LiveActivityEvidence & { exited: boolean }): PaneActivity {
  return evidence.exited ? "exited" : projectLiveActivity(evidence);
}
