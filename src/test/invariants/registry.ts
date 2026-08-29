// src/test/invariants/registry.ts — The docs/DESIGN.md § 8.4 truthfulness invariants,
// as data a test can check. See asimov/changes/verify-cross-layer-scale/design.md D1.
//
// `statement` is verbatim from § 8.4 and is compared against the doc on every run, so an
// edit to either side fails loudly rather than drifting. `stimulus` is the change that must
// turn the covering test red — it is what makes a tag reviewable, since nothing can
// machine-check that a test tagged [I7] actually asserts I7.

export type InvariantStatus = "covered" | "uncovered" | "deferred";

export interface InvariantRow {
  readonly id: string;
  /** Verbatim from docs/DESIGN.md § 8.4. */
  readonly statement: string;
  /** Every docs/PLAN.md task that introduced part of the behaviour. */
  readonly owners: readonly string[];
  /** The change that must make the covering test go red. */
  readonly stimulus: string;
  readonly status: InvariantStatus;
  /** Required for `uncovered` and `deferred`. */
  readonly reason?: string;
}

export const INVARIANTS: readonly InvariantRow[] = [
  {
    id: "I1",
    statement: "A failed or timed-out scan never downgrades a row. Absence of evidence is not evidence of absence",
    owners: ["WT-001.2", "WT-004.1"],
    stimulus: "Make a failed process-table or registry read clear the pane's agent instead of degrading it",
    status: "covered",
  },
  {
    id: "I2",
    statement: "A spinner frame proves activity, never identity. No agent icon without a proven identity",
    owners: ["WT-004.1", "WT-003.2"],
    stimulus: "Let a title-only spinner frame set agentSource, so an icon appears without proven identity",
    status: "covered",
  },
  {
    id: "I3",
    statement: "An `external` row is never focusable and is always labelled as running outside this window",
    owners: ["WT-004.2"],
    stimulus: "Offer activation or a Focus Pane menu item on a row whose scope is external",
    status: "covered",
  },
  {
    id: "I4",
    statement:
      "Identity confidence and activity confidence are derived independently from their own source; neither is collapsed into a single field",
    owners: ["WT-004.1"],
    stimulus: "Collapse agentSource and activitySource into one confidence field",
    status: "covered",
  },
  {
    id: "I5",
    statement: "Transcript-derived subagents are history, rendered as history, with `live: false`",
    owners: ["WT-004.3"],
    stimulus: "Publish a transcript-derived subagent with live: true, or in the live dot vocabulary",
    status: "covered",
  },
  {
    id: "I6",
    statement: "A resumed or cleared session landing idle is not a completed turn",
    owners: ["WT-006.3"],
    stimulus: "Let SessionStart or a cleared session stamp finishedAt, so the pane reads as a completed turn",
    status: "covered",
  },
  {
    id: "I7",
    statement:
      "Hook status is never carried across a window reload \u2014 the process that published it is gone, so the pane returns to inference",
    owners: ["WT-006.3", "WT-004.0"],
    stimulus: "Retain a published turn report across runtime disposal, so a reloaded window keeps hook status",
    status: "covered",
  },
  {
    id: "I8",
    statement:
      "Degraded data is labelled with its failing source and reason; a repo that fails to list keeps its last good listing. An empty result that is genuinely empty is not degraded",
    owners: ["WT-001.2", "WT-004.1"],
    stimulus:
      "Report a genuinely empty listing as degraded, or drop the failing source and reason from a real degradation",
    status: "covered",
  },
  {
    id: "I9",
    statement:
      "Decorative title frames are stripped in the webview, before any message, comparison, render signature, or identity test",
    owners: ["WT-003.2", "WT-004.0"],
    stimulus: "Compare, hash, or send a title before stripDecorations runs on it",
    status: "covered",
  },
  // `covered` here is the engineering standard this registry uses everywhere — a passing test
  // exercises the behaviour — and NOT a proof of I10's universal negative. Round 9 established that
  // no type-based rule can decide "this value is `fs.rm`", because TypeScript's type identity is
  // structural. So the evidence is: the real-git tests drive the shipped removal path and show it
  // calls `git worktree remove`, and `pnpm run gate:fs-deletion` is a regression tripwire over an
  // enumerated scope. What the tripwire does not decide is not prose — the four `gap-` fixtures it
  // asserts by name are the inventory (design.md D10). The stimulus below is narrowed to match:
  // a gap spelling would not turn this evidence red, and claiming otherwise is the overclaim
  // rounds 5 through 10 kept finding.
  {
    id: "I10",
    statement:
      "The extension never deletes files directly; directory removal is delegated to git \u2014 which still deletes recursively, so this bounds our bugs, not git's consequences",
    owners: ["WT-005.2"],
    stimulus:
      "Stop the exercised removal path from calling `git worktree remove`, or write a destructive `node:fs` reference the tripwire recognises inside its enumerated scope",
    status: "covered",
  },
  {
    id: "I11",
    statement: "A subagent row nests exactly one level, carries no pane identity, and activates its parent's pane",
    owners: ["WT-004.3"],
    stimulus: "Nest a subagent two levels, give it its own paneId, or activate anything but the parent's pane",
    status: "covered",
  },
  {
    id: "I12",
    statement: "Children inherit their parent's freshness \u2014 a stale parent leaves no provably-working child",
    owners: ["WT-004.3", "WT-006.3"],
    stimulus: "Leave a child running after its parent's evidence went stale",
    status: "covered",
  },
  {
    id: "I13",
    statement: "Every turn state maps to exactly one activity; a state no event can produce does not exist",
    owners: ["WT-006.3"],
    stimulus:
      "Add a turn state with no activity, map one turn state onto two activities, or leave a mapped state no event can produce",
    status: "covered",
  },
  {
    id: "I14",
    statement:
      "A confirmation authorizes the blocker set it was shown; a blocker that appears afterwards re-prompts, and a working agent is never force-removable",
    owners: ["WT-005.2"],
    stimulus: "Execute a confirmed removal against a blocker set that changed after the confirmation was shown",
    status: "covered",
  },
  {
    id: "I15",
    statement:
      "A failed or timed-out mutation still forces a rebuild; a state git and the filesystem disagree about is reported as indeterminate, never as a clean failure",
    owners: ["WT-005.2"],
    stimulus: "Report a timed-out mutation as a clean failure, or skip the rebuild that follows it",
    status: "covered",
  },
  {
    id: "I16",
    statement: "Agent-reported identity is a lookup key only; no reported path is opened on the report's authority",
    owners: ["WT-006.3"],
    stimulus: "Open or stat a transcriptPath taken from an agent report rather than from the vault store",
    status: "covered",
  },
  {
    id: "I17",
    statement: "The confirmation ceiling degrades an unconfirmed `running` rather than animating it or calling it idle",
    owners: ["WT-008.2"],
    stimulus:
      "Keep animating an output-inferred run past the ceiling, or downgrade it to idle instead of presenting it as unconfirmed",
    status: "covered",
  },
];
