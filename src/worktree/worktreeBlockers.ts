// src/worktree/worktreeBlockers.ts — One pass that produces everything at risk in
// a removal, and decides whether any confirmation could authorize it
// (design.md D2, D4).
//
// One pass, because the confirmation has to name every blocker at once
// (worktree-actions.md § 3.3): a set assembled from reads taken at different
// moments is not a set anyone confirmed.
//
// The evidence carries IDENTITIES, not just counts, because the fingerprint 1_4
// takes over it has to notice substitution — one dirty file swapped for another
// leaves every count unchanged (design.md D3).

import type { PaneActivity } from "../shared/paneEvidence";
import { isPathInside } from "../utils/pathBoundary";
import type { IgnoredMaterial } from "./ignoredMaterial";
import type { WorktreeInfo } from "./types";

/** A worktree registered inside the removal target. */
export interface ContainedWorktree {
  worktreeId: string;
  displayPath: string;
}

/** What is at risk, by identity. Counts for display are derived from these. */
export interface RemovalEvidence {
  /** Repo-relative, sorted. Tracked files with modifications. */
  dirtyPaths: readonly string[];
  /** Repo-relative, sorted. */
  untrackedPaths: readonly string[];
  /** Panes in THIS window rooted in the worktree whose agent is not mid-turn. */
  paneIds: readonly string[];
  /** Live registry sessions rooted here that belong to another window. */
  externalSessionIds: readonly string[];
  locked: boolean;
  lockReason: string | null;
  /**
   * Sources whose question did not arise, so the checks they feed report
   * `notApplicable` rather than `passed`.
   *
   * Without this the assessment cannot tell a clean working tree from one that
   * has no working tree: `notApplicable` parses as empty, which is honest, but
   * the emptiness then looks exactly like a tree with nothing in it.
   */
  notApplicable: readonly UnreadableSource[];
  /**
   * What the removal will delete that `git status --porcelain` never names.
   *
   * Carried as the walk's own three-way answer rather than a count: a walk that
   * gave up and a walk that found nothing are different reports, and flattening
   * them here is how "0 ignored files" gets said about a `node_modules`.
   */
  ignored: IgnoredMaterial;
}

/**
 * No confirmation authorizes these. Structurally carries no fingerprint, so a
 * refusal can never be mistaken for a set that merely shrank (design.md D3).
 */
export interface RemovalRefusal {
  kind: "refused";
  isMain: boolean;
  /** Agents mid-turn in THIS window. Never external sessions — see below. */
  busyAgents: number;
  containsWorktrees: readonly ContainedWorktree[];
  /**
   * Registry sessions rooted here that are NOT provably idle, counted once.
   *
   * Separate from `busyAgents` so one session is never scored twice: the
   * presence projection emits every external session as a row with a hardcoded
   * activity, and adding those to the window count would refuse on the strength
   * of the same fact read from two places.
   */
  liveExternalSessionIds: readonly string[];
}

export interface ConfirmableRemoval {
  kind: "confirmable";
  evidence: RemovalEvidence;
}

/**
 * The blockers could not be READ, which is not the same as there being none.
 *
 * Three sources feed an assessment and all three can fail: the worktree's own
 * `git status`, the external-session registry, and the repository listing. Each
 * used to fall back to a benign value — `""`, `[]`, "current" — which produced
 * an empty blocker set indistinguishable from a genuinely clean worktree, on
 * the one action that cannot be undone (round-2 B6).
 *
 * Distinct from `refused` on purpose: a refusal is an answer, this is the
 * absence of one, and only this one is worth retrying.
 */
export interface UnavailableRemoval {
  kind: "unavailable";
  /** Never empty. */
  unreadable: readonly UnreadableSource[];
}

/**
 * A source a check is fed from.
 *
 * `ignored` never appears in `UnavailableRemoval.unreadable`: worktree-removal.md
 * § 2.3 is explicit that a slow or unreadable disk must not make a worktree
 * unremovable, so a walk that could not finish leaves ONE confirmable check
 * unproven rather than the whole assessment unanswerable.
 */
export type UnreadableSource = "status" | "sessions" | "listing" | "ignored";

export type RemovalAssessment = RemovalRefusal | ConfirmableRemoval | UnavailableRemoval;

/** A read that may have failed. The failure is carried, never substituted. */
/**
 * A source that was read, failed to read, or had nothing to read.
 *
 * `notApplicable` is NOT a benign fallback dressed up — that is exactly what
 * D16 exists to forbid. It says the question does not arise: a worktree whose
 * directory is authoritatively gone has no working tree to hold modified files,
 * so `git status` is not a read that failed, it is a read with no subject. The
 * distinction matters because `worktree-actions.md:348` requires removing a
 * `missing` worktree to SUCCEED and prune the registration, and treating its
 * absent directory as an unreadable status closed that path permanently
 * (round-3 B8).
 */
export type SourceRead<T> = { ok: true; value: T } | { ok: false } | { ok: "notApplicable" };

/** A projected row attributed to the target worktree. */
export interface AttributedRow {
  scope: "window" | "external";
  activity: string;
}

/**
 * A cwd this assessment compares against `WorktreeInfo.id`.
 *
 * RESOLVED, not merely absolute. `normalizeWorktreePath` realpaths every
 * worktree id, so a shell reporting a symlinked spelling of the same directory
 * is inside no worktree by this comparison — and on this path that reads as a
 * pane that will not be destroyed rather than a pane nobody warned about. The
 * producer resolves, because only the producer's set is bounded: `evaluateRemoval`
 * is synchronous and pure, and resolving here would be a syscall per pane per
 * assessment (design.md D1).
 */
export interface PaneFact {
  paneId: string;
  /** Resolved. Absent when the pane has not reported one. */
  cwd: string | undefined;
  activity: PaneActivity | undefined;
}

export interface ExternalSessionFact {
  sessionId: string;
  /** Resolved, on the same contract as `PaneFact.cwd`. */
  cwd: string;
  /**
   * What this session is doing, or `undefined` when nobody could say.
   *
   * Absent means LIVE. An external session we cannot ask about is not evidence
   * of idleness (worktree-removal.md § 3), and this is the one action that
   * cannot be undone. The Claude registry records no activity today, so
   * `undefined` is what production supplies — which refuses, honestly, rather
   * than refusing on a hardcoded value nobody measured.
   */
  activity: PaneActivity | undefined;
}

export interface RemovalInput {
  target: WorktreeInfo;
  /** Every registered worktree of the same repository, including the target. */
  siblings: readonly WorktreeInfo[];
  panes: readonly PaneFact[];
  /** Rows the presence projection attributed to the target. */
  rows: readonly AttributedRow[];
  externalSessions: SourceRead<readonly ExternalSessionFact[]>;
  /** Raw stdout of `git status --porcelain` run in the worktree. */
  porcelain: SourceRead<string>;
  /**
   * One bounded walk of the worktree's ignored material, already taken.
   *
   * Taken by the caller because `evaluateRemoval` is synchronous and pure and
   * the walk is neither.
   */
  ignored: IgnoredMaterial;
  /** The repository listing this input was built from was degraded or stale. */
  listingDegraded?: boolean;
}

export function evaluateRemoval(input: RemovalInput): RemovalAssessment {
  const { target } = input;

  // Checked FIRST, ahead of the refusals: a refusal derived from siblings and
  // rows we know to be stale is not a stronger answer than admitting we could
  // not check. `containsWorktrees` in particular comes straight from the
  // listing.
  const unreadable: UnreadableSource[] = [
    ...(input.porcelain.ok === false ? (["status"] as const) : []),
    ...(input.externalSessions.ok === false ? (["sessions"] as const) : []),
    ...(input.listingDegraded === true ? (["listing"] as const) : []),
  ];
  if (unreadable.length > 0) {
    return { kind: "unavailable", unreadable };
  }

  const containsWorktrees = input.siblings
    .filter((w) => w.id !== target.id && isPathInside(w.id, target.id))
    .map((w) => ({ worktreeId: w.id, displayPath: w.displayPath }))
    .sort((a, b) => a.worktreeId.localeCompare(b.worktreeId));

  // `busyAgents` counts WINDOW-OWNED rows only. presenceProjector emits every
  // external registry session as a row with a hardcoded activity of "running";
  // counting those here would score one external session as both busyAgents and
  // externalAgents, converting the accepted CONFIRMABLE externalAgents blocker
  // (worktree-actions.md:192) into an unconditional refusal — and making a
  // worktree unremovable because some other window has a session in it.
  const busyAgents = input.rows.filter(
    (r) => r.scope !== "external" && (r.activity === "running" || r.activity === "waiting"),
  ).length;

  // Rooted here and not provably idle. `worktree-actions.md` once made every
  // external session confirmable; § 116 of that document now delegates the check
  // set to `worktree-removal.md`, whose § 2 refuses on running, waiting, AND
  // undeterminable. The worktree is removable again as soon as that process
  // exits — the registry lists only live pids.
  const externalHere = (input.externalSessions.ok === true ? input.externalSessions.value : []).filter((s) =>
    isPathInside(s.cwd, target.id),
  );
  const liveExternalSessionIds = externalHere
    .filter((s) => s.activity !== "idle" && s.activity !== "exited")
    .map((s) => s.sessionId)
    .sort();

  if (target.kind === "main" || busyAgents > 0 || containsWorktrees.length > 0 || liveExternalSessionIds.length > 0) {
    return {
      kind: "refused",
      isMain: target.kind === "main",
      busyAgents,
      containsWorktrees,
      liveExternalSessionIds,
    };
  }

  // `notApplicable` parses as empty and that is the honest answer here: there
  // is no directory, so there are no working files a removal could destroy.
  const status = parsePorcelain(input.porcelain.ok === true ? input.porcelain.value : "");
  const paneIds = input.panes
    .filter((p) => p.cwd !== undefined && isPathInside(p.cwd, target.id) && p.activity !== "exited")
    .map((p) => p.paneId)
    .sort();
  // Only the provably idle ones reach here — anything else already refused.
  const externalSessionIds = externalHere.map((s) => s.sessionId).sort();

  return {
    kind: "confirmable",
    evidence: {
      dirtyPaths: status.dirty,
      untrackedPaths: status.untracked,
      paneIds,
      externalSessionIds,
      locked: target.locked,
      lockReason: target.lockReason ?? null,
      notApplicable: [
        ...(input.porcelain.ok === "notApplicable" ? (["status"] as const) : []),
        ...(input.externalSessions.ok === "notApplicable" ? (["sessions"] as const) : []),
      ],
      ignored: input.ignored,
    },
  };
}

/**
 * `git status --porcelain` short format: two status columns, a space, the path.
 * `??` is untracked; anything else is a tracked change. A rename reports
 * `orig -> new`, and the NEW path is what a deletion would take.
 */
function parsePorcelain(stdout: string): { dirty: string[]; untracked: string[] } {
  const dirty: string[] = [];
  const untracked: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    const code = line.slice(0, 2);
    const rest = line.slice(3);
    const path = rest.includes(" -> ") ? (rest.split(" -> ")[1] ?? rest) : rest;
    const unquoted = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
    if (code === "??") {
      untracked.push(unquoted);
    } else {
      dirty.push(unquoted);
    }
  }
  return { dirty: dirty.sort(), untracked: untracked.sort() };
}
